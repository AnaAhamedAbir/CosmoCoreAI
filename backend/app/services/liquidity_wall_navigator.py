"""
Liquidity Wall Navigator
========================
Modular L2 Orderbook wall-detection, front-run pricing, and anti-spoofing
engine for ManualTradeModal (WallHunter Native Integration).

Reads live L2 depth (~1ms, 0 REST weight) from Redis `latest_orderbook:{ex}:{sym}`
populated by `MarketDataStreamer`, with seamless REST `fetch_order_book` fallback.
All functions are side-effect free and guarantee strict Post-Only maker boundaries.
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _safe_price_precision(exchange: Any, symbol: str, price: float) -> float:
    """Format price safely to exchange tick precision without raising."""
    if price <= 0:
        return 0.0
    try:
        if (
            exchange is not None
            and hasattr(exchange, "price_to_precision")
            and getattr(exchange, "markets", None)
            and symbol in exchange.markets
        ):
            return float(exchange.price_to_precision(symbol, price))
    except Exception:
        pass
    if price >= 1000:
        return round(price, 2)
    if price >= 1:
        return round(price, 4)
    if price >= 0.01:
        return round(price, 5)
    if price >= 0.0001:
        return round(price, 6)
    return round(price, 8)


def _derive_tick(exchange: Any, symbol: str, ref_price: float) -> float:
    """Derive market minimum price tick size."""
    try:
        from app.services.manual_smart_chase_executor import _get_market_tick

        return _get_market_tick(exchange, symbol, ref_price)
    except Exception:
        pass
    if ref_price >= 1000:
        return 0.01
    if ref_price >= 1:
        return 0.0001
    if ref_price >= 0.01:
        return 0.00001
    return 0.000001


def normalize_ob_levels(raw_levels: Any, max_levels: int = 20) -> List[List[float]]:
    """Normalize `[price, size]` or `{'price': p, 'size': s}` rows into `[[price, size], ...]`."""
    normalized: List[List[float]] = []
    if not raw_levels:
        return normalized
    for item in list(raw_levels)[:max_levels]:
        try:
            if isinstance(item, dict):
                px = float(item.get("price") or 0.0)
                sz = float(item.get("size") or item.get("amount") or 0.0)
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                px = float(item[0] or 0.0)
                sz = float(item[1] or 0.0)
            else:
                continue
            if px > 0 and sz > 0:
                normalized.append([px, sz])
        except (ValueError, TypeError):
            continue
    return normalized


async def fetch_l2_depth_fast(
    exchange: Any,
    symbol: str,
    limit: int = 20,
    max_age_seconds: float = 1.5,
    exchange_id_hint: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch multi-level L2 orderbook (with precomputed `walls` when available)
    from Redis `latest_orderbook:{ex_id}:{symbol}` (~1ms), falling back to REST.
    """
    ex_id = str(exchange_id_hint or getattr(exchange, "id", "binance") or "binance").lower()
    is_futures = ":" in str(symbol or "")
    if ex_id == "kucoin" and is_futures:
        ex_id = "kucoinfutures"
    elif ex_id == "kraken" and is_futures:
        ex_id = "krakenfutures"

    try:
        from app.services.user_order_stream import _get_redis_pub

        r_cli = await _get_redis_pub()
        if r_cli is not None:
            raw_ob = await asyncio.wait_for(
                r_cli.get(f"latest_orderbook:{ex_id}:{symbol}"),
                timeout=0.050,
            )
            if not raw_ob and symbol != symbol.upper():
                raw_ob = await asyncio.wait_for(
                    r_cli.get(f"latest_orderbook:{ex_id}:{symbol.upper()}"),
                    timeout=0.050,
                )
            if raw_ob:
                ob_json = json.loads(raw_ob)
                ts = ob_json.get("ts")
                if ts is not None and -0.5 <= (time.time() - float(ts)) <= max_age_seconds:
                    bids = normalize_ob_levels(ob_json.get("bids"), max_levels=limit)
                    asks = normalize_ob_levels(ob_json.get("asks"), max_levels=limit)
                    if bids and asks:
                        return {
                            "bids": bids,
                            "asks": asks,
                            "walls": ob_json.get("walls") or [],
                            "currentPrice": float(ob_json.get("currentPrice") or 0.0),
                            "midPrice": float(ob_json.get("midPrice") or 0.0),
                            "source": "redis",
                        }
    except Exception:
        pass

    if exchange is None:
        return None

    ob_rest = await exchange.fetch_order_book(symbol, limit=limit)
    if not isinstance(ob_rest, dict):
        return None
    return {
        "bids": normalize_ob_levels(ob_rest.get("bids"), max_levels=limit),
        "asks": normalize_ob_levels(ob_rest.get("asks"), max_levels=limit),
        "walls": [],
        "source": "rest",
    }


