"""
Task Ownership & Per-User Task Routing Helpers
==============================================
Tracks which user launched a background Celery task (backtest, optimization,
download, WFA, batch) so status polling, revocation, report downloads, and
WebSocket updates remain strictly isolated per user.
"""

import json
import logging
from typing import Optional

from app import utils

logger = logging.getLogger(__name__)

TASK_OWNER_TTL_SECONDS = 86400  # 24 hours


def _owner_key(task_id: str) -> str:
    return f"task_owner:{task_id}"


def register_task_owner(task_id: str, user_id: int, ttl_seconds: int = TASK_OWNER_TTL_SECONDS) -> None:
    """Persist task_id -> user_id mapping in Redis."""
    if not task_id or not user_id:
        return
    try:
        r = utils.get_redis_client()
        r.set(_owner_key(task_id), str(int(user_id)), ex=ttl_seconds)
    except Exception as e:
        logger.debug(f"[TaskOwnership] Failed to register owner for {task_id}: {e}")


def get_task_owner(task_id: str) -> Optional[int]:
    """Retrieve the owning user_id for a Celery task_id from Redis, if recorded."""
    if not task_id:
        return None
    try:
        r = utils.get_redis_client()
        val = r.get(_owner_key(task_id))
        if val is None:
            return None
        if isinstance(val, bytes):
            val = val.decode("utf-8")
        return int(val)
    except Exception as e:
        logger.debug(f"[TaskOwnership] Failed to read owner for {task_id}: {e}")
        return None


def verify_task_access(task_id: str, user_id: int, is_superuser: bool = False) -> bool:
    """Return True if the user is superuser or owns the task_id."""
    if is_superuser:
        return True
    owner_id = get_task_owner(task_id)
    if owner_id is None:
        return False
    return int(owner_id) == int(user_id)


def resolve_user_channel(user_id: Optional[int]) -> str:
    """Return the user-scoped WebSocket channel name for task updates."""
    if user_id is not None:
        return f"backtest_user_{int(user_id)}"
    return "backtest"
