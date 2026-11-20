"""
Manual Trade Auto-Recovery Service
==================================
Automatically verifies exchange state and resumes active Manual Trade monitors
(`software_sl`, `smart_chase`, `entry_monitor`, `smart_peg`, `native_otoco`)
after a VPS reboot, container restart, or process crash.
"""

import asyncio
import logging
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

from app.services.manual_trade_persistence import (
    ACTIVE_STATUSES,
    ensure_manual_trade_monitors_table,
    mark_terminal_sync,
    update_monitor_sync,
)

logger = logging.getLogger(__name__)
RECOVERY_RETRY_DELAYS = (5.0, 15.0, 30.0)


def _build_safe_api_key(rec: Any) -> SimpleNamespace:
    return SimpleNamespace(
        id=rec.id,
        user_id=rec.user_id,
        exchange=rec.exchange,
        api_key=rec.api_key,
        secret_key=rec.secret_key,
        passphrase=getattr(rec, "passphrase", None),
    )


async def _get_exchanges_for_record(api_key_record: Any, is_futures: bool) -> Tuple[Any, Any]:
    """Return (general_exchange, order_exchange) using ExchangePool."""
    from app.core.security import decrypt_key
    from app.services.exchange_pool import get_or_create_exchange

    dec_key = decrypt_key(api_key_record.api_key)
    dec_sec = decrypt_key(api_key_record.secret_key)
    raw_pp = getattr(api_key_record, "passphrase", None)
    dec_pp = decrypt_key(raw_pp) if raw_pp else None

    general_ex = await get_or_create_exchange(
        api_key_id=api_key_record.id,
        exchange_name=api_key_record.exchange,
        decrypted_api_key=dec_key,
        decrypted_secret=dec_sec,
        is_futures=is_futures,
        passphrase=dec_pp,
        purpose="general",
    )
    order_ex = await get_or_create_exchange(
        api_key_id=api_key_record.id,
        exchange_name=api_key_record.exchange,
        decrypted_api_key=dec_key,
        decrypted_secret=dec_sec,
        is_futures=is_futures,
        passphrase=dec_pp,
        purpose="order",
    )
    return general_ex, (order_ex or general_ex)


async def _get_futures_live_amount(exchange: Any, symbol: str, exit_side: str) -> Optional[float]:
    """
    Return exact live futures position size for (symbol, exit_side).
    Returns 0.0 if confirmed flat, >0 if open, or None if API lookup failed (failsafe).
    """
    from app.services.manual_smart_chase_executor import _get_live_position_contracts, _is_inverse_market

    is_inv = _is_inverse_market(exchange, symbol)
    live = await _get_live_position_contracts(exchange, symbol, exit_side, is_inv)
    if live < 0:
        return None
    return float(live)


async def _get_spot_total_asset_balance(exchange: Any, symbol: str, exit_side: str) -> Optional[float]:
    """
    Return total (free + used) Spot wallet balance for the asset required by `exit_side`.
    Returns None if balance fetch fails.
    """
    try:
        from app.services.manual_trade_service import ManualTradeService

        bal = await ManualTradeService._fetch_wallet_balance(exchange, symbol)
        parts = str(symbol).split("/")
        if len(parts) < 2:
            return None
        base_asset = parts[0]
        quote_asset = parts[1].split(":")[0]
        target_asset = base_asset if str(exit_side).lower() == "sell" else quote_asset
        free_v, used_v, tot_v = ManualTradeService._extract_asset_balance(bal, target_asset)
        return max(float(tot_v or 0.0), float(free_v or 0.0) + float(used_v or 0.0))
    except Exception as exc:
        logger.debug(f"[AutoRecovery] Spot balance check error for {symbol}: {exc}")
        return None


async def _is_order_still_open(exchange: Any, order_id: Optional[str], symbol: str, is_futures: bool) -> Optional[bool]:
    if not order_id:
        return False
    try:
        from app.services.bracket_order_service import BracketOrderService

        chk = (
            await BracketOrderService._fetch_futures_order_universal(exchange, str(order_id), symbol, is_conditional=False)
            if is_futures
            else await exchange.fetch_order(str(order_id), symbol)
        )
        if not chk:
            return None
        st = str(chk.get("status") or "").lower()
        return st in ("open", "new", "partially_filled", "partiallyfilled")
    except Exception:
        return None


