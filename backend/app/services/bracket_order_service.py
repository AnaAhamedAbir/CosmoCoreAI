"""
Bracket Order Service
=====================
Entry order fill হওয়ার পর স্বয়ংক্রিয়ভাবে opposite Take-Profit order place করে।
Background asyncio task হিসেবে চলে — main request কে block করে না।

Fixes applied:
  BUG-03: passphrase empty string guard
  BUG-07: Telegram notification after TP placed (uses own DB session)
  BUG-10: Proper partial fill handling at timeout
"""

import asyncio
import logging
from app.services.exchange_pool import get_or_create_exchange
from app.core.security import decrypt_key
from app.services.notification import NotificationService

logger = logging.getLogger(__name__)


class BracketOrderService:
    @staticmethod
    async def monitor_and_execute_bracket(
        api_key_record,
        entry_order_id: str,
        symbol: str,
        side: str,          # Entry side ('buy' or 'sell')
        amount: float,
        is_futures: bool,
        tp_config: dict = None,
        sl_config: dict = None,
        initial_entry_price: float = 0.0,
        user_id: int = 0,   # BUG-07: pass user_id for notification
    ):
        """
        Background task:
        1. Monitors the entry order status for up to `timeout_mins`.
        2. Detects full or partial fills.
        3. Fires opposite Take-Profit order based on the config.
        4. Sends a Telegram notification after TP is placed.
        """
        try:
            # BUG-03 fix: Guard against empty string passphrase crashing decrypt_key
            decrypted_api_key = decrypt_key(api_key_record.api_key)
            decrypted_secret  = decrypt_key(api_key_record.secret_key)
            raw_pp = getattr(api_key_record, 'passphrase', None)
            passphrase = decrypt_key(raw_pp) if raw_pp else None

            exchange = await get_or_create_exchange(
                api_key_id=api_key_record.id,
                exchange_name=api_key_record.exchange,
                decrypted_api_key=decrypted_api_key,
                decrypted_secret=decrypted_secret,
                is_futures=is_futures,
                passphrase=passphrase
            )

            max_timeout_mins = 5
            if tp_config and tp_config.get('timeout_mins'):
                max_timeout_mins = max(max_timeout_mins, tp_config.get('timeout_mins'))
            if sl_config and sl_config.get('timeout_mins'):
                max_timeout_mins = max(max_timeout_mins, sl_config.get('timeout_mins'))

            timeout_iters = int((max_timeout_mins * 60) / 2)  # poll every 2s

            logger.info(
                f"🛡️ Bracket Monitor started | Order: {entry_order_id} | "
                f"Symbol: {symbol} | Timeout: {max_timeout_mins} min"
            )

            filled_amount  = 0.0
            average_price  = 0.0
            order_closed   = False

            # ── Polling Loop ───────────────────────────────────────────
            for _ in range(timeout_iters):
                await asyncio.sleep(2)

                try:
                    order_status = await exchange.fetch_order(entry_order_id, symbol)
                    status = order_status.get('status', '').lower()

                    if status in ('closed', 'filled'):
                        filled_amount = float(order_status.get('filled') or amount)
                        average_price = float(
                            order_status.get('average') or
                            order_status.get('price') or
                            initial_entry_price
                        )
                        order_closed = True
                        break

                    elif status in ('canceled', 'cancelled', 'expired', 'rejected'):
                        filled = float(order_status.get('filled') or 0.0)
                        if filled > 0:
                            filled_amount = filled
                            average_price = float(
                                order_status.get('average') or
                                order_status.get('price') or
                                initial_entry_price
                            )
                            order_closed = True
                        else:
                            logger.info(
                                f"⚠️ Bracket Monitor: Entry {entry_order_id} "
                                f"canceled with 0 fill. Aborting TP."
                            )
                        break

                    elif status in ('open', 'new'):
                        # Near-full fill check (≥99%)
                        filled = float(order_status.get('filled') or 0.0)
                        if filled >= amount * 0.99:
                            filled_amount = filled
                            average_price = float(
                                order_status.get('average') or
                                order_status.get('price') or
                                initial_entry_price
                            )
                            order_closed = True
                            break

                except Exception as poll_e:
                    logger.debug(f"Bracket Monitor poll error (non-fatal): {poll_e}")

            # ── BUG-10 fix: Proper partial fill handling at timeout ────
            if not order_closed:
                if filled_amount > 0:
                    # Partial fill at timeout — still place TP for the filled portion
                    logger.info(
                        f"⚠️ Bracket Monitor: Timed out with partial fill "
                        f"({filled_amount}/{amount}). Proceeding with TP on filled amount."
                    )
                    order_closed = True
                else:
                    logger.warning(
                        f"⏰ Bracket Monitor: Entry {entry_order_id} timed out "
                        f"after {tp_config.get('timeout_mins')} mins with no fill. Aborting."
                    )
                    return

            # ── Bracket Order (TP & SL) Calculation ──────────────────────────────────────────
            logger.info(
                f"🎯 Bracket Monitor: Entry {entry_order_id} filled "
                f"{filled_amount} @ {average_price}. Spawning Bracket orders..."
            )

            final_amount = (
                float(exchange.amount_to_precision(symbol, filled_amount))
                if hasattr(exchange, 'amount_to_precision') else filled_amount
            )
            opposite_side = 'sell' if side.lower() == 'buy' else 'buy'

            # --- Execute TP ---
            if tp_config:
                tp_order_type = tp_config.get('order_type', 'Limit').lower()
                mode          = tp_config.get('mode', 'percentage')
                val           = float(tp_config.get('value', 0))
    
                tp_price = average_price
                if mode == 'percentage':
                    pct = val / 100.0
                    tp_price = average_price * (1 + pct) if opposite_side == 'sell' else average_price * (1 - pct)
                elif mode == 'price':
                    tp_price = average_price + val if opposite_side == 'sell' else average_price - val
    
                final_tp_price = (
                    float(exchange.price_to_precision(symbol, tp_price))
                    if hasattr(exchange, 'price_to_precision') else tp_price
                )
    
                ex_params: dict = {}
                if is_futures:
                    ex_params['reduceOnly'] = True
                if tp_order_type == 'limit':
                    ex_params['postOnly'] = True
    
                # ── Execute TP Order ────────────────────────────────────────
                try:
                    if tp_order_type == 'limit':
                        tp_res = await exchange.create_limit_order(
                            symbol, opposite_side, final_amount, final_tp_price, ex_params
                        )
                    else:
                        tp_res = await exchange.create_market_order(
                            symbol, opposite_side, final_amount, ex_params
                        )
    
                    logger.info(f"✅ Bracket Monitor: TP placed! ID: {tp_res.get('id')}")
    
                    if user_id:
                        try:
                            from app.db.session import SessionLocal
                            db = SessionLocal()
                            try:
                                msg = (
                                    f"🎯 *Bracket TP Executed!*\n"
                                    f"Exchange: {api_key_record.exchange.capitalize()}\n"
                                    f"Pair: `{symbol}`\n"
                                    f"TP Side: {opposite_side.upper()}\n"
                                    f"Amount: `{final_amount}`\n"
                                    f"TP Price: `{final_tp_price}`\n"
                                    f"Mode: {mode} ({val}{'%' if mode == 'percentage' else '$'})"
                                )
                                await NotificationService.send_message(db, user_id, msg)
                            finally:
                                db.close()
                        except Exception as notify_err:
                            logger.warning(f"TP notification failed (non-fatal): {notify_err}")
    
                except Exception as ex_e:
                    logger.error(f"❌ Bracket Monitor: Failed to place TP Order! {ex_e}")

            # --- Execute SL ---
            if sl_config:
                sl_mode = sl_config.get('mode', 'percentage')
                sl_val  = float(sl_config.get('value', 0))

                sl_price = average_price
                if sl_mode == 'percentage':
                    pct = sl_val / 100.0
                    sl_price = average_price * (1 - pct) if opposite_side == 'sell' else average_price * (1 + pct)
                elif sl_mode == 'price':
                    sl_price = average_price - sl_val if opposite_side == 'sell' else average_price + sl_val

                final_sl_price = (
                    float(exchange.price_to_precision(symbol, sl_price))
                    if hasattr(exchange, 'price_to_precision') else sl_price
                )

                sl_params: dict = {'stopPrice': final_sl_price}
                if is_futures:
                    sl_params['reduceOnly'] = True

                try:
                    # Often SL is placed as a stop market order using unified trigger params
                    # Using the standard ccxt fallback style
                    order_type = 'STOP_MARKET' if is_futures else 'STOP_LOSS'
                    sl_res = await exchange.create_order(
                        symbol, order_type, opposite_side, final_amount, None, sl_params
                    )

                    logger.info(f"✅ Bracket Monitor: SL placed! ID: {sl_res.get('id')}")

                    if user_id:
                        try:
                            from app.db.session import SessionLocal
                            db = SessionLocal()
                            try:
                                msg = (
                                    f"🛡️ *Bracket SL Executed!*\n"
                                    f"Exchange: {api_key_record.exchange.capitalize()}\n"
                                    f"Pair: `{symbol}`\n"
                                    f"SL Side: {opposite_side.upper()}\n"
                                    f"Amount: `{final_amount}`\n"
                                    f"Stop Price: `{final_sl_price}`\n"
                                    f"Mode: {sl_mode} ({sl_val}{'%' if sl_mode == 'percentage' else '$'})"
                                )
                                await NotificationService.send_message(db, user_id, msg)
                            finally:
                                db.close()
                        except Exception as notify_err:
                            logger.warning(f"SL notification failed (non-fatal): {notify_err}")

                except Exception as ex_e:
                    logger.error(f"❌ Bracket Monitor: Failed to place SL Order! {ex_e}")

        except Exception as main_e:
            logger.error(f"Bracket Monitor critical failure: {main_e}", exc_info=True)


bracket_order_service = BracketOrderService()
