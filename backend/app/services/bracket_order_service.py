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

import uuid
from fastapi import HTTPException

logger = logging.getLogger(__name__)

class BracketOrderService:
    ACTIVE_SOFTWARE_SL = {}  # { sl_id: { symbol, side, amount, trigger_price, mode } }
    
    @staticmethod
    async def update_software_bracket(sl_id: str, new_price: float, api_key_id: int = None, user_id: int = 0) -> dict:
        """
        Dynamically update the trigger price of an active software SL (Smart Chase, Trailing, Fixed).
        Safely re-calculates futures disaster stops if active.
        """
        sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
        if not sl_meta:
            from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
            if sl_id in ACTIVE_SMART_CHASES:
                ACTIVE_SMART_CHASES[sl_id]['original_sl'] = new_price
                ACTIVE_SMART_CHASES[sl_id]['current_maker_price'] = new_price
                logger.info(f"🎯 Updated active smart chase target for {sl_id} to {new_price}")
                return {
                    "status": "success",
                    "sl_id": sl_id,
                    "new_price": new_price,
                    "message": f"Updated active Smart Chase target to {new_price}"
                }
            raise HTTPException(status_code=404, detail="Software SL bracket not found or already triggered/closed.")

        symbol = sl_meta.get('symbol')
        side = sl_meta.get('side')
        amount = sl_meta.get('amount', 0.0)
        exchange = sl_meta.get('exchange')
        is_futures = sl_meta.get('is_futures', False)
        mode = sl_meta.get('mode', 'SMART_CHASE')

        # Format price with exchange precision if available
        prec_price = float(exchange.price_to_precision(symbol, new_price)) if exchange and hasattr(exchange, 'price_to_precision') else new_price

        # Update metadata dynamically
        sl_meta['trigger_price'] = prec_price
        sl_meta['price'] = prec_price
        sl_meta['manual_trigger_override'] = prec_price

        # If disaster SL order exists on futures exchange, replace it with updated disaster level
        disaster_order_id = sl_meta.get('disaster_sl_order_id')
        max_dev = float(sl_meta.get('max_deviation_pct') or 1.0)
        if disaster_order_id and exchange and is_futures:
            try:
                # Cancel previous disaster stop
                try:
                    await exchange.cancel_order(disaster_order_id, symbol)
                except Exception as c_err:
                    logger.debug(f"Previous disaster SL cancel non-fatal error: {c_err}")
                
                # Re-place disaster stop at new price ± max_dev
                disaster_price = prec_price * (1 - (max_dev / 100.0)) if side == 'sell' else prec_price * (1 + (max_dev / 100.0))
                disaster_price_prec = (
                    float(exchange.price_to_precision(symbol, disaster_price))
                    if hasattr(exchange, 'price_to_precision') else disaster_price
                )
                disaster_params = {'reduceOnly': True, 'stopPrice': disaster_price_prec}
                
                # Check hedge mode positionSide
                api_key_rec = sl_meta.get('api_key_record')
                if getattr(api_key_rec, 'exchange', '').lower().startswith('binance') or getattr(exchange, 'id', '').lower().startswith('binance'):
                    for method_name in ['fapiPrivateGetPositionSideDual', 'fapiprivateGetPositionsideDual', 'fapiprivate_get_positionside_dual']:
                        method = getattr(exchange, method_name, None)
                        if method and callable(method):
                            try:
                                res = await method()
                                if res.get('dualSidePosition', False):
                                    disaster_params['positionSide'] = 'LONG' if side == 'sell' else 'SHORT'
                                break
                            except Exception:
                                pass
                
                d_res = await exchange.create_order(symbol, 'STOP_MARKET', side, amount, None, disaster_params)
                sl_meta['disaster_sl_order_id'] = d_res.get('id')
                logger.info(f"🛡️ Replaced Native Disaster SL at {disaster_price_prec} (New ID: {d_res.get('id')})")
            except Exception as d_err:
                logger.warning(f"⚠️ Failed to update native disaster SL: {d_err}")

        logger.info(f"✅ Software SL [{mode}] for {symbol} ({side}) trigger price updated to {prec_price}")
        return {
            "status": "success",
            "sl_id": sl_id,
            "symbol": symbol,
            "side": side,
            "new_price": prec_price,
            "mode": mode,
            "message": f"Stop-Loss trigger price successfully updated to {prec_price}"
        }
    
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

            # Determine if unlimited monitoring (0, None, <=0) is requested
            is_unlimited = False
            active_timeouts = []

            for cfg in (tp_config, sl_config):
                if cfg is not None and isinstance(cfg, dict) and cfg:
                    t_val = cfg.get('timeout_mins')
                    try:
                        if t_val is None or float(t_val) <= 0:
                            is_unlimited = True
                        else:
                            active_timeouts.append(float(t_val))
                    except (ValueError, TypeError):
                        is_unlimited = True

            if is_unlimited or not active_timeouts:
                is_unlimited = True
                max_timeout_mins = 0
            else:
                max_timeout_mins = max(active_timeouts)

            logger.info(
                f"🛡️ Bracket Monitor started | Order: {entry_order_id} | "
                f"Symbol: {symbol} | Timeout: {'Unlimited (Until Filled)' if is_unlimited else f'{max_timeout_mins} min'}"
            )

            processed_amount = 0.0
            average_price = initial_entry_price
            order_closed = False
            elapsed_seconds = 0

            # ── Polling Loop ───────────────────────────────────────────
            while True:
                if not is_unlimited and elapsed_seconds >= max_timeout_mins * 60:
                    break
                
                # Adaptive Polling to prevent rate limit bans on unlimited orders
                if elapsed_seconds < 300: # First 5 mins
                    sleep_time = 2
                elif elapsed_seconds < 3600: # Next 1 hour
                    sleep_time = 10
                else: # After 1 hour
                    sleep_time = 30
                    
                await asyncio.sleep(sleep_time)
                elapsed_seconds += sleep_time

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

            if not order_closed and processed_amount < amount and not is_unlimited:
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

            # --- Binance Spot OCO handling ---
            sl_type = sl_config.get('type', 'fixed') if sl_config else None
            if exchange.id == 'binance' and not is_futures and tp_config and sl_config and sl_type == 'fixed':
                logger.info(f"⚡ Bracket Monitor: Using Native Binance OCO for {symbol} (Market Entry Fallback)")
                
                # Calculate TP Price
                tp_mode = tp_config.get('mode', 'percentage')
                tp_val = float(tp_config.get('value', 0))
                if tp_mode == 'percentage':
                    pct = tp_val / 100.0
                    tp_price = average_price * (1 + pct) if opposite_side == 'sell' else average_price * (1 - pct)
                elif tp_mode == 'absolute':
                    tp_price = tp_val
                else:
                    tp_price = average_price + tp_val if opposite_side == 'sell' else average_price - tp_val
                
                # Calculate SL Price
                sl_mode = sl_config.get('mode', 'percentage')
                sl_val = float(sl_config.get('value', 0))
                if sl_mode == 'percentage':
                    pct = sl_val / 100.0
                    sl_price = average_price * (1 - pct) if opposite_side == 'sell' else average_price * (1 + pct)
                elif sl_mode == 'absolute':
                    sl_price = sl_val
                else:
                    sl_price = average_price - sl_val if opposite_side == 'sell' else average_price + sl_val
                
                market = exchange.market(symbol)
                native_symbol = market['id']
                
                payload = {
                    "symbol": native_symbol,
                    "side": opposite_side.upper(),
                    "quantity": exchange.amount_to_precision(symbol, final_amount),
                }
                
                if opposite_side == 'sell': # We bought, now we sell
                    payload['aboveType'] = 'LIMIT_MAKER'
                    payload['abovePrice'] = exchange.price_to_precision(symbol, tp_price)
                    payload['belowType'] = 'STOP_LOSS_LIMIT'
                    payload['belowTimeInForce'] = 'GTC'
                    payload['belowStopPrice'] = exchange.price_to_precision(symbol, sl_price)
                    payload['belowPrice'] = exchange.price_to_precision(symbol, sl_price * 0.999)
                else: # We sold, now we buy
                    payload['aboveType'] = 'STOP_LOSS_LIMIT'
                    payload['aboveTimeInForce'] = 'GTC'
                    payload['aboveStopPrice'] = exchange.price_to_precision(symbol, sl_price)
                    payload['abovePrice'] = exchange.price_to_precision(symbol, sl_price * 1.001)
                    payload['belowType'] = 'LIMIT_MAKER'
                    payload['belowPrice'] = exchange.price_to_precision(symbol, tp_price)
                    
                try:
                    raw_res = await exchange.private_post_orderlist_oco(payload)
                    logger.info(f"✅ Native Binance OCO placed successfully! ID: {raw_res.get('orderListId')}")
                    
                    if user_id:
                        try:
                            from app.db.session import SessionLocal
                            db = SessionLocal()
                            try:
                                msg = (
                                    f"✅ *Native OCO Executed (Market)*\n"
                                    f"Exchange: Binance Spot\n"
                                    f"Pair: `{symbol}`\n"
                                    f"Amount: `{final_amount}`\n"
                                    f"TP Price: `{exchange.price_to_precision(symbol, tp_price)}`\n"
                                    f"SL Price: `{exchange.price_to_precision(symbol, sl_price)}`"
                                )
                                await NotificationService.send_message(db, user_id, msg)
                            finally:
                                db.close()
                        except Exception as notify_err:
                            pass
                    return # Exit since we placed both successfully!
                except Exception as e:
                    logger.error(f"❌ Native OCO failed: {e}")
                    raise

            tp_order_id = None
            # --- Execute TP ---
            if tp_config:
                tp_order_type = tp_config.get('order_type', 'Limit').lower()
                mode          = tp_config.get('mode', 'percentage')
                val           = float(tp_config.get('value', 0))
    
                tp_price = average_price
                if mode == 'percentage':
                    pct = val / 100.0
                    tp_price = average_price * (1 + pct) if opposite_side == 'sell' else average_price * (1 - pct)
                elif mode == 'absolute':
                    tp_price = val
                else:
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
                    
                    if exchange.has.get('createOrderWs'):
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
                                symbol, opposite_side, final_amount, params=ex_params
                            )
    
                    if tp_res:
                        tp_order_id = tp_res.get('id')

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
                
                atr_period = int(sl_config.get('atr_period', 10))
                atr_multiplier = float(sl_config.get('atr_multiplier', 2.0))
                atr_timeframe = sl_config.get('atr_timeframe', '15m')

                if sl_type == 'trailing':
                    placed_native = False
                    if is_futures and sl_mode == 'percentage':
                        # Try Native Trailing Stop Market for Futures
                        try:
                            logger.info(f"🚀 Bracket Monitor: Placing Native Trailing Stop for {symbol} (Futures)")
                            sl_params = {'reduceOnly': True, 'callbackRate': sl_val}
                            sl_res = None
                            is_ws_success = False
                            
                            if exchange.has.get('createOrderWs'):
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
                            BracketOrderService._software_trailing_stop_loop(exchange, symbol, opposite_side, final_amount, average_price, sl_mode, sl_val, is_futures, user_id, api_key_record, atr_period, atr_multiplier, atr_timeframe, tp_order_id)
                        )
                elif sl_type == 'smart_chase':
                    sl_price = average_price
                    if sl_mode == 'percentage':
                        pct = sl_val / 100.0
                        sl_price = average_price * (1 - pct) if opposite_side == 'sell' else average_price * (1 + pct)
                    elif sl_mode == 'absolute':
                        sl_price = sl_val
                    else:
                        sl_price = average_price - sl_val if opposite_side == 'sell' else average_price + sl_val

                    final_sl_price = (
                        float(exchange.price_to_precision(symbol, sl_price))
                        if hasattr(exchange, 'price_to_precision') else sl_price
                    )

                    max_dev = float(sl_config.get('smart_chase_deviation_pct') or 1.0)
                    chase_delay = int(sl_config.get('smart_chase_delay_ms') or 1500)
                    max_attempts = int(sl_config.get('smart_chase_max_attempts') or 15)
                    chase_mode = str(sl_config.get('smart_chase_mode') or 'dynamic_bbo').lower()
                    trigger_source = str(sl_config.get('smart_chase_trigger_source') or 'last').lower()

                    disaster_sl_order_id = None
                    if is_futures:
                        try:
                            disaster_price = final_sl_price * (1 - (max_dev / 100.0)) if opposite_side == 'sell' else final_sl_price * (1 + (max_dev / 100.0))
                            disaster_price_prec = (
                                float(exchange.price_to_precision(symbol, disaster_price))
                                if hasattr(exchange, 'price_to_precision') else disaster_price
                            )
                            disaster_params = {'reduceOnly': True, 'stopPrice': disaster_price_prec}
                            if getattr(api_key_record, 'exchange', '').lower().startswith('binance'):
                                for method_name in ['fapiPrivateGetPositionSideDual', 'fapiprivateGetPositionsideDual', 'fapiprivate_get_positionside_dual']:
                                    method = getattr(exchange, method_name, None)
                                    if method and callable(method):
                                        try:
                                             res = await method()
                                             if res.get('dualSidePosition', False):
                                                 disaster_params['positionSide'] = 'LONG' if opposite_side == 'sell' else 'SHORT'
                                             break
                                        except Exception:
                                             pass
                            d_res = await exchange.create_order(symbol, 'STOP_MARKET', opposite_side, final_amount, None, disaster_params)
                            disaster_sl_order_id = d_res.get('id')
                            logger.info(f"🛡️ Bracket Monitor: Native Disaster SL placed at {disaster_price_prec} (ID: {disaster_sl_order_id})")
                        except Exception as d_err:
                            logger.warning(f"⚠️ Failed to place native disaster SL: {d_err}")

                    logger.info(f"🚀 Bracket Monitor: Starting Smart Chase Limit SL for {symbol} | Trigger: {final_sl_price} | Mode: {chase_mode.upper()} | Source: {trigger_source.upper()}")
                    asyncio.create_task(
                        BracketOrderService._smart_chase_monitor_loop(
                            exchange=exchange,
                            symbol=symbol,
                            opposite_side=opposite_side,
                            amount=final_amount,
                            entry_price=average_price,
                            sl_price=final_sl_price,
                            max_deviation_pct=max_dev,
                            chase_delay_ms=chase_delay,
                            max_attempts=max_attempts,
                            is_futures=is_futures,
                            user_id=user_id,
                            api_key_record=api_key_record,
                            tp_order_id=tp_order_id,
                            disaster_sl_order_id=disaster_sl_order_id,
                            chase_mode=chase_mode,
                            trigger_source=trigger_source
                        )
                    )
                else:
                    sl_price = average_price
                    if sl_mode == 'percentage':
                        pct = sl_val / 100.0
                        sl_price = average_price * (1 - pct) if opposite_side == 'sell' else average_price * (1 + pct)
                    elif sl_mode == 'absolute':
                        sl_price = sl_val
                    else:
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
                        
                        if exchange.has.get('createOrderWs'):
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
        user_id: int, api_key_record,
        atr_period: int = 10, atr_multiplier: float = 2.0, atr_timeframe: str = '15m',
        tp_order_id: str = None
    ):
        highest_price = entry_price
        lowest_price = entry_price
        
        sl_id = str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'trailing',
            'mode': mode,
            'price': entry_price,
            'trigger_price': entry_price,
            'entry_price': entry_price,
            'val': val,
            'is_futures': is_futures,
            'exchange': exchange,
            'status': 'monitoring'
        }

        logger.info(f"🏁 Trailing SL loop started for {symbol} | Entry: {entry_price}")

        # ATR Calculation Setup
        last_atr_fetch_time = 0
        current_atr = 0.0
        current_price = entry_price  # Fix: Initialize current_price before loop
        sl_triggered = False
        
        ut_bot = None
        if mode == 'atr':
            from app.strategies.helpers.ut_bot_tracker import UTBotTracker
            # We assume use_heikin_ashi=False for now since manual trade doesn't specify
            ut_bot = UTBotTracker(exchange.id, symbol, sensitivity=atr_multiplier, atr_period=atr_period, use_heikin_ashi=False, timeframe=atr_timeframe)

        while True:
            await asyncio.sleep(2)  # poll interval
            # Check if monitor was cancelled by user
            sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if not sl_meta or sl_meta.get('cancelled'):
                logger.info(f"🛑 Trailing SL monitor cancelled by user for {symbol}.")
                if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                    del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
                return

            try:
                # Security Check: Ensure position is still open to prevent accidental reverse trades
                is_open = True
                try:
                    if tp_order_id:
                        try:
                            tp_chk = await exchange.fetch_order(tp_order_id, symbol)
                            if tp_chk.get('status', '').lower() in ['closed', 'filled']:
                                logger.info(f"🎯 TP order {tp_order_id} filled! Closing trailing stop monitor for {symbol}.")
                                is_open = False
                        except Exception:
                            pass

                    if is_open and is_futures:
                        try:
                            positions = await exchange.fetch_positions([symbol])
                            pos = None
                            for p in positions:
                                if p.get('symbol') == symbol:
                                    pos = p
                                    break
                            raw_contracts = float(pos.get('contracts', 0) or pos.get('info', {}).get('positionAmt', 0)) if pos else 0.0
                            if abs(raw_contracts) == 0:
                                is_open = False
                        except Exception as pos_e:
                            logger.debug(f"Could not check position for trailing SL (non-fatal): {pos_e}")
                except Exception as pos_e:
                    logger.debug(f"Position check non-fatal error: {pos_e}")
                
                if not is_open:
                    logger.info(f"🚫 Position closed externally. Canceling software trailing stop for {symbol}.")
                    break

                ticker = await exchange.fetch_ticker(symbol)
                current_price = ticker.get('last')
                if not current_price:
                    continue
                
                # Fetch ATR periodically if mode is ATR
                if mode == 'atr' and ut_bot:
                    import time
                    now = time.time()
                    # Refresh ATR every 10 seconds to closely track the indicator
                    if now - last_atr_fetch_time > 10:
                        try:
                            # Fetch 250 candles to get a stable RMA (TradingView default smoothing)
                            ohlcv = await exchange.fetch_ohlcv(symbol, timeframe=atr_timeframe, limit=250)
                            if ohlcv and len(ohlcv) > atr_period:
                                data = [{'time': o[0], 'open': o[1], 'high': o[2], 'low': o[3], 'close': o[4]} for o in ohlcv]
                                ut_bot._calculate_ut_bot(data)
                                current_atr = ut_bot.latest_trailing_stop
                                last_atr_fetch_time = now
                                logger.debug(f"Calculated UT Bot Trailing Stop for {symbol}: {current_atr}")
                        except Exception as atr_e:
                            logger.warning(f"Failed to fetch UT Bot Trailing Stop: {atr_e}")
                            
                    # If we don't have ATR yet, skip this tick
                    if current_atr <= 0:
                        continue
                        
                trigger_price = 0.0
                manual_override = sl_meta.get('manual_trigger_override')
                if opposite_side == 'sell': # We are Long, so we want to sell
                    highest_price = max(highest_price, current_price)
                    if mode == 'percentage':
                        new_trigger = highest_price * (1 - (val / 100.0))
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    elif mode == 'atr':
                        # current_atr is the exact UT Bot Trailing Stop Price
                        new_trigger = current_atr
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    else:
                        new_trigger = highest_price - val
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                        
                    if manual_override is not None:
                        trigger_price = max(trigger_price, float(manual_override))

                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['trigger_price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['price'] = trigger_price

                    if current_price <= trigger_price:
                        logger.info(f"💥 Trailing SL triggered for Long. High: {highest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        sl_triggered = True
                        break
                else: # We are Short, so we want to buy
                    lowest_price = min(lowest_price, current_price)
                    if mode == 'percentage':
                        new_trigger = lowest_price * (1 + (val / 100.0))
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    elif mode == 'atr':
                        # current_atr is the exact UT Bot Trailing Stop Price
                        new_trigger = current_atr
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    else:
                        new_trigger = lowest_price + val
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                        
                    if manual_override is not None:
                        trigger_price = min(trigger_price, float(manual_override)) if trigger_price > 0 else float(manual_override)

                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['trigger_price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['price'] = trigger_price

                    if current_price >= trigger_price:
                        logger.info(f"💥 Trailing SL triggered for Short. Low: {lowest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        sl_triggered = True
                        break

            except Exception as e:
                logger.debug(f"Trailing SL tick error: {e}")
                
        # Close the position!
        if not sl_triggered:
            return

        try:
            if tp_order_id:
                try:
                    await exchange.cancel_order(tp_order_id, symbol)
                    logger.info(f"Cancelled TP order {tp_order_id} before executing SL.")
                except Exception as c_e:
                    logger.debug(f"Failed to cancel TP order: {c_e}")

            final_amount = amount
            if not is_futures and opposite_side.lower() == 'sell':
                try:
                    base_currency = symbol.split('/')[0]
                    balance = await exchange.fetch_balance()
                    available = balance.get(base_currency, {}).get('free', 0.0)
                    if 0 < available < amount:
                        final_amount = float(exchange.amount_to_precision(symbol, available))
                        logger.info(f"Adjusted SL sell amount to available balance: {final_amount}")
                    elif available == 0:
                        logger.warning("No balance available to execute Trailing SL (maybe already closed by TP).")
                        return
                except Exception as bal_e:
                    logger.warning(f"Failed to fetch balance before SL: {bal_e}")

            params = {'reduceOnly': True} if is_futures else {}
            sl_res = None
            is_ws_success = False
            
            if exchange.has.get('createOrderWs'):
                try:
                    sl_res = await exchange.create_order_ws(
                        symbol, 'market', opposite_side, final_amount, None, params
                    )
                    is_ws_success = True
                except Exception as ws_e:
                    logger.warning(f"Trailing SL exit WS failed ({ws_e}). Fallback to REST.")
            
            if not is_ws_success:
                sl_res = await exchange.create_market_order(symbol, opposite_side, final_amount, params=params)

            logger.info(f"✅ Trailing SL Executed! ID: {sl_res.get('id')}")

            if user_id:
                try:
                    from app.db.session import SessionLocal
                    db = SessionLocal()
                    try:
                        mode_str = f"ATR (TF: {atr_timeframe}, Period: {atr_period}, Mult: {atr_multiplier})" if mode == 'atr' else f"{mode} ({val}{'%' if mode == 'percentage' else '$'})"
                        msg = (
                            f"🏃‍♂️💨 *Trailing SL Executed!*\n"
                            f"Exchange: {api_key_record.exchange.capitalize()}\n"
                            f"Pair: `{symbol}`\n"
                            f"Side: {opposite_side.upper()}\n"
                            f"Amount: `{amount}`\n"
                            f"Exit Price: ~{current_price}\n"
                            f"Mode: {mode_str}"
                        )
                        await NotificationService.send_message(db, user_id, msg)
                    finally:
                        db.close()
                except Exception as notify_err:
                    logger.warning(f"Trailing SL notification failed: {notify_err}")
        except Exception as e:
            logger.error(f"❌ Failed to execute Trailing SL: {e}")
        finally:
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

    @staticmethod
    async def _smart_chase_monitor_loop(
        exchange, symbol: str, opposite_side: str, amount: float,
        entry_price: float, sl_price: float, max_deviation_pct: float,
        chase_delay_ms: int, max_attempts: int, is_futures: bool,
        user_id: int, api_key_record,
        tp_order_id: str = None, disaster_sl_order_id: str = None,
        chase_mode: str = 'dynamic_bbo',
        trigger_source: str = 'last'
    ):
        sl_id = str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'smart_chase',
            'mode': 'SMART_CHASE',
            'chase_mode': chase_mode,
            'trigger_source': trigger_source,
            'price': sl_price,
            'trigger_price': sl_price,
            'entry_price': entry_price,
            'disaster_sl_order_id': disaster_sl_order_id,
            'is_futures': is_futures,
            'max_deviation_pct': max_deviation_pct,
            'exchange': exchange,
            'status': 'monitoring'
        }

        logger.info(f"🏁 Smart Chase Monitor started for {symbol} | Trigger: {sl_price} | Source: {trigger_source.upper()} | Entry: {entry_price}")
        sl_triggered = False
        loop_tick = 0

        while True:
            # Check if monitor was cancelled by user
            sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if not sl_meta or sl_meta.get('cancelled'):
                logger.info(f"🛑 Smart Chase monitor cancelled by user for {symbol}.")
                if disaster_sl_order_id:
                    try:
                        await exchange.cancel_order(disaster_sl_order_id, symbol)
                    except Exception:
                        pass
                if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                    del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
                return

            try:
                # ── PRIORITY 1: FETCH TICKER FIRST FOR ULTRA-FAST SL DETECTION ──
                ticker = await exchange.fetch_ticker(symbol)
                last_price = float(ticker.get('last') or 0.0)
                best_bid = float(ticker.get('bid') or last_price)
                best_ask = float(ticker.get('ask') or last_price)

                if trigger_source in ['bid_ask', 'bbo']:
                    # Long exit (sell): evaluate against Best Bid (the highest price buyers will pay right now)
                    # Short exit (buy): evaluate against Best Ask (the lowest price sellers will accept right now)
                    current_price = best_bid if opposite_side == 'sell' else best_ask
                    source_label = f"Best {'Bid' if opposite_side == 'sell' else 'Ask'} ({current_price})"
                else:
                    current_price = last_price
                    source_label = f"Last Price ({current_price})"

                # Dynamic trigger price (in case user dragged/edited on chart)
                current_sl_trigger = float(sl_meta.get('trigger_price') if sl_meta.get('trigger_price') is not None else sl_price)
                sl_price = current_sl_trigger

                if current_price > 0:
                    if opposite_side == 'sell': # Long position, sell when price drops to or below sl_price
                        if current_price <= current_sl_trigger:
                            logger.info(f"💥 Smart Chase SL Triggered for Long! {source_label} <= {current_sl_trigger} [Source: {trigger_source.upper()}]")
                            sl_triggered = True
                            break
                    else: # Short position, buy when price rises to or above sl_price
                        if current_price >= current_sl_trigger:
                            logger.info(f"💥 Smart Chase SL Triggered for Short! {source_label} >= {current_sl_trigger} [Source: {trigger_source.upper()}]")
                            sl_triggered = True
                            break

                # ── PRIORITY 2: PERIODIC POSITION / TP INTEGRITY CHECK (every 6 ticks ≈ 3s) ──
                # Throttling this background check avoids wasting 300ms on every tick while still safely detecting if TP filled
                loop_tick += 1
                if loop_tick % 6 == 0:
                    is_open = True
                    try:
                        # Check if TP already filled on exchange
                        if tp_order_id:
                            try:
                                tp_chk = await exchange.fetch_order(tp_order_id, symbol)
                                if tp_chk.get('status', '').lower() in ['closed', 'filled']:
                                    logger.info(f"🎯 TP order {tp_order_id} filled! Closing Smart Chase monitor for {symbol}.")
                                    is_open = False
                            except Exception:
                                pass

                        if is_open and is_futures:
                            try:
                                positions = await exchange.fetch_positions([symbol])
                                pos = None
                                for p in positions:
                                    if p.get('symbol') == symbol:
                                        pos = p
                                        break
                                raw_amt = float(pos.get('contracts', 0) or pos.get('info', {}).get('positionAmt', 0)) if pos else 0.0
                                if abs(raw_amt) == 0:
                                    is_open = False
                            except Exception as pos_e:
                                logger.debug(f"Position check non-fatal error: {pos_e}")
                    except Exception as pos_e:
                        logger.debug(f"Position check non-fatal error: {pos_e}")

                    if not is_open:
                        logger.info(f"🚫 Position closed externally. Canceling Smart Chase monitor for {symbol}.")
                        if disaster_sl_order_id:
                            try:
                                await exchange.cancel_order(disaster_sl_order_id, symbol)
                            except Exception:
                                pass
                        break

            except Exception as e:
                logger.debug(f"Smart Chase monitor tick error: {e}")

            # Ultra-responsive 500ms sleep (safe from Binance 1200 weight/min limit)
            await asyncio.sleep(0.5)

        # ── IMMEDIATELY REMOVE FROM ACTIVE_SOFTWARE_SL ──
        # Whether triggered or position closed, the trigger monitor is DONE.
        # Removing now ensures the chart clears the trigger line instantly!
        if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
            del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

        if not sl_triggered:
            return

        try:
            from app.services.manual_smart_chase_executor import execute_manual_smart_chase
            await execute_manual_smart_chase(
                exchange=exchange,
                symbol=symbol,
                exit_side=opposite_side,
                sell_amount_raw=amount,
                entry_price=entry_price,
                original_sl=sl_price,
                max_deviation_pct=max_deviation_pct,
                chase_delay_ms=chase_delay_ms,
                max_attempts=max_attempts,
                is_futures=is_futures,
                user_id=user_id,
                api_key_record=api_key_record,
                tp_order_id=tp_order_id,
                disaster_sl_order_id=disaster_sl_order_id,
                chase_id=sl_id,
                chase_mode=chase_mode,
                trigger_source=trigger_source
            )
        except Exception as exec_err:
            logger.error(f"❌ Error invoking execute_manual_smart_chase: {exec_err}")
        finally:
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

bracket_order_service = BracketOrderService()
