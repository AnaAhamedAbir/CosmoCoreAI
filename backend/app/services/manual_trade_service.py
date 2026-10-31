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
from app.db.session import SessionLocal
from fastapi import HTTPException
import ccxt.async_support as ccxt

logger = logging.getLogger(__name__)


async def _send_trade_fired_notification(
    user_id: int,
    exchange_name: str,
    symbol: str,
    side: str,
    order_type: str,
    amount: float,
    fill_price: float = 0.0,
    latency_ms: int = 0,
    attached_tp = None,
    attached_sl = None,
    leverage: int = None,
    margin_mode: str = None,
    is_futures: bool = False,
    max_dev: float = None
):
    """Sends formatted Trade Fired alert to Telegram using its own dedicated DB session."""
    db = SessionLocal()
    try:
        side_upper = side.upper()
        side_icon = "🟢" if side_upper in ("BUY", "LONG") else "🔴"
        order_type_upper = order_type.upper()

        notional_str = ""
        if fill_price and fill_price > 0 and amount:
            notional = float(amount) * float(fill_price)
            notional_str = f" (~${notional:,.2f})"

        if is_futures:
            action_text = f"{side_upper} / {'LONG' if side_upper == 'BUY' else 'SHORT'} {side_icon}"
        else:
            action_text = f"{side_upper} {side_icon}"

        lev_text = ""
        if is_futures and leverage:
            lev_text = f"• Leverage: `{leverage}x` ({margin_mode.capitalize() if margin_mode else 'Isolated'})\n"

        if order_type_upper == 'MARKET':
            header = "🚀 *MANUAL TRADE FIRED (MARKET)*"
            price_line = f"• Entry Price: `${fill_price:,.4f}`\n" if fill_price else "• Entry Price: `Market Price`\n"
        elif order_type_upper in ('SMART_PEG', 'SMARTPEG'):
            header = "⚡ *MANUAL SMART PEG ENTRY INITIATED*"
            bench_line = f"• Benchmark Price: `${fill_price:,.4f}`\n" if fill_price else ""
            dev_line = f"• Max Drift: `±{max_dev}%`\n" if max_dev else ""
            price_line = f"{bench_line}{dev_line}• Order Type: `Dynamic BBO Peg`\n"
        else:
            header = "📝 *MANUAL LIMIT ORDER PLACED*"
            price_line = f"• Limit Price: `${fill_price:,.4f}`\n• Status: `Pending in Orderbook ⏳`\n" if fill_price else "• Status: `Pending in Orderbook ⏳`\n"

        tp_text = ""
        if attached_tp and getattr(attached_tp, 'enabled', False):
            val = getattr(attached_tp, 'value', '')
            mode = getattr(attached_tp, 'mode', '')
            unit = "%" if mode == "percentage" else "$"
            tp_text = f"🎯 Attached TP: `{val}{unit}`\n"

        sl_text = ""
        if attached_sl and getattr(attached_sl, 'enabled', False):
            val = getattr(attached_sl, 'value', '')
            sl_type = getattr(attached_sl, 'type', 'fixed')
            mode = getattr(attached_sl, 'mode', '')
            unit = "%" if mode == "percentage" else "$"
            sl_text = f"🛡️ Attached SL: `{val}{unit}` ({sl_type.replace('_', ' ').capitalize()})\n"

        speed_text = f"⏱ Execution Speed: `{latency_ms} ms` ⚡\n" if latency_ms > 0 else ""

        msg = (
            f"{header}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"• Exchange: `{exchange_name.capitalize()}`\n"
            f"• Pair: `{symbol}`\n"
            f"• Action: *{action_text}*\n"
            f"• Amount: `{amount}`{notional_str}\n"
            f"{price_line}"
            f"{lev_text}"
            f"{tp_text}"
            f"{sl_text}"
            f"{speed_text}"
        )
        await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
    except Exception as e:
        logger.warning(f"Failed to send trade fired notification: {e}")
    finally:
        db.close()


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

            base_info = balance.get(base_part, {}) if isinstance(balance.get(base_part), dict) else {}
            quote_info = balance.get(quote_part, {}) if isinstance(balance.get(quote_part), dict) else {}

            base_free = base_info.get('free') or (balance.get('free', {}).get(base_part) if isinstance(balance.get('free'), dict) else 0.0) or 0.0
            base_used = base_info.get('used') or (balance.get('used', {}).get(base_part) if isinstance(balance.get('used'), dict) else 0.0) or 0.0
            base_total = base_info.get('total') or (balance.get('total', {}).get(base_part) if isinstance(balance.get('total'), dict) else 0.0) or (float(base_free) + float(base_used))

            quote_free = quote_info.get('free') or (balance.get('free', {}).get(quote_part) if isinstance(balance.get('free'), dict) else 0.0) or 0.0
            quote_used = quote_info.get('used') or (balance.get('used', {}).get(quote_part) if isinstance(balance.get('used'), dict) else 0.0) or 0.0
            quote_total = quote_info.get('total') or (balance.get('total', {}).get(quote_part) if isinstance(balance.get('total'), dict) else 0.0) or (float(quote_free) + float(quote_used))

            return {
                "base": base_part,
                "base_free": float(base_free),
                "base_used": float(base_used),
                "base_total": float(base_total),
                "quote": quote_part,
                "quote_free": float(quote_free),
                "quote_used": float(quote_used),
                "quote_total": float(quote_total),
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

            # Exclude internal disaster SL orders that belong to active software Smart Chases
            # so the chart only displays the primary Smart Chase trigger line
            active_disaster_ids = set()
            try:
                from app.services.bracket_order_service import BracketOrderService
                for s_data in BracketOrderService.ACTIVE_SOFTWARE_SL.values():
                    d_id = s_data.get('disaster_sl_order_id')
                    if d_id:
                        active_disaster_ids.add(str(d_id))
                from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
                for c_data in ACTIVE_SMART_CHASES.values():
                    d_id = c_data.get('disaster_sl_order_id')
                    if d_id:
                        active_disaster_ids.add(str(d_id))
            except Exception as d_chk_err:
                logger.debug(f"Disaster ID exclusion check: {d_chk_err}")

            orders = []
            for o in raw_orders:
                status = o.get('status', '').lower()
                if status != 'open':
                    continue

                order_id_str = str(o.get('id'))
                if order_id_str in active_disaster_ids:
                    continue

                raw_type = o.get('type', '').lower()
                is_stop = 'stop' in raw_type or 'take_profit' in raw_type
                is_limit = 'limit' in raw_type or is_stop

                if not is_limit:
                    continue

                # Fetch price: stop orders may have 0 for price and the trigger in stopPrice/triggerPrice
                price = float(o.get('price') or 0.0)
                if price <= 0:
                    price = float(o.get('stopPrice') or o.get('triggerPrice') or 0.0)

                if price > 0:
                    raw_iceberg_qty = float(o.get('info', {}).get('icebergQty') or 0.0)
                    orders.append({
                        'id': str(o.get('id')),
                        'side': o.get('side', '').lower(),  # 'buy' or 'sell'
                        'price': price,
                        'amount': float(o.get('amount') or 0.0),
                        'filled': float(o.get('filled') or 0.0),
                        'remaining': float(o.get('remaining') or o.get('amount') or 0.0),
                        'isSoftwareSL': is_stop,
                        'mode': 'STOP' if is_stop else 'LIMIT',
                        'isIceberg': raw_iceberg_qty > 0,
                        'icebergQty': raw_iceberg_qty if raw_iceberg_qty > 0 else None
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

            # Prepare Limit Order parameters if needed (Moved before margin check)
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
                         if required_margin >= (free_quote * 0.99) and not params.get('reduceOnly'):
                              if required_margin <= (free_quote * 1.05): # If they hit 100% button
                                   logger.info(f"🛠️ Pre-flight Margin: Auto-adjusting size (Req: {required_margin}, Free: {free_quote})")
                                   order_req.amount = order_req.amount * (free_quote / required_margin) * 0.99
                    elif order_req.side.lower() == 'sell' and not is_futures: # Spot Sell
                         free_base = float(bal.get(base_part, {}).get('free', 0.0))
                         if req_amount >= (free_base * 0.99):
                              if req_amount <= (free_base * 1.05):
                                   order_req.amount = free_base * 0.999 # Leave dust for fees
            except Exception as margin_e:
                logger.debug(f"Pre-flight margin check skipped: {margin_e}")

            # --- SMART PEG ENTRY (DYNAMIC BBO ORDER BOOK SHADOWING) ---
            if order_req.type.lower() in ('smart_peg', 'smartpeg'):
                from app.services.smart_peg_entry_executor import execute_smart_peg_entry
                peg_cid = f"peg_{getattr(api_key_record, 'id', user_id)}_{order_req.symbol}_{int(time.time())}"

                max_dev = 2.0
                if isinstance(order_req.params, dict) and order_req.params.get('maxChaseDeviationPct') is not None:
                    max_dev = float(order_req.params.get('maxChaseDeviationPct'))

                is_reduce_only = bool(ex_params.get('reduceOnly', False))
                if isinstance(order_req.params, dict) and order_req.params.get('reduceOnly'):
                    is_reduce_only = True

                asyncio.create_task(
                    execute_smart_peg_entry(
                        exchange=exchange,
                        symbol=order_req.symbol,
                        side=order_req.side.lower(),
                        amount=order_req.amount,
                        is_futures=is_futures,
                        user_id=user_id,
                        api_key_record=api_key_record,
                        tp_config=order_req.attached_tp.dict() if (not is_reduce_only and getattr(order_req, 'attached_tp', None) and order_req.attached_tp.enabled) else None,
                        sl_config=order_req.attached_sl.dict() if (not is_reduce_only and getattr(order_req, 'attached_sl', None) and order_req.attached_sl.enabled) else None,
                        max_chase_deviation_pct=max_dev,
                        peg_id=peg_cid,
                        reduce_only=is_reduce_only
                    )
                )

                # Send Telegram Notification for Smart Peg Entry initiation
                asyncio.create_task(
                    _send_trade_fired_notification(
                        user_id=user_id,
                        exchange_name=api_key_record.exchange,
                        symbol=order_req.symbol,
                        side=order_req.side,
                        order_type='SmartPeg',
                        amount=order_req.amount,
                        fill_price=getattr(order_req, 'price', 0.0),
                        latency_ms=0,
                        attached_tp=order_req.attached_tp,
                        attached_sl=order_req.attached_sl,
                        leverage=params.get('leverage') if is_futures else None,
                        margin_mode=params.get('marginMode') if is_futures else None,
                        is_futures=is_futures,
                        max_dev=max_dev
                    )
                )

                return {
                    "id": peg_cid,
                    "symbol": order_req.symbol,
                    "status": "pegging",
                    "side": order_req.side.lower(),
                    "amount": order_req.amount,
                    "type": "smart_peg",
                    "message": f"⚡ Smart Peg Entry initiated for {order_req.symbol} ({order_req.side.upper()})"
                }

            # Execute Trade (Try WebSocket First, Fallback to REST)
            response = None
            is_ws_success = False

            # --- BINANCE SPOT NATIVE ICEBERG VALIDATION ---
            raw_iceberg = getattr(order_req, 'iceberg_qty', None)
            if not raw_iceberg and isinstance(order_req.params, dict):
                raw_iceberg = order_req.params.get('icebergQty') or order_req.params.get('iceberg_qty')

            valid_iceberg = None
            if raw_iceberg and not is_futures and order_req.type.lower() == 'limit':
                try:
                    f_iceberg = float(raw_iceberg)
                    if 0 < f_iceberg < float(order_req.amount):
                        valid_iceberg = float(exchange.amount_to_precision(order_req.symbol, f_iceberg))
                        logger.info(f"🧊 Native Iceberg detected: visible slice {valid_iceberg} of total {order_req.amount}")
                    else:
                        logger.warning(f"⚠️ Invalid iceberg_qty {f_iceberg} (must be > 0 and < {order_req.amount}). Ignoring.")
                except Exception as ice_err:
                    logger.warning(f"Failed to process iceberg_qty: {ice_err}")

            original_tp = order_req.attached_tp
            original_sl = order_req.attached_sl
            is_native_otoco_used = False

            # --- NATIVE BINANCE OTOCO SUPPORT ---
            use_native_otoco = getattr(order_req, 'use_native_tp_sl', False)
            if use_native_otoco and order_req.attached_sl and order_req.attached_sl.enabled:
                if (
                    order_req.attached_sl.type in ('trailing', 'smart_chase', 'trailing_chase')
                    or order_req.attached_sl.mode == 'atr'
                    or getattr(order_req.attached_sl, 'auto_breakeven_enabled', False)
                ):
                    use_native_otoco = False  # Disable native for trailing/ATR/smart_chase/trailing_chase/auto-breakeven SL
            if use_native_otoco and order_req.attached_tp and order_req.attached_tp.enabled:
                if getattr(order_req.attached_tp, 'order_type', 'Limit').lower() == 'market':
                    use_native_otoco = False  # Native Spot OTO/OTOCO only supports LIMIT_MAKER TP
            if use_native_otoco and not is_futures and exchange.id == 'binance' and order_req.type.lower() == 'limit' and (
                (order_req.attached_tp and order_req.attached_tp.enabled)
                or (order_req.attached_sl and order_req.attached_sl.enabled)
            ):
                logger.info(f"⚡ Using Binance Native Attached Orders (OTO/OTOCO) for {order_req.symbol}...")
                
                market = exchange.market(order_req.symbol)
                native_symbol = market['id']
                has_tp = bool(order_req.attached_tp and order_req.attached_tp.enabled)
                has_sl = bool(order_req.attached_sl and order_req.attached_sl.enabled)
                
                # Calculate absolute prices based on mode and value
                entry_price = order_req.price
                tp_price = 0.0
                sl_price = 0.0
                
                if has_tp:
                    mode = order_req.attached_tp.mode
                    val = order_req.attached_tp.value
                    if mode == 'percentage':
                        pct = val / 100.0
                        tp_price = entry_price * (1 + pct) if order_req.side.lower() == 'buy' else entry_price * (1 - pct)
                    elif mode == 'absolute':
                        tp_price = val
                    else:
                        tp_price = entry_price + val if order_req.side.lower() == 'buy' else entry_price - val
                    if tp_price <= 0:
                        raise HTTPException(status_code=400, detail=f"Invalid Take-Profit price ({tp_price:.6f}): must be > 0.")
                    if order_req.side.lower() == 'buy' and tp_price <= entry_price:
                        raise HTTPException(status_code=400, detail=f"For BUY order, TP price ({tp_price:.6f}) must be above entry price ({entry_price:.6f}).")
                    if order_req.side.lower() == 'sell' and tp_price >= entry_price:
                        raise HTTPException(status_code=400, detail=f"For SELL order, TP price ({tp_price:.6f}) must be below entry price ({entry_price:.6f}).")
                    if exchange.price_to_precision(order_req.symbol, tp_price) == exchange.price_to_precision(order_req.symbol, entry_price):
                        raise HTTPException(status_code=400, detail=f"TP gap ({val}) is smaller than 1 price tick for {order_req.symbol} at {entry_price}.")
                        
                if has_sl:
                    mode = order_req.attached_sl.mode
                    val = order_req.attached_sl.value
                    if mode == 'percentage':
                        pct = val / 100.0
                        sl_price = entry_price * (1 - pct) if order_req.side.lower() == 'buy' else entry_price * (1 + pct)
                    elif mode == 'absolute':
                        sl_price = val
                    else:
                        sl_price = entry_price - val if order_req.side.lower() == 'buy' else entry_price + val
                    if sl_price <= 0:
                        raise HTTPException(status_code=400, detail=f"Invalid Stop-Loss price ({sl_price:.6f}): must be > 0.")
                    if order_req.side.lower() == 'buy' and sl_price >= entry_price:
                        raise HTTPException(status_code=400, detail=f"For BUY order, SL price ({sl_price:.6f}) must be below entry price ({entry_price:.6f}).")
                    if order_req.side.lower() == 'sell' and sl_price <= entry_price:
                        raise HTTPException(status_code=400, detail=f"For SELL order, SL price ({sl_price:.6f}) must be above entry price ({entry_price:.6f}).")
                    if exchange.price_to_precision(order_req.symbol, sl_price) == exchange.price_to_precision(order_req.symbol, entry_price):
                        raise HTTPException(status_code=400, detail=f"SL gap ({val}) is smaller than 1 price tick for {order_req.symbol} at {entry_price}.")
                
                is_post_only = ex_params.get('postOnly', False)
                payload = {
                    "symbol": native_symbol,
                    "workingType": "LIMIT_MAKER" if is_post_only else "LIMIT",
                    "workingSide": order_req.side.upper(),
                    "workingPrice": exchange.price_to_precision(order_req.symbol, order_req.price),
                    "workingQuantity": exchange.amount_to_precision(order_req.symbol, order_req.amount),
                    "pendingSide": "SELL" if order_req.side.lower() == "buy" else "BUY",
                    "pendingQuantity": exchange.amount_to_precision(order_req.symbol, order_req.amount),
                }
                
                if not is_post_only:
                    payload["workingTimeInForce"] = "GTC"
                
                if valid_iceberg is not None:
                    payload["workingIcebergQty"] = exchange.amount_to_precision(order_req.symbol, valid_iceberg)
                    logger.info(f"🧊 Attaching workingIcebergQty={payload['workingIcebergQty']} to Native Binance OTO/OTOCO")
                
                try:
                    if has_tp and has_sl:
                        if order_req.side.lower() == 'buy':
                            payload['pendingAboveType'] = 'LIMIT_MAKER'
                            payload['pendingAbovePrice'] = exchange.price_to_precision(order_req.symbol, tp_price)
                            payload['pendingBelowType'] = 'STOP_LOSS_LIMIT'
                            payload['pendingBelowTimeInForce'] = 'GTC'
                            payload['pendingBelowStopPrice'] = exchange.price_to_precision(order_req.symbol, sl_price)
                            payload['pendingBelowPrice'] = exchange.price_to_precision(order_req.symbol, sl_price * 0.999)
                        else:
                            payload['pendingAboveType'] = 'STOP_LOSS_LIMIT'
                            payload['pendingAboveTimeInForce'] = 'GTC'
                            payload['pendingAboveStopPrice'] = exchange.price_to_precision(order_req.symbol, sl_price)
                            payload['pendingAbovePrice'] = exchange.price_to_precision(order_req.symbol, sl_price * 1.001)
                            payload['pendingBelowType'] = 'LIMIT_MAKER'
                            payload['pendingBelowPrice'] = exchange.price_to_precision(order_req.symbol, tp_price)
                        raw_res = await exchange.private_post_orderlist_otoco(payload)
                    else: # OTO
                        if order_req.side.lower() == 'buy':
                            if has_tp:
                                payload['pendingType'] = 'LIMIT_MAKER'
                                payload['pendingPrice'] = exchange.price_to_precision(order_req.symbol, tp_price)
                            elif has_sl:
                                payload['pendingType'] = 'STOP_LOSS_LIMIT'
                                payload['pendingTimeInForce'] = 'GTC'
                                payload['pendingStopPrice'] = exchange.price_to_precision(order_req.symbol, sl_price)
                                payload['pendingPrice'] = exchange.price_to_precision(order_req.symbol, sl_price * 0.999)
                        else:
                            if has_tp:
                                payload['pendingType'] = 'LIMIT_MAKER'
                                payload['pendingPrice'] = exchange.price_to_precision(order_req.symbol, tp_price)
                            elif has_sl:
                                payload['pendingType'] = 'STOP_LOSS_LIMIT'
                                payload['pendingTimeInForce'] = 'GTC'
                                payload['pendingStopPrice'] = exchange.price_to_precision(order_req.symbol, sl_price)
                                payload['pendingPrice'] = exchange.price_to_precision(order_req.symbol, sl_price * 1.001)
                        raw_res = await exchange.private_post_orderlist_oto(payload)

                    order_list = raw_res.get('orderReports', [])
                    working_order = next((o for o in order_list if o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
                    if not working_order and len(order_list) > 0:
                        working_order = order_list[0]
                    
                    response = {
                        'id': str(working_order.get('orderId')) if working_order else str(raw_res.get('orderListId', 'otoco')),
                        'symbol': order_req.symbol,
                        'type': 'limit',
                        'side': order_req.side.lower(),
                        'price': order_req.price,
                        'amount': order_req.amount,
                        'status': 'open',
                        'info': raw_res
                    }
                    is_ws_success = True
                    
                    # Prevent standard Bracket Monitor from duplicate handling
                    order_req.attached_tp = None
                    order_req.attached_sl = None
                    is_native_otoco_used = True
                    logger.info("✅ Native Binance OTO/OTOCO placed successfully.")

                    # Spawn dedicated monitor for Binance Native OTOCO to dispatch Telegram completion alerts
                    if user_id:
                        asyncio.create_task(
                            bracket_order_service.monitor_native_otoco(
                                exchange=exchange,
                                symbol=order_req.symbol,
                                side=order_req.side,
                                amount=order_req.amount,
                                entry_price=order_req.price,
                                raw_res=raw_res,
                                user_id=user_id
                            )
                        )
                except Exception as e:
                    logger.error(f"Native OTOCO failed: {e}")
                    raise HTTPException(status_code=400, detail=f"Native TP/SL Failed: {str(e)}")
            # ----------------------------------------

            # If not executed via OTOCO and iceberg is requested for spot limit order
            if not is_ws_success and valid_iceberg is not None:
                ex_params['icebergAmount'] = valid_iceberg
                ex_params['icebergQty'] = exchange.amount_to_precision(order_req.symbol, valid_iceberg)
                if 'timeInForce' not in ex_params and not ex_params.get('postOnly'):
                    ex_params['timeInForce'] = 'GTC'
                logger.info(f"🧊 Configured icebergQty={ex_params['icebergQty']} on Spot limit order")

            if not is_ws_success and exchange.has.get('createOrderWs'):
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
                        order_req.symbol, order_req.side, order_req.amount, params=ex_params
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
            
            # Send Rich Session-Safe Telegram Notification
            try:
                exec_price = 0.0
                if response:
                    exec_price = float(response.get('price') or response.get('average') or 0.0)
                if not exec_price:
                    exec_price = float(getattr(order_req, 'price', 0.0) or 0.0)

                asyncio.create_task(
                    _send_trade_fired_notification(
                        user_id=user_id,
                        exchange_name=api_key_record.exchange,
                        symbol=order_req.symbol,
                        side=order_req.side,
                        order_type=order_req.type,
                        amount=order_req.amount,
                        fill_price=exec_price,
                        latency_ms=latency_ms,
                        attached_tp=original_tp,
                        attached_sl=original_sl,
                        leverage=params.get('leverage') if is_futures else None,
                        margin_mode=params.get('marginMode') if is_futures else None,
                        is_futures=is_futures
                    )
                )
            except Exception as notify_err:
                logger.warning(f"Failed to trigger telegram notification: {notify_err}")

            # [Bracket Order Link] — spawned as a background asyncio task, non-blocking
            # Also monitors plain limit orders to ensure entry fill alert is delivered to Telegram
            has_tp = getattr(original_tp, 'enabled', False) if original_tp else False
            has_sl = getattr(original_sl, 'enabled', False) if original_sl else False
            is_limit_order = order_req.type.lower() == 'limit'

            if not is_native_otoco_used and (has_tp or has_sl or is_limit_order):
                initial_price = response.get('price') or response.get('average') or getattr(order_req, 'price', 0.0)
                asyncio.create_task(
                    bracket_order_service.monitor_and_execute_bracket(
                        api_key_record=api_key_record,
                        entry_order_id=response.get('id'),
                        symbol=order_req.symbol,
                        side=order_req.side,
                        amount=order_req.amount,
                        is_futures=is_futures,
                        tp_config=original_tp.dict() if has_tp else None,
                        sl_config=original_sl.dict() if has_sl else None,
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
            err_str = str(e)
            is_exchange_rejection = (
                isinstance(e, getattr(ccxt, 'BaseError', Exception)) or
                any(kw in err_str.lower() for kw in [
                    'immediately match', 'post-only', 'postonly', 'maker', '-5022',
                    'insufficient balance', 'insufficient margin', '-2010', 'account has insufficient',
                    'min_notional', 'filter failure', 'notional', '-1013',
                    'precision', 'lot_size', 'price filter', 'reduceonly',
                    'order does not exist', 'unknown order', 'exchange error'
                ])
            )
            if is_exchange_rejection:
                logger.warning(f"⚠️ Manual order rejected by exchange ({order_req.symbol}): {err_str}")
                raise HTTPException(status_code=400, detail=f"Exchange Error: {err_str}")
            
            import traceback
            logger.error(f"Internal order placement failure: {e}\n{traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {err_str}")

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
                if exchange.has.get('cancelOrderWs'):
                    try:
                        await exchange.cancel_order_ws(id=order_id, symbol=symbol)
                    except Exception as ws_e:
                        logger.warning(f"WebSocket cancel failed ({ws_e}), falling back to REST.")
                        await exchange.cancel_order(id=order_id, symbol=symbol)
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

            # Apply exchange precision to prevent precision filter rejections
            if hasattr(exchange, 'price_to_precision'):
                new_price = float(exchange.price_to_precision(symbol, new_price))
            if hasattr(exchange, 'amount_to_precision'):
                amount = float(exchange.amount_to_precision(symbol, amount))

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
                        # We'll shift the limit price by the same delta.
                        orig_trigger = float(original_order.get('stopPrice') or original_order.get('triggerPrice') or new_price)
                        orig_limit = float(original_order.get('price') or orig_trigger)
                        delta = new_price - orig_trigger
                        calc_price = orig_limit + delta
                        price_arg = float(exchange.price_to_precision(symbol, calc_price)) if hasattr(exchange, 'price_to_precision') else calc_price
                
                if original_order.get('postOnly'):
                    ex_params['postOnly'] = True
                if original_order.get('reduceOnly'):
                    ex_params['reduceOnly'] = True

                # Preserve positionSide for Binance futures hedge mode
                orig_pos_side = original_order.get('info', {}).get('positionSide')
                if orig_pos_side and is_futures:
                    ex_params['positionSide'] = orig_pos_side

                orig_iceberg = original_order.get('info', {}).get('icebergQty')
                if orig_iceberg and float(orig_iceberg) > 0:
                    ex_params['icebergAmount'] = float(orig_iceberg)
                    ex_params['icebergQty'] = orig_iceberg
                    if 'timeInForce' not in ex_params and not ex_params.get('postOnly'):
                        ex_params['timeInForce'] = 'GTC'
                    logger.info(f"🧊 Preserved Iceberg slice {orig_iceberg} during order edit")
            else:
                # Fallback if fetch failed
                ex_params['postOnly'] = True

            if exchange.has.get('createOrderWs'):
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
            err_str = str(e)
            is_exchange_rejection = (
                isinstance(e, getattr(ccxt, 'BaseError', Exception)) or
                any(kw in err_str.lower() for kw in [
                    'immediately match', 'post-only', 'postonly', 'maker', '-5022',
                    'insufficient balance', 'insufficient margin', '-2010', 'account has insufficient',
                    'min_notional', 'filter failure', 'notional', '-1013',
                    'precision', 'lot_size', 'price filter', 'reduceonly',
                    'order does not exist', 'unknown order', 'exchange error'
                ])
            )
            if is_exchange_rejection:
                logger.warning(f"⚠️ Order edit rejected by exchange ({symbol}): {err_str}")
                raise HTTPException(status_code=400, detail=f"Order Edit Failed: {err_str}")

            logger.error(f"Internal order edit error: {e}")
            raise HTTPException(status_code=500, detail=f"Order Edit Failed: {err_str}")

manual_trade_service = ManualTradeService()
