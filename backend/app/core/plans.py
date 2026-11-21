"""
SaaS Subscription Tiers & Plan Limits
=====================================
Single source of truth for Free, Pro, and Enterprise (including Sole Owner) quotas.
Matches PricingPage.tsx tiers while allowing easy future updates from DB/Billing.
"""

from dataclasses import dataclass
from typing import Dict, Optional, Any


@dataclass(frozen=True)
class PlanLimits:
    tier: str
    display_name: str
    max_exchanges: Optional[int]          # None = unlimited
    max_active_bots: Optional[int]        # None = unlimited
    max_backtests_per_month: Optional[int]
    max_ai_calls_per_day: Optional[int]
    ml_training_enabled: bool
    live_trading_enabled: bool


PLAN_CATALOG: Dict[str, PlanLimits] = {
    "free": PlanLimits(
        tier="free",
        display_name="Hobbyist (Free)",
        max_exchanges=1,
        max_active_bots=1,
        max_backtests_per_month=10,
        max_ai_calls_per_day=5,
        ml_training_enabled=False,
        live_trading_enabled=True,
    ),
    "pro": PlanLimits(
        tier="pro",
        display_name="Pro Trader",
        max_exchanges=5,
        max_active_bots=10,
        max_backtests_per_month=None,
        max_ai_calls_per_day=200,
        ml_training_enabled=True,
        live_trading_enabled=True,
    ),
    "enterprise": PlanLimits(
        tier="enterprise",
        display_name="Enterprise / Owner",
        max_exchanges=None,
        max_active_bots=None,
        max_backtests_per_month=None,
        max_ai_calls_per_day=None,
        ml_training_enabled=True,
        live_trading_enabled=True,
    ),
}


def resolve_user_plan_tier(user: Any) -> str:
    """
    Resolve effective plan tier for a user.
    The Sole Owner (`is_superuser=True`) always receives unrestricted Enterprise access.
    """
    if getattr(user, "is_superuser", False):
        return "enterprise"

    raw_tier = str(getattr(user, "plan_tier", "") or "").strip().lower()
    if raw_tier in PLAN_CATALOG:
        # Backward compatibility if legacy admin/flag set is_pro=True while plan_tier='free'
        if raw_tier == "free" and getattr(user, "is_pro", False):
            return "pro"
        return raw_tier

    return "pro" if getattr(user, "is_pro", False) else "free"


def get_plan_limits(user: Any) -> PlanLimits:
    """Return the PlanLimits dataclass applicable to `user`."""
    tier = resolve_user_plan_tier(user)
    return PLAN_CATALOG[tier]
