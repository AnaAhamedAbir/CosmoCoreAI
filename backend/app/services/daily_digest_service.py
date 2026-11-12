from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.bot import Bot
from app.models.system_notification import SystemNotification
from app.models.trade import Trade
from app.services.system_notification_service import SystemNotificationService


class DailyDigestService:
    """Builds a user's UTC daily trading & notification digest and emits a market_alerts item."""

    @staticmethod
    def build_today_summary(db: Session, user_id: int) -> Dict[str, Any]:
        """Aggregate today's (UTC) bot trades and manual_trade/wallhunter notification counts."""
        now_utc = datetime.now(timezone.utc)
        day_start_aware = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        # Keep naive UTC bound compatible with SQLite in-memory tests if stored without tzinfo.
        day_start = day_start_aware.replace(tzinfo=None)
        date_str = now_utc.strftime("%Y-%m-%d")

        trades = (
            db.query(Trade)
            .join(Bot, Trade.bot_id == Bot.id)
            .filter(
                Bot.owner_id == user_id,
                or_(
                    and_(Trade.closed_at.isnot(None), Trade.closed_at >= day_start),
                    and_(Trade.closed_at.is_(None), Trade.opened_at >= day_start),
                ),
            )
            .all()
        )

        total_trades = len(trades)
        wins = sum(1 for t in trades if float(t.pnl or 0.0) > 0)
        losses = sum(1 for t in trades if float(t.pnl or 0.0) < 0)
        net_pnl = round(sum(float(t.pnl or 0.0) for t in trades), 2)

        notif_rows = (
            db.query(SystemNotification.category, func.count(SystemNotification.id))
            .filter(
                SystemNotification.user_id == user_id,
                SystemNotification.created_at >= day_start,
                SystemNotification.category.in_(("manual_trade", "wallhunter")),
            )
            .group_by(SystemNotification.category)
            .all()
        )
        cat_counts = {"manual_trade": 0, "wallhunter": 0}
        for cat, cnt in notif_rows:
            if cat in cat_counts:
                cat_counts[cat] = int(cnt or 0)

        return {
            "date_utc": date_str,
            "trades": total_trades,
            "wins": wins,
            "losses": losses,
            "net_pnl": net_pnl,
            "manual_trade_count": cat_counts["manual_trade"],
            "wallhunter_count": cat_counts["wallhunter"],
        }

    @staticmethod
    def generate_and_emit(
        db: Session,
        user_id: int,
        deduplicate: bool = False,
    ) -> Dict[str, Any]:
        """Compute today's UTC summary, emit a daily_digest notification, and return payload."""
        summary = DailyDigestService.build_today_summary(db, user_id)
        net_pnl = summary["net_pnl"]
        pnl_sign = "+" if net_pnl > 0 else ""
        severity = "success" if net_pnl > 0 else ("warning" if net_pnl < 0 else "info")
        dedup_key = f"digest:{user_id}:{summary['date_utc']}" if deduplicate else None

        message = (
            f"Date (UTC): {summary['date_utc']}\n"
            f"Trades: {summary['trades']} (Wins: {summary['wins']} | Losses: {summary['losses']})\n"
            f"Net PnL: {pnl_sign}${net_pnl:,.2f}\n"
            f"Alerts Today — Manual Trade: {summary['manual_trade_count']} | WallHunter: {summary['wallhunter_count']}"
        )

        notification = SystemNotificationService.emit_sync(
            user_id=user_id,
            category="market_alerts",
            title=f"Daily Digest ({summary['date_utc']})",
            message=message,
            event_type="daily_digest",
            severity=severity,
            meta=dict(summary),
            dedup_key=dedup_key,
        )

        return {
            "success": True,
            "notification": notification,
            "summary": summary,
        }
