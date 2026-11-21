import ast
import hashlib
import hmac
import json
import os
import sys
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)


def _install_stubs():
    fa = sys.modules.get("fastapi")
    if fa is None:
        fa = types.ModuleType("fastapi")
        sys.modules["fastapi"] = fa
    if not hasattr(fa, "HTTPException"):
        class HTTPException(Exception):
            def __init__(self, status_code=400, detail="", headers=None):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail
                self.headers = headers or {}
        fa.HTTPException = HTTPException
    if not hasattr(fa, "Request"):
        fa.Request = object
    if not hasattr(fa, "status"):
        fa.status = SimpleNamespace(
            HTTP_400_BAD_REQUEST=400,
            HTTP_403_FORBIDDEN=403,
            HTTP_429_TOO_MANY_REQUESTS=429,
        )

    if "sqlalchemy" not in sys.modules:
        sa = types.ModuleType("sqlalchemy")
        sa_orm = types.ModuleType("sqlalchemy.orm")
        sa_orm.Session = object
        sa.orm = sa_orm
        sys.modules["sqlalchemy"] = sa
        sys.modules["sqlalchemy.orm"] = sa_orm

    if "httpx" not in sys.modules:
        hx = types.ModuleType("httpx")
        hx.AsyncClient = MagicMock()
        sys.modules["httpx"] = hx

    cfg = sys.modules.get("app.core.config")
    if cfg is None:
        cfg = types.ModuleType("app.core.config")
        cfg.settings = SimpleNamespace()
        sys.modules["app.core.config"] = cfg
    defaults = {
        "TRUST_PROXY_HEADERS": True,
        "REDIS_URL": "redis://localhost:6379/0",
        "STRIPE_SECRET_KEY": "",
        "STRIPE_WEBHOOK_SECRET": "",
        "STRIPE_PRICE_ID_PRO_MONTHLY": "",
        "STRIPE_PRICE_ID_PRO_YEARLY": "",
        "NOWPAYMENTS_API_KEY": "",
        "NOWPAYMENTS_IPN_SECRET": "",
        "FRONTEND_URL": "http://localhost:5173",
    }
    for k, v in defaults.items():
        if not hasattr(cfg.settings, k):
            setattr(cfg.settings, k, v)

    m = sys.modules.get("app.models")
    if m is None:
        m = types.ModuleType("app.models")
        sys.modules["app.models"] = m

    if "app.models.saas_admin" not in sys.modules:
        sm = types.ModuleType("app.models.saas_admin")

        class _Col:
            def __init__(self, name):
                self.name = name

            def __eq__(self, other):
                return (self.name, other)

        class AdminAuditLog:
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class Subscription:
            user_id = _Col("user_id")

            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class PaymentTransaction:
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        sm.AdminAuditLog = AdminAuditLog
        sm.Subscription = Subscription
        sm.PaymentTransaction = PaymentTransaction
        sys.modules["app.models.saas_admin"] = sm
        m.AdminAuditLog = AdminAuditLog
        m.Subscription = Subscription
        m.PaymentTransaction = PaymentTransaction

    if "app.core.network" not in sys.modules:
        net = types.ModuleType("app.core.network")
        net.get_client_ip = lambda request: "127.0.0.1"
        sys.modules["app.core.network"] = net

    if "app.core.plans" not in sys.modules:
        pl = types.ModuleType("app.core.plans")
        pl.normalize_plan = lambda p: str(p or "free").strip().lower()
        pl.PLANS = {
            "free": {"max_active_bots": 1},
            "pro": {"max_active_bots": 5},
            "enterprise": {"max_active_bots": 999},
        }
        sys.modules["app.core.plans"] = pl


_install_stubs()

from app.core.audit import record_admin_action  # noqa: E402
from app.services.billing_service import (  # noqa: E402
    apply_plan_change,
    verify_nowpayments_signature,
    verify_stripe_signature,
)


