import asyncio
import logging
import time
from typing import Dict, Any, Optional
import aiohttp

logger = logging.getLogger(__name__)


def _normalize_futures_symbol(symbol: str) -> str:
    """Converts 'BTC/USDT:USDT' or 'BTC/USDT' -> 'BTCUSDT'."""
    clean = (symbol or "BTC/USDT").upper().split(":")[0]
    return clean.replace("/", "").replace("-", "")


class DerivativesService:
    """
    Live Derivatives Data Service (Funding Rate, Open Interest, 24h Quote Volume).
    Uses Binance Futures public REST endpoints with Bybit fallback and short TTL caching
    to minimize network and CPU overhead.
    """

    def __init__(self, cache_ttl_sec: float = 20.0):
        self._cache_ttl_sec = cache_ttl_sec
        self._stats_cache: Dict[str, Dict[str, Any]] = {}
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


derivatives_service = DerivativesService()
