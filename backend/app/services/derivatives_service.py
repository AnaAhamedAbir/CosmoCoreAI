import asyncio
import logging
import time
from typing import Dict, Any, Optional, List
import aiohttp

logger = logging.getLogger(__name__)


def _normalize_futures_symbol(symbol: str) -> str:
    """Converts 'BTC/USDT:USDT' or 'BTC/USDT' -> 'BTCUSDT'."""
    clean = (symbol or "BTC/USDT").upper().split(":")[0]
    return clean.replace("/", "").replace("-", "")


class DerivativesService:
    """
    Live Derivatives Data Service (Funding Rate, Open Interest, 24h Quote Volume,
    and Historical Open Interest Series for OI-Delta Liquidation Modeling).
    Uses Binance Futures public REST endpoints with Bybit fallback and short TTL caching
    to minimize network and CPU overhead.
    """

    def __init__(self, cache_ttl_sec: float = 20.0, oi_hist_ttl_sec: float = 45.0):
        self._cache_ttl_sec = cache_ttl_sec
        self._oi_hist_ttl_sec = oi_hist_ttl_sec
        self._stats_cache: Dict[str, Dict[str, Any]] = {}
        self._oi_hist_cache: Dict[str, Dict[str, Any]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    def _get_lock(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def get_market_stats(self, symbol: str = "BTC/USDT") -> Dict[str, Any]:
        """
        Fetches live mark price, funding rate, open interest (USD), and 24h quote volume.
        Cached for cache_ttl_sec seconds per symbol.
        """
        norm_sym = _normalize_futures_symbol(symbol)
        now = time.time()
        cached = self._stats_cache.get(norm_sym)
        if cached and (now - cached["_ts"] < self._cache_ttl_sec):
            return cached["data"]

        async with self._get_lock(norm_sym):
            now = time.time()
            cached = self._stats_cache.get(norm_sym)
            if cached and (now - cached["_ts"] < self._cache_ttl_sec):
                return cached["data"]

            result = await self._fetch_binance_stats(norm_sym, symbol)
            if result is None:
                result = await self._fetch_bybit_stats(norm_sym, symbol)
            if result is None:
                # Preserve previous live reading if available before returning zero fallback
                if cached:
                    return cached["data"]
                result = {
                    "symbol": symbol,
                    "funding_rate": 0.0,
                    "mark_price": 0.0,
                    "open_interest_usd": 0.0,
                    "quote_volume_24h": 0.0,
                    "next_funding_time": "Unavailable",
                    "is_mocked": True,
                }

            self._stats_cache[norm_sym] = {"_ts": time.time(), "data": result}
            return result

    async def _fetch_binance_stats(self, norm_sym: str, raw_symbol: str) -> Optional[Dict[str, Any]]:
        timeout = aiohttp.ClientTimeout(total=6.0)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                prem_url = f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={norm_sym}"
                oi_url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={norm_sym}"
                ticker_url = f"https://fapi.binance.com/fapi/v1/ticker/24hr?symbol={norm_sym}"

                prem_res, oi_res, ticker_res = await asyncio.gather(
                    session.get(prem_url),
                    session.get(oi_url),
                    session.get(ticker_url),
                    return_exceptions=True,
                )

                funding_rate = 0.0
                mark_price = 0.0
                next_funding_str = "8h cycle"

                if not isinstance(prem_res, Exception) and prem_res.status == 200:
                    prem_json = await prem_res.json()
                    funding_rate = float(prem_json.get("lastFundingRate", 0.0) or 0.0)
                    mark_price = float(prem_json.get("markPrice", 0.0) or 0.0)
                    next_ft_ms = int(prem_json.get("nextFundingTime", 0) or 0)
                    if next_ft_ms > 0:
                        mins_left = max(0, int((next_ft_ms / 1000 - time.time()) / 60))
                        next_funding_str = f"in {mins_left // 60}h {mins_left % 60}m"
                else:
                    return None

                quote_volume_24h = 0.0
                if not isinstance(ticker_res, Exception) and ticker_res.status == 200:
                    ticker_json = await ticker_res.json()
                    quote_volume_24h = float(ticker_json.get("quoteVolume", 0.0) or 0.0)
                    if mark_price <= 0:
                        mark_price = float(ticker_json.get("lastPrice", 0.0) or 0.0)

                open_interest_usd = 0.0
                if not isinstance(oi_res, Exception) and oi_res.status == 200:
                    oi_json = await oi_res.json()
                    oi_contracts = float(oi_json.get("openInterest", 0.0) or 0.0)
                    open_interest_usd = oi_contracts * mark_price

                return {
                    "symbol": raw_symbol,
                    "funding_rate": funding_rate,
                    "mark_price": mark_price,
                    "open_interest_usd": round(open_interest_usd, 2),
                    "quote_volume_24h": round(quote_volume_24h, 2),
                    "next_funding_time": next_funding_str,
                    "is_mocked": False,
                }
        except Exception as e:
            logger.debug(f"Binance derivatives fetch failed for {norm_sym}: {e}")
            return None

    async def _fetch_bybit_stats(self, norm_sym: str, raw_symbol: str) -> Optional[Dict[str, Any]]:
        timeout = aiohttp.ClientTimeout(total=6.0)
        try:
            url = f"https://api.bybit.com/v5/market/tickers?category=linear&symbol={norm_sym}"
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return None
                    payload = await resp.json()
            items = payload.get("result", {}).get("list", [])
            if not items:
                return None
            item = items[0]
            mark_price = float(item.get("markPrice") or item.get("lastPrice") or 0.0)
            funding_rate = float(item.get("fundingRate") or 0.0)
            oi_val = float(item.get("openInterestValue") or 0.0)
            turnover_24h = float(item.get("turnover24h") or 0.0)
            return {
                "symbol": raw_symbol,
                "funding_rate": funding_rate,
                "mark_price": mark_price,
                "open_interest_usd": round(oi_val, 2),
                "quote_volume_24h": round(turnover_24h, 2),
                "next_funding_time": "8h cycle",
                "is_mocked": False,
            }
        except Exception as e:
            logger.debug(f"Bybit derivatives fetch failed for {norm_sym}: {e}")
            return None

    async def get_funding_rate(self, symbol: str = "BTC/USDT") -> Dict[str, Any]:
        """Fetch the live Funding Rate for a given perpetual symbol."""
        stats = await self.get_market_stats(symbol)
        return {
            "symbol": symbol,
            "funding_rate": stats["funding_rate"],
            "next_funding_time": stats["next_funding_time"],
            "is_mocked": stats["is_mocked"],
        }

    async def get_open_interest(self, symbol: str = "BTC/USDT") -> Dict[str, Any]:
        """Fetch the live Open Interest (USD) for a given perpetual symbol."""
        stats = await self.get_market_stats(symbol)
        return {
            "symbol": symbol,
            "open_interest_usd": stats["open_interest_usd"],
            "quote_volume_24h": stats["quote_volume_24h"],
            "is_mocked": stats["is_mocked"],
        }

    async def get_open_interest_history(
        self,
        symbol: str = "BTC/USDT",
        period: str = "15m",
        limit: int = 96,
    ) -> List[Dict[str, Any]]:
        """
        Fetches historical Open Interest (USD) time-series for OI-Delta liquidation pool weighting.
        Uses Binance Futures public /futures/data/openInterestHist with Bybit v5 fallback and TTL caching.
        Returns ascending list of {"timestamp": int_ms, "oi_usd": float}.
        """
        norm_sym = _normalize_futures_symbol(symbol)
        safe_period = period if period in ("5m", "15m", "30m", "1h", "2h", "4h") else "15m"
        safe_limit = max(10, min(500, int(limit or 96)))
        cache_key = f"oi_hist:{norm_sym}:{safe_period}:{safe_limit}"

        now = time.time()
        cached = self._oi_hist_cache.get(cache_key)
        if cached and (now - cached["_ts"] < self._oi_hist_ttl_sec):
            return cached["data"]

        async with self._get_lock(cache_key):
            now = time.time()
            cached = self._oi_hist_cache.get(cache_key)
            if cached and (now - cached["_ts"] < self._oi_hist_ttl_sec):
                return cached["data"]

            series = await self._fetch_binance_oi_history(norm_sym, safe_period, safe_limit)
            if not series:
                series = await self._fetch_bybit_oi_history(norm_sym, safe_period, safe_limit, symbol)
            if not series and cached:
                return cached["data"]

            self._oi_hist_cache[cache_key] = {"_ts": time.time(), "data": series or []}
            return series or []

    async def _fetch_binance_oi_history(
        self,
        norm_sym: str,
        period: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        timeout = aiohttp.ClientTimeout(total=6.0)
        try:
            url = (
                f"https://fapi.binance.com/futures/data/openInterestHist"
                f"?symbol={norm_sym}&period={period}&limit={limit}"
            )
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return []
                    raw = await resp.json()
            if not isinstance(raw, list) or not raw:
                return []
            out: List[Dict[str, Any]] = []
            for row in raw:
                ts = int(row.get("timestamp") or 0)
                oi_val = float(row.get("sumOpenInterestValue") or 0.0)
                if ts > 0 and oi_val > 0:
                    out.append({"timestamp": ts, "oi_usd": oi_val})
            out.sort(key=lambda x: x["timestamp"])
            return out
        except Exception as e:
            logger.debug(f"Binance OI history fetch failed ({norm_sym}/{period}): {e}")
            return []

    async def _fetch_bybit_oi_history(
        self,
        norm_sym: str,
        period: str,
        limit: int,
        raw_symbol: str,
    ) -> List[Dict[str, Any]]:
        timeout = aiohttp.ClientTimeout(total=6.0)
        bybit_map = {"5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h"}
        interval_time = bybit_map.get(period, "15min")
        try:
            url = (
                f"https://api.bybit.com/v5/market/open-interest"
                f"?category=linear&symbol={norm_sym}&intervalTime={interval_time}&limit={min(200, limit)}"
            )
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return []
                    payload = await resp.json()
            items = payload.get("result", {}).get("list", [])
            if not isinstance(items, list) or not items:
                return []
            # Convert contract OI to approximate USD using cached mark price if available
            stats = self._stats_cache.get(norm_sym, {}).get("data", {})
            mark_px = float(stats.get("mark_price") or 0.0)
            if mark_px <= 0:
                live_stats = await self.get_market_stats(raw_symbol)
                mark_px = float(live_stats.get("mark_price") or 1.0)
            out: List[Dict[str, Any]] = []
            for row in items:
                ts = int(row.get("timestamp") or 0)
                oi_contracts = float(row.get("openInterest") or 0.0)
                if ts > 0 and oi_contracts > 0:
                    out.append({"timestamp": ts, "oi_usd": oi_contracts * mark_px})
            out.sort(key=lambda x: x["timestamp"])
            return out
        except Exception as e:
            logger.debug(f"Bybit OI history fetch failed ({norm_sym}/{period}): {e}")
            return []


derivatives_service = DerivativesService()
