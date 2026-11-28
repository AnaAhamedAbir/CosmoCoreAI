"""
Zero-Latency Strict Maker TP Guard & Profit-Safe Re-Peg Engine.

Prevents tight-spread Limit Take-Profit orders (e.g. 0% Maker pairs like BTC/USDC:USDC
or BTC/FDUSD) from silently falling back to GTC Taker orders during post-fill flash moves,
while preserving 1-RTT (<250ms) execution speed via <1ms local RAM BBO inspection.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def _infer_tick_size(exchange: Any, symbol: str, ref_price: float) -> float:
    """Fast 0ms tick-size lookup from loaded CCXT market metadata."""
    try:
        from app.services.smart_peg_entry_executor import _get_market_tick

        tick = float(_get_market_tick(exchange, symbol, ref_price))
        if tick > 0:
            return tick
    except Exception:
        pass

    try:
        mkt = (getattr(exchange, "markets", None) or {}).get(symbol)
        if isinstance(mkt, dict):
            prec = (mkt.get("precision") or {}).get("price")
            if isinstance(prec, float) and 0 < prec < 1:
                return prec
            if isinstance(prec, int) and prec >= 0:
                return float(10 ** (-prec))
            min_p = ((mkt.get("limits") or {}).get("price") or {}).get("min")
            if min_p and float(min_p) > 0:
                return float(min_p)
    except Exception:
        pass

    if ref_price >= 1000:
        return 0.1
    if ref_price >= 1:
        return 0.001
    if ref_price >= 0.01:
        return 0.0001
    return 0.00001


def compute_maker_safe_tp_price(
    opposite_side: str,
    target_tp_price: float,
    best_bid: float,
    best_ask: float,
    tick_size: float,
    extra_passive_ticks: int = 0,
) -> Tuple[float, bool]:
    """
    Computes a Maker-safe (non-crossing) TP limit price that is ALWAYS equal to or
    MORE PROFITABLE than `target_tp_price`:

    - Buy TP (closing a Short): wants lower price.
      If `target_tp_price >= best_ask` (market already flash-dropped past TP),
      re-peg down to `min(target_tp_price, passive_bid)` where `passive_bid < best_ask`.
    - Sell TP (closing a Long): wants higher price.
      If `target_tp_price <= best_bid` (market already flash-pumped past TP),
      re-peg up to `max(target_tp_price, passive_ask)` where `passive_ask > best_bid`.

    Returns: (safe_price, was_repegged)
    """
    side_l = (opposite_side or "").strip().lower()
    tick = max(1e-12, float(tick_size or 0.0))
    extra = max(0, int(extra_passive_ticks)) * tick

    if side_l == "buy":
        if best_ask > 0 and target_tp_price >= best_ask:
            base_bid = best_bid if (best_bid > 0 and best_bid < best_ask) else (best_ask - tick)
            passive_px = max(tick, base_bid - extra)
            safe_px = min(target_tp_price, passive_px)
            # Ensure strictly below best_ask so GTX rests as Maker
            if safe_px >= best_ask:
                safe_px = max(tick, best_ask - tick - extra)
            return safe_px, True
        return target_tp_price, False

    if side_l == "sell":
        if best_bid > 0 and target_tp_price <= best_bid:
            base_ask = best_ask if (best_ask > 0 and best_ask > best_bid) else (best_bid + tick)
            passive_px = base_ask + extra
            safe_px = max(target_tp_price, passive_px)
            # Ensure strictly above best_bid so GTX rests as Maker
            if safe_px <= best_bid:
                safe_px = best_bid + tick + extra
            return safe_px, True
        return target_tp_price, False

    return target_tp_price, False


def is_gtc_taker_net_profitable(
    entry_price: float,
    est_exit_price: float,
    opposite_side: str,
    taker_rate: float = 0.0005,
    safety_multiplier: float = 1.5,
) -> bool:
    """
    Returns True ONLY if an immediate Taker sweep at `est_exit_price` would generate
    gross profit comfortably exceeding `taker_rate * safety_multiplier`.
    Tight scalps (e.g. $5 TP on $59,750 BTC = 0.0084% vs 0.04% taker fee) return False,
    blocking guaranteed-loss Taker fills.
    """
    if entry_price <= 0 or est_exit_price <= 0:
        return False
    side_l = (opposite_side or "").strip().lower()
    if side_l == "buy":
        # Closing Short: profit when exit < entry
        gross_move_ratio = (entry_price - est_exit_price) / entry_price
    else:
        # Closing Long: profit when exit > entry
        gross_move_ratio = (est_exit_price - entry_price) / entry_price

    min_required_ratio = max(0.0, float(taker_rate)) * max(1.0, float(safety_multiplier))
    return gross_move_ratio > min_required_ratio


def _estimate_symbol_taker_rate(exchange: Any, symbol: str, is_futures: bool) -> float:
    """0ms taker rate estimate for net-profitability guard."""
    try:
        mkt = (getattr(exchange, "markets", None) or {}).get(symbol)
        if isinstance(mkt, dict) and mkt.get("taker") is not None:
            t_val = float(mkt["taker"])
            if 0.0 <= t_val <= 0.05:
                return t_val
    except Exception:
        pass
    sym_u = (symbol or "").upper()
    if is_futures:
        return 0.0004 if "/USDC" in sym_u else 0.0005
    return 0.0010


def _is_post_only_rejected(res: Any, err: Optional[Exception] = None) -> bool:
    """Detects Post-Only / GTX rejection across REST, WS API, and Binance Futures HTTP-200 'expired'."""
    if err is not None:
        err_l = str(err).lower()
        return any(
            kw in err_l
            for kw in (
                "-5022",
                "-2010",
                "post only",
                "post-only",
                "post_only",
                "immediately match",
                "would immediately",
                "gtx",
                "maker",
            )
        )
    if not isinstance(res, dict):
        return True
    status_l = str(res.get("status", "")).lower()
    return status_l in ("expired", "canceled", "cancelled", "rejected")


async def _read_ram_bbo_fast(
    exchange: Any,
    symbol: str,
    max_age_seconds: float = 2.0,
    timeout_seconds: float = 0.025,
) -> Tuple[float, float]:
    """Sub-millisecond local RAM/Redis @bookTicker BBO read (never blocks on REST)."""
    try:
        from app.services.smart_peg_entry_executor import _fetch_bbo_fast

        bbo_ob = await asyncio.wait_for(
            _fetch_bbo_fast(
                exchange,
                symbol,
                max_age_seconds=max_age_seconds,
                rest_fallback=False,
            ),
            timeout=timeout_seconds,
        )
        if bbo_ob and bbo_ob.get("bids") and bbo_ob.get("asks"):
            return float(bbo_ob["bids"][0][0]), float(bbo_ob["asks"][0][0])
    except Exception:
        pass
    return 0.0, 0.0


async def place_strict_maker_tp_order(
    *,
    order_ex: Any,
    symbol: str,
    opposite_side: str,
    amount: float,
    target_tp_price: float,
    entry_price: float,
    base_params: Dict[str, Any],
    is_futures: bool,
    place_limit_fn: Callable[[float, float, Dict[str, Any]], Awaitable[Dict[str, Any]]],
    format_price_fn: Callable[[float], float],
    strict_maker: bool = True,
    max_maker_attempts: int = 3,
) -> Tuple[Optional[Dict[str, Any]], float, Dict[str, Any]]:
    """
    Places a Limit Take-Profit order with Strict Maker (Post-Only / GTX) protection
    and ZERO extra latency on the normal path (1 RTT):

    1. Attempt 1 (1 RTT): Reads <1ms local RAM BBO. If the market already flashed past
       `target_tp_price`, immediately re-pegs to the profitable passive BBO side and
       fires `postOnly=True` on Attempt 1 (saving 1 RTT AND avoiding Taker fees!).
    2. Retries (only if GTX expired/rejected in flight): Re-reads fresh RAM BBO and steps
       1–2 ticks onto the profitable passive side so the order rests as Maker.
    3. Final GTC Fallback Gate: ONLY allowed if `strict_maker` is False OR if ALL Maker
       attempts failed AND `is_gtc_taker_net_profitable()` proves Taker exit is still
       comfortably net-profitable. Tight scalps NEVER get wiped by a losing Taker fill!

    Returns: (tp_res, placed_price, meta_dict)
    """
    tick_size = _infer_tick_size(order_ex, symbol, target_tp_price or entry_price)
    placed_price = float(format_price_fn(target_tp_price))
    tp_res: Optional[Dict[str, Any]] = None
    was_repegged = False
    last_b_bid = 0.0
    last_b_ask = 0.0
    last_err: Optional[Exception] = None

    attempts = max(1, int(max_maker_attempts))
    for attempt in range(attempts):
        # <1ms local RAM BBO check (no network call)
        b_bid, b_ask = await _read_ram_bbo_fast(
            order_ex,
            symbol,
            max_age_seconds=2.0 if attempt == 0 else 0.5,
            timeout_seconds=0.025,
        )
        if b_bid > 0 and b_ask > 0:
            last_b_bid, last_b_ask = b_bid, b_ask

        # On retry after GTX rejection, step 1–2 ticks onto the profitable passive side
        # so even fast-moving books accept the Post-Only order cleanly.
        extra_ticks = attempt
        cand_px, repegged = compute_maker_safe_tp_price(
            opposite_side=opposite_side,
            target_tp_price=target_tp_price,
            best_bid=b_bid if b_bid > 0 else last_b_bid,
            best_ask=b_ask if b_ask > 0 else last_b_ask,
            tick_size=tick_size,
            extra_passive_ticks=extra_ticks,
        )

        # If Attempt >= 1 failed with no fresh BBO available, step 1 tick deeper on the profitable side
        if attempt > 0 and not repegged and b_bid <= 0 and b_ask <= 0:
            if opposite_side.lower() == "buy":
                cand_px = max(tick_size, placed_price - tick_size)
            else:
                cand_px = placed_price + tick_size
            repegged = True

        cand_px = float(format_price_fn(cand_px))
        if repegged:
            was_repegged = True

        ex_params_po = dict(base_params)
        ex_params_po["postOnly"] = True

        try:
            res = await place_limit_fn(cand_px, amount, ex_params_po)
            if not _is_post_only_rejected(res, None):
                tp_res = res
                placed_price = cand_px
                mode_label = (
                    f"Re-Pegged Maker (GTX @ ${placed_price})"
                    if was_repegged
                    else "Post-Only Maker (GTX)"
                )
                logger.info(
                    f"✅ [MakerTPGuard] {mode_label} placed on {symbol} "
                    f"(attempt {attempt + 1}/{attempts}, ID: {res.get('id')})"
                )
                return tp_res, placed_price, {
                    "execution_mode": "maker_repegged" if was_repegged else "maker_post_only",
                    "label": mode_label,
                    "is_maker": True,
                    "was_repegged": was_repegged,
                    "attempts": attempt + 1,
                }
            # Binance Futures returned HTTP 200 with status='expired' (GTX crossed book in flight)
            logger.warning(
                f"⚠️ [MakerTPGuard] GTX attempt {attempt + 1}/{attempts} expired on {symbol} @ {cand_px} "
                f"(status={res.get('status')}). Re-pegging passively to protect Maker fee..."
            )
            placed_price = cand_px
        except Exception as po_err:
            last_err = po_err
            if _is_post_only_rejected(None, po_err):
                logger.warning(
                    f"⚠️ [MakerTPGuard] GTX attempt {attempt + 1}/{attempts} rejected on {symbol} @ {cand_px} "
                    f"({po_err}). Re-pegging passively to protect Maker fee..."
                )
                placed_price = cand_px
                continue
            # Non-PostOnly error (e.g. insufficient margin, position already closed, auth) -> propagate
            raise

    # All Maker GTX attempts exhausted.
    # Evaluate whether GTC fallback is permitted & genuinely net-profitable!
    est_taker_rate = _estimate_symbol_taker_rate(order_ex, symbol, is_futures)
    est_sweep_px = (
        last_b_ask if (opposite_side.lower() == "buy" and last_b_ask > 0)
        else (last_b_bid if (opposite_side.lower() == "sell" and last_b_bid > 0) else target_tp_price)
    )
    gtc_is_profitable = is_gtc_taker_net_profitable(
        entry_price=entry_price,
        est_exit_price=est_sweep_px,
        opposite_side=opposite_side,
        taker_rate=est_taker_rate,
        safety_multiplier=1.5,
    )

    if (not strict_maker) or gtc_is_profitable:
        logger.warning(
            f"⚠️ [MakerTPGuard] Falling back to GTC Limit on {symbol} @ {target_tp_price} "
            f"(strict_maker={strict_maker}, net_profitable={gtc_is_profitable}, taker={est_taker_rate * 100:.3f}%)"
        )
        ex_params_gtc = dict(base_params)
        ex_params_gtc.pop("postOnly", None)
        ex_params_gtc["timeInForce"] = "GTC"
        gtc_px = float(format_price_fn(target_tp_price))
        tp_res = await place_limit_fn(gtc_px, amount, ex_params_gtc)
        return tp_res, gtc_px, {
            "execution_mode": "gtc_fallback",
            "label": "Standard GTC Limit (Fallback)",
            "is_maker": False,
            "was_repegged": False,
            "attempts": attempts + 1,
        }

    # Strict Maker Final Passive Safety Placement:
    # GTC would lock in a Taker fee loss (profit <= 1.5x taker fee). Place a deeper passive
    # GTX order (3 ticks deeper on the profitable side) so TP still arms with 0% Taker risk!
    deeper_px, _ = compute_maker_safe_tp_price(
        opposite_side=opposite_side,
        target_tp_price=target_tp_price,
        best_bid=last_b_bid,
        best_ask=last_b_ask,
        tick_size=tick_size,
        extra_passive_ticks=attempts + 2,
    )
    deeper_px = float(format_price_fn(deeper_px))
    logger.warning(
        f"🛡️ [MakerTPGuard] Blocked losing GTC Taker fallback on {symbol} "
        f"(entry={entry_price}, tp={target_tp_price}, est_taker={est_taker_rate * 100:.3f}%). "
        f"Placing deep passive Maker GTX @ {deeper_px} instead!"
    )
    ex_params_deep = dict(base_params)
    ex_params_deep["postOnly"] = True
    try:
        tp_res = await place_limit_fn(deeper_px, amount, ex_params_deep)
        if not _is_post_only_rejected(tp_res, None):
            return tp_res, deeper_px, {
                "execution_mode": "maker_deep_guard",
                "label": f"Protected Maker (GTX @ ${deeper_px})",
                "is_maker": True,
                "was_repegged": True,
                "attempts": attempts + 1,
            }
    except Exception as deep_err:
        last_err = deep_err

    raise Exception(
        f"Strict Maker TP Guard blocked Taker fallback to prevent fee loss on {symbol} "
        f"(TP=${target_tp_price}, Taker={est_taker_rate * 100:.3f}%). Last error: {last_err or 'GTX expired'}"
    )
