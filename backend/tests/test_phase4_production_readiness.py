import os
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_ROOT = os.path.join(REPO_ROOT, "backend")
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from tests.test_phase3_admin_and_billing import _install_stubs  # noqa: E402

_install_stubs()

# Ensure additional stubs needed by app.core.middleware exist when running standalone
import types  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

for mod_name, attrs in (
    ("starlette", {}),
    ("starlette.middleware", {}),
    ("starlette.middleware.base", {"BaseHTTPMiddleware": object}),
    ("fastapi.responses", {"JSONResponse": MagicMock()}),
    ("app.core.security", {"verify_token": lambda token: None}),
    ("app.db", {}),
    ("app.db.session", {"SessionLocal": MagicMock()}),
    ("app", {}),
):
    if mod_name not in sys.modules:
        m = types.ModuleType(mod_name)
        for k, v in attrs.items():
            setattr(m, k, v)
        sys.modules[mod_name] = m

cfg = sys.modules["app.core.config"]
if not hasattr(cfg.settings, "API_V1_STR"):
    cfg.settings.API_V1_STR = "/api/v1"

net = sys.modules["app.core.network"]
if not hasattr(net, "get_real_client_ip"):
    net.get_real_client_ip = lambda req, trust_proxy_headers=True: "127.0.0.1"

if not hasattr(sys.modules["app"], "utils"):
    sys.modules["app"].utils = sys.modules.get("app.utils", MagicMock())

from app.core.middleware import is_maintenance_exempt_path  # noqa: E402


class TestPhase4ProductionReadiness(unittest.TestCase):
    def test_production_deployment_files_and_hardening(self):
        prod_compose = os.path.join(REPO_ROOT, "docker-compose.prod.yml")
        prod_nginx = os.path.join(REPO_ROOT, "nginx", "nginx.prod.conf")
        deploy_guide = os.path.join(REPO_ROOT, "DEPLOY_GUIDE.md")
        legal_page = os.path.join(REPO_ROOT, "frontend", "src", "pages", "public", "LegalPage.tsx")
        maint_overlay = os.path.join(REPO_ROOT, "frontend", "src", "components", "common", "MaintenanceOverlay.tsx")

        for f in (prod_compose, prod_nginx, deploy_guide, legal_page, maint_overlay):
            self.assertTrue(os.path.exists(f), f"Missing Phase 4 file: {f}")

        with open(prod_compose, "r", encoding="utf-8") as f:
            compose_txt = f.read()
        self.assertIn("ENVIRONMENT=production", compose_txt)
        self.assertIn("ports: !reset []", compose_txt)

        with open(prod_nginx, "r", encoding="utf-8") as f:
            nginx_txt = f.read()
        self.assertIn("server_tokens off;", nginx_txt)
        self.assertIn("X-Frame-Options", nginx_txt)
        self.assertIn("X-Content-Type-Options", nginx_txt)

    def test_index_html_clean_csp_and_seo_meta(self):
        idx = os.path.join(REPO_ROOT, "frontend", "index.html")
        with open(idx, "r", encoding="utf-8") as f:
            html = f.read()
        self.assertNotIn("95.111.255.126", html)
        self.assertIn('name="description"', html)
        self.assertIn('property="og:title"', html)
        self.assertIn("wss:", html)

    def test_maintenance_mode_exempt_paths(self):
        self.assertTrue(is_maintenance_exempt_path("/api/v1/auth/login"))
        self.assertTrue(is_maintenance_exempt_path("/api/v1/admin/overview"))
        self.assertTrue(is_maintenance_exempt_path("/api/v1/billing/webhook/stripe"))
        self.assertTrue(is_maintenance_exempt_path("/api/v1/system/health"))
        self.assertFalse(is_maintenance_exempt_path("/api/v1/bots"))
        self.assertFalse(is_maintenance_exempt_path("/api/v1/trading/execute"))


if __name__ == "__main__":
    unittest.main()
