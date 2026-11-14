import asyncio
from collections import deque
import json
import logging
import math
import time
from typing import Any, Deque, Dict, List, Optional, Tuple

from app.core.redis import redis_manager

logger = logging.getLogger(__name__)


def _normalize_stream_key(exchange_id: str, symbol: str) -> Tuple[str, str, str]:
    """Normalize exchange + symbol consistently with MarketDataStreamer."""
    norm_ex = str(exchange_id or "binance").lower()
    sym = str(symbol or "").upper()
    is_futures = ":" in sym
    if norm_ex == "kucoin" and is_futures:
        norm_ex = "kucoinfutures"
    elif norm_ex == "kraken" and is_futures:
        norm_ex = "krakenfutures"
    return norm_ex, sym, f"{norm_ex}:{sym}"


class _BucketState:
    __slots__ = (
        "price",
        "prev_bid_usd",
        "curr_bid_usd",
        "peak_bid_usd",
        "prev_ask_usd",
        "curr_ask_usd",
        "peak_ask_usd",
        "bid_reloads",
        "ask_reloads",
        "last_bid_reload_ts",
        "last_ask_reload_ts",
        "had_dominant_bid",
        "had_dominant_ask",
        "dominant_bid_ts",
        "dominant_ask_ts",
    )

    def __init__(self, price: float):
        self.price = price
        self.prev_bid_usd = 0.0
        self.curr_bid_usd = 0.0
        self.peak_bid_usd = 0.0
        self.prev_ask_usd = 0.0
        self.curr_ask_usd = 0.0
        self.peak_ask_usd = 0.0
        self.bid_reloads = 0
        self.ask_reloads = 0
        self.last_bid_reload_ts = 0.0
        self.last_ask_reload_ts = 0.0
        self.had_dominant_bid = False
        self.had_dominant_ask = False
        self.dominant_bid_ts = 0.0
        self.dominant_ask_ts = 0.0


class _StreamAbsorptionState:
    def __init__(self, exchange_id: str, symbol: str, stream_key: str):
        self.exchange_id = exchange_id
        self.symbol = symbol
        self.stream_key = stream_key
        self.bucket_size: float = 0.0
        self.current_price: float = 0.0
        self.median_level_usd: float = 10_000.0
        self.buckets: Dict[int, _BucketState] = {}
        # (timestamp_sec, price, quote_usd, side)
        self.trades: Deque[Tuple[float, float, float, str]] = deque(maxlen=5000)
        # Rolling 1s price bars for swing / sweep tracking: (sec, high, low, close, buy_usd, sell_usd)
        self.price_ticks: Deque[Tuple[float, float, str, float]] = deque(maxlen=2500)
        self.zones: Dict[str, Dict[str, Any]] = {}
        self.min_absorbed_usd: float = 10_000.0
        self.window_sec: float = 20.0
        self.last_publish_ts: float = 0.0
        self.last_zone_eval_ts: float = 0.0
        self.last_redis_save_ts: float = 0.0