async def _recover_software_sl_or_chase(
    row: Any,
    safe_key: SimpleNamespace,
    exchange: Any,
    order_ex: Any,
) -> str:
    """
    Verify exchange state for a persisted `software_sl` or `smart_chase` monitor and
    re-launch the live background asyncio task if the position is still open.
    Returns one of: 'resumed', 'completed_offline', 'skipped'.
    """
    from app.services.bracket_order_service import BracketOrderService
    from app.services.manual_smart_chase_executor import (
        ACTIVE_SMART_CHASES,
        _calc_order_notional_usd,
        _get_min_notional,
        execute_manual_smart_chase,
    )

    mid = str(row.monitor_id)
    if mid in BracketOrderService.ACTIVE_SOFTWARE_SL or mid in ACTIVE_SMART_CHASES:
        return "skipped"

    symbol = str(row.symbol)
    is_futures = bool(row.is_futures)
    opposite_side = str(row.side).lower()
    amount = float(row.amount or 0.0)
    entry_price = float(row.entry_price or 0.0)
    tp_order_id = str(row.tp_order_id) if row.tp_order_id else None
    disaster_sl_id = str(row.disaster_sl_order_id) if row.disaster_sl_order_id else None
    entry_order_id = str(row.entry_order_id) if row.entry_order_id else None
    cfg = dict(row.config or {})

    # 1. Check if linked TP already filled while VPS was down
    if tp_order_id:
        try:
            tp_chk = (
                await BracketOrderService._fetch_futures_order_universal(exchange, tp_order_id, symbol, is_conditional=False)
                if is_futures
                else await exchange.fetch_order(tp_order_id, symbol)
            )
            if tp_chk and str(tp_chk.get("status") or "").lower() in ("closed", "filled"):
                if disaster_sl_id and is_futures:
                    await BracketOrderService._cancel_futures_order_universal(
                        order_ex, disaster_sl_id, symbol, is_conditional=True
                    )
                exit_px = float(tp_chk.get("average") or tp_chk.get("price") or 0.0)
                fill_amt = float(tp_chk.get("filled") or tp_chk.get("amount") or amount)
                if row.user_id:
                    asyncio.create_task(
                        BracketOrderService._send_tp_completed_notification(
                            user_id=row.user_id,
                            symbol=symbol,
                            opposite_side=opposite_side,
                            amount=fill_amt,
                            entry_price=entry_price,
                            exit_price=exit_px,
                        )
                    )
                await asyncio.to_thread(mark_terminal_sync, mid, "completed", "tp_filled_offline")
                logger.info(f"✅ [AutoRecovery] {mid} ({symbol}): Linked TP #{tp_order_id} already filled offline.")
                return "completed_offline"
        except Exception as exc:
            logger.debug(f"[AutoRecovery] TP check notice for {mid}: {exc}")

    # 2. Check if Disaster / Native SL already filled while VPS was down
    if disaster_sl_id and is_futures:
        try:
            dis_chk = await BracketOrderService._fetch_futures_order_universal(
                exchange, disaster_sl_id, symbol, is_conditional=True
            )
            if dis_chk and str(dis_chk.get("status") or "").lower() in ("closed", "filled"):
                if tp_order_id:
                    await BracketOrderService._cancel_futures_order_universal(
                        order_ex, tp_order_id, symbol, is_conditional=False
                    )
                exit_px = float(dis_chk.get("average") or dis_chk.get("price") or dis_chk.get("stopPrice") or (row.trigger_price or 0.0))
                if row.user_id:
                    asyncio.create_task(
                        BracketOrderService._send_sl_completed_notification(
                            user_id=row.user_id,
                            symbol=symbol,
                            opposite_side=opposite_side,
                            amount=amount,
                            entry_price=entry_price,
                            exit_price=exit_px,
                            sl_method="Native Disaster/Fixed SL (Offline)",
                        )
                    )
                await asyncio.to_thread(mark_terminal_sync, mid, "completed", "disaster_sl_filled_offline")
                logger.info(f"🛡️ [AutoRecovery] {mid} ({symbol}): Disaster SL #{disaster_sl_id} filled offline.")
                return "completed_offline"
        except Exception as exc:
            logger.debug(f"[AutoRecovery] Disaster SL check notice for {mid}: {exc}")

    # 3. Verify live position (Futures) or live balance / open TP (Spot)
    if is_futures:
        live_amt = await _get_futures_live_amount(exchange, symbol, opposite_side)
        if live_amt is not None:
            if live_amt <= 0.0:
                if tp_order_id:
                    await BracketOrderService._cancel_futures_order_universal(order_ex, tp_order_id, symbol, is_conditional=False)
                if disaster_sl_id:
                    await BracketOrderService._cancel_futures_order_universal(order_ex, disaster_sl_id, symbol, is_conditional=True)
                await asyncio.to_thread(mark_terminal_sync, mid, "completed", "position_closed_offline")
                logger.info(f"✅ [AutoRecovery] {mid} ({symbol}): Futures position is flat (0). Cleaned up & closed.")
                return "completed_offline"
            if live_amt < amount:
                amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, live_amt)
                await asyncio.to_thread(update_monitor_sync, mid, fields={"amount": amount})
    else:
        spot_bal = await _get_spot_total_asset_balance(exchange, symbol, opposite_side)
        tp_open = await _is_order_still_open(exchange, tp_order_id, symbol, is_futures=False) if tp_order_id else None
        ref_px = float(row.trigger_price or entry_price or 0.0)
        min_notional = _get_min_notional(exchange, symbol)
        if spot_bal is not None:
            if opposite_side == "sell":
                avail_notional = _calc_order_notional_usd(exchange, symbol, spot_bal, ref_px) if ref_px > 0 else spot_bal
                if tp_open is not True and (spot_bal <= 0 or (ref_px > 0 and avail_notional < min_notional)):
                    await asyncio.to_thread(mark_terminal_sync, mid, "completed", "spot_balance_closed_offline")
                    logger.info(f"✅ [AutoRecovery] {mid} ({symbol}): Spot balance empty/dust ({spot_bal}). Closed.")
                    return "completed_offline"
                if 0 < spot_bal < amount:
                    amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, spot_bal)
                    await asyncio.to_thread(update_monitor_sync, mid, fields={"amount": amount})
            elif tp_open is not True and spot_bal < min_notional:
                await asyncio.to_thread(mark_terminal_sync, mid, "completed", "spot_quote_closed_offline")
                logger.info(f"✅ [AutoRecovery] {mid} ({symbol}): Spot quote balance below min notional. Closed.")
                return "completed_offline"

    if amount <= 0:
        await asyncio.to_thread(mark_terminal_sync, mid, "completed", "zero_amount")
        return "completed_offline"

    # Re-seed auxiliary in-memory registries for seamless drag/edit/chart sync
    if tp_order_id:
        BracketOrderService.KNOWN_TP_ORDER_IDS.add(tp_order_id)
    eb_key = entry_order_id or (f"tp:{tp_order_id}" if tp_order_id else None)
    if eb_key:
        BracketOrderService.ACTIVE_ENTRY_BRACKETS[eb_key] = {
            "entry_order_id": entry_order_id,
            "api_key_id": int(row.api_key_id),
            "symbol": symbol,
            "side": opposite_side,
            "amount": amount,
            "entry_price": entry_price,
            "tp_order_id": tp_order_id,
            "tp_price": float(row.tp_price) if row.tp_price else None,
            "cancelled": False,
        }

    # 4. If monitor was actively executing Smart Chase (`kind == 'smart_chase'` or `status == 'chasing'`)
    if row.kind == "smart_chase" or row.status == "chasing":
        prev_oid = cfg.get("current_order_id")
        if prev_oid:
            try:
                prev_chk = await exchange.fetch_order(str(prev_oid), symbol)
                prev_st = str((prev_chk or {}).get("status") or "").lower()
                if prev_st in ("closed", "filled"):
                    await asyncio.to_thread(mark_terminal_sync, mid, "completed", "chase_filled_offline")
                    logger.info(f"✅ [AutoRecovery] {mid} ({symbol}): Smart Chase order #{prev_oid} filled offline.")
                    return "completed_offline"
                if prev_st in ("open", "new", "partially_filled", "partiallyfilled"):
                    filled_prev = float((prev_chk or {}).get("filled") or 0.0)
                    if filled_prev > 0:
                        amount = max(0.0, BracketOrderService._safe_amount_to_precision(exchange, symbol, amount - filled_prev))
                    await BracketOrderService._cancel_futures_order_universal(order_ex, str(prev_oid), symbol, is_conditional=False)
            except Exception as prev_err:
                logger.debug(f"[AutoRecovery] Prior chase order cleanup notice ({prev_oid}): {prev_err}")

        if amount <= 0:
            await asyncio.to_thread(mark_terminal_sync, mid, "completed", "chase_already_filled")
            return "completed_offline"

        orig_sl = float(cfg.get("original_sl") or row.trigger_price or entry_price)
        asyncio.create_task(
            execute_manual_smart_chase(
                exchange=exchange,
                symbol=symbol,
                exit_side=opposite_side,
                sell_amount_raw=amount,
                entry_price=entry_price,
                original_sl=orig_sl,
                max_deviation_pct=float(cfg.get("max_deviation_pct", 1.0)),
                chase_delay_ms=int(cfg.get("chase_delay_ms", 1500)),
                max_attempts=int(cfg.get("max_attempts", 10000)),
                is_futures=is_futures,
                user_id=int(row.user_id),
                api_key_record=safe_key,
                tp_order_id=tp_order_id,
                disaster_sl_order_id=disaster_sl_id,
                chase_id=mid,
                chase_mode=str(cfg.get("chase_mode", "dynamic_bbo")),
                trigger_source=str(cfg.get("trigger_source", "bid_ask")),
                peg_strategy=str(cfg.get("peg_strategy", "bbo")),
                wall_multiplier=float(cfg.get("wall_multiplier", 2.5)),
                entry_order_id=entry_order_id,
            )
        )
        logger.info(f"🔄 [AutoRecovery] Resumed active Smart Chase {mid} for {symbol} ({amount} @ {orig_sl})")
        return "resumed"

    # 5. Resume the appropriate Software SL monitor loop with preserved `sl_id`
    sl_type = str(row.sl_type or "fixed").lower()
    if sl_type == "smart_chase":
        sl_px = float(row.trigger_price if row.trigger_price is not None else entry_price)
        asyncio.create_task(
            BracketOrderService._smart_chase_monitor_loop(
                exchange=exchange,
                symbol=symbol,
                opposite_side=opposite_side,
                amount=amount,
                entry_price=entry_price,
                sl_price=sl_px,
                max_deviation_pct=float(cfg.get("max_deviation_pct", 1.0)),
                chase_delay_ms=int(cfg.get("chase_delay_ms", 1500)),
                max_attempts=int(cfg.get("max_attempts", 10000)),
                is_futures=is_futures,
                user_id=int(row.user_id),
                api_key_record=safe_key,
                tp_order_id=tp_order_id,
                disaster_sl_order_id=disaster_sl_id,
                chase_mode=str(cfg.get("chase_mode", "dynamic_bbo")),
                trigger_source=str(cfg.get("trigger_source", "bid_ask")),
                peg_strategy=str(cfg.get("peg_strategy", "bbo")),
                wall_multiplier=float(cfg.get("wall_multiplier", 2.5)),
                auto_breakeven_enabled=bool(cfg.get("auto_breakeven_enabled", False)),
                auto_breakeven_trigger_pct=float(cfg.get("auto_breakeven_trigger_pct", 1.0)),
                auto_breakeven_buffer_pct=float(cfg.get("auto_breakeven_buffer_pct", 0.05)),
                entry_order_id=entry_order_id,
                tp_price=float(row.tp_price) if row.tp_price else None,
                sl_id=mid,
                initial_breakeven_activated=bool(row.breakeven_activated),
                initial_manual_trigger_override=row.manual_trigger_override,
            )
        )
    elif sl_type in ("trailing", "trailing_chase"):
        is_chase_exit = bool(cfg.get("is_smart_chase_exit", sl_type == "trailing_chase"))
        sl_mode_raw = str(cfg.get("sl_mode_raw") or row.sl_mode or "percentage")
        sl_val = float(cfg.get("val") or 0.0)
        asyncio.create_task(
            BracketOrderService._software_trailing_stop_loop(
                exchange=exchange,
                symbol=symbol,
                opposite_side=opposite_side,
                amount=amount,
                entry_price=entry_price,
                mode=sl_mode_raw,
                val=sl_val,
                is_futures=is_futures,
                user_id=int(row.user_id),
                api_key_record=safe_key,
                atr_period=int(cfg.get("atr_period", 10)),
                atr_multiplier=float(cfg.get("atr_multiplier", 2.0)),
                atr_timeframe=str(cfg.get("atr_timeframe", "15m")),
                tp_order_id=tp_order_id,
                is_smart_chase_exit=is_chase_exit,
                max_deviation_pct=float(cfg.get("max_deviation_pct", 1.0)),
                chase_delay_ms=int(cfg.get("chase_delay_ms", 1500)),
                max_attempts=int(cfg.get("max_attempts", 10000)),
                chase_mode=str(cfg.get("chase_mode", "dynamic_bbo")),
                trigger_source=str(cfg.get("trigger_source", "bid_ask")),
                peg_strategy=str(cfg.get("peg_strategy", "bbo")),
                wall_multiplier=float(cfg.get("wall_multiplier", 2.5)),
                auto_breakeven_enabled=bool(cfg.get("auto_breakeven_enabled", False)),
                auto_breakeven_trigger_pct=float(cfg.get("auto_breakeven_trigger_pct", 1.0)),
                auto_breakeven_buffer_pct=float(cfg.get("auto_breakeven_buffer_pct", 0.05)),
                entry_order_id=entry_order_id,
                tp_price=float(row.tp_price) if row.tp_price else None,
                sl_id=mid,
                initial_highest_price=row.highest_price,
                initial_lowest_price=row.lowest_price,
                initial_trigger_price=row.trigger_price,
                initial_breakeven_activated=bool(row.breakeven_activated),
                initial_manual_trigger_override=row.manual_trigger_override,
            )
        )
    else:
        sl_px = float(row.trigger_price if row.trigger_price is not None else entry_price)
        asyncio.create_task(
            BracketOrderService._fixed_sl_auto_breakeven_loop(
                exchange=exchange,
                symbol=symbol,
                opposite_side=opposite_side,
                amount=amount,
                entry_price=entry_price,
                initial_sl_price=sl_px,
                is_futures=is_futures,
                user_id=int(row.user_id),
                api_key_record=safe_key,
                tp_order_id=tp_order_id,
                disaster_sl_order_id=disaster_sl_id,
                auto_breakeven_enabled=bool(cfg.get("auto_breakeven_enabled", False)),
                auto_breakeven_trigger_pct=float(cfg.get("auto_breakeven_trigger_pct", 1.0)),
                auto_breakeven_buffer_pct=float(cfg.get("auto_breakeven_buffer_pct", 0.05)),
                entry_order_id=entry_order_id,
                tp_price=float(row.tp_price) if row.tp_price else None,
                sl_id=mid,
                initial_breakeven_activated=bool(row.breakeven_activated),
                initial_manual_trigger_override=row.manual_trigger_override,
            )
        )

    logger.info(
        f"🔄 [AutoRecovery] Resumed {sl_type.upper()} SL monitor {mid} for {symbol} "
        f"(Amount: {amount}, Trigger: {row.trigger_price}, TP: {tp_order_id or 'None'})"
    )
    return "resumed"


