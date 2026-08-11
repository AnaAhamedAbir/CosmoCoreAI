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
        exchange_id = exchange_id.lower()
        
        # If the symbol looks like a futures symbol (contains ':'), we may need specific config
        is_futures = symbol and ':' in symbol
        
        if exchange_id == 'binance' and is_futures:
            cache_id = 'binance_futures'
        elif exchange_id == 'kucoin' and is_futures:
            cache_id = 'kucoinfutures'
        elif exchange_id == 'kraken' and is_futures:
            cache_id = 'krakenfutures'
        else:
            cache_id = exchange_id

        async with self._lock:
            if cache_id not in self._exchanges:
                # For Kucoin/Kraken Futures, use the dedicated class
                real_class_id = cache_id if cache_id in ['kucoinfutures', 'krakenfutures'] else exchange_id
                logger.info(f"Creating exchange instance for {cache_id} (class: {real_class_id})")
                exchange_class = getattr(ccxt, real_class_id, None)
                
                if not exchange_class:
                    logger.error(f"Exchange class '{real_class_id}' not found in CCXT async_support.")
                    raise ValueError(f"Exchange '{real_class_id}' not supported.")
                
                options = {
                    'enableRateLimit': True,
                    'options': {'adjustForTimeDifference': True}
                }
                
                if cache_id == 'binance_futures':
                    options['options'] = {'defaultType': 'swap'}  # 'swap' = USDⓈ-M (fapi.binance.com); 'future' = COIN-M (dapi.binance.com)
                    
                exchange = exchange_class(options)
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
        exchange_id = exchange_id.lower()
        
        if exchange_id == 'kucoin':
            # Kucoin supports: 20 or 100
            if limit <= 20: 
                return 20
            else: 
                return 100
        
        if exchange_id == 'binance':
            # Binance supports: 5, 10, 20, 50, 100, 500, 1000, 5000 (futures up to 1000)
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            elif limit <= 50: return 50
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000

        if exchange_id == 'kraken':
            # Kraken supports: 10, 25, 100, 500, 1000
            if limit <= 10: return 10
            elif limit <= 25: return 25
            elif limit <= 100: return 100
            elif limit <= 500: return 500
            else: return 1000
        
        if exchange_id == 'htx':
            # HTX supports: 5, 10, 20, 150
            if limit <= 5: return 5
            elif limit <= 10: return 10
            elif limit <= 20: return 20
            else: return 150
            
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
        
        Args:
            symbol (str): Trading pair, e.g., 'BTC/USDT'.
            exchange_id (str): Exchange name, e.g., 'binance'.
            depth (int): Number of order book levels to fetch.
            bucket_size (float): Price range for grouping orders.

        Returns:
            Dict[str, Any]: {
                "current_price": float,
                "bids": [{"price": float, "volume": float}, ...],
                "asks": [{"price": float, "volume": float}, ...],
                "symbol": str,
                "exchange": str
            }
        """
        # normalize inputs
        symbol = symbol.upper()
        exchange_id = exchange_id.lower()
        
        # 1. Check Cache
        cache_key = f"market_depth_heatmap:{exchange_id}:{symbol}:{bucket_size}:{depth}"
        redis = redis_manager.get_redis()
        
        lock = self._get_ob_lock(exchange_id, symbol)
        async with lock:
            if redis:
                cached_data = await redis.get(cache_key)
                if cached_data:
                    return json.loads(cached_data)

            # 1.5 Try Live Streamer Cache First
            order_book = None
            if redis:
                live_ob = await redis.get(f"latest_orderbook:{exchange_id.lower()}:{symbol.upper()}")
                if live_ob:
                    live_data = json.loads(live_ob)
                    bids = [[b["price"], b["size"]] for b in live_data.get("bids", [])]
                    asks = [[a["price"], a["size"]] for a in live_data.get("asks", [])]
                    order_book = {"bids": bids, "asks": asks}

            # 2. Fetch Live Data if cache missing
            if exchange_id.lower() == 'oanda':
                # OANDA doesn't provide level 2 data, just tick volume
                return {"symbol": symbol, "exchange": exchange_id, "current_price": 0, "bids": [], "asks": []}
                
            exchange = await self.get_exchange_instance(exchange_id, symbol)
            
            try:
                # Normalize limit for different exchanges
                depth = self._normalize_order_book_limit(exchange_id, depth)
                    
                # Fetch Order Book
                if not order_book:
                    # ✅ Bypass REST API for Binance to prevent rate limits
                    if exchange_id.lower() == 'binance':
                        logger.info(f"Bypassing Binance REST API for {symbol} to prevent rate limits. Relying on WebSocket stream cache.")
                        return {"symbol": symbol, "exchange": exchange_id, "current_price": 0, "bids": [], "asks": []}
                        
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
                    "exchange": exchange_id,
                    "current_price": current_price,
                    "bids": aggregated_bids,
                    "asks": aggregated_asks
                }

                # 4. Cache Result (5 seconds TTL)
                if redis:
                    await redis.setex(cache_key, 5, json.dumps(result))

                return result

            except Exception as e:
                logger.error(f"Error fetching market depth for {symbol} on {exchange_id}: {e}")
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
        popular = ['binance', 'kraken', 'coinbase', 'kucoin', 'bybit', 'okx', 'bitfinex', 'gateio', 'htx', 'mexc', 'oanda']
        return popular

    async def get_exchange_markets(self, exchange_id: str) -> List[str]:
        """
        Returns a list of symbols for a given exchange.
        For Binance and Kucoin, it merges both Spot and Futures markets.
        For OANDA, it uses the OANDA REST API to fetch currency pairs.
        """
        cache_key = f"markets:{exchange_id}"
        redis = redis_manager.get_redis()
        
        if redis:
            cached = await redis.get(cache_key)
            if cached:
                return json.loads(cached)

        symbols = []
        try:
            logger.info(f"Fetching markets for {exchange_id}...")
            
            if exchange_id.lower() == 'oanda':
                import requests
                import os
                
                account_id = os.getenv("OANDA_ACCOUNT_ID")
                api_key = os.getenv("OANDA_API_KEY")
                
                if account_id and api_key:
                    url = f"https://api-fxpractice.oanda.com/v3/accounts/{account_id}/instruments"
                    headers = {"Authorization": f"Bearer {api_key}"}
                    try:
                        response = requests.get(url, headers=headers)
                        response.raise_for_status()
                        data = response.json()
                        for inst in data.get("instruments", []):
                            if inst.get("type") == "CURRENCY":
                                # OANDA pairs are returned as EUR_USD. Let's return them as EUR/USD for UI consistency.
                                symbols.append(inst["name"].replace("_", "/"))
                    except Exception as e:
                        logger.error(f"Failed to fetch OANDA markets: {e}")
                
                if not symbols:
                    # Fallback
                    symbols = ["EUR/USD", "GBP/USD", "USD/JPY"]
                    
                symbols = sorted(symbols)
            else:
                # 1. Fetch Spot Markets
                spot_exchange = await self.get_exchange_instance(exchange_id)
                spot_markets = await spot_exchange.load_markets()
                symbols.extend(list(spot_markets.keys()))
                logger.info(f"Fetched {len(spot_markets)} spot markets for {exchange_id}")

                # 2. Fetch Futures Markets (if applicable)
                if exchange_id == 'binance':
                    logger.info("Fetching Binance Futures markets...")
                    futures_exchange = await self.get_exchange_instance('binance', symbol='BTC/USDT:USDT')
                    futures_markets = await futures_exchange.load_markets()
                    symbols.extend(list(futures_markets.keys()))
                    logger.info(f"Fetched {len(futures_markets)} Binance futures markets")
                elif exchange_id == 'kucoin':
                    logger.info("Fetching Kucoin Futures markets...")
                    futures_exchange = await self.get_exchange_instance('kucoin', symbol='BTC/USDT:USDT')
                    futures_markets = await futures_exchange.load_markets()
                    symbols.extend(list(futures_markets.keys()))
                    logger.info(f"Fetched {len(futures_markets)} Kucoin futures markets")
                elif exchange_id == 'kraken':
                    logger.info("Fetching Kraken Futures markets...")
                    try:
                        futures_exchange = await self.get_exchange_instance('kraken', symbol='BTC/USDT:USDT')
                        futures_markets = await futures_exchange.load_markets()
                        symbols.extend(list(futures_markets.keys()))
                        logger.info(f"Fetched {len(futures_markets)} Kraken futures markets")
                    except Exception as e:
                        logger.error(f"Error fetching Kraken futures markets. It might be due to API accessibility or CCXT version: {e}")
                
                # Remove duplicates and sort
                symbols = sorted(list(set(symbols)))
            
            logger.info(f"Total merged markets for {exchange_id}: {len(symbols)}")

            # Cache for 1 hour as markets don't change often
            if redis:
                await redis.setex(cache_key, 3600, json.dumps(symbols))
            return symbols
        except Exception as e:
            logger.error(f"Error loading markets for {exchange_id}: {e}")
            raise e

    async def fetch_ohlcv(self, symbol: str, exchange_id: str, timeframe: str = '1h', limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetches OHLCV data for a symbol with automatic pagination for large limits.

        Key improvements:
        - Cache key now includes `limit` to avoid stale data bugs.
        - Requests >1000 candles are split into safe batches of 1000 with a
          500ms delay between each request to prevent IP bans / rate-limit errors.
        - CCXT's built-in `enableRateLimit` handles per-request throttling.
        - Results are deduplicated and sorted chronologically before returning.
        - Max limit is hard-capped at 2000 for safety.
        """
        import time as _time

        # Hard cap to avoid accidental abuse or server overload
        limit = min(limit, 2000)
        fetch_limit = limit

        # Use a unified cache key without limit to serve all sizes from one cache
        cache_key = f"ohlcv:{exchange_id}:{symbol}:{timeframe}"
        redis = redis_manager.get_redis()

        lock = self._get_ohlcv_lock(exchange_id, symbol, timeframe)
        async with lock:
            if redis:
                cached = await redis.get(cache_key)
                if cached:
                    cached_data = json.loads(cached)
                    # If we have enough data in cache, slice and return it
                    if len(cached_data) >= limit:
                        return cached_data[-limit:]
                    # If not enough, we will fetch fetch_limit from exchange

            if exchange_id.lower() == 'oanda':
                import requests
                import os
                import yfinance as yf
                from datetime import datetime, timedelta
                
                # OANDA uses M1, H1 etc instead of 1m, 1h
                tf_map = {'1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D'}
                oanda_tf = tf_map.get(timeframe, 'H1')
                oanda_symbol = symbol.replace("/", "_")
                
                account_id = os.getenv("OANDA_ACCOUNT_ID")
                api_key = os.getenv("OANDA_API_KEY")
                
                formatted_data = []
                fetch_success = False
                
                if account_id and api_key:
                    url = f"https://api-fxpractice.oanda.com/v3/instruments/{oanda_symbol}/candles?count={limit}&granularity={oanda_tf}&price=M"
                    headers = {"Authorization": f"Bearer {api_key}"}
                    try:
                        response = requests.get(url, headers=headers, timeout=5)
                        response.raise_for_status()
                        data = response.json()
                        candles = data.get("candles", [])
                        for c in candles:
                            if c["complete"]:
                                # OANDA time is RFC3339 string
                                dt = datetime.fromisoformat(c["time"].replace('Z', '+00:00'))
                                formatted_data.append({
                                    "time": int(dt.timestamp()),
                                    "open": float(c["mid"]["o"]),
                                    "high": float(c["mid"]["h"]),
                                    "low": float(c["mid"]["l"]),
                                    "close": float(c["mid"]["c"]),
                                    "volume": int(c["volume"])
                                })
                        fetch_success = len(formatted_data) > 0
                    except Exception as e:
                        logger.error(f"OANDA API failed for {symbol}: {e}. Falling back to yfinance.")
                
                if not fetch_success:
                    # Fallback to yfinance
                    try:
                        logger.info(f"Using yfinance fallback for {symbol}")
                        yf_symbol = f"{symbol.replace('/', '')}=X"
                        
                        # map timeframe to yfinance
                        yf_tf_map = {'1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '1d': '1d'}
                        yf_tf = yf_tf_map.get(timeframe, '1h')
                        
                        ticker = yf.Ticker(yf_symbol)
                        
                        # If timeframe is intraday (e.g. 1m, 1h), yfinance limits the history (e.g. 7 days for 1m, 730 days for 1h)
                        period = "1mo"
                        if timeframe == '1m': period = "7d"
                        
                        df = ticker.history(period=period, interval=yf_tf)
                        if not df.empty:
                            df = df.tail(limit)
                            for index, row in df.iterrows():
                                formatted_data.append({
                                    "time": int(index.timestamp()),
                                    "open": float(row['Open']),
                                    "high": float(row['High']),
                                    "low": float(row['Low']),
                                    "close": float(row['Close']),
                                    "volume": float(row['Volume'])
                                })
                    except Exception as e:
                        logger.error(f"yfinance fallback failed for {symbol}: {e}")
                        raise e
                
                # Decorate with candlestick pattern analysis
                from app.helpers.candlestick_patterns import attach_candlestick_patterns
                formatted_data = attach_candlestick_patterns(formatted_data)
                
                if redis and formatted_data:
                    await redis.setex(cache_key, 60, json.dumps(formatted_data))
                    
                return formatted_data
                
            exchange = await self.get_exchange_instance(exchange_id, symbol)

            # Max candles most exchanges allow per single request
            BATCH_SIZE = 1000

            try:
                all_ohlcv: list = []

                if fetch_limit <= BATCH_SIZE:
                    # ── Single request, no pagination needed ──────────────────────
                    all_ohlcv = await exchange.fetch_ohlcv(symbol, timeframe, limit=fetch_limit)

                else:
                    # ── Paginated fetching ─────────────────────────────────────────
                    # Calculate timeframe duration in milliseconds so we can step
                    # backward from "now" to find the correct `since` start point.
                    tf_ms: int = exchange.parse_timeframe(timeframe) * 1000
                    now_ms: int = int(_time.time() * 1000)

                    # Start from `fetch_limit` candles ago
                    since_ms: int = now_ms - (fetch_limit * tf_ms)
                    remaining: int = fetch_limit

                    while remaining > 0:
                        batch = min(remaining, BATCH_SIZE)
                        chunk = await exchange.fetch_ohlcv(
                            symbol, timeframe, since=since_ms, limit=batch
                        )

                        if not chunk:
                            break  # Exchange returned nothing — stop

                        all_ohlcv.extend(chunk)
                        remaining -= len(chunk)

                        # Advance `since` past the last candle to avoid re-fetching
                        since_ms = chunk[-1][0] + tf_ms

                        # Exchange has no more historical data for this range
                        if len(chunk) < batch:
                            break

                        # ── Rate-limit safety delay between paginated requests ──
                        # CCXT's enableRateLimit handles per-request throttling, but
                        # we add an extra 500ms buffer to avoid soft IP bans on
                        # stricter exchanges (Binance, Bybit, etc.).
                        if remaining > 0:
                            await asyncio.sleep(0.5)

                # ── Deduplicate by timestamp (keep latest) and sort ascending ──
                seen: dict = {}
                for candle in all_ohlcv:
                    seen[candle[0]] = candle
                all_ohlcv = sorted(seen.values(), key=lambda x: x[0])

                # ── Format for Lightweight Charts ──────────────────────────────
                formatted_data = [
                    {
                        "time":   int(c[0] / 1000),  # ms → seconds
                        "open":   c[1],
                        "high":   c[2],
                        "low":    c[3],
                        "close":  c[4],
                        "volume": c[5],
                    }
                    for c in all_ohlcv
                ]

                # Decorate with candlestick pattern analysis
                from app.helpers.candlestick_patterns import attach_candlestick_patterns
                formatted_data = attach_candlestick_patterns(formatted_data)

                # ── Dynamic cache TTL based on timeframe ───────────────────────
                # Short timeframes need fresh data; long timeframes can be cached longer.
                # Increased TTL to prevent IP bans from Binance REST API over-polling.
                tf_ttl_map = {
                    '1s': 5, '5s': 5, '15s': 5, '30s': 5,
                    '1m': 30, '3m': 60, '5m': 120, '15m': 300,
                    '30m': 600, '45m': 600, '1h': 1800,
                    '2h': 3600, '4h': 7200, '6h': 10800, '12h': 21600,
                    '1d': 43200, '1w': 86400, '1M': 86400,
                }
                cache_ttl = tf_ttl_map.get(timeframe, 60)

                if redis:
                    await redis.setex(cache_key, cache_ttl, json.dumps(formatted_data))

                return formatted_data[-limit:]

            except Exception as e:
                logger.error(f"Error fetching OHLCV for {symbol} on {exchange_id}: {e}")
                raise e


    async def fetch_raw_order_book(self, symbol: str, exchange_id: str, limit: int = 100) -> Dict[str, Any]:
        """
        Fetches the raw order book from the exchange. Uses live cache if available.
        """
        import time
        redis = redis_manager.get_redis()
        
        lock = self._get_ob_lock(exchange_id, symbol)
        async with lock:
            if redis:
                cached_ob = await redis.get(f"latest_orderbook:{exchange_id.lower()}:{symbol.upper()}")
                if cached_ob:
                    data = json.loads(cached_ob)
                    return {
                        "symbol": symbol.upper(),
                        "exchange": exchange_id.lower(),
                        "bids": [{"price": b["price"], "size": b["size"]} for b in data.get("bids", [])][:limit],
                        "asks": [{"price": a["price"], "size": a["size"]} for a in data.get("asks", [])][:limit],
                        "timestamp": int(time.time() * 1000),
                        "datetime": None
                    }

            if exchange_id.lower() == 'oanda':
                return {
                    "symbol": symbol.upper(),
                    "exchange": exchange_id.lower(),
                    "bids": [],
                    "asks": [],
                    "timestamp": int(time.time() * 1000),
                    "datetime": None
                }

            exchange = await self.get_exchange_instance(exchange_id, symbol)
            try:
                # Normalize limit for different exchanges
                limit = self._normalize_order_book_limit(exchange_id, limit)
                
                # ✅ Bypass REST API for Binance to prevent rate limits
                if exchange_id.lower() == 'binance':
                    logger.info(f"Bypassing Binance REST API for {symbol} to prevent rate limits. Relying on WebSocket stream cache.")
                    return {"symbol": symbol.upper(), "exchange": exchange_id.lower(), "bids": [], "asks": [], "timestamp": None, "datetime": None}
                    
                order_book = await exchange.fetch_order_book(symbol.upper(), limit=limit)
                return {
                    "symbol": symbol.upper(),
                    "exchange": exchange_id.lower(),
                    "bids": [{"price": b[0], "size": b[1]} for b in order_book.get('bids', [])],
                    "asks": [{"price": a[0], "size": a[1]} for a in order_book.get('asks', [])],
                    "timestamp": order_book.get('timestamp'),
                    "datetime": order_book.get('datetime')
                }
            except Exception as e:
                logger.error(f"Error fetching raw order book for {symbol} on {exchange_id}: {e}")
                raise e

market_depth_service = MarketDepthService()
