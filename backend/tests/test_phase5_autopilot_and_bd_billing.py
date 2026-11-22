import ast
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from tests.test_phase3_admin_and_billing import _install_stubs  # noqa: E402

_install_stubs()

import types  # noqa: E402

if "app.core.security" not in sys.modules:
    sec = types.ModuleType("app.core.security")
    sec.get_password_hash = lambda pwd: f"hashed::{pwd}"
    sec.verify_token = lambda tok: None
    sys.modules["app.core.security"] = sec
else:
    sec = sys.modules["app.core.security"]
    if not hasattr(sec, "get_password_hash"):
        sec.get_password_hash = lambda pwd: f"hashed::{pwd}"

if "app" in sys.modules:
    sys.modules["app"].models = sys.modules["app.models"]
    sys.modules["app"].utils = sys.modules["app.utils"]


class _ComparableCol:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return (self.name, "==", other)

    def __lt__(self, other):
        return (self.name, "<", other)

    def __gt__(self, other):
        return (self.name, ">", other)

    def isnot(self, other):
        return (self.name, "isnot", other)

    def in_(self, other):
        return (self.name, "in", other)

    def asc(self):
        return (self.name, "asc")


sm = sys.modules["app.models.saas_admin"]
for attr in ("id", "provider_payment_id", "status", "current_period_end"):
    setattr(sm.PaymentTransaction, attr, _ComparableCol(attr))
    setattr(sm.Subscription, attr, _ComparableCol(attr))

m = sys.modules["app.models"]
for cls_name in ("Bot", "GridBot", "LeadLagBot", "ArbitrageBot", "User"):
    cls_obj = getattr(m, cls_name)
    for col in ("id", "owner_id", "user_id", "status", "is_active"):
        setattr(cls_obj, col, _ComparableCol(col))

pl = sys.modules["app.core.plans"]
if not hasattr(pl, "PLAN_CATALOG"):
    pl.PLAN_CATALOG = {
        "free": SimpleNamespace(max_active_bots=1),
        "pro": SimpleNamespace(max_active_bots=10),
        "enterprise": SimpleNamespace(max_active_bots=None),
    }

from app.services.autopilot_service import (  # noqa: E402
    PLATFORM_CONFIG_FILE_PATH,
    _ensure_utc,
    admin_reset_user_2fa,
    admin_reset_user_password,
    approve_manual_payment,
    extend_user_subscription_days,
    get_platform_config,
    reject_manual_payment,
    run_subscription_expiry_sweep,
    submit_manual_payment,
    update_platform_config,
)


