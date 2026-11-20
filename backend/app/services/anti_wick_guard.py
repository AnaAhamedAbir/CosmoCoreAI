"""
Anti-Wick Stop-Loss Guard
=========================
Modular SL trigger confirmation engine (pure Python) designed to stop 1-second
stop-hunt wicks from prematurely closing a winning setup while still enforcing
a strict flash-crash bypass for capital protection.

Modes:
  - 'instant'      : Standard immediate trigger on breach (legacy default).
  - 'dwell'        : Requires price to stay beyond SL trigger continuously for
                     `dwell_seconds` (e.g., 3s or 5s). If price snaps back inside
                     before the timer completes, the breach timer resets cleanly.
  - 'candle_close' : Waits for the current timeframe candle (`1m`, `3m`, `5m`,
                     `15m`) to close beyond SL (verified via closed OHLCV close
                     or bucket rollover price).

Safety Override:
  If price breaches *further* than `disaster_bypass_pct` past `trigger_price`
  (e.g. -2.0% flash crash below SL), both Dwell and Candle-Close modes are
  immediately bypassed so the executor exits without delay.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

ANTI_WICK_TIMEFRAME_SECONDS: Dict[str, int] = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
}


def normalize_anti_wick_config(
    mode: Optional[str] = "instant",
    dwell_seconds: Optional[float] = 3.0,
    timeframe: Optional[str] = "1m",
    disaster_pct: Optional[float] = 2.0,
) -> Tuple[str, float, str, float]:
    """Validate and normalize anti-wick configuration parameters."""
    clean_mode = str(mode or "instant").strip().lower()
    if clean_mode not in ("instant", "dwell", "candle_close"):
        clean_mode = "instant"

    try:
        clean_dwell = float(dwell_seconds if dwell_seconds is not None else 3.0)
    except (TypeError, ValueError):
        clean_dwell = 3.0
    clean_dwell = max(0.5, min(120.0, clean_dwell))

    clean_tf = str(timeframe or "1m").strip().lower()
    if clean_tf not in ANTI_WICK_TIMEFRAME_SECONDS:
        clean_tf = "1m"

    try:
        clean_disaster = float(disaster_pct if disaster_pct is not None else 2.0)
    except (TypeError, ValueError):
        clean_disaster = 2.0
    clean_disaster = max(0.25, min(25.0, clean_disaster))

    return clean_mode, clean_dwell, clean_tf, clean_disaster


def is_price_breached(current_price: float, trigger_price: float, opposite_side: str) -> bool:
    """Return True if live price has reached or crossed the stop-loss trigger."""
    if current_price <= 0 or trigger_price <= 0:
        return False
    side_lower = str(opposite_side or "sell").strip().lower()
    if side_lower == "sell":
        return current_price <= trigger_price
    return current_price >= trigger_price


def is_disaster_crash_breached(
    current_price: float,
    trigger_price: float,
    opposite_side: str,
    disaster_bypass_pct: float = 2.0,
) -> bool:
    """
    Return True when price has crashed so far beyond `trigger_price` that holding
    for a dwell timer or candle close becomes unsafe.
    """
    if current_price <= 0 or trigger_price <= 0 or disaster_bypass_pct <= 0:
        return False
    side_lower = str(opposite_side or "sell").strip().lower()
    pct_factor = float(disaster_bypass_pct) / 100.0
    if side_lower == "sell":
        hard_floor = trigger_price * (1.0 - pct_factor)
        return current_price <= hard_floor
    hard_ceil = trigger_price * (1.0 + pct_factor)
    return current_price >= hard_ceil


def compute_anti_wick_disaster_price(
    trigger_price: float,
    opposite_side: str,
    disaster_bypass_pct: float = 2.0,
) -> float:
    """Return protective hard-stop price placed on exchange when Anti-Wick holds software SL."""
    if trigger_price <= 0:
        return 0.0
    pct_factor = max(0.25, float(disaster_bypass_pct or 2.0)) / 100.0
    if str(opposite_side or "sell").strip().lower() == "sell":
        return trigger_price * (1.0 - pct_factor)
    return trigger_price * (1.0 + pct_factor)


def _reset_hold_state(state: Dict[str, Any]) -> None:
    """Clear active breach tracking fields when price recovers safely."""
    state["anti_wick_state"] = "monitoring"
    state["anti_wick_breach_started_at"] = None
    state["anti_wick_breach_candle_bucket"] = None
    state["anti_wick_elapsed_sec"] = 0.0
    state["anti_wick_remaining_sec"] = 0.0
    state["anti_wick_reason"] = None


async def evaluate_anti_wick_trigger(
    state: Dict[str, Any],
    exchange: Any,
    symbol: str,
    opposite_side: str,
    current_price: float,
    trigger_price: float,
    anti_wick_mode: Optional[str] = "instant",
    dwell_seconds: Optional[float] = 3.0,
    timeframe: Optional[str] = "1m",
    disaster_bypass_pct: Optional[float] = 2.0,
    now_ts: Optional[float] = None,
) -> Tuple[bool, str]:
    """
    Evaluate whether a stop-loss breach should fire right now or hold against a fake wick.

    Returns:
        (should_execute_now, reason_code)
    """
    mode, clean_dwell, clean_tf, clean_disaster = normalize_anti_wick_config(
        anti_wick_mode, dwell_seconds, timeframe, disaster_bypass_pct
    )

    if current_price <= 0 or trigger_price <= 0:
        _reset_hold_state(state)
        return False, "invalid_price"

    raw_breached = is_price_breached(current_price, trigger_price, opposite_side)

    if mode == "instant":
        _reset_hold_state(state)
        return (True, "instant_breach") if raw_breached else (False, "monitoring")

    # Safety override: never hold through a flash crash past the disaster threshold
    if raw_breached and is_disaster_crash_breached(current_price, trigger_price, opposite_side, clean_disaster):
        state["anti_wick_state"] = "disaster_bypass"
        state["anti_wick_elapsed_sec"] = 0.0
        state["anti_wick_remaining_sec"] = 0.0
        state["anti_wick_reason"] = f"Crash bypass >= {clean_disaster:.1f}% beyond SL"
        logger.warning(
            f"🚨 [Anti-Wick Bypass] {symbol} {opposite_side.upper()} crashed past "
            f"{clean_disaster:.1f}% hard safety limit ({current_price} vs SL {trigger_price}). Exiting immediately!"
        )
        return True, "disaster_crash_bypass"

    t_now = float(now_ts if now_ts is not None else time.time())

    # ── MODE 1: DWELL TIME FILTER ──
    if mode == "dwell":
        if not raw_breached:
            if state.get("anti_wick_breach_started_at") is not None:
                logger.info(
                    f"🕯️ [Anti-Wick Absorbed] {symbol} recovered inside SL ({current_price} vs {trigger_price}) "
                    f"before {clean_dwell:.1f}s dwell elapsed — Wick ignored!"
                )
            _reset_hold_state(state)
            return False, "monitoring"

        started_at = state.get("anti_wick_breach_started_at")
        if started_at is None:
            state["anti_wick_breach_started_at"] = t_now
            state["anti_wick_state"] = "holding_dwell"
            state["anti_wick_elapsed_sec"] = 0.0
            state["anti_wick_remaining_sec"] = round(clean_dwell, 2)
            state["anti_wick_reason"] = f"Holding {clean_dwell:.1f}s against wick"
            logger.info(
                f"🕯️ [Anti-Wick Dwell] {symbol} breached SL ({current_price} vs {trigger_price}). "
                f"Holding {clean_dwell:.1f}s to filter fake wick..."
            )
            return False, "holding_dwell"

        elapsed = max(0.0, t_now - float(started_at))
        remaining = max(0.0, clean_dwell - elapsed)
        state["anti_wick_elapsed_sec"] = round(elapsed, 2)
        state["anti_wick_remaining_sec"] = round(remaining, 2)

        if elapsed >= clean_dwell:
            state["anti_wick_state"] = "confirmed_dwell"
            state["anti_wick_reason"] = f"Dwell {elapsed:.1f}s confirmed"
            return True, "dwell_confirmed"

        state["anti_wick_state"] = "holding_dwell"
        state["anti_wick_reason"] = f"Wick Hold: {remaining:.1f}s left"
        return False, "holding_dwell"

    # ── MODE 2: CANDLE-CLOSE CONFIRMED SL ──
    tf_sec = ANTI_WICK_TIMEFRAME_SECONDS.get(clean_tf, 60)
    curr_bucket = int(t_now // tf_sec)
    prev_breach_bucket = state.get("anti_wick_breach_candle_bucket")

    if raw_breached and prev_breach_bucket is None:
        state["anti_wick_breach_candle_bucket"] = curr_bucket
        state["anti_wick_breach_started_at"] = t_now
        prev_breach_bucket = curr_bucket
        candle_rem = max(0.0, ((curr_bucket + 1) * tf_sec) - t_now)
        state["anti_wick_state"] = "holding_candle"
        state["anti_wick_remaining_sec"] = round(candle_rem, 1)
        state["anti_wick_reason"] = f"Wait {clean_tf} close ({int(candle_rem)}s)"
        logger.info(
            f"🕯️ [Anti-Wick Candle] {symbol} touched SL intrabar ({current_price} vs {trigger_price}). "
            f"Waiting for {clean_tf} candle close..."
        )
        return False, "holding_candle"

    if prev_breach_bucket is not None:
        # Still inside the same candle where breach started
        if curr_bucket == prev_breach_bucket:
            if not raw_breached:
                # Price recovered inside the candle; reset so a later wick starts fresh
                _reset_hold_state(state)
                return False, "monitoring"
            candle_rem = max(0.0, ((curr_bucket + 1) * tf_sec) - t_now)
            state["anti_wick_state"] = "holding_candle"
            state["anti_wick_elapsed_sec"] = round(max(0.0, t_now - float(state.get("anti_wick_breach_started_at") or t_now)), 1)
            state["anti_wick_remaining_sec"] = round(candle_rem, 1)
            state["anti_wick_reason"] = f"Wait {clean_tf} close ({int(candle_rem)}s)"
            return False, "holding_candle"

        # Candle closed (bucket rolled forward): verify the CLOSED candle close price
        last_checked = state.get("_anti_wick_checked_bucket")
        if last_checked != prev_breach_bucket:
            state["_anti_wick_checked_bucket"] = prev_breach_bucket
            closed_close_px: Optional[float] = None
            if exchange is not None and hasattr(exchange, "fetch_ohlcv"):
                try:
                    ohlcv = await exchange.fetch_ohlcv(symbol, timeframe=clean_tf, limit=3)
                    if ohlcv:
                        # Prefer the candle matching prev_breach_bucket timestamp, else second-to-last bar
                        target_open_ms = prev_breach_bucket * tf_sec * 1000
                        matched = next((c for c in ohlcv if len(c) >= 5 and int(c[0]) == target_open_ms), None)
                        bar = matched or (ohlcv[-2] if len(ohlcv) >= 2 else ohlcv[-1])
                        if bar and len(bar) >= 5 and float(bar[4] or 0) > 0:
                            closed_close_px = float(bar[4])
                except Exception as ohlcv_err:
                    logger.debug(f"[Anti-Wick Candle] fetch_ohlcv fallback for {symbol}: {ohlcv_err}")

            # Fallback to current price only if OHLCV couldn't be retrieved
            eval_close_px = closed_close_px if (closed_close_px and closed_close_px > 0) else current_price
            if is_price_breached(eval_close_px, trigger_price, opposite_side):
                state["anti_wick_state"] = "confirmed_candle_close"
                state["anti_wick_elapsed_sec"] = float(tf_sec)
                state["anti_wick_remaining_sec"] = 0.0
                state["anti_wick_reason"] = f"{clean_tf} close {eval_close_px} confirmed SL"
                logger.info(
                    f"💥 [Anti-Wick Candle Confirmed] {symbol} {clean_tf} candle closed at {eval_close_px} "
                    f"beyond SL {trigger_price}!"
                )
                return True, "candle_close_confirmed"

            # Closed candle wicked and closed safe back inside SL!
            logger.info(
                f"🛡️ [Anti-Wick Saved!] {symbol} {clean_tf} candle closed safe @ {eval_close_px} "
                f"(SL {trigger_price}) — Wick rejected!"
            )
            _reset_hold_state(state)
            # If the NEW candle is already breaching again, re-arm the new bucket cleanly
            if raw_breached:
                state["anti_wick_breach_candle_bucket"] = curr_bucket
                state["anti_wick_breach_started_at"] = t_now
                state["anti_wick_state"] = "holding_candle"
                state["anti_wick_remaining_sec"] = float(tf_sec)
                state["anti_wick_reason"] = f"Wait {clean_tf} close ({tf_sec}s)"
            return False, "candle_wick_saved"

    _reset_hold_state(state)
    return False, "monitoring"
