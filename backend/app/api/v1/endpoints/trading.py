from fastapi import APIRouter, HTTPException, BackgroundTasks, Body, Depends
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
    type: Optional[str] = 'fixed' # 'fixed', 'trailing', or 'smart_chase'
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
        logger.error(f"Order placement failed: {e}")
        raise HTTPException(status_code=500, detail=f"Exchange Error: {str(e)}")

class EditOrderRequest(BaseModel):
    symbol: str
    side: str
    amount: float
    new_price: float

@router.put("/order/{api_key_id}/{order_id}")
async def edit_order(
    api_key_id: int,
    order_id: str,
    request: EditOrderRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user)
):
    """Edit an existing open order (uses cancel + create internally)"""
    try:
        from app.services.manual_trade_service import manual_trade_service
        return await manual_trade_service.edit_manual_trade(
            db=db,
            user_id=current_user.id,
            api_key_id=api_key_id,
            order_id=order_id,
            symbol=request.symbol,
            side=request.side,
            amount=request.amount,
            new_price=request.new_price
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Order edit failed: {e}")
        raise HTTPException(status_code=500, detail=f"Exchange Error: {str(e)}")

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
        
        active_brackets = []
        # 1. Monitoring brackets (waiting for trigger)
        for sl_id, data in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            key_match = (data.get('api_key_id') is None or int(data.get('api_key_id')) == int(api_key_id))
            sym_match = str(data.get('symbol', '')).split(':')[0].upper() == str(symbol).split(':')[0].upper()
            if key_match and sym_match and not data.get('cancelled'):
                item = dict(data)
                item['status'] = item.get('status', 'monitoring')
                price_val = item.get('trigger_price') if item.get('trigger_price') is not None else item.get('price', 0.0)
                item['price'] = float(price_val)
                item['trigger_price'] = float(price_val)
                item['chase_mode'] = data.get('chase_mode', 'dynamic_bbo')
                item['trigger_source'] = data.get('trigger_source', 'last')
                active_brackets.append(item)

        # 2. Actively executing Smart Chases (chasing maker fills)
        for chase_id, cdata in list(ACTIVE_SMART_CHASES.items()):
            key_match = (cdata.get('api_key_id') is None or int(cdata.get('api_key_id')) == int(api_key_id))
            sym_match = str(cdata.get('symbol', '')).split(':')[0].upper() == str(symbol).split(':')[0].upper()
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
                    'started_at': cdata.get('started_at')
                })
                
        # 3. Actively executing Smart Peg Entries
        try:
            from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS
            for peg_id, pdata in list(ACTIVE_SMART_PEGS.items()):
                key_match = (pdata.get('api_key_id') is None or int(pdata.get('api_key_id')) == int(api_key_id))
                sym_match = str(pdata.get('symbol', '')).split(':')[0].upper() == str(symbol).split(':')[0].upper()
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
            sym_match = str(data.get('symbol', '')).split(':')[0].upper() == str(req.symbol).split(':')[0].upper()
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
