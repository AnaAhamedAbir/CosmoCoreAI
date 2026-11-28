import asyncio
import json
import logging
import math
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from app.core.redis import redis_manager
from app.utils.candle_time import align_candle_bucket_sec, parse_timestamp_ms

logger = logging.getLogger(__name__)


def compute_adaptive_footprint_step(price: float) -> float:
    """
    Computes a clean Exocharts/ATAS-style price cluster step (~0.04% of price,
    snapped to 1/2/5 * 10^n) so each candle produces ~6-18 legible Bid x Ask rows
    instead of 500 overlapping micro-rows on BTC or 1 flat row on DOGE.
    """
    if not price or not math.isfinite(price) or price <= 0:
        return 0.5
    target = price * 0.0004
    exp = math.floor(math.log10(target))
    base = 10.0 ** exp
    ratio = target / base
    if ratio < 1.5:
        step = 1.0 * base
    elif ratio < 3.5:
        step = 2.0 * base
    elif ratio < 7.5:
        step = 5.0 * base
    else:
        step = 10.0 * base
    return round(step, max(0, -exp + 2))


def enrich_footprint_candle(candle: Dict[str, Any], tick_step: float) -> Dict[str, Any]:
    """
    Computes institutional Exocharts/ATAS footprint microstructure metrics on a candle:
    - Exact Point of Control (POC)
    - 300% Diagonal Bid/Ask Imbalances (ask[p] >= 3 * bid[p - step], bid[p] >= 3 * ask[p + step])
    - Stacked Imbalances (3+ consecutive same-side diagonal imbalances)
    - Unfinished Auction at candle High/Low extremes
    - Absorption Nodes (volume > 3x average row volume)
    - Total Delta, Total Volume, and Bullish/Bearish Delta Divergence
    """
    raw_ticks = candle.get("ticks", [])
    if not raw_ticks:
        return candle

    # Sort descending (highest price at top, lowest at bottom)
    ticks = sorted(raw_ticks, key=lambda t: float(t["price"]), reverse=True)
    n = len(ticks)

    total_vol = 0.0
    total_delta = 0.0
    max_row_vol = -1.0
    poc_price = float(ticks[0]["price"])

    for t in ticks:
        bv = float(t.get("bidVolume") or 0.0)
        av = float(t.get("askVolume") or 0.0)
        rv = bv + av
        total_vol += rv
        total_delta += (av - bv)
        if rv > max_row_vol:
            max_row_vol = rv
            poc_price = float(t["price"])
        t["isImbalance"] = False
        t["imbalanceType"] = None
        t["isAskImbalance"] = False
        t["isBidImbalance"] = False
        t["isStackedImbalance"] = False
        t["isUnfinishedAuction"] = False
        t["isAbsorption"] = False

    avg_row_vol = (total_vol / n) if n > 0 else 0.0
    min_meaningful_vol = max(avg_row_vol * 0.25, 1e-9)
    step_tol = max(tick_step * 0.15, 1e-9) if tick_step > 0 else 1e-9

    def _is_adjacent(higher_p: float, lower_p: float) -> bool:
        if tick_step <= 0:
            return True
        return abs((higher_p - lower_p) - tick_step) <= step_tol

    # 1. Diagonal 300% Imbalances (descending order: i+1 is 1 step LOWER, i-1 is 1 step HIGHER)
    for i in range(n):
        t = ticks[i]
        cur_p = float(t["price"])
        bv = float(t["bidVolume"])
        av = float(t["askVolume"])
        rv = bv + av

        ask_ratio = 0.0
        bid_ratio = 0.0

        # Ask (buy) diagonal imbalance compares ask[i] against bid[i+1] ONLY when contiguous (1 tick_step lower)
        if i + 1 < n and _is_adjacent(cur_p, float(ticks[i + 1]["price"])):
            lower_bid = float(ticks[i + 1]["bidVolume"])
            if av >= min_meaningful_vol and (
                (lower_bid > 0 and av >= lower_bid * 3.0)
                or (lower_bid == 0 and av >= avg_row_vol * 1.25)
            ):
                t["isAskImbalance"] = True
                ask_ratio = (av / lower_bid) if lower_bid > 0 else 99.0

        # Bid (sell) diagonal imbalance compares bid[i] against ask[i-1] ONLY when contiguous (1 tick_step higher)
        if i - 1 >= 0 and _is_adjacent(float(ticks[i - 1]["price"]), cur_p):
            higher_ask = float(ticks[i - 1]["askVolume"])
            if bv >= min_meaningful_vol and (
                (higher_ask > 0 and bv >= higher_ask * 3.0)
                or (higher_ask == 0 and bv >= avg_row_vol * 1.25)
            ):
                t["isBidImbalance"] = True
                bid_ratio = (bv / higher_ask) if higher_ask > 0 else 99.0

        if t["isAskImbalance"] or t["isBidImbalance"]:
            t["isImbalance"] = True
            t["imbalanceType"] = "ask" if ask_ratio >= bid_ratio else "bid"

        # 2. Unfinished Auction at top (high) or bottom (low) extreme (requires >= 2 distinct price rows)
        if n >= 2 and (i == 0 or i == n - 1) and bv > 0 and av > 0:
            t["isUnfinishedAuction"] = True

        # 3. Absorption Node (> 3x average row volume)
        if avg_row_vol > 0 and rv > (avg_row_vol * 3.0):
            t["isAbsorption"] = True

    # 4. Stacked Imbalance (3+ contiguous same-side diagonal imbalances)
    for i in range(n - 2):
        t0, t1, t2 = ticks[i], ticks[i + 1], ticks[i + 2]
        if not (_is_adjacent(float(t0["price"]), float(t1["price"])) and _is_adjacent(float(t1["price"]), float(t2["price"]))):
            continue
        if (t0["isAskImbalance"] and t1["isAskImbalance"] and t2["isAskImbalance"]) or (
            t0["isBidImbalance"] and t1["isBidImbalance"] and t2["isBidImbalance"]
        ):
            t0["isStackedImbalance"] = True
            t1["isStackedImbalance"] = True
            t2["isStackedImbalance"] = True

    c_open = float(candle.get("open") or ticks[-1]["price"])
    c_close = float(candle.get("close") or ticks[0]["price"])
    div_type = None
    if c_close > c_open and total_delta < 0:
        div_type = "bearish"
    elif c_close < c_open and total_delta > 0:
        div_type = "bullish"

    candle["ticks"] = ticks
    candle["pocPrice"] = poc_price
    candle["totalDelta"] = round(total_delta, 6)
    candle["totalVolume"] = round(total_vol, 6)
    candle["hasDeltaDivergence"] = div_type is not None
    candle["divergenceType"] = div_type
    candle["tickStep"] = tick_step
    return candle


