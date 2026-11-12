from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


ALLOWED_SYS_NOTIF_CATEGORIES = (
    "manual_trade",
    "wallhunter",
    "sentiment_news",
    "ml_training",
    "market_alerts",
)

SysNotifCategoryLiteral = Literal[
    "manual_trade",
    "wallhunter",
    "sentiment_news",
    "ml_training",
    "market_alerts",
]

SysNotifSeverityLiteral = Literal["info", "success", "warning", "critical"]


class SystemNotificationOut(BaseModel):
    """Serialized in-app system notification item."""

    id: int
    user_id: Optional[int] = None
    category: str
    event_type: str
    severity: str
    title: str
    message: str
    meta: Dict[str, Any] = Field(default_factory=dict)
    is_read: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UnreadCountsOut(BaseModel):
    """Per-category and total unread notification counts."""

    total: int = 0
    manual_trade: int = 0
    wallhunter: int = 0
    sentiment_news: int = 0
    ml_training: int = 0
    market_alerts: int = 0


class SystemNotificationListResponse(BaseModel):
    """Paginated notification list with unread counters."""

    items: List[SystemNotificationOut]
    unread_counts: UnreadCountsOut
    total: int


class MarkAllReadRequest(BaseModel):
    """Optional category filter for bulk mark-as-read."""

    category: Optional[str] = None


class SysNotifPreferencesSchema(BaseModel):
    """In-app notification user preferences."""

    soundEnabled: bool = True
    toastEnabled: bool = True
    desktopPushEnabled: bool = False
    muteLowImpactNews: bool = False


class ClientEventRequest(BaseModel):
    """Client-submitted notification event payload."""

    category: SysNotifCategoryLiteral = "market_alerts"
    title: str = Field(..., min_length=1, max_length=255)
    message: str = Field(default="")
    event_type: str = Field(default="client_event", max_length=64)
    severity: SysNotifSeverityLiteral = "info"
    meta: Dict[str, Any] = Field(default_factory=dict)
    dedup_key: Optional[str] = Field(default=None, max_length=128)


class ClientEventResponse(BaseModel):
    """Response after persisting a client-submitted notification event."""

    success: bool = True
    notification: Optional[SystemNotificationOut] = None
    unread_counts: UnreadCountsOut


class DailyDigestSummary(BaseModel):
    """Aggregated UTC daily trading and alert summary."""

    date_utc: str
    trades: int = 0
    wins: int = 0
    losses: int = 0
    net_pnl: float = 0.0
    manual_trade_count: int = 0
    wallhunter_count: int = 0


class DailyDigestResponse(BaseModel):
    """Response returned by the daily digest generator endpoint."""

    success: bool = True
    notification: Optional[SystemNotificationOut] = None
    summary: DailyDigestSummary
