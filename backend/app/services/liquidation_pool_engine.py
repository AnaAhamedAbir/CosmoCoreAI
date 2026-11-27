import asyncio
import logging
import time
from typing import Dict, Any, List, Optional, Tuple
import aiohttp

from app.services.derivatives_service import derivatives_service, _normalize_futures_symbol

logger = logging.getLogger(__name__)


SUPPORTED_POOL_HORIZONS = ("24h", "3d", "7d")


def normalize_pool_horizon(horizon: Optional[str]) -> str:
    h = str(horizon or "24h").strip().lower()
    if h in SUPPORTED_POOL_HORIZONS:
        return h
    return "24h"


# Per-horizon institutional pool configuration:
# - kline_interval / kline_limit: price bars covering the full lookback window
# - oi_period / oi_limit: matching historical Open Interest resolution
# - bin_pct: cluster width (% of current price)
# - range_pct: max distance from current price to include in active pools
# - tiers: (leverage, base_weight) distribution across leverage cohorts
POOL_HORIZON_CONFIGS: Dict[str, Dict[str, Any]] = {
    "24h": {
        "kline_interval": "15m",
        "kline_limit": 96,
        "oi_period": "15m",
        "oi_limit": 96,
        "bin_pct": 0.0015,
        "range_pct": 0.12,
        "oi_share_factor": 0.25,
        "max_pools": 14,
        "tiers": [(100, 0.24), (50, 0.34), (25, 0.25), (10, 0.13), (5, 0.04)],
    },
    "3d": {
        "kline_interval": "30m",
        "kline_limit": 144,
        "oi_period": "30m",
        "oi_limit": 144,
        "bin_pct": 0.0022,
        "range_pct": 0.18,
        "oi_share_factor": 0.38,
        "max_pools": 16,
        "tiers": [(100, 0.14), (50, 0.26), (25, 0.28), (10, 0.22), (5, 0.10)],
    },
    "7d": {
        "kline_interval": "1h",
        "kline_limit": 168,
        "oi_period": "1h",
        "oi_limit": 168,
        "bin_pct": 0.0030,
        "range_pct": 0.25,
        "oi_share_factor": 0.50,
        "max_pools": 18,
        "tiers": [(100, 0.08), (50, 0.20), (25, 0.27), (10, 0.28), (5, 0.17)],
    },
}


