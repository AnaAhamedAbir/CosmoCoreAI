"""
Manual Trade Service
====================
ManualTradeModal এর জন্য ব্যাকএন্ড সার্ভিস।
Exchange Connection Pool ব্যবহার করে ultra-low latency order execution নিশ্চিত করে।
"""

import logging
import time
import asyncio
from sqlalchemy.orm import Session
from app import models
from app.core.security import decrypt_key
from app.services.exchange_pool import get_or_create_exchange
from app.services.notification import NotificationService
from app.services.bracket_order_service import bracket_order_service
from fastapi import HTTPException

logger = logging.getLogger(__name__)


class ManualTradeService:

    @staticmethod
    async def _get_exchange(api_key_record: models.ApiKey, is_futures: bool):
        """
        Exchange Pool থেকে একটি ready Exchange instance নিয়ে আসে।
        নতুন করে init করতে হয় না — cached থাকলে তাৎক্ষণিক রিটার্ন করে।
        """
        decrypted_secret = decrypt_key(api_key_record.secret_key)
        decrypted_api_key = decrypt_key(api_key_record.api_key)

        passphrase = None
        if hasattr(api_key_record, 'passphrase') and api_key_record.passphrase:
            try:
                passphrase = decrypt_key(api_key_record.passphrase)
            except Exception:
                passphrase = api_key_record.passphrase

        exchange = await get_or_create_exchange(
            api_key_id=api_key_record.id,
            exchange_name=api_key_record.exchange,
            decrypted_api_key=decrypted_api_key,
            decrypted_secret=decrypted_secret,
            is_futures=is_futures,
            passphrase=passphrase,
        )
        return exchange

    @staticmethod
    async def get_fast_balance(db: Session, user_id: int, api_key_id: int, symbol: str) -> dict:
        """
        Fetches the free balance for both the base and quote assets of the given symbol.
        Exchange Connection Pool ব্যবহার করে বলে প্রথমবারের পরে অনেক দ্রুত।
        """
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol
        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)
            
            parts = symbol.split('/')
            base_part = parts[0] if len(parts) > 1 else symbol
            quote_part = parts[1].split(':')[0] if len(parts) > 1 else "USDT"
            
            # Pass symbol constraints if the exchange supports lightweight fetching
            try:
                balance = await exchange.fetch_balance()
            except Exception:  # BUG-06 fix: was bare except, now catches only Exception subclasses
                balance = await exchange.fetch_balance()

            # Symbol থেকে base এবং quote বের করা
            # Futures: DOGE/USDT:USDT → base=DOGE, quote=USDT
            # Spot:    DOGE/FDUSD    → base=DOGE, quote=FDUSD
            parts = symbol.split('/')
            if len(parts) > 1:
                base_part = parts[0]
                quote_part = parts[1].split(':')[0]
            else:
                base_part = symbol
                quote_part = "USDT"

            base_free = balance.get(base_part, {}).get('free') or 0.0
            quote_free = balance.get(quote_part, {}).get('free') or 0.0

            return {
                "base": base_part,
                "base_free": float(base_free),
                "quote": quote_part,
                "quote_free": float(quote_free),
                "is_futures": is_futures
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Fast balance fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Balance Error: {str(e)}")

    @staticmethod
    async def get_active_position(db: Session, user_id: int, api_key_id: int, symbol: str) -> dict:
        """
        Fetches the current open position for the requested symbol.
        Used for calculating 'Reduce Only' percentages reliably.
        """
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol
        if not is_futures:
             # Spot markets don't have "positions", just balances.
             return {"amount": 0.0, "side": "none"}
            
        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)
            
            # Use fetch_positions for the specific symbol
            # CCXT usually returns a list of positions for the symbol (or all if omitted).
            positions = await exchange.fetch_positions([symbol])
            
            # Find the active position for this symbol
            active_pos = None
            for p in positions:
                 if p.get('symbol') == symbol and float(p.get('contracts', 0) or p.get('info', {}).get('positionAmt', 0)) != 0:
                     active_pos = p
                     break
            
            if not active_pos:
                 return {"amount": 0.0, "side": "none"}
                 
            # Extract position data consistently across exchanges
            # Binance uses 'positionAmt', CCXT standard uses 'contracts' and 'side' ('long' or 'short')
            raw_amt = float(active_pos.get('contracts') or 0.0)
            if raw_amt == 0:
                 # Fallback for Binance/MEXC if contracts is missing
                 raw_amt = abs(float(active_pos.get('info', {}).get('positionAmt') or 0.0))
            
            side = active_pos.get('side', 'none').lower()
            if side == 'none':
                 # Infer from positionAmt sign if available
                 pos_amt = float(active_pos.get('info', {}).get('positionAmt') or 0.0)
                 if pos_amt > 0: side = 'long'
                 elif pos_amt < 0: side = 'short'
            
            return {
                 "amount": float(raw_amt),
                 "side": side
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Fast position fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Position Error: {str(e)}")

    @staticmethod
    async def get_open_limit_orders(db: Session, user_id: int, api_key_id: int, symbol: str) -> dict:
        """
        ওই exchange এর চলমান Open Limit Orders ফেচ করে chart overlay এর জন্য।
        শুধুমাত্র 'open' status এবং 'limit' type এর orders return করে।
        """
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)
            raw_orders = await exchange.fetch_open_orders(symbol)

            orders = []
            for o in raw_orders:
                if o.get('type', '').lower() == 'limit' and o.get('status', '').lower() == 'open':
                    orders.append({
                        'id': o.get('id'),
                        'side': o.get('side', '').lower(),  # 'buy' or 'sell'
                        'price': float(o.get('price') or 0.0),
                        'amount': float(o.get('amount') or 0.0),
                        'filled': float(o.get('filled') or 0.0),
                        'remaining': float(o.get('remaining') or 0.0),
                    })

            return {"orders": orders, "symbol": symbol, "exchange": api_key_record.exchange}

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Open limit orders fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Open Orders Error: {str(e)}")

    @staticmethod
    async def place_manual_trade(db: Session, user_id: int, order_req, start_time: float = 0.0) -> dict:
        """
        Exchange Connection Pool ব্যবহার করে ultra-fast order execution।
        প্রথম অর্ডারের পরে পরবর্তী সব অর্ডার ~100-200ms এ সম্পন্ন হয়।
        """
        # নির্দিষ্ট API Key খুঁজে বের করা
        query = db.query(models.ApiKey).filter(
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        )

        if getattr(order_req, 'api_key_id', None):
            query = query.filter(models.ApiKey.id == order_req.api_key_id)
        else:
            query = query.filter(models.ApiKey.exchange == order_req.exchange_id)

        api_key_record = query.first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="Applicable active API Key not found.")

        is_futures = ':' in order_req.symbol

        try:
            # Pool থেকে Exchange নেওয়া — প্রথমবার ~800ms, পরে ~5ms
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)

            # Leverage and Margin Mode (Futures)
            params = getattr(order_req, 'params', {}) or {}
            ex_params = {} # arguments passed to create_order

            if is_futures:
                leverage = params.get('leverage')
                margin_mode = params.get('marginMode')
                reduce_only = params.get('reduceOnly', False)
                
                if reduce_only:
                    ex_params['reduceOnly'] = True

                if margin_mode:
                    try:
                        await exchange.set_margin_mode(margin_mode, order_req.symbol)
                    except Exception as mm_e:
                        logger.warning(f"Margin mode set skipped (may already be set or unsupported): {mm_e}")

                if leverage:
                    try:
                        await exchange.set_leverage(leverage, order_req.symbol)
                    except Exception as lev_e:
                        logger.warning(f"Leverage set skipped (may already be set): {lev_e}")

            # --- Pre-flight Margin Check ---
            try:
                bal = await exchange.fetch_balance()
                parts = order_req.symbol.split('/')
                base_part = parts[0] if len(parts) > 1 else order_req.symbol
                quote_part = parts[1].split(':')[0] if len(parts) > 1 else "USDT"

                req_amount = order_req.amount
                req_price = getattr(order_req, 'price', 0)
                if not req_price or req_price <= 0:
                     ticker = await exchange.fetch_ticker(order_req.symbol)
                     req_price = ticker.get('last', 0)

                if req_price and req_price > 0:
                    notional_value = req_amount * req_price
                    required_margin = notional_value
                    
                    if is_futures:
                         lev = params.get('leverage') or 1
                         required_margin = notional_value / float(lev)
                    
                    if order_req.side.lower() == 'buy' or is_futures:
                         free_quote = float(bal.get(quote_part, {}).get('free', 0.0))
                         if required_margin > free_quote and not params.get('reduceOnly'):
                              if required_margin <= (free_quote * 1.05): # If they hit 100% button
                                   logger.info(f"🛠️ Pre-flight Margin: Auto-adjusting size (Req: {required_margin}, Free: {free_quote})")
                                   order_req.amount = order_req.amount * (free_quote / required_margin) * 0.99
                    elif order_req.side.lower() == 'sell' and not is_futures: # Spot Sell
                         free_base = float(bal.get(base_part, {}).get('free', 0.0))
                         if req_amount > free_base:
                              if req_amount <= (free_base * 1.05):
                                   order_req.amount = free_base * 0.999 # Leave dust for fees
            except Exception as margin_e:
                logger.debug(f"Pre-flight margin check skipped: {margin_e}")

            # Prepare Limit Order parameters if needed
            if order_req.type.lower() == 'limit':
                if params.get('autoBestLimit'):
                    try:
                        ob = await exchange.fetch_order_book(order_req.symbol, limit=5)
                        if order_req.side.lower() == 'buy':
                            if not ob.get('bids'): raise ValueError("No bids found in orderbook.")
                            order_req.price = ob['bids'][0][0]
                        else:
                            if not ob.get('asks'): raise ValueError("No asks found in orderbook.")
                            order_req.price = ob['asks'][0][0]
                        ex_params['postOnly'] = True
                    except Exception as e:
                        logger.error(f"Failed to auto-detect best limit price: {e}")
                        raise HTTPException(status_code=500, detail=f"Failed to auto-fetch best limit price: {e}")

                time_in_force = params.get('timeInForce', '')
                if time_in_force.lower() in ('postonly', 'post_only', 'post-only'):
                    ex_params['postOnly'] = True
                    logger.info(f"PostOnly flag set for {order_req.symbol} {order_req.side} limit order")

                if not getattr(order_req, 'price', None) or order_req.price <= 0:
                    raise HTTPException(status_code=400, detail="Price is required for limit orders")

            # Execute Trade (Try WebSocket First, Fallback to REST)
            response = None
            is_ws_success = False

            if hasattr(exchange, 'create_order_ws'):
                try:
                    logger.info(f"⚡ Attempting WebSocket order execution for {order_req.symbol}...")
                    order_type = order_req.type.lower()
                    price = order_req.price if order_type == 'limit' else None
                    response = await exchange.create_order_ws(
                        order_req.symbol, order_type, order_req.side, order_req.amount, price, ex_params
                    )
                    is_ws_success = True
                    logger.info("✅ WebSocket Order execution successful!")
                except Exception as ws_e:
                    logger.warning(f"⚠️ WebSocket Order Failed ({ws_e}). Falling back to REST API.")

            if not is_ws_success:
                logger.info(f"🌐 Using REST API order execution for {order_req.symbol}...")
                if order_req.type.lower() == 'market':
                    response = await exchange.create_market_order(
                        order_req.symbol, order_req.side, order_req.amount, ex_params
                    )
                elif order_req.type.lower() == 'limit':
                    response = await exchange.create_limit_order(
                        order_req.symbol, order_req.side, order_req.amount, order_req.price, ex_params
                    )
                else:
                    raise HTTPException(status_code=400, detail="Invalid order type. Use 'market' or 'limit'.")

            # Calculate Latency (using backend perf_counter to eliminate PC-Server clock drift)
            latency_ms = 0
            if start_time:
                latency_ms = int((time.perf_counter() - start_time) * 1000)
            else:
                # Fallback if somehow not set, just assume 0 or fast
                latency_ms = 0
            
            latency_msg = f"⏱ Execution Time: {latency_ms} ms ⚡\n"
            
            # Send Telegram Notification
            try:
                msg = (
                    f"🎯 *Manual Trade Executed!*\n"
                    f"Exchange: {api_key_record.exchange.capitalize()}\n"
                    f"Pair: {order_req.symbol}\n"
                    f"Side: {order_req.side.upper()}\n"
                    f"Amount: {order_req.amount}\n"
                    f"{latency_msg}"
                )
                asyncio.create_task(NotificationService.send_message(db, user_id, msg))
            except Exception as notify_err:
                logger.warning(f"Failed to trigger telegram notification: {notify_err}")

            # [Bracket Order Link] — spawned as a background asyncio task, non-blocking
            has_tp = getattr(order_req, 'attached_tp', None) and order_req.attached_tp.enabled
            has_sl = getattr(order_req, 'attached_sl', None) and order_req.attached_sl.enabled

            if has_tp or has_sl:
                initial_price = response.get('price') or response.get('average') or getattr(order_req, 'price', 0.0)
                asyncio.create_task(
                    bracket_order_service.monitor_and_execute_bracket(
                        api_key_record=api_key_record,
                        entry_order_id=response.get('id'),
                        symbol=order_req.symbol,
                        side=order_req.side,
                        amount=order_req.amount,
                        is_futures=is_futures,
                        tp_config=order_req.attached_tp.dict() if has_tp else None,
                        sl_config=order_req.attached_sl.dict() if has_sl else None,
                        initial_entry_price=float(initial_price) if initial_price else 0.0,
                        user_id=user_id
                    )
                )

            return {
                "id": response.get('id'),
                "symbol": response.get('symbol'),
                "status": response.get('status', 'open'),
                "side": response.get('side'),
                "amount": response.get('amount'),
                "price": response.get('price') or response.get('average'),
                "message": "Order placed successfully"
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Order placement failed: {e}")
            raise HTTPException(status_code=500, detail=f"Exchange Error: {str(e)}")

    @staticmethod
    async def edit_manual_trade(db: Session, user_id: int, api_key_id: int, order_id: str, symbol: str, side: str, amount: float, new_price: float) -> dict:
        """
        Edits an open order by attempting to use native edit_order if supported, 
        or falling back to cancel + create to ensure compatibility (e.g., for MEXC).
        """
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)
            
            # Fetch original order to preserve its type and parameters
            original_order = None
            try:
                original_order = await exchange.fetch_order(order_id, symbol)
            except Exception as e:
                logger.warning(f"Could not fetch original order {order_id} during edit: {e}")
            
            # Use cancel + create pattern as it is more universally supported across exchanges than native editOrder
            # 1. Cancel existing order
            try:
                if hasattr(exchange, 'cancel_order_ws'):
                    await exchange.cancel_order_ws(id=order_id, symbol=symbol)
                else:
                    await exchange.cancel_order(id=order_id, symbol=symbol)
            except Exception as cancel_e:
                logger.warning(f"Error canceling order {order_id} during edit: {cancel_e}")
            
            # Small buffer to ensure exchange processes the cancel before replacing, preventing margin errors
            await asyncio.sleep(0.1)

            # 2. Re-create Order at new_price
            response = None
            is_ws_success = False
            ex_params = {}
            order_type = 'limit'
            price_arg = new_price

            if original_order:
                orig_type = original_order.get('type', 'limit').lower()
                order_type = orig_type
                
                # If it's a stop order, the new price is the trigger price
                if 'stop' in orig_type or 'take_profit' in orig_type:
                    ex_params['stopPrice'] = new_price
                    price_arg = None # Market stops have no execution price
                    
                    if orig_type in ('stop_limit', 'take_profit_limit'):
                        # If it was a stop limit, we need both trigger and exec price. 
                        # We'll just shift the limit price by the same delta if possible.
                        orig_trigger = original_order.get('stopPrice') or original_order.get('triggerPrice') or new_price
                        orig_limit = original_order.get('price') or orig_trigger
                        delta = new_price - orig_trigger
                        price_arg = orig_limit + delta
                
                if original_order.get('postOnly'):
                    ex_params['postOnly'] = True
                if original_order.get('reduceOnly'):
                    ex_params['reduceOnly'] = True
            else:
                # Fallback if fetch failed
                ex_params['postOnly'] = True

            if hasattr(exchange, 'create_order_ws'):
                try:
                    logger.info(f"⚡ Attempting WebSocket order edit (create) for {symbol} ({order_type})...")
                    response = await exchange.create_order_ws(
                        symbol, order_type, side, amount, price_arg, ex_params
                    )
                    is_ws_success = True
                except Exception as ws_e:
                    logger.warning(f"⚠️ WebSocket Order Edit Failed ({ws_e}). Falling back to REST API.")
            
            if not is_ws_success:
                response = await exchange.create_order(
                    symbol, order_type, side, amount, price_arg, ex_params
                )
            
            # Send Notification
            try:
                msg = (
                    f"🔄 *Order Modified!*\n"
                    f"Exchange: {api_key_record.exchange.capitalize()}\n"
                    f"Pair: {symbol}\n"
                    f"Side: {side.upper()}\n"
                    f"Amount: {amount}\n"
                    f"New Price: {new_price}"
                )
                asyncio.create_task(NotificationService.send_message(db, user_id, msg))
            except Exception as notify_err:
                logger.warning(f"Failed to trigger telegram notification on edit: {notify_err}")

            return {
                "id": response.get('id'),
                "symbol": response.get('symbol'),
                "status": response.get('status', 'open'),
                "side": response.get('side'),
                "amount": response.get('amount'),
                "price": response.get('price') or new_price,
                "message": "Order edited successfully"
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Order edit failed: {e}")
            raise HTTPException(status_code=500, detail=f"Order Edit Failed: {str(e)}")

manual_trade_service = ManualTradeService()
