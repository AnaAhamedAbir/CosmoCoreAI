"""
Solo-Founder Zero-Code Autopilot & Bangladesh Local Billing Service
==================================================================
Enables a non-coder Platform Owner to operate 10,000+ users entirely from `/admin`:
1. Dynamic No-Code Platform Settings (bKash/Nagad/Rocket/Binance Pay IDs, BDT pricing,
   Global Announcement Banner, Support link) persisted in Redis with DB fallback.
2. Manual/Local Payment Submission (bKash, Nagad, Rocket, Binance Pay TrxID) &
   1-Click Owner Approval / Rejection.
3. Automated Subscription Expiry & Excess Bot Shutdown Engine (downgrades expired
   subscriptions to Free and stops excess bots automatically).
4. 1-Click Customer Support Actions (Reset 2FA, Temporary Password Reset, +30d Extend).
"""

import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, utils
from app.core import security
from app.core.config import settings
from app.core.plans import PLAN_CATALOG
from app.models.saas_admin import AdminAuditLog, PaymentTransaction, Subscription
from app.services.billing_service import PLAN_PRICING_USD, apply_plan_change

logger = logging.getLogger(__name__)

PLATFORM_CONFIG_REDIS_KEY = "cosmo_platform_nocode_config_v1"
PLATFORM_CONFIG_FILE_PATH = Path(os.getcwd()) / "storage" / "platform_config.json"


def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Normalize naive or aware datetime to UTC-aware datetime to avoid comparison TypeError."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

DEFAULT_PLATFORM_CONFIG: Dict[str, Any] = {
    "bkash_number": "01931645993 (Personal - Send Money)",
    "nagad_number": "01931645993 (Personal - Send Money)",
    "rocket_number": "",
    "binance_pay_id": "CosmoQuantAI (Binance Pay / USDT)",
    "pro_monthly_usd": 49.0,
    "pro_monthly_bdt": 5500.0,
    "pro_yearly_usd": 468.0,
    "pro_yearly_bdt": 52000.0,
    "usd_to_bdt_rate": 120.0,
    "support_url": "https://t.me/CosmoQuantAI",
    "announcement_active": False,
    "announcement_message": "",
    "announcement_type": "info",  # "info" | "warning" | "success"
}

LOCAL_PROVIDERS = ("bkash", "nagad", "rocket", "binance_pay")


def get_platform_config() -> Dict[str, Any]:
    """Load dynamic no-code platform settings from Redis, falling back to durable disk JSON & defaults."""
    config = dict(DEFAULT_PLATFORM_CONFIG)

    # 1. Durable disk fallback (survives Redis restarts)
    try:
        if PLATFORM_CONFIG_FILE_PATH.exists():
            disk_data = json.loads(PLATFORM_CONFIG_FILE_PATH.read_text(encoding="utf-8"))
            if isinstance(disk_data, dict):
                config.update(disk_data)
    except Exception as exc:
        logger.debug(f"[Autopilot] Could not read disk platform config: {exc}")

    # 2. Fast Redis cache override
    try:
        r = utils.get_redis_client()
        raw = r.get(PLATFORM_CONFIG_REDIS_KEY)
        if raw:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="ignore")
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                config.update(parsed)
    except Exception as exc:
        logger.debug(f"[Autopilot] Using disk/default platform config (Redis unavailable): {exc}")
    return config


