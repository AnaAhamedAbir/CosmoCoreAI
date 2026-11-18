"""
Real-Time User Order Stream
===========================
Maintains lightweight on-demand ccxt.pro `watch_orders()` WebSocket streams per
active (api_key_id, market_mode) so cancellations, fills, and OCO/OTOCO sibling
updates on Binance/exchanges invalidate `_OPEN_ORDERS_CACHE` and push an
`order_sync` event to the user's already-open `/ws/notifications` socket in <50ms.
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import redis.asyncio as aioredis
from app.core.config import settings
from app.services.websocket_manager import manager

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_SECONDS = 1500  # 25 minutes of inactivity stops background stream
TERMINAL_STATUSES = {"canceled", "cancelled", "expired", "rejected", "closed", "filled"}
OPEN_STATUSES = {"open", "new"}

# Key: (api_key_id, market_mode) -> {"task": asyncio.Task, "last_active": float, "user_id": int, "symbol": str | None}
_active_streams: Dict[Tuple[int, str], Dict[str, Any]] = {}
_redis_pub: Optional[aioredis.Redis] = None
# Order IDs recently replaced by edit_order (cancelReplace) — suppress false WS removal flicker for 4s
_replaced_order_ttl: Dict[str, float] = {}


def mark_order_replaced(old_order_id: Optional[str], ttl_seconds: float = 4.0) -> None:
    if old_order_id:
        _replaced_order_ttl[str(old_order_id)] = time.time() + ttl_seconds


async def _get_redis_pub() -> Optional[aioredis.Redis]:
    global _redis_pub
    try:
        if _redis_pub is None:
            _redis_pub = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return _redis_pub
    except Exception as exc:
        logger.debug(f"[UserOrderStream] Redis init notice: {exc}")
        return None


async def publish_order_sync_event(
    user_id: Optional[int],
    event: str,
    api_key_id: int,
    symbol: Optional[str] = None,
    order_id: Optional[str] = None,
    order_ids: Optional[List[str]] = None,
    status: Optional[str] = None,
    order: Optional[Dict[str, Any]] = None,
    orders: Optional[List[Dict[str, Any]]] = None,
    replace_id: Optional[str] = None,
) -> None:
    """Publish a lightweight order_sync event to the user's notification WebSocket channel."""
    if not user_id:
        return
    payload: Dict[str, Any] = {
        "target_user_id": int(user_id),
        "type": "order_sync",
        "event": event,
        "api_key_id": int(api_key_id),
        "symbol": symbol,
        "order_id": str(order_id) if order_id else None,
        "order_ids": [str(x) for x in order_ids if x] if order_ids else None,
        "status": status,
        "order": order,
        "orders": orders,
        "replace_id": str(replace_id) if replace_id else None,
        "ts": time.time(),
    }
    try:
        redis = await _get_redis_pub()
        if redis is not None:
            await redis.publish("app_notifications", json.dumps(payload))
            return
    except Exception as exc:
        logger.debug(f"[UserOrderStream] Redis publish notice: {exc}")

    try:
        await manager.broadcast(payload, f"user_notif_{int(user_id)}")
    except Exception:
        pass


def _resolve_market_mode(symbol: Optional[str], is_futures: bool) -> str:
    if not is_futures:
        return "spot"
    sym_u = str(symbol or "").upper()
    if ":" in sym_u:
        settle = sym_u.split(":", 1)[1]
        if settle not in ("USDT", "USDC", "BUSD", "FDUSD"):
            return "inverse"
    return "swap"


def _collect_related_bracket_ids(api_key_id: int, oid: str) -> List[str]:
    """Return any software SL / entry bracket / smart chase IDs linked to `oid`."""
    related = [oid] if oid else []
    if not oid:
        return related
    try:
        from app.services.bracket_order_service import BracketOrderService
        from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES

        oid_s = str(oid)
        for bid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            km = sdata.get("api_key_id") is None or int(sdata.get("api_key_id")) == int(api_key_id)
            if not km:
                continue
            vals = {
                str(bid),
                str(sdata.get("tp_order_id") or ""),
                str(sdata.get("disaster_sl_order_id") or ""),
                str(sdata.get("entry_order_id") or ""),
            }
            if oid_s in vals:
                for v in vals:
                    if v and v not in related:
                        related.append(v)

        for eb_id, eb_data in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
            km = eb_data.get("api_key_id") is None or int(eb_data.get("api_key_id")) == int(api_key_id)
            if not km:
                continue
            vals = {
                str(eb_id),
                str(eb_data.get("tp_order_id") or ""),
                str(eb_data.get("entry_order_id") or ""),
            }
            if oid_s in vals:
                for v in vals:
                    if v and v not in related:
                        related.append(v)

        for cid, cdata in list(ACTIVE_SMART_CHASES.items()):
            vals = {
                str(cid),
                str(cdata.get("tp_order_id") or ""),
                str(cdata.get("disaster_sl_order_id") or ""),
            }
            if oid_s in vals:
                for v in vals:
                    if v and v not in related:
                        related.append(v)
    except Exception:
        pass
    return related


