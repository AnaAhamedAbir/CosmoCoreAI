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
    Return the client IP address, honoring reverse proxy headers when enabled.

    Priority when trust_proxy_headers=True:
    1. CF-Connecting-IP (Cloudflare)
    2. X-Forwarded-For (left-most non-empty IP)
    3. X-Real-IP
    4. request.client.host
    """
    if trust_proxy_headers:
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip and cf_ip.strip():
            return cf_ip.strip()

        x_forwarded_for = request.headers.get("X-Forwarded-For")
        if x_forwarded_for:
            first_ip = x_forwarded_for.split(",")[0].strip()
            if first_ip:
                return first_ip

        x_real_ip = request.headers.get("X-Real-IP")
        if x_real_ip and x_real_ip.strip():
            return x_real_ip.strip()

    client = getattr(request, "client", None)
    host: Optional[str] = getattr(client, "host", None) if client else None
    return host or "unknown"
