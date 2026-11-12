from fastapi import APIRouter, HTTPException, BackgroundTasks, Body, Depends, Query
from typing import Optional
from datetime import datetime  # BUG-01 fix: was missing, caused NameError in /sor/execute
import time
import asyncio
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
    smart_chase_max_attempts: Optional[int] = 10000
    smart_chase_mode: Optional[str] = 'dynamic_bbo'  # 'dynamic_bbo' or 'interval'
    smart_chase_trigger_source: Optional[str] = 'bid_ask'  # 'last' or 'bid_ask'
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

def _update_smart_chase_target(chase_meta: dict, new_price: float, fallback_side: str = ""):
    """Update an active Smart Chase target price and recompute its circuit breaker limit."""
    chase_meta['original_sl'] = new_price
    chase_meta['current_maker_price'] = new_price
    chase_meta['target_updated'] = True
    max_dev = chase_meta.get('max_deviation_pct')
    if max_dev is not None:
        max_dev_f = float(max_dev)
        new_px_f = float(new_price)
        chase_side = str(chase_meta.get('side') or fallback_side or 'sell').lower()
        chase_meta['max_chase_price'] = (
            new_px_f * (1.0 - (max_dev_f / 100.0))
            if chase_side == 'sell'
            else new_px_f * (1.0 + (max_dev_f / 100.0))
        )