async def _recover_entry_monitor(
    row: Any,
    safe_key: SimpleNamespace,
    exchange: Any,
) -> str:
    """Verify pending entry limit order on exchange and either spawn brackets or resume monitor."""
    from app.services.bracket_order_service import BracketOrderService

    entry_id = str(row.entry_order_id or row.monitor_id)
    if entry_id in BracketOrderService.ACTIVE_ENTRY_MONITORS:
        return "skipped"

    symbol = str(row.symbol)
    is_futures = bool(row.is_futures)
    side = str(row.side).lower()
    amount = float(row.amount or 0.0)
    cfg = dict(row.config or {})
    tp_config = cfg.get("tp_config")
    sl_config = cfg.get("sl_config")
    processed_amt = float(cfg.get("processed_amount") or 0.0)
    linked_tp_id = str(row.tp_order_id) if row.tp_order_id else None
    linked_tp_price = float(row.tp_price) if row.tp_price else None

    try:
        ord_chk = await exchange.fetch_order(entry_id, symbol)
    except Exception as exc:
        logger.debug(f"[AutoRecovery] Entry order fetch failed for {entry_id}: {exc}")
        ord_chk = None

    if ord_chk:
        st = str(ord_chk.get("status") or "").lower()
        filled = float(ord_chk.get("filled") or 0.0)
        if st in ("closed", "filled") and filled <= 0 and amount > 0:
            filled = amount
        avg_px = float(ord_chk.get("average") or ord_chk.get("price") or row.entry_price or 0.0)

        if filled > processed_amt:
            delta = filled - processed_amt
            if tp_config or sl_config:
                await BracketOrderService._spawn_bracket_for_amount(
                    exchange,
                    symbol,
                    side,
                    delta,
                    avg_px,
                    is_futures,
                    tp_config,
                    sl_config,
                    int(row.user_id),
                    safe_key,
                    entry_order_id=entry_id,
                    linked_tp_order_id=linked_tp_id,
                    linked_tp_price=linked_tp_price,
                )
            if row.user_id and avg_px > 0:
                asyncio.create_task(
                    BracketOrderService._send_entry_filled_notification(
                        user_id=int(row.user_id),
                        symbol=symbol,
                        side=side,
                        filled=filled,
                        total_amount=amount,
                        average_price=avg_px,
                        is_futures=is_futures,
                    )
                )
            processed_amt = filled

        if st in ("closed", "filled") or (amount > 0 and processed_amt >= amount * 0.99):
            await asyncio.to_thread(mark_terminal_sync, str(row.monitor_id), "completed", "entry_filled_offline")
            logger.info(f"✅ [AutoRecovery] Entry {entry_id} ({symbol}) filled offline -> bracket spawned.")
            return "completed_offline"

        if st in ("canceled", "cancelled", "expired", "rejected"):
            await asyncio.to_thread(mark_terminal_sync, str(row.monitor_id), "cancelled", f"entry_{st}_offline")
            logger.info(f"⚠️ [AutoRecovery] Entry {entry_id} ({symbol}) was {st} offline.")
            return "completed_offline"

    asyncio.create_task(
        BracketOrderService.monitor_and_execute_bracket(
            api_key_record=safe_key,
            entry_order_id=entry_id,
            symbol=symbol,
            side=side,
            amount=amount,
            is_futures=is_futures,
            tp_config=tp_config,
            sl_config=sl_config,
            initial_entry_price=float(row.entry_price or 0.0),
            user_id=int(row.user_id),
            linked_tp_order_id=linked_tp_id,
            linked_tp_price=linked_tp_price,
            resume_processed_amount=processed_amt,
        )
    )
    logger.info(f"🔄 [AutoRecovery] Resumed pending Entry Monitor {entry_id} ({symbol})")
    return "resumed"


