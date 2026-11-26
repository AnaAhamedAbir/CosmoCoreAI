import asyncio
import logging
import time
from typing import Optional, Tuple

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import utils
from app.core.config import settings
from app.core.network import get_real_client_ip
from app.core.redis import redis_manager
from app.core.security import verify_token
from app.db.session import SessionLocal
from app.models import User

logger = logging.getLogger(__name__)

# Short-lived in-memory caches so hot HTTP routes never stall the event loop on Redis/DB
_MAINT_CACHE_TTL_SEC = 2.0
_maint_cache_ts: float = 0.0
_maint_cache_val: Tuple[bool, str] = (False, "")

_USER_ACL_CACHE_TTL_SEC = 5.0
# email -> (monotonic_ts, is_ip_whitelist_enabled, tuple(allowed_ips), is_superuser)
_user_acl_cache: dict[str, Tuple[float, bool, Tuple[str, ...], bool]] = {}
_USER_ACL_CACHE_MAX = 1024


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
        f"{api}/system/update-status",
        f"{api}/system/ping",
        f"{api}/users/me",
    )
    return path.endswith("/openapi.json") or any(path.startswith(prefix) for prefix in exempt_prefixes)


def _is_fast_bypass_path(path: str) -> bool:
    """Public ultra-lightweight probe paths that must bypass Redis/DB middleware overhead."""
    api = settings.API_V1_STR
    return (
        path.startswith("/docs")
        or path.startswith("/redoc")
        or path.endswith("/openapi.json")
        or path.startswith(f"{api}/auth")
        or path == f"{api}/system/ping"
        or path == f"{api}/system/update-status"
        or path == f"{api}/system/health"
    )


def _get_maintenance_banner() -> tuple[bool, str]:
    """Read maintenance switch & message from sync Redis safely (fallback / sync callers)."""
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


async def _get_maintenance_banner_async() -> tuple[bool, str]:
    """Non-blocking maintenance check backed by async Redis + 2s in-memory TTL cache."""
    global _maint_cache_ts, _maint_cache_val
    now = time.monotonic()
    if (now - _maint_cache_ts) < _MAINT_CACHE_TTL_SEC:
        return _maint_cache_val

    result: Tuple[bool, str] = (False, "")
    try:
        async_r = redis_manager.get_redis()
        if async_r is not None:
            flag = await async_r.get("global_maintenance_mode")
            if flag in ("true", b"true"):
                msg = await async_r.get("global_maintenance_message")
                if isinstance(msg, bytes):
                    msg = msg.decode("utf-8", errors="ignore")
                result = (
                    True,
                    msg or "Platform is currently undergoing scheduled maintenance. Please check back shortly.",
                )
        else:
            result = await asyncio.to_thread(_get_maintenance_banner)
    except Exception:
        result = (False, "")

    _maint_cache_val = result
    _maint_cache_ts = now
    return result


def _fetch_user_acl_sync(email: str) -> Optional[Tuple[bool, Tuple[str, ...], bool]]:
    """Run short-lived DB query in a worker thread to avoid blocking the asyncio event loop."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            return None
        allowed = tuple(user.allowed_ips or ())
        return (
            bool(getattr(user, "is_ip_whitelist_enabled", False)),
            allowed,
            bool(getattr(user, "is_superuser", False)),
        )
    finally:
        db.close()


async def _get_user_acl(email: str) -> Optional[Tuple[bool, Tuple[str, ...], bool]]:
    now = time.monotonic()
    cached = _user_acl_cache.get(email)
    if cached is not None and (now - cached[0]) < _USER_ACL_CACHE_TTL_SEC:
        return (cached[1], cached[2], cached[3])

    acl = await asyncio.to_thread(_fetch_user_acl_sync, email)
    if acl is not None:
        if len(_user_acl_cache) >= _USER_ACL_CACHE_MAX:
            _user_acl_cache.clear()
        _user_acl_cache[email] = (now, acl[0], acl[1], acl[2])
    return acl


class IPWhitelistMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path

        # Fast-path bypass: never add Redis/PostgreSQL latency to ping, health, update-status, or auth
        if _is_fast_bypass_path(path):
            return await call_next(request)

        maintenance_active, maintenance_msg = await _get_maintenance_banner_async()

        client_ip = get_real_client_ip(request, trust_proxy_headers=settings.TRUST_PROXY_HEADERS)
        auth_header = request.headers.get("Authorization")
        is_superuser = False

        if auth_header:
            try:
                parts = auth_header.split()
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
                    payload = verify_token(token)

                    if payload and "sub" in payload:
                        email = payload["sub"]
                        acl = await _get_user_acl(email)
                        if acl is not None:
                            ip_whitelist_enabled, allowed_ips, is_superuser = acl
                            if ip_whitelist_enabled and client_ip not in allowed_ips:
                                logger.warning(f"BLOCKED IP {client_ip} for user {email}")
                                return JSONResponse(
                                    status_code=status.HTTP_403_FORBIDDEN,
                                    content={
                                        "detail": (
                                            f"IP Address {client_ip} not authorized. "
                                            "Please disable whitelist or add this IP from an authorized device."
                                        )
                                    },
                                )
            except Exception:
                # Let auth dependencies handle invalid/expired tokens normally
                pass

        # Enforce global maintenance mode for non-superuser traffic on protected routes
        if maintenance_active and not is_maintenance_exempt_path(path):
            if not is_superuser:
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={"detail": maintenance_msg, "maintenance_mode": True},
                )

        return await call_next(request)