class TestBillingSignatures(unittest.TestCase):
    def test_verify_stripe_signature_valid_tampered_and_expired(self):
        secret = "whsec_test_secret_123"
        payload = b'{"id":"evt_1","type":"checkout.session.completed"}'
        ts = int(time.time())
        signed = f"{ts}.".encode("utf-8") + payload
        digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
        header = f"t={ts},v1={digest}"

        self.assertTrue(verify_stripe_signature(payload, header, secret))
        self.assertFalse(verify_stripe_signature(b'{"id":"evt_tampered"}', header, secret))
        self.assertFalse(verify_stripe_signature(payload, f"t={ts - 1000},v1={digest}", secret, tolerance=300))

    def test_verify_nowpayments_signature_sorted_json(self):
        ipn_secret = "nowpay_secret_xyz"
        payload = {"payment_status": "finished", "order_id": "ord_1", "amount": 29}
        canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        sig = hmac.new(ipn_secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha512).hexdigest()

        self.assertTrue(verify_nowpayments_signature(payload, sig, ipn_secret))
        self.assertFalse(verify_nowpayments_signature({**payload, "amount": 999}, sig, ipn_secret))
        self.assertFalse(verify_nowpayments_signature(payload, "deadbeef", ipn_secret))


class TestPlanChangesAndAudit(unittest.TestCase):
    def test_apply_plan_change_upgrades_and_downgrades_user(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        user = SimpleNamespace(id=7, plan_tier="free")

        sub = apply_plan_change(
            db,
            user,
            "pro",
            status="active",
            provider="stripe",
            billing_cycle="monthly",
            provider_customer_id="cus_1",
            provider_subscription_id="sub_1",
        )
        self.assertEqual(user.plan_tier, "pro")
        self.assertEqual(sub.plan_tier, "pro")
        self.assertEqual(sub.status, "active")
        db.add.assert_called()
        db.commit.assert_called()

        # Canceled subscription reverts user entitlement back to free
        db.query.return_value.filter.return_value.first.return_value = sub
        sub_canceled = apply_plan_change(db, user, "pro", status="canceled", provider="stripe")
        self.assertEqual(user.plan_tier, "free")
        self.assertEqual(sub_canceled.status, "canceled")

    def test_apply_plan_change_rejects_invalid_tier(self):
        db = MagicMock()
        user = SimpleNamespace(id=7, plan_tier="free")
        with self.assertRaises(ValueError):
            apply_plan_change(db, user, "invalid_tier_xyz")

    def test_record_admin_action_persists_and_handles_db_errors(self):
        db = MagicMock()
        req = SimpleNamespace(headers={"user-agent": "UnitTestAgent/1.0"})
        entry = record_admin_action(
            db,
            admin_id=1,
            action="override_plan",
            target_type="user",
            target_id="42",
            request=req,
            details={"new_plan": "pro"},
        )
        self.assertIsNotNone(entry)
        self.assertEqual(entry.admin_id, 1)
        self.assertEqual(entry.action, "override_plan")
        db.add.assert_called_once()
        db.commit.assert_called_once()

        # Failure path rolls back instead of raising
        bad_db = MagicMock()
        bad_db.commit.side_effect = RuntimeError("db offline")
        failed = record_admin_action(bad_db, admin_id=1, action="toggle_maintenance", target_type="system")
        self.assertIsNone(failed)
        bad_db.rollback.assert_called_once()


class TestPhase3SyntaxIntegrity(unittest.TestCase):
    def test_phase3_python_files_parse_cleanly(self):
        rel_paths = [
            "app/models/saas_admin.py",
            "alembic/versions/f6a7b8c9d0e1_add_saas_admin_and_billing_tables.py",
            "alembic/versions/g7b8c9d0e1f2_merge_saas_and_legacy_heads.py",
            "app/core/audit.py",
            "app/core/middleware.py",
            "app/services/billing_service.py",
            "app/api/v1/endpoints/admin.py",
            "app/api/v1/endpoints/billing.py",
            "app/api/v1/endpoints/users.py",
            "app/api/v1/api.py",
            "app/db/base.py",
            "app/core/config.py",
            "app/main.py",
        ]
        for rel in rel_paths:
            full = os.path.join(BACKEND_ROOT, rel)
            self.assertTrue(os.path.exists(full), f"Missing {full}")
            with open(full, "r", encoding="utf-8") as f:
                ast.parse(f.read(), filename=full)


if __name__ == "__main__":
    unittest.main()