def detect_orderbook_walls(
    ob: Optional[Dict[str, Any]],
    wall_multiplier: float = 2.5,
    max_levels: int = 20,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Scan L2 bids & asks (and merge any streamer-tagged walls) to identify
    significant liquidity walls (`size >= avg_side_vol * wall_multiplier`).
    """
    if not ob or not isinstance(ob, dict):
        return {"buy_walls": [], "sell_walls": []}

    bids = normalize_ob_levels(ob.get("bids"), max_levels=max_levels)
    asks = normalize_ob_levels(ob.get("asks"), max_levels=max_levels)

    mult = max(1.1, float(wall_multiplier or 2.5))
    bid_vols = [sz for _, sz in bids]
    ask_vols = [sz for _, sz in asks]

    def _baseline_vol(vols: List[float]) -> float:
        if not vols:
            return 0.0
        avg_v = sum(vols) / len(vols)
        if len(vols) >= 4:
            s_vols = sorted(vols)
            mid = len(s_vols) // 2
            med_v = s_vols[mid] if len(s_vols) % 2 == 1 else (s_vols[mid - 1] + s_vols[mid]) / 2.0
            if med_v > 0:
                return min(avg_v, med_v * 2.0)
        return avg_v

    avg_bid = _baseline_vol(bid_vols)
    avg_ask = _baseline_vol(ask_vols)

    buy_map: Dict[float, Dict[str, Any]] = {}
    sell_map: Dict[float, Dict[str, Any]] = {}

    if avg_bid > 0:
        for px, sz in bids:
            ratio = sz / avg_bid
            if ratio >= mult:
                buy_map[px] = {
                    "price": px,
                    "size": sz,
                    "type": "buy",
                    "ratio": round(ratio, 2),
                    "notional_usd": round(px * sz, 2),
                }

    if avg_ask > 0:
        for px, sz in asks:
            ratio = sz / avg_ask
            if ratio >= mult:
                sell_map[px] = {
                    "price": px,
                    "size": sz,
                    "type": "sell",
                    "ratio": round(ratio, 2),
                    "notional_usd": round(px * sz, 2),
                }

    # Incorporate precomputed streamer walls when not already present
    best_bid = bids[0][0] if bids else 0.0
    best_ask = asks[0][0] if asks else 0.0
    for w in ob.get("walls") or []:
        if not isinstance(w, dict):
            continue
        try:
            w_px = float(w.get("price") or 0.0)
            w_sz = float(w.get("size") or 0.0)
            w_type = str(w.get("type") or "").lower()
        except (ValueError, TypeError):
            continue
        if w_px <= 0 or w_sz <= 0:
            continue
        if w_type == "buy" and (best_bid <= 0 or w_px <= best_bid * 1.001):
            if w_px not in buy_map:
                ratio = round(w_sz / avg_bid, 2) if avg_bid > 0 else mult
                buy_map[w_px] = {
                    "price": w_px,
                    "size": w_sz,
                    "type": "buy",
                    "ratio": ratio,
                    "notional_usd": round(w_px * w_sz, 2),
                }
        elif w_type == "sell" and (best_ask <= 0 or w_px >= best_ask * 0.999):
            if w_px not in sell_map:
                ratio = round(w_sz / avg_ask, 2) if avg_ask > 0 else mult
                sell_map[w_px] = {
                    "price": w_px,
                    "size": w_sz,
                    "type": "sell",
                    "ratio": ratio,
                    "notional_usd": round(w_px * w_sz, 2),
                }

    buy_walls = sorted(buy_map.values(), key=lambda x: x["price"], reverse=True)
    sell_walls = sorted(sell_map.values(), key=lambda x: x["price"])
    return {"buy_walls": buy_walls, "sell_walls": sell_walls}


def find_nearest_wall_targets(
    ob: Optional[Dict[str, Any]],
    ref_price: Optional[float] = None,
    wall_multiplier: float = 2.5,
    front_run_ticks: int = 1,
    tick: Optional[float] = None,
    exchange: Any = None,
    symbol: str = "",
) -> Dict[str, Any]:
    """
    Find nearest significant Buy Support Wall & Sell Resistance Wall and compute
    their exact 1-tick (or N-tick) front-run prices.
    """
    if not ob:
        return {
            "best_bid": 0.0,
            "best_ask": 0.0,
            "tick": 0.0,
            "nearest_buy_wall": None,
            "nearest_sell_wall": None,
            "buy_front_run_price": None,
            "sell_front_run_price": None,
            "buy_walls": [],
            "sell_walls": [],
        }

    bids = normalize_ob_levels(ob.get("bids"), max_levels=20)
    asks = normalize_ob_levels(ob.get("asks"), max_levels=20)
    best_bid = bids[0][0] if bids else 0.0
    best_ask = asks[0][0] if asks else 0.0
    eff_ref = float(ref_price or ob.get("currentPrice") or best_bid or best_ask or 0.0)
    eff_tick = float(tick) if (tick and tick > 0) else _derive_tick(exchange, symbol, eff_ref)
    offset_ticks = max(1, int(front_run_ticks or 1))

    detected = detect_orderbook_walls(ob, wall_multiplier=wall_multiplier, max_levels=20)
    buy_walls = detected["buy_walls"]
    sell_walls = detected["sell_walls"]

    nearest_buy = buy_walls[0] if buy_walls else None
    nearest_sell = sell_walls[0] if sell_walls else None

    buy_front_run_px: Optional[float] = None
    if nearest_buy:
        cand_b = nearest_buy["price"] + (offset_ticks * eff_tick)
        if best_ask > 0 and cand_b >= best_ask:
            cand_b = best_ask - eff_tick if (best_ask - eff_tick) > 0 else best_bid
        buy_front_run_px = _safe_price_precision(exchange, symbol, cand_b)
        if best_ask > 0 and buy_front_run_px >= best_ask:
            buy_front_run_px = _safe_price_precision(exchange, symbol, best_ask - eff_tick)
        nearest_buy = {
            **nearest_buy,
            "front_run_price": buy_front_run_px,
            "distance_pct": round(((eff_ref - nearest_buy["price"]) / eff_ref) * 100, 3) if eff_ref > 0 else 0.0,
        }

    sell_front_run_px: Optional[float] = None
    if nearest_sell:
        cand_s = nearest_sell["price"] - (offset_ticks * eff_tick)
        if best_bid > 0 and cand_s <= best_bid:
            cand_s = best_bid + eff_tick
        sell_front_run_px = _safe_price_precision(exchange, symbol, cand_s)
        if best_bid > 0 and sell_front_run_px <= best_bid:
            sell_front_run_px = _safe_price_precision(exchange, symbol, best_bid + eff_tick)
        nearest_sell = {
            **nearest_sell,
            "front_run_price": sell_front_run_px,
            "distance_pct": round(((nearest_sell["price"] - eff_ref) / eff_ref) * 100, 3) if eff_ref > 0 else 0.0,
        }

    return {
        "best_bid": best_bid,
        "best_ask": best_ask,
        "tick": eff_tick,
        "nearest_buy_wall": nearest_buy,
        "nearest_sell_wall": nearest_sell,
        "buy_front_run_price": buy_front_run_px,
        "sell_front_run_price": sell_front_run_px,
        "buy_walls": buy_walls[:5],
        "sell_walls": sell_walls[:5],
    }


def compute_smart_peg_entry_price(
    side: str,
    ob: Dict[str, Any],
    tick: float,
    peg_strategy: str = "bbo",
    wall_multiplier: float = 2.5,
    front_run_ticks: int = 1,
    anchor_price: Optional[float] = None,
    max_drift_bound: Optional[float] = None,
    exchange: Any = None,
    symbol: str = "",
) -> Tuple[float, Optional[Dict[str, Any]]]:
    """
    Compute optimal Post-Only Maker entry price for Smart Peg Entry:
    - `'bbo'`: Standard Top-of-Book Best Bid (Buy) / Best Ask (Sell)
    - `'inside_spread'`: 1 tick inside spread for #1 FIFO queue priority
    - `'wall_aware'`: Detects significant L2 support/resistance wall and
                      front-runs it by `front_run_ticks`, falling back cleanly
                      to BBO if no qualifying wall exists in bounds.

    Returns `(target_maker_price, tracked_wall_dict_or_None)`.
    """
    bids = normalize_ob_levels(ob.get("bids") if ob else None, max_levels=20)
    asks = normalize_ob_levels(ob.get("asks") if ob else None, max_levels=20)
    if not bids or not asks:
        return 0.0, None

    side_lower = str(side or "buy").lower()
    best_bid = bids[0][0]
    best_ask = asks[0][0]
    eff_tick = float(tick) if (tick and tick > 0) else _derive_tick(exchange, symbol, best_bid)
    spread = best_ask - best_bid
    strategy = str(peg_strategy or "bbo").lower()

    target_price = best_bid if side_lower == "buy" else best_ask
    tracked_wall: Optional[Dict[str, Any]] = None

    if strategy == "wall_aware":
        detected = detect_orderbook_walls(ob, wall_multiplier=wall_multiplier, max_levels=20)
        offset_ticks = max(1, int(front_run_ticks or 1))
        anchor_f = float(anchor_price) if (anchor_price and float(anchor_price) > 0) else None
        bound_f = float(max_drift_bound) if (max_drift_bound and float(max_drift_bound) > 0) else None

        if side_lower == "buy":
            # 1. Prefer a Bid Support Wall near top-of-book to sit 1+ ticks ahead of whale support
            for w in detected["buy_walls"]:
                cand = w["price"] + (offset_ticks * eff_tick)
                if cand >= best_ask:
                    cand = best_ask - eff_tick if (best_ask - eff_tick) > best_bid else best_bid
                if anchor_f is not None and cand > anchor_f:
                    continue
                if bound_f is not None and cand > bound_f:
                    continue
                target_price = cand
                tracked_wall = dict(w)
                break

            # 2. If no bid support wall was found, check if an Ask Resistance Wall sits tightly above
            #    and spread permits resting cleanly inside spread
            if tracked_wall is None and spread > (eff_tick * 1.5):
                cand_in = best_bid + eff_tick
                if (anchor_f is None or cand_in <= anchor_f) and (bound_f is None or cand_in <= bound_f):
                    if cand_in < best_ask:
                        target_price = cand_in
        else:
            # 1. Prefer an Ask Resistance Wall near top-of-book to front-run 1+ ticks below whale ask
            for w in detected["sell_walls"]:
                cand = w["price"] - (offset_ticks * eff_tick)
                if cand <= best_bid:
                    cand = best_bid + eff_tick if (best_bid + eff_tick) < best_ask else best_ask
                if anchor_f is not None and cand < anchor_f:
                    continue
                if bound_f is not None and cand < bound_f:
                    continue
                target_price = cand
                tracked_wall = dict(w)
                break

            if tracked_wall is None and spread > (eff_tick * 1.5):
                cand_in = best_ask - eff_tick
                if (anchor_f is None or cand_in >= anchor_f) and (bound_f is None or cand_in >= bound_f):
                    if cand_in > best_bid:
                        target_price = cand_in

    elif strategy == "inside_spread" and spread > (eff_tick * 1.5):
        if side_lower == "buy":
            cand = best_bid + eff_tick
            if cand < best_ask:
                target_price = cand
        else:
            cand = best_ask - eff_tick
            if cand > best_bid:
                target_price = cand

    # Apply anchor_price ceiling/floor
    if anchor_price and float(anchor_price) > 0:
        anchor_f = float(anchor_price)
        if side_lower == "buy":
            target_price = min(target_price, anchor_f)
        else:
            target_price = max(target_price, anchor_f)

    # Strict Post-Only Maker boundary (never cross spread)
    if side_lower == "buy" and target_price >= best_ask:
        target_price = best_ask - eff_tick
    elif side_lower == "sell" and target_price <= best_bid:
        target_price = best_bid + eff_tick

    target_price = _safe_price_precision(exchange, symbol, target_price)

    # Re-verify precision rounding didn't cross the spread
    if side_lower == "buy" and target_price >= best_ask:
        target_price = _safe_price_precision(exchange, symbol, best_ask - eff_tick)
        if target_price >= best_ask:
            target_price = best_bid
    elif side_lower == "sell" and target_price <= best_bid:
        target_price = _safe_price_precision(exchange, symbol, best_bid + eff_tick)
        if target_price <= best_bid:
            target_price = best_ask

    return target_price, tracked_wall


def evaluate_wall_spoof_event(
    tracked_wall: Optional[Dict[str, Any]],
    ob: Optional[Dict[str, Any]],
    pull_drop_ratio: float = 0.55,
    price_tolerance_pct: float = 0.0005,
) -> Tuple[bool, float, str]:
    """
    Detect if a previously shadowed liquidity wall was pulled/spoofed.
    Returns `(is_spoofed, live_size_at_wall, reason)`.
    """
    if not tracked_wall or not ob:
        return False, 0.0, ""

    orig_px = float(tracked_wall.get("price") or 0.0)
    orig_sz = float(tracked_wall.get("size") or 0.0)
    w_type = str(tracked_wall.get("type") or "buy").lower()
    if orig_px <= 0 or orig_sz <= 0:
        return False, 0.0, ""

    levels = normalize_ob_levels(
        ob.get("bids") if w_type == "buy" else ob.get("asks"),
        max_levels=50,
    )
    if not levels:
        return False, 0.0, ""

    # If the wall simply drifted deeper than the captured orderbook depth window
    # (rather than disappearing inside the visible range), do NOT treat it as spoofed.
    deepest_px = levels[-1][0]
    if w_type == "buy" and orig_px < deepest_px * (1.0 - float(price_tolerance_pct)):
        return False, orig_sz, ""
    if w_type == "sell" and orig_px > deepest_px * (1.0 + float(price_tolerance_pct)):
        return False, orig_sz, ""

    tol = orig_px * float(price_tolerance_pct)
    matched_sz = 0.0
    for px, sz in levels:
        if abs(px - orig_px) <= max(tol, 1e-12):
            matched_sz += sz

    drop_ratio = max(0.2, min(0.95, float(pull_drop_ratio or 0.55)))
    min_surviving = orig_sz * (1.0 - drop_ratio)

    if matched_sz < min_surviving:
        pct_gone = round((1.0 - (matched_sz / orig_sz)) * 100.0, 1)
        reason = (
            f"{w_type.upper()} Wall @ {orig_px} pulled/shrunk {pct_gone}% "
            f"({orig_sz:,.2f} -> {matched_sz:,.2f})"
        )
        return True, matched_sz, reason

    return False, matched_sz, ""
