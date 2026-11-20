"""
Manual Trade Persistence Service
================================
Non-blocking, strictly FIFO-ordered PostgreSQL persistence layer for Manual Trade
background monitors (`software_sl`, `smart_chase`, `entry_monitor`, `smart_peg`, `native_otoco`).

All runtime writes are queued onto a single-worker ThreadPoolExecutor so:
1. Ultra-low latency order execution and 250ms BBO monitoring loops are never stalled by DB I/O.
2. Upsert -> Update -> Mark-Terminal calls for the same monitor execute in strict FIFO order
   with zero out-of-order race conditions.
3. If DB/ORM is unavailable or stubbed (e.g. in standalone unit tests), operations
   degrade cleanly to safe no-ops.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import time
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("active", "monitoring", "chasing", "pegging")
_PERSIST_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="manual_trade_persist")
_PENDING_PERSIST_TASKS: set = set()
_LAST_HWM_PERSIST: Dict[str, tuple] = {}  # { monitor_id: (timestamp, highest_price, lowest_price) }


def _symbol_scope_matches(sym_a: Optional[str], sym_b: Optional[str]) -> bool:
    """Match symbols by base/quote while preserving Spot vs Futures (':') boundary."""
    sa = str(sym_a or "").strip()
    sb = str(sym_b or "").strip()
    if not sa or not sb:
        return False
    if (":" in sa) != (":" in sb):
        return False
    return sa.split(":")[0].upper() == sb.split(":")[0].upper()


def _get_db_and_model():
    """Lazily resolve (SessionLocal, ManualTradeMonitor); return (None, None) if stubbed."""
    try:
        from app.db.session import SessionLocal
        from app.models.manual_trade_monitor import ManualTradeMonitor
    except Exception:
        return None, None

    if not callable(SessionLocal):
        return None, None
    try:
        if not hasattr(ManualTradeMonitor, "__tablename__"):
            return None, None
    except Exception:
        return None, None
    return SessionLocal, ManualTradeMonitor


def _is_usable_session(db: Any) -> bool:
    return bool(db is not None and hasattr(db, "query") and hasattr(db, "commit"))


def ensure_manual_trade_monitors_table() -> bool:
    """Idempotently ensure the manual_trade_monitors table exists at startup."""
    try:
        from app.db.session import engine
        from app.models.manual_trade_monitor import ManualTradeMonitor

        ManualTradeMonitor.__table__.create(bind=engine, checkfirst=True)
        return True
    except Exception as exc:
        logger.debug(f"[ManualTradePersistence] Table ensure skipped: {exc}")
        return False


def _sanitize_json(value: Any) -> Any:
    """Recursively coerce values into JSON-serializable primitives."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _sanitize_json(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_json(v) for v in value]
    if hasattr(value, "dict") and callable(value.dict):
        try:
            return _sanitize_json(value.dict())
        except Exception:
            pass
    return str(value)


