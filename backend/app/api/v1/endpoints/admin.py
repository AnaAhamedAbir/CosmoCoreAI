"""
Sole-Owner Platform Administration API
======================================
Strictly restricted to `is_superuser=True` (the Platform Owner).
Provides user management, manual plan overrides, live bot fleet controls,
global maintenance/kill switches, and immutable audit logs.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app import models, utils
from app.api import deps
from app.core.audit import record_admin_action
from app.core.plans import resolve_user_plan_tier
from app.models.saas_admin import AdminAuditLog, Subscription, PaymentTransaction
from app.services.autopilot_service import (
    admin_reset_user_2fa,
    admin_reset_user_password,
    approve_manual_payment,
    extend_user_subscription_days,
    get_platform_config,
    reject_manual_payment,
    run_subscription_expiry_sweep,
    update_platform_config,
)
from app.services.billing_service import apply_plan_change, PLAN_PRICING_USD

router = APIRouter()


class UpdateUserStatusRequest(BaseModel):
    is_active: bool
    reason: Optional[str] = None


class UpdateUserPlanRequest(BaseModel):
    plan_tier: str  # "free" | "pro" | "enterprise"
    billing_cycle: str = "monthly"
    reason: Optional[str] = None


class MaintenanceSwitchRequest(BaseModel):
    active: bool
    message: Optional[str] = None


class PaymentDecisionRequest(BaseModel):
    note: Optional[str] = None


class AdminPasswordResetRequest(BaseModel):
    new_password: Optional[str] = None


class ExtendSubscriptionRequest(BaseModel):
    days: int = 30
    plan_tier: str = "pro"


class PlatformConfigUpdateRequest(BaseModel):
    bkash_number: Optional[str] = None
    nagad_number: Optional[str] = None
    rocket_number: Optional[str] = None
    binance_pay_id: Optional[str] = None
    pro_monthly_usd: Optional[float] = None
    pro_monthly_bdt: Optional[float] = None
    pro_yearly_usd: Optional[float] = None
    pro_yearly_bdt: Optional[float] = None
    usd_to_bdt_rate: Optional[float] = None
    support_url: Optional[str] = None
    announcement_active: Optional[bool] = None
    announcement_message: Optional[str] = None
    announcement_type: Optional[str] = None


def _get_redis_flag(key: str) -> bool:
    try:
        r = utils.get_redis_client()
        val = r.get(key)
        return val in ("true", b"true")
    except Exception:
        return False


def _set_redis_flag(key: str, active: bool) -> None:
    r = utils.get_redis_client()
    r.set(key, "true" if active else "false")


@router.get("/overview")
def get_admin_overview(
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """High-level SaaS metrics, active bot fleet counts, and platform switches."""
    total_users = db.query(models.User).count()
    active_users = db.query(models.User).filter(models.User.is_active == True).count()
    superuser_count = db.query(models.User).filter(models.User.is_superuser == True).count()
    pro_users = db.query(models.User).filter(models.User.is_pro == True, models.User.is_superuser == False).count()
    total_exchanges = db.query(models.ApiKey).count()

    std_active = db.query(models.Bot).filter(models.Bot.status == "active").count()
    grid_active = db.query(models.GridBot).filter(models.GridBot.is_active == True).count()
    ll_active = db.query(models.LeadLagBot).filter(models.LeadLagBot.is_active == True).count()
    arb_active = db.query(models.ArbitrageBot).filter(models.ArbitrageBot.is_active == True).count()

    from app.forex.models import ForexBot
    forex_active = db.query(ForexBot).filter(ForexBot.status == "active").count()

    total_paid_usd = (
        db.query(func.sum(PaymentTransaction.amount_usd))
        .filter(PaymentTransaction.status == "paid")
        .scalar()
        or 0.0
    )
    pending_payments = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.status == "pending_approval")
        .count()
    )

    estimated_mrr_usd = float(pro_users) * PLAN_PRICING_USD["pro"]["monthly"]

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "suspended": max(0, total_users - active_users),
            "pro": pro_users,
            "free": max(0, total_users - pro_users - superuser_count),
        },
        "bots": {
            "total_active": std_active + grid_active + ll_active + arb_active + forex_active,
            "standard": std_active,
            "grid": grid_active,
            "lead_lag": ll_active,
            "arbitrage": arb_active,
            "forex": forex_active,
        },
        "infrastructure": {
            "connected_exchanges": total_exchanges,
            "global_kill_switch": _get_redis_flag("global_kill_switch"),
            "maintenance_mode": _get_redis_flag("global_maintenance_mode"),
            "auto_archiver": _get_redis_flag("global_auto_archiver_enabled"),
        },
        "revenue": {
            "total_collected_usd": round(float(total_paid_usd), 2),
            "estimated_mrr_usd": round(estimated_mrr_usd, 2),
            "pending_payments": pending_payments,
        },
    }


@router.get("/users")
def list_all_users(
    search: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> List[Dict[str, Any]]:
    """List users with plan, status, bot count, and zero-trust exchange count (no secret keys)."""
    q = db.query(models.User)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter((models.User.email.ilike(term)) | (models.User.full_name.ilike(term)))

    users = q.order_by(models.User.id.desc()).offset(skip).limit(min(limit, 250)).all()
    result = []
    for u in users:
        bot_count = db.query(models.Bot).filter(models.Bot.owner_id == u.id).count()
        active_bot_count = db.query(models.Bot).filter(models.Bot.owner_id == u.id, models.Bot.status == "active").count()
        key_count = db.query(models.ApiKey).filter(models.ApiKey.user_id == u.id).count()
        sub = db.query(Subscription).filter(Subscription.user_id == u.id).first()

        result.append({
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "is_active": bool(u.is_active),
            "is_pro": bool(u.is_pro),
            "is_superuser": bool(u.is_superuser),
            "is_email_verified": bool(getattr(u, "is_email_verified", False)),
            "is_2fa_enabled": bool(getattr(u, "is_2fa_enabled", False)),
            "plan_tier": resolve_user_plan_tier(u),
            "subscription_status": sub.status if sub else "free",
            "subscription_provider": sub.provider if sub else "none",
            "subscription_expires_at": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            "bot_count": bot_count,
            "active_bot_count": active_bot_count,
            "api_key_count": key_count,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })
    return result


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: UpdateUserStatusRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Suspend or reactivate a user account."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == current_owner.id or target.is_superuser:
        raise HTTPException(status_code=400, detail="Cannot suspend the Platform Owner account")

    target.is_active = bool(payload.is_active)
    db.commit()

    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="USER_ACTIVATE" if payload.is_active else "USER_SUSPEND",
        target_type="user",
        target_id=target.id,
        request=request,
        details={"email": target.email, "reason": payload.reason},
    )
    return {"id": target.id, "email": target.email, "is_active": target.is_active}


@router.patch("/users/{user_id}/plan")
def override_user_plan(
    user_id: int,
    payload: UpdateUserPlanRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Manually upgrade or downgrade a user's SaaS tier."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_superuser:
        raise HTTPException(status_code=400, detail="Platform Owner always has unrestricted Enterprise tier")

    try:
        sub = apply_plan_change(
            db=db,
            user=target,
            plan_tier=payload.plan_tier,
            status="comped" if payload.plan_tier != "free" else "active",
            provider="manual",
            billing_cycle=payload.billing_cycle,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="USER_PLAN_OVERRIDE",
        target_type="user",
        target_id=target.id,
        request=request,
        details={"email": target.email, "plan_tier": sub.plan_tier, "reason": payload.reason},
    )
    return {"id": target.id, "email": target.email, "plan_tier": sub.plan_tier, "is_pro": target.is_pro}


@router.get("/bots")
def list_platform_bots(
    active_only: bool = True,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> List[Dict[str, Any]]:
    """Inspect bots across all users for Owner monitoring & emergency intervention."""
    q = db.query(models.Bot, models.User.email).outerjoin(models.User, models.Bot.owner_id == models.User.id)
    if active_only:
        q = q.filter(models.Bot.status == "active")
    rows = q.order_by(models.Bot.id.desc()).limit(200).all()

    return [
        {
            "id": bot.id,
            "name": bot.name,
            "owner_id": bot.owner_id,
            "owner_email": email or "unknown",
            "exchange": bot.exchange,
            "market": bot.market,
            "strategy": bot.strategy,
            "status": bot.status,
            "is_paper_trading": bool(bot.is_paper_trading),
            "pnl": round(float(bot.pnl or 0.0), 2),
        }
        for bot, email in rows
    ]


@router.post("/bots/{bot_id}/force-stop")
async def force_stop_user_bot(
    bot_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Remotely stop any running bot from the Owner Admin Console."""
    bot = db.query(models.Bot).filter(models.Bot.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    if hasattr(request.app.state, "bot_manager"):
        try:
            await request.app.state.bot_manager.stop_bot(bot_id, db)
        except Exception:
            bot.status = "inactive"
            db.commit()
    else:
        bot.status = "inactive"
        db.commit()

    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="BOT_FORCE_STOP",
        target_type="bot",
        target_id=bot_id,
        request=request,
        details={"bot_name": bot.name, "owner_id": bot.owner_id},
    )
    return {"status": "stopped", "bot_id": bot_id}


