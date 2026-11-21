"""
Redis-Backed Sliding/Fixed Window Rate Limiter
==============================================
Protects authentication endpoints from brute-force attacks and heavy compute
endpoints from API abuse in multi-tenant SaaS deployments.
"""

import logging
from typing import Callable, Optional
from fastapi import HTTPException, Request, status

from app import utils
from app.core.config import settings
from app.core.network import get_real_client_ip

logger = logging.getLogger(__name__)


def enforce_rate_limit(
    bucket: str,
    identifier: str,
    max_requests: int,
    window_seconds: int,
) -> None:
    """
    Increment and check a Redis fixed-window counter.
    Fails open if Redis is unreachable so temporary cache issues never block valid traffic.
    """
    if max_requests <= 0 or window_seconds <= 0:
        return

    key = f"ratelimit:{bucket}:{identifier}"
    try:
        r = utils.get_redis_client()
        count = int(r.incr(key))
        if count == 1:
            r.expire(key, window_seconds)
        if count > max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded ({max_requests} requests per {window_seconds}s). Please slow down.",
                headers={"Retry-After": str(window_seconds)},
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.debug(f"[RateLimiter] Redis unavailable for {key}: {e}")


def rate_limit_by_ip(bucket: str, max_requests: int, window_seconds: int) -> Callable:
    """FastAPI dependency factory that rate-limits callers by real client IP."""
    def _dependency(request: Request) -> None:
        client_ip = get_real_client_ip(request, trust_proxy_headers=settings.TRUST_PROXY_HEADERS)
        enforce_rate_limit(bucket, client_ip, max_requests=max_requests, window_seconds=window_seconds)

    return _dependency
