import ast
import os
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)


def _install_lightweight_stubs():
    """Install minimal module stubs only when external runtime packages are absent."""
    if "fastapi" not in sys.modules:
        fastapi_mod = types.ModuleType("fastapi")
        fastapi_mod.Request = object
        fastapi_mod.WebSocket = object
        sys.modules["fastapi"] = fastapi_mod

    if "sqlalchemy" not in sys.modules:
        sa_mod = types.ModuleType("sqlalchemy")
        sa_orm = types.ModuleType("sqlalchemy.orm")
        sa_orm.Session = object
        sa_mod.orm = sa_orm
        sys.modules["sqlalchemy"] = sa_mod
        sys.modules["sqlalchemy.orm"] = sa_orm

    if "redis" not in sys.modules:
        redis_mod = types.ModuleType("redis")
        redis_mod.from_url = lambda *a, **kw: MagicMock()
        sys.modules["redis"] = redis_mod

    if "app.core.config" not in sys.modules:
        cfg_mod = types.ModuleType("app.core.config")
        cfg_mod.settings = SimpleNamespace(
            REDIS_URL="redis://localhost:6379/0",
            SECRET_KEY="test-secret-key-for-unit-tests-only",
            ENCRYPTION_KEY="Jq-w5yXp3zQ4R1t2E8y9U0i7O6p5L4k3J2h1G0f9D8s=",
            ALGORITHM="HS256",
            TRUST_PROXY_HEADERS=True,
        )
        sys.modules["app.core.config"] = cfg_mod

    if "app.core.security" not in sys.modules:
        sec_mod = types.ModuleType("app.core.security")
        sec_mod.verify_token = lambda token: None
        sec_mod.get_password_hash = lambda pw: f"hashed:{pw}"
        sys.modules["app.core.security"] = sec_mod

    if "app.crud" not in sys.modules:
        crud_mod = types.ModuleType("app.crud")
        crud_mod.get_user_by_email = lambda db, email: None
        sys.modules["app.crud"] = crud_mod

    if "app.models" not in sys.modules:
        models_mod = types.ModuleType("app.models")

        class _Col:
            def __init__(self, name):
                self.name = name

            def __eq__(self, other):
                return (self.name, other)

        class User:
            id = _Col("id")
            email = _Col("email")
            is_superuser = _Col("is_superuser")
            is_pro = _Col("is_pro")
            is_active = _Col("is_active")

            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class Bot:
            id = _Col("id")
            owner_id = _Col("owner_id")

        models_mod.User = User
        models_mod.Bot = Bot
        sys.modules["app.models"] = models_mod


_install_lightweight_stubs()

from app.core.network import get_real_client_ip  # noqa: E402
from app.core.storage_isolation import (  # noqa: E402
    ensure_within_directory,
    get_user_scoped_dir,
    resolve_user_file_path,
    sanitize_filename,
    sanitize_identifier,
)
from app.core.task_ownership import resolve_user_channel  # noqa: E402
from app.core.ws_auth import extract_ws_token, verify_bot_ownership  # noqa: E402
from app.core.owner_bootstrap import ensure_sole_owner  # noqa: E402


class TestNetworkHelpers(unittest.TestCase):
    def test_proxy_ip_priority(self):
        req = SimpleNamespace(
            headers={
                "CF-Connecting-IP": "198.51.100.2",
                "X-Forwarded-For": "203.0.113.5, 10.0.0.1",
                "X-Real-IP": "10.0.0.2",
            },
            client=SimpleNamespace(host="127.0.0.1"),
        )
        self.assertEqual(get_real_client_ip(req, trust_proxy_headers=True), "198.51.100.2")
        self.assertEqual(get_real_client_ip(req, trust_proxy_headers=False), "127.0.0.1")

    def test_x_forwarded_for_first_hop(self):
        req = SimpleNamespace(
            headers={"X-Forwarded-For": " 203.0.113.9 , 172.18.0.5 "},
            client=SimpleNamespace(host="172.18.0.5"),
        )
        self.assertEqual(get_real_client_ip(req, trust_proxy_headers=True), "203.0.113.9")


class TestStorageIsolation(unittest.TestCase):
    def test_sanitize_blocks_traversal_and_bad_extensions(self):
        for bad in ["../secret.py", "..\\secret.py", "a/b.py", ".hidden.py", "bad\x00.py", "evil.exe"]:
            with self.assertRaises(ValueError):
                sanitize_filename(bad, allowed_extensions=(".py",))

        self.assertEqual(sanitize_filename("my strat.py", allowed_extensions=(".py",)), "my_strat.py")
        self.assertEqual(sanitize_identifier("My Strategy 1"), "My_Strategy_1")

    def test_user_scoped_dir_and_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            user_dir = get_user_scoped_dir(tmp, 42)
            self.assertTrue(user_dir.endswith(os.path.join(tmp, "user_42")))
            self.assertTrue(os.path.isdir(user_dir))

            legacy_file = os.path.join(tmp, "legacy.json")
            with open(legacy_file, "w", encoding="utf-8") as f:
                f.write("{}")

            no_fallback = resolve_user_file_path(tmp, 42, "legacy.json", fallback_shared=False)
            self.assertTrue(no_fallback.startswith(user_dir))

            with_fallback = resolve_user_file_path(tmp, 42, "legacy.json", fallback_shared=True)
            self.assertEqual(os.path.abspath(with_fallback), os.path.abspath(legacy_file))

            with self.assertRaises(ValueError):
                ensure_within_directory(user_dir, os.path.join(tmp, "user_99", "x.py"))


