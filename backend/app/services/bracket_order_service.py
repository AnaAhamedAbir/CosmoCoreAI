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

            processed_amount = 0.0
            average_price = initial_entry_price
            order_closed = False

            # ── Polling Loop ───────────────────────────────────────────
            for _ in range(timeout_iters):
                await asyncio.sleep(2)

                try:
                    order_status = await exchange.fetch_order(entry_order_id, symbol)
                    status = order_status.get('status', '').lower()
                    filled = float(order_status.get('filled') or 0.0)

                    if filled > processed_amount:
                        newly_filled = filled - processed_amount
                        average_price = float(
                            order_status.get('average') or
                            order_status.get('price') or
                            initial_entry_price
                        )
                        logger.info(f"⚡ Partial fill detected for {entry_order_id}: {newly_filled} (Total: {filled}/{amount})")
                        
                        # Spawning bracket for this chunk
                        asyncio.create_task(
                            BracketOrderService._spawn_bracket_for_amount(
                                exchange, symbol, side, newly_filled, average_price,
                                is_futures, tp_config, sl_config, user_id, api_key_record
                            )
                        )
                        processed_amount = filled

                    if status in ('closed', 'filled') or processed_amount >= amount * 0.99:
                        order_closed = True
                        break

                    elif status in ('canceled', 'cancelled', 'expired', 'rejected'):
                        logger.info(f"⚠️ Bracket Monitor: Entry {entry_order_id} canceled. Total processed: {processed_amount}")
                        order_closed = True
                        break

                except Exception as poll_e:
                    logger.debug(f"Bracket Monitor poll error (non-fatal): {poll_e}")

            if not order_closed and processed_amount < amount:
                logger.warning(
                    f"⏰ Bracket Monitor: Entry {entry_order_id} timed out "
                    f"after {max_timeout_mins} mins. Processed {processed_amount}/{amount}."
                )

        except Exception as main_e:
            logger.error(f"Bracket Monitor critical failure: {main_e}", exc_info=True)


    @staticmethod
    async def _spawn_bracket_for_amount(
        exchange, symbol: str, side: str, filled_amount: float, average_price: float,
        is_futures: bool, tp_config: dict, sl_config: dict, user_id: int, api_key_record
    ):
        try:
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
    
                try:
                    tp_res = None
                    is_ws_success = False
                    
                    if hasattr(exchange, 'create_order_ws'):
                        try:
                            tp_price_arg = final_tp_price if tp_order_type == 'limit' else None
                            tp_res = await exchange.create_order_ws(
                                symbol, tp_order_type, opposite_side, final_amount, tp_price_arg, ex_params
                            )
                            is_ws_success = True
                        except Exception as ws_e:
                            logger.warning(f"Bracket TP WebSocket failed ({ws_e}). Fallback to REST.")
                            
                    if not is_ws_success:
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
                                    f"🎯 *Bracket TP Executed (Chunk)*\n"
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
                sl_type = sl_config.get('type', 'fixed')
                sl_mode = sl_config.get('mode', 'percentage')
                sl_val  = float(sl_config.get('value', 0))

                if sl_type == 'trailing':
                    placed_native = False
                    if is_futures and sl_mode == 'percentage':
                        # Try Native Trailing Stop Market for Futures
                        try:
                            logger.info(f"🚀 Bracket Monitor: Placing Native Trailing Stop for {symbol} (Futures)")
                            sl_params = {'reduceOnly': True, 'callbackRate': sl_val}
                            sl_res = None
                            is_ws_success = False
                            
                            if hasattr(exchange, 'create_order_ws'):
                                try:
                                    sl_res = await exchange.create_order_ws(
                                        symbol, 'TRAILING_STOP_MARKET', opposite_side, final_amount, None, sl_params
                                    )
                                    is_ws_success = True
                                except Exception as ws_e:
                                    logger.warning(f"Native Trailing SL WS failed ({ws_e}). Fallback to REST.")
                            
                            if not is_ws_success:
                                sl_res = await exchange.create_order(
                                    symbol, 'TRAILING_STOP_MARKET', opposite_side, final_amount, None, sl_params
                                )
                            
                            logger.info(f"✅ Native Trailing SL placed! ID: {sl_res.get('id')}")
                            placed_native = True
                            
                            if user_id:
                                try:
                                    from app.db.session import SessionLocal
                                    db = SessionLocal()
                                    try:
                                        msg = (
                                            f"🛡️ *Native Trailing SL Executed*\n"
                                            f"Exchange: {api_key_record.exchange.capitalize()}\n"
                                            f"Pair: `{symbol}`\n"
                                            f"Callback Rate: `{sl_val}%`"
                                        )
                                        await NotificationService.send_message(db, user_id, msg)
                                    finally:
                                        db.close()
                                except Exception as notify_err:
                                    pass
                        except Exception as e:
                            logger.error(f"❌ Failed to place native Trailing SL: {e}. Falling back to software loop.")
                    
                    if not placed_native:
                        logger.info(f"🚀 Bracket Monitor: Starting Software Trailing Stop for {symbol}")
                        asyncio.create_task(
                            BracketOrderService._software_trailing_stop_loop(
                                exchange, symbol, opposite_side, final_amount,
                                average_price, sl_mode, sl_val, is_futures, user_id, api_key_record
                            )
                        )
                else:
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
                        order_type = 'STOP_MARKET' if is_futures else 'STOP_LOSS'
                        sl_res = None
                        is_ws_success = False
                        
                        if hasattr(exchange, 'create_order_ws'):
                            try:
                                sl_res = await exchange.create_order_ws(
                                    symbol, order_type, opposite_side, final_amount, None, sl_params
                                )
                                is_ws_success = True
                            except Exception as ws_e:
                                logger.warning(f"Bracket SL WebSocket failed ({ws_e}). Fallback to REST.")
                        
                        if not is_ws_success:
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
                                        f"🛡️ *Bracket SL Executed (Chunk)*\n"
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

        except Exception as chunk_e:
            logger.error(f"Failed to spawn bracket for chunk: {chunk_e}")


    @staticmethod
    async def _software_trailing_stop_loop(
        exchange, symbol: str, opposite_side: str, amount: float,
        entry_price: float, mode: str, val: float, is_futures: bool,
        user_id: int, api_key_record
    ):
        highest_price = entry_price
        lowest_price = entry_price
        
        logger.info(f"🏁 Trailing SL loop started for {symbol} | Entry: {entry_price}")

        while True:
            await asyncio.sleep(2)  # poll interval
            try:
                # Security Check: Ensure position is still open to prevent accidental reverse trades
                is_open = True
                try:
                    if is_futures:
                        positions = await exchange.fetch_positions([symbol])
                        pos = positions[0] if positions else None
                        if not pos or float(pos.get('info', {}).get('positionAmt', 0)) == 0:
                            is_open = False
                    else:
                        base_coin = symbol.split('/')[0]
                        bal = await exchange.fetch_balance()
                        free = float(bal.get(base_coin, {}).get('free', 0.0))
                        if opposite_side == 'sell' and free < amount:
                            is_open = False
                except Exception as pos_e:
                    logger.debug(f"Could not check position for trailing SL (non-fatal): {pos_e}")
                
                if not is_open:
                    logger.info(f"🚫 Position closed externally. Canceling software trailing stop for {symbol}.")
                    break

                ticker = await exchange.fetch_ticker(symbol)
                current_price = ticker.get('last')
                if not current_price:
                    continue
                
                trigger_price = 0.0
                if opposite_side == 'sell': # We are Long, so we want to sell
                    highest_price = max(highest_price, current_price)
                    if mode == 'percentage':
                        trigger_price = highest_price * (1 - (val / 100.0))
                    else:
                        trigger_price = highest_price - val
                        
                    if current_price <= trigger_price:
                        logger.info(f"💥 Trailing SL triggered for Long. High: {highest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        break
                else: # We are Short, so we want to buy
                    lowest_price = min(lowest_price, current_price)
                    if mode == 'percentage':
                        trigger_price = lowest_price * (1 + (val / 100.0))
                    else:
                        trigger_price = lowest_price + val
                        
                    if current_price >= trigger_price:
                        logger.info(f"💥 Trailing SL triggered for Short. Low: {lowest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        break

            except Exception as e:
                logger.debug(f"Trailing SL tick error: {e}")
                
        # Close the position!
        try:
            params = {'reduceOnly': True} if is_futures else {}
            sl_res = None
            is_ws_success = False
            
            if hasattr(exchange, 'create_order_ws'):
                try:
                    sl_res = await exchange.create_order_ws(
                        symbol, 'market', opposite_side, amount, None, params
                    )
                    is_ws_success = True
                except Exception as ws_e:
                    logger.warning(f"Trailing SL exit WS failed ({ws_e}). Fallback to REST.")
            
            if not is_ws_success:
                sl_res = await exchange.create_market_order(symbol, opposite_side, amount, params)

            logger.info(f"✅ Trailing SL Executed! ID: {sl_res.get('id')}")

            if user_id:
                try:
                    from app.db.session import SessionLocal
                    db = SessionLocal()
                    try:
                        msg = (
                            f"🏃‍♂️💨 *Trailing SL Executed!*\n"
                            f"Exchange: {api_key_record.exchange.capitalize()}\n"
                            f"Pair: `{symbol}`\n"
                            f"Side: {opposite_side.upper()}\n"
                            f"Amount: `{amount}`\n"
                            f"Exit Price: ~{current_price}\n"
                            f"Mode: {mode} ({val}{'%' if mode == 'percentage' else '$'})"
                        )
                        await NotificationService.send_message(db, user_id, msg)
                    finally:
                        db.close()
                except Exception as notify_err:
                    logger.warning(f"Trailing SL notification failed: {notify_err}")
        except Exception as e:
            logger.error(f"❌ Failed to execute Trailing SL: {e}")

bracket_order_service = BracketOrderService()
