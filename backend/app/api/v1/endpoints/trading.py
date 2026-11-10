from fastapi import APIRouter, HTTPException, BackgroundTasks, Body, Depends, Query
from typing import Optional
from datetime import datetime  # BUG-01 fix: was missing, caused NameError in /sor/execute
import ccxt.async_support as ccxt
import logging
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app import models, crud
from app.api import deps
from app.core.security import decrypt_key

router = APIRouter()
logger = logging.getLogger(__name__)


class AttachedTPConfig(BaseModel):
    enabled: bool
    mode: str  # 'percentage' or 'price'
    value: float
    order_type: str  # 'Limit' or 'Market'
    timeout_mins: Optional[float] = 0  # Background threshold for limit order monitor (0 = infinite / until filled)

class AttachedSLConfig(BaseModel):
    enabled: bool
    type: Optional[str] = 'fixed' # 'fixed', 'trailing', 'smart_chase', or 'trailing_chase'
    mode: str  # 'percentage' or 'price' or 'absolute' or 'atr'
    value: float
    atr_period: Optional[int] = 10
    atr_multiplier: Optional[float] = 2.0
    atr_timeframe: Optional[str] = '15m'
    smart_chase_deviation_pct: Optional[float] = 1.0
    smart_chase_delay_ms: Optional[int] = 1500
    smart_chase_max_attempts: Optional[int] = 15
    smart_chase_mode: Optional[str] = 'dynamic_bbo'  # 'dynamic_bbo' or 'interval'
    smart_chase_trigger_source: Optional[str] = 'last'  # 'last' or 'bid_ask'
    smart_chase_peg_strategy: Optional[str] = 'bbo'  # 'bbo', 'inside_spread', or 'wall_aware'
    smart_chase_wall_multiplier: Optional[float] = 2.5  # Multiplier over avg depth volume
    auto_breakeven_enabled: Optional[bool] = False
    auto_breakeven_trigger_pct: Optional[float] = 1.0  # Trigger when profit reaches +X%
    auto_breakeven_buffer_pct: Optional[float] = 0.05  # Extra cushion to cover round-trip exchange fees
    timeout_mins: Optional[float] = 0

class OrderRequest(BaseModel):
    symbol: str
    side: str # 'buy' or 'sell'
    type: str # 'market' or 'limit'
    amount: float
    price: Optional[float] = None
    exchange_id: str = 'binance'
    api_key_id: Optional[int] = None
    params: Optional[dict] = {}
    client_timestamp: Optional[int] = None
    attached_tp: Optional[AttachedTPConfig] = None
    attached_sl: Optional[AttachedSLConfig] = None
    use_native_tp_sl: Optional[bool] = False
    iceberg_qty: Optional[float] = None
    enable_ml_filter: Optional[bool] = False
    ml_model_id: Optional[str] = None
    ml_execution_mode: Optional[str] = 'basic'
    ml_bullish_threshold: Optional[float] = 0.50
    ml_bearish_threshold: Optional[float] = 0.50

class ConnectionTestRequest(BaseModel):
    exchange_id: str
    api_key: str
    api_secret: str

class SORRequest(BaseModel):
    symbol: str
    amount: float
    side: str
    strategy: str # TWAP, VWAP
    duration_minutes: int
    exchange_id: str = "binance"
    params: Optional[dict] = {}

class StopSmartChaseRequest(BaseModel):
    api_key_id: Optional[int] = None
    symbol: str
    sl_id: Optional[str] = None

class CancelAllOrdersRequest(BaseModel):
    api_key_id: int
    symbol: str

class ClosePositionRequest(BaseModel):
    api_key_id: int
    symbol: str

class PlaceDragBracketRequest(BaseModel):
    api_key_id: int
    symbol: str
    bracket_type: str  # 'tp' or 'sl'
    price: float  # Absolute target price dropped on chart
    amount: Optional[float] = None
    is_futures: Optional[bool] = False
    side: Optional[str] = None  # Entry side: 'buy' (Long) or 'sell' (Short)
    tp_config: Optional[dict] = None
    sl_config: Optional[dict] = None
    target_order_id: Optional[str] = None

# --- Endpoints ---

@router.get("/news")
async def get_crypto_news():
    """Fetch latest crypto news"""
    from app.services.news_service import news_service 
    return await news_service.fetch_news()

