import csv
import io
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api import deps
from app.models import User
from app.schemas.system_notification import (
    ClientEventRequest,
    ClientEventResponse,
    DailyDigestResponse,
    MarkAllReadRequest,
    SysNotifPreferencesSchema,
    SystemNotificationListResponse,
    UnreadCountsOut,
)
from app.services.daily_digest_service import DailyDigestService
from app.services.system_notification_service import SystemNotificationService

router = APIRouter()


@router.get("", response_model=SystemNotificationListResponse)
def list_notifications(
    category: Optional[str] = Query(default=None),
    unread_only: bool = Query(default=False),
    severity: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=60, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """List in-app system notifications visible to the authenticated user."""
    return SystemNotificationService.list_notifications(
        db=db,
        user_id=current_user.id,
        category=category,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
        severity=severity,
        search=search,
    )


@router.get("/unread-count", response_model=UnreadCountsOut)
def get_unread_counts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Return unread notification counters per category and total."""
    return SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id)


@router.get("/preferences", response_model=SysNotifPreferencesSchema)
def get_notification_preferences(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Fetch user's in-app notification UI preferences."""
    return SystemNotificationService.get_preferences(db=db, user_id=current_user.id)


@router.put("/preferences", response_model=SysNotifPreferencesSchema)
def update_notification_preferences(
    prefs_in: SysNotifPreferencesSchema,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Update and return user's in-app notification UI preferences."""
    return SystemNotificationService.update_preferences(
        db=db,
        user_id=current_user.id,
        prefs_dict=prefs_in.model_dump(),
    )


@router.post("/client-event", response_model=ClientEventResponse)
def create_client_event_notification(
    payload: ClientEventRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Persist a user-scoped client event notification."""
    notif = SystemNotificationService.emit_sync(
        user_id=current_user.id,
        category=payload.category,
        title=payload.title,
        message=payload.message,
        event_type=payload.event_type,
        severity=payload.severity,
        meta=payload.meta,
        dedup_key=payload.dedup_key,
    )
    return {
        "success": True,
        "notification": notif,
        "unread_counts": SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id),
    }


@router.post("/daily-digest", response_model=DailyDigestResponse)
def generate_daily_digest(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Generate today's UTC summary and emit an in-app daily_digest notification."""
    return DailyDigestService.generate_and_emit(db=db, user_id=current_user.id)


@router.get("/export")
def export_notifications_csv(
    category: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Stream filtered system notifications as a downloadable CSV file."""
    rows = SystemNotificationService.get_export_rows(
        db=db,
        user_id=current_user.id,
        category=category,
        severity=severity,
        search=search,
        limit=limit,
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "created_at", "category", "event_type", "severity", "title", "message", "is_read"])
    for item in rows:
        created_val = item.get("created_at")
        created_str = created_val.isoformat() if hasattr(created_val, "isoformat") else str(created_val or "")
        writer.writerow(
            [
                item.get("id"),
                created_str,
                item.get("category"),
                item.get("event_type"),
                item.get("severity"),
                item.get("title"),
                item.get("message"),
                item.get("is_read"),
            ]
        )

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sys-notifications.csv"'},
    )


@router.post("/read-all")
def mark_all_notifications_read(
    payload: Optional[MarkAllReadRequest] = Body(default=None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Mark all visible notifications (optionally filtered by category) as read."""
    category = payload.category if payload else None
    SystemNotificationService.mark_all_read(db=db, user_id=current_user.id, category=category)
    return {
        "success": True,
        "unread_counts": SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id),
    }


@router.delete("/clear")
def clear_notifications(
    category: Optional[str] = Query(default=None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Dismiss all visible notifications (optionally filtered by category)."""
    SystemNotificationService.clear_notifications(db=db, user_id=current_user.id, category=category)
    return {
        "success": True,
        "unread_counts": SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id),
    }


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Mark a specific notification as read for the authenticated user."""
    ok = SystemNotificationService.mark_read(db=db, user_id=current_user.id, notification_id=notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {
        "success": True,
        "unread_counts": SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id),
    }


@router.delete("/{notification_id}")
def dismiss_notification(
    notification_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Dismiss a single notification for the authenticated user."""
    ok = SystemNotificationService.dismiss_notification(
        db=db, user_id=current_user.id, notification_id=notification_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {
        "success": True,
        "unread_counts": SystemNotificationService.get_unread_counts(db=db, user_id=current_user.id),
    }