def upsert_monitor_sync(
    monitor_id: str,
    kind: str,
    user_id: Optional[int],
    api_key_id: Optional[int],
    symbol: str,
    is_futures: bool,
    side: str,
    status: str = "active",
    sl_type: Optional[str] = None,
    sl_mode: Optional[str] = None,
    amount: float = 0.0,
    entry_price: float = 0.0,
    trigger_price: Optional[float] = None,
    highest_price: Optional[float] = None,
    lowest_price: Optional[float] = None,
    entry_order_id: Optional[str] = None,
    tp_order_id: Optional[str] = None,
    tp_price: Optional[float] = None,
    disaster_sl_order_id: Optional[str] = None,
    breakeven_activated: bool = False,
    manual_trigger_override: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
) -> bool:
    """Create or update a persistent ManualTradeMonitor row synchronously."""
    if not monitor_id or not user_id or not api_key_id or not symbol:
        return False

    SessionLocal, ManualTradeMonitor = _get_db_and_model()
    if not SessionLocal or not ManualTradeMonitor:
        return False

    db = SessionLocal()
    if not _is_usable_session(db):
        try:
            db.close()
        except Exception:
            pass
        return False

    try:
        mid = str(monitor_id)
        existing = db.query(ManualTradeMonitor).filter(ManualTradeMonitor.monitor_id == mid).first()
        clean_cfg = _sanitize_json(config or {})

        if existing is None:
            row = ManualTradeMonitor(
                monitor_id=mid,
                kind=str(kind),
                user_id=int(user_id),
                api_key_id=int(api_key_id),
                symbol=str(symbol),
                is_futures=bool(is_futures),
                side=str(side).lower(),
                status=str(status),
                sl_type=str(sl_type) if sl_type else None,
                sl_mode=str(sl_mode) if sl_mode else None,
                amount=float(amount or 0.0),
                entry_price=float(entry_price or 0.0),
                trigger_price=float(trigger_price) if trigger_price is not None else None,
                highest_price=float(highest_price) if highest_price is not None else None,
                lowest_price=float(lowest_price) if lowest_price is not None else None,
                entry_order_id=str(entry_order_id) if entry_order_id else None,
                tp_order_id=str(tp_order_id) if tp_order_id else None,
                tp_price=float(tp_price) if tp_price is not None else None,
                disaster_sl_order_id=str(disaster_sl_order_id) if disaster_sl_order_id else None,
                breakeven_activated=bool(breakeven_activated),
                manual_trigger_override=float(manual_trigger_override) if manual_trigger_override is not None else None,
                config=clean_cfg,
            )
            db.add(row)
        else:
            existing.kind = str(kind)
            existing.user_id = int(user_id)
            existing.api_key_id = int(api_key_id)
            existing.symbol = str(symbol)
            existing.is_futures = bool(is_futures)
            existing.side = str(side).lower()
            existing.status = str(status)
            if sl_type is not None:
                existing.sl_type = str(sl_type)
            if sl_mode is not None:
                existing.sl_mode = str(sl_mode)
            existing.amount = float(amount or 0.0)
            existing.entry_price = float(entry_price or 0.0)
            if trigger_price is not None:
                existing.trigger_price = float(trigger_price)
            if highest_price is not None:
                existing.highest_price = float(highest_price)
            if lowest_price is not None:
                existing.lowest_price = float(lowest_price)
            if entry_order_id is not None:
                existing.entry_order_id = str(entry_order_id) if entry_order_id else None
            if kind == "smart_chase":
                # Smart chase execution cancels prior TP/Disaster SL before entering chase loop
                existing.tp_order_id = str(tp_order_id) if tp_order_id else None
                existing.disaster_sl_order_id = str(disaster_sl_order_id) if disaster_sl_order_id else None
            else:
                if tp_order_id is not None:
                    existing.tp_order_id = str(tp_order_id) if tp_order_id else None
                if disaster_sl_order_id is not None:
                    existing.disaster_sl_order_id = str(disaster_sl_order_id) if disaster_sl_order_id else None
            if tp_price is not None:
                existing.tp_price = float(tp_price)
            existing.breakeven_activated = bool(breakeven_activated)
            if manual_trigger_override is not None:
                existing.manual_trigger_override = float(manual_trigger_override)
            if clean_cfg:
                merged = dict(existing.config or {})
                merged.update(clean_cfg)
                existing.config = merged

        db.commit()
        return True
    except Exception as exc:
        logger.debug(f"[ManualTradePersistence] upsert failed for {monitor_id}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def update_monitor_sync(
    monitor_id: str,
    fields: Optional[Dict[str, Any]] = None,
    config_patch: Optional[Dict[str, Any]] = None,
) -> bool:
    """Update specific fields/config keys on an existing ManualTradeMonitor row."""
    if not monitor_id:
        return False

    SessionLocal, ManualTradeMonitor = _get_db_and_model()
    if not SessionLocal or not ManualTradeMonitor:
        return False

    db = SessionLocal()
    if not _is_usable_session(db):
        try:
            db.close()
        except Exception:
            pass
        return False

    try:
        row = db.query(ManualTradeMonitor).filter(ManualTradeMonitor.monitor_id == str(monitor_id)).first()
        if row is None:
            return False

        if fields:
            for key, val in fields.items():
                if hasattr(row, key):
                    setattr(row, key, val)

        if config_patch:
            merged = dict(row.config or {})
            merged.update(_sanitize_json(config_patch))
            row.config = merged

        db.commit()
        return True
    except Exception as exc:
        logger.debug(f"[ManualTradePersistence] update failed for {monitor_id}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def mark_terminal_sync(
    monitor_id: str,
    status: str = "completed",
    reason: Optional[str] = None,
) -> bool:
    """Mark a monitor as terminal ('completed', 'cancelled', 'failed')."""
    if not monitor_id:
        return False
    _LAST_HWM_PERSIST.pop(str(monitor_id), None)
    patch = {"terminal_reason": str(reason)} if reason else None
    return update_monitor_sync(str(monitor_id), fields={"status": str(status)}, config_patch=patch)