async def _stream_worker(
    stream_key: Tuple[int, str],
    user_id: int,
    exchange_name: str,
    encrypted_api_key: str,
    encrypted_secret: str,
    encrypted_passphrase: Optional[str],
    is_futures: bool,
) -> None:
    from app.core.security import decrypt_key
    from app.services.exchange_pool import get_or_create_exchange
    from app.services.manual_trade_service import ManualTradeService

    api_key_id, market_mode = stream_key
    seen_statuses: Dict[str, str] = {}
    backoff = 1.0

    try:
        dec_key = decrypt_key(encrypted_api_key)
        dec_sec = decrypt_key(encrypted_secret)
        dec_pass = None
        if encrypted_passphrase:
            try:
                dec_pass = decrypt_key(encrypted_passphrase)
            except Exception:
                dec_pass = encrypted_passphrase
    except Exception as exc:
        logger.debug(f"[UserOrderStream] Credential decode error for key={api_key_id}: {exc}")
        _active_streams.pop(stream_key, None)
        return

    logger.info(f"[UserOrderStream] Starting stream for key={api_key_id} mode={market_mode} ({exchange_name})")

    try:
        while True:
            entry = _active_streams.get(stream_key)
            if not entry or (time.time() - entry.get("last_active", 0.0)) > IDLE_TIMEOUT_SECONDS:
                logger.info(f"[UserOrderStream] Stopping idle stream for key={api_key_id} mode={market_mode}")
                break

            try:
                exchange = await get_or_create_exchange(
                    api_key_id=api_key_id,
                    exchange_name=exchange_name,
                    decrypted_api_key=dec_key,
                    decrypted_secret=dec_sec,
                    is_futures=is_futures,
                    passphrase=dec_pass,
                    purpose="ws_orders",
                )

                if not getattr(exchange, "has", {}).get("watchOrders"):
                    logger.debug(f"[UserOrderStream] {exchange_name} does not support watchOrders; exiting")
                    break

                watch_symbol = entry.get("symbol") if market_mode == "inverse" else None
                watch_params = {"type": "delivery"} if market_mode == "inverse" else {}

                while True:
                    entry = _active_streams.get(stream_key)
                    if not entry or (time.time() - entry.get("last_active", 0.0)) > IDLE_TIMEOUT_SECONDS:
                        return

                    try:
                        orders = await asyncio.wait_for(
                            exchange.watch_orders(watch_symbol, None, None, watch_params),
                            timeout=60.0,
                        )
                    except asyncio.TimeoutError:
                        continue

                    backoff = 1.0
                    if not orders:
                        continue

                    for o in orders:
                        oid = str(o.get("id") or "")
                        status = str(o.get("status") or "").lower()
                        sym = str(o.get("symbol") or entry.get("symbol") or "")
                        if not oid or not status:
                            continue

                        # Wake any BracketOrderService entry monitor IMMEDIATELY (<1ms) on fill/partial-fill
                        try:
                            filled_val = float(o.get("filled") or 0.0)
                        except (ValueError, TypeError):
                            filled_val = 0.0
                        if status in ("closed", "filled") or filled_val > 0:
                            try:
                                from app.services.bracket_order_service import BracketOrderService
                                mon = BracketOrderService.ACTIVE_ENTRY_MONITORS.get(oid)
                                if isinstance(mon, dict):
                                    mon["ws_order_snapshot"] = o
                                    fill_ev = mon.get("fill_event")
                                    if fill_ev and not fill_ev.is_set():
                                        fill_ev.set()
                            except Exception:
                                pass

                        prev_status = seen_statuses.get(oid)
                        if prev_status == status:
                            continue
                        seen_statuses[oid] = status
                        if len(seen_statuses) > 600:
                            # Keep bounded memory by dropping oldest half
                            for old_k in list(seen_statuses.keys())[:300]:
                                seen_statuses.pop(old_k, None)

                        ManualTradeService.invalidate_open_orders_cache(api_key_id)
                        ManualTradeService.invalidate_wallet_balance_cache(api_key_id)

                        if status in TERMINAL_STATUSES:
                            rep_exp = _replaced_order_ttl.pop(oid, 0.0)
                            if rep_exp and rep_exp > time.time() and status in ("canceled", "cancelled"):
                                continue
                            related_ids = _collect_related_bracket_ids(api_key_id, oid)
                            await publish_order_sync_event(
                                user_id=user_id,
                                event="order_removed",
                                api_key_id=api_key_id,
                                symbol=sym,
                                order_id=oid,
                                order_ids=related_ids,
                                status=status,
                            )
                        elif status in OPEN_STATUSES:
                            order_line = None
                            try:
                                from app.services.bracket_order_service import BracketOrderService
                                is_disaster = any(
                                    str(s.get("disaster_sl_order_id") or "") == oid
                                    for s in BracketOrderService.ACTIVE_SOFTWARE_SL.values()
                                )
                                if not is_disaster:
                                    px = float(o.get("price") or o.get("stopPrice") or o.get("triggerPrice") or 0.0)
                                    amt = float(o.get("amount") or 0.0)
                                    rem = float(o.get("remaining") if o.get("remaining") is not None else max(0.0, amt - filled_val))
                                    raw_t = str(o.get("type") or "").lower()
                                    if px > 0 and amt > 0:
                                        is_tp = ("take_profit" in raw_t) or (oid in BracketOrderService.KNOWN_TP_ORDER_IDS)
                                        is_sl = (not is_tp) and ("stop" in raw_t or "trailing" in raw_t)
                                        order_line = {
                                            "id": oid,
                                            "side": str(o.get("side") or "").lower(),
                                            "price": px,
                                            "amount": amt,
                                            "filled": filled_val,
                                            "remaining": rem,
                                            "isSoftwareSL": is_sl,
                                            "mode": "TP" if is_tp else ("STOP" if is_sl else "LIMIT"),
                                        }
                            except Exception:
                                order_line = None
                            await publish_order_sync_event(
                                user_id=user_id,
                                event="order_added",
                                api_key_id=api_key_id,
                                symbol=sym,
                                order_id=oid,
                                status=status,
                                order=order_line,
                            )

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                err_msg = str(exc)
                if "Authentication" in type(exc).__name__ or "-2015" in err_msg or "-2014" in err_msg:
                    logger.warning(f"[UserOrderStream] Stopping stream on auth error for key={api_key_id}: {exc}")
                    break
                logger.debug(f"[UserOrderStream] Stream reconnect for key={api_key_id} ({market_mode}) in {backoff:.1f}s: {exc}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 20.0)
    finally:
        _active_streams.pop(stream_key, None)


def ensure_user_order_stream(
    user_id: Optional[int],
    api_key_record: Any,
    is_futures: bool,
    symbol: Optional[str] = None,
) -> None:
    """
    Idempotently start or refresh the idle timer on a live exchange order stream
    for this user's API key & market mode.
    """
    if not user_id or not api_key_record:
        return
    try:
        api_key_id = int(api_key_record.id)
    except Exception:
        return

    ex_name = str(getattr(api_key_record, "exchange", "") or "").lower()
    if not ex_name:
        return

    market_mode = _resolve_market_mode(symbol, is_futures)
    stream_key = (api_key_id, market_mode)
    existing = _active_streams.get(stream_key)
    if existing and existing.get("task") and not existing["task"].done():
        existing["last_active"] = time.time()
        if symbol:
            existing["symbol"] = symbol
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    task = loop.create_task(
        _stream_worker(
            stream_key=stream_key,
            user_id=int(user_id),
            exchange_name=ex_name,
            encrypted_api_key=api_key_record.api_key,
            encrypted_secret=api_key_record.secret_key,
            encrypted_passphrase=getattr(api_key_record, "passphrase", None),
            is_futures=is_futures,
        )
    )
    _active_streams[stream_key] = {
        "task": task,
        "last_active": time.time(),
        "user_id": int(user_id),
        "symbol": symbol,
    }
