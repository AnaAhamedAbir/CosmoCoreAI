"""
WebSocket Authentication & Multi-Tenant Authorization Helpers
=============================================================
Centralized JWT verification and resource ownership checks for WebSocket endpoints.
"""

import logging
from typing import Optional, Any
from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.core import security
from app import crud, models

logger = logging.getLogger(__name__)


def extract_ws_token(websocket: WebSocket, query_token: Optional[str] = None) -> Optional[str]:
    """Extract JWT token from ?token=... query parameter or Authorization Bearer header."""
    if query_token and query_token.strip():
        return query_token.strip()

    qp_token = websocket.query_params.get("token")
    if qp_token and qp_token.strip():
        return qp_token.strip()

    auth_header = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
            return parts[1].strip()

    return None


async def authenticate_websocket(
    websocket: WebSocket,
    db: Session,
    query_token: Optional[str] = None,
    require_superuser: bool = False,
) -> Optional[models.User]:
    """
    Verify JWT token for a WebSocket connection before accepting or streaming data.
    Closes the socket with 4001 (unauthenticated) or 4003 (forbidden) on failure.
    """
    token = extract_ws_token(websocket, query_token)
    if not token:
        await websocket.close(code=4001, reason="Authentication token required")
        return None

    payload = security.verify_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return None

    user = None
    email = payload.get("sub")
    if email:
        user = crud.get_user_by_email(db, email=email)
    elif payload.get("user_id") is not None:
        try:
            uid = int(payload.get("user_id"))
            user = db.query(models.User).filter(models.User.id == uid).first()
        except (ValueError, TypeError):
            user = None

    if not user or not user.is_active:
        await websocket.close(code=4001, reason="Inactive or unknown user")
        return None

    if require_superuser and not user.is_superuser:
        await websocket.close(code=4003, reason="Owner/Superuser privileges required")
        return None

    return user


def verify_bot_ownership(
    db: Session,
    bot_id: int,
    user: models.User,
    model_cls: Any = None,
    owner_field: str = "owner_id",
) -> Optional[Any]:
    """
    Confirm the authenticated user owns the target bot (or is superuser).
    Supports both `Bot` (owner_id) and `GridBot` / `LeadLagBot` (user_id).
    """
    if model_cls is None:
        model_cls = models.Bot

    if user.is_superuser:
        return db.query(model_cls).filter(model_cls.id == bot_id).first()

    owner_col = getattr(model_cls, owner_field)
    return db.query(model_cls).filter(
        model_cls.id == bot_id,
        owner_col == user.id,
    ).first()
