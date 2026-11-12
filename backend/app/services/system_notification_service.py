import asyncio
import html
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.notification import NotificationSettings
from app.models.system_notification import SystemNotification, SystemNotificationUserState

logger = logging.getLogger(__name__)

_APP_NOTIFICATIONS_CHANNEL = "app_notifications"
_DEDUP_TTL_SECONDS = 172800  # 48 hours
_SEPARATOR_LINE_RE = re.compile(r"^[\s━─═╔╗╚╝║\-_=*]+$")
_HTML_TAG_RE = re.compile(r"<[^>]+>")

SUPPORTED_CATEGORIES = (
    "manual_trade",
    "wallhunter",
    "sentiment_news",
    "ml_training",
    "market_alerts",
)

DEFAULT_IN_APP_PREFS: Dict[str, bool] = {
    "soundEnabled": True,
    "toastEnabled": True,
    "desktopPushEnabled": False,
    "muteLowImpactNews": False,
}

_AUTH_ERROR_KEYWORDS = (
    "authenticationerror",
    "invalid api-key",
    "invalid apikey",
    "api-key format invalid",
    "invalid signature",
    "signature for this request is not valid",
    "invalidnonce",
    "permissiondenied",
    "api key expired",
    "api-key permissions",
    "invalid key",
    "unauthenticated",
    "-2015",
    "-2014",
    "-1022",
    "-1021",
)


def is_exchange_auth_error(exc: Exception) -> bool:
    """Detect whether an exception represents an exchange API key/auth/nonce/permission failure."""
    try:
        import ccxt  # local import so unit tests without ccxt still work

        auth_classes = tuple(
            cls
            for cls in (
                getattr(ccxt, "AuthenticationError", None),
                getattr(ccxt, "InvalidNonce", None),
                getattr(ccxt, "PermissionDenied", None),
            )
            if isinstance(cls, type)
        )
        if auth_classes and isinstance(exc, auth_classes):
            return True
    except Exception:
        pass

    err_lower = str(exc or "").lower()
    return any(kw in err_lower for kw in _AUTH_ERROR_KEYWORDS)


