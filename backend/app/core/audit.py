"""
Immutable Admin Audit Logging Helper
====================================
Records every privileged action taken by the Sole Platform Owner.
"""

import logging
from typing import Optional, Dict, Any
from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.network import get_real_client_ip
from app.models.saas_admin import AdminAuditLog

logger = logging.getLogger(__name__)


def record_admin_action(
    db: Session,
    admin_id: Optional[int],
    action: str,
    target_type: str,
    target_id: Optional[Any] = None,
    request: Optional[Request] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Optional[AdminAuditLog]:
    """Persist an immutable audit log record without crashing the caller on minor errors."""
    ip_addr = (
        get_real_client_ip(request, trust_proxy_headers=settings.TRUST_PROXY_HEADERS)
        if request is not None
        else None
    )
    try:
        entry = AdminAuditLog(
            admin_id=admin_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            ip_address=ip_addr,
            details=details or {},
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry
    except Exception as e:
        logger.warning(f"[AuditLog] Failed to record action {action}: {e}")
        db.rollback()
        return None
