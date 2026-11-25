"""Modular CoinGecko-backed coin logo cache service.

Maintains an in-memory + Redis (24h TTL) symbol -> official CoinGecko image URL map
so WebSocket market broadcasts and public endpoints can attach coin logos with O(1)
non-blocking lookups and zero browser rate-limiting.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings
from app.core.redis import redis_manager

logger = logging.getLogger(__name__)

REDIS_LOGOS_KEY = "market:coin_logos:v2"
LOGO_CACHE_TTL_SECONDS = 86400  # 24 hours
FAILURE_COOLDOWN_SECONDS = 300  # Avoid hammering CoinGecko on errors/429s
PUBLIC_OVERVIEW_TTL_SECONDS = 25

DEFAULT_PUBLIC_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
    "SUIUSDT", "APTUSDT", "SEIUSDT", "UNIUSDT", "LTCUSDT",
    "TRXUSDT", "SHIBUSDT", "TONUSDT", "ARBUSDT", "PEPEUSDT",
]

# Local verified asset fallback paths (served cleanly by Vite/nginx from /coins/)
LOCAL_BUNDLED_COINS = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX",
    "DOT", "LINK", "UNI", "LTC", "TRX", "SHIB", "SUI", "APT",
    "SEI", "MATIC", "POL", "USDT", "USDC", "PEPE", "TON", "ARB",
}


class CoinLogoService:
    """Fetches and caches official crypto asset icon URLs via CoinGecko."""

    def __init__(self) -> None:
        self._memory_map: Dict[str, str] = {
            sym: f"/coins/{'matic' if sym == 'POL' else sym.lower()}.png"
            for sym in LOCAL_BUNDLED_COINS
        }
        self._last_remote_fetch: float = 0.0
        self._last_attempt: float = 0.0
        self._lock = asyncio.Lock()
        self._latest_ws_overview: List[Dict[str, Any]] = []
        self._latest_ws_at: float = 0.0
        self._public_overview_cache: List[Dict[str, Any]] = []
        self._public_overview_at: float = 0.0

    @staticmethod
    def _normalize_base(symbol: str) -> str:
        raw = (symbol or "").split("/")[0].split(":")[0].strip()
        if re.match(r"^k[A-Z0-9]{2,}", raw):
            raw = raw[1:]
        base = raw.upper()
        m = re.match(r"^(?:1000000|100000|10000|1000|1M)([A-Z0-9]{2,})$", base)
        if m:
            base = m.group(1)
        if base == "XBT":
            base = "BTC"
        return base

    def get_logo_sync(self, symbol: str) -> Optional[str]:
        """Non-blocking O(1) lookup for WebSocket loops."""
        base = self._normalize_base(symbol)
        if not base:
            return None
        return self._memory_map.get(base)

    def _merge_remote_entries(self, remote_map: Dict[str, str]) -> None:
        """Merge remote CoinGecko URLs while preferring instant local icons for bundled coins."""
        for sym, url in remote_map.items():
            clean_sym = str(sym or "").strip().upper()
            if not clean_sym or not url:
                continue
            if clean_sym not in LOCAL_BUNDLED_COINS:
                self._memory_map[clean_sym] = str(url)

    async def refresh_if_stale(self, force: bool = False) -> Dict[str, str]:
        """Refresh symbol -> CoinGecko image map from Redis or CoinGecko API if stale."""
        now = time.time()
        if not force and (now - self._last_remote_fetch) < LOGO_CACHE_TTL_SECONDS:
            return dict(self._memory_map)
        if not force and (now - self._last_attempt) < FAILURE_COOLDOWN_SECONDS:
            return dict(self._memory_map)

        async with self._lock:
            now = time.time()
            if not force and (now - self._last_remote_fetch) < LOGO_CACHE_TTL_SECONDS:
                return dict(self._memory_map)

            # 1. Try Redis cache first
            redis = redis_manager.get_redis()
            if redis and not force:
                try:
                    cached = await redis.get(REDIS_LOGOS_KEY)
                    if cached:
                        parsed = json.loads(cached)
                        if isinstance(parsed, dict) and parsed:
                            self._merge_remote_entries(parsed)
                            self._last_remote_fetch = now
                            return dict(self._memory_map)
                except Exception as exc:
                    logger.debug(f"[CoinLogoService] Redis read skipped: {exc}")

            # 2. Fetch top 500 assets (2 pages of 250) from CoinGecko once per 24h
            self._last_attempt = now
            headers = {"User-Agent": "CosmoQuantAI/1.0"}
            if settings.COINGECKO_API_KEY:
                headers["x-cg-demo-api-key"] = settings.COINGECKO_API_KEY

            url = "https://api.coingecko.com/api/v3/coins/markets"
            try:
                remote_map: Dict[str, str] = {}
                async with httpx.AsyncClient(timeout=15.0) as client:
                    for page in (1, 2):
                        params = {
                            "vs_currency": "usd",
                            "order": "market_cap_desc",
                            "per_page": 250,
                            "page": page,
                            "sparkline": "false",
                        }
                        resp = await client.get(url, params=params, headers=headers)
                        if resp.status_code != 200:
                            logger.warning(f"[CoinLogoService] CoinGecko page {page} returned HTTP {resp.status_code}")
                            break
                        rows = resp.json()
                        if not isinstance(rows, list):
                            break
                        for item in rows:
                            sym = str(item.get("symbol") or "").strip().upper()
                            img = str(item.get("image") or "").strip()
                            # Preserve first (highest market cap) coin when multiple tokens share a ticker symbol
                            if sym and img and sym not in remote_map:
                                remote_map[sym] = img

                if remote_map:
                    self._merge_remote_entries(remote_map)
                    self._last_remote_fetch = now
                    if redis:
                        try:
                            await redis.setex(REDIS_LOGOS_KEY, LOGO_CACHE_TTL_SECONDS, json.dumps(remote_map))
                        except Exception as exc:
                            logger.debug(f"[CoinLogoService] Redis write skipped: {exc}")
                    logger.info(f"✅ Cached {len(remote_map)} official coin logos from CoinGecko")
            except Exception as exc:
                logger.warning(f"[CoinLogoService] CoinGecko fetch skipped: {exc}")

            return dict(self._memory_map)

    async def get_logo_map(self) -> Dict[str, str]:
        """Return complete symbol -> logo URL map (refreshing asynchronously if stale)."""
        await self.refresh_if_stale()
        return dict(self._memory_map)

    def set_latest_overview(self, items: List[Dict[str, Any]]) -> None:
        """Store latest WebSocket market overview snapshot for zero-cost public reads."""
        if items:
            self._latest_ws_overview = items[:25]
            self._latest_ws_at = time.time()

    async def get_public_overview(self) -> List[Dict[str, Any]]:
        """Return top crypto tickers with official logo URLs (from WS cache or Binance REST)."""
        await self.refresh_if_stale()
        now = time.time()

        if self._latest_ws_overview and (now - self._latest_ws_at) < 30:
            return [
                {
                    **item,
                    "logoUrl": item.get("logoUrl") or self.get_logo_sync(item.get("symbol", "")),
                }
                for item in self._latest_ws_overview
            ]

        if self._public_overview_cache and (now - self._public_overview_at) < PUBLIC_OVERVIEW_TTL_SECONDS:
            return self._public_overview_cache

        symbols_json = json.dumps(DEFAULT_PUBLIC_SYMBOLS, separators=(",", ":"))
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.binance.com/api/v3/ticker/24hr",
                    params={"symbols": symbols_json},
                    headers={"User-Agent": "CosmoQuantAI/1.0"},
                )
            if resp.status_code == 200:
                rows = resp.json()
                if isinstance(rows, list):
                    coins: List[Dict[str, Any]] = []
                    for row in rows:
                        raw_sym = str(row.get("symbol") or "").upper()
                        base = raw_sym[:-4] if raw_sym.endswith("USDT") else raw_sym
                        if not base:
                            continue
                        try:
                            price = float(row.get("lastPrice") or 0)
                            chg = float(row.get("priceChangePercent") or 0)
                            vol = float(row.get("quoteVolume") or 0)
                        except (TypeError, ValueError):
                            continue
                        if price <= 0:
                            continue
                        coins.append({
                            "symbol": f"{base}/USDT",
                            "price": price,
                            "changePercent": chg,
                            "volume": vol,
                            "logoUrl": self.get_logo_sync(base),
                        })
                    if coins:
                        self._public_overview_cache = coins
                        self._public_overview_at = now
                        return coins
        except Exception as exc:
            logger.debug(f"[CoinLogoService] Public ticker fetch skipped: {exc}")

        return self._public_overview_cache


coin_logo_service = CoinLogoService()
