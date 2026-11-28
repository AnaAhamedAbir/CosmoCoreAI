import asyncio
import json
import logging
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from app.core.redis import redis_manager
from app.helpers.candle_time import parse_timestamp_ms

logger = logging.getLogger(__name__)


class SubminuteCandleRecorder:
    """
    Lightweight, institutional-grade 1-second OHLCV candle recorder.

    - Aggregates live trades into 1s OHLCV bars in-memory (O(1) per trade) and persists
      them to Redis Hash (`candles_1s:{exchange}:{symbol}`, field = bucket_sec,
      value = compact JSON `[ts_ms, o, h, l, c, v]`) capped to MAX_RETENTION_SECONDS (2 hours).
    - Runs ONE single lightweight Binance USD-M Futures combined public WebSocket for the
      top popular perpetual pairs so 1s/5s/15s/30s charts immediately load hundreds of real
      candles in <5ms with zero REST API calls or CCXT overhead.
    - Also accepts live trades pushed from `market_data_streamer` (all CCXT exchanges)
      and `oanda_streamer` (Forex) for any symbol opened by users.
    """

    MAX_RETENTION_SECONDS: int = 7200  # 2 hours of 1s bars = up to 7200 1s / 1440 5s / 480 15s / 240 30s
    MAX_TRACKED_SYMBOLS: int = 40      # Cap non-prewarmed symbols in memory
    REDIS_TTL_SECONDS: int = 10800     # 3 hours TTL in Redis
    FLUSH_INTERVAL_SEC: float = 1.0    # Flush dirty 1s bars to Redis <= 1 Hz per symbol
    PRUNE_INTERVAL_SEC: float = 60.0   # Prune expired Redis hash fields every 60s

    # Top liquid Binance USD-M Perpetual pairs pre-recorded via ONE combined WS (<2 MB RAM)
    TOP_FUTURES_PREWARM: List[Tuple[str, str]] = [
        ("btcusdt", "BTC/USDT:USDT"),
        ("ethusdt", "ETH/USDT:USDT"),
        ("solusdt", "SOL/USDT:USDT"),
        ("dogeusdt", "DOGE/USDT:USDT"),
        ("xrpusdt", "XRP/USDT:USDT"),
        ("bnbusdt", "BNB/USDT:USDT"),
        ("adausdt", "ADA/USDT:USDT"),
        ("avaxusdt", "AVAX/USDT:USDT"),
        ("suiusdt", "SUI/USDT:USDT"),
        ("linkusdt", "LINK/USDT:USDT"),
    ]

    def __init__(self) -> None:
        # key = "{internal_ex}:{SYMBOL}" -> OrderedDict[bucket_sec: int, List[float]]
        self._bars: Dict[str, "OrderedDict[int, List[float]]"] = {}
        # key -> set of bucket_sec that changed since last Redis flush
        self._dirty: Dict[str, set[int]] = {}
        self._last_flush: Dict[str, float] = {}
        self._last_prune: Dict[str, float] = {}
        self._last_access: Dict[str, float] = {}
        self._hydrated_from_redis: set[str] = set()
        self._hydrate_locks: Dict[str, asyncio.Lock] = {}
        self._prewarm_keys: set[str] = {
            f"binance:{ui_sym.upper()}" for _, ui_sym in self.TOP_FUTURES_PREWARM
        }
        self._prewarm_ws_connected: bool = False
        self._running: bool = False
        self._ws_task: Optional[asyncio.Task] = None
        self._flush_task: Optional[asyncio.Task] = None

    def is_prewarm_active(self, exchange_id: str, symbol: str) -> bool:
        """True when the built-in Binance Futures aggTrade WS is actively recording this pair."""
        return self._prewarm_ws_connected and self._make_key(exchange_id, symbol) in self._prewarm_keys

    def _evict_if_over_cap(self, keep_key: str) -> None:
        if len(self._bars) <= self.MAX_TRACKED_SYMBOLS:
            return
        candidates = sorted(
            (
                (self._last_access.get(k, 0.0), k)
                for k in self._bars
                if k != keep_key and k not in self._prewarm_keys
            ),
            key=lambda item: item[0],
        )
        while len(self._bars) > self.MAX_TRACKED_SYMBOLS and candidates:
            _, victim = candidates.pop(0)
            self._bars.pop(victim, None)
            self._dirty.pop(victim, None)
            self._last_flush.pop(victim, None)
            self._last_prune.pop(victim, None)
            self._last_access.pop(victim, None)
            self._hydrated_from_redis.discard(victim)
            self._hydrate_locks.pop(victim, None)

    @staticmethod
    def _make_key(exchange_id: str, symbol: str) -> str:
        ex = str(exchange_id or "").strip().lower()
        sym = str(symbol or "").strip().upper()
        return f"{ex}:{sym}"

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"candles_1s:{key}"

    def _upsert_trade_sync(self, key: str, ts_ms: int, price: float, amount: float) -> None:
        if price <= 0:
            return
        bucket_sec = ts_ms // 1000
        bucket_ms = bucket_sec * 1000
        vol = max(0.0, amount)

        series = self._bars.get(key)
        if series is None:
            series = OrderedDict()
            self._bars[key] = series

        existing = series.get(bucket_sec)
        if existing is None:
            prev_last_k = next(reversed(series)) if series else None
            series[bucket_sec] = [bucket_ms, price, price, price, price, vol]
            # Keep strictly chronological order if an out-of-order older trade arrived
            if prev_last_k is not None and bucket_sec < prev_last_k:
                ordered = OrderedDict(sorted(series.items(), key=lambda kv: kv[0]))
                self._bars[key] = ordered
                series = ordered
        else:
            if price > existing[2]:
                existing[2] = price
            if price < existing[3]:
                existing[3] = price
            existing[4] = price
            existing[5] += vol

        # Enforce in-memory ring-buffer size cap
        while len(series) > self.MAX_RETENTION_SECONDS:
            series.popitem(last=False)

        dirty_set = self._dirty.get(key)
        if dirty_set is None:
            dirty_set = set()
            self._dirty[key] = dirty_set
        dirty_set.add(bucket_sec)

    async def record_trades(self, exchange_id: str, symbol: str, trades: List[Dict[str, Any]]) -> None:
        """Ingests a batch of trades from live streamers and updates 1s candles."""
        if not trades:
            return
        # Prevent 2x double-counted volume when our dedicated Binance Futures aggTrade WS is actively recording this pair
        if self.is_prewarm_active(exchange_id, symbol):
            return
        key = self._make_key(exchange_id, symbol)
        self._last_access[key] = time.time()
        for t in trades:
            if not isinstance(t, dict):
                continue
            raw_ts = t.get("timestamp")
            raw_px = t.get("price")
            if raw_ts is None or raw_px is None:
                continue
            try:
                ts_val = parse_timestamp_ms(raw_ts)
                if ts_val <= 0:
                    continue
                px = float(raw_px)
                amt = float(t.get("amount") or t.get("qty") or 0.0)
            except (TypeError, ValueError):
                continue
            self._upsert_trade_sync(key, ts_val, px, amt)

        self._evict_if_over_cap(key)
        now_mono = time.monotonic()
        if (now_mono - self._last_flush.get(key, 0.0)) >= self.FLUSH_INTERVAL_SEC:
            await self._flush_key_to_redis(key)

    async def seed_1s_candles(self, exchange_id: str, symbol: str, candles: List[List[float]]) -> None:
        """Merges historical 1s [ts_ms, o, h, l, c, v] bars into the recorder without overwriting live bars."""
        if not candles:
            return
        key = self._make_key(exchange_id, symbol)
        series = self._bars.get(key)
        if series is None:
            series = OrderedDict()
            self._bars[key] = series

        dirty_set = self._dirty.setdefault(key, set())
        cutoff_sec = int(time.time()) - self.MAX_RETENTION_SECONDS
        changed = False
        for row in candles:
            if not row or len(row) < 6:
                continue
            ts_ms = parse_timestamp_ms(row[0])
            if ts_ms <= 0:
                continue
            bucket_sec = ts_ms // 1000
            if bucket_sec < cutoff_sec:
                continue
            if bucket_sec not in series:
                series[bucket_sec] = [
                    bucket_sec * 1000,
                    float(row[1]),
                    float(row[2]),
                    float(row[3]),
                    float(row[4]),
                    float(row[5] or 0.0),
                ]
                dirty_set.add(bucket_sec)
                changed = True

        if changed:
            ordered = OrderedDict(sorted(series.items(), key=lambda kv: kv[0]))
            while len(ordered) > self.MAX_RETENTION_SECONDS:
                ordered.popitem(last=False)
            self._bars[key] = ordered
            await self._flush_key_to_redis(key)

    async def _flush_key_to_redis(self, key: str) -> None:
        dirty_buckets = self._dirty.get(key)
        if not dirty_buckets:
            return
        self._last_flush[key] = time.monotonic()
        redis = redis_manager.get_redis()
        if not redis:
            return

        series = self._bars.get(key)
        if not series:
            dirty_buckets.clear()
            return

        # Swap dirty snapshot BEFORE await so concurrent trades during await are never lost
        flushed_buckets = [b for b in dirty_buckets if b in series]
        dirty_buckets.clear()

        mapping: Dict[str, str] = {}
        for b_sec in flushed_buckets:
            bar = series.get(b_sec)
            if bar is not None:
                mapping[str(b_sec)] = json.dumps(bar, separators=(",", ":"))

        if not mapping:
            return

        rkey = self._redis_key(key)
        try:
            async with redis.pipeline(transaction=False) as pipe:
                pipe.hset(rkey, mapping=mapping)
                pipe.expire(rkey, self.REDIS_TTL_SECONDS)
                await pipe.execute()

            # Periodically prune expired fields (> MAX_RETENTION_SECONDS old) from Redis Hash
            now_mono = time.monotonic()
            if (now_mono - self._last_prune.get(key, 0.0)) >= self.PRUNE_INTERVAL_SEC:
                self._last_prune[key] = now_mono
                cutoff_sec = int(time.time()) - self.MAX_RETENTION_SECONDS
                all_fields = await redis.hkeys(rkey)
                stale_fields = []
                for fld in all_fields or []:
                    try:
                        f_str = fld.decode() if isinstance(fld, (bytes, bytearray)) else str(fld)
                        if int(f_str) < cutoff_sec:
                            stale_fields.append(f_str)
                    except ValueError:
                        stale_fields.append(fld)
                if stale_fields:
                    await redis.hdel(rkey, *stale_fields)
        except Exception as e:
            # Restore still-resident bars on Redis error so they retry on next flush
            cur_series = self._bars.get(key)
            if cur_series:
                dirty_buckets.update(b for b in flushed_buckets if b in cur_series)
            logger.debug(f"[SubminuteRecorder] Redis flush error for {key}: {e}")

    async def get_1s_candles(self, exchange_id: str, symbol: str, max_candles: int = 7200) -> List[List[float]]:
        """
        Returns chronologically sorted [ts_ms, o, h, l, c, v] 1s candles from memory,
        hydrating once from Redis Hash if available (survives backend restarts).
        """
        key = self._make_key(exchange_id, symbol)
        self._last_access[key] = time.time()

        # Hydrate from Redis once per process for this symbol with per-key lock so transient errors never lock out hydration
        if key not in self._hydrated_from_redis:
            lock = self._hydrate_locks.setdefault(key, asyncio.Lock())
            async with lock:
                if key not in self._hydrated_from_redis:
                    redis = redis_manager.get_redis()
                    if redis:
                        try:
                            raw_map = await redis.hgetall(self._redis_key(key))
                            if raw_map:
                                series = self._bars.setdefault(key, OrderedDict())
                                cutoff_sec = int(time.time()) - self.MAX_RETENTION_SECONDS
                                for raw_k, raw_v in raw_map.items():
                                    try:
                                        b_sec = int(raw_k.decode() if isinstance(raw_k, (bytes, bytearray)) else str(raw_k))
                                        if b_sec < cutoff_sec or b_sec in series:
                                            continue
                                        val_str = raw_v.decode() if isinstance(raw_v, (bytes, bytearray)) else str(raw_v)
                                        parsed = json.loads(val_str)
                                        if isinstance(parsed, list) and len(parsed) >= 6:
                                            series[b_sec] = [
                                                int(parsed[0]),
                                                float(parsed[1]),
                                                float(parsed[2]),
                                                float(parsed[3]),
                                                float(parsed[4]),
                                                float(parsed[5]),
                                            ]
                                    except Exception:
                                        continue
                                if series:
                                    ordered = OrderedDict(sorted(series.items(), key=lambda kv: kv[0]))
                                    while len(ordered) > self.MAX_RETENTION_SECONDS:
                                        ordered.popitem(last=False)
                                    self._bars[key] = ordered
                            self._hydrated_from_redis.add(key)
                        except Exception as e:
                            logger.debug(f"[SubminuteRecorder] Redis hydrate error for {key}: {e}")

        series = self._bars.get(key)
        if not series:
            return []
        bars = list(series.values())
        return bars[-max_candles:] if max_candles > 0 else bars

    async def _periodic_flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self.FLUSH_INTERVAL_SEC)
                for key in list(self._dirty.keys()):
                    if self._dirty.get(key):
                        await self._flush_key_to_redis(key)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[SubminuteRecorder] Periodic flush loop error: {e}")

    async def _binance_futures_prewarm_loop(self) -> None:
        """
        Single lightweight combined public WebSocket recording 1s candles for the top
        Binance USD-M Perpetual pairs 24/7 (<2 MB RAM, zero REST calls).
        """
        stream_to_sym = {f"{s}@aggTrade": ui_sym for s, ui_sym in self.TOP_FUTURES_PREWARM}
        streams_param = "/".join(stream_to_sym.keys())
        url = f"wss://fstream.binance.com/market/stream?streams={streams_param}"

        backoff = 2.0
        while self._running:
            try:
                timeout = aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.ws_connect(url, heartbeat=20) as ws:
                        self._prewarm_ws_connected = True
                        logger.info(
                            f"🟢 [SubminuteRecorder] Connected to Binance Futures 1s recorder for {len(self.TOP_FUTURES_PREWARM)} top pairs"
                        )
                        backoff = 2.0
                        async for msg in ws:
                            if not self._running:
                                break
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                try:
                                    payload = json.loads(msg.data)
                                    stream_name = payload.get("stream")
                                    data = payload.get("data")
                                    if not stream_name or not isinstance(data, dict):
                                        continue
                                    ui_sym = stream_to_sym.get(stream_name)
                                    if not ui_sym:
                                        continue
                                    px = float(data.get("p") or 0.0)
                                    qty = float(data.get("q") or 0.0)
                                    ts_ms = int(data.get("T") or data.get("E") or int(time.time() * 1000))
                                    if px > 0:
                                        self._upsert_trade_sync(f"binance:{ui_sym}", ts_ms, px, qty)
                                except Exception:
                                    continue
                            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                break
            except asyncio.CancelledError:
                self._prewarm_ws_connected = False
                break
            except Exception as e:
                self._prewarm_ws_connected = False
                logger.warning(f"[SubminuteRecorder] Binance Futures WS reconnecting in {backoff:.0f}s: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 30.0)
            finally:
                self._prewarm_ws_connected = False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        try:
            loop = asyncio.get_running_loop()
            self._flush_task = loop.create_task(self._periodic_flush_loop())
            self._ws_task = loop.create_task(self._binance_futures_prewarm_loop())
            logger.info("🚀 [SubminuteRecorder] Started 1s OHLCV background recorder")
        except RuntimeError:
            self._running = False

    async def stop(self) -> None:
        self._running = False
        for task in (self._ws_task, self._flush_task):
            if task and not task.done():
                task.cancel()
        self._ws_task = None
        self._flush_task = None
        # Final flush of any remaining dirty bars
        for key in list(self._dirty.keys()):
            if self._dirty.get(key):
                await self._flush_key_to_redis(key)
        logger.info("🛑 [SubminuteRecorder] Stopped 1s OHLCV background recorder")


subminute_candle_recorder = SubminuteCandleRecorder()
