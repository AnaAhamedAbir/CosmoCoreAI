"""
RFC 6238 TOTP Two-Factor Authentication Module
==============================================
Zero-dependency implementation compatible with Google Authenticator, Authy,
and 1Password using standard library `hmac`, `hashlib`, `base64`, and `secrets`.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import List, Optional
from urllib.parse import quote


def generate_totp_secret(num_bytes: int = 20) -> str:
    """Generate a Base32-encoded secret suitable for authenticator apps."""
    raw = secrets.token_bytes(num_bytes)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def _normalize_b32(secret: str) -> bytes:
    cleaned = (secret or "").strip().replace(" ", "").upper()
    if not cleaned:
        raise ValueError("Empty TOTP secret")
    pad_len = (-len(cleaned)) % 8
    return base64.b32decode(cleaned + ("=" * pad_len), casefold=True)


def generate_totp_code(
    secret: str,
    for_time: Optional[int] = None,
    interval: int = 30,
    digits: int = 6,
) -> str:
    """Compute a 6-digit RFC 6238 TOTP code for the given Unix timestamp."""
    key = _normalize_b32(secret)
    ts = int(time.time() if for_time is None else for_time)
    counter = ts // interval
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    otp = binary % (10 ** digits)
    return str(otp).zfill(digits)


def verify_totp_code(
    secret: str,
    code: str,
    window: int = 1,
    interval: int = 30,
    for_time: Optional[int] = None,
) -> bool:
    """
    Verify a 6-digit TOTP code allowing `window` intervals of clock skew.
    Uses constant-time comparison.
    """
    normalized_code = (code or "").strip().replace(" ", "")
    if not normalized_code.isdigit() or len(normalized_code) != 6:
        return False

    ts = int(time.time() if for_time is None else for_time)
    for offset in range(-window, window + 1):
        expected = generate_totp_code(secret, for_time=ts + (offset * interval), interval=interval)
        if hmac.compare_digest(expected, normalized_code):
            return True
    return False


def build_otpauth_uri(email: str, secret: str, issuer: str = "CosmoQuantAI") -> str:
    """Build an `otpauth://totp/...` URI for QR code / authenticator import."""
    safe_issuer = quote(issuer, safe="")
    safe_label = quote(f"{issuer}:{email}", safe=":")
    return (
        f"otpauth://totp/{safe_label}"
        f"?secret={secret}&issuer={safe_issuer}&algorithm=SHA1&digits=6&period=30"
    )


def generate_numeric_otp(digits: int = 6) -> str:
    """Generate a cryptographically random numeric email verification OTP."""
    upper = 10 ** digits
    return str(secrets.randbelow(upper)).zfill(digits)
