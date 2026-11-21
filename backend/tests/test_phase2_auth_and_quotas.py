import ast
import os
import sys
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

    if "app.core.config" not in sys.modules:
        cfg = types.ModuleType("app.core.config")
        cfg.settings = SimpleNamespace(
            TRUST_PROXY_HEADERS=True,
            REDIS_URL="redis://localhost:6379/0",
        )
        sys.modules["app.core.config"] = cfg

    m = sys.modules.get("app.models")
    if m is None:
        m = types.ModuleType("app.models")
        sys.modules["app.models"] = m

    class _Col:
        def __init__(self, name):
            self.name = name

        def __eq__(self, other):
            return (self.name, other)

    if not hasattr(m, "ApiKey"):
        class ApiKey:
            user_id = _Col("user_id")
        m.ApiKey = ApiKey
    if not hasattr(m, "Bot"):
        class Bot:
            owner_id = _Col("owner_id")
            status = _Col("status")
        m.Bot = Bot
    elif not hasattr(m.Bot, "status"):
        m.Bot.status = _Col("status")
    if not hasattr(m, "GridBot"):
        class GridBot:
            user_id = _Col("user_id")
            is_active = _Col("is_active")
        m.GridBot = GridBot
    if not hasattr(m, "LeadLagBot"):
        class LeadLagBot:
            user_id = _Col("user_id")
            is_active = _Col("is_active")
        m.LeadLagBot = LeadLagBot
    if not hasattr(m, "ArbitrageBot"):
        class ArbitrageBot:
            user_id = _Col("user_id")
            is_active = _Col("is_active")
        m.ArbitrageBot = ArbitrageBot
    if not hasattr(m, "User"):
        class User:
            pass
        m.User = User

    if "app.utils" not in sys.modules:
        u = types.ModuleType("app.utils")
        u.get_redis_client = lambda: MagicMock()
        sys.modules["app.utils"] = u


_install_stubs()

from fastapi import HTTPException  # noqa: E402
from app.core.totp import (  # noqa: E402
    build_otpauth_uri,
    generate_numeric_otp,
    generate_totp_code,
    generate_totp_secret,
    verify_totp_code,
)
from app.core.plans import get_plan_limits, resolve_user_plan_tier  # noqa: E402
from app.core import quotas  # noqa: E402
from app.core.rate_limiter import enforce_rate_limit  # noqa: E402


class TestTotpModule(unittest.TestCase):
    def test_totp_generation_and_verification(self):
        secret = generate_totp_secret()
        self.assertGreaterEqual(len(secret), 20)
        ts = 1700000000
        code = generate_totp_code(secret, for_time=ts)
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())
        self.assertTrue(verify_totp_code(secret, code, for_time=ts))
        self.assertTrue(verify_totp_code(secret, code, for_time=ts + 30, window=1))
        self.assertFalse(verify_totp_code(secret, "000000", for_time=ts) and code != "000000")
        self.assertFalse(verify_totp_code(secret, "abc", for_time=ts))

    def test_otpauth_uri_and_numeric_otp(self):
        uri = build_otpauth_uri("user@example.com", "JBSWY3DPEHPK3PXP")
        self.assertTrue(uri.startswith("otpauth://totp/"))
        self.assertIn("secret=JBSWY3DPEHPK3PXP", uri)
        otp = generate_numeric_otp(6)
        self.assertEqual(len(otp), 6)
        self.assertTrue(otp.isdigit())