class TestWsAndTaskHelpers(unittest.TestCase):
    def test_extract_ws_token(self):
        ws = SimpleNamespace(
            query_params={"token": "qp-jwt"},
            headers={"authorization": "Bearer hdr-jwt"},
        )
        self.assertEqual(extract_ws_token(ws, "explicit-jwt"), "explicit-jwt")
        self.assertEqual(extract_ws_token(ws, None), "qp-jwt")
        ws_hdr = SimpleNamespace(query_params={}, headers={"authorization": "Bearer hdr-jwt"})
        self.assertEqual(extract_ws_token(ws_hdr, None), "hdr-jwt")

    def test_resolve_user_channel(self):
        self.assertEqual(resolve_user_channel(7), "backtest_user_7")
        self.assertEqual(resolve_user_channel(None), "backtest")

    def test_verify_bot_ownership_query(self):
        fake_db = MagicMock()
        fake_query = MagicMock()
        fake_db.query.return_value = fake_query
        fake_query.filter.return_value.first.return_value = "BOT"

        regular_user = SimpleNamespace(id=5, is_superuser=False)
        res = verify_bot_ownership(fake_db, 10, regular_user)
        self.assertEqual(res, "BOT")
        filter_args = fake_query.filter.call_args[0]
        self.assertEqual(len(filter_args), 2)  # id AND owner_id


class TestOwnerBootstrap(unittest.TestCase):
    def test_blocks_second_owner_unless_demote_enabled(self):
        import app.core.owner_bootstrap as ob

        existing_owner = SimpleNamespace(email="first@example.com", is_superuser=True, is_pro=True, is_active=True)
        fake_db = MagicMock()
        fake_db.query.return_value.filter.return_value.all.return_value = [existing_owner]
        ob.crud.get_user_by_email = lambda db, email: None

        with self.assertRaises(RuntimeError):
            ensure_sole_owner(fake_db, email="second@example.com", password="Secret123!")

        promoted = ensure_sole_owner(
            fake_db, email="second@example.com", password="Secret123!", demote_others=True
        )
        self.assertFalse(existing_owner.is_superuser)
        self.assertTrue(promoted.is_superuser)
        self.assertTrue(promoted.is_pro)


class TestModifiedPythonSyntaxAndSecurity(unittest.TestCase):
    def test_all_modified_backend_files_compile_cleanly(self):
        files = [
            "app/core/config.py",
            "app/core/middleware.py",
            "app/core/network.py",
            "app/core/storage_isolation.py",
            "app/core/ws_auth.py",
            "app/core/task_ownership.py",
            "app/core/owner_bootstrap.py",
            "app/email_utils.py",
            "app/main.py",
            "app/tasks.py",
            "app/schemas/__init__.py",
            "app/api/deps.py",
            "app/api/v1/endpoints/auth.py",
            "app/api/v1/endpoints/system.py",
            "app/api/v1/endpoints/backtest.py",
            "app/api/v1/endpoints/strategies.py",
            "app/api/v1/endpoints/ml_models.py",
            "app/api/v1/endpoints/trading.py",
            "app/api/v1/endpoints/bots.py",
            "app/api/v1/endpoints/sentiment.py",
            "app/api/v1/endpoints/block_trades.py",
            "app/api/v1/endpoints/whale_alerts.py",
            "app/api/v1/endpoints/insider.py",
            "app/api/v1/endpoints/institutional.py",
            "app/api/v1/endpoints/education.py",
            "app/api/v1/endpoints/token_unlocks.py",
            "app/api/v1/endpoints/model_training.py",
            "app/api/v1/endpoints/event_driven.py",
            "app/api/v1/endpoints/portfolio.py",
            "app/api/v1/endpoints/analytics.py",
            "app/services/websocket_manager.py",
            "scripts/bootstrap_owner.py",
        ]
        for rel in files:
            abs_p = os.path.join(BACKEND_ROOT, rel)
            with open(abs_p, encoding="utf-8") as f:
                src = f.read()
            ast.parse(src, filename=abs_p)

    def test_no_hardcoded_gmail_or_wildcard_cors(self):
        with open(os.path.join(BACKEND_ROOT, "app/email_utils.py"), encoding="utf-8") as f:
            email_src = f.read()
        self.assertNotIn("gyqd uzkz hapn entz", email_src)
        self.assertNotIn("abir.ahamed.01931645993@gmail.com", email_src)

        with open(os.path.join(BACKEND_ROOT, "app/main.py"), encoding="utf-8") as f:
            main_src = f.read()
        self.assertNotIn('allow_origins=["*"]', main_src)

        with open(os.path.join(BACKEND_ROOT, "app/core/config.py"), encoding="utf-8") as f:
            cfg_src = f.read()
        self.assertIn(".env.local", cfg_src)
        self.assertNotIn("CosmoCoreAIAbirAnasS", cfg_src)


if __name__ == "__main__":
    unittest.main()