class TestBangladeshBillingAndAutopilot(unittest.TestCase):
    def test_submit_and_approve_bkash_payment(self):
        db = MagicMock()
        # No duplicate TrxID on submit
        db.query.return_value.filter.return_value.first.return_value = None
        user = SimpleNamespace(id=15, email="trader@bd.com", full_name="Rahim Trader", plan_tier="free", is_pro=False)

        tx = submit_manual_payment(
            db=db,
            user=user,
            provider="bkash",
            trx_id="bks12345xyz",
            sender_account="01711223344",
            plan_tier="pro",
            billing_cycle="monthly",
        )
        self.assertEqual(tx.provider, "bkash")
        self.assertEqual(tx.status, "pending_approval")
        self.assertEqual(tx.currency, "BDT")
        self.assertEqual(tx.raw_payload["trx_id"], "BKS12345XYZ")
        tx.id = 99

        # Now approve the payment in 1 click
        def query_side_effect(model):
            q = MagicMock()
            if model is sm.PaymentTransaction:
                q.filter.return_value.first.return_value = tx
            elif model is m.User:
                q.filter.return_value.first.return_value = user
            elif model is sm.Subscription:
                q.filter.return_value.first.return_value = None
            return q

        db.query.side_effect = query_side_effect
        approved = approve_manual_payment(db, tx_id=99, admin_note="Verified on bKash app")
        self.assertEqual(approved["status"], "paid")
        self.assertEqual(user.plan_tier, "pro")
        self.assertTrue(user.is_pro)

    def test_reject_manual_payment(self):
        db = MagicMock()
        tx = SimpleNamespace(id=101, status="pending_approval", raw_payload={})
        db.query.return_value.filter.return_value.first.return_value = tx

        res = reject_manual_payment(db, tx_id=101, reason="Wrong TrxID")
        self.assertEqual(res["status"], "rejected")
        self.assertEqual(tx.status, "rejected")
        self.assertEqual(tx.raw_payload["rejection_reason"], "Wrong TrxID")

    def test_subscription_expiry_sweep_downgrades_and_stops_excess_bots(self):
        past = datetime.now(timezone.utc) - timedelta(days=2)
        expired_sub = SimpleNamespace(user_id=22, status="active", plan_tier="pro", current_period_end=past)
        customer = SimpleNamespace(id=22, email="expired@bd.com", is_superuser=False, plan_tier="pro", is_pro=True)
        bot1 = SimpleNamespace(id=1, status="active")
        bot2 = SimpleNamespace(id=2, status="active")
        bot3 = SimpleNamespace(id=3, status="active")

        db = MagicMock()

        def query_side_effect(model):
            q = MagicMock()
            if model is sm.Subscription:
                q.filter.return_value.all.return_value = [expired_sub]
            elif model is m.User:
                q.filter.return_value.first.return_value = customer
            elif model is m.Bot:
                q.filter.return_value.order_by.return_value.all.return_value = [bot1, bot2, bot3]
            else:
                q.filter.return_value.order_by.return_value.all.return_value = []
            return q

        db.query.side_effect = query_side_effect
        summary = run_subscription_expiry_sweep(db)

        self.assertEqual(summary["expired_subscriptions_downgraded"], 1)
        self.assertEqual(summary["excess_bots_stopped"], 2)
        self.assertEqual(customer.plan_tier, "free")
        self.assertFalse(customer.is_pro)
        self.assertEqual(expired_sub.status, "expired")
        self.assertEqual(bot1.status, "active")    # 1 free bot kept
        self.assertEqual(bot2.status, "inactive")  # excess stopped
        self.assertEqual(bot3.status, "inactive")  # excess stopped

    def test_one_click_support_tools_and_nocode_config(self):
        db = MagicMock()
        u = SimpleNamespace(id=30, email="help@bd.com", is_2fa_enabled=True, totp_secret_encrypted="enc", hashed_password="old", is_email_verified=False)

        r2fa = admin_reset_user_2fa(db, u)
        self.assertFalse(r2fa["is_2fa_enabled"])
        self.assertIsNone(u.totp_secret_encrypted)

        rpwd = admin_reset_user_password(db, u)
        self.assertTrue(rpwd["temporary_password"].startswith("Cosmo"))
        self.assertTrue(u.is_email_verified)

        cfg = update_platform_config({"bkash_number": "01900000000", "announcement_active": True, "announcement_message": "Eid Offer!"})
        self.assertEqual(cfg["bkash_number"], "01900000000")
        self.assertTrue(cfg["announcement_active"])
        loaded = get_platform_config()
        self.assertEqual(loaded["bkash_number"], "01900000000")
        if PLATFORM_CONFIG_FILE_PATH.exists():
            PLATFORM_CONFIG_FILE_PATH.unlink()

        # Naive datetime normalization safety check
        naive_future = datetime.utcnow() + timedelta(days=5)
        self.assertIsNotNone(_ensure_utc(naive_future).tzinfo)
        existing_sub = SimpleNamespace(
            user_id=30,
            status="active",
            plan_tier="pro",
            current_period_end=naive_future,
        )
        db.query.return_value.filter.return_value.first.return_value = existing_sub
        extended = extend_user_subscription_days(db, u, days=30, plan_tier="pro")
        self.assertEqual(extended.plan_tier, "pro")

    def test_phase5_python_files_parse_cleanly(self):
        for rel in (
            "app/services/autopilot_service.py",
            "app/services/bot_manager.py",
            "app/api/v1/endpoints/admin.py",
            "app/api/v1/endpoints/billing.py",
            "app/main.py",
        ):
            full = os.path.join(BACKEND_ROOT, rel)
            with open(full, "r", encoding="utf-8") as f:
                ast.parse(f.read(), filename=full)


if __name__ == "__main__":
    unittest.main()
