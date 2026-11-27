import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
import aiohttp

from app.services.derivatives_service import _normalize_futures_symbol

logger = logging.getLogger(__name__)


class DeepL2Aggregator:
    """
    Institutional ±10% Multi-Exchange Deep L2 Orderbook Aggregator (Priority #3 Upgrade).

    Concurrently fetches deep L2 orderbook snapshots from up to 4 perpetual futures exchanges:
    - Binance Futures (/fapi/v1/depth?limit=1000)
    - Bybit Linear    (/v5/market/orderbook?category=linear&limit=500)
    - OKX Swap        (/api/v5/market/books?sz=400, exact contractSize via instruments API)
    - Bitget Futures  (/api/v2/mix/market/depth?productType=USDT-FUTURES&limit=100)

    Aggregates USD resting liquidity into institutional 0.2% price bins across ±10% of spot/mark
    price, identifies multi-exchange Confluence Whale Walls (2+ exchanges stacking the same level),
    and provides outer-depth levels to enrich the Bookmap heatmap beyond the tight WS inner book.
    """

    DEFAULT_RANGE_PCT = 0.10  # ±10%
    BIN_PCT = 0.002  # 0.2% institutional price cluster width
    MIN_WALL_RATIO = 0.18  # Keep top institutional walls >= 18% of side peak
    MAX_WALLS_PER_SIDE = 6
    POLL_TIMEOUT_SEC = 5.0

    # Class-level cache for OKX swap ctVal (contract multiplier) so it's fetched at most once per symbol
    _okx_ctval_cache: Dict[str, Tuple[float, float]] = {}

    def __init__(self, symbol: str):
        self.symbol = (symbol or "BTC/USDT").upper()
        self._base_pair = self.symbol.split(":")[0]
        self._norm_sym = _normalize_futures_symbol(self.symbol)
        base_coin = self._base_pair.split("/")[0] if "/" in self._base_pair else self._norm_sym.replace("USDT", "").replace("USDC", "")
        self._usdt_sym = f"{base_coin}USDT"
        self._okx_inst_id = f"{base_coin}-USDT-SWAP"

        self.walls: List[Dict[str, Any]] = []
        self.summary: Dict[str, Any] = self.empty_summary()
        self.merged_bids: List[List[float]] = []  # [[price, base_qty_sum], ...]
        self.merged_asks: List[List[float]] = []  # [[price, base_qty_sum], ...]
        self.last_updated_ts: float = 0.0

    @staticmethod
    def empty_summary() -> Dict[str, Any]:
        return {
            "range_pct": 10,
            "exchanges_active": [],
            "exchange_count": 0,
            "total_bids_10pct_usd": 0,
            "total_asks_10pct_usd": 0,
            "total_bids_5pct_usd": 0,
            "total_asks_5pct_usd": 0,
            "global_bid_ratio": 0.5,
            "book_bias": "BALANCED",
            "strongest_bid_wall": None,
            "strongest_ask_wall": None,
        }

    def reset(self) -> None:
        self.walls = []
        self.summary = self.empty_summary()
        self.merged_bids = []
        self.merged_asks = []
        self.last_updated_ts = 0.0

    async def refresh(self, current_price: float = 0.0) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Fetches deep L2 books from Binance, Bybit, OKX, and Bitget concurrently,
        aggregates across ±10%, and caches walls, summary, and merged depth levels.
        """
        timeout = aiohttp.ClientTimeout(total=self.POLL_TIMEOUT_SEC)
        books: Dict[str, Tuple[List[List[float]], List[List[float]]]] = {}

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                results = await asyncio.gather(
                    self._fetch_binance_depth(session),
                    self._fetch_bybit_depth(session),
                    self._fetch_okx_depth(session),
                    self._fetch_bitget_depth(session),
                    return_exceptions=True,
                )
            for ex_id, res in zip(("binance", "bybit", "okx", "bitget"), results):
                if isinstance(res, Exception) or not res:
                    continue
                bids, asks = res
                if bids and asks:
                    books[ex_id] = (bids, asks)
        except Exception as e:
            logger.debug(f"DeepL2Aggregator poll err ({self.symbol}): {e}")

        if not books:
            return self.walls, self.summary

        # Infer mid price from responding books if caller did not supply current_price yet
        cp = float(current_price or 0.0)
        if cp <= 0:
            first_bids, first_asks = next(iter(books.values()))
            best_bid = max((float(b[0]) for b in first_bids if b and float(b[0]) > 0), default=0.0)
            best_ask = min((float(a[0]) for a in first_asks if a and float(a[0]) > 0), default=0.0)
            if best_bid > 0 and best_ask > 0:
                cp = (best_bid + best_ask) / 2.0
        if cp <= 0:
            return self.walls, self.summary

        walls, summary, merged_bids, merged_asks = self.aggregate_books(
            books=books,
            current_price=cp,
            range_pct=self.DEFAULT_RANGE_PCT,
        )
        self.walls = walls
        self.summary = summary
        self.merged_bids = merged_bids
        self.merged_asks = merged_asks
        self.last_updated_ts = time.time()
        return walls, summary

    @classmethod
    def aggregate_books(
        cls,
        books: Dict[str, Tuple[List[List[float]], List[List[float]]]],
        current_price: float,
        range_pct: float = 0.10,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[List[float]], List[List[float]]]:
        """
        Pure deterministic multi-exchange L2 aggregation engine (unit-testable, zero I/O).
        books: {exchange_id: (bids [[price, base_qty], ...], asks [[price, base_qty], ...])}
        Returns: (deep_l2_walls, deep_l2_summary, merged_bids, merged_asks)
        """
        if not books or current_price <= 0:
            return [], cls.empty_summary(), [], []

        cp = float(current_price)
        min_bid_px = cp * (1.0 - range_pct)
        max_ask_px = cp * (1.0 + range_pct)
        min_bid_5 = cp * 0.95
        max_ask_5 = cp * 1.05
        bin_size = max(1e-9, cp * cls.BIN_PCT)

        # Bin accumulators: bin_idx -> {"price", "total_usd", "base_qty", "by_ex": {ex: usd}}
        bid_bins: Dict[int, Dict[str, Any]] = {}
        ask_bins: Dict[int, Dict[str, Any]] = {}

        total_bids_10 = 0.0
        total_asks_10 = 0.0
        total_bids_5 = 0.0
        total_asks_5 = 0.0
        exchanges_active: List[str] = []

        for ex_id, (bids, asks) in books.items():
            if not bids and not asks:
                continue
            ex_contributed = False

            for lvl in bids:
                try:
                    p = float(lvl[0])
                    q = float(lvl[1])
                except (IndexError, TypeError, ValueError):
                    continue
                if p <= 0 or q <= 0 or p >= cp or p < min_bid_px:
                    continue
                usd = p * q
                total_bids_10 += usd
                if p >= min_bid_5:
                    total_bids_5 += usd
                ex_contributed = True

                b_idx = int(round(p / bin_size))
                entry = bid_bins.get(b_idx)
                if entry is None:
                    bid_bins[b_idx] = {
                        "price": b_idx * bin_size,
                        "total_usd": usd,
                        "base_qty": q,
                        "by_ex": {ex_id: usd},
                    }
                else:
                    entry["total_usd"] += usd
                    entry["base_qty"] += q
                    entry["by_ex"][ex_id] = entry["by_ex"].get(ex_id, 0.0) + usd

            for lvl in asks:
                try:
                    p = float(lvl[0])
                    q = float(lvl[1])
                except (IndexError, TypeError, ValueError):
                    continue
                if p <= 0 or q <= 0 or p <= cp or p > max_ask_px:
                    continue
                usd = p * q
                total_asks_10 += usd
                if p <= max_ask_5:
                    total_asks_5 += usd
                ex_contributed = True

                b_idx = int(round(p / bin_size))
                entry = ask_bins.get(b_idx)
                if entry is None:
                    ask_bins[b_idx] = {
                        "price": b_idx * bin_size,
                        "total_usd": usd,
                        "base_qty": q,
                        "by_ex": {ex_id: usd},
                    }
                else:
                    entry["total_usd"] += usd
                    entry["base_qty"] += q
                    entry["by_ex"][ex_id] = entry["by_ex"].get(ex_id, 0.0) + usd

            if ex_contributed:
                exchanges_active.append(ex_id)

        if not exchanges_active:
            return [], cls.empty_summary(), [], []

        # Extract top institutional walls per side (excluding noise < 0.35% away already shown in inner spread)
        def _extract_walls(bins_map: Dict[int, Dict[str, Any]], side: str) -> List[Dict[str, Any]]:
            candidates = [
                b for b in bins_map.values()
                if abs(b["price"] - cp) / cp >= 0.0035
            ]
            if not candidates:
                candidates = list(bins_map.values())
            if not candidates:
                return []

            candidates.sort(key=lambda x: x["total_usd"], reverse=True)
            peak_usd = max(1.0, candidates[0]["total_usd"])
            out: List[Dict[str, Any]] = []
            for b in candidates[: cls.MAX_WALLS_PER_SIDE * 2]:
                ratio = b["total_usd"] / peak_usd
                if ratio < cls.MIN_WALL_RATIO and len(out) >= 3:
                    continue
                # Count exchanges that meaningfully contribute (>= 10% of this bin's USD)
                sig_ex = [
                    ex for ex, v in sorted(b["by_ex"].items(), key=lambda kv: kv[1], reverse=True)
                    if v >= b["total_usd"] * 0.10
                ]
                if not sig_ex:
                    sig_ex = list(b["by_ex"].keys())
                ex_count = len(sig_ex)
                intensity = min(100, max(20, int(round(ratio * 100))))
                dist_pct = round(abs(b["price"] - cp) / cp * 100.0, 2)
                out.append({
                    "price": round(b["price"], 8),
                    "side": side,
                    "total_usd": round(b["total_usd"]),
                    "intensity": intensity,
                    "dist_pct": dist_pct,
                    "exchanges": sig_ex,
                    "exchange_count": ex_count,
                    "is_confluence": ex_count >= 2,
                    "exchange_breakdown": {k: round(v) for k, v in b["by_ex"].items()},
                })
                if len(out) >= cls.MAX_WALLS_PER_SIDE:
                    break
            return out

        bid_walls = _extract_walls(bid_bins, "bid")
        ask_walls = _extract_walls(ask_bins, "ask")
        walls = sorted(bid_walls + ask_walls, key=lambda x: x["total_usd"], reverse=True)

        # Build compact merged depth arrays for Bookmap ±10% outer cloud enrichment
        merged_bids = sorted(
            [[round(b["price"], 8), round(b["base_qty"], 6)] for b in bid_bins.values()],
            key=lambda x: x[0],
            reverse=True,
        )
        merged_asks = sorted(
            [[round(a["price"], 8), round(a["base_qty"], 6)] for a in ask_bins.values()],
            key=lambda x: x[0],
        )

        total_10 = total_bids_10 + total_asks_10
        global_bid_ratio = round(total_bids_10 / total_10, 3) if total_10 > 0 else 0.5
        if global_bid_ratio >= 0.56:
            book_bias = "BID_HEAVY"
        elif global_bid_ratio <= 0.44:
            book_bias = "ASK_HEAVY"
        else:
            book_bias = "BALANCED"

        strongest_bid = bid_walls[0] if bid_walls else None
        strongest_ask = ask_walls[0] if ask_walls else None

        summary = {
            "range_pct": int(round(range_pct * 100)),
            "exchanges_active": exchanges_active,
            "exchange_count": len(exchanges_active),
            "total_bids_10pct_usd": round(total_bids_10),
            "total_asks_10pct_usd": round(total_asks_10),
            "total_bids_5pct_usd": round(total_bids_5),
            "total_asks_5pct_usd": round(total_asks_5),
            "global_bid_ratio": global_bid_ratio,
            "book_bias": book_bias,
            "strongest_bid_wall": {
                "price": strongest_bid["price"],
                "total_usd": strongest_bid["total_usd"],
                "dist_pct": strongest_bid["dist_pct"],
                "exchange_count": strongest_bid["exchange_count"],
                "exchanges": strongest_bid["exchanges"],
            } if strongest_bid else None,
            "strongest_ask_wall": {
                "price": strongest_ask["price"],
                "total_usd": strongest_ask["total_usd"],
                "dist_pct": strongest_ask["dist_pct"],
                "exchange_count": strongest_ask["exchange_count"],
                "exchanges": strongest_ask["exchanges"],
            } if strongest_ask else None,
        }
        return walls, summary, merged_bids, merged_asks

    def combine_with_live_inner_book(
        self,
        live_bids: List[List[float]],
        live_asks: List[List[float]],
        current_price: float,
        normalize_for_single_exchange: bool = False,
    ) -> Tuple[List[List[float]], List[List[float]]]:
        """
        Combines ultra-fresh primary-exchange inner WS L2 levels with deep multi-exchange
        outer depth levels (> 0.6% from price) so Bookmap clouds cover the full ±10% range
        without diluting inner-spread freshness.

        When normalize_for_single_exchange=True (used for Bookmap cloud rendering), outer
        multi-exchange quantities are divided by active exchange count so the 0.6% seam
        between single-exchange inner WS L2 and multi-exchange outer L2 has uniform contrast.
        """
        if current_price <= 0 or (not self.merged_bids and not self.merged_asks):
            return live_bids, live_asks
        # Skip stale deep data (> 45s old)
        if time.time() - self.last_updated_ts > 45.0:
            return live_bids, live_asks

        inner_bid_floor = current_price * 0.994
        inner_ask_ceil = current_price * 1.006

        ex_divisor = float(max(1, int(self.summary.get("exchange_count") or 1))) if normalize_for_single_exchange else 1.0
        outer_bids = [
            [b[0], b[1] / ex_divisor] for b in self.merged_bids if b[0] < inner_bid_floor
        ]
        outer_asks = [
            [a[0], a[1] / ex_divisor] for a in self.merged_asks if a[0] > inner_ask_ceil
        ]

        if not outer_bids and not outer_asks:
            return live_bids, live_asks

        # Keep live inner book for <0.6% and deep multi-exchange book for 0.6%..10%
        inner_bids = [b for b in live_bids if float(b[0]) >= inner_bid_floor]
        inner_asks = [a for a in live_asks if float(a[0]) <= inner_ask_ceil]
        return inner_bids + outer_bids, inner_asks + outer_asks

    async def _fetch_binance_depth(self, session: aiohttp.ClientSession) -> Optional[Tuple[List[List[float]], List[List[float]]]]:
        candidates = [self._norm_sym]
        if self._usdt_sym not in candidates:
            candidates.append(self._usdt_sym)
        for sym in candidates:
            try:
                url = f"https://fapi.binance.com/fapi/v1/depth?symbol={sym}&limit=1000"
                async with session.get(url) as resp:
                    if resp.status != 200:
                        continue
                    data = await resp.json()
                bids = [[float(b[0]), float(b[1])] for b in data.get("bids", [])]
                asks = [[float(a[0]), float(a[1])] for a in data.get("asks", [])]
                if bids and asks:
                    return (bids, asks)
            except Exception as e:
                logger.debug(f"DeepL2 Binance fetch err ({sym}): {e}")
        return None

    async def _fetch_bybit_depth(self, session: aiohttp.ClientSession) -> Optional[Tuple[List[List[float]], List[List[float]]]]:
        # Bybit linear USDT perps use {BASE}USDT (USDC perps use {BASE}PERP, not {BASE}USDC)
        candidates = [self._usdt_sym] if self._norm_sym.endswith(("USDC", "FDUSD", "BUSD")) else [self._norm_sym]
        if self._usdt_sym not in candidates:
            candidates.append(self._usdt_sym)
        for sym in candidates:
            try:
                url = f"https://api.bybit.com/v5/market/orderbook?category=linear&symbol={sym}&limit=500"
                async with session.get(url) as resp:
                    if resp.status != 200:
                        continue
                    payload = await resp.json()
                res = payload.get("result") or {}
                bids = [[float(b[0]), float(b[1])] for b in res.get("b", [])]
                asks = [[float(a[0]), float(a[1])] for a in res.get("a", [])]
                if bids and asks:
                    return (bids, asks)
            except Exception as e:
                logger.debug(f"DeepL2 Bybit fetch err ({sym}): {e}")
        return None

    async def _get_okx_ctval(self, session: aiohttp.ClientSession) -> Optional[float]:
        cached = self._okx_ctval_cache.get(self._okx_inst_id)
        now = time.time()
        if cached and (now - cached[1] < 3600.0):
            return cached[0]
        try:
            url = f"https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId={self._okx_inst_id}"
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                payload = await resp.json()
            items = payload.get("data") or []
            if not items:
                return None
            ct_val = float(items[0].get("ctVal") or 0.0)
            if ct_val > 0:
                self._okx_ctval_cache[self._okx_inst_id] = (ct_val, now)
                return ct_val
        except Exception as e:
            logger.debug(f"DeepL2 OKX ctVal fetch err ({self._okx_inst_id}): {e}")
        return None

    async def _fetch_okx_depth(self, session: aiohttp.ClientSession) -> Optional[Tuple[List[List[float]], List[List[float]]]]:
        try:
            ct_val = await self._get_okx_ctval(session)
            if not ct_val or ct_val <= 0:
                return None
            url = f"https://www.okx.com/api/v5/market/books?instId={self._okx_inst_id}&sz=400"
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                payload = await resp.json()
            items = payload.get("data") or []
            if not items:
                return None
            book = items[0]
            # Convert OKX swap contracts to exact base coin quantity via ctVal
            bids = [[float(b[0]), float(b[1]) * ct_val] for b in book.get("bids", [])]
            asks = [[float(a[0]), float(a[1]) * ct_val] for a in book.get("asks", [])]
            return (bids, asks) if bids and asks else None
        except Exception as e:
            logger.debug(f"DeepL2 OKX fetch err ({self._okx_inst_id}): {e}")
            return None

    async def _fetch_bitget_depth(self, session: aiohttp.ClientSession) -> Optional[Tuple[List[List[float]], List[List[float]]]]:
        # Bitget productType=USDT-FUTURES strictly requires {BASE}USDT (e.g., BTCUSDT)
        target_sym = self._usdt_sym if self._norm_sym.endswith(("USDC", "FDUSD", "BUSD")) else self._norm_sym
        try:
            url = (
                f"https://api.bitget.com/api/v2/mix/market/depth"
                f"?productType=USDT-FUTURES&symbol={target_sym}&limit=100"
            )
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                payload = await resp.json()
            data = payload.get("data") or {}
            bids = [[float(b[0]), float(b[1])] for b in data.get("bids", [])]
            asks = [[float(a[0]), float(a[1])] for a in data.get("asks", [])]
            return (bids, asks) if bids and asks else None
        except Exception as e:
            logger.debug(f"DeepL2 Bitget fetch err ({target_sym}): {e}")
            return None