def _sym_scope_matches(sym_a: str, sym_b: str) -> bool:
    """Match symbols by base/quote while preserving Spot vs Futures (':') boundary."""
    sa = str(sym_a or '').strip()
    sb = str(sym_b or '').strip()
    if (':' in sa) != (':' in sb):
        return False
    return sa.split(':')[0].upper() == sb.split(':')[0].upper()


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
            _update_smart_chase_target(ACTIVE_SMART_CHASES[order_id], request.new_price, request.side)
            asyncio.create_task(BracketOrderService._send_sl_modified_notification(
                user_id=current_user.id,
                symbol=request.symbol,
                side=ACTIVE_SMART_CHASES[order_id].get('side', request.side),
                amount=float(ACTIVE_SMART_CHASES[order_id].get('amount', request.amount)),
                new_price=request.new_price,
                latency_ms=2,
                mode_label="Smart Chase Target"
            ))
            return {
                "id": order_id,
                "symbol": request.symbol,
                "price": request.new_price,
                "execution_speed_ms": 2,
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
        resolved_order_id = str(new_order_id) if new_order_id else str(order_id)
        resolved_price = float(edit_res.get('price') or request.new_price) if isinstance(edit_res, dict) else float(request.new_price)

        if str(order_id) in BracketOrderService.KNOWN_TP_ORDER_IDS and resolved_order_id != str(order_id):
            BracketOrderService.KNOWN_TP_ORDER_IDS.discard(str(order_id))
            BracketOrderService.KNOWN_TP_ORDER_IDS.add(resolved_order_id)

        for s_id, s_meta in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            s_api = s_meta.get('api_key_id')
            if _sym_scope_matches(s_meta.get('symbol', ''), request.symbol) and (s_api is None or int(s_api) == int(api_key_id)):
                if str(s_meta.get('tp_order_id') or '') == str(order_id):
                    s_meta['tp_order_id'] = resolved_order_id
                    s_meta['tp_price'] = resolved_price
                    logger.info(f"🔄 Linked software bracket {s_id} TP order updated: {order_id} -> {resolved_order_id} @ {resolved_price}")

        for eb_id, eb_meta in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
            if eb_meta.get('cancelled'):
                continue
            eb_api = eb_meta.get('api_key_id')
            if _sym_scope_matches(eb_meta.get('symbol', ''), request.symbol) and (eb_api is None or int(eb_api) == int(api_key_id)):
                if str(eb_meta.get('tp_order_id') or '') == str(order_id):
                    eb_meta['tp_order_id'] = resolved_order_id
                    eb_meta['tp_price'] = resolved_price
                    logger.info(f"🔄 Linked entry bracket {eb_id} TP order updated: {order_id} -> {resolved_order_id} @ {resolved_price}")
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
            _update_smart_chase_target(ACTIVE_SMART_CHASES[sl_id], req.new_price, req.side)
            asyncio.create_task(BracketOrderService._send_sl_modified_notification(
                user_id=current_user.id,
                symbol=ACTIVE_SMART_CHASES[sl_id].get('symbol', ''),
                side=ACTIVE_SMART_CHASES[sl_id].get('side', ''),
                amount=float(ACTIVE_SMART_CHASES[sl_id].get('amount', 0.0)),
                new_price=req.new_price,
                latency_ms=2,
                mode_label="Smart Chase Target"
            ))
            return {
                "status": "success",
                "sl_id": sl_id,
                "new_price": req.new_price,
                "execution_speed_ms": 2,
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

def _drag_matches_scope(meta: dict, api_key_id: int, symbol: str, expected_side: str = None) -> bool:
    key_match = (meta.get('api_key_id') is None or int(meta.get('api_key_id')) == int(api_key_id))
    sym_match = (str(meta.get('symbol', '')).strip().upper() == str(symbol).strip().upper())
    if not (key_match and sym_match):
        return False
    if expected_side is not None and str(meta.get('side', '')).lower() != expected_side.lower():
        return False
    return True


def _flip_side(side: Optional[str]) -> Optional[str]:
    """Return opposite order side ('buy' <-> 'sell') when side is valid."""
    s = str(side or '').strip().lower()
    if s == 'buy':
        return 'sell'
    if s == 'sell':
        return 'buy'
    return None


def _infer_entry_side_from_open_order(order: dict, pos_entry_side: Optional[str], known_tp_ids: set) -> Optional[str]:
    """Infer entry side from an exchange open order, flipping exit/TP/reduceOnly orders."""
    o_side = str(order.get('side') or '').lower()
    if o_side not in ('buy', 'sell'):
        return None
    o_id = str(order.get('id') or '')
    o_info = order.get('info') if isinstance(order.get('info'), dict) else {}
    o_type = str(order.get('type') or o_info.get('type') or o_info.get('origType') or '').lower()
    is_reduce = bool(
        order.get('reduceOnly')
        or o_info.get('reduceOnly') in (True, 'true', 'True')
        or o_info.get('closePosition') in (True, 'true', 'True')
    )
    is_exit = (
        o_id in known_tp_ids
        or is_reduce
        or ('stop' in o_type or 'take_profit' in o_type)
        or (pos_entry_side is not None and o_side != pos_entry_side)
    )
    return _flip_side(o_side) if is_exit else o_side


async def _resolve_drag_target_ref(
    exchange,
    symbol: str,
    api_key_id: int,
    ref_str: str,
    is_futures: bool,
    pos_entry_side: Optional[str],
    initial_amount: float,
    initial_entry_side: Optional[str],
):
    """Resolve (amount, entry_side, matched_target_amount, cached_open_orders) for a target_order_id."""
    from app.services.bracket_order_service import BracketOrderService

    amount = initial_amount
    entry_side = initial_entry_side
    matched_target_amount = 0.0
    cached_open_orders = None

    def _apply_match(cand_amt: float, cand_entry_side: Optional[str]):
        nonlocal amount, entry_side, matched_target_amount
        if cand_amt > 0:
            matched_target_amount = matched_target_amount or cand_amt
            if amount <= 0:
                amount = cand_amt
        if entry_side is None and cand_entry_side in ('buy', 'sell'):
            entry_side = cand_entry_side

    # 1. ACTIVE_ENTRY_BRACKETS (note: eb['side'] stores opposite_side = exit side)
    eb_direct = BracketOrderService.ACTIVE_ENTRY_BRACKETS.get(ref_str)
    matched_eb = (
        eb_direct
        if (eb_direct and not eb_direct.get('cancelled') and _drag_matches_scope(eb_direct, api_key_id, symbol))
        else next(
            (
                eb for eb in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.values())
                if not eb.get('cancelled')
                and _drag_matches_scope(eb, api_key_id, symbol)
                and (str(eb.get('tp_order_id') or '') == ref_str or str(eb.get('entry_order_id') or '') == ref_str)
            ),
            None,
        )
    )
    if matched_eb:
        _apply_match(float(matched_eb.get('amount') or 0.0), _flip_side(matched_eb.get('side')))

    # 2. ACTIVE_SOFTWARE_SL (note: sdata['side'] stores opposite_side = exit side)
    if amount <= 0 or entry_side is None:
        for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                continue
            if _drag_matches_scope(sdata, api_key_id, symbol) and (
                BracketOrderService._matches_bracket_ref(sid, sdata, ref_str)
                or str(sdata.get('disaster_sl_order_id') or '') == ref_str
            ):
                _apply_match(float(sdata.get('amount') or 0.0), _flip_side(sdata.get('side')))
                break

    # 3. ACTIVE_SMART_PEGS (entry side) & ACTIVE_SMART_CHASES (exit side)
    if amount <= 0 or entry_side is None:
        try:
            from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS
            pdata = ACTIVE_SMART_PEGS.get(ref_str)
            if pdata and _drag_matches_scope(pdata, api_key_id, symbol):
                p_side = str(pdata.get('side') or '').lower()
                _apply_match(float(pdata.get('amount') or 0.0), p_side if p_side in ('buy', 'sell') else None)
        except Exception:
            pass
        try:
            from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
            cdata = ACTIVE_SMART_CHASES.get(ref_str)
            if cdata and _drag_matches_scope(cdata, api_key_id, symbol):
                _apply_match(float(cdata.get('amount') or 0.0), _flip_side(cdata.get('side')))
        except Exception:
            pass

    # 4. Exchange open orders (pending Futures limit orders & Spot open orders)
    if amount <= 0 or entry_side is None:
        try:
            cached_open_orders = await exchange.fetch_open_orders(symbol)
            if is_futures and not any(str(o.get('id') or '') == ref_str for o in (cached_open_orders or [])):
                try:
                    cond_orders = await exchange.fetch_open_orders(symbol, params={'stop': True})
                    if cond_orders:
                        cached_open_orders = list(cached_open_orders or []) + list(cond_orders)
                except Exception:
                    pass
            for o in cached_open_orders or []:
                if str(o.get('id') or '') == ref_str:
                    _apply_match(
                        float(o.get('remaining') or o.get('amount') or 0.0),
                        _infer_entry_side_from_open_order(o, pos_entry_side, BracketOrderService.KNOWN_TP_ORDER_IDS),
                    )
                    break
        except Exception:
            pass

    return amount, entry_side, matched_target_amount, cached_open_orders


def _drag_amounts_close(a: float, b: float) -> bool:
    return a > 0 and b > 0 and abs(a - b) <= max(1e-8, max(a, b) * 0.02)


def _is_exit_tp_order(order: dict, opposite_side: str, ref_sl_price: float, current_px: float, require_beyond_market: bool) -> bool:
    if str(order.get('side') or '').lower() != opposite_side.lower():
        return False
    px = float(order.get('price') or order.get('stopPrice') or 0.0)
    if px <= 0:
        return False
    if opposite_side.lower() == 'sell':
        return px > max(ref_sl_price, current_px) if require_beyond_market else px > ref_sl_price
    return (px < min(ref_sl_price, current_px)) if require_beyond_market else (px < ref_sl_price)


async def _cancel_exchange_order_safe(exchange, order_id: str, symbol: str, is_futures: bool, cancelled_ids: set):
    from app.services.bracket_order_service import BracketOrderService
    oid = str(order_id)
    if not oid or oid in cancelled_ids:
        return False
    cancelled_ids.add(oid)
    try:
        if is_futures:
            await BracketOrderService._cancel_futures_order_universal(exchange, oid, symbol)
        else:
            await exchange.cancel_order(oid, symbol)
        return True
    except Exception:
        return False


async def _resolve_drag_tp_link(
    exchange,
    symbol: str,
    api_key_id: int,
    opposite_side: str,
    final_amount: float,
    final_price: float,
    current_px: float,
    target_order_id: Optional[str],
):
    """Resolve (linked_tp_order_id, resolved_entry_order_id, linked_tp_price) for Drag SL placement."""
    from app.services.bracket_order_service import BracketOrderService

    bound_tp_ids = {
        str(sdata.get('tp_order_id'))
        for sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.values())
        if not sdata.get('cancelled')
        and sdata.get('status') == 'monitoring'
        and sdata.get('tp_order_id')
        and _drag_matches_scope(sdata, api_key_id, symbol, opposite_side)
    }

    if target_order_id:
        ref_str = str(target_order_id)
        eb_direct = BracketOrderService.ACTIVE_ENTRY_BRACKETS.get(ref_str)
        if eb_direct and not eb_direct.get('cancelled') and _drag_matches_scope(eb_direct, api_key_id, symbol, opposite_side):
            tp_px = float(eb_direct.get('tp_price') or 0.0) or None
            return (str(eb_direct['tp_order_id']) if eb_direct.get('tp_order_id') else None), ref_str, tp_px

        for eb_cand in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.values()):
            if (
                not eb_cand.get('cancelled')
                and _drag_matches_scope(eb_cand, api_key_id, symbol, opposite_side)
                and str(eb_cand.get('tp_order_id') or '') == ref_str
            ):
                entry_id = str(eb_cand['entry_order_id']) if eb_cand.get('entry_order_id') else None
                tp_px = float(eb_cand.get('tp_price') or 0.0) or None
                return ref_str, entry_id, tp_px

        for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            if (
                not sdata.get('cancelled')
                and sdata.get('status') == 'monitoring'
                and _drag_matches_scope(sdata, api_key_id, symbol, opposite_side)
                and BracketOrderService._matches_bracket_ref(sid, sdata, ref_str)
            ):
                tp_id = str(sdata['tp_order_id']) if sdata.get('tp_order_id') else None
                entry_id = str(sdata['entry_order_id']) if sdata.get('entry_order_id') else None
                tp_px = float(sdata.get('tp_price') or 0.0) or None
                return tp_id, entry_id, tp_px

        if ref_str in BracketOrderService.KNOWN_TP_ORDER_IDS:
            return ref_str, None, None

        try:
            open_orders = await exchange.fetch_open_orders(symbol)
            for o in open_orders or []:
                if str(o.get('id') or '') == ref_str:
                    if _is_exit_tp_order(o, opposite_side, final_price, current_px, require_beyond_market=False):
                        BracketOrderService.KNOWN_TP_ORDER_IDS.add(ref_str)
                        tp_px = float(o.get('price') or o.get('stopPrice') or 0.0) or None
                        return ref_str, None, tp_px
                    return None, ref_str, None
        except Exception:
            pass
        return None, ref_str, None

    # No target_order_id selected: safely auto-link unlinked TP only when unambiguous
    eb_candidates = [
        eb for eb in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.values())
        if not eb.get('cancelled')
        and eb.get('tp_order_id')
        and str(eb.get('tp_order_id')) not in bound_tp_ids
        and _drag_matches_scope(eb, api_key_id, symbol, opposite_side)
    ]

    prefetched_open_orders = None
    open_orders_fetched = False
    if eb_candidates:
        try:
            prefetched_open_orders = await exchange.fetch_open_orders(symbol)
            open_orders_fetched = True
        except Exception:
            prefetched_open_orders = None

        open_ids = (
            {str(o.get('id')) for o in (prefetched_open_orders or []) if o and o.get('id')}
            if open_orders_fetched else None
        )

        live_eb_candidates = []
        for eb in eb_candidates:
            tp_oid = str(eb.get('tp_order_id'))
            is_still_open = False
            if open_ids is not None and tp_oid in open_ids:
                is_still_open = True
            else:
                ord_chk = None
                fetch_failed = False
                if hasattr(exchange, 'fetch_order'):
                    try:
                        ord_chk = await exchange.fetch_order(tp_oid, symbol)
                    except Exception:
                        fetch_failed = True
                else:
                    fetch_failed = True

                if isinstance(ord_chk, dict):
                    st = str(ord_chk.get('status') or '').lower()
                    if st in ('open', 'new', 'partially_filled', 'partiallyfilled'):
                        is_still_open = True
                    else:
                        eb['cancelled'] = True
                elif open_orders_fetched:
                    eb['cancelled'] = True
                elif fetch_failed:
                    is_still_open = True
                else:
                    eb['cancelled'] = True

            if is_still_open:
                live_eb_candidates.append(eb)
        eb_candidates = live_eb_candidates

    amt_eb = [c for c in eb_candidates if _drag_amounts_close(float(c.get('amount') or 0.0), final_amount)]
    if len(amt_eb) == 1:
        c = amt_eb[0]
        return str(c['tp_order_id']), (str(c['entry_order_id']) if c.get('entry_order_id') else None), (float(c.get('tp_price') or 0.0) or None)
    if not amt_eb and len(eb_candidates) == 1:
        c = eb_candidates[0]
        return str(c['tp_order_id']), (str(c['entry_order_id']) if c.get('entry_order_id') else None), (float(c.get('tp_price') or 0.0) or None)

    try:
        open_orders = prefetched_open_orders if open_orders_fetched else await exchange.fetch_open_orders(symbol)
        open_tp_cands = [
            o for o in (open_orders or [])
            if str(o.get('id') or '') not in bound_tp_ids
            and _is_exit_tp_order(o, opposite_side, final_price, current_px, require_beyond_market=True)
        ]
        amt_open = [
            o for o in open_tp_cands
            if _drag_amounts_close(float(o.get('remaining') or o.get('amount') or 0.0), final_amount)
        ]
        chosen = amt_open[0] if len(amt_open) == 1 else (open_tp_cands[0] if not amt_open and len(open_tp_cands) == 1 else None)
        if chosen and chosen.get('id'):
            chosen_id = str(chosen['id'])
            BracketOrderService.KNOWN_TP_ORDER_IDS.add(chosen_id)
            tp_px = float(chosen.get('price') or chosen.get('stopPrice') or 0.0) or None
            return chosen_id, None, tp_px
    except Exception:
        pass
    return None, None, None


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
        amount = float(req.amount or 0.0)
        req_side_clean = str(req.side or '').strip().lower()
        entry_side = {'buy': 'buy', 'sell': 'sell', 'long': 'buy', 'short': 'sell'}.get(req_side_clean)

        # 3. Resolve entry side and amount based on market context, target order/bracket, and chart drop position
        pos_info = {}
        pos_amt = 0.0
        pos_contracts = 0.0
        pos_entry_side = None
        is_inverse = False
        if is_futures:
            pos_info = await manual_trade_service.get_active_position(db, current_user.id, req.api_key_id, req.symbol) or {}
            pos_amt = float(pos_info.get('amount') or 0.0)
            pos_contracts = float(pos_info.get('contracts') or 0.0)
            mkt = (getattr(exchange, 'markets', None) or {}).get(req.symbol, {}) if exchange else {}
            settle_base_match = False
            if ':' in req.symbol and '/' in req.symbol:
                p_parts = req.symbol.split('/')
                if len(p_parts) > 1 and ':' in p_parts[1]:
                    settle_base_match = (p_parts[0].upper() == p_parts[1].split(':')[1].upper())
            is_inverse = bool(
                pos_info.get('is_inverse')
                or mkt.get('inverse')
                or mkt.get('subType') == 'inverse'
                or settle_base_match
            )
            if pos_amt > 0 or pos_contracts > 0:
                p_side_raw = str(pos_info.get('side', '')).lower()
                if p_side_raw in ('long', 'short'):
                    pos_entry_side = 'buy' if p_side_raw == 'long' else 'sell'

        # Unified target_order_id / active bracket / open order resolution (Spot & Futures)
        cached_open_orders = None
        matched_target_amount = 0.0
        if req.target_order_id:
            amount, entry_side, matched_target_amount, cached_open_orders = await _resolve_drag_target_ref(
                exchange=exchange,
                symbol=req.symbol,
                api_key_id=req.api_key_id,
                ref_str=str(req.target_order_id),
                is_futures=is_futures,
                pos_entry_side=pos_entry_side,
                initial_amount=amount,
                initial_entry_side=entry_side,
            )

        if is_futures and (pos_amt > 0 or pos_contracts > 0):
            if entry_side is None and pos_entry_side:
                entry_side = pos_entry_side
            if is_inverse and pos_contracts > 0:
                if amount <= 0:
                    amount = pos_contracts
                elif (
                    pos_amt > 0
                    and _drag_amounts_close(amount, pos_amt)
                    and not _drag_amounts_close(amount, pos_contracts)
                    and not (matched_target_amount > 0 and _drag_amounts_close(matched_target_amount, amount))
                ):
                    amount = pos_contracts
            elif amount <= 0:
                amount = pos_contracts if (is_inverse and pos_contracts > 0) else pos_amt
        elif amount <= 0 and not req.target_order_id:
            if bracket_type == 'sl' or is_futures:
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                        continue
                    if _drag_matches_scope(sdata, req.api_key_id, req.symbol):
                        amount = float(sdata.get('amount') or 0.0)
                        if amount > 0:
                            if entry_side is None:
                                entry_side = _flip_side(sdata.get('side')) or entry_side
                            break
            if is_futures and amount <= 0:
                scoped_ebs = [
                    eb for eb in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.values())
                    if not eb.get('cancelled') and _drag_matches_scope(eb, req.api_key_id, req.symbol)
                ]
                if len(scoped_ebs) == 1 and float(scoped_ebs[0].get('amount') or 0.0) > 0:
                    amount = float(scoped_ebs[0]['amount'])
                    if entry_side is None:
                        entry_side = _flip_side(scoped_ebs[0].get('side')) or entry_side
                else:
                    try:
                        cached_open_orders = await exchange.fetch_open_orders(req.symbol)
                        if len(cached_open_orders or []) == 1:
                            o = cached_open_orders[0]
                            ord_amt = float(o.get('remaining') or o.get('amount') or 0.0)
                            if ord_amt > 0:
                                amount = ord_amt
                            if entry_side is None:
                                entry_side = _infer_entry_side_from_open_order(o, pos_entry_side, BracketOrderService.KNOWN_TP_ORDER_IDS) or entry_side
                    except Exception:
                        pass

        # Chart drop position heuristic fallback ONLY when entry_side wasn't explicitly provided or resolved from target/position:
        # TP above market = Sell TP (Long) | TP below market = Buy TP (Dip Buy-Back)
        # SL below market = Sell SL (Long) | SL above market = Buy SL (Smart Chase Buy-Back)
        if entry_side is None:
            if bracket_type == 'tp':
                entry_side = 'buy' if final_price > current_px else 'sell'
            else:
                entry_side = 'buy' if final_price < current_px else 'sell'

        if not is_futures and amount <= 0:
            # Spot swing balance fallback when no target_order_id / active bracket / open order matched
            bal = await manual_trade_service.get_fast_balance(db, current_user.id, req.api_key_id, req.symbol)
            base_free = float(bal.get('base_free') or 0.0)
            quote_free = float(bal.get('quote_free') or 0.0)
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
        if is_futures and is_inverse and final_amount > 0:
            final_amount = float(max(1.0, round(final_amount)))
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
            scoped_sl_cands = [
                (sid, sdata)
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items())
                if not sdata.get('cancelled')
                and sdata.get('status') == 'monitoring'
                and _drag_matches_scope(sdata, req.api_key_id, req.symbol, opposite_side)
            ]
            if req.target_order_id:
                for sid, sdata in scoped_sl_cands:
                    if BracketOrderService._matches_bracket_ref(sid, sdata, req.target_order_id):
                        target_sl_id = sid
                        break
            else:
                amt_sl_cands = [
                    (sid, sdata)
                    for sid, sdata in scoped_sl_cands
                    if _drag_amounts_close(float(sdata.get('amount') or 0.0), final_amount)
                ]
                if len(amt_sl_cands) == 1:
                    target_sl_id = amt_sl_cands[0][0]
                elif len(scoped_sl_cands) == 1:
                    target_sl_id = scoped_sl_cands[0][0]

            if target_sl_id:
                logger.info(f"🛡️ Updating existing active software SL {target_sl_id} to new price {final_price}")
                sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL[target_sl_id]
                sl_meta['trigger_price'] = final_price
                sl_meta['price'] = final_price
                sl_meta['manual_trigger_override'] = final_price
                if final_amount > 0:
                    sl_meta['amount'] = final_amount
                if not sl_meta.get('tp_order_id'):
                    linked_tp_id, resolved_entry_id, linked_tp_price = await _resolve_drag_tp_link(
                        exchange=exchange,
                        symbol=req.symbol,
                        api_key_id=req.api_key_id,
                        opposite_side=opposite_side,
                        final_amount=sl_meta.get('amount', final_amount),
                        final_price=final_price,
                        current_px=current_px,
                        target_order_id=req.target_order_id or sl_meta.get('entry_order_id'),
                    )
                    if linked_tp_id:
                        sl_meta['tp_order_id'] = linked_tp_id
                        if linked_tp_price:
                            sl_meta['tp_price'] = float(linked_tp_price)
                        logger.info(f"🔗 Attached TP order {linked_tp_id} to updated SL monitor {target_sl_id} on {req.symbol}")
                    if resolved_entry_id and not sl_meta.get('entry_order_id'):
                        sl_meta['entry_order_id'] = resolved_entry_id
                if req.sl_config:
                    if req.sl_config.get('type'):
                        sl_meta['type'] = req.sl_config.get('type')
                    if req.sl_config.get('mode'):
                        sl_meta['mode'] = str(req.sl_config.get('mode') or sl_meta.get('mode') or 'ABSOLUTE').upper()

                    sl_meta['max_attempts'] = int(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_max_attempts', 'smartChaseMaxAttempts', sl_meta.get('max_attempts', 10000)))
                    sl_meta['chase_delay_ms'] = int(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_delay_ms', 'smartChaseDelayMs', sl_meta.get('chase_delay_ms', 1500)))
                    sl_meta['max_deviation_pct'] = float(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_deviation_pct', 'smartChaseDeviationPct', sl_meta.get('max_deviation_pct', 1.0)))
                    sl_meta['chase_mode'] = str(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_mode', 'smartChaseMode', sl_meta.get('chase_mode', 'dynamic_bbo'))).lower()
                    sl_meta['trigger_source'] = str(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_trigger_source', 'smartChaseTriggerSource', sl_meta.get('trigger_source', 'bid_ask'))).lower()
                    sl_meta['peg_strategy'] = str(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_peg_strategy', 'smartChasePegStrategy', sl_meta.get('peg_strategy', 'bbo'))).lower()
                    sl_meta['wall_multiplier'] = float(BracketOrderService._get_sl_param(req.sl_config, 'smart_chase_wall_multiplier', 'smartChaseWallMultiplier', sl_meta.get('wall_multiplier', 2.5)))
                    sl_meta['auto_breakeven_enabled'] = bool(BracketOrderService._get_sl_param(req.sl_config, 'auto_breakeven_enabled', 'autoBreakevenEnabled', sl_meta.get('auto_breakeven_enabled', False)))
                    sl_meta['auto_breakeven_trigger_pct'] = float(BracketOrderService._get_sl_param(req.sl_config, 'auto_breakeven_trigger_pct', 'autoBreakevenTriggerPct', sl_meta.get('auto_breakeven_trigger_pct', 1.0)))
                    sl_meta['auto_breakeven_buffer_pct'] = float(BracketOrderService._get_sl_param(req.sl_config, 'auto_breakeven_buffer_pct', 'autoBreakevenBufferPct', sl_meta.get('auto_breakeven_buffer_pct', 0.05)))

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
                # No active SL exists yet — resolve any linked TP and spawn a software SL synchronously
                linked_tp_id, resolved_entry_id, linked_tp_price = await _resolve_drag_tp_link(
                    exchange=exchange,
                    symbol=req.symbol,
                    api_key_id=req.api_key_id,
                    opposite_side=opposite_side,
                    final_amount=final_amount,
                    final_price=final_price,
                    current_px=current_px,
                    target_order_id=req.target_order_id,
                )

                sl_cfg = dict(req.sl_config or {})
                sl_cfg['enabled'] = True
                sl_cfg['mode'] = 'absolute'
                sl_cfg['value'] = final_price
                if 'type' not in sl_cfg:
                    sl_cfg['type'] = 'smart_chase'
                if 'smart_chase_max_attempts' not in sl_cfg and 'smartChaseMaxAttempts' not in sl_cfg:
                    sl_cfg['smart_chase_max_attempts'] = 10000
                if 'smart_chase_trigger_source' not in sl_cfg and 'smartChaseTriggerSource' not in sl_cfg:
                    sl_cfg['smart_chase_trigger_source'] = 'bid_ask'
                if 'smart_chase_mode' not in sl_cfg and 'smartChaseMode' not in sl_cfg:
                    sl_cfg['smart_chase_mode'] = 'dynamic_bbo'
                if 'smart_chase_peg_strategy' not in sl_cfg and 'smartChasePegStrategy' not in sl_cfg:
                    sl_cfg['smart_chase_peg_strategy'] = 'bbo'
                if 'smart_chase_wall_multiplier' not in sl_cfg and 'smartChaseWallMultiplier' not in sl_cfg:
                    sl_cfg['smart_chase_wall_multiplier'] = 2.5
                if 'smart_chase_deviation_pct' not in sl_cfg and 'smartChaseDeviationPct' not in sl_cfg:
                    sl_cfg['smart_chase_deviation_pct'] = 5.0
                if 'smart_chase_delay_ms' not in sl_cfg and 'smartChaseDelayMs' not in sl_cfg:
                    sl_cfg['smart_chase_delay_ms'] = 1500

                await BracketOrderService._spawn_bracket_for_amount(
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
                    entry_order_id=resolved_entry_id,
                    is_consolidation_chunk=False,
                    linked_tp_order_id=linked_tp_id,
                    linked_tp_price=linked_tp_price,
                )
                sl_mode_label = str(sl_cfg.get('type', 'smart_chase')).replace('_', ' ').title()
                msg = f"🛡️ {sl_mode_label} Stop-Loss placed at {final_price} for {final_amount} {req.symbol}"

        elif bracket_type == 'tp':
            # Identify linked active software SL monitors & real entry_order_id BEFORE replacing prior TP
            target_ref = str(req.target_order_id) if req.target_order_id else None
            resolved_entry_id = None
            linked_sl_ids = []
            direct_old_tp_ids = []

            if target_ref:
                eb_direct = BracketOrderService.ACTIVE_ENTRY_BRACKETS.get(target_ref)
                if eb_direct and not eb_direct.get('cancelled') and _drag_matches_scope(eb_direct, req.api_key_id, req.symbol, opposite_side):
                    resolved_entry_id = target_ref
                else:
                    for eb_cand in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.values()):
                        if (
                            not eb_cand.get('cancelled')
                            and _drag_matches_scope(eb_cand, req.api_key_id, req.symbol, opposite_side)
                            and str(eb_cand.get('tp_order_id') or '') == target_ref
                        ):
                            resolved_entry_id = str(eb_cand['entry_order_id']) if eb_cand.get('entry_order_id') else None
                            direct_old_tp_ids.append(target_ref)
                            break

            scoped_sl_cands = [
                (sid, sdata)
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items())
                if not sdata.get('cancelled')
                and sdata.get('status') == 'monitoring'
                and _drag_matches_scope(sdata, req.api_key_id, req.symbol, opposite_side)
            ]
            if target_ref:
                for sid, sdata in scoped_sl_cands:
                    if BracketOrderService._matches_bracket_ref(sid, sdata, target_ref) or (
                        resolved_entry_id and str(sdata.get('entry_order_id') or '') == resolved_entry_id
                    ):
                        linked_sl_ids.append(sid)
                        if not resolved_entry_id and sdata.get('entry_order_id'):
                            resolved_entry_id = str(sdata['entry_order_id'])
            else:
                amt_sl_cands = [
                    sid for sid, sdata in scoped_sl_cands
                    if _drag_amounts_close(float(sdata.get('amount') or 0.0), final_amount)
                ]
                if amt_sl_cands:
                    linked_sl_ids = amt_sl_cands
                elif len(scoped_sl_cands) == 1:
                    linked_sl_ids = [scoped_sl_cands[0][0]]
                for sid in linked_sl_ids:
                    sdata = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sid)
                    if sdata and sdata.get('entry_order_id'):
                        resolved_entry_id = str(sdata['entry_order_id'])
                        break

            # Determine if an unmatched target_ref is an old exchange TP vs pending entry limit order
            if target_ref and not resolved_entry_id and not linked_sl_ids:
                if target_ref in BracketOrderService.KNOWN_TP_ORDER_IDS:
                    direct_old_tp_ids.append(target_ref)
                elif target_ref not in BracketOrderService.ACTIVE_SOFTWARE_SL:
                    is_exchange_exit = False
                    try:
                        open_orders = cached_open_orders if cached_open_orders is not None else await exchange.fetch_open_orders(req.symbol)
                        for o in open_orders or []:
                            if str(o.get('id') or '') == target_ref:
                                if str(o.get('side') or '').lower() == opposite_side:
                                    is_exchange_exit = True
                                break
                    except Exception:
                        pass
                    if is_exchange_exit:
                        direct_old_tp_ids.append(target_ref)
                    else:
                        resolved_entry_id = target_ref

            # Clean up prior TP orders on exchange cleanly without double-cancelling
            cancelled_tp_ids = set()
            cancelled_any_prior = False
            try:
                for old_tp_id in direct_old_tp_ids:
                    if await _cancel_exchange_order_safe(exchange, old_tp_id, req.symbol, is_futures, cancelled_tp_ids):
                        logger.info(f"Cancelling target prior TP {old_tp_id} before setting new drag TP")
                        cancelled_any_prior = True

                for eb_id, eb_data in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
                    if not _drag_matches_scope(eb_data, req.api_key_id, req.symbol, opposite_side):
                        continue
                    eb_tp = eb_data.get('tp_order_id')
                    id_match = (
                        (target_ref and (str(eb_id) == target_ref or str(eb_tp or '') == target_ref))
                        or (resolved_entry_id and str(eb_id) == resolved_entry_id)
                        or (not target_ref and _drag_amounts_close(float(eb_data.get('amount') or 0.0), final_amount))
                    )
                    if id_match and eb_tp:
                        if await _cancel_exchange_order_safe(exchange, eb_tp, req.symbol, is_futures, cancelled_tp_ids):
                            logger.info(f"Cancelling prior bracket TP {eb_tp} before setting new drag TP")
                            cancelled_any_prior = True
                        eb_data['tp_order_id'] = None
                        if str(eb_id).startswith("tp:"):
                            BracketOrderService.ACTIVE_ENTRY_BRACKETS.pop(eb_id, None)

                for sid in linked_sl_ids:
                    sdata = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sid)
                    if not sdata or sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                        continue
                    sl_old_tp = sdata.get('tp_order_id')
                    if sl_old_tp:
                        if await _cancel_exchange_order_safe(exchange, sl_old_tp, req.symbol, is_futures, cancelled_tp_ids):
                            logger.info(f"Cancelling SL-linked TP {sl_old_tp} before setting new drag TP")
                            cancelled_any_prior = True
                        sdata['tp_order_id'] = None

                if cancelled_any_prior:
                    await asyncio.sleep(0.15)
            except Exception as tp_c_err:
                logger.debug(f"Non-fatal prior TP cleanup notice: {tp_c_err}")

            tp_cfg = dict(req.tp_config or {})
            tp_cfg['enabled'] = True
            tp_cfg['mode'] = 'absolute'
            tp_cfg['value'] = final_price
            if 'orderType' in tp_cfg:
                tp_cfg['order_type'] = tp_cfg['orderType']
            if 'order_type' not in tp_cfg:
                tp_cfg['order_type'] = 'Limit'

            # Spawn TP synchronously and re-link any active software SL monitors
            tp_spawn_res = await BracketOrderService._spawn_bracket_for_amount(
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
                entry_order_id=resolved_entry_id,
                is_consolidation_chunk=False,
            )
            new_tp_id = tp_spawn_res.get('tp_order_id') if isinstance(tp_spawn_res, dict) else None
            new_tp_price = tp_spawn_res.get('tp_price') if isinstance(tp_spawn_res, dict) else None
            if new_tp_id:
                resolved_tp_px = float(new_tp_price or final_price)
                for sid in linked_sl_ids:
                    sdata = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sid)
                    if sdata and not sdata.get('cancelled'):
                        sdata['tp_order_id'] = str(new_tp_id)
                        sdata['tp_price'] = resolved_tp_px
                        logger.info(f"🔗 Linked Drag TP {new_tp_id} to active SL monitor {sid} on {req.symbol}")
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
                    'trigger_source': data.get('trigger_source', 'bid_ask'),
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
                    'trigger_source': cdata.get('trigger_source', 'bid_ask'),
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
