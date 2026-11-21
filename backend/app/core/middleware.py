from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.security import verify_token
from app.core.network import get_real_client_ip
from app.db.session import SessionLocal
from app.models import User
from app.core.config import settings
from app import utils
import logging

logger = logging.getLogger(__name__)


def is_maintenance_exempt_path(path: str) -> bool:
    """Paths that remain reachable even when global maintenance mode is enabled."""
    api = settings.API_V1_STR
    exempt_prefixes = (
        "/docs",
        "/redoc",
        "/metrics",
        "/static",
        f"{api}/auth",
        f"{api}/admin",
        f"{api}/billing/webhook",
        f"{api}/system/health",
        f"{api}/users/me",
    )
    return path.endswith("/openapi.json") or any(path.startswith(prefix) for prefix in exempt_prefixes)


def _get_maintenance_banner() -> tuple[bool, str]:
    """Read maintenance switch & message from Redis safely."""
    try:
        r = utils.get_redis_client()
        flag = r.get("global_maintenance_mode")
        if flag in ("true", b"true"):
            msg = r.get("global_maintenance_message")
            if isinstance(msg, bytes):
                msg = msg.decode("utf-8", errors="ignore")
            return True, (msg or "Platform is currently undergoing scheduled maintenance. Please check back shortly.")
    except Exception:
        pass
    return False, ""


class IPWhitelistMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        maintenance_active, maintenance_msg = _get_maintenance_banner()

        if path.startswith("/docs") or \
           path.startswith("/redoc") or \
           path.endswith("/openapi.json") or \
           path.startswith(f"{settings.API_V1_STR}/auth"):
            return await call_next(request)

        client_ip = get_real_client_ip(request, trust_proxy_headers=settings.TRUST_PROXY_HEADERS)
        auth_header = request.headers.get("Authorization")
        user = None

        if auth_header:
            try:
                parts = auth_header.split()
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
                    payload = verify_token(token)

                    if payload and "sub" in payload:
                        email = payload["sub"]
                        db = SessionLocal()
                        try:
                            user = db.query(User).filter(User.email == email).first()

                            if user and user.is_ip_whitelist_enabled:
                                allowed = user.allowed_ips or []
                                if client_ip not in allowed:
                                    logger.warning(f"BLOCKED IP {client_ip} for user {email}")
                                    return JSONResponse(
                                        status_code=status.HTTP_403_FORBIDDEN,
                                        content={"detail": f"IP Address {client_ip} not authorized. Please disable whitelist or add this IP from an authorized device."}
                                    )
                        finally:
                            db.close()
            except Exception:
                # Let auth dependencies handle invalid/expired tokens normally
                pass

        # Enforce global maintenance mode for non-superuser traffic on protected routes
        if maintenance_active and not is_maintenance_exempt_path(path):
            if not (user and getattr(user, "is_superuser", False)):
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={"detail": maintenance_msg, "maintenance_mode": True},
                )

        return await call_next(request)