class FootprintRecorder:
    """
    Modular Real-Trade Footprint Cluster Recorder (In-Memory + Redis Hash).

    - Records genuine trade-level Bid x Ask volume clusters at 1-minute base buckets
      (`footprint_1m:{internal_ex}:{SYMBOL}`, last 180 minutes = 3 hours) directly from
      `market_data_streamer` for every active exchange & pair.
    - Aggregates cleanly on read to any higher chart interval (`1m`, `3m`, `5m`, `15m`, `30m`, `1h`, etc.),
      so reloading the page preserves genuine institutional footprint clusters!
    """

    MAX_BASE_BARS: int = 180          # 3 hours of real 1m footprint bars per active pair
    MAX_TRACKED_SYMBOLS: int = 40     # Cap resident in-memory symbols to prevent unbounded RAM growth
    REDIS_TTL_SECONDS: int = 10800    # 3 hours TTL
    FLUSH_INTERVAL_SEC: float = 2.0
    PRUNE_INTERVAL_SEC: float = 60.0

    def __init__(self) -> None:
        # key -> OrderedDict[bar_sec_1m: int, raw_bar_dict]
        self._bars: Dict[str, "OrderedDict[int, Dict[str, Any]]"] = {}
        self._dirty: Dict[str, set[int]] = {}
        self._last_flush: Dict[str, float] = {}
        self._last_prune: Dict[str, float] = {}
        self._last_access: Dict[str, float] = {}
        self._hydrated: set[str] = set()
        self._hydrate_locks: Dict[str, asyncio.Lock] = {}

    def _evict_if_over_cap(self, keep_key: str) -> None:
        if len(self._bars) <= self.MAX_TRACKED_SYMBOLS:
            return
        candidates = sorted(
            ((self._last_access.get(k, 0.0), k) for k in self._bars if k != keep_key),
            key=lambda item: item[0],
        )
        while len(self._bars) > self.MAX_TRACKED_SYMBOLS and candidates:
            _, victim = candidates.pop(0)
            self._bars.pop(victim, None)
            self._dirty.pop(victim, None)
            self._last_flush.pop(victim, None)
            self._last_prune.pop(victim, None)
            self._last_access.pop(victim, None)
            self._hydrated.discard(victim)
            self._hydrate_locks.pop(victim, None)

    @staticmethod
    def _make_key(exchange_id: str, symbol: str) -> str:
        return f"{str(exchange_id or '').strip().lower()}:{str(symbol or '').strip().upper()}"

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"footprint_1m:{key}"

    async def record_trades(self, exchange_id: str, symbol: str, trades: List[Dict[str, Any]]) -> None:
        if not trades:
            return
        key = self._make_key(exchange_id, symbol)
        series = self._bars.setdefault(key, OrderedDict())
        dirty = self._dirty.setdefault(key, set())

        for t in trades:
            if not isinstance(t, dict):
                continue
            raw_ts = t.get("timestamp")
            raw_px = t.get("price")
            raw_amt = t.get("amount") or t.get("qty")
            if raw_ts is None or raw_px is None or raw_amt is None:
                continue
            try:
                ts_ms = parse_timestamp_ms(raw_ts)
                if ts_ms is None:
                    continue
                px = float(raw_px)
                amt = float(raw_amt)
            except (TypeError, ValueError):
                continue
            if px <= 0 or amt <= 0:
                continue

            side = str(t.get("side") or "").lower()
            is_buy = side == "buy"

            bar_sec = (ts_ms // 60000) * 60
            bar = series.get(bar_sec)
            if bar is None:
                step = compute_adaptive_footprint_step(px)
                bar = {
                    "time": bar_sec,
                    "open": px,
                    "high": px,
                    "low": px,
                    "close": px,
                    "step": step,
                    "levels": {},  # str(bucket_price) -> [bidVol, askVol]
                }
                series[bar_sec] = bar
            else:
                if px > bar["high"]:
                    bar["high"] = px
                if px < bar["low"]:
                    bar["low"] = px
                bar["close"] = px

            step = float(bar["step"])
            decimals = max(2, min(10, -math.floor(math.log10(step)) + 2)) if step < 1 else 4
            b_px = round(math.floor((px / step) + 1e-9) * step, decimals)
            lv_key = str(b_px)
            lv = bar["levels"].get(lv_key)
            if lv is None:
                lv = [0.0, 0.0]
                bar["levels"][lv_key] = lv
            if is_buy:
                lv[1] += amt  # Aggressive buy hits Ask
            else:
                lv[0] += amt  # Aggressive sell hits Bid

            dirty.add(bar_sec)

        while len(series) > self.MAX_BASE_BARS:
            series.popitem(last=False)
        self._last_access[key] = time.time()
        self._evict_if_over_cap(key)

        now_mono = time.monotonic()
        if (now_mono - self._last_flush.get(key, 0.0)) >= self.FLUSH_INTERVAL_SEC:
            await self._flush_key(key)

    async def _flush_key(self, key: str) -> None:
        dirty = self._dirty.get(key)
        if not dirty:
            return
        redis = redis_manager.get_redis()
        if not redis:
            return
        series = self._bars.get(key)
        if not series:
            dirty.clear()
            return

        flushed_bars = list(dirty)
        mapping: Dict[str, str] = {}
        for b_sec in flushed_bars:
            bar = series.get(b_sec)
            if bar is not None:
                mapping[str(b_sec)] = json.dumps(bar, separators=(",", ":"))
        self._last_flush[key] = time.monotonic()

        if not mapping:
            dirty.difference_update(flushed_bars)
            return

        rkey = self._redis_key(key)
        try:
            async with redis.pipeline(transaction=False) as pipe:
                pipe.hset(rkey, mapping=mapping)
                pipe.expire(rkey, self.REDIS_TTL_SECONDS)
                await pipe.execute()

            # Only clear flushed bars AFTER Redis write succeeds so transient failures retry cleanly
            dirty.difference_update(flushed_bars)

            now = time.time()
            if (now - self._last_prune.get(key, 0.0)) >= self.PRUNE_INTERVAL_SEC:
                self._last_prune[key] = now
                cutoff = int(now) - (self.MAX_BASE_BARS * 60)
                fields = await redis.hkeys(rkey)
                stale = []
                for fld in fields or []:
                    f_str = fld.decode() if isinstance(fld, (bytes, bytearray)) else str(fld)
                    try:
                        if int(f_str) < cutoff:
                            stale.append(f_str)
                    except ValueError:
                        stale.append(f_str)
                if stale:
                    await redis.hdel(rkey, *stale)
        except Exception as e:
            logger.debug(f"[FootprintRecorder] Redis flush err for {key}: {e}")

    async def get_footprint_candles(
        self,
        exchange_id: str,
        symbol: str,
        interval: str = "1m",
        limit: int = 120,
    ) -> Dict[str, Any]:
        """
        Returns real trade-clustered footprint candles aggregated to `interval`,
        with exact POC, 300% diagonal imbalances, stacked imbalances, unfinished auctions,
        absorption nodes, and true delta divergence.
        """
        from app.services.market_depth_service import market_depth_service

        norm_sym = str(symbol or "").strip().upper()
        base_ex, internal_ex = market_depth_service.normalize_exchange_id(exchange_id, norm_sym)
        key = self._make_key(internal_ex, norm_sym)
        raw_interval_sec = market_depth_service._timeframe_to_seconds(interval)
        # Base recorder stores 1m bars; for sub-minute intervals (<60s), return empty so frontend
        # builds exact sub-minute live clusters aligned to every 1s/5s/15s/30s bar.
        if raw_interval_sec < 60:
            return {
                "symbol": norm_sym,
                "exchange": base_ex,
                "interval": interval,
                "tick_step": 0.0,
                "candles": [],
            }
        interval_sec = raw_interval_sec

        self._last_access[key] = time.time()

        if key not in self._hydrated:
            lock = self._hydrate_locks.setdefault(key, asyncio.Lock())
            async with lock:
                if key not in self._hydrated:
                    redis = redis_manager.get_redis()
                    if redis:
                        try:
                            raw_map = await redis.hgetall(self._redis_key(key))
                            if raw_map:
                                series = self._bars.setdefault(key, OrderedDict())
                                for raw_k, raw_v in raw_map.items():
                                    try:
                                        b_sec = int(raw_k.decode() if isinstance(raw_k, (bytes, bytearray)) else str(raw_k))
                                        if b_sec in series:
                                            continue
                                        val_s = raw_v.decode() if isinstance(raw_v, (bytes, bytearray)) else str(raw_v)
                                        parsed = json.loads(val_s)
                                        if isinstance(parsed, dict) and parsed.get("levels"):
                                            series[b_sec] = parsed
                                    except Exception:
                                        continue
                                if series:
                                    ordered = OrderedDict(sorted(series.items(), key=lambda kv: kv[0]))
                                    while len(ordered) > self.MAX_BASE_BARS:
                                        ordered.popitem(last=False)
                                    self._bars[key] = ordered
                            self._hydrated.add(key)
                        except Exception as e:
                            logger.debug(f"[FootprintRecorder] Redis hydrate err for {key}: {e}")

        series = self._bars.get(key)
        base_bars = list(series.values()) if series else []
        if not base_bars:
            return {
                "symbol": norm_sym,
                "exchange": base_ex,
                "interval": interval,
                "tick_step": 0.0,
                "candles": [],
            }

        # Aggregate 1m recorded footprint clusters into target chart interval
        agg: Dict[int, Dict[str, Any]] = {}
        latest_step = float(base_bars[-1].get("step") or 0.5)
        decimals = max(2, min(10, -math.floor(math.log10(latest_step)) + 2)) if latest_step < 1 else 4

        for b in sorted(base_bars, key=lambda x: int(x["time"])):
            t_sec = int(b["time"])
            bucket_t = align_candle_bucket_sec(t_sec, interval)
            cur = agg.get(bucket_t)
            if cur is None:
                cur = {
                    "time": bucket_t,
                    "open": float(b["open"]),
                    "high": float(b["high"]),
                    "low": float(b["low"]),
                    "close": float(b["close"]),
                    "levels": {},
                }
                agg[bucket_t] = cur
            else:
                if float(b["high"]) > cur["high"]:
                    cur["high"] = float(b["high"])
                if float(b["low"]) < cur["low"]:
                    cur["low"] = float(b["low"])
                cur["close"] = float(b["close"])

            for px_str, pair_vol in (b.get("levels") or {}).items():
                try:
                    raw_p = float(px_str)
                    snapped_p = round(math.floor((raw_p / latest_step) + 1e-9) * latest_step, decimals)
                    bv, av = float(pair_vol[0]), float(pair_vol[1])
                except (TypeError, ValueError, IndexError):
                    continue
                lv = cur["levels"].get(snapped_p)
                if lv is None:
                    cur["levels"][snapped_p] = [bv, av]
                else:
                    lv[0] += bv
                    lv[1] += av

        enriched_candles: List[Dict[str, Any]] = []
        for t_key in sorted(agg.keys())[-limit:]:
            c = agg[t_key]
            ticks = [
                {
                    "price": float(p),
                    "bidVolume": round(float(v[0]), 6),
                    "askVolume": round(float(v[1]), 6),
                }
                for p, v in c["levels"].items()
                if (v[0] + v[1]) > 0
            ]
            enriched = enrich_footprint_candle(
                {
                    "time": c["time"],
                    "open": c["open"],
                    "high": c["high"],
                    "low": c["low"],
                    "close": c["close"],
                    "isRealCluster": True,
                    "ticks": ticks,
                },
                tick_step=latest_step,
            )
            enriched_candles.append(enriched)

        return {
            "symbol": norm_sym,
            "exchange": base_ex,
            "interval": interval,
            "tick_step": latest_step,
            "candles": enriched_candles,
        }


footprint_recorder = FootprintRecorder()