class LiquidityAbsorptionService:
    """
    Live & historical engine for:
      1. Liquidity Sweep detection (swing / cluster stop-runs)
      2. Iceberg & Limit Order Absorption detection (tape vs L2 book reloads)
      3. Liquidity Swap detection (orderbook wall flips + aggressive delta shifts)
      4. Reversal vs Breakdown lifecycle tracking
    Runs independently of whether WallHunter Bot is active.
    """

    def __init__(self):
        self._streams: Dict[str, _StreamAbsorptionState] = {}
        self._internal_min_absorbed_usd: float = 15_000.0
        self._window_sec: float = 20.0
        self._max_zones: int = 30

    def _get_state(self, exchange_id: str, symbol: str) -> _StreamAbsorptionState:
        norm_ex, sym, key = _normalize_stream_key(exchange_id, symbol)
        state = self._streams.get(key)
        if state is None:
            state = _StreamAbsorptionState(norm_ex, sym, key)
            self._streams[key] = state
        return state

    def configure_stream(
        self,
        exchange_id: str,
        symbol: str,
        min_absorbed_usd: Optional[float] = None,
        window_sec: Optional[float] = None,
    ) -> None:
        state = self._get_state(exchange_id, symbol)
        if min_absorbed_usd is not None:
            # Track slightly below UI filter so frontend can raise/lower without losing events
            state.min_absorbed_usd = max(1_000.0, min(50_000.0, float(min_absorbed_usd) * 0.6))
        if window_sec is not None:
            state.window_sec = max(5.0, min(120.0, float(window_sec)))

    @staticmethod
    def _compute_bucket_size(price: float) -> float:
        if price <= 0:
            return 1.0
        # ~3 bps adaptive bucket size rounded cleanly
        raw = price * 0.0003
        exp = math.floor(math.log10(raw))
        base = 10 ** exp
        for m in (1.0, 2.0, 2.5, 5.0, 10.0):
            if raw <= base * m:
                return base * m
        return base * 10.0

    def _bucket_index(self, state: _StreamAbsorptionState, price: float) -> int:
        if state.bucket_size <= 0:
            state.bucket_size = self._compute_bucket_size(price)
        return int(round(price / state.bucket_size))

    def _bucket_price(self, state: _StreamAbsorptionState, idx: int) -> float:
        return round(idx * state.bucket_size, 10)

    async def process_orderbook(
        self,
        exchange_id: str,
        symbol: str,
        bids: List[Dict[str, Any]],
        asks: List[Dict[str, Any]],
        current_price: float,
    ) -> None:
        if current_price <= 0 or (not bids and not asks):
            return

        state = self._get_state(exchange_id, symbol)
        state.current_price = current_price
        if state.bucket_size <= 0 or abs(current_price - (state.bucket_size / 0.0003)) / current_price > 0.25:
            # Re-calibrate only if uninitialized or price shifted drastically (>25%)
            if state.bucket_size <= 0:
                state.bucket_size = self._compute_bucket_size(current_price)

        now = time.time()
        bid_map: Dict[int, float] = {}
        ask_map: Dict[int, float] = {}
        all_notionals: List[float] = []

        for b in bids[:50]:
            p = float(b.get("price", 0))
            s = float(b.get("size", 0))
            if p > 0 and s > 0:
                usd = p * s
                idx = self._bucket_index(state, p)
                bid_map[idx] = bid_map.get(idx, 0.0) + usd
                all_notionals.append(usd)

        for a in asks[:50]:
            p = float(a.get("price", 0))
            s = float(a.get("size", 0))
            if p > 0 and s > 0:
                usd = p * s
                idx = self._bucket_index(state, p)
                ask_map[idx] = ask_map.get(idx, 0.0) + usd
                all_notionals.append(usd)

        if all_notionals:
            all_notionals.sort()
            state.median_level_usd = max(2_000.0, all_notionals[len(all_notionals) // 2])

        dom_thresh = max(15_000.0, state.median_level_usd * 2.5)

        # Recent trade hits per bucket in last 4s to confirm reload happened under fire
        recent_sell_hits: Dict[int, float] = {}
        recent_buy_hits: Dict[int, float] = {}
        for ts, t_price, t_usd, t_side in reversed(state.trades):
            if now - ts > 4.0:
                break
            b_idx = self._bucket_index(state, t_price)
            if t_side == "sell":
                recent_sell_hits[b_idx] = recent_sell_hits.get(b_idx, 0.0) + t_usd
            elif t_side == "buy":
                recent_buy_hits[b_idx] = recent_buy_hits.get(b_idx, 0.0) + t_usd

        active_indices = set(bid_map.keys()) | set(ask_map.keys())
        for idx in active_indices:
            b = state.buckets.get(idx)
            if b is None:
                b = _BucketState(self._bucket_price(state, idx))
                state.buckets[idx] = b

            new_bid = bid_map.get(idx, 0.0)
            new_ask = ask_map.get(idx, 0.0)

            # Detect Bid Iceberg Reload: wall took heavy sell hits and either replenished or held >= 60% of prev
            sell_hit = recent_sell_hits.get(idx, 0.0) + recent_sell_hits.get(idx - 1, 0.0) + recent_sell_hits.get(idx + 1, 0.0)
            if sell_hit >= max(5_000.0, b.prev_bid_usd * 0.25) and new_bid > 0:
                if (new_bid >= b.prev_bid_usd * 0.92 or sell_hit > max(b.prev_bid_usd, 1.0) * 1.15) and (now - b.last_bid_reload_ts) >= 1.2:
                    b.bid_reloads += 1
                    b.last_bid_reload_ts = now

            # Detect Ask Iceberg Reload
            buy_hit = recent_buy_hits.get(idx, 0.0) + recent_buy_hits.get(idx - 1, 0.0) + recent_buy_hits.get(idx + 1, 0.0)
            if buy_hit >= max(5_000.0, b.prev_ask_usd * 0.25) and new_ask > 0:
                if (new_ask >= b.prev_ask_usd * 0.92 or buy_hit > max(b.prev_ask_usd, 1.0) * 1.15) and (now - b.last_ask_reload_ts) >= 1.2:
                    b.ask_reloads += 1
                    b.last_ask_reload_ts = now

            b.prev_bid_usd = b.curr_bid_usd
            b.curr_bid_usd = new_bid
            b.peak_bid_usd = max(b.peak_bid_usd * 0.995, new_bid)

            b.prev_ask_usd = b.curr_ask_usd
            b.curr_ask_usd = new_ask
            b.peak_ask_usd = max(b.peak_ask_usd * 0.995, new_ask)

            if new_bid >= dom_thresh:
                b.had_dominant_bid = True
                b.dominant_bid_ts = now
            if new_ask >= dom_thresh:
                b.had_dominant_ask = True
                b.dominant_ask_ts = now

        # Prune stale buckets far from current price (> 3% away)
        if len(state.buckets) > 250:
            to_del = [
                idx
                for idx, bk in state.buckets.items()
                if abs(bk.price - current_price) / current_price > 0.03
            ]
            for idx in to_del:
                del state.buckets[idx]

        # Periodically re-evaluate active zones on book updates (max every 0.5s)
        if now - state.last_zone_eval_ts >= 0.5:
            await self._evaluate_live_zones(state, now)

    async def process_trades(
        self,
        exchange_id: str,
        symbol: str,
        trades: List[Dict[str, Any]],
    ) -> None:
        if not trades:
            return

        state = self._get_state(exchange_id, symbol)
        now = time.time()

        for t in trades:
            price = float(t.get("price", 0) or 0)
            amount = float(t.get("amount", 0) or 0)
            side = str(t.get("side") or "").lower()
            if price <= 0 or amount <= 0 or side not in ("buy", "sell"):
                continue
            quote_usd = price * amount
            state.current_price = price
            state.trades.append((now, price, quote_usd, side))
            state.price_ticks.append((now, price, side, quote_usd))

        # Trim old trades (> 120s)
        while state.trades and (now - state.trades[0][0]) > 120.0:
            state.trades.popleft()
        while state.price_ticks and (now - state.price_ticks[0][0]) > 300.0:
            state.price_ticks.popleft()

        if state.current_price > 0 and (now - state.last_zone_eval_ts) >= 0.5:
            await self._evaluate_live_zones(state, now)

    async def _evaluate_live_zones(self, state: _StreamAbsorptionState, now: float) -> None:
        state.last_zone_eval_ts = now
        if state.current_price <= 0 or not state.trades:
            return

        if state.bucket_size <= 0:
            state.bucket_size = self._compute_bucket_size(state.current_price)

        # Compute prior swing high/low (from 300s ago up to 10s ago) to spot sweeps
        prior_high = 0.0
        prior_low = float("inf")
        prior_count = 0
        delta_before = 0.0
        delta_after = 0.0

        for ts, p, side, usd in state.price_ticks:
            age = now - ts
            if age > 10.0:
                prior_high = max(prior_high, p)
                prior_low = min(prior_low, p)
                prior_count += 1
                if age <= 30.0:
                    delta_before += usd if side == "buy" else -usd
            else:
                delta_after += usd if side == "buy" else -usd

        # Aggregate trade volume by bucket inside rolling absorption window
        sell_by_bucket: Dict[int, float] = {}
        buy_by_bucket: Dict[int, float] = {}
        window_low = float("inf")
        window_high = 0.0

        for ts, p, usd, side in state.trades:
            if now - ts > state.window_sec:
                continue
            window_low = min(window_low, p)
            window_high = max(window_high, p)
            idx = self._bucket_index(state, p)
            if side == "sell":
                sell_by_bucket[idx] = sell_by_bucket.get(idx, 0.0) + usd
            else:
                buy_by_bucket[idx] = buy_by_bucket.get(idx, 0.0) + usd

        changed_zones: List[Dict[str, Any]] = []
        min_thresh = max(1_000.0, state.min_absorbed_usd)

        # 1. Check Bullish Absorption (heavy market sells absorbed by bid wall / iceberg)
        for idx, sell_usd in sell_by_bucket.items():
            if sell_usd < min_thresh:
                continue
            level_price = self._bucket_price(state, idx)
            # Collect neighboring buckets (+-1) for visible limit defense & reloads
            vis_bid = 0.0
            peak_bid = 0.0
            reloads = 0
            had_ask_flip = False
            for off in (-1, 0, 1):
                bk = state.buckets.get(idx + off)
                if bk:
                    vis_bid += bk.curr_bid_usd
                    peak_bid = max(peak_bid, bk.peak_bid_usd)
                    reloads += bk.bid_reloads
                    if bk.had_dominant_ask and (now - bk.dominant_ask_ts) <= 90.0 and bk.curr_bid_usd > bk.curr_ask_usd * 1.5:
                        had_ask_flip = True

            # Price must still defend near or above the level for active absorption
            tolerance = max(state.bucket_size * 2.5, level_price * 0.0012)
            if state.current_price < level_price - tolerance:
                continue

            # Iceberg ratio: traded hit far exceeds visible wall OR explicit reloads detected
            is_iceberg = reloads >= 1 or (vis_bid > 0 and sell_usd >= vis_bid * 1.4)
            if not is_iceberg and sell_usd < min_thresh * 1.5:
                continue

            sweep_detected = prior_count >= 15 and window_low <= prior_low * 1.0005
            delta_flip = delta_before < -min_thresh * 0.25 and delta_after > 0
            liquidity_swap = had_ask_flip or delta_flip

            zone_id = f"live:bull:{idx}"
            existing = state.zones.get(zone_id)
            start_ts = existing["start_time"] if existing else int(now)
            peak_wall = max(existing["peak_wall_usd"], peak_bid, vis_bid) if existing else max(peak_bid, vis_bid)
            absorbed_total = max(existing["absorbed_usd"], sell_usd) if existing else sell_usd
            best_reloads = max(existing["reload_count"], reloads) if existing else reloads

            reversal_score = 45
            if best_reloads >= 1:
                reversal_score += min(25, best_reloads * 8)
            if sweep_detected:
                reversal_score += 15
            if liquidity_swap:
                reversal_score += 15
            reversal_score = min(98, reversal_score)

            breakdown_risk = 15
            if peak_wall > 0 and vis_bid < peak_wall * 0.35:
                breakdown_risk += 35
            if delta_after < -min_thresh * 0.3 and state.current_price <= level_price:
                breakdown_risk += 20
            breakdown_risk = min(95, breakdown_risk)

            if liquidity_swap and (best_reloads >= 1 or sweep_detected):
                status = "REVERSAL_CONFIRMED"
            elif peak_wall > 0 and vis_bid < peak_wall * 0.25 and best_reloads == 0:
                status = "EXHAUSTING"
            else:
                status = "ABSORBING"

            zone_obj = {
                "id": zone_id,
                "source": "live",
                "side": "bullish",
                "status": status,
                "price": round(level_price, 8),
                "zone_top": round(level_price + state.bucket_size * 1.5, 8),
                "zone_bottom": round(level_price - state.bucket_size * 1.5, 8),
                "start_time": start_ts,
                "end_time": None,
                "last_updated": int(now),
                "absorbed_usd": round(absorbed_total, 2),
                "visible_wall_usd": round(vis_bid, 2),
                "peak_wall_usd": round(peak_wall, 2),
                "reload_count": best_reloads,
                "is_iceberg": True if (best_reloads >= 1 or (vis_bid > 0 and absorbed_total >= vis_bid * 1.5)) else False,
                "sweep_detected": bool(sweep_detected or (existing and existing.get("sweep_detected"))),
                "swept_level": round(prior_low, 8) if sweep_detected else (existing.get("swept_level") if existing else None),
                "liquidity_swap": bool(liquidity_swap or (existing and existing.get("liquidity_swap"))),
                "delta_before": round(delta_before, 2),
                "delta_after": round(delta_after, 2),
                "reversal_score": reversal_score,
                "breakdown_risk": breakdown_risk,
            }
            if existing is None or existing.get("status") != status or absorbed_total > existing.get("absorbed_usd", 0) * 1.15 or best_reloads > existing.get("reload_count", 0):
                changed_zones.append(zone_obj)
            state.zones[zone_id] = zone_obj

        # 2. Check Bearish Absorption (heavy market buys absorbed by ask wall / iceberg)
        for idx, buy_usd in buy_by_bucket.items():
            if buy_usd < min_thresh:
                continue
            level_price = self._bucket_price(state, idx)
            vis_ask = 0.0
            peak_ask = 0.0
            reloads = 0
            had_bid_flip = False
            for off in (-1, 0, 1):
                bk = state.buckets.get(idx + off)
                if bk:
                    vis_ask += bk.curr_ask_usd
                    peak_ask = max(peak_ask, bk.peak_ask_usd)
                    reloads += bk.ask_reloads
                    if bk.had_dominant_bid and (now - bk.dominant_bid_ts) <= 90.0 and bk.curr_ask_usd > bk.curr_bid_usd * 1.5:
                        had_bid_flip = True

            tolerance = max(state.bucket_size * 2.5, level_price * 0.0012)
            if state.current_price > level_price + tolerance:
                continue

            is_iceberg = reloads >= 1 or (vis_ask > 0 and buy_usd >= vis_ask * 1.4)
            if not is_iceberg and buy_usd < min_thresh * 1.5:
                continue

            sweep_detected = prior_count >= 15 and window_high >= prior_high * 0.9995
            delta_flip = delta_before > min_thresh * 0.25 and delta_after < 0
            liquidity_swap = had_bid_flip or delta_flip

            zone_id = f"live:bear:{idx}"
            existing = state.zones.get(zone_id)
            start_ts = existing["start_time"] if existing else int(now)
            peak_wall = max(existing["peak_wall_usd"], peak_ask, vis_ask) if existing else max(peak_ask, vis_ask)
            absorbed_total = max(existing["absorbed_usd"], buy_usd) if existing else buy_usd
            best_reloads = max(existing["reload_count"], reloads) if existing else reloads

            reversal_score = 45
            if best_reloads >= 1:
                reversal_score += min(25, best_reloads * 8)
            if sweep_detected:
                reversal_score += 15
            if liquidity_swap:
                reversal_score += 15
            reversal_score = min(98, reversal_score)

            breakdown_risk = 15
            if peak_wall > 0 and vis_ask < peak_wall * 0.35:
                breakdown_risk += 35
            if delta_after > min_thresh * 0.3 and state.current_price >= level_price:
                breakdown_risk += 20
            breakdown_risk = min(95, breakdown_risk)

            if liquidity_swap and (best_reloads >= 1 or sweep_detected):
                status = "REVERSAL_CONFIRMED"
            elif peak_wall > 0 and vis_ask < peak_wall * 0.25 and best_reloads == 0:
                status = "EXHAUSTING"
            else:
                status = "ABSORBING"

            zone_obj = {
                "id": zone_id,
                "source": "live",
                "side": "bearish",
                "status": status,
                "price": round(level_price, 8),
                "zone_top": round(level_price + state.bucket_size * 1.5, 8),
                "zone_bottom": round(level_price - state.bucket_size * 1.5, 8),
                "start_time": start_ts,
                "end_time": None,
                "last_updated": int(now),
                "absorbed_usd": round(absorbed_total, 2),
                "visible_wall_usd": round(vis_ask, 2),
                "peak_wall_usd": round(peak_wall, 2),
                "reload_count": best_reloads,
                "is_iceberg": True if (best_reloads >= 1 or (vis_ask > 0 and absorbed_total >= vis_ask * 1.5)) else False,
                "sweep_detected": bool(sweep_detected or (existing and existing.get("sweep_detected"))),
                "swept_level": round(prior_high, 8) if sweep_detected else (existing.get("swept_level") if existing else None),
                "liquidity_swap": bool(liquidity_swap or (existing and existing.get("liquidity_swap"))),
                "delta_before": round(delta_before, 2),
                "delta_after": round(delta_after, 2),
                "reversal_score": reversal_score,
                "breakdown_risk": breakdown_risk,
            }
            if existing is None or existing.get("status") != status or absorbed_total > existing.get("absorbed_usd", 0) * 1.15 or best_reloads > existing.get("reload_count", 0):
                changed_zones.append(zone_obj)
            state.zones[zone_id] = zone_obj

        # 3. Lifecycle Update for existing active zones (check Breakdown / Exhaustion / Reversal)
        for zid, z in list(state.zones.items()):
            if z.get("status") == "BREAKDOWN":
                continue

            parts = zid.split(":")
            idx = int(parts[-1]) if len(parts) == 3 else self._bucket_index(state, z["price"])
            bk = state.buckets.get(idx)
            curr_wall = (bk.curr_bid_usd if z["side"] == "bullish" else bk.curr_ask_usd) if bk else 0.0
            peak_wall = max(z.get("peak_wall_usd", 0.0), curr_wall)
            z["visible_wall_usd"] = round(curr_wall, 2)
            z["peak_wall_usd"] = round(peak_wall, 2)

            break_margin = max(state.bucket_size * 2.5, z["price"] * 0.0015)
            is_broken = (
                (z["side"] == "bullish" and state.current_price < z["zone_bottom"] - break_margin)
                or (z["side"] == "bearish" and state.current_price > z["zone_top"] + break_margin)
            )
            if is_broken and (peak_wall == 0 or curr_wall < peak_wall * 0.35):
                z["status"] = "BREAKDOWN"
                z["end_time"] = int(now)
                z["last_updated"] = int(now)
                z["breakdown_risk"] = 92
                z["reversal_score"] = max(10, z.get("reversal_score", 50) - 35)
                changed_zones.append(z)

        # Prune oldest zones if exceeding cap
        if len(state.zones) > self._max_zones:
            sorted_ids = sorted(state.zones.keys(), key=lambda k: state.zones[k].get("last_updated", 0))
            for old_id in sorted_ids[: len(state.zones) - self._max_zones]:
                del state.zones[old_id]

        # Persist to Redis & publish updates
        redis = redis_manager.get_redis()
        if redis:
            if (now - state.last_redis_save_ts) >= 2.0 or changed_zones:
                state.last_redis_save_ts = now
                try:
                    zones_list = sorted(state.zones.values(), key=lambda z: z["start_time"])
                    await redis.setex(
                        f"liq_absorption_zones:{state.exchange_id}:{state.symbol}",
                        7200,
                        json.dumps(zones_list),
                    )
                except Exception as e:
                    logger.debug(f"Redis save failed for liq_absorption_zones: {e}")

            if changed_zones and (now - state.last_publish_ts) >= 0.4:
                state.last_publish_ts = now
                for cz in changed_zones[-3:]:
                    try:
                        await redis.publish(
                            "heatmap_events",
                            json.dumps({
                                "type": "LIQUIDITY_ABSORPTION_UPDATE",
                                "symbol": state.symbol,
                                "exchange": state.exchange_id,
                                "zone": cz,
                            }),
                        )
                    except Exception as e:
                        logger.debug(f"Redis publish failed for LIQUIDITY_ABSORPTION_UPDATE: {e}")

    async def get_live_zones(self, exchange_id: str, symbol: str) -> List[Dict[str, Any]]:
        norm_ex, sym, key = _normalize_stream_key(exchange_id, symbol)
        state = self._streams.get(key)
        if state and state.zones:
            return sorted(state.zones.values(), key=lambda z: z["start_time"])

        redis = redis_manager.get_redis()
        if redis:
            try:
                raw = await redis.get(f"liq_absorption_zones:{norm_ex}:{sym}")
                if raw:
                    return json.loads(raw)
            except Exception as e:
                logger.debug(f"Failed loading live zones from Redis: {e}")
        return []

    def analyze_historical_candles(
        self,
        candles: List[Dict[str, Any]],
        lookback: int = 20,
        min_absorbed_usd: float = 50_000.0,
    ) -> List[Dict[str, Any]]:
        """
        Derives historical Liquidity Sweep + Absorption + Liquidity Swap + Breakdown zones
        from OHLCV + volume behavior so the chart immediately displays prior zones on load/refresh.
        """
        n = len(candles)
        lookback = max(5, min(100, int(lookback)))
        if n < lookback + 3:
            return []

        # Precompute ATR(14) and rolling notional volume
        tr_list: List[float] = []
        notional_vols: List[float] = []
        est_deltas: List[float] = []

        for i, c in enumerate(candles):
            h = float(c["high"])
            l = float(c["low"])
            o = float(c["open"])
            cl = float(c["close"])
            v = float(c.get("volume", 0) or 0)
            prev_c = float(candles[i - 1]["close"]) if i > 0 else o
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            tr_list.append(tr)
            notional = cl * v
            notional_vols.append(notional)

            rng = max(h - l, 1e-12)
            buy_ratio = max(0.0, min(1.0, (cl - l) / rng))
            est_deltas.append(notional * (2.0 * buy_ratio - 1.0))

        zones: List[Dict[str, Any]] = []
        last_bull_idx = -10
        last_bear_idx = -10

        for i in range(lookback, n):
            c = candles[i]
            h = float(c["high"])
            l = float(c["low"])
            o = float(c["open"])
            cl = float(c["close"])
            t = int(c["time"])
            rng = max(h - l, 1e-12)
            body = abs(cl - o)
            lower_wick = min(o, cl) - l
            upper_wick = h - max(o, cl)

            atr_slice = tr_list[max(0, i - 14) : i + 1]
            atr = sum(atr_slice) / len(atr_slice) if atr_slice else rng
            vol_slice = notional_vols[max(0, i - 20) : i]
            avg_notional = sum(vol_slice) / len(vol_slice) if vol_slice else notional_vols[i]

            prior_low = min(float(candles[j]["low"]) for j in range(i - lookback, i))
            prior_high = max(float(candles[j]["high"]) for j in range(i - lookback, i))

            # Equal Lows / Equal Highs (EQL/EQH) cluster detection within lookback
            eql_level: Optional[float] = None
            eqh_level: Optional[float] = None
            eq_tol = max(atr * 0.15, cl * 0.0005)
            prior_lows = [float(candles[j]["low"]) for j in range(i - lookback, i)]
            prior_highs = [float(candles[j]["high"]) for j in range(i - lookback, i)]
            for idx_a in range(len(prior_lows)):
                lv_a = prior_lows[idx_a]
                if any(idx_b != idx_a and abs(prior_lows[idx_b] - lv_a) <= eq_tol for idx_b in range(len(prior_lows))):
                    if l < lv_a <= cl + eq_tol:
                        eql_level = lv_a if eql_level is None else min(eql_level, lv_a)
                hv_a = prior_highs[idx_a]
                if any(idx_b != idx_a and abs(prior_highs[idx_b] - hv_a) <= eq_tol for idx_b in range(len(prior_highs))):
                    if h > hv_a >= cl - eq_tol:
                        eqh_level = hv_a if eqh_level is None else max(eqh_level, hv_a)

            notional_i = notional_vols[i]

            vol_spike = avg_notional > 0 and notional_i >= avg_notional * 1.25
            meets_min_usd = notional_i >= min_absorbed_usd * 0.4

            # ── Bullish Sweep & Absorption (Swing Low or EQL Sweep) ───────
            swept_bull_lvl = prior_low if l < prior_low else eql_level
            is_low_sweep = swept_bull_lvl is not None and l < swept_bull_lvl and cl >= swept_bull_lvl - (0.15 * atr)
            lower_wick_ratio = lower_wick / rng
            high_effort_low_disp = vol_spike and lower_wick_ratio >= 0.35 and (body <= rng * 0.65 or cl > o)

            if is_low_sweep and high_effort_low_disp and meets_min_usd and (i - last_bull_idx) >= 4:
                last_bull_idx = i
                zone_bottom = l
                zone_top = max(l + atr * 0.35, min(o, cl))
                if zone_top <= zone_bottom:
                    zone_top = zone_bottom + max(atr * 0.25, cl * 0.0008)

                # Check next 1-2 candles for Delta Shift / Liquidity Swap & subsequent candles for Breakdown
                delta_before = est_deltas[i - 1] if i > 0 else 0.0
                next_delta = est_deltas[i + 1] if i + 1 < n else est_deltas[i]
                next_close = float(candles[i + 1]["close"]) if i + 1 < n else cl
                liquidity_swap = (next_delta > 0 and next_close > cl) or (cl > o and lower_wick_ratio >= 0.5)

                status = "REVERSAL_CONFIRMED" if liquidity_swap else "ABSORBING"
                end_time: Optional[int] = None
                breakdown_risk = 22
                reversal_score = 72 if liquidity_swap else 58
                if notional_i >= avg_notional * 2.0:
                    reversal_score = min(94, reversal_score + 12)

                # Scan forward to see if the zone later broke down or held
                for j in range(i + 1, n):
                    fc = candles[j]
                    if float(fc["close"]) < zone_bottom - (0.15 * atr):
                        status = "BREAKDOWN"
                        end_time = int(fc["time"])
                        breakdown_risk = 88
                        reversal_score = 25
                        break

                absorbed_est = notional_i * max(0.35, lower_wick_ratio)
                zones.append({
                    "id": f"hist:bull:{t}",
                    "source": "historical",
                    "side": "bullish",
                    "status": status,
                    "price": round((zone_top + zone_bottom) / 2.0, 8),
                    "zone_top": round(zone_top, 8),
                    "zone_bottom": round(zone_bottom, 8),
                    "start_time": t,
                    "end_time": end_time,
                    "last_updated": end_time or t,
                    "absorbed_usd": round(absorbed_est, 2),
                    "visible_wall_usd": 0.0,
                    "peak_wall_usd": 0.0,
                    "reload_count": 0,
                    "is_iceberg": bool(notional_i >= avg_notional * 1.8 and lower_wick_ratio >= 0.45),
                    "sweep_detected": True,
                    "swept_level": round(swept_bull_lvl, 8) if swept_bull_lvl is not None else round(prior_low, 8),
                    "liquidity_swap": bool(liquidity_swap),
                    "delta_before": round(delta_before, 2),
                    "delta_after": round(next_delta, 2),
                    "reversal_score": reversal_score,
                    "breakdown_risk": breakdown_risk,
                })

            # ── Bearish Sweep & Absorption (Swing High or EQH Sweep) ──────
            swept_bear_lvl = prior_high if h > prior_high else eqh_level
            is_high_sweep = swept_bear_lvl is not None and h > swept_bear_lvl and cl <= swept_bear_lvl + (0.15 * atr)
            upper_wick_ratio = upper_wick / rng
            high_effort_low_disp_bear = vol_spike and upper_wick_ratio >= 0.35 and (body <= rng * 0.65 or cl < o)

            if is_high_sweep and high_effort_low_disp_bear and meets_min_usd and (i - last_bear_idx) >= 4:
                last_bear_idx = i
                zone_top = h
                zone_bottom = min(h - atr * 0.35, max(o, cl))
                if zone_bottom >= zone_top:
                    zone_bottom = zone_top - max(atr * 0.25, cl * 0.0008)

                delta_before = est_deltas[i - 1] if i > 0 else 0.0
                next_delta = est_deltas[i + 1] if i + 1 < n else est_deltas[i]
                next_close = float(candles[i + 1]["close"]) if i + 1 < n else cl
                liquidity_swap = (next_delta < 0 and next_close < cl) or (cl < o and upper_wick_ratio >= 0.5)

                status = "REVERSAL_CONFIRMED" if liquidity_swap else "ABSORBING"
                end_time = None
                breakdown_risk = 22
                reversal_score = 72 if liquidity_swap else 58
                if notional_i >= avg_notional * 2.0:
                    reversal_score = min(94, reversal_score + 12)

                for j in range(i + 1, n):
                    fc = candles[j]
                    if float(fc["close"]) > zone_top + (0.15 * atr):
                        status = "BREAKDOWN"
                        end_time = int(fc["time"])
                        breakdown_risk = 88
                        reversal_score = 25
                        break

                absorbed_est = notional_i * max(0.35, upper_wick_ratio)
                zones.append({
                    "id": f"hist:bear:{t}",
                    "source": "historical",
                    "side": "bearish",
                    "status": status,
                    "price": round((zone_top + zone_bottom) / 2.0, 8),
                    "zone_top": round(zone_top, 8),
                    "zone_bottom": round(zone_bottom, 8),
                    "start_time": t,
                    "end_time": end_time,
                    "last_updated": end_time or t,
                    "absorbed_usd": round(absorbed_est, 2),
                    "visible_wall_usd": 0.0,
                    "peak_wall_usd": 0.0,
                    "reload_count": 0,
                    "is_iceberg": bool(notional_i >= avg_notional * 1.8 and upper_wick_ratio >= 0.45),
                    "sweep_detected": True,
                    "swept_level": round(swept_bear_lvl, 8) if swept_bear_lvl is not None else round(prior_high, 8),
                    "liquidity_swap": bool(liquidity_swap),
                    "delta_before": round(delta_before, 2),
                    "delta_after": round(next_delta, 2),
                    "reversal_score": reversal_score,
                    "breakdown_risk": breakdown_risk,
                })

        return zones[-35:]


liquidity_absorption_service = LiquidityAbsorptionService()
