import asyncio
import json
import logging
import time
import ccxt.pro as ccxtpro
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.redis import redis_manager
from app.helpers.orderbook_math import calculate_dynamic_wall_threshold
from app.services.liquidity_absorption_service import liquidity_absorption_service
from app.services.subminute_candle_recorder import subminute_candle_recorder
from app.services.l2_heatmap_recorder import l2_heatmap_recorder
from app.services.footprint_recorder import footprint_recorder

logger = logging.getLogger(__name__)


def _compact_trade_dict(t: Dict[str, Any]) -> Dict[str, Any]:
    """Strip bloated raw exchange `info` blobs while preserving all fields consumers use."""
    return {
        "id": t.get("id"),
        "timestamp": t.get("timestamp"),
        "datetime": t.get("datetime"),
        "symbol": t.get("symbol"),
        "side": t.get("side"),
        "price": t.get("price"),
        "amount": t.get("amount"),
        "cost": t.get("cost"),
    }


class MarketDataStreamer:
    """
    Singleton class to manage background CCXT WebSocket connections
    and publish market depth, incremental trades, and BBO data to Redis.

    Safeguards against CPU/Redis storms and leaked streams:
      - Enables `newUpdates=True` on CCXT Pro clients + cursor deduplication so
        `watch_trades` never re-serializes 1,000 cached trades per tick.
      - Pipelines & throttles Redis writes (orderbook <= 10 Hz, trades flushed
        at <= 10 Hz, BBO deduplicated on change & <= 40 Hz).
      - Tracks WebSocket subscriber refcounts + idle TTL auto-reaping so closed
        or abandoned symbols never leak permanent background WebSocket tasks.
    """
    _instance = None

    IDLE_STREAM_TTL_SECONDS: float = 300.0   # Auto-stop idle HTTP-warmed streams after 5 min
    WS_RELEASE_GRACE_SECONDS: float = 45.0   # Short grace after last WS client disconnects
    REAPER_INTERVAL_SECONDS: float = 20.0
    MAX_CONCURRENT_STREAMS: int = 16
    ORDERBOOK_MIN_INTERVAL_SEC: float = 0.05 # Max 20 Hz per stream
    TRADES_FLUSH_INTERVAL_SEC: float = 0.025 # Batch trade Redis pushes at <= 40 Hz
    BBO_MIN_INTERVAL_SEC: float = 0.025      # Max 40 Hz when BBO actually changes
    BBO_KEEPALIVE_SEC: float = 3.0           # Refresh BBO ts <= 3.0s on flat books without flooding Redis

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MarketDataStreamer, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._active_streams: Set[str] = set()
        self._bbo_stream_active: Set[str] = set()
        self._exchange_instances: Dict[str, ccxtpro.Exchange] = {}
        self._tasks: Dict[str, List[asyncio.Task]] = {}
        self._last_traded_prices: Dict[str, float] = {}
        self._last_price_redis_ts: Dict[str, float] = {}
        self._latest_bbo_mem: Dict[str, Tuple[float, float, float]] = {}
        self._subscriber_counts: Dict[str, int] = {}
        self._last_touch_ts: Dict[str, float] = {}
        self._stream_idle_ttl: Dict[str, float] = {}
        self._reaper_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._initialized = True

    EXCHANGE_ALIASES: Dict[str, str] = {
        "gateio": "gate",
        "huobi": "htx",
        "coinbasepro": "coinbase",
    }

    @classmethod
    def _normalize_exchange_and_key(cls, exchange_id: str, symbol: str = "") -> Tuple[str, str, bool]:
        """Normalizes exchange ID (handling aliases & KuCoin/Kraken Futures) and builds a Spot/Futures cache key."""
        raw_ex = str(exchange_id or "").strip().lower()
        norm_ex = cls.EXCHANGE_ALIASES.get(raw_ex, raw_ex)
        is_futures = ':' in str(symbol or "")
        if norm_ex == 'kucoin' and is_futures:
            norm_ex = 'kucoinfutures'
        elif norm_ex == 'kraken' and is_futures:
            norm_ex = 'krakenfutures'
        if norm_ex.endswith('futures'):
            is_futures = True
        cache_key = f"{norm_ex}_{'futures' if is_futures else 'spot'}"
        return norm_ex, cache_key, is_futures

    def get_mem_bbo(self, exchange_id: str, symbol: str, max_age_seconds: float = 1.5) -> Optional[Tuple[float, float]]:
        """Ultra-fast (~0ms) in-process BBO reader populated by @bookTicker/orderbook WS streams."""
        sym_upper = str(symbol or "").strip().upper()
        norm_ex, _, _ = self._normalize_exchange_and_key(exchange_id, sym_upper)
        stream_key = f"{norm_ex}:{sym_upper}"
        entry = self._latest_bbo_mem.get(stream_key) or self._latest_bbo_mem.get(f"{norm_ex}:{symbol}")
        if not entry:
            return None
        bid_p, ask_p, ts = entry
        eff_max_age = (
            max(max_age_seconds, self.BBO_KEEPALIVE_SEC + 1.0)
            if stream_key in self._active_streams
            else max_age_seconds
        )
        if bid_p > 0 and ask_p > 0 and -0.5 <= (time.time() - ts) <= eff_max_age:
            return bid_p, ask_p
        return None

    def _ensure_reaper(self) -> None:
        if self._reaper_task is None or self._reaper_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._reaper_task = loop.create_task(self._idle_reaper_loop())
            except RuntimeError:
                pass

    async def _idle_reaper_loop(self) -> None:
        """Periodically stop streams with zero active WS subscribers past their idle TTL."""
        while True:
            try:
                t_sleep_start = time.monotonic()
                await asyncio.sleep(self.REAPER_INTERVAL_SECONDS)
                # Guard against unit tests that globally mock asyncio.sleep to return immediately
                if (time.monotonic() - t_sleep_start) < 0.05:
                    break
                if not self._active_streams:
                    continue
                now = time.monotonic()
                expired: List[str] = []
                for sk in list(self._active_streams):
                    if self._subscriber_counts.get(sk, 0) > 0:
                        continue
                    last_touch = self._last_touch_ts.get(sk, 0.0)
                    ttl = self._stream_idle_ttl.get(sk, self.IDLE_STREAM_TTL_SECONDS)
                    if (now - last_touch) >= ttl:
                        expired.append(sk)
                for sk in expired:
                    logger.info(f"🧹 Reaping idle market stream: {sk}")
                    await self.stop_streaming(sk)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[MarketDataStreamer] Reaper error: {e}")

    async def _evict_if_over_cap(self, keep_key: str) -> None:
        """If active streams exceed MAX_CONCURRENT_STREAMS, stop oldest zero-subscriber streams."""
        if len(self._active_streams) < self.MAX_CONCURRENT_STREAMS:
            return
        idle_candidates = [
            (self._last_touch_ts.get(sk, 0.0), sk)
            for sk in list(self._active_streams)
            if sk != keep_key and self._subscriber_counts.get(sk, 0) <= 0
        ]
        idle_candidates.sort(key=lambda item: item[0])
        while len(self._active_streams) >= self.MAX_CONCURRENT_STREAMS and idle_candidates:
            _, victim = idle_candidates.pop(0)
            logger.info(f"🧹 Evicting oldest idle stream ({victim}) to stay within cap={self.MAX_CONCURRENT_STREAMS}")
            await self.stop_streaming(victim)

    async def start_streaming(self, exchange_id: str, symbol: str) -> str:
        """Starts streaming order book/trades/BBO for a pair, or refreshes its idle TTL."""
        symbol = str(symbol or "").strip().upper()
        internal_exchange_id, _, _ = self._normalize_exchange_and_key(exchange_id, symbol)
        stream_key = f"{internal_exchange_id}:{symbol}"

        self._last_touch_ts[stream_key] = time.monotonic()
        self._stream_idle_ttl[stream_key] = self.IDLE_STREAM_TTL_SECONDS
        self._ensure_reaper()

        if stream_key in self._active_streams:
            return stream_key

        await self._evict_if_over_cap(stream_key)
        self._active_streams.add(stream_key)

        task_ob = asyncio.create_task(self._stream_order_book(internal_exchange_id, symbol, stream_key))
        task_trades = asyncio.create_task(self._stream_trades(internal_exchange_id, symbol, stream_key))
        task_bbo = asyncio.create_task(self._stream_bbo(internal_exchange_id, symbol, stream_key))
        self._tasks[stream_key] = [task_ob, task_trades, task_bbo]
        return stream_key

    async def acquire_stream(self, exchange_id: str, symbol: str) -> str:
        """Increment WS subscriber refcount and ensure stream is running."""
        stream_key = await self.start_streaming(exchange_id, symbol)
        self._subscriber_counts[stream_key] = self._subscriber_counts.get(stream_key, 0) + 1
        return stream_key

    def release_stream(self, stream_key: Optional[str]) -> None:
        """Decrement WS subscriber refcount; when 0, allow reaper to stop after short grace."""
        if not stream_key:
            return
        cur = self._subscriber_counts.get(stream_key, 0)
        if cur <= 1:
            self._subscriber_counts.pop(stream_key, None)
            self._last_touch_ts[stream_key] = time.monotonic()
            self._stream_idle_ttl[stream_key] = self.WS_RELEASE_GRACE_SECONDS
        else:
            self._subscriber_counts[stream_key] = cur - 1

    async def _get_exchange_instance(self, exchange_id: str, symbol: str) -> ccxtpro.Exchange:
        # Resolve to specific futures class & separate Spot/Futures cache key
        exchange_id, cache_key, is_futures = self._normalize_exchange_and_key(exchange_id, symbol)

        async with self._lock:
            if cache_key not in self._exchange_instances:
                exchange_class = getattr(ccxtpro, exchange_id, None)
                if not exchange_class:
                    raise ValueError(f"Exchange {exchange_id} not supported")

                options: Dict[str, Any] = {
                    'enableRateLimit': True,
                    'newUpdates': True,  # CRITICAL: only emit incremental trades/updates, never full 1,000-item cache!
                }
                if exchange_id == 'binance':
                    options['options'] = {'defaultType': 'swap' if is_futures else 'spot'}
                exchange = exchange_class(options)

                # ⚡ Copy pre-warmed markets from ccxt_service off-loop if available (0ms event-loop stall)
                try:
                    from app.services.ccxt_service import ccxt_service
                    from app.services.exchange_pool import apply_prewarmed_markets_off_loop
                    market_type = 'swap' if is_futures else 'spot'
                    cache_id = f"{exchange_id}_{market_type}"
                    prewarmed = ccxt_service._market_cache.get(cache_id)
                    if prewarmed and hasattr(exchange, 'set_markets'):
                        cnt = await apply_prewarmed_markets_off_loop(exchange, prewarmed, is_futures=is_futures)
                        logger.info(f"Streamer ⚡ Copied {cnt} pre-warmed markets for {cache_key} (off-loop)")
                except Exception as cp_err:
                    logger.debug(f"Streamer pre-warmed copy fallback: {cp_err}")

                if not getattr(exchange, 'markets', None):
                    try:
                        await exchange.load_markets()
                    except Exception as e:
                        logger.warning(f"Streamer failed to load markets for {cache_key}: {e}")

                self._exchange_instances[cache_key] = exchange

        return self._exchange_instances[cache_key]

    def _normalize_order_book_limit(self, exchange_id: str, limit: int) -> int:
        """Normalizes the order book limit based on exchange-specific requirements."""
        exchange_id = exchange_id.lower()
        if 'kucoin' in exchange_id:  # Covers 'kucoin' and 'kucoinfutures'
            return 20 if limit <= 20 else 100

        if 'binance' in exchange_id:
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            elif limit <= 50: return 50
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000

        if 'kraken' in exchange_id:
            if limit <= 10: return 10
            elif limit <= 25: return 25
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000
        if 'htx' in exchange_id:
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            else: return 150

        if 'bitfinex' in exchange_id:
            return 25 if limit <= 25 else 100

        return limit

    @staticmethod
    def _is_invalid_symbol_error(err: Exception) -> bool:
        msg = str(err).lower()
        return "does not have market symbol" in msg or "bad symbol" in msg

    @classmethod
    def _log_stream_error(
        cls,
        stream_type: str,
        symbol: str,
        exchange_id: str,
        err: Exception,
        consecutive_errors: int,
    ) -> bool:
        """
        Logs a stream error with appropriate severity and returns True if fatal (invalid symbol).
        Transient WS/CCXT resync errors log at WARNING while auto-reconnecting; only persistent
        failures (>= 5 consecutive errors) escalate to ERROR.
        """
        err_msg = str(err)
        err_lower = err_msg.lower()
        if cls._is_invalid_symbol_error(err):
            logger.error(f"Invalid symbol {symbol} for exchange {exchange_id}: {err_msg}")
            return True

        if "1006" in err_msg or "closed by remote server" in err_lower or "connection closed" in err_lower:
            logger.warning(f"Connection closed for {stream_type} {symbol} on {exchange_id}, reconnecting... ({err_msg})")
        elif consecutive_errors < 5:
            logger.warning(
                f"Transient error watching {stream_type} {symbol} on {exchange_id} "
                f"(attempt {consecutive_errors}, reconnecting): {err_msg}"
            )
        else:
            logger.error(
                f"Persistent error watching {stream_type} {symbol} on {exchange_id} "
                f"({consecutive_errors} consecutive failures): {err_msg}"
            )
        return False

    async def _stream_order_book(self, exchange_id: str, symbol: str, stream_key: str):
        logger.info(f"🚀 Starting background CCXT stream for {stream_key}")
        redis = redis_manager.get_redis()
        channel = f"market_depth_stream:{exchange_id}:{symbol}"
        ob_key = f"latest_orderbook:{exchange_id}:{symbol}"
        bbo_key = f"bbo:{exchange_id}:{symbol}"

        try:
            exchange = await self._get_exchange_instance(exchange_id, symbol)
        except Exception as e:
            logger.error(f"Failed to initialize exchange {exchange_id} for {symbol}: {e}")
            self._active_streams.discard(stream_key)
            return

        consecutive_errors = 0
        last_publish_mono = 0.0
        last_bbo_write_mono = 0.0
        last_bbo_pair: Tuple[float, float] = (0.0, 0.0)
        depth_limit = self._normalize_order_book_limit(exchange_id, 50)
        sym_upper = symbol.upper()

        while stream_key in self._active_streams:
            try:
                orderbook = await exchange.watch_order_book(sym_upper, limit=depth_limit)
                consecutive_errors = 0

                raw_bids = orderbook.get('bids', [])
                raw_asks = orderbook.get('asks', [])

                now_mono = time.monotonic()
                now_wall = time.time()

                # Fallback BBO update when dedicated @bookTicker stream is unavailable
                if raw_bids and raw_asks and stream_key not in self._bbo_stream_active:
                    cur_bbo = (float(raw_bids[0][0]), float(raw_asks[0][0]))
                    if cur_bbo[0] > 0 and cur_bbo[1] > 0:
                        self._latest_bbo_mem[stream_key] = (cur_bbo[0], cur_bbo[1], now_wall)
                    if redis and (cur_bbo != last_bbo_pair or (now_mono - last_bbo_write_mono) >= self.BBO_KEEPALIVE_SEC):
                        last_bbo_pair = cur_bbo
                        last_bbo_write_mono = now_mono
                        await redis.setex(
                            bbo_key,
                            60,
                            json.dumps({"bid": cur_bbo[0], "ask": cur_bbo[1], "ts": now_wall}),
                        )

                # Throttle heavy 50-level serialization + Redis publish to <= 10 Hz
                if (now_mono - last_publish_mono) < self.ORDERBOOK_MIN_INTERVAL_SEC:
                    continue
                last_publish_mono = now_mono

                bids = []
                bid_total = 0.0
                for bid in raw_bids[:50]:
                    price = float(bid[0])
                    size = float(bid[1])
                    bid_total += size
                    bids.append({"price": price, "size": size, "total": bid_total})

                asks = []
                ask_total = 0.0
                for ask in raw_asks[:50]:
                    price = float(ask[0])
                    size = float(ask[1])
                    ask_total += size
                    asks.append({"price": price, "size": size, "total": ask_total})

                wall_threshold = calculate_dynamic_wall_threshold(bids, asks)

                walls = []
                for ask in asks:
                    if ask["size"] >= wall_threshold:
                        walls.append({"price": ask["price"], "type": "sell", "size": ask["size"]})
                for bid in bids:
                    if bid["size"] >= wall_threshold:
                        walls.append({"price": bid["price"], "type": "buy", "size": bid["size"]})

                mid_price = (asks[0]["price"] + bids[0]["price"]) / 2 if (asks and bids) else 0.0

                current_price = self._last_traded_prices.get(stream_key)
                if not current_price or current_price <= 0:
                    current_price = mid_price

                payload = {
                    "type": "orderbook",
                    "bids": bids,
                    "asks": asks,
                    "walls": walls,
                    "currentPrice": current_price,
                    "midPrice": mid_price,
                    "ts": now_wall,
                }

                # Serialize ONCE and send both setex + publish in a single Redis pipeline
                if redis:
                    payload_str = json.dumps(payload, separators=(",", ":"))
                    async with redis.pipeline(transaction=False) as pipe:
                        pipe.setex(ob_key, 60, payload_str)
                        pipe.publish(channel, payload_str)
                        await pipe.execute()

                try:
                    await l2_heatmap_recorder.record_orderbook(
                        exchange_id=exchange_id,
                        symbol=symbol,
                        bids=bids,
                        asks=asks,
                    )
                except Exception as hm_err:
                    logger.debug(f"L2HeatmapRecorder orderbook hook err: {hm_err}")

                try:
                    await liquidity_absorption_service.process_orderbook(
                        exchange_id=exchange_id,
                        symbol=symbol,
                        bids=bids,
                        asks=asks,
                        current_price=current_price,
                    )
                except Exception as abs_err:
                    logger.debug(f"LiquidityAbsorption orderbook hook err: {abs_err}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                consecutive_errors += 1
                is_fatal = self._log_stream_error("orderbook", symbol, exchange_id, e, consecutive_errors)
                if is_fatal:
                    if redis:
                        await redis.publish(channel, json.dumps({"error": f"Invalid symbol {symbol} or exchange error"}))
                    break

                await asyncio.sleep(5)

        self._active_streams.discard(stream_key)
        logger.info(f"🛑 Stopped background CCXT stream for {stream_key}")

    async def _stream_trades(self, exchange_id: str, symbol: str, stream_key: str):
        logger.info(f"🚀 Starting background CCXT trades stream for {stream_key}")
        redis = redis_manager.get_redis()
        channel = f"market_depth_stream:{exchange_id}:{symbol}"
        trade_key = f"recent_trades:{exchange_id}:{symbol}"
        last_price_key = f"last_price:{exchange_id}:{symbol}"

        try:
            exchange = await self._get_exchange_instance(exchange_id, symbol)
        except Exception as e:
            logger.error(f"Failed to initialize exchange {exchange_id} for {symbol} trades: {e}")
            return

        consecutive_errors = 0
        sym_upper = symbol.upper()
        last_seen_id: Optional[str] = None
        last_seen_ts: int = 0
        pending_trade_strs: List[str] = []
        pending_trades_raw: List[Dict[str, Any]] = []
        last_flush_mono = 0.0

        async def _flush_pending_trades() -> None:
            nonlocal pending_trades_raw, pending_trade_strs, last_flush_mono
            if not pending_trades_raw:
                return
            last_flush_mono = time.monotonic()
            batch_raw = pending_trades_raw
            batch_strs = pending_trade_strs
            pending_trades_raw = []
            pending_trade_strs = []

            recent_volume = sum(float(t.get("amount") or 0.0) for t in batch_raw)
            prices = [float(t.get("price") or 0.0) for t in batch_raw if t.get("price")]
            last_p = prices[-1] if prices else self._last_traded_prices.get(stream_key, 0.0)
            high_price = max(prices) if prices else last_p
            low_price = min(prices) if prices else last_p
            raw_ts = batch_raw[-1].get("timestamp")
            trade_ts = int(raw_ts) if raw_ts else int(time.time() * 1000)

            payload = {
                "type": "trade",
                "currentPrice": last_p,
                "highPrice": high_price,
                "lowPrice": low_price,
                "recentVolume": recent_volume,
                "timestamp": trade_ts,
                "side": batch_raw[-1].get("side"),
            }

            if redis:
                async with redis.pipeline(transaction=False) as pipe:
                    if batch_strs:
                        pipe.rpush(trade_key, *batch_strs)
                        pipe.ltrim(trade_key, -1000, -1)
                        pipe.expire(trade_key, 3600)
                    pipe.publish(channel, json.dumps(payload, separators=(",", ":")))
                    await pipe.execute()

            try:
                await subminute_candle_recorder.record_trades(
                    exchange_id=exchange_id,
                    symbol=symbol,
                    trades=batch_raw,
                )
            except Exception as rec_err:
                logger.debug(f"SubminuteRecorder trades hook err: {rec_err}")

            try:
                await footprint_recorder.record_trades(
                    exchange_id=exchange_id,
                    symbol=symbol,
                    trades=batch_raw,
                )
            except Exception as fp_err:
                logger.debug(f"FootprintRecorder trades hook err: {fp_err}")

            try:
                await liquidity_absorption_service.process_trades(
                    exchange_id=exchange_id,
                    symbol=symbol,
                    trades=batch_raw,
                )
            except Exception as abs_err:
                logger.debug(f"LiquidityAbsorption trades hook err: {abs_err}")

        while stream_key in self._active_streams:
            try:
                if pending_trades_raw:
                    remaining = max(0.005, self.TRADES_FLUSH_INTERVAL_SEC - (time.monotonic() - last_flush_mono))
                    try:
                        trades = await asyncio.wait_for(exchange.watch_trades(sym_upper), timeout=remaining)
                    except asyncio.TimeoutError:
                        await _flush_pending_trades()
                        continue
                else:
                    trades = await exchange.watch_trades(sym_upper)
                consecutive_errors = 0

                if not trades:
                    continue

                # Belt-and-suspenders incremental filter: even if an exchange ignores
                # newUpdates=True and returns the full 1,000-trade cache, only process
                # genuinely new trades so Redis/CPU can never be flooded.
                if last_seen_id is None and last_seen_ts == 0:
                    new_trades = list(trades[-100:])
                else:
                    new_trades = []
                    # Walk backwards from newest trade until we hit our last cursor
                    for t in reversed(trades):
                        tid = t.get("id")
                        tts = int(t.get("timestamp") or 0)
                        if last_seen_id is not None and tid is not None:
                            if str(tid) == last_seen_id:
                                break
                        elif tts and tts <= last_seen_ts:
                            break
                        new_trades.append(t)
                    new_trades.reverse()

                if not new_trades:
                    continue

                tail = new_trades[-1]
                if tail.get("id") is not None:
                    last_seen_id = str(tail.get("id"))
                if tail.get("timestamp"):
                    last_seen_ts = int(tail.get("timestamp"))

                # Update last traded price immediately (lightweight in-memory + <= 20 Hz Redis)
                last_price = float(tail.get("price") or 0.0)
                if last_price > 0:
                    prev_last = self._last_traded_prices.get(stream_key)
                    self._last_traded_prices[stream_key] = last_price
                    now_lp_ts = time.time()
                    if redis and (
                        last_price != prev_last
                        and (now_lp_ts - self._last_price_redis_ts.get(stream_key, 0.0)) >= 0.05
                    ):
                        self._last_price_redis_ts[stream_key] = now_lp_ts
                        await redis.setex(
                            last_price_key,
                            60,
                            json.dumps({"last": last_price, "ts": now_lp_ts}, separators=(",", ":")),
                        )

                # Accumulate compact trades and flush to Redis/absorption at <= 10 Hz
                for t in new_trades:
                    pending_trades_raw.append(t)
                    pending_trade_strs.append(json.dumps(_compact_trade_dict(t), separators=(",", ":")))

                # Guard pending buffer if an exchange emits a huge burst
                if len(pending_trade_strs) > 500:
                    pending_trade_strs = pending_trade_strs[-500:]
                    pending_trades_raw = pending_trades_raw[-500:]

                now_mono = time.monotonic()
                if (now_mono - last_flush_mono) < self.TRADES_FLUSH_INTERVAL_SEC and len(pending_trades_raw) < 100:
                    continue

                await _flush_pending_trades()

            except asyncio.CancelledError:
                break
            except Exception as e:
                consecutive_errors += 1
                if self._log_stream_error("trades", symbol, exchange_id, e, consecutive_errors):
                    break
                await asyncio.sleep(5)

    async def _stream_bbo(self, exchange_id: str, symbol: str, stream_key: str):
        """
        Real-time Best Bid/Ask (@bookTicker) stream for Spot, USDT-M, and COIN-M.
        Deduplicates unchanged BBO ticks and caps writes at 40 Hz to keep Smart Peg
        and Smart Chase ultra-responsive without flooding Redis.
        """
        redis = redis_manager.get_redis()
        if not redis:
            return
        try:
            exchange = await self._get_exchange_instance(exchange_id, symbol)
        except Exception:
            return
        if not getattr(exchange, 'has', {}).get('watchBidsAsks') or not hasattr(exchange, 'watch_bids_asks'):
            return

        sym_u = symbol.upper()
        bbo_key = f"bbo:{exchange_id}:{symbol}"
        channel = f"market_depth_stream:{exchange_id}:{symbol}"
        last_bid = 0.0
        last_ask = 0.0
        last_write_mono = 0.0
        pending_bbo: Optional[Tuple[float, float]] = None

        async def _write_bbo(bp: float, ap: float) -> None:
            nonlocal last_bid, last_ask, last_write_mono, pending_bbo
            last_bid = bp
            last_ask = ap
            last_write_mono = time.monotonic()
            pending_bbo = None
            now_wall = time.time()
            await redis.setex(
                bbo_key,
                60,
                json.dumps({"bid": bp, "ask": ap, "ts": now_wall}, separators=(",", ":")),
            )
            await redis.publish(
                channel,
                json.dumps({"type": "bbo", "bid": bp, "ask": ap, "ts": int(now_wall * 1000)}, separators=(",", ":")),
            )

        while stream_key in self._active_streams:
            try:
                if pending_bbo is not None:
                    remaining = max(0.005, self.BBO_MIN_INTERVAL_SEC - (time.monotonic() - last_write_mono))
                    try:
                        res = await asyncio.wait_for(exchange.watch_bids_asks([sym_u]), timeout=remaining)
                    except asyncio.TimeoutError:
                        await _write_bbo(pending_bbo[0], pending_bbo[1])
                        continue
                else:
                    res = await exchange.watch_bids_asks([sym_u])

                tkr = res.get(sym_u) if isinstance(res, dict) else None
                if not isinstance(tkr, dict) and isinstance(res, dict) and res:
                    tkr = next(iter(res.values()))
                if isinstance(tkr, dict):
                    bid_p = float(tkr.get('bid') or 0.0)
                    ask_p = float(tkr.get('ask') or 0.0)
                    if bid_p > 0 and ask_p > 0:
                        self._bbo_stream_active.add(stream_key)
                        self._latest_bbo_mem[stream_key] = (bid_p, ask_p, time.time())
                        now_mono = time.monotonic()
                        changed = (bid_p != last_bid or ask_p != last_ask)
                        elapsed = now_mono - last_write_mono
                        if (changed and elapsed >= self.BBO_MIN_INTERVAL_SEC) or elapsed >= self.BBO_KEEPALIVE_SEC:
                            await _write_bbo(bid_p, ask_p)
                        elif changed:
                            # Hold latest quote so it flushes within <= BBO_MIN_INTERVAL_SEC (zero stale last tick)
                            pending_bbo = (bid_p, ask_p)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._bbo_stream_active.discard(stream_key)
                if "not supported" in str(e).lower():
                    return
                await asyncio.sleep(2)

    async def stop_streaming(self, stream_key: str):
        """Stops a specific market data stream and cleans up its tasks."""
        if stream_key not in self._active_streams:
            return

        logger.info(f"🛑 Stopping stream: {stream_key}")
        self._active_streams.discard(stream_key)
        self._bbo_stream_active.discard(stream_key)
        self._subscriber_counts.pop(stream_key, None)
        self._last_touch_ts.pop(stream_key, None)
        self._stream_idle_ttl.pop(stream_key, None)
        self._last_traded_prices.pop(stream_key, None)
        self._last_price_redis_ts.pop(stream_key, None)
        self._latest_bbo_mem.pop(stream_key, None)

        if stream_key in self._tasks:
            for task in self._tasks[stream_key]:
                if not task.done():
                    task.cancel()
            del self._tasks[stream_key]

        # Clean up exchange connection if no other streams are active for this exchange/market-type
        try:
            parts = stream_key.split(':', 1)
            ex_id = parts[0]
            sym = parts[1] if len(parts) > 1 else ""
            _, cache_key, _ = self._normalize_exchange_and_key(ex_id, sym)
            remaining = any(
                self._normalize_exchange_and_key(*(k.split(':', 1) + [""])[:2])[1] == cache_key
                for k in self._active_streams
            )

            if not remaining and cache_key in self._exchange_instances:
                exchange = self._exchange_instances.pop(cache_key)
                await exchange.close()
                logger.info(f"🔌 Closed CCXT exchange instance for {cache_key} as no streams remain.")
        except Exception as e:
            logger.error(f"Error while cleaning up exchange connection for {stream_key}: {e}")

    async def stop_all(self):
        """Stops all running streams and closes exchange instances."""
        if self._reaper_task and not self._reaper_task.done():
            self._reaper_task.cancel()
        self._reaper_task = None

        self._active_streams.clear()
        self._bbo_stream_active.clear()
        self._subscriber_counts.clear()
        self._last_touch_ts.clear()
        self._stream_idle_ttl.clear()

        for task_list in self._tasks.values():
            for task in task_list:
                task.cancel()

        for exchange in self._exchange_instances.values():
            try:
                await exchange.close()
            except Exception as e:
                logger.error(f"Error closing exchange instance: {e}")

        self._exchange_instances.clear()
        self._tasks.clear()
        self._latest_bbo_mem.clear()


market_data_streamer = MarketDataStreamer()
