"""
Network & Proxy IP Helpers
==========================
Resolves the real client IP behind reverse proxies (Nginx / Cloudflare / Load Balancers)
for accurate IP Whitelisting, Rate Limiting, and Security Audit Logs.
"""

from typing import Optional
from fastapi import Request


def get_real_client_ip(request: Request, trust_proxy_headers: bool = True) -> str:
    """
    Return the client IP address, honoring reverse proxy headers safely.

    Anti-spoofing priority when trust_proxy_headers=True:
    1. CF-Connecting-IP (ONLY when settings.TRUST_CLOUDFLARE_HEADER is explicitly enabled)
    2. X-Real-IP (set directly by our Nginx reverse proxy from TCP $remote_addr)
    3. X-Forwarded-For (right-most non-empty hop appended by our trusted proxy)
    4. request.client.host
    """
    if trust_proxy_headers:
        from app.core.config import settings

        if getattr(settings, "TRUST_CLOUDFLARE_HEADER", False):
            cf_ip = request.headers.get("CF-Connecting-IP")
            if cf_ip and cf_ip.strip():
                return cf_ip.strip()

        x_real_ip = request.headers.get("X-Real-IP")
        if x_real_ip and x_real_ip.strip():
            return x_real_ip.strip()

        x_forwarded_for = request.headers.get("X-Forwarded-For")
        if x_forwarded_for:
            hops = [h.strip() for h in x_forwarded_for.split(",") if h.strip()]
            if hops:
                return hops[-1]

    client = getattr(request, "client", None)
    host: Optional[str] = getattr(client, "host", None) if client else None
    return host or "unknown"