def mark_terminal_by_scope_sync(
    api_key_id: Optional[int],
    symbol: Optional[str],
    kinds: Optional[Iterable[str]] = None,
    status: str = "cancelled",
    reason: Optional[str] = None,
) -> int:
    """Mark all active monitors matching (api_key_id, symbol, kinds) as terminal."""
    if api_key_id is None or not symbol:
        return 0

    SessionLocal, ManualTradeMonitor = _get_db_and_model()
    if not SessionLocal or not ManualTradeMonitor:
        return 0

    db = SessionLocal()
    if not _is_usable_session(db):
        try:
            db.close()
        except Exception:
            pass
        return 0

    try:
        q = db.query(ManualTradeMonitor).filter(
            ManualTradeMonitor.api_key_id == int(api_key_id),
            ManualTradeMonitor.status.in_(ACTIVE_STATUSES),
        )
        if kinds:
            q = q.filter(ManualTradeMonitor.kind.in_(list(kinds)))
        rows = q.all()
        updated = 0
        for row in rows:
            if not _symbol_scope_matches(row.symbol, symbol):
                continue
            row.status = str(status)
            if reason:
                merged = dict(row.config or {})
                merged["terminal_reason"] = str(reason)
                row.config = merged
            _LAST_HWM_PERSIST.pop(str(row.monitor_id), None)
            updated += 1
        if updated > 0:
            db.commit()
        return updated
    except Exception as exc:
        logger.debug(f"[ManualTradePersistence] scope mark failed ({api_key_id}, {symbol}): {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        try:
            db.close()
        except Exception:
            pass


def replace_entry_monitor_id_sync(old_order_id: str, new_order_id: str) -> bool:
    """Migrate a persisted entry_monitor row ID seamlessly after cancelReplace / edit_order."""
    if not old_order_id or not new_order_id or str(old_order_id) == str(new_order_id):
        return False

    SessionLocal, ManualTradeMonitor = _get_db_and_model()
    if not SessionLocal or not ManualTradeMonitor:
        return False

    db = SessionLocal()
    if not _is_usable_session(db):
        try:
            db.close()
        except Exception:
            pass
        return False

    try:
        old_row = db.query(ManualTradeMonitor).filter(ManualTradeMonitor.monitor_id == str(old_order_id)).first()
        if old_row is None:
            return False
        collision = db.query(ManualTradeMonitor).filter(ManualTradeMonitor.monitor_id == str(new_order_id)).first()
        if collision is not None:
            old_row.status = "cancelled"
            db.commit()
            return True
        old_row.monitor_id = str(new_order_id)
        old_row.entry_order_id = str(new_order_id)
        db.commit()
        return True
    except Exception as exc:
        logger.debug(f"[ManualTradePersistence] entry ID migration failed ({old_order_id}->{new_order_id}): {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def _dispatch_bg(fn, *args, **kwargs) -> None:
    """Schedule a synchronous DB helper onto the single-worker FIFO executor without blocking."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        fn(*args, **kwargs)
        return

    async def _runner():
        try:
            await loop.run_in_executor(_PERSIST_EXECUTOR, lambda: fn(*args, **kwargs))
        except Exception as exc:
            logger.debug(f"[ManualTradePersistence] async dispatch error: {exc}")

    task = loop.create_task(_runner())
    _PENDING_PERSIST_TASKS.add(task)
    task.add_done_callback(_PENDING_PERSIST_TASKS.discard)


def schedule_upsert_monitor(**kwargs) -> None:
    _dispatch_bg(upsert_monitor_sync, **kwargs)


def schedule_update_monitor(
    monitor_id: str,
    fields: Optional[Dict[str, Any]] = None,
    config_patch: Optional[Dict[str, Any]] = None,
) -> None:
    _dispatch_bg(update_monitor_sync, monitor_id, fields=fields, config_patch=config_patch)


def schedule_mark_terminal(
    monitor_id: str,
    status: str = "completed",
    reason: Optional[str] = None,
) -> None:
    _dispatch_bg(mark_terminal_sync, monitor_id, status=status, reason=reason)


def schedule_mark_terminal_by_scope(
    api_key_id: Optional[int],
    symbol: Optional[str],
    kinds: Optional[Iterable[str]] = None,
    status: str = "cancelled",
    reason: Optional[str] = None,
) -> None:
    _dispatch_bg(
        mark_terminal_by_scope_sync,
        api_key_id,
        symbol,
        kinds=kinds,
        status=status,
        reason=reason,
    )


def schedule_replace_entry_monitor_id(old_order_id: str, new_order_id: str) -> None:
    _dispatch_bg(replace_entry_monitor_id_sync, old_order_id, new_order_id)


def schedule_throttled_trailing_hwm(
    monitor_id: str,
    highest_price: Optional[float],
    lowest_price: Optional[float],
    trigger_price: Optional[float],
    min_interval_seconds: float = 8.0,
) -> None:
    """Persist trailing high/low water marks at most once every `min_interval_seconds` when changed."""
    if not monitor_id:
        return
    now = time.monotonic()
    prev = _LAST_HWM_PERSIST.get(monitor_id)
    if prev is not None:
        prev_ts, prev_hi, prev_lo = prev
        if (now - prev_ts) < min_interval_seconds:
            return
        if prev_hi == highest_price and prev_lo == lowest_price:
            return
    _LAST_HWM_PERSIST[monitor_id] = (now, highest_price, lowest_price)
    fields: Dict[str, Any] = {}
    if highest_price is not None:
        fields["highest_price"] = float(highest_price)
    if lowest_price is not None:
        fields["lowest_price"] = float(lowest_price)
    if trigger_price is not None:
        fields["trigger_price"] = float(trigger_price)
    if fields:
        schedule_update_monitor(monitor_id, fields=fields)


async def flush_active_monitors_on_shutdown(timeout_seconds: float = 3.0) -> None:
    """
    Flush live in-memory SL / Smart Chase / Smart Peg states and wait for any
    queued persistence writes before graceful server shutdown.
    """
    try:
        from app.services.bracket_order_service import BracketOrderService

        for sl_id, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
            if not isinstance(sdata, dict) or sdata.get("cancelled"):
                continue
            fields: Dict[str, Any] = {}
            if sdata.get("trigger_price") is not None:
                fields["trigger_price"] = float(sdata["trigger_price"])
            if sdata.get("amount") is not None:
                fields["amount"] = float(sdata["amount"])
            if sdata.get("highest_price") is not None:
                fields["highest_price"] = float(sdata["highest_price"])
            if sdata.get("lowest_price") is not None:
                fields["lowest_price"] = float(sdata["lowest_price"])
            if fields:
                schedule_update_monitor(str(sl_id), fields=fields)
    except Exception:
        pass

    try:
        from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES

        for cid, cdata in list(ACTIVE_SMART_CHASES.items()):
            if not isinstance(cdata, dict):
                continue
            patch: Dict[str, Any] = {}
            if cdata.get("current_order_id"):
                patch["current_order_id"] = str(cdata["current_order_id"])
            if cdata.get("original_sl") is not None:
                patch["original_sl"] = float(cdata["original_sl"])
            fields = {"amount": float(cdata["amount"])} if cdata.get("amount") is not None else None
            if fields or patch:
                schedule_update_monitor(str(cid), fields=fields, config_patch=patch or None)
    except Exception:
        pass

    try:
        from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS

        for pid, pdata in list(ACTIVE_SMART_PEGS.items()):
            if not isinstance(pdata, dict):
                continue
            patch = {}
            if pdata.get("current_order_id"):
                patch["current_order_id"] = str(pdata["current_order_id"])
            if pdata.get("filled_amount") is not None:
                patch["total_filled"] = float(pdata["filled_amount"])
            fields = {"amount": float(pdata["amount"])} if pdata.get("amount") is not None else None
            if fields or patch:
                schedule_update_monitor(str(pid), fields=fields, config_patch=patch or None)
    except Exception:
        pass

    pending = [t for t in list(_PENDING_PERSIST_TASKS) if not t.done()]
    if pending:
        try:
            await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            logger.debug("[ManualTradePersistence] Shutdown flush timed out; remaining tasks may abort.")
