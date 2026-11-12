from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.db.base_class import Base


class SystemNotification(Base):
    """Persistent in-app system notification (private user event or global broadcast)."""

    __tablename__ = "system_notifications"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    category = Column(String(32), nullable=False, index=True)  # 'manual_trade' | 'wallhunter' | 'sentiment_news'
    event_type = Column(String(64), nullable=False, default="info")
    severity = Column(String(16), nullable=False, default="info")  # 'info' | 'success' | 'warning' | 'critical'
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    meta = Column(JSON, nullable=False, default=dict)
    dedup_key = Column(String(128), nullable=True, index=True)
    is_read = Column(Boolean, nullable=False, default=False)
    is_dismissed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class SystemNotificationUserState(Base):
    """Per-user read and dismissed state for global (user_id IS NULL) notifications."""

    __tablename__ = "system_notification_user_states"
    __table_args__ = {"extend_existing": True}

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notification_id = Column(Integer, ForeignKey("system_notifications.id", ondelete="CASCADE"), primary_key=True)
    is_read = Column(Boolean, nullable=False, default=False)
    is_dismissed = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