def _strip_telegram_formatting(raw_msg: str) -> List[str]:
    """Strip HTML/Telegram Markdown formatting and box-drawing separator lines."""
    if not raw_msg:
        return []

    text = _HTML_TAG_RE.sub("", str(raw_msg))
    text = html.unescape(text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\*([^*\n]+)\*", r"\1", text)
    text = re.sub(r"(^|(?<=\s))_([^_\n]+)_((?=\s)|$)", r"\1\2\3", text)

    cleaned_lines: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip().strip("║╔╗╚╝━─═").strip()
        if not line or _SEPARATOR_LINE_RE.match(line):
            continue
        cleaned_lines.append(line)
    return cleaned_lines


def _infer_severity(upper_text: str) -> str:
    """Infer notification severity from cleaned uppercase text."""
    if any(
        kw in upper_text
        for kw in (
            "FAILED",
            "CRITICAL",
            "EMERGENCY",
            "STOPPED OUT",
            "REJECTED",
            "STOP-LOSS EXECUTED",
        )
    ):
        return "critical"
    if any(
        kw in upper_text
        for kw in (
            "CANCELLED",
            "CANCELED",
            "EXPIRED",
            "WARNING",
            "STOPPED",
            "SESSION ENDED",
            "AUTO-STOP",
            "LIQUIDATION",
            "WHALE",
            "DRIFT",
            "⚠️",
        )
    ):
        return "warning"
    if any(
        kw in upper_text
        for kw in (
            "TP HIT",
            "TAKE-PROFIT HIT",
            "PARTIAL TP1 HIT",
            "FILLED",
            "ACTIVATED",
            "RECOVERED",
            "BREAKEVEN",
            "BREAK-EVEN",
            "PROFIT",
            "RISK-FREE",
        )
    ):
        return "success"
    return "info"


def _infer_event_type(upper_text: str, category: str) -> str:
    """Infer structured event_type from cleaned uppercase text and category."""
    if category == "sentiment_news":
        return "market_news"

    if category == "ml_training":
        if "DRIFT" in upper_text:
            return "model_drift"
        if "AUTO-RETRAIN" in upper_text or "AUTO RETRAIN" in upper_text:
            return "auto_retrain"
        if "CANCELLED" in upper_text or "CANCELED" in upper_text:
            return "job_cancelled"
        if "PAUSED" in upper_text:
            return "job_paused"
        if "RESUMED" in upper_text:
            return "job_resumed"
        if any(kw in upper_text for kw in ("L2", "HYBRID", "COLLECTOR", "SCRAP")):
            return "collector_done"
        if "DATASET" in upper_text or "MERGE" in upper_text:
            return "dataset_merged"
        if any(kw in upper_text for kw in ("FAILED", "ERROR", "CRITICAL")):
            return "job_failed"
        if "COMPLETED" in upper_text or "COMPLETE" in upper_text:
            return "job_completed"
        return "ml_training_event"

    if category == "market_alerts":
        if "LIQUIDATION" in upper_text:
            return "liquidation_alert"
        if "WHALE" in upper_text:
            return "whale_alert"
        if "DIGEST" in upper_text:
            return "daily_digest"
        if any(kw in upper_text for kw in ("API KEY", "AUTHENTICATION", "PERMISSION", "NONCE", "API HEALTH")):
            return "api_health"
        if any(kw in upper_text for kw in ("BACKTEST", "OPTIMIZATION", "WALK-FORWARD", "BATCH")):
            if any(kw in upper_text for kw in ("FAILED", "ERROR", "CRITICAL")):
                return "backtest_failed"
            return "backtest_done"
        return "market_alert_event"

    if category == "wallhunter":
        if "BOT ACTIVATED" in upper_text or "STARTED!" in upper_text:
            return "bot_started"
        if "SESSION ENDED" in upper_text:
            return "session_ended"
        if "SESSION STARTED" in upper_text:
            return "session_started"
        if "SESSION WAITING" in upper_text:
            return "session_waiting"
        if "BOT STOPPED" in upper_text or "AUTO-STOPPED" in upper_text:
            return "bot_stopped"
        if "LIVE CONFIG UPDATE" in upper_text:
            return "config_updated"
        if "SEQUENCE RECOVERED" in upper_text:
            return "sequence_recovered"
        if "TA SNAPSHOT" in upper_text:
            return "ta_snapshot"
        if "EMERGENCY EXIT" in upper_text:
            return "emergency_exit"
        if "PARTIAL TP" in upper_text:
            return "partial_tp"
        if "RISK-FREE" in upper_text:
            return "breakeven"
        if "STOPPED OUT" in upper_text:
            return "sl_exit"
        if "EXIT" in upper_text or "CLOSED" in upper_text:
            return "trade_exit"
        if "ENTERED" in upper_text:
            return "trade_entry"
        if any(kw in upper_text for kw in ("FAILED", "ERROR", "CRITICAL")):
            return "bot_error"
        return "wallhunter_event"

    # manual_trade
    if "TAKE-PROFIT HIT" in upper_text or "TP HIT" in upper_text:
        return "tp_hit"
    if "STOP-LOSS EXECUTED" in upper_text:
        return "sl_hit"
    if "BREAK-EVEN" in upper_text or "BREAKEVEN" in upper_text:
        return "breakeven"
    if "FAILED" in upper_text or "REJECTED" in upper_text:
        return "order_failed"
    if "CIRCUIT BREAKER" in upper_text:
        return "circuit_breaker"
    if any(kw in upper_text for kw in ("CANCELLED", "CANCELED", "EXPIRED", "STOPPED MANUALLY")):
        return "order_cancelled"
    if "MODIFIED" in upper_text or "CONSOLIDATED TP UPDATED" in upper_text:
        return "order_modified"
    if "FILLED" in upper_text:
        return "order_filled"
    if any(kw in upper_text for kw in ("TAKE-PROFIT ORDER PLACED", "NATIVE OCO PLACED", "TRAILING SL", "BRACKET SL")):
        return "bracket_placed"
    if "MARKETCLOSE" in upper_text or "POSITION CLOSED" in upper_text:
        return "position_closed"
    if any(kw in upper_text for kw in ("FIRED", "PLACED", "INITIATED")):
        return "order_placed"
    return "manual_trade_event"


def _parse_numeric(raw_val: str) -> Optional[float]:
    """Parse a currency/numeric token like '-$12.34' or '1,234.56' into float."""
    if not raw_val:
        return None
    cleaned = raw_val.replace(",", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _extract_meta(full_text: str) -> Dict[str, Any]:
    """Extract structured metadata fields (symbol, bot_id, exchange, pnl, price) if present."""
    meta: Dict[str, Any] = {}

    sym_match = re.search(r"(?:Pair|Symbol)\s*:\s*([A-Za-z0-9/_:-]+)", full_text, re.IGNORECASE)
    if sym_match:
        meta["symbol"] = sym_match.group(1).strip()

    bot_match = re.search(
        r"(?:Bot\s*ID\s*[:#]?|BOT\s+ACTIVATED\s*:\s*ID|Bot\s*#|\[ID\s*[:#]?)\s*(\d+)",
        full_text,
        re.IGNORECASE,
    )
    if bot_match:
        try:
            meta["bot_id"] = int(bot_match.group(1))
        except ValueError:
            pass

    ex_match = re.search(r"Exchange\s*:\s*([A-Za-z0-9 _-]+)", full_text, re.IGNORECASE)
    if ex_match:
        meta["exchange"] = ex_match.group(1).strip()

    pnl_match = re.search(
        r"(?:Trade PnL|Total Net PnL|Net PnL|Est\.\s*Net Profit|Locked Profit|Secured PnL)\s*:\s*([+-]?\$?[0-9,]+(?:\.[0-9]+)?)",
        full_text,
        re.IGNORECASE,
    )
    if pnl_match:
        pnl_val = _parse_numeric(pnl_match.group(1))
        if pnl_val is not None:
            meta["pnl"] = pnl_val

    price_match = re.search(
        r"(?:Entry Price|Exit Price|Limit Price|New Price|New Trigger Price|Stop Price|TP Target Price|Avg Fill Price|Price)\s*:\s*\$?([0-9,]+(?:\.[0-9]+)?)",
        full_text,
        re.IGNORECASE,
    )
    if price_match:
        px_val = _parse_numeric(price_match.group(1))
        if px_val is not None:
            meta["price"] = px_val

    return meta


def parse_telegram_message_to_notification(raw_msg: str, category: str) -> Dict[str, Any]:
    """Convert a Telegram-formatted message into a clean structured notification dict."""
    lines = _strip_telegram_formatting(raw_msg)
    if not lines:
        return {
            "title": "System Notification",
            "message": "",
            "severity": "info",
            "event_type": "info",
            "meta": {},
        }

    title = lines[0].lstrip("#* ").strip()[:255] or "System Notification"
    body_lines = lines[1:]
    message = "\n".join(body_lines) if body_lines else title
    full_text = "\n".join(lines)
    upper_text = full_text.upper()

    return {
        "title": title,
        "message": message,
        "severity": _infer_severity(upper_text),
        "event_type": _infer_event_type(upper_text, category),
        "meta": _extract_meta(full_text),
    }


def _get_sync_redis():
    """Create a short-timeout synchronous Redis client, or return None if unavailable."""
    try:
        import redis as sync_redis

        return sync_redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
        )
    except Exception:
        return None


def _redis_claim_dedup(dedup_key: str) -> Optional[bool]:
    """Claim a dedup key in Redis via SET NX EX. Returns True if claimed, False if duplicate, None if Redis unavailable."""
    client = _get_sync_redis()
    if not client:
        return None
    try:
        result = client.set(f"sysnotif:dedup:{dedup_key}", "1", nx=True, ex=_DEDUP_TTL_SECONDS)
        return bool(result)
    except Exception:
        return None
    finally:
        try:
            client.close()
        except Exception:
            pass


def _redis_publish_notification(payload_str: str) -> None:
    """Publish a serialized sys_notification payload to Redis pub/sub."""
    client = _get_sync_redis()
    if not client:
        return
    try:
        client.publish(_APP_NOTIFICATIONS_CHANNEL, payload_str)
    except Exception as pub_err:
        logger.debug(f"[SysNotif] Redis publish skipped (non-fatal): {pub_err}")
    finally:
        try:
            client.close()
        except Exception:
            pass


class SystemNotificationService:
    """Service for emitting, deduplicating, querying, and managing in-app system notifications."""

    @staticmethod
    def _persist_notification(
        user_id: Optional[int],
        category: str,
        title: str,
        message: str,
        event_type: str = "info",
        severity: str = "info",
        meta: Optional[Dict[str, Any]] = None,
        dedup_key: Optional[str] = None,
        check_db_dedup: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """Persist notification in a dedicated short-lived DB session and return serialized dict."""
        db = SessionLocal()
        try:
            if dedup_key and check_db_dedup:
                existing = (
                    db.query(SystemNotification.id)
                    .filter(SystemNotification.dedup_key == dedup_key[:128])
                    .first()
                )
                if existing:
                    return None

            notif = SystemNotification(
                user_id=user_id,
                category=(category or "manual_trade")[:32],
                event_type=(event_type or "info")[:64],
                severity=(severity or "info")[:16],
                title=(title or "System Notification")[:255],
                message=message if message is not None else "",
                meta=dict(meta) if meta else {},
                dedup_key=dedup_key[:128] if dedup_key else None,
                is_read=False,
                is_dismissed=False,
            )
            db.add(notif)
            db.commit()
            db.refresh(notif)

            created_iso = (
                notif.created_at.isoformat()
                if notif.created_at is not None
                else datetime.now(timezone.utc).isoformat()
            )
            return {
                "id": notif.id,
                "user_id": notif.user_id,
                "category": notif.category,
                "event_type": notif.event_type,
                "severity": notif.severity,
                "title": notif.title,
                "message": notif.message,
                "meta": notif.meta or {},
                "is_read": bool(notif.is_read),
                "created_at": created_iso,
            }
        finally:
            db.close()

    @staticmethod
    async def emit(
        user_id: Optional[int],
        category: str,
        title: str,
        message: str,
        event_type: str = "info",
        severity: str = "info",
        meta: Optional[Dict[str, Any]] = None,
        dedup_key: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Async emit: deduplicate, persist to DB, and broadcast via Redis pub/sub safely."""
        try:
            if dedup_key:
                claimed = await asyncio.to_thread(_redis_claim_dedup, dedup_key)
                if claimed is False:
                    return None

            notif_dict = SystemNotificationService._persist_notification(
                user_id=user_id,
                category=category,
                title=title,
                message=message,
                event_type=event_type,
                severity=severity,
                meta=meta,
                dedup_key=dedup_key,
                check_db_dedup=bool(dedup_key),
            )
            if not notif_dict:
                return None

            payload_str = json.dumps(
                {
                    "type": "sys_notification",
                    "target_user_id": user_id,
                    "notification": notif_dict,
                }
            )
            await asyncio.to_thread(_redis_publish_notification, payload_str)
            return notif_dict
        except Exception as exc:
            logger.debug(f"[SysNotif] emit failed (non-fatal): {exc}")
            return None

    @staticmethod
    def emit_sync(
        user_id: Optional[int],
        category: str,
        title: str,
        message: str,
        event_type: str = "info",
        severity: str = "info",
        meta: Optional[Dict[str, Any]] = None,
        dedup_key: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Synchronous emit wrapper for Celery workers and sync contexts."""
        try:
            if dedup_key:
                claimed = _redis_claim_dedup(dedup_key)
                if claimed is False:
                    return None

            notif_dict = SystemNotificationService._persist_notification(
                user_id=user_id,
                category=category,
                title=title,
                message=message,
                event_type=event_type,
                severity=severity,
                meta=meta,
                dedup_key=dedup_key,
                check_db_dedup=bool(dedup_key),
            )
            if not notif_dict:
                return None

            payload_str = json.dumps(
                {
                    "type": "sys_notification",
                    "target_user_id": user_id,
                    "notification": notif_dict,
                }
            )
            _redis_publish_notification(payload_str)
            return notif_dict
        except Exception as exc:
            logger.debug(f"[SysNotif] emit_sync failed (non-fatal): {exc}")
            return None

    @staticmethod
    async def emit_from_telegram(
        user_id: Optional[int],
        category: str,
        raw_message: str,
        event_type: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
        severity: Optional[str] = None,
        title: Optional[str] = None,
        dedup_key: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Parse a raw Telegram message into structured fields and emit an in-app notification."""
        try:
            parsed = parse_telegram_message_to_notification(raw_message, category)
            merged_meta = dict(parsed.get("meta") or {})
            if meta:
                merged_meta.update(meta)

            return await SystemNotificationService.emit(
                user_id=user_id,
                category=category,
                title=title or parsed["title"],
                message=parsed["message"],
                event_type=event_type or parsed["event_type"],
                severity=severity or parsed["severity"],
                meta=merged_meta,
                dedup_key=dedup_key,
            )
        except Exception as exc:
            logger.debug(f"[SysNotif] emit_from_telegram failed (non-fatal): {exc}")
            return None

    @staticmethod
    def _effective_state_exprs():
        """Return SQLAlchemy case expressions resolving private vs global per-user state."""
        effective_dismissed = case(
            (SystemNotification.user_id.is_(None), func.coalesce(SystemNotificationUserState.is_dismissed, False)),
            else_=SystemNotification.is_dismissed,
        )
        effective_read = case(
            (SystemNotification.user_id.is_(None), func.coalesce(SystemNotificationUserState.is_read, False)),
            else_=SystemNotification.is_read,
        )
        return effective_dismissed, effective_read

    @staticmethod
    def _base_visible_query(db: Session, user_id: int):
        """Build base query joining per-user state for global notifications."""
        return db.query(SystemNotification).outerjoin(
            SystemNotificationUserState,
            and_(
                SystemNotificationUserState.notification_id == SystemNotification.id,
                SystemNotificationUserState.user_id == user_id,
            ),
        ).filter(
            or_(
                SystemNotification.user_id == user_id,
                SystemNotification.user_id.is_(None),
            )
        )

    @staticmethod
    def get_unread_counts(db: Session, user_id: int) -> Dict[str, int]:
        """Return unread counts broken down by category plus total."""
        effective_dismissed, effective_read = SystemNotificationService._effective_state_exprs()
        rows = (
            db.query(SystemNotification.category, func.count(SystemNotification.id))
            .outerjoin(
                SystemNotificationUserState,
                and_(
                    SystemNotificationUserState.notification_id == SystemNotification.id,
                    SystemNotificationUserState.user_id == user_id,
                ),
            )
            .filter(
                or_(SystemNotification.user_id == user_id, SystemNotification.user_id.is_(None)),
                effective_dismissed == False,
                effective_read == False,
            )
            .group_by(SystemNotification.category)
            .all()
        )
        counts = {cat: 0 for cat in SUPPORTED_CATEGORIES}
        total = 0
        for cat, cnt in rows:
            val = int(cnt or 0)
            total += val
            if cat in counts:
                counts[cat] = val
        return {"total": total, **counts}

    @staticmethod
    def _build_filtered_query(
        db: Session,
        user_id: int,
        category: Optional[str] = None,
        unread_only: bool = False,
        severity: Optional[str] = None,
        search: Optional[str] = None,
    ):
        """Build filtered visible-notifications query shared across listing and CSV export."""
        effective_dismissed, effective_read = SystemNotificationService._effective_state_exprs()
        query = SystemNotificationService._base_visible_query(db, user_id).filter(effective_dismissed == False)

        if category:
            query = query.filter(SystemNotification.category == category)
        if unread_only:
            query = query.filter(effective_read == False)
        if severity:
            query = query.filter(SystemNotification.severity == severity)
        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    SystemNotification.title.ilike(term),
                    SystemNotification.message.ilike(term),
                )
            )
        return query, effective_read

    @staticmethod
    def _serialize_rows(rows) -> List[Dict[str, Any]]:
        """Serialize (SystemNotification, effective_is_read) query rows into plain dicts."""
        return [
            {
                "id": notif.id,
                "user_id": notif.user_id,
                "category": notif.category,
                "event_type": notif.event_type,
                "severity": notif.severity,
                "title": notif.title,
                "message": notif.message,
                "meta": notif.meta or {},
                "is_read": bool(is_read_val),
                "created_at": notif.created_at,
            }
            for notif, is_read_val in rows
        ]

    @staticmethod
    def list_notifications(
        db: Session,
        user_id: int,
        category: Optional[str] = None,
        unread_only: bool = False,
        limit: int = 60,
        offset: int = 0,
        severity: Optional[str] = None,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List visible notifications for a user with per-category unread counts."""
        query, effective_read = SystemNotificationService._build_filtered_query(
            db=db,
            user_id=user_id,
            category=category,
            unread_only=unread_only,
            severity=severity,
            search=search,
        )

        total = query.count()
        rows = (
            query.with_entities(SystemNotification, effective_read.label("effective_is_read"))
            .order_by(SystemNotification.created_at.desc(), SystemNotification.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        items = SystemNotificationService._serialize_rows(rows)
        unread_counts = SystemNotificationService.get_unread_counts(db, user_id)
        return {
            "items": items,
            "unread_counts": unread_counts,
            "total": total,
        }

    @staticmethod
    def get_export_rows(
        db: Session,
        user_id: int,
        category: Optional[str] = None,
        severity: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        """Return filtered notification rows for CSV export without altering unread counts."""
        query, effective_read = SystemNotificationService._build_filtered_query(
            db=db,
            user_id=user_id,
            category=category,
            unread_only=False,
            severity=severity,
            search=search,
        )
        rows = (
            query.with_entities(SystemNotification, effective_read.label("effective_is_read"))
            .order_by(SystemNotification.created_at.desc(), SystemNotification.id.desc())
            .limit(limit)
            .all()
        )
        return SystemNotificationService._serialize_rows(rows)

    @staticmethod
    def _normalize_prefs(raw_prefs: Optional[Dict[str, Any]]) -> Dict[str, bool]:
        """Merge stored/incoming preferences with safe boolean defaults."""
        merged = dict(DEFAULT_IN_APP_PREFS)
        if isinstance(raw_prefs, dict):
            for key in DEFAULT_IN_APP_PREFS:
                if key in raw_prefs and raw_prefs[key] is not None:
                    merged[key] = bool(raw_prefs[key])
        return merged

    @staticmethod
    def get_preferences(db: Session, user_id: int) -> Dict[str, bool]:
        """Fetch user's in-app notification preferences with defaults."""
        settings_row = (
            db.query(NotificationSettings)
            .filter(NotificationSettings.user_id == user_id)
            .first()
        )
        return SystemNotificationService._normalize_prefs(
            settings_row.in_app_prefs if settings_row else None
        )

    @staticmethod
    def update_preferences(db: Session, user_id: int, prefs_dict: Dict[str, Any]) -> Dict[str, bool]:
        """Persist user's in-app notification preferences on NotificationSettings."""
        settings_row = (
            db.query(NotificationSettings)
            .filter(NotificationSettings.user_id == user_id)
            .first()
        )
        if not settings_row:
            settings_row = NotificationSettings(user_id=user_id)
            db.add(settings_row)

        base = SystemNotificationService._normalize_prefs(settings_row.in_app_prefs)
        if isinstance(prefs_dict, dict):
            for key in DEFAULT_IN_APP_PREFS:
                if key in prefs_dict and prefs_dict[key] is not None:
                    base[key] = bool(prefs_dict[key])

        settings_row.in_app_prefs = base
        db.commit()
        db.refresh(settings_row)
        return dict(base)

    @staticmethod
    def _upsert_global_user_state(
        db: Session,
        user_id: int,
        notification_id: int,
        is_read: Optional[bool] = None,
        is_dismissed: Optional[bool] = None,
    ) -> None:
        """Insert or update a per-user state row for a global notification."""
        state = (
            db.query(SystemNotificationUserState)
            .filter(
                SystemNotificationUserState.user_id == user_id,
                SystemNotificationUserState.notification_id == notification_id,
            )
            .first()
        )
        if state:
            if is_read is not None:
                state.is_read = is_read
            if is_dismissed is not None:
                state.is_dismissed = is_dismissed
        else:
            db.add(
                SystemNotificationUserState(
                    user_id=user_id,
                    notification_id=notification_id,
                    is_read=bool(is_read) if is_read is not None else False,
                    is_dismissed=bool(is_dismissed) if is_dismissed is not None else False,
                )
            )

    @staticmethod
    def mark_read(db: Session, user_id: int, notification_id: int) -> bool:
        """Mark a single private or global notification as read for the user."""
        notif = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
        if not notif:
            return False

        if notif.user_id is not None:
            if notif.user_id != user_id:
                return False
            notif.is_read = True
        else:
            SystemNotificationService._upsert_global_user_state(
                db, user_id=user_id, notification_id=notif.id, is_read=True
            )

        db.commit()
        return True

    @staticmethod
    def mark_all_read(db: Session, user_id: int, category: Optional[str] = None) -> None:
        """Mark all visible private and unread global notifications as read for the user."""
        priv_q = db.query(SystemNotification).filter(
            SystemNotification.user_id == user_id,
            SystemNotification.is_dismissed == False,
            SystemNotification.is_read == False,
        )
        if category:
            priv_q = priv_q.filter(SystemNotification.category == category)
        priv_q.update({SystemNotification.is_read: True}, synchronize_session=False)

        global_q = (
            db.query(SystemNotification.id, SystemNotificationUserState)
            .outerjoin(
                SystemNotificationUserState,
                and_(
                    SystemNotificationUserState.notification_id == SystemNotification.id,
                    SystemNotificationUserState.user_id == user_id,
                ),
            )
            .filter(
                SystemNotification.user_id.is_(None),
                func.coalesce(SystemNotificationUserState.is_dismissed, False) == False,
                func.coalesce(SystemNotificationUserState.is_read, False) == False,
            )
        )
        if category:
            global_q = global_q.filter(SystemNotification.category == category)

        for nid, state in global_q.order_by(SystemNotification.id.desc()).limit(1000).all():
            if state:
                state.is_read = True
            else:
                db.add(
                    SystemNotificationUserState(
                        user_id=user_id,
                        notification_id=nid,
                        is_read=True,
                        is_dismissed=False,
                    )
                )

        db.commit()

    @staticmethod
    def dismiss_notification(db: Session, user_id: int, notification_id: int) -> bool:
        """Dismiss (soft-delete for user) a private or global notification."""
        notif = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
        if not notif:
            return False

        if notif.user_id is not None:
            if notif.user_id != user_id:
                return False
            notif.is_dismissed = True
        else:
            SystemNotificationService._upsert_global_user_state(
                db, user_id=user_id, notification_id=notif.id, is_dismissed=True
            )

        db.commit()
        return True

    @staticmethod
    def clear_notifications(db: Session, user_id: int, category: Optional[str] = None) -> None:
        """Dismiss all visible notifications (optionally scoped by category) for the user."""
        priv_q = db.query(SystemNotification).filter(
            SystemNotification.user_id == user_id,
            SystemNotification.is_dismissed == False,
        )
        if category:
            priv_q = priv_q.filter(SystemNotification.category == category)
        priv_q.update({SystemNotification.is_dismissed: True}, synchronize_session=False)

        global_q = (
            db.query(SystemNotification.id, SystemNotificationUserState)
            .outerjoin(
                SystemNotificationUserState,
                and_(
                    SystemNotificationUserState.notification_id == SystemNotification.id,
                    SystemNotificationUserState.user_id == user_id,
                ),
            )
            .filter(
                SystemNotification.user_id.is_(None),
                func.coalesce(SystemNotificationUserState.is_dismissed, False) == False,
            )
        )
        if category:
            global_q = global_q.filter(SystemNotification.category == category)

        for nid, state in global_q.order_by(SystemNotification.id.desc()).limit(1000).all():
            if state:
                state.is_dismissed = True
            else:
                db.add(
                    SystemNotificationUserState(
                        user_id=user_id,
                        notification_id=nid,
                        is_read=False,
                        is_dismissed=True,
                    )
                )

        db.commit()