class LiquidationPoolEngine:
    """
    Institutional-grade Leveraged Liquidation Pool Engine (Priority #1 Upgrade).

    Core quantitative improvements over naive pivot projection:
    1. Real Open Interest Delta (ΔOI > 0) weighting via Binance/Bybit historical OI API
       combined with kline Taker Buy/Sell directional skew to isolate genuine new
       leveraged entries vs closing churn.
    2. Strict O(N) Swept-Pool Invalidation: eliminates any historical liquidation cluster
       whose price was already pierced/liquidated by subsequent candle highs/lows or
       current live price, guaranteeing 100% untapped liquidity zones.
    3. Multi-Horizon Lookback Support (24h / 3d / 7d) with 5x-100x leverage tiers
       and per-horizon caching.
    4. Real-time Multi-Exchange Liquidation Depletion & Instant Live-Price Sweep Pruning.
    """

    MMR = 0.004  # Standard ~0.4% maintenance margin buffer
    SWEEP_TOLERANCE = 0.0005  # 0.05% wick tolerance for confirmed sweep
    LIVE_DEPLETION_TTL_SEC = 300.0

    def __init__(self, symbol: str):
        self.symbol = symbol.upper()
        self._norm_sym = _normalize_futures_symbol(self.symbol)
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        # Recent live executed liquidations (from Binance/Bybit/OKX/Bitget) for real-time pool depletion
        self._live_depletions: List[Dict[str, Any]] = []

    def _get_lock(self, horizon: str) -> asyncio.Lock:
        if horizon not in self._locks:
            self._locks[horizon] = asyncio.Lock()
        return self._locks[horizon]

    def reset(self):
        self._cache.clear()
        self._live_depletions.clear()

    def has_cached(self, horizon: str = "24h") -> bool:
        return normalize_pool_horizon(horizon) in self._cache

    def get_cached(self, horizon: str = "24h") -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        h = normalize_pool_horizon(horizon)
        entry = self._cache.get(h)
        if not entry:
            return [], self._empty_summary(h)
        return entry["pools"], entry["summary"]

    @staticmethod
    def _empty_summary(horizon: str) -> Dict[str, Any]:
        return {
            "horizon": horizon,
            "total_short_liq_usd": 0,
            "total_long_liq_usd": 0,
            "imbalance_ratio": 0.5,
            "dominant_side": "BALANCED",
            "nearest_short_pool": None,
            "nearest_long_pool": None,
            "oi_weighted": False,
            "swept_count_filtered": 0,
        }

    def record_live_liquidation(self, price: float, usd_value: float, liq_side: str) -> None:
        """
        Records a real-time forced liquidation from any exchange (Binance/Bybit/OKX/Bitget)
        and immediately depletes matching cached pools across all horizons.
        liq_side: 'LONG_LIQ' (longs liquidated) or 'SHORT_LIQ' (shorts liquidated).
        """
        if price <= 0 or usd_value <= 0 or liq_side not in ("LONG_LIQ", "SHORT_LIQ"):
            return
        now = time.time()
        self._live_depletions.append({
            "time": now,
            "price": price,
            "usd": usd_value,
            "side": liq_side,
        })
        cutoff = now - self.LIVE_DEPLETION_TTL_SEC
        if len(self._live_depletions) > 300:
            self._live_depletions = [d for d in self._live_depletions if d["time"] >= cutoff]

        # Apply live depletion directly to cached pools so UI reflects exhaustion instantly
        for h, entry in self._cache.items():
            pools = entry.get("pools")
            if not pools:
                continue
            changed = False
            for pool in pools:
                if pool.get("side") != liq_side:
                    continue
                p_price = float(pool.get("price", 0))
                if p_price <= 0:
                    continue
                if abs(p_price - price) / p_price <= 0.004:
                    prev_est = float(pool.get("estimated_usd", 0))
                    prev_dep = float(pool.get("depleted_usd", 0))
                    new_dep = prev_dep + usd_value
                    new_est = max(0.0, prev_est - usd_value)
                    pool["depleted_usd"] = round(new_dep)
                    pool["estimated_usd"] = round(new_est)
                    orig_est = max(1.0, prev_est + prev_dep)
                    remain_ratio = new_est / orig_est
                    pool["intensity"] = max(10, int(round(pool.get("base_intensity", pool["intensity"]) * remain_ratio)))
                    pool["is_sweeping"] = True
                    changed = True
            if changed:
                # Drop fully exhausted pools (< 10% remaining)
                entry["pools"] = [
                    p for p in pools
                    if float(p.get("estimated_usd", 0)) > 0 and p.get("intensity", 0) >= 12
                ]
                cp = float(entry.get("last_price", 0))
                if cp > 0:
                    entry["summary"] = self._build_summary(
                        entry["pools"],
                        cp,
                        h,
                        oi_weighted=bool(entry["summary"].get("oi_weighted", False)),
                        swept_count=int(entry["summary"].get("swept_count_filtered", 0)),
                    )

    def prune_swept_by_live_price(self, current_price: float) -> bool:
        """
        Ultra-fast in-memory invalidation on live price ticks: if live price crosses
        a cached pool between 30s REST refreshes, immediately prune it so traders never
        chase a pool that was just wiped out seconds ago.
        """
        if current_price <= 0 or not self._cache:
            return False

        any_pruned = False
        for h, entry in self._cache.items():
            pools = entry.get("pools")
            if not pools:
                continue
            entry["last_price"] = current_price
            remaining = []
            pruned_here = 0
            for pool in pools:
                p_price = float(pool.get("price", 0))
                side = pool.get("side")
                if side == "SHORT_LIQ" and current_price >= p_price * (1.0 - self.SWEEP_TOLERANCE):
                    pruned_here += 1
                    continue
                if side == "LONG_LIQ" and current_price <= p_price * (1.0 + self.SWEEP_TOLERANCE):
                    pruned_here += 1
                    continue
                pool["dist_pct"] = round(abs(p_price - current_price) / current_price * 100.0, 2)
                remaining.append(pool)
            if pruned_here > 0:
                any_pruned = True
                entry["pools"] = remaining
                prev_swept = int(entry["summary"].get("swept_count_filtered", 0))
                entry["summary"] = self._build_summary(
                    remaining,
                    current_price,
                    h,
                    oi_weighted=bool(entry["summary"].get("oi_weighted", False)),
                    swept_count=prev_swept + pruned_here,
                )
            else:
                # Keep nearest-pool distance percentages live as price moves between REST refreshes
                summary = entry.get("summary")
                if summary:
                    ns = summary.get("nearest_short_pool")
                    if ns and ns.get("price"):
                        ns["dist_pct"] = round(abs(float(ns["price"]) - current_price) / current_price * 100.0, 2)
                    nl = summary.get("nearest_long_pool")
                    if nl and nl.get("price"):
                        nl["dist_pct"] = round(abs(float(nl["price"]) - current_price) / current_price * 100.0, 2)
        return any_pruned

    async def compute_pools(
        self,
        horizon: str = "24h",
        current_price: float = 0.0,
        open_interest_usd: float = 0.0,
        quote_volume_24h: float = 0.0,
        force: bool = False,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Fetches klines + historical OI for the requested horizon, runs OI-delta & taker-skew
        anchor weighting + strict O(N) swept-pool invalidation, and returns (pools, summary).
        """
        h = normalize_pool_horizon(horizon)
        now = time.time()
        cached = self._cache.get(h)
        if not force and cached and (now - cached["ts"] < 25.0):
            if current_price > 0:
                self.prune_swept_by_live_price(current_price)
            return cached["pools"], cached["summary"]

        async with self._get_lock(h):
            now = time.time()
            cached = self._cache.get(h)
            if not force and cached and (now - cached["ts"] < 25.0):
                return cached["pools"], cached["summary"]

            cfg = POOL_HORIZON_CONFIGS[h]
            klines_task = self._fetch_klines(cfg["kline_interval"], cfg["kline_limit"])
            oi_task = derivatives_service.get_open_interest_history(
                self.symbol,
                period=cfg["oi_period"],
                limit=cfg["oi_limit"],
            )
            klines, oi_series = await asyncio.gather(klines_task, oi_task, return_exceptions=True)

            if isinstance(klines, Exception) or not klines or len(klines) < 10:
                if cached:
                    return cached["pools"], cached["summary"]
                return [], self._empty_summary(h)

            if isinstance(oi_series, Exception) or not isinstance(oi_series, list):
                oi_series = []

            cp = current_price if current_price > 0 else float(klines[-1]["close"])
            if cp <= 0:
                return [], self._empty_summary(h)

            # Use live OI if provided, otherwise fall back to latest historical OI reading before $1M floor
            effective_oi = open_interest_usd
            if effective_oi <= 0 and oi_series:
                latest_oi = float(oi_series[-1].get("oi_usd", 0.0) or 0.0)
                if latest_oi > 0:
                    effective_oi = latest_oi

            pools, summary = self.build_pools_from_bars(
                bars=klines,
                oi_series=oi_series,
                current_price=cp,
                open_interest_usd=effective_oi,
                quote_volume_24h=quote_volume_24h,
                horizon=h,
            )

            # Apply any recent live depletions from the last 5 minutes
            self._apply_recent_depletions(pools, cp, h, summary)

            self._cache[h] = {
                "ts": time.time(),
                "last_price": cp,
                "pools": pools,
                "summary": summary,
            }
            return pools, summary

    def _apply_recent_depletions(
        self,
        pools: List[Dict[str, Any]],
        current_price: float,
        horizon: str,
        summary: Dict[str, Any],
    ) -> None:
        now = time.time()
        cutoff = now - self.LIVE_DEPLETION_TTL_SEC
        self._live_depletions = [d for d in self._live_depletions if d["time"] >= cutoff]
        if not self._live_depletions or not pools:
            return
        changed = False
        for dep in self._live_depletions:
            for pool in pools:
                if pool.get("side") != dep["side"]:
                    continue
                p_price = float(pool.get("price", 0))
                if p_price > 0 and abs(p_price - dep["price"]) / p_price <= 0.004:
                    prev_est = float(pool.get("estimated_usd", 0))
                    prev_dep = float(pool.get("depleted_usd", 0))
                    new_dep = prev_dep + dep["usd"]
                    new_est = max(0.0, prev_est - dep["usd"])
                    pool["depleted_usd"] = round(new_dep)
                    pool["estimated_usd"] = round(new_est)
                    orig_est = max(1.0, prev_est + prev_dep)
                    remain_ratio = new_est / orig_est
                    pool["intensity"] = max(10, int(round(pool.get("base_intensity", pool["intensity"]) * remain_ratio)))
                    pool["is_sweeping"] = True
                    changed = True
        if changed:
            # Drop fully exhausted pools consistently with record_live_liquidation
            pools[:] = [
                p for p in pools
                if float(p.get("estimated_usd", 0)) > 0 and p.get("intensity", 0) >= 12
            ]
            summary.update(
                self._build_summary(
                    pools,
                    current_price,
                    horizon,
                    oi_weighted=bool(summary.get("oi_weighted", False)),
                    swept_count=int(summary.get("swept_count_filtered", 0)),
                )
            )

    @classmethod
    def build_pools_from_bars(
        cls,
        bars: List[Dict[str, float]],
        oi_series: List[Dict[str, float]],
        current_price: float,
        open_interest_usd: float = 0.0,
        quote_volume_24h: float = 0.0,
        horizon: str = "24h",
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Pure deterministic computation of OI-weighted, sweep-invalidated liquidation pools.
        Separated as a classmethod for unit testing and zero I/O coupling.
        """
        h = normalize_pool_horizon(horizon)
        cfg = POOL_HORIZON_CONFIGS[h]
        n = len(bars)
        if n < 6 or current_price <= 0:
            return [], cls._empty_summary(h)

        highs = [float(b["high"]) for b in bars]
        lows = [float(b["low"]) for b in bars]
        opens = [float(b["open"]) for b in bars]
        closes = [float(b["close"]) for b in bars]
        quote_vols = [max(0.0, float(b.get("quote_vol", 0.0))) for b in bars]
        taker_buy_vols = [max(0.0, float(b.get("taker_buy_quote_vol", 0.0))) for b in bars]
        timestamps = [int(b.get("time", 0)) for b in bars]

        avg_vol = max(1.0, sum(quote_vols) / n)

        # --- 1. Pre-compute O(N) suffix extremes for strict Swept-Pool Invalidation ---
        # suffix_max_high[i] = max high strictly AFTER bar i
        # suffix_min_low[i]  = min low strictly AFTER bar i
        suffix_max_high = [0.0] * n
        suffix_min_low = [float("inf")] * n
        running_high = current_price
        running_low = current_price
        for i in range(n - 1, -1, -1):
            suffix_max_high[i] = running_high
            suffix_min_low[i] = running_low
            if highs[i] > running_high:
                running_high = highs[i]
            if lows[i] < running_low:
                running_low = lows[i]

        # --- 2. Align Historical Open Interest series to bars and compute ΔOI ---
        oi_deltas: List[Optional[float]] = [None] * n
        oi_weighted = False
        if oi_series and len(oi_series) >= 5:
            # Sort OI snapshots ascending by timestamp (ms)
            sorted_oi = sorted(oi_series, key=lambda x: int(x.get("timestamp", 0)))
            oi_ts = [int(x["timestamp"]) for x in sorted_oi]
            oi_vals = [float(x.get("oi_usd", 0.0)) for x in sorted_oi]
            # Infer bar step in ms for alignment tolerance
            bar_step_ms = max(60_000, abs(timestamps[-1] - timestamps[-2])) if n >= 2 else 900_000
            max_align_diff = bar_step_ms * 1.6

            matched_oi: List[Optional[float]] = [None] * n
            j = 0
            m = len(oi_ts)
            for i in range(n):
                bt = timestamps[i]
                while j + 1 < m and abs(oi_ts[j + 1] - bt) <= abs(oi_ts[j] - bt):
                    j += 1
                if abs(oi_ts[j] - bt) <= max_align_diff and oi_vals[j] > 0:
                    matched_oi[i] = oi_vals[j]

            valid_pos_deltas = []
            for i in range(1, n):
                if matched_oi[i] is not None and matched_oi[i - 1] is not None:
                    d_oi = matched_oi[i] - matched_oi[i - 1]
                    oi_deltas[i] = d_oi
                    if d_oi > 0:
                        valid_pos_deltas.append(d_oi)

            if len(valid_pos_deltas) >= 3:
                oi_weighted = True
                avg_pos_oi_delta = sum(valid_pos_deltas) / len(valid_pos_deltas)
            else:
                avg_pos_oi_delta = 1.0
        else:
            avg_pos_oi_delta = 1.0

        # --- 3. Detect Leveraged Entry Anchors (OI-Delta + Taker Skew + Pivot Structure) ---
        # Anchor tuple: (bar_idx, side: "LONG"|"SHORT", entry_price, weight)
        anchors: List[Tuple[int, str, float, float]] = []
        for i in range(1, n - 1):
            vol_ratio = min(3.5, quote_vols[i] / avg_vol) if avg_vol > 0 else 1.0
            recency = 0.55 + 0.45 * (i / max(1, n - 1))

            # Directional taker flow ratio (0..1; 0.5 if unavailable)
            if quote_vols[i] > 0 and taker_buy_vols[i] > 0:
                buy_ratio = max(0.05, min(0.95, taker_buy_vols[i] / quote_vols[i]))
            else:
                # Fallback directional proxy from candle body
                body_range = max(1e-9, highs[i] - lows[i])
                buy_ratio = max(0.15, min(0.85, (closes[i] - lows[i]) / body_range))
            sell_ratio = 1.0 - buy_ratio

            # Structural pivot bonuses (swing lows attract longs, swing highs attract shorts)
            lo_win = lows[max(0, i - 2) : min(n, i + 3)]
            hi_win = highs[max(0, i - 2) : min(n, i + 3)]
            is_swing_low = lows[i] <= min(lo_win)
            is_swing_high = highs[i] >= max(hi_win)

            # Open Interest delta multiplier:
            # Positive ΔOI = genuine NEW leveraged positions opened here (boost up to 3.2x)
            # Negative ΔOI = positions closing/unwinding (attenuate to 0.25x unless major pivot)
            d_oi = oi_deltas[i]
            if oi_weighted and d_oi is not None:
                if d_oi > 0:
                    oi_mult = min(3.2, 0.8 + (d_oi / max(1.0, avg_pos_oi_delta)))
                else:
                    # Positions were closing on this bar; heavily discount unless structural pivot
                    oi_mult = 0.25
            else:
                oi_mult = 1.0

            # Skip low-activity noise bars (keep OI spikes, volume spikes, or structural pivots)
            is_significant_bar = (
                is_swing_low
                or is_swing_high
                or vol_ratio >= 1.15
                or (oi_weighted and d_oi is not None and d_oi >= avg_pos_oi_delta * 0.6)
            )
            if not is_significant_bar:
                continue

            # Typical entry price proxy (VWAP-like midpoint of bar)
            bar_mid = (opens[i] + closes[i] + highs[i] + lows[i]) * 0.25

            # Long entry cohort (weighted by taker buys + OI buildup + swing low support)
            long_pivot_boost = 1.45 if is_swing_low else 1.0
            long_entry_px = (lows[i] * 0.4 + bar_mid * 0.6) if is_swing_low else bar_mid
            long_weight = vol_ratio * oi_mult * (0.4 + 1.2 * buy_ratio) * long_pivot_boost * recency
            if long_weight >= 0.45 and (is_swing_low or buy_ratio >= 0.46 or (d_oi is not None and d_oi > 0)):
                anchors.append((i, "LONG", long_entry_px, long_weight))

            # Short entry cohort (weighted by taker sells + OI buildup + swing high resistance)
            short_pivot_boost = 1.45 if is_swing_high else 1.0
            short_entry_px = (highs[i] * 0.4 + bar_mid * 0.6) if is_swing_high else bar_mid
            short_weight = vol_ratio * oi_mult * (0.4 + 1.2 * sell_ratio) * short_pivot_boost * recency
            if short_weight >= 0.45 and (is_swing_high or sell_ratio >= 0.46 or (d_oi is not None and d_oi > 0)):
                anchors.append((i, "SHORT", short_entry_px, short_weight))

        if not anchors:
            return [], cls._empty_summary(h)

        # --- 4. Project Leverage Tiers & Eliminate Already-Swept Levels ---
        tiers: List[Tuple[int, float]] = cfg["tiers"]
        bin_size = max(1e-9, current_price * cfg["bin_pct"])
        range_pct = float(cfg["range_pct"])
        min_long_px = current_price * (1.0 - range_pct)
        max_short_px = current_price * (1.0 + range_pct)

        pools_by_bin: Dict[Tuple[str, int], Dict[str, Any]] = {}
        swept_count_filtered = 0

        for bar_idx, side, anchor_price, bar_weight in anchors:
            post_high = suffix_max_high[bar_idx]
            post_low = suffix_min_low[bar_idx]

            for lev, lev_weight in tiers:
                offset = (1.0 / lev) - cls.MMR
                if offset <= 0.002:
                    continue

                if side == "LONG":
                    liq_price = anchor_price * (1.0 - offset)
                    pool_side = "LONG_LIQ"
                    # Must remain strictly below current price & within display range
                    if liq_price >= current_price * (1.0 - 0.0018) or liq_price < min_long_px:
                        continue
                    # STRICT SWEPT-POOL INVALIDATION: if any later candle low pierced this level, longs here are ALREADY REKT!
                    if post_low <= liq_price * (1.0 + cls.SWEEP_TOLERANCE):
                        swept_count_filtered += 1
                        continue
                else:
                    liq_price = anchor_price * (1.0 + offset)
                    pool_side = "SHORT_LIQ"
                    # Must remain strictly above current price & within display range
                    if liq_price <= current_price * (1.0 + 0.0018) or liq_price > max_short_px:
                        continue
                    # STRICT SWEPT-POOL INVALIDATION: if any later candle high pierced this level, shorts here are ALREADY REKT!
                    if post_high >= liq_price * (1.0 - cls.SWEEP_TOLERANCE):
                        swept_count_filtered += 1
                        continue

                bin_idx = int(round(liq_price / bin_size))
                key = (pool_side, bin_idx)
                score = bar_weight * lev_weight
                lev_label = f"{lev}x"

                if key not in pools_by_bin:
                    pools_by_bin[key] = {
                        "price": bin_idx * bin_size,
                        "side": pool_side,
                        "leverage": lev_label,
                        "score": score,
                        "dominant_lev_score": score,
                        "tier_scores": {lev_label: score},
                        "hits": 1,
                    }
                else:
                    entry = pools_by_bin[key]
                    entry["score"] += score
                    entry["hits"] += 1
                    entry["tier_scores"][lev_label] = entry["tier_scores"].get(lev_label, 0.0) + score
                    if entry["tier_scores"][lev_label] > entry["dominant_lev_score"]:
                        entry["dominant_lev_score"] = entry["tier_scores"][lev_label]
                        entry["leverage"] = lev_label

        if not pools_by_bin:
            summary = cls._empty_summary(h)
            summary["oi_weighted"] = oi_weighted
            summary["swept_count_filtered"] = swept_count_filtered
            return [], summary

        # --- 5. Normalize USD Estimates against Live Open Interest & Balance Above/Below ---
        oi_ref = open_interest_usd if open_interest_usd > 0 else max(1_000_000.0, quote_volume_24h * 0.15)
        max_pools = int(cfg["max_pools"])
        half_cap = max(4, max_pools // 2)

        short_bins = sorted(
            [p for p in pools_by_bin.values() if p["side"] == "SHORT_LIQ"],
            key=lambda x: x["score"],
            reverse=True,
        )[:half_cap]
        long_bins = sorted(
            [p for p in pools_by_bin.values() if p["side"] == "LONG_LIQ"],
            key=lambda x: x["score"],
            reverse=True,
        )[:half_cap]

        selected = sorted(short_bins + long_bins, key=lambda x: x["score"], reverse=True)[:max_pools]
        max_score = max((p["score"] for p in selected), default=1.0) or 1.0
        total_score = sum(p["score"] for p in pools_by_bin.values()) or 1.0
        oi_share = float(cfg["oi_share_factor"])

        formatted_pools: List[Dict[str, Any]] = []
        for p in selected:
            intensity = min(100, max(18, int((p["score"] / max_score) * 100)))
            est_usd = round((p["score"] / total_score) * oi_ref * oi_share)
            dist_pct = round(abs(p["price"] - current_price) / current_price * 100.0, 2)
            # Top 2 contributing leverage tiers for tooltip transparency
            top_tiers = sorted(p["tier_scores"].items(), key=lambda kv: kv[1], reverse=True)[:2]
            tier_breakdown = "/".join(k for k, _ in top_tiers)

            formatted_pools.append({
                "price": p["price"],
                "intensity": intensity,
                "base_intensity": intensity,
                "estimated_usd": est_usd,
                "depleted_usd": 0,
                "is_sweeping": False,
                "side": p["side"],
                "leverage": p["leverage"],
                "tier_breakdown": tier_breakdown,
                "dist_pct": dist_pct,
                "horizon": h,
                "oi_weighted": oi_weighted,
                "source": "OI_DELTA_POOL" if oi_weighted else "LEVERAGE_POOL",
            })

        summary = cls._build_summary(
            formatted_pools,
            current_price,
            h,
            oi_weighted=oi_weighted,
            swept_count=swept_count_filtered,
        )
        return formatted_pools, summary

    @staticmethod
    def _build_summary(
        pools: List[Dict[str, Any]],
        current_price: float,
        horizon: str,
        oi_weighted: bool = False,
        swept_count: int = 0,
    ) -> Dict[str, Any]:
        short_pools = [p for p in pools if p.get("side") == "SHORT_LIQ"]
        long_pools = [p for p in pools if p.get("side") == "LONG_LIQ"]

        total_short = sum(int(p.get("estimated_usd", 0)) for p in short_pools)
        total_long = sum(int(p.get("estimated_usd", 0)) for p in long_pools)
        total_all = total_short + total_long
        imbalance_ratio = round(total_short / total_all, 3) if total_all > 0 else 0.5

        if imbalance_ratio >= 0.58:
            dominant_side = "ABOVE"
        elif imbalance_ratio <= 0.42:
            dominant_side = "BELOW"
        else:
            dominant_side = "BALANCED"

        nearest_short = None
        if short_pools and current_price > 0:
            ns = min(short_pools, key=lambda p: abs(float(p["price"]) - current_price))
            nearest_short = {
                "price": ns["price"],
                "estimated_usd": ns["estimated_usd"],
                "leverage": ns["leverage"],
                "dist_pct": round(abs(float(ns["price"]) - current_price) / current_price * 100.0, 2),
            }

        nearest_long = None
        if long_pools and current_price > 0:
            nl = min(long_pools, key=lambda p: abs(float(p["price"]) - current_price))
            nearest_long = {
                "price": nl["price"],
                "estimated_usd": nl["estimated_usd"],
                "leverage": nl["leverage"],
                "dist_pct": round(abs(float(nl["price"]) - current_price) / current_price * 100.0, 2),
            }

        return {
            "horizon": horizon,
            "total_short_liq_usd": total_short,
            "total_long_liq_usd": total_long,
            "imbalance_ratio": imbalance_ratio,
            "dominant_side": dominant_side,
            "nearest_short_pool": nearest_short,
            "nearest_long_pool": nearest_long,
            "oi_weighted": oi_weighted,
            "swept_count_filtered": swept_count,
        }

    async def _fetch_klines(self, interval: str, limit: int) -> List[Dict[str, float]]:
        """Fetches Binance Futures klines (with taker buy quote vol) and Bybit v5 fallback."""
        timeout = aiohttp.ClientTimeout(total=6.0)
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={self._norm_sym}&interval={interval}&limit={limit}"
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        raw = await resp.json()
                        if isinstance(raw, list) and len(raw) >= 6:
                            return [
                                {
                                    "time": int(k[0]),
                                    "open": float(k[1]),
                                    "high": float(k[2]),
                                    "low": float(k[3]),
                                    "close": float(k[4]),
                                    "quote_vol": float(k[7]),
                                    "taker_buy_quote_vol": float(k[10]) if len(k) > 10 else 0.0,
                                }
                                for k in raw
                            ]
        except Exception as e:
            logger.debug(f"Binance futures kline fetch err ({self._norm_sym}/{interval}): {e}")

        # Bybit v5 linear kline fallback
        bybit_interval_map = {"15m": "15", "30m": "30", "1h": "60"}
        bybit_int = bybit_interval_map.get(interval, "15")
        try:
            url = f"https://api.bybit.com/v5/market/kline?category=linear&symbol={self._norm_sym}&interval={bybit_int}&limit={limit}"
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        payload = await resp.json()
                        items = payload.get("result", {}).get("list", [])
                        if isinstance(items, list) and len(items) >= 6:
                            # Bybit returns newest-first; reverse to ascending chronological order
                            items = list(reversed(items))
                            return [
                                {
                                    "time": int(k[0]),
                                    "open": float(k[1]),
                                    "high": float(k[2]),
                                    "low": float(k[3]),
                                    "close": float(k[4]),
                                    "quote_vol": float(k[6]) if len(k) > 6 else float(k[5]) * float(k[4]),
                                    "taker_buy_quote_vol": 0.0,
                                }
                                for k in items
                            ]
        except Exception as e:
            logger.debug(f"Bybit futures kline fallback err ({self._norm_sym}/{interval}): {e}")

        return []
