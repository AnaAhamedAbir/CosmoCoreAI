"""
Multi-Tenant Feature Gating & Quota Enforcement
===============================================
Enforces per-plan limits for Exchange connections, Active Bots, Backtests,
AI Strategy/Sentiment calls, and ML Model Training.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models, utils
from app.core.plans import get_plan_limits, resolve_user_plan_tier

logger = logging.getLogger(__name__)


def _raise_quota_exceeded(feature: str, limit: Any, tier: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"PLAN_LIMIT_EXCEEDED: Your {tier.title()} plan allows up to {limit} {feature}. "
            "Please upgrade to Pro or Enterprise to unlock higher limits."
        ),
    )


def _count_user_exchanges(db: Session, user_id: int) -> int:
    return db.query(models.ApiKey).filter(models.ApiKey.user_id == user_id).count()


def _count_user_active_bots(db: Session, user_id: int) -> int:
    """Count running/active bots across Bot, GridBot, LeadLagBot, and ArbitrageBot."""
    std_active = (
        db.query(models.Bot)
        .filter(models.Bot.owner_id == user_id, models.Bot.status == "active")
        .count()
    )
    grid_active = (
        db.query(models.GridBot)
        .filter(models.GridBot.user_id == user_id, models.GridBot.is_active == True)
        .count()
    )
    ll_active = (
        db.query(models.LeadLagBot)
        .filter(models.LeadLagBot.user_id == user_id, models.LeadLagBot.is_active == True)
        .count()
    )
    arb_active = (
        db.query(models.ArbitrageBot)
        .filter(models.ArbitrageBot.user_id == user_id, models.ArbitrageBot.is_active == True)
        .count()
    )
    return std_active + grid_active + ll_active + arb_active


def check_exchange_quota(db: Session, user: models.User) -> None:
    limits = get_plan_limits(user)
    if limits.max_exchanges is None:
        return
    current_count = _count_user_exchanges(db, user.id)
    if current_count >= limits.max_exchanges:
        _raise_quota_exceeded("connected exchange(s)", limits.max_exchanges, limits.tier)


def check_bot_quota(db: Session, user: models.User) -> None:
    limits = get_plan_limits(user)
    if limits.max_active_bots is None:
        return
    active_count = _count_user_active_bots(db, user.id)
    if active_count >= limits.max_active_bots:
        _raise_quota_exceeded("active bot(s)", limits.max_active_bots, limits.tier)


def _redis_counter_increment(key: str, ttl_seconds: int) -> int:
    try:
        r = utils.get_redis_client()
        val = r.incr(key)
        if val == 1:
            r.expire(key, ttl_seconds)
        return int(val)
    except Exception as e:
        logger.debug(f"[Quotas] Redis counter unavailable ({key}): {e}")
        return 0


def _redis_counter_get(key: str) -> int:
    try:
        r = utils.get_redis_client()
        val = r.get(key)
        if val is None:
            return 0
        if isinstance(val, bytes):
            val = val.decode("utf-8")
        return int(val)
    except Exception:
        return 0


def _backtest_month_key(user_id: int) -> str:
    month_tag = datetime.now(timezone.utc).strftime("%Y-%m")
    return f"quota:backtest:{int(user_id)}:{month_tag}"


def _ai_day_key(user_id: int) -> str:
    day_tag = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"quota:ai:{int(user_id)}:{day_tag}"


def check_and_increment_backtest_quota(user: models.User) -> None:
    limits = get_plan_limits(user)
    if limits.max_backtests_per_month is None:
        return

    key = _backtest_month_key(user.id)
    current = _redis_counter_get(key)
    if current >= limits.max_backtests_per_month:
        _raise_quota_exceeded("backtests per month", limits.max_backtests_per_month, limits.tier)

    _redis_counter_increment(key, ttl_seconds=35 * 86400)


def check_and_increment_ai_quota(user: models.User) -> None:
    limits = get_plan_limits(user)
    if limits.max_ai_calls_per_day is None:
        return

    key = _ai_day_key(user.id)
    current = _redis_counter_get(key)
    if current >= limits.max_ai_calls_per_day:
        _raise_quota_exceeded("AI generations per day", limits.max_ai_calls_per_day, limits.tier)

    _redis_counter_increment(key, ttl_seconds=2 * 86400)


def check_ml_training_access(user: models.User) -> None:
    limits = get_plan_limits(user)
    if not limits.ml_training_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "PLAN_LIMIT_EXCEEDED: Auto-ML & RL Model Training requires a Pro or Enterprise plan. "
                "Please upgrade your plan to start training jobs."
            ),
        )


def get_user_quota_summary(db: Session, user: models.User) -> Dict[str, Any]:
    limits = get_plan_limits(user)
    tier = resolve_user_plan_tier(user)
    return {
        "plan_tier": tier,
        "display_name": limits.display_name,
        "is_unlimited": bool(getattr(user, "is_superuser", False)),
        "usage": {
            "exchanges": _count_user_exchanges(db, user.id),
            "active_bots": _count_user_active_bots(db, user.id),
            "backtests_this_month": _redis_counter_get(_backtest_month_key(user.id)),
            "ai_calls_today": _redis_counter_get(_ai_day_key(user.id)),
        },
        "limits": {
            "max_exchanges": limits.max_exchanges,
            "max_active_bots": limits.max_active_bots,
            "max_backtests_per_month": limits.max_backtests_per_month,
            "max_ai_calls_per_day": limits.max_ai_calls_per_day,
            "ml_training_enabled": limits.ml_training_enabled,
        },
    }
