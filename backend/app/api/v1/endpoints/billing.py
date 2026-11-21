"""
SaaS Billing, Subscription Status & Payment Webhooks API
========================================================
"""

import json
import logging
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.api import deps
from app.core.config import settings
from app.core.plans import PLAN_CATALOG, resolve_user_plan_tier
from app.models.saas_admin import Subscription, PaymentTransaction
from app.services.billing_service import (
    apply_plan_change,
    create_checkout_session,
    get_configured_providers,
    verify_nowpayments_signature,
    verify_stripe_signature,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class CheckoutRequest(BaseModel):
    provider: str = "stripe"          # "stripe" | "nowpayments"
    plan_tier: str = "pro"            # "pro" | "enterprise"
    billing_cycle: str = "monthly"    # "monthly" | "yearly"


@router.get("/plans")
def list_billing_plans() -> Dict[str, Any]:
    """Return public plan catalog and configured payment providers."""
    return {
        "providers": get_configured_providers(),
        "plans": {
            k: {
                "tier": v.tier,
                "display_name": v.display_name,
                "max_exchanges": v.max_exchanges,
                "max_active_bots": v.max_active_bots,
                "max_backtests_per_month": v.max_backtests_per_month,
                "max_ai_calls_per_day": v.max_ai_calls_per_day,
                "ml_training_enabled": v.ml_training_enabled,
            }
            for k, v in PLAN_CATALOG.items()
        },
    }


@router.get("/subscription")
def get_my_subscription(
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
) -> Dict[str, Any]:
    """Return current user's subscription record and recent transactions."""
    sub = db.query(Subscription).filter(Subscription.user_id == current_user.id).first()
    txs = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.user_id == current_user.id)
        .order_by(PaymentTransaction.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "plan_tier": resolve_user_plan_tier(current_user),
        "providers": get_configured_providers(),
        "subscription": {
            "status": sub.status,
            "provider": sub.provider,
            "billing_cycle": sub.billing_cycle,
            "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
        } if sub else None,
        "transactions": [
            {
                "id": t.id,
                "provider": t.provider,
                "amount_usd": t.amount_usd,
                "currency": t.currency,
                "plan_tier": t.plan_tier,
                "billing_cycle": t.billing_cycle,
                "status": t.status,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txs
        ],
    }


@router.post("/checkout")
async def create_billing_checkout(
    payload: CheckoutRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.User = Depends(deps.get_current_user),
) -> Dict[str, Any]:
    """Create a hosted Stripe or NOWPayments checkout session."""
    if current_user.is_superuser:
        raise HTTPException(status_code=400, detail="Platform Owner already has unlimited access")

    return await create_checkout_session(
        db=db,
        user=current_user,
        provider=payload.provider,
        plan_tier=payload.plan_tier,
        billing_cycle=payload.billing_cycle,
    )


@router.post("/webhook/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(default="", alias="Stripe-Signature"),
    db: Session = Depends(deps.get_db),
) -> Dict[str, Any]:
    """Handle verified Stripe checkout/subscription lifecycle events."""
    raw_body = await request.body()
    if not verify_stripe_signature(raw_body, stripe_signature, settings.STRIPE_WEBHOOK_SECRET or ""):
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    event = json.loads(raw_body.decode("utf-8"))
    event_type = event.get("type", "")
    obj = event.get("data", {}).get("object", {})

    if event_type == "checkout.session.completed":
        meta = obj.get("metadata") or {}
        uid = meta.get("user_id") or obj.get("client_reference_id")
        plan_tier = meta.get("plan_tier", "pro")
        cycle = meta.get("billing_cycle", "monthly")
        session_id = obj.get("id")

        if uid and str(uid).isdigit():
            user = db.query(models.User).filter(models.User.id == int(uid)).first()
            if user:
                apply_plan_change(
                    db=db,
                    user=user,
                    plan_tier=plan_tier,
                    status="active",
                    provider="stripe",
                    billing_cycle=cycle,
                    provider_customer_id=obj.get("customer"),
                    provider_subscription_id=obj.get("subscription"),
                )
        if session_id:
            tx = db.query(PaymentTransaction).filter(PaymentTransaction.provider_payment_id == session_id).first()
            if tx:
                tx.status = "paid"
                tx.raw_payload = event
                db.commit()

    elif event_type == "customer.subscription.deleted":
        sub_id = obj.get("id")
        if sub_id:
            sub = db.query(Subscription).filter(Subscription.provider_subscription_id == sub_id).first()
            if sub and sub.user:
                apply_plan_change(db=db, user=sub.user, plan_tier="free", status="canceled", provider="stripe")

    return {"received": True}


@router.post("/webhook/nowpayments")
async def nowpayments_webhook(
    request: Request,
    x_nowpayments_sig: str = Header(default="", alias="x-nowpayments-sig"),
    db: Session = Depends(deps.get_db),
) -> Dict[str, Any]:
    """Handle verified NOWPayments crypto IPN notifications."""
    raw_body = await request.body()
    payload = json.loads(raw_body.decode("utf-8"))
    if not verify_nowpayments_signature(payload, x_nowpayments_sig, settings.NOWPAYMENTS_IPN_SECRET or ""):
        raise HTTPException(status_code=400, detail="Invalid NOWPayments signature")

    payment_status = str(payload.get("payment_status") or "").lower()
    invoice_id = str(payload.get("invoice_id") or payload.get("order_id") or "")
    tx = db.query(PaymentTransaction).filter(PaymentTransaction.provider_payment_id == invoice_id).first()

    if tx and payment_status in ("finished", "confirmed"):
        tx.status = "paid"
        tx.raw_payload = payload
        db.commit()
        user = db.query(models.User).filter(models.User.id == tx.user_id).first()
        if user:
            apply_plan_change(
                db=db,
                user=user,
                plan_tier=tx.plan_tier,
                status="active",
                provider="nowpayments",
                billing_cycle=tx.billing_cycle,
            )

    return {"received": True}
