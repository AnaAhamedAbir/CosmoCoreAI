import asyncio
import csv
import io
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.api import deps  # noqa: E402
from app.api.v1.endpoints import sys_notifications as sys_notif_ep  # noqa: E402
from app.db.base_class import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.models.bot import Bot  # noqa: E402
from app.models.notification import NotificationSettings  # noqa: E402
from app.models.system_notification import SystemNotification, SystemNotificationUserState  # noqa: E402
from app.models.trade import Trade  # noqa: E402
from app.services import system_notification_service as sns_mod  # noqa: E402
from app.services.notification import NotificationService  # noqa: E402
from app.services.system_notification_service import (  # noqa: E402
    SystemNotificationService,
    is_exchange_auth_error,
    parse_telegram_message_to_notification,
)


def _make_test_session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        bind=engine,
        tables=[
            User.__table__,
            Bot.__table__,
            Trade.__table__,
            NotificationSettings.__table__,
            SystemNotification.__table__,
            SystemNotificationUserState.__table__,
        ],
    )
    return engine, sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TestSystemNotifications(unittest.TestCase):
    def setUp(self):
        self.engine, self.TestSessionLocal = _make_test_session_factory()
        db = self.TestSessionLocal()
        try:
            u1 = User(id=1, email="u1@example.com", full_name="User One", hashed_password="x", is_active=True)
            u2 = User(id=2, email="u2@example.com", full_name="User Two", hashed_password="x", is_active=True)
            db.add_all([u1, u2])
            db.commit()
        finally:
            db.close()

    def tearDown(self):
        Base.metadata.drop_all(
            bind=self.engine,
            tables=[
                SystemNotificationUserState.__table__,
                SystemNotification.__table__,
                NotificationSettings.__table__,
                Trade.__table__,
                Bot.__table__,
                User.__table__,
            ],
        )
        self.engine.dispose()

    def test_parse_telegram_message_all_categories(self):
        raw_tp = (
            "🏆 *TRADE COMPLETED: TAKE-PROFIT HIT!* 🎯\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "• Pair: `BTC/USDT`\n"
            "• Entry Price: `$60,000.0000`\n"
            "• Exit Price: `$63,000.0000`\n"
            "• Est. Net Profit: *+$300.00 USDT 💰*\n\n"
            "✅ Target achieved successfully!"
        )
        parsed_tp = parse_telegram_message_to_notification(raw_tp, "manual_trade")
        self.assertEqual(parsed_tp["severity"], "success")
        self.assertEqual(parsed_tp["event_type"], "tp_hit")
        self.assertIn("TRADE COMPLETED: TAKE-PROFIT HIT!", parsed_tp["title"])
        self.assertNotIn("━━", parsed_tp["message"])
        self.assertNotIn("`", parsed_tp["message"])
        self.assertEqual(parsed_tp["meta"].get("symbol"), "BTC/USDT")
        self.assertEqual(parsed_tp["meta"].get("pnl"), 300.0)
        self.assertEqual(parsed_tp["meta"].get("price"), 60000.0)

        raw_html_crit = (
            "╔━━━━━━━━━━━━━━━━━━━━━━╗\n"
            "🚨 <b>CRITICAL: BRACKET SL PLACEMENT FAILED!</b>\n"
            "╚━━━━━━━━━━━━━━━━━━━━━━╝\n"
            "• Pair: <code>ETH/USDT:USDT</code>\n"
            "• Exchange Rejection: Insufficient margin &amp; limit"
        )
        parsed_crit = parse_telegram_message_to_notification(raw_html_crit, "manual_trade")
        self.assertEqual(parsed_crit["severity"], "critical")
        self.assertEqual(parsed_crit["event_type"], "order_failed")
        self.assertNotIn("<b>", parsed_crit["title"])
        self.assertIn("&", parsed_crit["message"])
        self.assertEqual(parsed_crit["meta"].get("symbol"), "ETH/USDT:USDT")

        raw_wh = (
            "🚀 *BOT ACTIVATED: ID 42*\n"
            "💎 Pair: SOL/USDT | binance\n"
            "1. 🛠️ Trading Mode: SPOT"
        )
        parsed_wh = parse_telegram_message_to_notification(raw_wh, "wallhunter")
        self.assertEqual(parsed_wh["severity"], "success")
        self.assertEqual(parsed_wh["event_type"], "bot_started")
        self.assertEqual(parsed_wh["meta"].get("bot_id"), 42)
        self.assertEqual(parsed_wh["meta"].get("symbol"), "SOL/USDT")

        raw_warn = "⚠️ *Trading Session Ended*\nBot has been stopped because the London session is over."
        parsed_warn = parse_telegram_message_to_notification(raw_warn, "wallhunter")
        self.assertEqual(parsed_warn["severity"], "warning")
        self.assertEqual(parsed_warn["event_type"], "session_ended")

        parsed_ml = parse_telegram_message_to_notification(
            "🤖 *Auto-Retrain Completed!*\nModel: BTC_XGB\nAccuracy: 88%",
            "ml_training",
        )
        self.assertEqual(parsed_ml["event_type"], "auto_retrain")

        parsed_mkt = parse_telegram_message_to_notification(
            "⚠️ *Large Liquidation Alert*\n$1,200,000 BTC/USDT liquidated",
            "market_alerts",
        )
        self.assertEqual(parsed_mkt["event_type"], "liquidation_alert")
        self.assertEqual(parsed_mkt["severity"], "warning")

    def test_persistence_read_unread_and_clear_for_private_and_global(self):
        async def _emit_all():
            with patch.object(sns_mod, "SessionLocal", self.TestSessionLocal), \
                 patch.object(sns_mod, "_redis_claim_dedup", return_value=None), \
                 patch.object(sns_mod, "_redis_publish_notification", return_value=None):
                await SystemNotificationService.emit(
                    user_id=1,
                    category="manual_trade",
                    title="Order Filled",
                    message="BTC/USDT filled",
                    event_type="order_filled",
                    severity="success",
                )
                await SystemNotificationService.emit(
                    user_id=1,
                    category="wallhunter",
                    title="WallHunter Started",
                    message="Bot #10 active",
                    event_type="bot_started",
                    severity="success",
                )
                await SystemNotificationService.emit(
                    user_id=1,
                    category="ml_training",
                    title="Model Ready",
                    message="XGBoost finished",
                    event_type="job_completed",
                    severity="success",
                )
                await SystemNotificationService.emit(
                    user_id=2,
                    category="manual_trade",
                    title="User 2 Private Order",
                    message="ETH/USDT placed",
                    event_type="order_placed",
                    severity="info",
                )
                await SystemNotificationService.emit(
                    user_id=None,
                    category="sentiment_news",
                    title="Bitcoin ETF Inflows Surge",
                    message="Source: CoinDesk | Impact: HIGH (85/100)",
                    event_type="market_news",
                    severity="warning",
                    dedup_key="news:abc123",
                )
                await SystemNotificationService.emit(
                    user_id=None,
                    category="market_alerts",
                    title="Large Liquidation: BTC/USDT",
                    message="$1,500,000 LONG liquidated",
                    event_type="liquidation_alert",
                    severity="warning",
                    dedup_key="liq:BTCUSDT:1",
                )

        asyncio.run(_emit_all())

        db = self.TestSessionLocal()
        try:
            u1_counts = SystemNotificationService.get_unread_counts(db, user_id=1)
            u2_counts = SystemNotificationService.get_unread_counts(db, user_id=2)
            self.assertEqual(
                u1_counts,
                {
                    "total": 5,
                    "manual_trade": 1,
                    "wallhunter": 1,
                    "sentiment_news": 1,
                    "ml_training": 1,
                    "market_alerts": 1,
                },
            )
            self.assertEqual(
                u2_counts,
                {
                    "total": 3,
                    "manual_trade": 1,
                    "wallhunter": 0,
                    "sentiment_news": 1,
                    "ml_training": 0,
                    "market_alerts": 1,
                },
            )

            u1_list = SystemNotificationService.list_notifications(db, user_id=1)
            self.assertEqual(u1_list["total"], 5)
            global_item = next(i for i in u1_list["items"] if i["category"] == "sentiment_news")
            private_u1_item = next(i for i in u1_list["items"] if i["category"] == "manual_trade")

            # Severity and case-insensitive search filters
            warn_list = SystemNotificationService.list_notifications(db, user_id=1, severity="warning")
            self.assertEqual(warn_list["total"], 2)
            search_list = SystemNotificationService.list_notifications(db, user_id=1, search="xgboost")
            self.assertEqual(search_list["total"], 1)
            self.assertEqual(search_list["items"][0]["category"], "ml_training")

            # User 2 cannot mark User 1's private notification read
            self.assertFalse(SystemNotificationService.mark_read(db, user_id=2, notification_id=private_u1_item["id"]))

            # User 1 marks global news read; User 2 still sees it unread
            self.assertTrue(SystemNotificationService.mark_read(db, user_id=1, notification_id=global_item["id"]))
            self.assertEqual(
                SystemNotificationService.get_unread_counts(db, user_id=1),
                {
                    "total": 4,
                    "manual_trade": 1,
                    "wallhunter": 1,
                    "sentiment_news": 0,
                    "ml_training": 1,
                    "market_alerts": 1,
                },
            )
            self.assertEqual(
                SystemNotificationService.get_unread_counts(db, user_id=2),
                {
                    "total": 3,
                    "manual_trade": 1,
                    "wallhunter": 0,
                    "sentiment_news": 1,
                    "ml_training": 0,
                    "market_alerts": 1,
                },
            )

            # Mark all read scoped by category
            SystemNotificationService.mark_all_read(db, user_id=1, category="manual_trade")
            self.assertEqual(
                SystemNotificationService.get_unread_counts(db, user_id=1),
                {
                    "total": 3,
                    "manual_trade": 0,
                    "wallhunter": 1,
                    "sentiment_news": 0,
                    "ml_training": 1,
                    "market_alerts": 1,
                },
            )

            # User 1 clears all; User 2's global + private notifications remain intact
            SystemNotificationService.clear_notifications(db, user_id=1)
            self.assertEqual(SystemNotificationService.list_notifications(db, user_id=1)["total"], 0)
            self.assertEqual(SystemNotificationService.get_unread_counts(db, user_id=1)["total"], 0)
            self.assertEqual(SystemNotificationService.list_notifications(db, user_id=2)["total"], 3)
        finally:
            db.close()

    def test_deduplication_redis_and_db_fallback(self):
        # 1. DB fallback when Redis is unavailable
        with patch.object(sns_mod, "SessionLocal", self.TestSessionLocal), \
             patch.object(sns_mod, "_redis_claim_dedup", return_value=None), \
             patch.object(sns_mod, "_redis_publish_notification", return_value=None):
            first = SystemNotificationService.emit_sync(
                user_id=None,
                category="sentiment_news",
                title="Same News",
                message="Body",
                dedup_key="news:same-url",
            )
            second = SystemNotificationService.emit_sync(
                user_id=None,
                category="sentiment_news",
                title="Same News",
                message="Body",
                dedup_key="news:same-url",
            )
            self.assertIsNotNone(first)
            self.assertIsNone(second)

        # 2. Redis fast-path duplicate rejection (SET NX returns False)
        with patch.object(sns_mod, "SessionLocal", self.TestSessionLocal), \
             patch.object(sns_mod, "_redis_claim_dedup", return_value=False):
            third = asyncio.run(
                SystemNotificationService.emit(
                    user_id=None,
                    category="sentiment_news",
                    title="Redis Deduped",
                    message="Body",
                    dedup_key="news:redis-dup",
                )
            )
            self.assertIsNone(third)

    def test_notification_service_emits_when_telegram_disabled(self):
        db = self.TestSessionLocal()
        try:
            # User 1 has NotificationSettings row with Telegram disabled
            db.add(NotificationSettings(user_id=1, is_enabled=False))
            db.commit()

            with patch.object(sns_mod, "SessionLocal", self.TestSessionLocal), \
                 patch.object(sns_mod, "_redis_claim_dedup", return_value=None), \
                 patch.object(sns_mod, "_redis_publish_notification", return_value=None):
                asyncio.run(
                    NotificationService.send_message(
                        db,
                        1,
                        "🚀 *MANUAL TRADE FIRED (MARKET)*\n• Pair: `BTC/USDT`",
                        parse_mode="Markdown",
                        alert_type="alert_manual_trade",
                    )
                )
                asyncio.run(
                    NotificationService.send_message(
                        db,
                        1,
                        "⚡ WallHunter Entered!\nPair: ETH/USDT\nEntry 3000.0",
                        in_app_category="wallhunter",
                    )
                )
                asyncio.run(
                    NotificationService.send_message(
                        db,
                        1,
                        "🤖 *Auto-Retrain Completed!*\nModel: BTC_L2",
                        in_app_category="ml_training",
                    )
                )
                asyncio.run(
                    NotificationService.send_message(
                        db,
                        1,
                        "⚠️ *Backtest Completed*\nBTC/USDT +12.5%",
                        in_app_category="market_alerts",
                    )
                )
                asyncio.run(
                    NotificationService.send_photo_bytes(
                        db,
                        1,
                        b"fake-png-bytes",
                        caption="📊 **TA Snapshot @ Entry**\nPair: ETH/USDT (1m)",
                        in_app_category="wallhunter",
                    )
                )
                # skip_in_app=True must NOT emit
                asyncio.run(
                    NotificationService.send_message(
                        db,
                        1,
                        "Should be skipped",
                        in_app_category="ml_training",
                        skip_in_app=True,
                    )
                )

            res = SystemNotificationService.list_notifications(db, user_id=1)
            self.assertEqual(res["total"], 5)
            cats = sorted(item["category"] for item in res["items"])
            self.assertEqual(
                cats,
                ["manual_trade", "market_alerts", "ml_training", "wallhunter", "wallhunter"],
            )
        finally:
            db.close()

    def test_exchange_auth_error_detection(self):
        import ccxt

        self.assertTrue(is_exchange_auth_error(ccxt.AuthenticationError("Invalid API-key")))
        self.assertTrue(is_exchange_auth_error(ccxt.InvalidNonce("Timestamp outside recvWindow")))
        self.assertTrue(is_exchange_auth_error(ccxt.PermissionDenied("API key permissions missing")))
        self.assertTrue(is_exchange_auth_error(RuntimeError("binance -2015: Invalid API-key, IP, or permissions")))
        self.assertFalse(is_exchange_auth_error(RuntimeError("Insufficient margin for order")))

    def test_api_endpoints_extended(self):
        app = FastAPI()
        app.include_router(sys_notif_ep.router, prefix="/api/v1/sys-notifications")

        def override_get_db():
            db = self.TestSessionLocal()
            try:
                yield db
            finally:
                db.close()

        current_user_holder = {"user": User(id=1, email="u1@example.com", is_active=True)}
        app.dependency_overrides[deps.get_db] = override_get_db
        app.dependency_overrides[deps.get_current_user] = lambda: current_user_holder["user"]

        # Seed bots & trades for daily-digest
        db = self.TestSessionLocal()
        try:
            bot = Bot(id=10, owner_id=1, name="WH-BTC", exchange="binance", market="BTC/USDT", strategy="wall_hunter", timeframe="1m")
            db.add(bot)
            db.flush()
            now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
            db.add_all(
                [
                    Trade(bot_id=10, symbol="BTC/USDT", side="BUY", entry_price=60000.0, exit_price=61000.0, quantity=0.1, status="CLOSED", pnl=100.0, pnl_percent=1.6, opened_at=now_naive, closed_at=now_naive),
                    Trade(bot_id=10, symbol="BTC/USDT", side="BUY", entry_price=61000.0, exit_price=60500.0, quantity=0.1, status="CLOSED", pnl=-35.0, pnl_percent=-0.5, opened_at=now_naive, closed_at=now_naive),
                ]
            )
            db.commit()
        finally:
            db.close()

        with patch.object(sns_mod, "SessionLocal", self.TestSessionLocal), \
             patch.object(sns_mod, "_redis_claim_dedup", return_value=None), \
             patch.object(sns_mod, "_redis_publish_notification", return_value=None):
            SystemNotificationService.emit_sync(1, "manual_trade", "Trade 1", "Filled BTC/USDT", "order_placed", "info")
            SystemNotificationService.emit_sync(1, "wallhunter", "WallHunter Hit", "Bot #10 TP", "tp_hit", "success")
            SystemNotificationService.emit_sync(1, "ml_training", "Drift Warning", "Accuracy low", "model_drift", "critical")
            SystemNotificationService.emit_sync(None, "sentiment_news", "News 1", "Macro headline", "market_news", "info")

            client = TestClient(app)

            # 1. Preferences GET default & PUT roundtrip
            p_get = client.get("/api/v1/sys-notifications/preferences")
            self.assertEqual(p_get.status_code, 200)
            self.assertEqual(
                p_get.json(),
                {
                    "soundEnabled": True,
                    "toastEnabled": True,
                    "desktopPushEnabled": False,
                    "muteLowImpactNews": False,
                },
            )

            p_put = client.put(
                "/api/v1/sys-notifications/preferences",
                json={
                    "soundEnabled": False,
                    "toastEnabled": True,
                    "desktopPushEnabled": True,
                    "muteLowImpactNews": True,
                },
            )
            self.assertEqual(p_put.status_code, 200)
            self.assertEqual(p_put.json()["soundEnabled"], False)
            self.assertEqual(p_put.json()["desktopPushEnabled"], True)
            self.assertEqual(client.get("/api/v1/sys-notifications/preferences").json(), p_put.json())

            # 2. List with severity and search filters
            resp = client.get("/api/v1/sys-notifications")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["total"], 4)
            self.assertEqual(resp.json()["unread_counts"]["ml_training"], 1)

            resp_crit = client.get("/api/v1/sys-notifications?severity=critical&search=drift")
            self.assertEqual(resp_crit.status_code, 200)
            self.assertEqual(resp_crit.json()["total"], 1)
            self.assertEqual(resp_crit.json()["items"][0]["event_type"], "model_drift")

            # 3. Client-event POST
            ce_bad = client.post(
                "/api/v1/sys-notifications/client-event",
                json={"category": "invalid_cat", "title": "Oops"},
            )
            self.assertEqual(ce_bad.status_code, 422)

            ce_ok = client.post(
                "/api/v1/sys-notifications/client-event",
                json={
                    "category": "market_alerts",
                    "title": "Price Alert Triggered",
                    "message": "BTC crossed 70,000",
                    "event_type": "price_alert",
                    "severity": "warning",
                    "meta": {"symbol": "BTC/USDT"},
                },
            )
            self.assertEqual(ce_ok.status_code, 200)
            ce_body = ce_ok.json()
            self.assertTrue(ce_body["success"])
            self.assertEqual(ce_body["notification"]["category"], "market_alerts")
            self.assertEqual(ce_body["unread_counts"]["market_alerts"], 1)

            # 4. Daily digest POST
            dd_resp = client.post("/api/v1/sys-notifications/daily-digest")
            self.assertEqual(dd_resp.status_code, 200)
            dd_data = dd_resp.json()
            self.assertTrue(dd_data["success"])
            self.assertEqual(dd_data["notification"]["category"], "market_alerts")
            self.assertEqual(dd_data["notification"]["event_type"], "daily_digest")
            self.assertEqual(dd_data["summary"]["trades"], 2)
            self.assertEqual(dd_data["summary"]["wins"], 1)
            self.assertEqual(dd_data["summary"]["losses"], 1)
            self.assertEqual(dd_data["summary"]["net_pnl"], 65.0)
            self.assertEqual(dd_data["summary"]["manual_trade_count"], 1)
            self.assertEqual(dd_data["summary"]["wallhunter_count"], 1)

            # 5. CSV Export GET
            exp_resp = client.get("/api/v1/sys-notifications/export?category=market_alerts")
            self.assertEqual(exp_resp.status_code, 200)
            self.assertIn("text/csv", exp_resp.headers.get("content-type", ""))
            self.assertIn('filename="sys-notifications.csv"', exp_resp.headers.get("content-disposition", ""))
            csv_rows = list(csv.reader(io.StringIO(exp_resp.text)))
            self.assertEqual(csv_rows[0], ["id", "created_at", "category", "event_type", "severity", "title", "message", "is_read"])
            self.assertEqual(len(csv_rows), 3)  # header + price_alert + daily_digest

            # 6. Mark read / read-all / delete / clear
            first_id = resp.json()["items"][0]["id"]
            r_read = client.post(f"/api/v1/sys-notifications/{first_id}/read")
            self.assertEqual(r_read.status_code, 200)

            r_all = client.post("/api/v1/sys-notifications/read-all", json={"category": None})
            self.assertEqual(r_all.status_code, 200)
            self.assertEqual(r_all.json()["unread_counts"]["total"], 0)

            r_del = client.delete(f"/api/v1/sys-notifications/{first_id}")
            self.assertEqual(r_del.status_code, 200)

            r_clr = client.delete("/api/v1/sys-notifications/clear")
            self.assertEqual(r_clr.status_code, 200)

            resp_after = client.get("/api/v1/sys-notifications")
            self.assertEqual(resp_after.json()["total"], 0)


if __name__ == "__main__":
    unittest.main()