async def _recover_smart_peg(
    row: Any,
    safe_key: SimpleNamespace,
    exchange: Any,
    order_ex: Any,
) -> str:
    """Verify last resting Smart Peg order and resume Smart Peg Entry if remaining > 0."""
    from app.services.bracket_order_service import BracketOrderService
    from app.services.manual_smart_chase_executor import _calc_order_notional_usd, _get_min_notional
    from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS, execute_smart_peg_entry

    cid = str(row.monitor_id)
    if cid in ACTIVE_SMART_PEGS:
        return "skipped"

    symbol = str(row.symbol)
    is_futures = bool(row.is_futures)
    side = str(row.side).lower()
    remaining_amt = float(row.amount or 0.0)
    cfg = dict(row.config or {})
    tp_config = cfg.get("tp_config")
    sl_config = cfg.get("sl_config")
    reduce_only = bool(cfg.get("reduce_only", False))
    prev_oid = cfg.get("current_order_id")

    if prev_oid:
        try:
            prev_chk = await exchange.fetch_order(str(prev_oid), symbol)
            prev_st = str((prev_chk or {}).get("status") or "").lower()
            prev_filled = float((prev_chk or {}).get("filled") or 0.0)
            exec_px = float((prev_chk or {}).get("average") or (prev_chk or {}).get("price") or row.entry_price or 0.0)
            if prev_filled > 0:
                if (tp_config or sl_config) and not reduce_only:
                    await BracketOrderService._spawn_bracket_for_amount(
                        exchange=exchange,
                        symbol=symbol,
                        side=side,
                        filled_amount=prev_filled,
                        average_price=exec_px,
                        is_futures=is_futures,
                        tp_config=tp_config,
                        sl_config=sl_config,
                        user_id=int(row.user_id),
                        api_key_record=safe_key,
                        entry_order_id=cid,
                    )
                remaining_amt = max(0.0, BracketOrderService._safe_amount_to_precision(exchange, symbol, remaining_amt - prev_filled))
            if prev_st in ("open", "new", "partially_filled", "partiallyfilled"):
                await BracketOrderService._cancel_futures_order_universal(order_ex, str(prev_oid), symbol, is_conditional=False)
            elif prev_st in ("closed", "filled") and remaining_amt <= 0:
                await asyncio.to_thread(mark_terminal_sync, cid, "completed", "smart_peg_filled_offline")
                return "completed_offline"
        except Exception as exc:
            logger.debug(f"[AutoRecovery] Smart Peg prev order check notice ({prev_oid}): {exc}")

    ref_px = float(row.entry_price or 0.0)
    min_notional = _get_min_notional(exchange, symbol)
    if remaining_amt <= 0 or (ref_px > 0 and _calc_order_notional_usd(exchange, symbol, remaining_amt, ref_px) < min_notional):
        await asyncio.to_thread(mark_terminal_sync, cid, "completed", "smart_peg_completed_offline")
        return "completed_offline"

    asyncio.create_task(
        execute_smart_peg_entry(
            exchange=order_ex,
            symbol=symbol,
            side=side,
            amount=remaining_amt,
            is_futures=is_futures,
            user_id=int(row.user_id),
            api_key_record=safe_key,
            tp_config=tp_config,
            sl_config=sl_config,
            max_chase_deviation_pct=float(cfg.get("max_chase_deviation_pct", 2.0)),
            max_attempts=int(cfg.get("max_attempts", 0)),
            peg_id=cid,
            reduce_only=reduce_only,
            urgent_mode=bool(cfg.get("urgent_mode", False)),
            leverage=cfg.get("leverage"),
            margin_mode=cfg.get("margin_mode"),
            ai_filter_info=cfg.get("ai_filter_info"),
            contract_size=float(cfg.get("contract_size", 1.0)),
            is_inverse=cfg.get("is_inverse"),
            send_initial_notify=False,
            anchor_price=cfg.get("anchor_price"),
            initial_benchmark_override=float(row.entry_price or 0.0) or None,
            skip_exchange_upgrade=True,
        )
    )
    logger.info(f"🔄 [AutoRecovery] Resumed Smart Peg Entry {cid} ({symbol}, rem={remaining_amt})")
    return "resumed"


