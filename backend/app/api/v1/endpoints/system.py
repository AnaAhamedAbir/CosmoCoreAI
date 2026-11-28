from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.utils import get_redis_client
import redis
from app import models

from app.api import deps
from app.db.session import SessionLocal
from app.services.market_service import MarketService
from app.services.system_service import SystemService
from sqlalchemy.orm import Session
from datetime import datetime
import pytz

router = APIRouter()

class KillSwitchSchema(BaseModel):
    active: bool


class UpdateStatusSchema(BaseModel):
    updating: bool
    message: Optional[str] = None
    version: Optional[str] = None


class LatencyGuardConfigSchema(BaseModel):
    guard_enabled: Optional[bool] = None
    block_on_degraded: Optional[bool] = None
    binance_warn_ms: Optional[int] = None
    binance_block_ms: Optional[int] = None
    client_warn_ms: Optional[int] = None
    client_block_ms: Optional[int] = None

class AutoArchiverSwitchSchema(BaseModel):
    active: bool

class PruneResponse(BaseModel):
    deleted_count: int
    message: str

class ServiceStatus(BaseModel):
    database: str
    redis: str
    celery_worker: str

class HealthResponse(BaseModel):
    status: str
    services: ServiceStatus
    timestamp: str

@router.get("/kill-switch", response_model=KillSwitchSchema)
def get_kill_switch_status(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Get the current status of the Global Admin Kill Switch.
    Requires Superuser/Owner privileges.
    """
    r = get_redis_client()
    status = r.get("global_kill_switch")
    is_active = status == "true"
    return {"active": is_active}

@router.post("/kill-switch", response_model=KillSwitchSchema)
def toggle_kill_switch(
    payload: KillSwitchSchema,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Toggle the Global Admin Kill Switch.
    Requires Superuser/Owner privileges.
    """
    r = get_redis_client()
    r.set("global_kill_switch", "true" if payload.active else "false")
    return {"active": payload.active}

@router.get("/auto-archiver", response_model=AutoArchiverSwitchSchema)
def get_auto_archiver_status(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Get the current status of the Auto-Archiver feature.
    Requires Superuser/Owner privileges.
    """
    r = get_redis_client()
    status = r.get("global_auto_archiver_enabled")
    # Default is false if not explicitly set to true
    is_active = status in ("true", b"true")
    return {"active": is_active}

@router.post("/auto-archiver", response_model=AutoArchiverSwitchSchema)
def toggle_auto_archiver(
    payload: AutoArchiverSwitchSchema,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Toggle the Auto-Archiver feature.
    Requires Superuser/Owner privileges.
    """
    r = get_redis_client()
    r.set("global_auto_archiver_enabled", "true" if payload.active else "false")
    return {"active": payload.active}

@router.get("/panic", response_model=KillSwitchSchema)
def get_panic_status(
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Get the panic status for the current user.
    """
    r = get_redis_client()
    key = f"GLOBAL_KILL_SWITCH:{current_user.id}"
    status = r.get(key)
    is_active = status == "true"
    return {"active": is_active}

@router.post("/panic", response_model=KillSwitchSchema)
def toggle_panic_switch(
    payload: KillSwitchSchema,
    current_user: models.User = Depends(deps.get_current_user)
):
    """
    Toggle the User Panic Switch.
    When active (True), all bots for this user MUST stop immediately.
    """
    r = get_redis_client()
    key = f"GLOBAL_KILL_SWITCH:{current_user.id}"
    r.set(key, "true" if payload.active else "false")
    return {"active": payload.active}


@router.post("/prune-db", response_model=PruneResponse)
def prune_database_manually(
    days: int = 30,
    current_user: models.User = Depends(deps.get_current_active_superuser)
):
    """
    Manually trigger data pruning.
    Requires Superuser privileges.
    """
    db = SessionLocal()
    try:
        count = MarketService().prune_old_sentiment_data(db, days=days)
        return {"deleted_count": count, "message": f"Successfully deleted {count} records older than {days} records."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.delete("/prune-l2-data", response_model=PruneResponse)
def prune_l2_database_manually(
    current_user: models.User = Depends(deps.get_current_active_superuser)
):
    """
    Manually trigger L2 orderbook data pruning.
    Deletes all L2 data cache. Requires Superuser privileges.
    """
    db = SessionLocal()
    try:
        from app.models.orderbook_snapshot import OrderBookSnapshot
        count = db.query(OrderBookSnapshot).delete()
        db.commit()
        return {"deleted_count": count, "message": f"Successfully cleared {count} L2 Orderbook ticks."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@router.get("/health", response_model=HealthResponse)
async def health_check(
    db: Session = Depends(deps.get_db)
):
    """
    Monitor the pulse of the entire backend infrastructure: Database, Redis, and Celery Worker.
    Returns 503 if unhealthy.
    """
    status_data = await SystemService.check_health(db)
    
    # Overwrite timestamp with current time
    status_data["timestamp"] = datetime.now(pytz.utc).isoformat()
    
    if status_data["status"] != "healthy":
        # We return the data even if 503, so the client knows WHAT is down.
        # FastAPI HTTPException handles content? No, usually just detail string or dict.
        # But for 503 with body, we might need JSONResponse.
        # However, simply raising HTTPException with detail=status_data works for simple clients,
        # but the response_schema validation might fail if we just return.
        # For strict 503, we can use JSONResponse.
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content=status_data)
        
    return status_data


@router.get("/ping")
async def ping_server():
    """Lightweight ping endpoint for measuring pure Device-to-VPS network RTT."""
    return {"ok": True, "ts": datetime.now(pytz.utc).isoformat()}


@router.get("/network-status")
async def get_network_latency_status(
    refresh: bool = False,
    current_user: models.User = Depends(deps.get_current_user),
):
    """Authenticated lightweight exchange latency + guard verdict for continuous monitoring."""
    network = await SystemService.measure_binance_latency(force=refresh)
    guard_config = SystemService.get_latency_guard_config()
    health = SystemService.evaluate_latency_health(network, guard_config)
    return {
        "network": network,
        "health": health,
        "guard_config": guard_config,
        "timestamp": datetime.now(pytz.utc).isoformat(),
    }


@router.get("/latency-guard")
async def get_latency_guard_settings(
    current_user: models.User = Depends(deps.get_current_user),
):
    """Return current latency warning & execution protection settings."""
    return SystemService.get_latency_guard_config()


@router.put("/latency-guard")
async def update_latency_guard_settings(
    payload: LatencyGuardConfigSchema,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Update and persist global latency warning & trade/bot protection thresholds."""
    updates = payload.dict(exclude_none=True)
    return SystemService.set_latency_guard_config(updates)


@router.get("/update-status")
def get_version_update_status():
    """Return whether a rolling server/version update is currently in progress."""
    try:
        r = get_redis_client()
        raw_flag = r.get("cosmo_version_update_in_progress")
        updating = raw_flag in ("true", b"true", "1", b"1")
        raw_msg = r.get("cosmo_version_update_message")
        raw_ver = r.get("cosmo_app_version")
        if isinstance(raw_msg, bytes):
            raw_msg = raw_msg.decode("utf-8", errors="ignore")
        if isinstance(raw_ver, bytes):
            raw_ver = raw_ver.decode("utf-8", errors="ignore")
        return {
            "updating": updating,
            "message": raw_msg or "Version update in progress...",
            "version": raw_ver or "live",
        }
    except Exception:
        return {
            "updating": False,
            "message": "",
            "version": "live",
        }


@router.post("/update-status")
def set_version_update_status(
    payload: UpdateStatusSchema,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Toggle version-update banner manually (Owner only)."""
    r = get_redis_client()
    r.set("cosmo_version_update_in_progress", "true" if payload.updating else "false", ex=1800 if payload.updating else None)
    if payload.message is not None:
        r.set("cosmo_version_update_message", payload.message)
    if payload.version is not None:
        r.set("cosmo_app_version", payload.version)
    return {"updating": payload.updating, "message": payload.message, "version": payload.version}


@router.get("/hardware-telemetry")
async def get_vps_hardware_telemetry(
    refresh: bool = False,
    current_user: models.User = Depends(deps.get_current_active_superuser)
):
    """Return live VPS host CPU, RAM, disk/ROM, uptime, temperature, and Binance network latency."""
    import asyncio
    try:
        data, network = await asyncio.gather(
            asyncio.to_thread(SystemService.get_hardware_telemetry),
            SystemService.measure_binance_latency(force=refresh),
        )
        data["network"] = network
        guard_config = SystemService.get_latency_guard_config()
        data["network_health"] = SystemService.evaluate_latency_health(network, guard_config)
        data["guard_config"] = guard_config
        data["timestamp"] = datetime.now(pytz.utc).isoformat()
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read VPS telemetry: {str(e)}")


@router.get("/alerts")
def get_system_alerts_history(
    limit: int = 100,
    severity: Optional[str] = None,
    container: Optional[str] = None,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Return persisted system monitor alerts + summary counters + active capture mode.
    Owner/Superuser only.
    """
    import json as _json
    from app.services.log_monitor_service import (
        SYS_ALERTS_HISTORY_KEY,
        is_docker_daemon_configured,
    )

    capped_limit = max(1, min(limit, 200))
    r = get_redis_client()
    alerts = []
    try:
        raw_items = r.lrange(SYS_ALERTS_HISTORY_KEY, 0, capped_limit - 1) or []
        for raw in raw_items:
            try:
                text = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
                item = _json.loads(text)
                if severity and str(item.get("severity", "")).upper() != severity.upper():
                    continue
                if container and item.get("container") != container:
                    continue
                alerts.append(item)
            except Exception:
                continue
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load alert history: {e}")

    counts = {"critical": 0, "error": 0, "warning": 0, "unacknowledged": 0}
    for a in alerts:
        sev = str(a.get("severity", "")).upper()
        if sev == "CRITICAL":
            counts["critical"] += 1
        elif sev == "ERROR":
            counts["error"] += 1
        elif sev == "WARNING":
            counts["warning"] += 1
        if not a.get("acknowledged", False):
            counts["unacknowledged"] += 1

    return {
        "alerts": alerts,
        "counts": counts,
        "total": len(alerts),
        "capture_mode": "docker_socket" if is_docker_daemon_configured() else "live_handler",
        "timestamp": datetime.now(pytz.utc).isoformat(),
    }


@router.post("/alerts/ack-all")
def acknowledge_all_system_alerts(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Mark all persisted system alerts as acknowledged/resolved in one click."""
    import json as _json
    from app.services.log_monitor_service import SYS_ALERTS_HISTORY_KEY

    r = get_redis_client()
    raw_items = r.lrange(SYS_ALERTS_HISTORY_KEY, 0, -1) or []
    now_iso = datetime.now(pytz.utc).isoformat()
    updated_count = 0
    for idx, raw in enumerate(raw_items):
        try:
            text = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
            item = _json.loads(text)
            if not item.get("acknowledged", False):
                item["acknowledged"] = True
                item["acknowledged_at"] = now_iso
                item["acknowledged_by"] = current_user.email
                r.lset(SYS_ALERTS_HISTORY_KEY, idx, _json.dumps(item))
                updated_count += 1
        except Exception:
            continue

    return {"ok": True, "updated_count": updated_count}


@router.post("/alerts/{alert_id}/ack")
def acknowledge_system_alert(
    alert_id: str,
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Mark a persisted system alert as acknowledged/resolved."""
    import json as _json
    from app.services.log_monitor_service import SYS_ALERTS_HISTORY_KEY

    r = get_redis_client()
    raw_items = r.lrange(SYS_ALERTS_HISTORY_KEY, 0, -1) or []
    updated = False
    for idx, raw in enumerate(raw_items):
        try:
            text = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
            item = _json.loads(text)
            if str(item.get("id")) == alert_id:
                item["acknowledged"] = True
                item["acknowledged_at"] = datetime.now(pytz.utc).isoformat()
                item["acknowledged_by"] = current_user.email
                r.lset(SYS_ALERTS_HISTORY_KEY, idx, _json.dumps(item))
                updated = True
                break
        except Exception:
            continue

    return {"ok": True, "id": alert_id, "updated": updated}


@router.delete("/alerts")
def clear_system_alerts_history(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Clear all persisted system monitor alerts from Redis history."""
    from app.services.log_monitor_service import SYS_ALERTS_HISTORY_KEY

    r = get_redis_client()
    r.delete(SYS_ALERTS_HISTORY_KEY)
    return {"ok": True, "cleared": True}


@router.post("/alerts/test")
def emit_test_system_alert(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Emit a synthetic verification alert through the real Sys Monitor pipeline."""
    from app.services.log_monitor_service import record_and_publish_system_alert

    r = get_redis_client()
    now_iso = datetime.now(pytz.utc).isoformat()
    payload = record_and_publish_system_alert(
        r,
        {
            "type": "system_alert",
            "severity": "ERROR",
            "container": "cosmoquant_backend",
            "display_name": "BACKEND",
            "logger": "app.api.v1.endpoints.system",
            "source": "diagnostic_test",
            "message": f"[Diagnostic Verification] Synthetic test alert triggered by {current_user.email}",
            "snippet": [
                f"Diagnostic alert pipeline check triggered by {current_user.email}",
                "Verified: Redis persistence -> Pub/Sub broadcast -> WebSocket delivery",
            ],
            "timestamp": now_iso,
            "acknowledged": False,
        },
        publish=True,
    )
    return {"ok": True, "alert": payload}


@router.get("/logs/snapshot")
def get_container_logs_snapshot(
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """Return latest live container log batches stored in Redis (instant REST fallback)."""
    import json as _json
    from app.utils import LIVE_CONTAINER_LOGS_KEY_PREFIX

    r = get_redis_client()
    batches = []
    try:
        keys = sorted(r.keys(f"{LIVE_CONTAINER_LOGS_KEY_PREFIX}*") or [])
        for k in keys:
            raw = r.get(k)
            if not raw:
                continue
            try:
                text = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
                batches.append(_json.loads(text))
            except Exception:
                continue
    except Exception:
        pass
    return {"batches": batches, "timestamp": datetime.now(pytz.utc).isoformat()}