@router.post("/maintenance")
def toggle_maintenance_mode(
    payload: MaintenanceSwitchRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Toggle global maintenance mode flag in Redis."""
    _set_redis_flag("global_maintenance_mode", payload.active)
    if payload.message is not None:
        try:
            r = utils.get_redis_client()
            r.set("global_maintenance_message", payload.message)
        except Exception:
            pass

    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="MAINTENANCE_MODE_ON" if payload.active else "MAINTENANCE_MODE_OFF",
        target_type="system",
        target_id="global_maintenance_mode",
        request=request,
        details={"message": payload.message},
    )
    return {"active": payload.active}


@router.get("/audit-logs")
def get_admin_audit_logs(
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> List[Dict[str, Any]]:
    """Retrieve immutable Owner action history."""
    logs = (
        db.query(AdminAuditLog)
        .order_by(AdminAuditLog.created_at.desc())
        .limit(min(limit, 250))
        .all()
    )
    return [
        {
            "id": log.id,
            "admin_id": log.admin_id,
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "ip_address": log.ip_address,
            "details": log.details or {},
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


@router.get("/payments")
def list_payment_requests(
    status_filter: Optional[str] = Query(default=None),
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> List[Dict[str, Any]]:
    """List manual (bKash/Nagad/Rocket/Binance Pay) & gateway payment transactions for Owner review."""
    q = db.query(PaymentTransaction, models.User.email, models.User.full_name).outerjoin(
        models.User, PaymentTransaction.user_id == models.User.id
    )
    if status_filter:
        q = q.filter(PaymentTransaction.status == status_filter)
    rows = q.order_by(PaymentTransaction.created_at.desc()).limit(min(limit, 250)).all()

    return [
        {
            "id": tx.id,
            "user_id": tx.user_id,
            "user_email": email or (tx.raw_payload or {}).get("user_email") or "unknown",
            "user_name": full_name or (tx.raw_payload or {}).get("user_name") or "Trader",
            "provider": tx.provider,
            "amount_usd": tx.amount_usd,
            "amount_bdt": (tx.raw_payload or {}).get("amount_bdt"),
            "currency": tx.currency,
            "plan_tier": tx.plan_tier,
            "billing_cycle": tx.billing_cycle,
            "status": tx.status,
            "trx_id": (tx.raw_payload or {}).get("trx_id") or tx.provider_payment_id,
            "sender_account": (tx.raw_payload or {}).get("sender_account") or "",
            "note": (tx.raw_payload or {}).get("note") or "",
            "created_at": tx.created_at.isoformat() if tx.created_at else None,
        }
        for tx, email, full_name in rows
    ]


@router.post("/payments/{tx_id}/approve")
def approve_payment_request(
    tx_id: int,
    request: Request,
    payload: Optional[PaymentDecisionRequest] = None,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """1-Click Owner approval for a bKash / Nagad / Rocket / Binance Pay payment."""
    res = approve_manual_payment(db=db, tx_id=tx_id, admin_note=payload.note if payload else None)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="PAYMENT_APPROVED",
        target_type="payment_transaction",
        target_id=tx_id,
        request=request,
        details=res,
    )
    return res


@router.post("/payments/{tx_id}/reject")
def reject_payment_request(
    tx_id: int,
    request: Request,
    payload: Optional[PaymentDecisionRequest] = None,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """1-Click Owner rejection for an invalid TrxID submission."""
    res = reject_manual_payment(db=db, tx_id=tx_id, reason=payload.note if payload else None)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="PAYMENT_REJECTED",
        target_type="payment_transaction",
        target_id=tx_id,
        request=request,
        details=res,
    )
    return res


@router.get("/platform-config")
def get_admin_platform_config(
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Get no-code platform settings (payment numbers, BDT prices, global announcement banner)."""
    return get_platform_config()


@router.put("/platform-config")
def save_admin_platform_config(
    payload: PlatformConfigUpdateRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Save no-code platform settings directly from the Owner Admin Console UI."""
    updated = update_platform_config(payload.model_dump(exclude_none=True))
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="PLATFORM_CONFIG_UPDATED",
        target_type="system",
        target_id="platform_config",
        request=request,
        details={"announcement_active": updated.get("announcement_active")},
    )
    return updated


@router.post("/users/{user_id}/reset-2fa")
def reset_customer_2fa(
    user_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """1-Click customer support: disable 2FA for a user who lost their phone."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    res = admin_reset_user_2fa(db, target)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="USER_2FA_RESET",
        target_type="user",
        target_id=target.id,
        request=request,
        details={"email": target.email},
    )
    return res


@router.post("/users/{user_id}/reset-password")
def reset_customer_password(
    user_id: int,
    request: Request,
    payload: Optional[AdminPasswordResetRequest] = None,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """1-Click customer support: set or generate a temporary password for a customer."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_superuser and target.id != current_owner.id:
        raise HTTPException(status_code=400, detail="Cannot reset another superuser password")
    res = admin_reset_user_password(db, target, payload.new_password if payload else None)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="USER_PASSWORD_RESET",
        target_type="user",
        target_id=target.id,
        request=request,
        details={"email": target.email},
    )
    return res


@router.post("/users/{user_id}/extend-subscription")
def extend_customer_subscription(
    user_id: int,
    payload: ExtendSubscriptionRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """1-Click customer support: add +30 days (or custom days) of Pro access to a customer."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    sub = extend_user_subscription_days(db, target, days=payload.days, plan_tier=payload.plan_tier)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="USER_SUBSCRIPTION_EXTENDED",
        target_type="user",
        target_id=target.id,
        request=request,
        details={"email": target.email, "days": payload.days, "plan_tier": sub.plan_tier},
    )
    return {
        "user_id": target.id,
        "email": target.email,
        "plan_tier": sub.plan_tier,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
    }


@router.post("/autopilot/run-sweep")
def trigger_autopilot_sweep(
    request: Request,
    db: Session = Depends(deps.get_db),
    current_owner: models.User = Depends(deps.get_current_active_superuser),
) -> Dict[str, Any]:
    """Manually run subscription expiry downgrade + excess bot shutdown sweep from `/admin`."""
    summary = run_subscription_expiry_sweep(db)
    record_admin_action(
        db=db,
        admin_id=current_owner.id,
        action="AUTOPILOT_SWEEP_RUN",
        target_type="system",
        target_id="subscription_expiry_sweep",
        request=request,
        details=summary,
    )
    return summary
