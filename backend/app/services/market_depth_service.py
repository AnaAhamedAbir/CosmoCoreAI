import ccxt.pro as ccxt
import json
import logging
import math
import asyncio
from typing import Dict, List, Any, Optional
from app.core.config import settings
from app.core.redis import redis_manager

logger = logging.getLogger(__name__)

class MarketDepthService:
    """
    Service to fetch and aggregate order book data (Market Depth) for visualization.
    Implements caching using Redis to prevent rate limiting.
    """

    EXCHANGE_ALIASES: Dict[str, str] = {
        "gateio": "gate",
        "huobi": "htx",
        "coinbasepro": "coinbase",
    }

    @classmethod
    def normalize_exchange_id(cls, exchange_id: str, symbol: Optional[str] = None) -> tuple[str, str]:
        """Returns (canonical_base_exchange_id, internal_stream_exchange_id)."""
        raw = str(exchange_id or "").strip().lower()
        base = cls.EXCHANGE_ALIASES.get(raw, raw)
        is_futures = bool(symbol and ":" in str(symbol))
        internal = base
        if base == "kucoin" and is_futures:
            internal = "kucoinfutures"
        elif base == "kraken" and is_futures:
            internal = "krakenfutures"
        return base, internal

    @staticmethod
    def _timeframe_to_seconds(timeframe: str) -> int:
        tf = str(timeframe or "").strip()
        if not tf:
            return 60
        unit = tf[-1]
        try:
            value = int(tf[:-1])
        except ValueError:
            return 60
        if value <= 0:
            return 60
        if unit == "s":
            return value
        if unit == "m":
            return value * 60
        if unit == "h":
            return value * 3600
        if unit == "d":
            return value * 86400
        if unit == "w":
            return value * 604800
        if unit == "M":
            return value * 2592000
        return value * 60

    @staticmethod
    def _resample_ohlcv(candles: List[List[float]], target_ms: int) -> List[List[float]]:
        """Aggregates chronologically sorted [ts_ms, o, h, l, c, v] rows into target_ms buckets."""
        if not candles or target_ms <= 0:
            return []
        buckets: Dict[int, List[float]] = {}
        for row in sorted(candles, key=lambda x: x[0]):
            if not row or len(row) < 6:
                continue
            ts = int(row[0])
            bucket_ts = (ts // target_ms) * target_ms
            o, h, l, c, v = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5] or 0.0)
            existing = buckets.get(bucket_ts)
            if existing is None:
                buckets[bucket_ts] = [bucket_ts, o, h, l, c, v]
            else:
                if h > existing[2]:
                    existing[2] = h
                if l < existing[3]:
                    existing[3] = l
                existing[4] = c
                existing[5] += v
        return [buckets[k] for k in sorted(buckets.keys())]

    @staticmethod
    def _aggregate_trades_to_ohlcv(trades: List[Dict[str, Any]], target_ms: int, limit: int) -> List[List[float]]:
        """Synthesizes [ts_ms, o, h, l, c, v] candles from raw trade ticks."""
        if not trades or target_ms <= 0:
            return []

        dedup: Dict[str, tuple[int, float, float]] = {}
        for idx, t in enumerate(trades):
            if not isinstance(t, dict):
                continue
            raw_ts = t.get("timestamp")
            price = t.get("price")
            if raw_ts is None or price is None:
                continue
            try:
                ts_val = int(float(raw_ts))
                if ts_val < 10_000_000_000:
                    ts_val *= 1000
                px = float(price)
                amt = float(t.get("amount") or t.get("qty") or 0.0)
            except (TypeError, ValueError):
                continue
            if px <= 0:
                continue
            tid = t.get("id")
            key = f"id:{tid}" if tid is not None else f"ts:{ts_val}:{px}:{amt}:{idx}"
            dedup[key] = (ts_val, px, max(0.0, amt))

        if not dedup:
            return []

        sorted_trades = sorted(dedup.values(), key=lambda x: x[0])
        buckets: Dict[int, List[float]] = {}
        for ts_val, px, amt in sorted_trades:
            bucket_ts = (ts_val // target_ms) * target_ms
            existing = buckets.get(bucket_ts)
            if existing is None:
                buckets[bucket_ts] = [bucket_ts, px, px, px, px, amt]
            else:
                if px > existing[2]:
                    existing[2] = px
                if px < existing[3]:
                    existing[3] = px
                existing[4] = px
                existing[5] += amt

        ordered = [buckets[k] for k in sorted(buckets.keys())]
        return ordered[-limit:] if limit > 0 else ordered

    @classmethod
    def _find_resample_source_tf(cls, supported_tfs: Dict[str, Any], target_tf: str) -> Optional[str]:
        """Finds the largest native timeframe strictly smaller than target_tf that can cleanly resample into target_tf."""
        target_sec = cls._timeframe_to_seconds(target_tf)
        best_tf: Optional[str] = None
        best_sec = 0
        for tf in supported_tfs.keys():
            sec = cls._timeframe_to_seconds(tf)
            if sec <= 0 or sec >= target_sec:
                continue
            # Allow exact divisibility, or daily -> monthly approximation
            if (target_sec % sec == 0) or (target_tf == "1M" and tf == "1d"):
                if sec > best_sec:
                    best_sec = sec
                    best_tf = tf
        return best_tf

    def __init__(self):
        self._exchanges: Dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._ohlcv_locks: Dict[str, asyncio.Lock] = {}
        self._ob_locks: Dict[str, asyncio.Lock] = {}

    def _get_ohlcv_lock(self, exchange_id: str, symbol: str, timeframe: str) -> asyncio.Lock:
        key = f"{exchange_id}_{symbol}_{timeframe}"
        if key not in self._ohlcv_locks:
            self._ohlcv_locks[key] = asyncio.Lock()
        return self._ohlcv_locks[key]

    def _get_ob_lock(self, exchange_id: str, symbol: str) -> asyncio.Lock:
        key = f"{exchange_id}_{symbol}"
        if key not in self._ob_locks:
            self._ob_locks[key] = asyncio.Lock()
        return self._ob_locks[key]

    async def get_exchange_instance(self, exchange_id: str, symbol: Optional[str] = None):
        base_exchange_id, internal_id = self.normalize_exchange_id(exchange_id, symbol)
        is_futures = bool(symbol and ':' in symbol)

        if base_exchange_id == 'binance' and is_futures:
            cache_id = 'binance_futures'
        elif internal_id in ('kucoinfutures', 'krakenfutures'):
            cache_id = internal_id
        else:
            cache_id = base_exchange_id

        async with self._lock:
            if cache_id not in self._exchanges:
                # For Kucoin/Kraken Futures, use the dedicated class
                real_class_id = cache_id if cache_id in ('kucoinfutures', 'krakenfutures') else base_exchange_id
                logger.info(f"Creating exchange instance for {cache_id} (class: {real_class_id})")
                exchange_class = getattr(ccxt, real_class_id, None)
                
                if not exchange_class:
                    logger.error(f"Exchange class '{real_class_id}' not found in CCXT async_support.")
                    raise ValueError(f"Exchange '{real_class_id}' not supported.")
                
                options: Dict[str, Any] = {
                    'enableRateLimit': True,
                    'options': {'adjustForTimeDifference': True}
                }
                
                if cache_id == 'binance_futures':
                    options['options']['defaultType'] = 'swap'  # 'swap' = USDⓈ-M (fapi.binance.com); 'future' = COIN-M (dapi.binance.com)
                    
                exchange = exchange_class(options)
                
                # ⚡ Copy pre-warmed markets from ccxt_service off-loop if available (0ms event-loop stall)
                try:
                    from app.services.ccxt_service import ccxt_service
                    from app.services.exchange_pool import apply_prewarmed_markets_off_loop
                    prewarmed = None
                    if cache_id == 'binance':
                        prewarmed = ccxt_service._market_cache.get('binance_spot')
                    elif cache_id == 'binance_futures':
                        prewarmed = ccxt_service._market_cache.get('binance_swap')

                    if prewarmed and hasattr(exchange, 'set_markets'):
                        cnt = await apply_prewarmed_markets_off_loop(
                            exchange,
                            prewarmed,
                            is_futures=(cache_id == 'binance_futures'),
                        )
                        logger.info(f"⚡ [MarketDepth] Copied {cnt} pre-warmed markets to {cache_id} (off-loop)")
                except Exception as cp_err:
                    logger.debug(f"[MarketDepth] Pre-warmed copy skipped for {cache_id}: {cp_err}")

                if not getattr(exchange, 'markets', None):
                    try:
                        logger.info(f"Loading markets for {cache_id} at initialization...")
                        await exchange.load_markets()
                    except Exception as e:
                        logger.warning(f"Failed to load markets for {cache_id} during initialization: {e}")
                    
                self._exchanges[cache_id] = exchange
                
        return self._exchanges[cache_id]

    async def close_all_exchanges(self):
        for exchange in self._exchanges.values():
            await exchange.close()
        self._exchanges.clear()

    def _normalize_order_book_limit(self, exchange_id: str, limit: int) -> int:
        """
        Normalizes the order book limit based on exchange-specific requirements.
        """
        exchange_id = str(exchange_id or "").lower()
        
        if 'kucoin' in exchange_id:
            # Kucoin / Kucoin Futures supports: 20 or 100
            return 20 if limit <= 20 else 100
        
        if 'binance' in exchange_id:
            # Binance supports: 5, 10, 20, 50, 100, 500, 1000 (futures up to 1000)
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            elif limit <= 50: return 50
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000

        if 'kraken' in exchange_id:
            # Kraken / Kraken Futures supports: 10, 25, 100, 500, 1000
            if limit <= 10: return 10
            elif limit <= 25: return 25
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000
        
        if 'htx' in exchange_id:
            # HTX supports: 5, 10, 20, 150
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            else: return 150

        if 'bitfinex' in exchange_id:
            return 25 if limit <= 25 else 100
            
        return limit

    async def fetch_order_book_heatmap(
        self, 
        symbol: str, 
        exchange_id: str = 'binance', 
        depth: int = 100, 
        bucket_size: float = 50.0
    ) -> Dict[str, Any]:
        """
        Fetches the order book and aggregates it into price buckets.
        """
        # normalize inputs
        symbol = str(symbol or "").strip().upper()
        base_ex, internal_ex = self.normalize_exchange_id(exchange_id, symbol)
        
        # 1. Check Cache
        cache_key = f"market_depth_heatmap:{internal_ex}:{symbol}:{bucket_size}:{depth}"
        redis = redis_manager.get_redis()
        
        lock = self._get_ob_lock(internal_ex, symbol)
        async with lock:
            if redis:
                cached_data = await redis.get(cache_key)
                if cached_data:
                    return json.loads(cached_data)

            # 1.5 Try Live Streamer Cache First (normalized for KuCoin/Kraken Futures & OANDA)
            order_book = None
            if redis:
                ob_sym = symbol.replace("/", "_") if base_ex == "oanda" else symbol
                live_ob = await redis.get(f"latest_orderbook:{internal_ex}:{ob_sym}")
                if live_ob:
                    live_data = json.loads(live_ob)
                    bids = [[b["price"], b["size"]] for b in live_data.get("bids", [])]
                    asks = [[a["price"], a["size"]] for a in live_data.get("asks", [])]
                    order_book = {"bids": bids, "asks": asks}

            # 2. Fetch Live Data if cache missing
            if base_ex == 'oanda':
                if not order_book:
                    return {"symbol": symbol, "exchange": base_ex, "current_price": 0, "bids": [], "asks": []}
            else:
                exchange = await self.get_exchange_instance(base_ex, symbol)
            
            try:
                # Normalize limit for different exchanges
                depth = self._normalize_order_book_limit(internal_ex, depth)
                    
                # Fetch Order Book
                if not order_book:
                    # ✅ Bypass REST API for Binance to prevent rate limits
                    if base_ex == 'binance':
                        logger.info(f"Bypassing Binance REST API for {symbol} to prevent rate limits. Relying on WebSocket stream cache.")
                        return {"symbol": symbol, "exchange": base_ex, "current_price": 0, "bids": [], "asks": []}
                        
                    order_book = await exchange.fetch_order_book(symbol, limit=depth)
                
                # Use mid price from order book
                current_price = 0.0
                if order_book.get('asks') and order_book.get('bids'):
                    current_price = (order_book['asks'][0][0] + order_book['bids'][0][0]) / 2.0

                # 3. Aggregate Data
                aggregated_bids = self._aggregate_orders(order_book['bids'][:depth], bucket_size, is_bid=True)
                aggregated_asks = self._aggregate_orders(order_book['asks'][:depth], bucket_size, is_bid=False)
                
                result = {
                    "symbol": symbol,
                    "exchange": base_ex,
                    "current_price": current_price,
                    "bids": aggregated_bids,
                    "asks": aggregated_asks
                }

                # 4. Cache Result (5 seconds TTL)
                if redis:
                    await redis.setex(cache_key, 5, json.dumps(result))

                return result

            except Exception as e:
                logger.error(f"Error fetching market depth for {symbol} on {base_ex}: {e}")
                raise e

    def _aggregate_orders(self, orders: List[List[float]], bucket_size: float, is_bid: bool) -> List[Dict[str, float]]:
        """
        Groups orders into price buckets.
        
        Args:
            orders: List of [price, amount]
            bucket_size: Size of each price bucket
            is_bid: True if aggregating bids (round down), False for asks (round up)
            
        Returns:
            List of dictionaries with 'price' (bucket) and 'volume' (sum).
        """
        buckets = {}
        
        for level in orders:
            price, amount = level[0], level[1]
            if bucket_size > 0:
                # Group both bids and asks into uniform buckets to avoid artificial spreads
                # Floor division ensures everything snaps to the same grid
                bucket_price = math.floor(price / bucket_size) * bucket_size
            else:
                bucket_price = price
                
            # Avoid float precision issues for keys, using 8 decimals for altcoins
            bucket_price = round(bucket_price, 8)
            
            if bucket_price not in buckets:
                buckets[bucket_price] = 0.0
            buckets[bucket_price] += amount

        # Convert to list and sort
        sorted_buckets = [
            {"price": price, "volume": volume} 
            for price, volume in buckets.items()
        ]
        
        # Sort bids descending (highest price first), asks ascending (lowest price first)
        sorted_buckets.sort(key=lambda x: x['price'], reverse=is_bid)
        
        return sorted_buckets

    async def get_available_exchanges(self) -> List[str]:
        """
        Returns a list of all exchanges supported by CCXT + OANDA.
        """
        popular = ['binance', 'kraken', 'coinbase', 'kucoin', 'bybit', 'okx', 'bitfinex', 'gate', 'htx', 'mexc', 'oanda']
        return popular

    @staticmethod
    def _extract_active_symbols(markets: Optional[Dict[str, Any]]) -> List[str]:
        if not isinstance(markets, dict):
            return []
        return [sym for sym, meta in markets.items() if isinstance(meta, dict) and meta.get('active', True)]

    async def get_exchange_markets(self, exchange_id: str) -> List[str]:
        """
        Returns a list of active symbols for a given exchange.
        For Binance, KuCoin, and Kraken, it merges both Spot and Futures markets.
        For OANDA, it uses the OANDA REST API to fetch currency pairs.
        """
        base_ex, _ = self.normalize_exchange_id(exchange_id)
        cache_key = f"markets:{base_ex}"
        redis = redis_manager.get_redis()
        
        if redis:
            cached = await redis.get(cache_key)
            if cached:
                return json.loads(cached)

        symbols: List[str] = []
        try:
            logger.info(f"Fetching markets for {base_ex}...")
            
            if base_ex == 'oanda':
                import requests
                import os
                
                account_id = os.getenv("OANDA_ACCOUNT_ID")
                api_key = os.getenv("OANDA_API_KEY")
                
                if account_id and api_key:
                    url = f"https://api-fxpractice.oanda.com/v3/accounts/{account_id}/instruments"
                    headers = {"Authorization": f"Bearer {api_key}"}
                    try:
                        response = await asyncio.to_thread(requests.get, url, headers=headers, timeout=5)
                        response.raise_for_status()
                        data = response.json()
                        for inst in data.get("instruments", []):
                            if inst.get("type") == "CURRENCY":
                                # OANDA pairs are returned as EUR_USD. Return as EUR/USD for UI consistency.
                                symbols.append(inst["name"].replace("_", "/"))
                    except Exception as e:
                        logger.error(f"Failed to fetch OANDA markets: {e}")
                
                if not symbols:
                    # Fallback
                    symbols = ["EUR/USD", "GBP/USD", "USD/JPY"]
                    
                symbols = sorted(symbols)
            else:
                # ⚡ Check ccxt_service memory cache first for 0ms instant response
                if base_ex == 'binance':
                    try:
                        from app.services.ccxt_service import ccxt_service
                        spot_cache = ccxt_service._market_cache.get('binance_spot')
                        swap_cache = ccxt_service._market_cache.get('binance_swap')
                        if spot_cache and swap_cache:
                            symbols = sorted(list(set(
                                self._extract_active_symbols(spot_cache)
                                + self._extract_active_symbols(swap_cache)
                            )))
                            logger.info(f"⚡ [MarketDepth] Served {len(symbols)} active Binance markets directly from memory cache (0ms)")
                            if redis:
                                await redis.setex(cache_key, 3600, json.dumps(symbols))
                            return symbols
                    except Exception as mem_e:
                        logger.debug(f"[MarketDepth] Memory cache lookup fallback: {mem_e}")

                # 1. Fetch Spot Markets (without redundant reload)
                spot_exchange = await self.get_exchange_instance(base_ex)
                spot_markets = spot_exchange.markets if getattr(spot_exchange, 'markets', None) else await spot_exchange.load_markets()
                symbols.extend(self._extract_active_symbols(spot_markets))
                logger.info(f"Fetched {len(spot_markets)} spot markets for {base_ex}")

                # 2. Fetch Futures Markets (without redundant reload)
                if base_ex == 'binance':
                    logger.info("Fetching Binance Futures markets...")
                    futures_exchange = await self.get_exchange_instance('binance', symbol='BTC/USDT:USDT')
                    futures_markets = futures_exchange.markets if getattr(futures_exchange, 'markets', None) else await futures_exchange.load_markets()
                    symbols.extend(self._extract_active_symbols(futures_markets))
                    logger.info(f"Fetched {len(futures_markets)} Binance futures markets")
                elif base_ex == 'kucoin':
                    logger.info("Fetching Kucoin Futures markets...")
                    futures_exchange = await self.get_exchange_instance('kucoin', symbol='BTC/USDT:USDT')
                    futures_markets = futures_exchange.markets if getattr(futures_exchange, 'markets', None) else await futures_exchange.load_markets()
                    symbols.extend(self._extract_active_symbols(futures_markets))
                    logger.info(f"Fetched {len(futures_markets)} Kucoin futures markets")
                elif base_ex == 'kraken':
                    logger.info("Fetching Kraken Futures markets...")
                    try:
                        futures_exchange = await self.get_exchange_instance('kraken', symbol='BTC/USDT:USDT')
                        futures_markets = futures_exchange.markets if getattr(futures_exchange, 'markets', None) else await futures_exchange.load_markets()
                        symbols.extend(self._extract_active_symbols(futures_markets))
                        logger.info(f"Fetched {len(futures_markets)} Kraken futures markets")
                    except Exception as e:
                        logger.error(f"Error fetching Kraken futures markets. It might be due to API accessibility or CCXT version: {e}")
                
                # Remove duplicates and sort
                symbols = sorted(list(set(symbols)))
            
            logger.info(f"Total merged active markets for {base_ex}: {len(symbols)}")

            # Cache for 1 hour as markets don't change often
            if redis:
                await redis.setex(cache_key, 3600, json.dumps(symbols))
            return symbols
        except Exception as e:
            logger.error(f"Error loading markets for {base_ex}: {e}")
            raise e

    async def _fetch_native_ohlcv(
        self,
        exchange: Any,
        symbol: str,
        timeframe: str,
        fetch_limit: int,
    ) -> List[List[float]]:
        """
        Fetches native OHLCV candles from CCXT.
        For >1000 candles (e.g. 5,000 Binance Spot 1s candles for 5s/15s/30s resampling),
        uses bounded parallel batching via asyncio.gather (~300ms instead of sequential multi-second stalls).
        """
        import time as _time

        BATCH_SIZE = 1000
        all_ohlcv: List[List[float]] = []

        if fetch_limit <= BATCH_SIZE:
            all_ohlcv = await exchange.fetch_ohlcv(symbol, timeframe, limit=fetch_limit)
        else:
            tf_ms: int = self._timeframe_to_seconds(timeframe) * 1000
            now_ms: int = int(_time.time() * 1000)
            since_ms: int = now_ms - (fetch_limit * tf_ms)

            # Build non-overlapping time windows (up to 5 parallel batches = 5,000 candles)
            batch_specs: List[tuple[int, int]] = []
            cursor = since_ms
            remaining = fetch_limit
            while remaining > 0 and len(batch_specs) < 5:
                batch = min(remaining, BATCH_SIZE)
                batch_specs.append((cursor, batch))
                cursor += batch * tf_ms
                remaining -= batch

            async def _fetch_chunk(start_ms: int, lim: int) -> List[List[float]]:
                try:
                    return await exchange.fetch_ohlcv(symbol, timeframe, since=start_ms, limit=lim) or []
                except Exception as chunk_err:
                    logger.debug(f"[OHLCV] Parallel chunk fetch skipped ({symbol} {timeframe} since={start_ms}): {chunk_err}")
                    return []

            chunks = await asyncio.gather(*[_fetch_chunk(s, b) for s, b in batch_specs])
            for chunk in chunks:
                if chunk:
                    all_ohlcv.extend(chunk)

        seen: Dict[int, List[float]] = {}
        for candle in all_ohlcv:
            if candle and len(candle) >= 6:
                seen[int(candle[0])] = candle
        return sorted(seen.values(), key=lambda x: x[0])

    async def _fetch_subminute_from_trades(
        self,
        exchange: Any,
        base_ex: str,
        internal_ex: str,
        symbol: str,
        target_sec: int,
        limit: int,
        redis: Any,
    ) -> List[List[float]]:
        """
        Builds deep 1s/5s/15s/30s OHLCV history for venues/markets without sub-minute REST klines
        (Binance Futures, Bybit, OKX, KuCoin, Kraken, Coinbase, Gate, Bitfinex, HTX, MEXC):
        1. First reads 24/7 recorded 1s candles from SubminuteCandleRecorder (in-memory + Redis Hash, <5ms, 0 REST calls).
        2. When recorded history is cold/short, supplements with Redis `recent_trades` + public `fetch_trades`
           (with up to 5 backward `fromId` pages on Binance Futures = up to 6,000 aggTrades),
           merges into 1s bars, seeds the recorder for future instant reads, and resamples into `target_sec`.
        """
        from app.services.subminute_candle_recorder import subminute_candle_recorder

        target_ms = target_sec * 1000
        recorded_1s = await subminute_candle_recorder.get_1s_candles(internal_ex, symbol)

        # Target candle threshold above which recorded 1s history is already rich enough to skip REST calls
        sufficient_target_candles = min(limit, 300 if target_sec <= 5 else (180 if target_sec <= 15 else 100))
        if recorded_1s:
            resampled_rec = recorded_1s if target_sec == 1 else self._resample_ohlcv(recorded_1s, target_ms)
            if len(resampled_rec) >= sufficient_target_candles:
                return resampled_rec[-limit:]

        # Cold or partial recorder: supplement with Redis recent_trades + public REST trades
        trades: List[Dict[str, Any]] = []
        if redis:
            try:
                raw_cached = await redis.lrange(f"recent_trades:{internal_ex}:{symbol}", -1000, -1)
                for item in raw_cached or []:
                    try:
                        parsed = json.loads(item)
                        if isinstance(parsed, dict):
                            trades.append(parsed)
                    except Exception:
                        continue
            except Exception as redis_err:
                logger.debug(f"[OHLCV] Redis recent_trades read skipped for {internal_ex}:{symbol}: {redis_err}")

        desired_span_ms = min(max(target_sec * 45, 90), 900) * 1000
        cached_timestamps = [
            int(float(t["timestamp"])) * (1000 if int(float(t["timestamp"])) < 10_000_000_000 else 1)
            for t in trades
            if t.get("timestamp") is not None
        ]
        cached_span_ms = (max(cached_timestamps) - min(cached_timestamps)) if len(cached_timestamps) >= 2 else 0

        if len(trades) < 300 or cached_span_ms < desired_span_ms:
            try:
                if internal_ex == 'krakenfutures' or base_ex == 'okx':
                    rest_limit = 100
                elif base_ex in ('binance', 'bybit', 'coinbase', 'gate', 'htx', 'bitfinex', 'mexc'):
                    rest_limit = 1000
                else:
                    rest_limit = 500
                rest_trades = await exchange.fetch_trades(symbol, limit=rest_limit)
                if rest_trades:
                    trades.extend(rest_trades)

                    # On cold-start Binance Futures pairs, fetch up to 5 backward aggTrade pages (6,000 trades)
                    # so even immediately after server boot users see deep sub-minute history.
                    if base_ex == 'binance' and ':' in symbol:
                        try:
                            cur_batch = rest_trades
                            max_pages = 5 if len(recorded_1s) < 120 else 2
                            for _ in range(max_pages):
                                ts_list = [
                                    int(float(t["timestamp"])) * (1000 if int(float(t["timestamp"])) < 10_000_000_000 else 1)
                                    for t in trades
                                    if t.get("timestamp") is not None
                                ]
                                if len(ts_list) >= 2 and (max(ts_list) - min(ts_list)) >= desired_span_ms:
                                    break
                                ids = []
                                for t in cur_batch:
                                    try:
                                        ids.append(int(t["id"]))
                                    except (KeyError, TypeError, ValueError):
                                        pass
                                if not ids:
                                    break
                                min_id = min(ids)
                                if min_id <= 1:
                                    break
                                from_id = max(1, min_id - rest_limit)
                                older = await exchange.fetch_trades(
                                    symbol,
                                    limit=rest_limit,
                                    params={"fromId": from_id},
                                )
                                if not older:
                                    break
                                trades.extend(older)
                                cur_batch = older
                        except Exception as page_err:
                            logger.debug(f"[OHLCV] Backward aggTrades pagination skipped for {symbol}: {page_err}")
            except Exception as trade_err:
                logger.warning(f"[OHLCV] Trade synthesis REST fallback failed for {base_ex}:{symbol}: {trade_err}")

        # Build 1s bars from trades, merge with recorded 1s bars, and seed recorder so subsequent reads are 0ms
        trade_1s = self._aggregate_trades_to_ohlcv(trades, target_ms=1000, limit=7200) if trades else []
        if trade_1s:
            await subminute_candle_recorder.seed_1s_candles(internal_ex, symbol, trade_1s)

        merged_1s_map: Dict[int, List[float]] = {}
        for row in trade_1s:
            merged_1s_map[int(row[0])] = row
        # Prefer continuously recorded live 1s bars where timestamps overlap
        for row in recorded_1s:
            merged_1s_map[int(row[0])] = row

        merged_1s = [merged_1s_map[k] for k in sorted(merged_1s_map.keys())]
        if not merged_1s:
            return []

        if target_sec == 1:
            return merged_1s[-limit:]
        return self._resample_ohlcv(merged_1s, target_ms)[-limit:]

    async def fetch_ohlcv(self, symbol: str, exchange_id: str, timeframe: str = '1h', limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetches OHLCV data for a symbol with:
        - Exchange alias & futures normalization (gateio -> gate, kucoin/kraken futures)
        - Native klines when supported
        - Automatic resampling from smaller native timeframes (e.g. 1s -> 5s/15s/30s on Binance Spot,
          15m -> 45m, 1m -> 3m, 1h -> 2h/4h/6h/12h on exchanges lacking those intervals)
        - Trade-tick OHLCV synthesis for 1s-30s on Binance Futures and non-Binance crypto exchanges
        - OANDA native S5/S15/S30 & resampled 3m/45m support
        - Exhaustion-aware Redis caching (fixes repeated cache misses when exchange returns < limit)
        """
        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "1h").strip()
        base_ex, internal_ex = self.normalize_exchange_id(exchange_id, symbol)

        # Hard cap to avoid accidental abuse or server overload
        limit = max(1, min(int(limit or 100), 2000))
        fetch_limit = limit
        target_sec = self._timeframe_to_seconds(timeframe)
        target_ms = target_sec * 1000

        # Unified normalized cache key
        cache_key = f"ohlcv:{internal_ex}:{symbol}:{timeframe}"
        redis = redis_manager.get_redis()

        lock = self._get_ohlcv_lock(internal_ex, symbol, timeframe)
        async with lock:
            if redis:
                cached = await redis.get(cache_key)
                if cached:
                    parsed_cache = json.loads(cached)
                    if isinstance(parsed_cache, dict) and "candles" in parsed_cache:
                        cached_data = parsed_cache.get("candles") or []
                        exhausted = bool(parsed_cache.get("exhausted", False))
                    else:
                        cached_data = parsed_cache if isinstance(parsed_cache, list) else []
                        exhausted = False
                    # Serve from cache if we have enough candles OR the source already returned all available candles
                    if len(cached_data) >= limit or exhausted:
                        return cached_data[-limit:]

            if base_ex == 'oanda':
                import requests
                import os
                from datetime import datetime

                # OANDA v3 official granularities (note: S5/S15/S30 are native; 3m & 45m are resampled)
                oanda_native_map = {
                    '5s': 'S5', '15s': 'S15', '30s': 'S30',
                    '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
                    '1h': 'H1', '2h': 'H2', '4h': 'H4', '6h': 'H6', '12h': 'H12',
                    '1d': 'D', '1w': 'W', '1M': 'M',
                }
                oanda_resample_map = {
                    '3m': ('M1', 3),
                    '45m': ('M15', 3),
                }

                # OANDA does not offer 1s REST candles; serve recorded 1s live bars from SubminuteCandleRecorder
                if timeframe == '1s':
                    from app.services.subminute_candle_recorder import subminute_candle_recorder
                    rec_oanda_1s = await subminute_candle_recorder.get_1s_candles("oanda", symbol, max_candles=limit)
                    return [
                        {
                            "time": int(r[0] / 1000),
                            "open": float(r[1]),
                            "high": float(r[2]),
                            "low": float(r[3]),
                            "close": float(r[4]),
                            "volume": float(r[5]),
                        }
                        for r in rec_oanda_1s
                    ]

                resample_factor = 1
                if timeframe in oanda_native_map:
                    oanda_tf = oanda_native_map[timeframe]
                elif timeframe in oanda_resample_map:
                    oanda_tf, resample_factor = oanda_resample_map[timeframe]
                else:
                    oanda_tf = 'H1'

                oanda_symbol = symbol.replace("/", "_")
                oanda_count = min(limit * resample_factor, 2000)

                account_id = os.getenv("OANDA_ACCOUNT_ID")
                api_key = os.getenv("OANDA_API_KEY")

                formatted_data: List[Dict[str, Any]] = []
                fetch_success = False

                if account_id and api_key:
                    url = f"https://api-fxpractice.oanda.com/v3/instruments/{oanda_symbol}/candles?count={oanda_count}&granularity={oanda_tf}&price=M"
                    headers = {"Authorization": f"Bearer {api_key}"}
                    try:
                        response = await asyncio.to_thread(requests.get, url, headers=headers, timeout=5)
                        response.raise_for_status()
                        data = response.json()
                        candles = data.get("candles", [])
                        raw_oanda: List[List[float]] = []
                        for c in candles:
                            dt = datetime.fromisoformat(c["time"].replace('Z', '+00:00'))
                            raw_oanda.append([
                                int(dt.timestamp() * 1000),
                                float(c["mid"]["o"]),
                                float(c["mid"]["h"]),
                                float(c["mid"]["l"]),
                                float(c["mid"]["c"]),
                                float(c["volume"]),
                            ])
                        if resample_factor > 1 and raw_oanda:
                            raw_oanda = self._resample_ohlcv(raw_oanda, target_ms)
                        formatted_data = [
                            {
                                "time": int(r[0] / 1000),
                                "open": r[1],
                                "high": r[2],
                                "low": r[3],
                                "close": r[4],
                                "volume": int(r[5]),
                            }
                            for r in raw_oanda[-limit:]
                        ]
                        fetch_success = len(formatted_data) > 0
                    except Exception as e:
                        logger.error(f"OANDA API failed for {symbol} ({timeframe}): {e}. Falling back to yfinance.")

                if not fetch_success:
                    # yfinance does not support sub-minute intervals; return empty gracefully instead of fake 1h bars
                    if target_sec < 60:
                        return []
                    try:
                        import yfinance as yf
                        logger.info(f"Using yfinance fallback for {symbol} ({timeframe})")
                        yf_symbol = f"{symbol.replace('/', '').replace('_', '')}=X"
                        yf_tf_map = {
                            '1m': ('1m', '7d', 1),
                            '3m': ('1m', '7d', 3),
                            '5m': ('5m', '1mo', 1),
                            '15m': ('15m', '1mo', 1),
                            '30m': ('30m', '1mo', 1),
                            '45m': ('15m', '1mo', 3),
                            '1h': ('1h', '3mo', 1),
                            '2h': ('1h', '6mo', 2),
                            '4h': ('1h', '6mo', 4),
                            '6h': ('1h', '6mo', 6),
                            '12h': ('1h', '6mo', 12),
                            '1d': ('1d', '2y', 1),
                            '1w': ('1wk', '5y', 1),
                            '1M': ('1mo', '10y', 1),
                        }
                        yf_tf, period, yf_factor = yf_tf_map.get(timeframe, ('1h', '1mo', 1))
                        ticker = yf.Ticker(yf_symbol)
                        df = await asyncio.to_thread(ticker.history, period=period, interval=yf_tf)
                        if not df.empty:
                            raw_yf: List[List[float]] = [
                                [
                                    int(index.timestamp() * 1000),
                                    float(row['Open']),
                                    float(row['High']),
                                    float(row['Low']),
                                    float(row['Close']),
                                    float(row['Volume']),
                                ]
                                for index, row in df.iterrows()
                            ]
                            if yf_factor > 1:
                                raw_yf = self._resample_ohlcv(raw_yf, target_ms)
                            formatted_data = [
                                {
                                    "time": int(r[0] / 1000),
                                    "open": r[1],
                                    "high": r[2],
                                    "low": r[3],
                                    "close": r[4],
                                    "volume": r[5],
                                }
                                for r in raw_yf[-limit:]
                            ]
                    except Exception as e:
                        logger.error(f"yfinance fallback failed for {symbol}: {e}")
                        raise e

                from app.helpers.candlestick_patterns import attach_candlestick_patterns
                formatted_data = attach_candlestick_patterns(formatted_data)

                if redis and formatted_data:
                    oanda_ttl = 2 if target_sec <= 5 else (5 if target_sec < 60 else 60)
                    cache_payload = {"candles": formatted_data, "exhausted": len(formatted_data) < limit}
                    await redis.setex(cache_key, oanda_ttl, json.dumps(cache_payload))

                return formatted_data

            exchange = await self.get_exchange_instance(base_ex, symbol)

            try:
                supported_tfs = dict(getattr(exchange, 'timeframes', None) or {})
                # Binance USD-M / COIN-M Futures REST API does NOT support '1s' klines (only Spot does)
                if base_ex == 'binance' and ':' in symbol:
                    supported_tfs.pop('1s', None)

                all_ohlcv: List[List[float]] = []

                if timeframe in supported_tfs:
                    # ── Tier 1: Native exchange klines ─────────────────────────────
                    all_ohlcv = await self._fetch_native_ohlcv(exchange, symbol, timeframe, fetch_limit)
                else:
                    # ── Tier 2: Resample from a smaller native timeframe ───────────
                    # e.g., Binance Spot 1s -> 5s/15s/30s (up to 5,000 parallel 1s bars = 1000 5s / 333 15s / 166 30s);
                    # Any exchange 15m -> 45m, 1m -> 3m, 1h -> 2h/4h/6h/12h
                    source_tf = self._find_resample_source_tf(supported_tfs, timeframe)
                    if source_tf:
                        src_sec = self._timeframe_to_seconds(source_tf)
                        factor = max(1, target_sec // src_sec)
                        max_src_cap = 5000 if src_sec < 60 else 2000
                        src_limit = min(max(fetch_limit * factor, 200), max_src_cap)
                        logger.info(
                            f"[OHLCV] Resampling {base_ex}:{symbol} {timeframe} from native {source_tf} (src_limit={src_limit})"
                        )
                        raw_src = await self._fetch_native_ohlcv(exchange, symbol, source_tf, src_limit)
                        # Also merge any live 1s bars recorded in memory/Redis for sub-minute accuracy
                        if src_sec == 1:
                            from app.services.subminute_candle_recorder import subminute_candle_recorder
                            rec_spot_1s = await subminute_candle_recorder.get_1s_candles(internal_ex, symbol)
                            if rec_spot_1s:
                                merged_map = {int(r[0]): r for r in raw_src}
                                for r in rec_spot_1s:
                                    merged_map[int(r[0])] = r
                                raw_src = [merged_map[k] for k in sorted(merged_map.keys())]
                        all_ohlcv = self._resample_ohlcv(raw_src, target_ms)[-fetch_limit:]
                    elif target_sec < 60:
                        # ── Tier 3: Sub-minute trade-tick OHLCV synthesis ──────────
                        # Works for 1s, 5s, 15s, 30s on Binance Futures & all non-Binance crypto exchanges
                        logger.info(
                            f"[OHLCV] Synthesizing sub-minute {timeframe} candles from trades for {internal_ex}:{symbol}"
                        )
                        all_ohlcv = await self._fetch_subminute_from_trades(
                            exchange=exchange,
                            base_ex=base_ex,
                            internal_ex=internal_ex,
                            symbol=symbol,
                            target_sec=target_sec,
                            limit=fetch_limit,
                            redis=redis,
                        )
                    else:
                        raise ValueError(
                            f"Timeframe '{timeframe}' is not supported by {base_ex} and no smaller native timeframe is available."
                        )

                # ── Format for Lightweight Charts ──────────────────────────────
                formatted_data = [
                    {
                        "time":   int(c[0] / 1000),  # ms → seconds
                        "open":   float(c[1]),
                        "high":   float(c[2]),
                        "low":    float(c[3]),
                        "close":  float(c[4]),
                        "volume": float(c[5]),
                    }
                    for c in all_ohlcv
                ]

                # Decorate with candlestick pattern analysis
                from app.helpers.candlestick_patterns import attach_candlestick_patterns
                formatted_data = attach_candlestick_patterns(formatted_data)

                # ── Dynamic cache TTL based on timeframe ───────────────────────
                tf_ttl_map = {
                    '1s': 1, '5s': 2, '15s': 5, '30s': 5,
                    '1m': 30, '3m': 60, '5m': 120, '15m': 300,
                    '30m': 600, '45m': 600, '1h': 1800,
                    '2h': 3600, '4h': 7200, '6h': 10800, '12h': 21600,
                    '1d': 43200, '1w': 86400, '1M': 86400,
                }
                cache_ttl = tf_ttl_map.get(timeframe, 60)

                if redis and formatted_data:
                    cache_payload = {
                        "candles": formatted_data,
                        "exhausted": len(formatted_data) < fetch_limit,
                    }
                    await redis.setex(cache_key, cache_ttl, json.dumps(cache_payload))

                return formatted_data[-limit:]

            except Exception as e:
                logger.error(f"Error fetching OHLCV for {symbol} on {base_ex} ({timeframe}): {e}")
                raise e


    async def fetch_raw_order_book(self, symbol: str, exchange_id: str, limit: int = 100) -> Dict[str, Any]:
        """
        Fetches the raw order book from the exchange. Uses live cache if available.
        """
        import time
        symbol = str(symbol or "").strip().upper()
        base_ex, internal_ex = self.normalize_exchange_id(exchange_id, symbol)
        redis = redis_manager.get_redis()
        
        lock = self._get_ob_lock(internal_ex, symbol)
        async with lock:
            if redis:
                ob_sym = symbol.replace("/", "_") if base_ex == "oanda" else symbol
                cached_ob = await redis.get(f"latest_orderbook:{internal_ex}:{ob_sym}")
                if cached_ob:
                    data = json.loads(cached_ob)
                    return {
                        "symbol": symbol,
                        "exchange": base_ex,
                        "bids": [{"price": b["price"], "size": b["size"]} for b in data.get("bids", [])][:limit],
                        "asks": [{"price": a["price"], "size": a["size"]} for a in data.get("asks", [])][:limit],
                        "timestamp": int(time.time() * 1000),
                        "datetime": None
                    }

            if base_ex == 'oanda':
                return {
                    "symbol": symbol,
                    "exchange": base_ex,
                    "bids": [],
                    "asks": [],
                    "timestamp": int(time.time() * 1000),
                    "datetime": None
                }

            exchange = await self.get_exchange_instance(base_ex, symbol)
            try:
                # Normalize limit for different exchanges
                limit = self._normalize_order_book_limit(internal_ex, limit)
                
                # ✅ Bypass REST API for Binance to prevent rate limits
                if base_ex == 'binance':
                    logger.info(f"Bypassing Binance REST API for {symbol} to prevent rate limits. Relying on WebSocket stream cache.")
                    return {"symbol": symbol, "exchange": base_ex, "bids": [], "asks": [], "timestamp": None, "datetime": None}
                    
                order_book = await exchange.fetch_order_book(symbol, limit=limit)
                return {
                    "symbol": symbol,
                    "exchange": base_ex,
                    "bids": [{"price": b[0], "size": b[1]} for b in order_book.get('bids', [])],
                    "asks": [{"price": a[0], "size": a[1]} for a in order_book.get('asks', [])],
                    "timestamp": order_book.get('timestamp'),
                    "datetime": order_book.get('datetime')
                }
            except Exception as e:
                logger.error(f"Error fetching raw order book for {symbol} on {base_ex}: {e}")
                raise e

market_depth_service = MarketDepthService()
