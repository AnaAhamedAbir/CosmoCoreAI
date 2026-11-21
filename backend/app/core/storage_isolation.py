"""
Multi-Tenant Storage & Path Isolation Helpers
=============================================
Prevents path traversal and isolates user-uploaded strategies, ML models,
and backtest data/reports into per-user directories.
"""

import os
import re
from typing import Optional, Sequence


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(
    filename: str,
    allowed_extensions: Optional[Sequence[str]] = None,
) -> str:
    """
    Sanitize an uploaded or requested filename and block traversal attempts.
    Raises ValueError on invalid names or disallowed extensions.
    """
    if not filename or "\x00" in filename:
        raise ValueError("Invalid filename")

    if "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("Path traversal characters are not allowed in filename")

    base = os.path.basename(filename).strip()
    if not base or base in (".", ".."):
        raise ValueError("Invalid filename")

    cleaned = _SAFE_NAME_RE.sub("_", base)
    if not cleaned or cleaned.startswith("."):
        raise ValueError("Invalid filename")

    if allowed_extensions:
        lower = cleaned.lower()
        if not any(lower.endswith(ext.lower()) for ext in allowed_extensions):
            raise ValueError(f"Unsupported file extension. Allowed: {', '.join(allowed_extensions)}")

    return cleaned


def sanitize_identifier(name: str, allow_dots: bool = False) -> str:
    """
    Sanitize a strategy/resource identifier for safe filesystem usage.
    """
    if not name or "\x00" in name:
        raise ValueError("Invalid identifier")
    if "/" in name or "\\" in name or ".." in name:
        raise ValueError("Invalid identifier")

    pattern = r"[^A-Za-z0-9._-]+" if allow_dots else r"[^A-Za-z0-9_-]+"
    cleaned = re.sub(pattern, "_", name.strip())
    cleaned = cleaned.strip("._")
    if not cleaned:
        raise ValueError("Invalid identifier")
    return cleaned


def ensure_within_directory(base_dir: str, target_path: str) -> str:
    """Verify that target_path resolves strictly inside base_dir."""
    abs_base = os.path.abspath(base_dir)
    abs_target = os.path.abspath(target_path)
    if abs_target != abs_base and not abs_target.startswith(abs_base + os.sep):
        raise ValueError("Resolved path escapes base directory")
    return abs_target


def get_user_scoped_dir(base_dir: str, user_id: int, create: bool = True) -> str:
    """Return per-user directory `<base_dir>/user_<id>` safely."""
    if int(user_id) <= 0:
        raise ValueError("Invalid user_id")
    user_dir = os.path.join(base_dir, f"user_{int(user_id)}")
    safe_dir = ensure_within_directory(base_dir, user_dir)
    if create:
        os.makedirs(safe_dir, exist_ok=True)
    return safe_dir


def resolve_user_file_path(
    base_dir: str,
    user_id: int,
    filename: str,
    fallback_shared: bool = False,
    allowed_extensions: Optional[Sequence[str]] = None,
) -> str:
    """
    Resolve a file strictly inside `<base_dir>/user_<id>/<filename>`.
    If fallback_shared=True and the user-scoped file does not exist yet,
    check `<base_dir>/<filename>` for backward-compatible legacy reads.
    """
    safe_name = sanitize_filename(filename, allowed_extensions=allowed_extensions)
    user_dir = get_user_scoped_dir(base_dir, user_id, create=False)
    user_path = ensure_within_directory(user_dir, os.path.join(user_dir, safe_name))
    if os.path.exists(user_path) or not fallback_shared:
        return user_path

    legacy_path = ensure_within_directory(base_dir, os.path.join(base_dir, safe_name))
    if os.path.exists(legacy_path):
        return legacy_path
    return user_path