class TestPlansAndQuotas(unittest.TestCase):
    def test_plan_resolution_and_owner_bypass(self):
        free_user = SimpleNamespace(id=1, is_superuser=False, is_pro=False, plan_tier="free")
        pro_user = SimpleNamespace(id=2, is_superuser=False, is_pro=True, plan_tier="free")
        owner = SimpleNamespace(id=3, is_superuser=True, is_pro=False, plan_tier="free")

        self.assertEqual(resolve_user_plan_tier(free_user), "free")
        self.assertEqual(resolve_user_plan_tier(pro_user), "pro")
        self.assertEqual(resolve_user_plan_tier(owner), "enterprise")
        self.assertIsNone(get_plan_limits(owner).max_active_bots)
        self.assertEqual(get_plan_limits(free_user).max_active_bots, 1)
        self.assertFalse(get_plan_limits(free_user).ml_training_enabled)
        self.assertTrue(get_plan_limits(pro_user).ml_training_enabled)

    def test_exchange_and_bot_quotas(self):
        free_user = SimpleNamespace(id=10, is_superuser=False, is_pro=False, plan_tier="free")
        owner = SimpleNamespace(id=1, is_superuser=True, is_pro=True, plan_tier="enterprise")

        fake_db = MagicMock()
        fake_db.query.return_value.filter.return_value.count.return_value = 1

        with self.assertRaises(HTTPException) as ctx:
            quotas.check_exchange_quota(fake_db, free_user)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("PLAN_LIMIT_EXCEEDED", ctx.exception.detail)

        # Owner bypasses all quotas
        quotas.check_exchange_quota(fake_db, owner)
        quotas.check_bot_quota(fake_db, owner)
        quotas.check_ml_training_access(owner)

        with self.assertRaises(HTTPException):
            quotas.check_ml_training_access(free_user)

    def test_redis_backtest_and_ai_quotas(self):
        free_user = SimpleNamespace(id=22, is_superuser=False, is_pro=False, plan_tier="free")
        fake_redis = MagicMock()
        store = {}

        def fake_get(k):
            return store.get(k)

        def fake_incr(k):
            store[k] = int(store.get(k, 0)) + 1
            return store[k]

        fake_redis.get.side_effect = fake_get
        fake_redis.incr.side_effect = fake_incr
        quotas.utils.get_redis_client = lambda: fake_redis

        for _ in range(10):
            quotas.check_and_increment_backtest_quota(free_user)
        with self.assertRaises(HTTPException):
            quotas.check_and_increment_backtest_quota(free_user)

        for _ in range(5):
            quotas.check_and_increment_ai_quota(free_user)
        with self.assertRaises(HTTPException):
            quotas.check_and_increment_ai_quota(free_user)


class TestRateLimiter(unittest.TestCase):
    def test_rate_limit_blocks_excess_requests(self):
        import app.core.rate_limiter as rl

        fake_redis = MagicMock()
        counts = {}
        fake_redis.incr.side_effect = lambda k: counts.__setitem__(k, counts.get(k, 0) + 1) or counts[k]
        rl.utils.get_redis_client = lambda: fake_redis

        enforce_rate_limit("login", "1.2.3.4", max_requests=2, window_seconds=60)
        enforce_rate_limit("login", "1.2.3.4", max_requests=2, window_seconds=60)
        with self.assertRaises(HTTPException) as ctx:
            enforce_rate_limit("login", "1.2.3.4", max_requests=2, window_seconds=60)
        self.assertEqual(ctx.exception.status_code, 429)


class TestPhase2FilesCompile(unittest.TestCase):
    def test_phase2_python_files_parse(self):
        files = [
            "app/core/totp.py",
            "app/core/plans.py",
            "app/core/quotas.py",
            "app/core/rate_limiter.py",
            "app/core/owner_bootstrap.py",
            "app/core/config.py",
            "app/core/errors.py",
            "app/models/__init__.py",
            "app/schemas/__init__.py",
            "app/email_utils.py",
            "app/main.py",
            "app/strategies/_registry.py",
            "app/forex/models.py",
            "app/forex/router.py",
            "app/api/v1/endpoints/auth.py",
            "app/api/v1/endpoints/users.py",
            "app/api/v1/endpoints/bots.py",
            "app/api/v1/endpoints/grid_bot.py",
            "app/api/v1/endpoints/lead_lag.py",
            "app/api/v1/endpoints/arbitrage.py",
            "app/api/v1/endpoints/backtest.py",
            "app/api/v1/endpoints/strategies.py",
            "app/api/v1/endpoints/sentiment.py",
            "app/api/v1/endpoints/model_training.py",
            "alembic/versions/e5f6a7b8c9d0_add_phase2_auth_and_plan_fields.py",
        ]
        for rel in files:
            abs_p = os.path.join(BACKEND_ROOT, rel)
            with open(abs_p, encoding="utf-8") as f:
                ast.parse(f.read(), filename=abs_p)


if __name__ == "__main__":
    unittest.main()