async def _recover_native_otoco(row: Any, exchange: Any) -> str:
    from app.services.bracket_order_service import BracketOrderService

    cfg = dict(row.config or {})
    raw_res = cfg.get("raw_res")
    if not isinstance(raw_res, dict) or not row.user_id:
        await asyncio.to_thread(mark_terminal_sync, str(row.monitor_id), "completed", "invalid_otoco_payload")
        return "completed_offline"

    asyncio.create_task(
        BracketOrderService.monitor_native_otoco(
            exchange=exchange,
            symbol=str(row.symbol),
            side=str(row.side),
            amount=float(row.amount or 0.0),
            entry_price=float(row.entry_price or 0.0),
            raw_res=raw_res,
            user_id=int(row.user_id),
            api_key_id=int(row.api_key_id),
            monitor_id=str(row.monitor_id),
            skip_entry_fill_notify=bool(cfg.get("working_filled", False)),
        )
    )
    logger.info(f"🔄 [AutoRecovery] Resumed Native OTOCO watcher {row.monitor_id} ({row.symbol})")
    return "resumed"


def _load_active_monitors_and_keys() -> Tuple[List[Any], Dict[int, Any]]:
    from app.db.session import SessionLocal
    from app.models import ApiKey
    from app.models.manual_trade_monitor import ManualTradeMonitor

    db = SessionLocal()
    try:
        rows = (
            db.query(ManualTradeMonitor)
            .filter(ManualTradeMonitor.status.in_(ACTIVE_STATUSES))
            .order_by(ManualTradeMonitor.id.asc())
            .all()
        )
        if not rows:
            return [], {}
        key_ids = list({int(r.api_key_id) for r in rows})
        keys = db.query(ApiKey).filter(ApiKey.id.in_(key_ids), ApiKey.is_enabled == True).all()
        key_map = {int(k.id): _build_safe_api_key(k) for k in keys}
        # Detach rows safely as SimpleNamespaces before closing session
        detached_rows = [
            SimpleNamespace(
                monitor_id=r.monitor_id,
                kind=r.kind,
                user_id=r.user_id,
                api_key_id=r.api_key_id,
                symbol=r.symbol,
                is_futures=r.is_futures,
                side=r.side,
                status=r.status,
                sl_type=r.sl_type,
                sl_mode=r.sl_mode,
                amount=r.amount,
                entry_price=r.entry_price,
                trigger_price=r.trigger_price,
                highest_price=r.highest_price,
                lowest_price=r.lowest_price,
                entry_order_id=r.entry_order_id,
                tp_order_id=r.tp_order_id,
                tp_price=r.tp_price,
                disaster_sl_order_id=r.disaster_sl_order_id,
                breakeven_activated=r.breakeven_activated,
                manual_trigger_override=r.manual_trigger_override,
                config=dict(r.config or {}),
            )
            for r in rows
        ]
        return detached_rows, key_map
    finally:
        db.close()


