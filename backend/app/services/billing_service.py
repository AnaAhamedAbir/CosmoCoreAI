"""
Pluggable SaaS Billing & Subscription Service
===========================================
Supports Stripe (Card) and NOWPayments (Crypto) checkouts + cryptographic
webhook verification, plus manual/comped overrides from the Owner Console.
"""

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Tuple
import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.core.config import settings
from app.models.saas_admin import Subscription, PaymentTransaction

logger = logging.getLogger(__name__)

PLAN_PRICING_USD: Dict[str, Dict[str, float]] = {
    "pro": {"monthly": 49.0, "yearly": 468.0},        # $39/mo billed yearly
    "enterprise": {"monthly": 199.0, "yearly": 1908.0},
}


def get_configured_providers() -> Dict[str, bool]:
    return {
        "stripe": bool(settings.STRIPE_SECRET_KEY),
        "nowpayments": bool(settings.NOWPAYMENTS_API_KEY),
    }


def apply_plan_change(
    db: Session,
    user: models.User,
    plan_tier: str,
    status: str = "active",
    provider: str = "manual",
    billing_cycle: str = "monthly",
    provider_customer_id: Optional[str] = None,
    provider_subscription_id: Optional[str] = None,
    period_days: int = 30,
) -> Subscription:
    """Update User tier flags and upsert Subscription record atomically."""
    tier = (plan_tier or "free").strip().lower()
    if tier not in ("free", "pro", "enterprise"):
        raise ValueError(f"Unsupported plan_tier: {plan_tier}")

    user.plan_tier = tier
    user.is_pro = tier in ("pro", "enterprise") and status in ("active", "trialing", "comped")
    if tier == "free" or status in ("canceled", "past_due", "expired"):
        user.is_pro = False
        if status in ("canceled", "expired"):
            user.plan_tier = "free"

    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=365 if billing_cycle == "yearly" else period_days)

    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    if not sub:
        sub = Subscription(
            user_id=user.id,
            plan_tier=user.plan_tier,
            billing_cycle=billing_cycle,
            status=status,
            provider=provider,
            provider_customer_id=provider_customer_id,
            provider_subscription_id=provider_subscription_id,
            current_period_start=now,
            current_period_end=period_end if user.plan_tier != "free" else None,
        )
        db.add(sub)
    else:
        sub.plan_tier = user.plan_tier
        sub.billing_cycle = billing_cycle
        sub.status = status
        sub.provider = provider
        if provider_customer_id:
            sub.provider_customer_id = provider_customer_id
        if provider_subscription_id:
            sub.provider_subscription_id = provider_subscription_id
        sub.current_period_start = now
        sub.current_period_end = period_end if user.plan_tier != "free" else None

    db.commit()
    db.refresh(sub)
    return sub


async def create_checkout_session(
    db: Session,
    user: models.User,
    provider: str,
    plan_tier: str,
    billing_cycle: str = "monthly",
) -> Dict[str, Any]:
    """Create a hosted checkout URL via Stripe or NOWPayments."""
    prov = provider.strip().lower()
    tier = plan_tier.strip().lower()
    cycle = billing_cycle.strip().lower()

    if tier not in PLAN_PRICING_USD or cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid plan tier or billing cycle")

    amount_usd = PLAN_PRICING_USD[tier][cycle]
    frontend_base = (settings.FRONTEND_URL or "http://localhost:2026").rstrip("/")
    success_url = f"{frontend_base}/settings/billing?checkout=success"
    cancel_url = f"{frontend_base}/settings/billing?checkout=canceled"

    if prov == "stripe":
        if not settings.STRIPE_SECRET_KEY:
            raise HTTPException(
                status_code=503,
                detail="BILLING_NOT_CONFIGURED: Stripe API key is not configured yet in .env.",
            )
        price_id = (
            settings.STRIPE_PRICE_ID_PRO_YEARLY if cycle == "yearly" else settings.STRIPE_PRICE_ID_PRO_MONTHLY
        ) if tier == "pro" else None

        form_data: Dict[str, Any] = {
            "mode": "subscription" if price_id else "payment",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "customer_email": user.email,
            "client_reference_id": str(user.id),
            "metadata[user_id]": str(user.id),
            "metadata[plan_tier]": tier,
            "metadata[billing_cycle]": cycle,
        }
        if price_id:
            form_data["line_items[0][price]"] = price_id
            form_data["line_items[0][quantity]"] = "1"
        else:
            form_data["line_items[0][price_data][currency]"] = "usd"
            form_data["line_items[0][price_data][unit_amount]"] = str(int(amount_usd * 100))
            form_data["line_items[0][price_data][product_data][name]"] = f"CosmoQuantAI {tier.title()} ({cycle})"
            form_data["line_items[0][quantity]"] = "1"

        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                "https://api.stripe.com/v1/checkout/sessions",
                auth=(settings.STRIPE_SECRET_KEY, ""),
                data=form_data,
            )
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Stripe checkout error: {res.text}")
        session_obj = res.json()
        payment_id = session_obj["id"]
        checkout_url = session_obj["url"]

    elif prov == "nowpayments":
        if not settings.NOWPAYMENTS_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="BILLING_NOT_CONFIGURED: NOWPayments API key is not configured yet in .env.",
            )
        order_id = f"cosmo_{user.id}_{tier}_{cycle}_{int(time.time())}"
        payload = {
            "price_amount": amount_usd,
            "price_currency": "usd",
            "order_id": order_id,
            "order_description": f"CosmoQuantAI {tier.title()} ({cycle})",
            "success_url": success_url,
            "cancel_url": cancel_url,
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                "https://api.nowpayments.io/v1/invoice",
                headers={"x-api-key": settings.NOWPAYMENTS_API_KEY, "Content-Type": "application/json"},
                json=payload,
            )
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"NOWPayments checkout error: {res.text}")
        inv = res.json()
        payment_id = str(inv.get("id") or order_id)
        checkout_url = inv["invoice_url"]

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported billing provider: {provider}")

    tx = PaymentTransaction(
        user_id=user.id,
        provider=prov,
        provider_payment_id=payment_id,
        amount_usd=amount_usd,
        currency="USD",
        plan_tier=tier,
        billing_cycle=cycle,
        status="pending",
        checkout_url=checkout_url,
    )
    db.add(tx)
    db.commit()
    return {"checkout_url": checkout_url, "payment_id": payment_id, "provider": prov}


def verify_stripe_signature(payload: bytes, sig_header: str, secret: str, tolerance: int = 300) -> bool:
    """Verify Stripe-Signature header (`t=...,v1=...`) using HMAC-SHA256."""
    if not sig_header or not secret:
        return False
    parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
    ts = parts.get("t")
    v1 = parts.get("v1")
    if not ts or not v1 or not ts.isdigit():
        return False
    if abs(time.time() - int(ts)) > tolerance:
        return False
    signed_payload = f"{ts}.".encode("utf-8") + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def verify_nowpayments_signature(payload_dict: dict, sig_header: str, ipn_secret: str) -> bool:
    """Verify NOWPayments x-nowpayments-sig using sorted JSON HMAC-SHA512."""
    if not sig_header or not ipn_secret:
        return False
    sorted_json = json.dumps(payload_dict, separators=(",", ":"), sort_keys=True)
    expected = hmac.new(ipn_secret.encode("utf-8"), sorted_json.encode("utf-8"), hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, sig_header.strip().lower())