def update_platform_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Persist updated no-code platform settings to both durable disk JSON and Redis."""
    current = get_platform_config()
    for key in DEFAULT_PLATFORM_CONFIG:
        if key in updates and updates[key] is not None:
            current[key] = updates[key]

    # Keep global PLAN_PRICING_USD in sync if owner adjusts USD price
    try:
        PLAN_PRICING_USD["pro"]["monthly"] = float(current["pro_monthly_usd"])
        PLAN_PRICING_USD["pro"]["yearly"] = float(current["pro_yearly_usd"])
    except Exception:
        pass

    try:
        PLATFORM_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        PLATFORM_CONFIG_FILE_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning(f"[Autopilot] Could not persist platform config to disk: {exc}")

    try:
        r = utils.get_redis_client()
        r.set(PLATFORM_CONFIG_REDIS_KEY, json.dumps(current))
    except Exception as exc:
        logger.warning(f"[Autopilot] Could not persist platform config to Redis: {exc}")
    return current


def submit_manual_payment(
    db: Session,
    user: models.User,
    provider: str,
    trx_id: str,
    sender_account: str,
    plan_tier: str = "pro",
    billing_cycle: str = "monthly",
    note: Optional[str] = None,
) -> PaymentTransaction:
    """Record a bKash / Nagad / Rocket / Binance Pay payment submission for 1-click Owner approval."""
    prov = (provider or "").strip().lower()
    if prov not in LOCAL_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported payment method '{provider}'. Choose bkash, nagad, rocket, or binance_pay.",
        )

    clean_trx = (trx_id or "").strip().upper()
    clean_sender = (sender_account or "").strip()
    if len(clean_trx) < 4:
        raise HTTPException(status_code=400, detail="Please enter a valid Transaction ID (TrxID).")
    if len(clean_sender) < 4:
        raise HTTPException(status_code=400, detail="Please enter the sender phone number or Binance ID.")

    tier = (plan_tier or "pro").strip().lower()
    cycle = (billing_cycle or "monthly").strip().lower()
    if tier not in ("pro", "enterprise") or cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid plan tier or billing cycle.")

    provider_payment_id = f"{prov}:{clean_trx}"
    existing = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.provider_payment_id == provider_payment_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="This Transaction ID (TrxID) has already been submitted. Please wait for Owner verification.",
        )

    cfg = get_platform_config()
    amount_usd = float(
        cfg.get("pro_yearly_usd", 468.0) if cycle == "yearly" else cfg.get("pro_monthly_usd", 49.0)
    )
    amount_bdt = float(
        cfg.get("pro_yearly_bdt", 52000.0) if cycle == "yearly" else cfg.get("pro_monthly_bdt", 5500.0)
    )

    tx = PaymentTransaction(
        user_id=user.id,
        provider=prov,
        provider_payment_id=provider_payment_id,
        amount_usd=amount_usd,
        currency="BDT" if prov in ("bkash", "nagad", "rocket") else "USDT",
        plan_tier=tier,
        billing_cycle=cycle,
        status="pending_approval",
        raw_payload={
            "trx_id": clean_trx,
            "sender_account": clean_sender,
            "amount_bdt": amount_bdt,
            "amount_usd": amount_usd,
            "user_email": user.email,
            "user_name": user.full_name,
            "note": (note or "").strip(),
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx


def approve_manual_payment(
    db: Session,
    tx_id: int,
    admin_note: Optional[str] = None,
) -> Dict[str, Any]:
    """1-Click Owner approval: marks transaction paid and activates user's Pro plan."""
    tx = db.query(PaymentTransaction).filter(PaymentTransaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Payment transaction not found")
    if tx.status == "paid":
        raise HTTPException(status_code=400, detail="Payment is already approved")

    user = db.query(models.User).filter(models.User.id == tx.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Associated user account not found")

    period_days = 365 if tx.billing_cycle == "yearly" else 30
    sub = apply_plan_change(
        db=db,
        user=user,
        plan_tier=tx.plan_tier,
        status="active",
        provider=tx.provider,
        billing_cycle=tx.billing_cycle,
        period_days=period_days,
    )

    payload = dict(tx.raw_payload or {})
    payload["approved_at"] = datetime.now(timezone.utc).isoformat()
    if admin_note:
        payload["admin_note"] = admin_note
    tx.raw_payload = payload
    tx.status = "paid"
    db.commit()

    return {
        "transaction_id": tx.id,
        "status": tx.status,
        "user_id": user.id,
        "user_email": user.email,
        "plan_tier": sub.plan_tier,
        "expires_at": sub.current_period_end.isoformat() if sub.current_period_end else None,
    }


def reject_manual_payment(
    db: Session,
    tx_id: int,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """1-Click Owner rejection for invalid/unverified TrxID submissions."""
    tx = db.query(PaymentTransaction).filter(PaymentTransaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Payment transaction not found")

    payload = dict(tx.raw_payload or {})
    payload["rejected_at"] = datetime.now(timezone.utc).isoformat()
    if reason:
        payload["rejection_reason"] = reason
    tx.raw_payload = payload
    tx.status = "rejected"
    db.commit()

    return {"transaction_id": tx.id, "status": tx.status, "reason": reason}


def extend_user_subscription_days(
    db: Session,
    user: models.User,
    days: int = 30,
    plan_tier: str = "pro",
) -> Subscription:
    """Extend a user's active subscription by `days` (or upgrade & grant `days` from now)."""
    now = datetime.now(timezone.utc)
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    period_end = _ensure_utc(sub.current_period_end) if sub else None

    if sub and period_end and period_end > now and sub.status in ("active", "comped", "trialing"):
        new_end = period_end + timedelta(days=days)
        user.plan_tier = plan_tier
        user.is_pro = plan_tier in ("pro", "enterprise")
        sub.plan_tier = plan_tier
        sub.status = "active"
        sub.current_period_end = new_end
        db.commit()
        db.refresh(sub)
        return sub

    return apply_plan_change(
        db=db,
        user=user,
        plan_tier=plan_tier,
        status="active",
        provider="manual",
        billing_cycle="monthly",
        period_days=max(1, days),
    )


def _stop_excess_user_bots_on_downgrade(db: Session, user_id: int, max_allowed: int = 1) -> int:
    """Ensure a downgraded Free user does not keep more than `max_allowed` active bots running."""
    stopped = 0
    kept = 0

    std_bots = (
        db.query(models.Bot)
        .filter(models.Bot.owner_id == user_id, models.Bot.status == "active")
        .order_by(models.Bot.id.asc())
        .all()
    )
    for b in std_bots:
        if kept < max_allowed:
            kept += 1
        else:
            b.status = "inactive"
            stopped += 1

    for model_cls in (models.GridBot, models.LeadLagBot, models.ArbitrageBot):
        rows = (
            db.query(model_cls)
            .filter(model_cls.user_id == user_id, model_cls.is_active == True)
            .order_by(model_cls.id.asc())
            .all()
        )
        for row in rows:
            if kept < max_allowed:
                kept += 1
            else:
                row.is_active = False
                stopped += 1

    try:
        from app.forex.models import ForexBot
        fx_bots = (
            db.query(ForexBot)
            .filter(ForexBot.owner_id == user_id, ForexBot.status == "active")
            .order_by(ForexBot.id.asc())
            .all()
        )
        for fb in fx_bots:
            if kept < max_allowed:
                kept += 1
            else:
                fb.status = "inactive"
                stopped += 1
    except Exception:
        pass

    if stopped > 0:
        db.commit()
    return stopped


def run_subscription_expiry_sweep(db: Session) -> Dict[str, int]:
    """
    Autopilot sweep:
    - Finds expired subscriptions (`current_period_end < now`)
    - Downgrades non-superuser accounts back to Free tier
    - Safely pauses excess running bots beyond the Free tier quota
    """
    now = datetime.now(timezone.utc)
    expired_count = 0
    bots_stopped = 0

    active_subs = (
        db.query(Subscription)
        .filter(
            Subscription.status.in_(["active", "trialing", "comped"]),
            Subscription.current_period_end.isnot(None),
            Subscription.current_period_end < now,
        )
        .all()
    )

    free_max_bots = PLAN_CATALOG["free"].max_active_bots or 1

    for sub in active_subs:
        user = db.query(models.User).filter(models.User.id == sub.user_id).first()
        if not user or getattr(user, "is_superuser", False):
            continue

        user.plan_tier = "free"
        user.is_pro = False
        sub.status = "expired"
        sub.plan_tier = "free"
        expired_count += 1
        db.commit()

        bots_stopped += _stop_excess_user_bots_on_downgrade(db, user.id, max_allowed=free_max_bots)

    return {
        "expired_subscriptions_downgraded": expired_count,
        "excess_bots_stopped": bots_stopped,
    }


def admin_reset_user_2fa(db: Session, target_user: models.User) -> Dict[str, Any]:
    """1-Click support action: disable 2FA for a user who lost their authenticator device."""
    target_user.is_2fa_enabled = False
    target_user.totp_secret_encrypted = None
    db.commit()
    return {"user_id": target_user.id, "email": target_user.email, "is_2fa_enabled": False}


def admin_reset_user_password(
    db: Session,
    target_user: models.User,
    new_password: Optional[str] = None,
) -> Dict[str, Any]:
    """1-Click support action: set or auto-generate a temporary password for a customer."""
    temp_pass = (new_password or "").strip() or f"Cosmo{secrets.token_hex(3).upper()}!"
    target_user.hashed_password = security.get_password_hash(temp_pass)
    target_user.is_email_verified = True
    db.commit()
    return {
        "user_id": target_user.id,
        "email": target_user.email,
        "temporary_password": temp_pass,
    }