async def recover_manual_trade_monitors(startup_delay_seconds: float = 1.5) -> Dict[str, int]:
    """
    Startup recovery entrypoint:
    1. Ensures DB schema exists.
    2. Loads all unfinished Manual Trade monitors from PostgreSQL.
    3. Verifies live order/position state on the exchange and resumes active monitors.
    """
    summary = {"total": 0, "resumed": 0, "completed_offline": 0, "skipped": 0, "errors": 0}
    try:
        if startup_delay_seconds > 0:
            await asyncio.sleep(startup_delay_seconds)

        await asyncio.to_thread(ensure_manual_trade_monitors_table)

        from app.services.user_order_stream import ensure_user_order_stream

        pending_retry_delays = list(RECOVERY_RETRY_DELAYS)
        resumed_by_user: Dict[int, List[str]] = {}
        handled_ids: set = set()
        attempt = 0

        while True:
            attempt += 1
            rows, key_map = await asyncio.to_thread(_load_active_monitors_and_keys)
            if attempt == 1:
                summary["total"] = len(rows)
            rows = [r for r in rows if str(r.monitor_id) not in handled_ids]
            if not rows:
                if attempt == 1:
                    logger.info("ℹ️ [AutoRecovery] No interrupted manual trade monitors to resume.")
                    return summary
                break

            logger.info(
                f"🔄 [AutoRecovery] Found {len(rows)} persisted manual trade monitor(s) "
                f"(attempt {attempt}). Verifying exchange state..."
            )
            sem = asyncio.Semaphore(5)
            pass_errors = 0

            async def _process_row(row: Any):
                nonlocal pass_errors
                async with sem:
                    try:
                        safe_key = key_map.get(int(row.api_key_id))
                        if not safe_key:
                            await asyncio.to_thread(mark_terminal_sync, str(row.monitor_id), "cancelled", "api_key_unavailable")
                            handled_ids.add(str(row.monitor_id))
                            summary["skipped"] += 1
                            return

                        general_ex, order_ex = await _get_exchanges_for_record(safe_key, bool(row.is_futures))
                        try:
                            ensure_user_order_stream(int(row.user_id), safe_key, bool(row.is_futures), str(row.symbol))
                        except Exception:
                            pass

                        if row.kind in ("software_sl", "smart_chase"):
                            outcome = await _recover_software_sl_or_chase(row, safe_key, general_ex, order_ex)
                        elif row.kind == "entry_monitor":
                            outcome = await _recover_entry_monitor(row, safe_key, general_ex)
                        elif row.kind == "smart_peg":
                            outcome = await _recover_smart_peg(row, safe_key, general_ex, order_ex)
                        elif row.kind == "native_otoco":
                            outcome = await _recover_native_otoco(row, general_ex)
                        else:
                            outcome = "skipped"

                        handled_ids.add(str(row.monitor_id))
                        if outcome == "resumed":
                            summary["resumed"] += 1
                            resumed_by_user.setdefault(int(row.user_id), []).append(
                                f"• `{row.symbol}` ({row.sl_type or row.kind})"
                            )
                        elif outcome == "completed_offline":
                            summary["completed_offline"] += 1
                        else:
                            summary["skipped"] += 1
                    except Exception as row_err:
                        pass_errors += 1
                        logger.error(f"❌ [AutoRecovery] Failed recovering monitor {row.monitor_id} ({row.symbol}): {row_err}", exc_info=True)

            await asyncio.gather(*(_process_row(r) for r in rows))
            # Yield 1 tick so spawned monitor tasks register in RAM registries immediately
            await asyncio.sleep(0)

            summary["errors"] = pass_errors
            if pass_errors == 0 or not pending_retry_delays:
                break
            delay = pending_retry_delays.pop(0)
            logger.warning(f"⏳ [AutoRecovery] {pass_errors} monitor(s) failed recovery (transient outage?). Retrying in {delay}s...")
            await asyncio.sleep(delay)

        # Notify users via Telegram when monitors were automatically restored after restart
        if resumed_by_user:
            from app.db.session import SessionLocal
            from app.services.notification import NotificationService

            for uid, items in resumed_by_user.items():
                try:
                    db = SessionLocal()
                    try:
                        msg = (
                            "🔄 *AUTO-RECOVERY: SL/BRACKET MONITORS RESUMED*\n"
                            "━━━━━━━━━━━━━━━━━━━━\n"
                            f"Server restart detected. Resumed `{len(items)}` active monitor(s):\n"
                            + "\n".join(items[:15])
                        )
                        await NotificationService.send_message(
                            db, uid, msg, parse_mode="Markdown", alert_type="alert_manual_trade"
                        )
                    finally:
                        db.close()
                except Exception as n_err:
                    logger.debug(f"[AutoRecovery] Notification notice for user {uid}: {n_err}")

        logger.info(
            f"✅ [AutoRecovery] Complete | Total={summary['total']} | Resumed={summary['resumed']} | "
            f"ClosedOffline={summary['completed_offline']} | Skipped={summary['skipped']} | Errors={summary['errors']}"
        )
        return summary
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.error(f"❌ [AutoRecovery] Startup recovery failed: {exc}", exc_info=True)
        return summary