@router.post("/test-connection")
async def test_exchange_connection(request: ConnectionTestRequest):
    """Test validity of API keys"""
    exchange_class = getattr(ccxt, request.exchange_id, None)
    if not exchange_class:
        raise HTTPException(status_code=400, detail="Unsupported exchange")
    
    try:
        exchange = exchange_class({
            'apiKey': request.api_key,
            'secret': request.api_secret,
            'enableRateLimit': True,
            'options': {
                'adjustForTimeDifference': True,
                'recvWindow': 60000 if request.exchange_id.lower() == 'mexc' else 10000
            }
        })
        
        # Try to fetch balance as a test
        await exchange.fetch_balance()
        await exchange.close()
        return {"status": "success", "message": "Connection Successful"}
        
    except Exception as e:
        if 'exchange' in locals():
            await exchange.close()
        raise HTTPException(status_code=400, detail=f"Connection Failed: {str(e)}")

@router.post("/order")
async def place_order(
    order: OrderRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Place a REAL order on the exchange"""
    try:
        import time
        start_time = time.perf_counter()
        
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.place_manual_trade(db, current_user.id, order, start_time)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.warning(f"⚠️ Order placement rejected: {e}")
        raise HTTPException(status_code=400, detail=f"Exchange Error: {str(e)}")


class MLFilterWarmupRequest(BaseModel):
    symbol: str
    ml_model_id: str


@router.post("/ml-filter-warmup")
async def warmup_ml_filter_endpoint(
    req: MLFilterWarmupRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(deps.get_current_user)
):
    """Pre-warms the ML model and live feature cache in RAM for 0ms manual trade execution."""
    from app.services.manual_trade_service import ManualTradeService
    background_tasks.add_task(ManualTradeService.warmup_ml_filter, req.symbol, req.ml_model_id)
    return {"status": "warming_up", "symbol": req.symbol, "ml_model_id": req.ml_model_id}

class EditOrderRequest(BaseModel):
    symbol: str
    side: str
    amount: float
    new_price: float

class UpdateSoftwareBracketRequest(BaseModel):
    symbol: str
    side: str
    new_price: float
    amount: Optional[float] = None

@router.put("/order/{api_key_id}/{order_id}")
async def edit_order(
    api_key_id: int,
    order_id: str,
    request: EditOrderRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Edit an existing open order (uses cancel + create internally) or active software SL bracket"""
    try:
        from app.services.bracket_order_service import BracketOrderService
        if order_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
            return await BracketOrderService.update_software_bracket(
                sl_id=order_id,
                new_price=request.new_price,
                api_key_id=api_key_id,
                user_id=current_user.id
            )
        
        from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
        if order_id in ACTIVE_SMART_CHASES:
            ACTIVE_SMART_CHASES[order_id]['original_sl'] = request.new_price
            ACTIVE_SMART_CHASES[order_id]['current_maker_price'] = request.new_price
            return {
                "id": order_id,
                "symbol": request.symbol,
                "price": request.new_price,
                "message": f"Active Smart Chase target updated to {request.new_price}"
            }

        from app.services.manual_trade_service import manual_trade_service
        edit_res = await manual_trade_service.edit_manual_trade(
            db=db,
            user_id=current_user.id,
            api_key_id=api_key_id,
            order_id=order_id,
            symbol=request.symbol,
            side=request.side,
            amount=request.amount,
            new_price=request.new_price
        )
        new_order_id = edit_res.get('id') if isinstance(edit_res, dict) else None
        if new_order_id and str(new_order_id) != str(order_id):
            clean_sym = str(request.symbol).split(':')[0].upper()
            for s_id, s_meta in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                s_sym = str(s_meta.get('symbol', '')).split(':')[0].upper()
                s_api = s_meta.get('api_key_id')
                if s_sym == clean_sym and (s_api is None or int(s_api) == int(api_key_id)):
                    if str(s_meta.get('tp_order_id')) == str(order_id):
                        s_meta['tp_order_id'] = str(new_order_id)
                        logger.info(f"🔄 Linked software bracket {s_id} TP order updated: {order_id} -> {new_order_id}")
        return edit_res
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.warning(f"⚠️ Order edit rejected: {e}")
        raise HTTPException(status_code=400, detail=f"Order Edit Failed: {str(e)}")

@router.put("/software-bracket/{api_key_id}/{sl_id}")
async def update_software_bracket_endpoint(
    api_key_id: int,
    sl_id: str,
    req: UpdateSoftwareBracketRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Update the trigger price of an active software SL (Smart Chase, Trailing, Fixed)"""
    try:
        from app.services.bracket_order_service import BracketOrderService
        if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
            return await BracketOrderService.update_software_bracket(
                sl_id=sl_id,
                new_price=req.new_price,
                api_key_id=api_key_id,
                user_id=current_user.id
            )
        
        from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
        if sl_id in ACTIVE_SMART_CHASES:
            ACTIVE_SMART_CHASES[sl_id]['original_sl'] = req.new_price
            ACTIVE_SMART_CHASES[sl_id]['current_maker_price'] = req.new_price
            return {
                "status": "success",
                "sl_id": sl_id,
                "new_price": req.new_price,
                "message": f"Active Smart Chase target updated to {req.new_price}"
            }

        # If it's a native exchange order (Fixed SL on exchange)
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.edit_manual_trade(
            db=db,
            user_id=current_user.id,
            api_key_id=api_key_id,
            order_id=sl_id,
            symbol=req.symbol,
            side=req.side,
            amount=req.amount or 0.0,
            new_price=req.new_price
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Software SL edit failed: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to update Stop-Loss: {str(e)}")

@router.post("/place-drag-bracket")
async def place_drag_bracket_endpoint(
    req: PlaceDragBracketRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Places an Attached Take Profit or Stop Loss for an active position/balance 
    via Drag & Drop on the chart. Uses user's configured settings from the modal.
    """
    try:
        from app.services.manual_trade_service import manual_trade_service
        from app.services.bracket_order_service import BracketOrderService
        import asyncio

        # 1. Fetch API Key record
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == req.api_key_id,
            models.ApiKey.user_id == current_user.id,
            models.ApiKey.is_enabled == True
        ).first()
        if not api_key_record:
            raise HTTPException(status_code=404, detail="Active API Key not found.")

        is_futures = bool(req.is_futures or (':' in req.symbol))
        exchange = await manual_trade_service._get_exchange(api_key_record, is_futures)

        # 2. Fetch current market price and format price
        final_price = BracketOrderService._safe_price_to_precision(exchange, req.symbol, req.price)
        if final_price <= 0:
            raise HTTPException(status_code=400, detail="Invalid price level.")

        current_px = 0.0
        try:
            ticker = await exchange.fetch_ticker(req.symbol)
            current_px = float(ticker.get('last') or ticker.get('close') or req.price)
        except Exception:
            current_px = req.price

        bracket_type = req.bracket_type.lower()
        amount = req.amount or 0.0
        entry_side = None

        # 3. Resolve entry side and amount based on market context and chart drop position
        if is_futures:
            pos_info = await manual_trade_service.get_active_position(db, current_user.id, req.api_key_id, req.symbol)
            pos_amt = float(pos_info.get('amount') or 0.0)
            if pos_amt > 0:
                if amount <= 0:
                    amount = pos_amt
                entry_side = 'buy' if str(pos_info.get('side', '')).lower() == 'long' else 'sell'
            else:
                if bracket_type == 'tp':
                    entry_side = 'buy' if final_price > current_px else 'sell'
                else:
                    entry_side = 'buy' if final_price < current_px else 'sell'
        else:
            # Spot balance check & intelligent chart drop direction inference
            bal = await manual_trade_service.get_fast_balance(db, current_user.id, req.api_key_id, req.symbol)
            base_free = float(bal.get('base_free') or 0.0)
            quote_free = float(bal.get('quote_free') or 0.0)

            # Chart drop position determines trade intent:
            # TP above market = Sell TP (Long) | TP below market = Buy TP (Dip Buy-Back)
            # SL below market = Sell SL (Long) | SL above market = Buy SL (Smart Chase Buy-Back)
            if bracket_type == 'tp':
                entry_side = 'buy' if final_price > current_px else 'sell'
            else:
                entry_side = 'buy' if final_price < current_px else 'sell'

            if amount <= 0:
                # Check if we are updating an existing active bracket or order
                if req.target_order_id and str(req.target_order_id) in BracketOrderService.ACTIVE_ENTRY_BRACKETS:
                    amount = float(BracketOrderService.ACTIVE_ENTRY_BRACKETS[str(req.target_order_id)].get('amount') or 0.0)
                if amount <= 0 and bracket_type == 'sl':
                    for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                        if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                            continue
                        if str(sdata.get('symbol', '')).strip().upper() == req.symbol.strip().upper():
                            if sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == req.api_key_id:
                                amount = float(sdata.get('amount') or 0.0)
                                if amount > 0:
                                    break
                if amount <= 0:
                    if entry_side == 'sell':
                        if quote_free > 0 and final_price > 0:
                            amount = quote_free / final_price
                        elif base_free > 0:
                            amount = base_free
                    else:
                        if base_free > 0:
                            amount = base_free
                        elif quote_free > 0 and final_price > 0:
                            amount = quote_free / final_price

        # 4. Format amount with exchange precision
        final_amount = BracketOrderService._safe_amount_to_precision(exchange, req.symbol, amount)
        if final_amount <= 0:
            raise HTTPException(
                status_code=400, 
                detail=f"No active position or balance found for {req.symbol} to place bracket. Please check your wallet balance or size."
            )

        # 5. Handle Bracket Placement / Update
        opposite_side = 'sell' if entry_side == 'buy' else 'buy'

        if bracket_type == 'sl':
            # Check if there is an existing active software SL to update directly
            target_sl_id = None
            for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                    continue
                key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == req.api_key_id)
                sym_match = (str(sdata.get('symbol', '')).strip().upper() == req.symbol.strip().upper())
                if key_match and sym_match:
                    if req.target_order_id:
                        if (
                            str(sdata.get('entry_order_id') or '') == str(req.target_order_id)
                            or str(sdata.get('tp_order_id') or '') == str(req.target_order_id)
                            or str(sid) == str(req.target_order_id)
                        ):
                            target_sl_id = sid
                            break
                    else:
                        target_sl_id = sid
                        break

            if target_sl_id:
                logger.info(f"🛡️ Updating existing active software SL {target_sl_id} to new price {final_price}")
                sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL[target_sl_id]
                sl_meta['trigger_price'] = final_price
                sl_meta['price'] = final_price
                sl_meta['manual_trigger_override'] = final_price
                if final_amount > 0:
                    sl_meta['amount'] = final_amount
                if req.sl_config:
                    if req.sl_config.get('type'):
                        sl_meta['type'] = req.sl_config.get('type')
                    if req.sl_config.get('mode'):
                        sl_meta['mode'] = str(req.sl_config.get('type') or sl_meta.get('mode')).upper()

                await BracketOrderService.update_software_bracket(
                    sl_id=target_sl_id,
                    new_price=final_price,
                    api_key_id=req.api_key_id,
                    user_id=current_user.id
                )

                manual_trade_service.invalidate_open_orders_cache(api_key_record.id, req.symbol)
                sl_mode_label = str(sl_meta.get('type', 'smart_chase')).replace('_', ' ').title()
                return {
                    "status": "success",
                    "bracket_type": "sl",
                    "price": final_price,
                    "amount": sl_meta.get('amount', final_amount),
                    "entry_side": entry_side,
                    "message": f"🛡️ {sl_mode_label} Stop-Loss updated to {final_price} for {sl_meta.get('amount', final_amount)} {req.symbol}"
                }
            else:
                # No active SL exists yet — spawn a new software SL without iceberg chunk addition
                sl_cfg = dict(req.sl_config or {})
                sl_cfg['enabled'] = True
                sl_cfg['mode'] = 'absolute'
                sl_cfg['value'] = final_price
                if 'type' not in sl_cfg:
                    sl_cfg['type'] = 'smart_chase'

                asyncio.create_task(
                    BracketOrderService._spawn_bracket_for_amount(
                        exchange=exchange,
                        symbol=req.symbol,
                        side=entry_side,
                        filled_amount=final_amount,
                        average_price=current_px,
                        is_futures=is_futures,
                        tp_config=None,
                        sl_config=sl_cfg,
                        user_id=current_user.id,
                        api_key_record=api_key_record,
                        entry_order_id=req.target_order_id,
                        is_consolidation_chunk=False
                    )
                )
                sl_mode_label = str(sl_cfg.get('type', 'smart_chase')).replace('_', ' ').title()
                msg = f"🛡️ {sl_mode_label} Stop-Loss placed at {final_price} for {final_amount} {req.symbol}"

        elif bracket_type == 'tp':
            # Clean up prior TP order on exchange before placing replacement
            try:
                for eb_id, eb_data in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
                    sym_match = (str(eb_data.get('symbol', '')).strip().upper() == req.symbol.strip().upper())
                    key_match = (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == req.api_key_id)
                    id_match = (not req.target_order_id or str(eb_id) == str(req.target_order_id))
                    if sym_match and key_match and id_match:
                        old_tp_id = eb_data.get('tp_order_id')
                        if old_tp_id:
                            logger.info(f"Cancelling prior bracket TP {old_tp_id} before setting new drag TP")
                            await BracketOrderService._cancel_futures_order_universal(exchange, old_tp_id, req.symbol) if is_futures else await exchange.cancel_order(old_tp_id, req.symbol)
                            eb_data['tp_order_id'] = None
                            await asyncio.sleep(0.15)
            except Exception as tp_c_err:
                logger.debug(f"Non-fatal prior TP cleanup notice: {tp_c_err}")

            try:
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                        continue
                    sym_match = (str(sdata.get('symbol', '')).strip().upper() == req.symbol.strip().upper())
                    key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == req.api_key_id)
                    id_match = (not req.target_order_id or str(sdata.get('entry_order_id') or '') == str(req.target_order_id) or str(sdata.get('tp_order_id') or '') == str(req.target_order_id))
                    if sym_match and key_match and id_match:
                        sl_old_tp = sdata.get('tp_order_id')
                        if sl_old_tp:
                            try:
                                logger.info(f"Cancelling SL-linked TP {sl_old_tp} before setting new drag TP")
                                await BracketOrderService._cancel_futures_order_universal(exchange, sl_old_tp, req.symbol) if is_futures else await exchange.cancel_order(sl_old_tp, req.symbol)
                                sdata['tp_order_id'] = None
                                await asyncio.sleep(0.15)
                            except Exception:
                                pass
            except Exception as sl_tp_err:
                logger.debug(f"Non-fatal SL-linked TP cleanup notice: {sl_tp_err}")

            tp_cfg = dict(req.tp_config or {})
            tp_cfg['enabled'] = True
            tp_cfg['mode'] = 'absolute'
            tp_cfg['value'] = final_price
            if 'orderType' in tp_cfg:
                tp_cfg['order_type'] = tp_cfg['orderType']
            if 'order_type' not in tp_cfg:
                tp_cfg['order_type'] = 'Limit'

            # Spawn TP via BracketOrderService without iceberg chunk addition
            asyncio.create_task(
                BracketOrderService._spawn_bracket_for_amount(
                    exchange=exchange,
                    symbol=req.symbol,
                    side=entry_side,
                    filled_amount=final_amount,
                    average_price=current_px,
                    is_futures=is_futures,
                    tp_config=tp_cfg,
                    sl_config=None,
                    user_id=current_user.id,
                    api_key_record=api_key_record,
                    entry_order_id=req.target_order_id,
                    is_consolidation_chunk=False
                )
            )
            msg = f"🎯 Take Profit placed at {final_price} for {final_amount} {req.symbol}"

        manual_trade_service.invalidate_open_orders_cache(api_key_record.id, req.symbol)

        return {
            "status": "success",
            "bracket_type": bracket_type,
            "price": final_price,
            "amount": final_amount,
            "entry_side": entry_side,
            "message": msg
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to place drag bracket: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to place {req.bracket_type.upper()}: {str(e)}")

@router.get("/api-key-balance/{api_key_id}")
async def get_api_key_balance(
    api_key_id: int,
    symbol: str,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Fetch free margin balance mapped to a specific API key & symbol"""
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.get_fast_balance(db, current_user.id, api_key_id, symbol)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Balance fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Balance Error: {str(e)}")

@router.get("/api-key-position/{api_key_id}")
async def get_api_key_position(
    api_key_id: int,
    symbol: str,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Fetch active position for a specific API key & symbol"""
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.get_active_position(db, current_user.id, api_key_id, symbol)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Position fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Position Error: {str(e)}")

@router.get("/open-limit-orders/{api_key_id}")
async def get_open_limit_orders(
    api_key_id: int,
    symbol: str,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Fetch all open limit orders for a specific API key and symbol — used for chart overlay."""
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.get_open_limit_orders(db, current_user.id, api_key_id, symbol)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Open orders fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Open Orders Error: {str(e)}")

@router.get("/active-software-brackets/{api_key_id}")
async def get_active_software_brackets(
    api_key_id: int,
    symbol: str,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Fetch all active software SL bracket orders and actively executing smart chases for a specific symbol."""
    try:
        from app.services.bracket_order_service import BracketOrderService
        from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES

        def _sym_matches(sym_a: str, sym_b: str) -> bool:
            sa = str(sym_a or '').strip()
            sb = str(sym_b or '').strip()
            if (':' in sa) != (':' in sb):
                return False
            return sa.split(':')[0].upper() == sb.split(':')[0].upper()
        
        active_brackets = []
        # 1. Monitoring brackets (waiting for trigger)
        for sl_id, data in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            key_match = (data.get('api_key_id') is None or int(data.get('api_key_id')) == int(api_key_id))
            sym_match = _sym_matches(data.get('symbol', ''), symbol)
            if key_match and sym_match and not data.get('cancelled'):
                price_val = float(data.get('trigger_price') if data.get('trigger_price') is not None else data.get('price', 0.0))
                active_brackets.append({
                    'id': str(sl_id),
                    'api_key_id': data.get('api_key_id'),
                    'symbol': data.get('symbol'),
                    'side': data.get('side'),
                    'amount': float(data.get('amount') or 0.0),
                    'type': data.get('type', 'smart_chase'),
                    'mode': data.get('mode', 'SMART_CHASE'),
                    'status': 'monitoring',
                    'price': price_val,
                    'trigger_price': price_val,
                    'entry_price': float(data.get('entry_price') or 0.0),
                    'is_futures': bool(data.get('is_futures', False)),
                    'chase_mode': data.get('chase_mode', 'dynamic_bbo'),
                    'trigger_source': data.get('trigger_source', 'last'),
                    'peg_strategy': data.get('peg_strategy', 'bbo'),
                    'wall_multiplier': float(data.get('wall_multiplier', 2.5)),
                    'auto_breakeven_enabled': bool(data.get('auto_breakeven_enabled', False)),
                    'breakeven_activated': bool(data.get('breakeven_activated', False)),
                    'max_deviation_pct': float(data.get('max_deviation_pct', 1.0)),
                    'current_attempt': data.get('current_attempt', 0),
                    'max_attempts': data.get('max_attempts', 0),
                    'tp_order_id': str(data.get('tp_order_id')) if data.get('tp_order_id') else None,
                    'entry_order_id': str(data.get('entry_order_id')) if data.get('entry_order_id') else None,
                })

        # 2. Actively executing Smart Chases (chasing maker fills)
        for chase_id, cdata in list(ACTIVE_SMART_CHASES.items()):
            key_match = (cdata.get('api_key_id') is None or int(cdata.get('api_key_id')) == int(api_key_id))
            sym_match = _sym_matches(cdata.get('symbol', ''), symbol)
            if key_match and sym_match:
                price_val = cdata.get('current_maker_price') or cdata.get('original_sl', 0.0)
                active_brackets.append({
                    'id': chase_id,
                    'api_key_id': cdata.get('api_key_id'),
                    'symbol': cdata.get('symbol'),
                    'side': cdata.get('side'),
                    'amount': cdata.get('amount'),
                    'type': 'smart_chase',
                    'mode': 'SMART_CHASE',
                    'status': 'chasing',
                    'chase_mode': cdata.get('chase_mode', 'dynamic_bbo'),
                    'trigger_source': cdata.get('trigger_source', 'last'),
                    'price': float(price_val),
                    'trigger_price': float(cdata.get('original_sl') or price_val),
                    'current_attempt': cdata.get('current_attempt', 0),
                    'max_attempts': cdata.get('max_attempts', 0),
                    'current_maker_price': cdata.get('current_maker_price', 0.0),
                    'peg_strategy': cdata.get('peg_strategy', 'bbo'),
                    'wall_multiplier': cdata.get('wall_multiplier', 2.5),
                    'started_at': cdata.get('started_at')
                })
                
        # 3. Actively executing Smart Peg Entries
        try:
            from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS
            for peg_id, pdata in list(ACTIVE_SMART_PEGS.items()):
                key_match = (pdata.get('api_key_id') is None or int(pdata.get('api_key_id')) == int(api_key_id))
                sym_match = _sym_matches(pdata.get('symbol', ''), symbol)
                if key_match and sym_match:
                    price_val = pdata.get('current_maker_price', 0.0)
                    active_brackets.append({
                        'id': peg_id,
                        'api_key_id': pdata.get('api_key_id'),
                        'symbol': pdata.get('symbol'),
                        'side': pdata.get('side'),
                        'amount': pdata.get('amount'),
                        'filled_amount': pdata.get('filled_amount', 0.0),
                        'type': 'smart_peg',
                        'mode': 'SMART_PEG',
                        'status': 'pegging',
                        'price': float(price_val),
                        'trigger_price': float(price_val),
                        'current_attempt': pdata.get('current_attempt', 0),
                        'max_attempts': pdata.get('max_attempts', 0),
                        'current_maker_price': pdata.get('current_maker_price', 0.0),
                        'started_at': pdata.get('started_at')
                    })
        except Exception as peg_e:
            logger.debug(f"Smart peg registry check: {peg_e}")

        return active_brackets
    except Exception as e:
        logger.error(f"Active software brackets fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Internal Error: {str(e)}")

@router.post("/stop-smart-chase")
async def stop_smart_chase_endpoint(
    req: StopSmartChaseRequest,
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Manually stop/cancel an active Smart Chase SL or Smart Peg Entry for a symbol.
    """
    try:
        from app.services.manual_smart_chase_executor import stop_smart_chase
        from app.services.smart_peg_entry_executor import stop_smart_peg
        from app.services.bracket_order_service import BracketOrderService
        
        stopped_chases = await stop_smart_chase(
            symbol=req.symbol,
            api_key_id=req.api_key_id,
            user_id=current_user.id,
            chase_id=req.sl_id
        )

        stopped_pegs = await stop_smart_peg(
            symbol=req.symbol,
            api_key_id=req.api_key_id,
            user_id=current_user.id,
            peg_id=req.sl_id
        )
        
        cancelled_monitors = 0
        for sl_id, data in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            key_match = (req.api_key_id is None or data.get('api_key_id') is None or int(data.get('api_key_id')) == int(req.api_key_id))
            sa = str(data.get('symbol', '')).strip()
            sb = str(req.symbol or '').strip()
            sym_match = ((':' in sa) == (':' in sb)) and (sa.split(':')[0].upper() == sb.split(':')[0].upper())
            id_match = (req.sl_id is None or sl_id == req.sl_id)
            if key_match and sym_match and id_match:
                data['cancelled'] = True
                cancelled_monitors += 1
                logger.info(f"🛑 Marked software SL {sl_id} for {req.symbol} as cancelled.")

        total_stopped = stopped_chases + stopped_pegs + cancelled_monitors
        if total_stopped > 0:
            return {
                "status": "success",
                "stopped_chases": stopped_chases,
                "stopped_pegs": stopped_pegs,
                "cancelled_monitors": cancelled_monitors,
                "message": f"Successfully stopped {stopped_chases} active chase(s), {stopped_pegs} entry peg(s), and cancelled {cancelled_monitors} pending monitor(s)."
            }
        else:
            return {
                "status": "not_found",
                "message": "No active Smart Chase SL or Smart Peg Entry found for this symbol/account."
            }
    except Exception as e:
        logger.error(f"Stop Smart Chase failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop Smart Chase: {str(e)}")

@router.post("/stop-smart-peg")
async def stop_smart_peg_endpoint(
    req: StopSmartChaseRequest,
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Manually stop/cancel an active Smart Peg Entry order for a symbol.
    """
    try:
        from app.services.smart_peg_entry_executor import stop_smart_peg
        stopped_pegs = await stop_smart_peg(
            symbol=req.symbol,
            api_key_id=req.api_key_id,
            user_id=current_user.id,
            peg_id=req.sl_id
        )
        if stopped_pegs > 0:
            return {
                "status": "success",
                "stopped_pegs": stopped_pegs,
                "message": f"Successfully stopped {stopped_pegs} active Smart Peg Entry task(s)."
            }
        else:
            return {
                "status": "not_found",
                "message": "No active Smart Peg Entry found for this symbol."
            }
    except Exception as e:
        logger.error(f"Stop Smart Peg failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop Smart Peg Entry: {str(e)}")

class EmergencyForceOrderRequest(BaseModel):
    api_key_id: int
    symbol: str
    side: str  # 'buy' or 'sell'
    execution_mode: str = 'limit_maker'  # 'limit_maker' or 'market'
    size_pct: Optional[float] = 100.0
    custom_amount: Optional[float] = None
    target_order_id: Optional[str] = None
    target_order_amount: Optional[float] = None
    target_order_mode: Optional[str] = None
    leverage: Optional[int] = None
    margin_mode: Optional[str] = None
    reduce_only: Optional[bool] = False
    attached_tp: Optional[AttachedTPConfig] = None
    attached_sl: Optional[AttachedSLConfig] = None
    enable_ml_filter: Optional[bool] = False
    ml_model_id: Optional[str] = None
    ml_execution_mode: Optional[str] = 'basic'
    ml_bullish_threshold: Optional[float] = 0.50
    ml_bearish_threshold: Optional[float] = 0.50

@router.post("/emergency-force-order")
async def emergency_force_order_endpoint(
    req: EmergencyForceOrderRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Emergency Force Sell / Buy at current price:
    Cancels either a specific selected order/bracket or all open orders/brackets on the symbol,
    unlocks balance, and executes via Dynamic Smart Peg Maker (0% fee) or Instant Market Price.
    """
    try:
        import time
        start_time = time.perf_counter()
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.execute_emergency_force_order(
            db=db,
            user_id=current_user.id,
            api_key_id=req.api_key_id,
            symbol=req.symbol,
            side=req.side,
            execution_mode=req.execution_mode,
            size_pct=req.size_pct if req.size_pct is not None else 100.0,
            custom_amount=req.custom_amount,
            target_order_id=req.target_order_id,
            target_order_amount=req.target_order_amount,
            target_order_mode=req.target_order_mode,
            leverage=req.leverage,
            margin_mode=req.margin_mode,
            reduce_only=bool(req.reduce_only),
            attached_tp=req.attached_tp,
            attached_sl=req.attached_sl,
            enable_ml_filter=bool(req.enable_ml_filter),
            ml_model_id=req.ml_model_id,
            ml_execution_mode=req.ml_execution_mode or 'basic',
            ml_bullish_threshold=req.ml_bullish_threshold if req.ml_bullish_threshold is not None else 0.50,
            ml_bearish_threshold=req.ml_bearish_threshold if req.ml_bearish_threshold is not None else 0.50,
            start_time=start_time
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Emergency Force Order failed: {e}")
        raise HTTPException(status_code=400, detail=f"Emergency Force Order Failed: {str(e)}")

@router.delete("/order/{api_key_id}/{order_id}")
async def cancel_order_endpoint(
    api_key_id: int,
    order_id: str,
    symbol: str = Query(..., description="Trading pair symbol e.g. BTC/USDT or DOGE/USDT:USDT"),
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Cancel a specific open limit order or software bracket for the symbol.
    """
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.cancel_manual_order(
            db=db,
            user_id=current_user.id,
            api_key_id=api_key_id,
            order_id=order_id,
            symbol=symbol
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Cancel order endpoint error: {e}")
        raise HTTPException(status_code=400, detail=f"Cancel Order Failed: {str(e)}")

@router.post("/cancel-all-orders")
async def cancel_all_orders_endpoint(
    req: CancelAllOrdersRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Cancel ALL open orders and active brackets for the specified symbol.
    """
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.cancel_all_manual_orders(
            db=db,
            user_id=current_user.id,
            api_key_id=req.api_key_id,
            symbol=req.symbol
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Cancel all orders endpoint error: {e}")
        raise HTTPException(status_code=400, detail=f"Cancel All Orders Failed: {str(e)}")

@router.post("/close-position")
async def close_position_endpoint(
    req: ClosePositionRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Immediately closes an open Futures position or Spot holding for the symbol at Market price.
    """
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.close_active_position(
            db=db,
            user_id=current_user.id,
            api_key_id=req.api_key_id,
            symbol=req.symbol
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Close position endpoint error: {e}")
        raise HTTPException(status_code=400, detail=f"Close Position Failed: {str(e)}")

@router.post("/sor/preview")
async def preview_sor_order(
    request: SORRequest,
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Preview the split of a Smart Order (SOR).
    Does NOT execute trades.
    """
    try:
        from app.services.sor_engine import SOREngine
        schedule = SOREngine.route_order(
            symbol=request.symbol,
            total_quantity=request.amount,
            strategy_type=request.strategy,
            duration_minutes=request.duration_minutes,
            params=request.params
        )
        return {"schedule": schedule}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/sor/execute")
async def execute_sor_order(
    request: SORRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Execute a Smart Order (SOR).
    Schedules child orders in the background.
    """
    # 1. Preview first to get the schedule
    try:
        from app.services.sor_engine import SOREngine
        from app.tasks import execute_sor_child_order
        
        schedule = SOREngine.route_order(
            symbol=request.symbol,
            total_quantity=request.amount,
            strategy_type=request.strategy,
            duration_minutes=request.duration_minutes,
            params=request.params
        )
        
        # 2. Schedule Tasks
        task_ids = []
        for child in schedule:
            # Calculate delay in seconds
            now = datetime.now()
            scheduled_time = child['scheduled_time']
            delay_seconds = (scheduled_time - now).total_seconds()
            
            if delay_seconds < 0: delay_seconds = 0
            
            # Queue Celery Task with Delay
            task = execute_sor_child_order.apply_async(
                args=[
                    current_user.id,
                    request.exchange_id,
                    request.symbol,
                    request.side,
                    child['quantity'],
                    None, # Price (MARKET for SOR usually)
                    'market' 
                ],
                countdown=delay_seconds
            )
            task_ids.append(task.id)
            
        return {
            "message": f"Successfully scheduled {len(task_ids)} child orders.",
            "strategy": request.strategy,
            "total_amount": request.amount,
            "task_ids": task_ids
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
