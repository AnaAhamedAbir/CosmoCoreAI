import json
import os
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.api import deps  # noqa: E402
from app.api.v1.endpoints import training_deploy as deploy_ep  # noqa: E402
from app.db.base_class import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.models.bot import Bot  # noqa: E402
from app.models.ml_model import CustomMLModel, ModelStatus, ModelVersion  # noqa: E402
from app.models.model_training import ModelTrainingJob, TrainingStatus  # noqa: E402
from app.models.notification import NotificationSettings  # noqa: E402
from app.models.system_notification import SystemNotification, SystemNotificationUserState  # noqa: E402
from app.models.trade import Trade  # noqa: E402
from app.services import system_notification_service as sns_mod  # noqa: E402

MOUNT_PREFIX = "/api/v1/model-training/deploy"


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
            CustomMLModel.__table__,
            ModelVersion.__table__,
            ModelTrainingJob.__table__,
            NotificationSettings.__table__,
            SystemNotification.__table__,
            SystemNotificationUserState.__table__,
        ],
    )
    return engine, sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TestTrainingDeploy(unittest.TestCase):
    def setUp(self):
        self.engine, self.TestSessionLocal = _make_test_session_factory()
        self.tmpdir = tempfile.TemporaryDirectory()
        self.current_user_id = 1

        db = self.TestSessionLocal()
        try:
            u1 = User(id=1, email="u1@example.com", full_name="User One", hashed_password="x", is_active=True)
            u2 = User(id=2, email="u2@example.com", full_name="User Two", hashed_password="x", is_active=True)
            db.add_all([u1, u2])
            db.commit()
        finally:
            db.close()

        self.app = FastAPI()
        self.app.include_router(deploy_ep.router, prefix=MOUNT_PREFIX)

        def override_get_db():
            db_sess = self.TestSessionLocal()
            try:
                yield db_sess
            finally:
                db_sess.close()

        def override_get_current_user():
            db_sess = self.TestSessionLocal()
            try:
                return db_sess.query(User).filter(User.id == self.current_user_id).first()
            finally:
                db_sess.close()

        self.app.dependency_overrides[deps.get_db] = override_get_db
        self.app.dependency_overrides[deps.get_current_user] = override_get_current_user
        self.client = TestClient(self.app)

        self.patch_sns_session = patch.object(sns_mod, "SessionLocal", self.TestSessionLocal)
        self.patch_redis_pub = patch.object(sns_mod, "_redis_publish_notification", return_value=None)
        self.patch_redis_dedup = patch.object(sns_mod, "_redis_claim_dedup", return_value=True)
        self.patch_sns_session.start()
        self.patch_redis_pub.start()
        self.patch_redis_dedup.start()

    def tearDown(self):
        self.patch_redis_dedup.stop()
        self.patch_redis_pub.stop()
        self.patch_sns_session.stop()
        self.tmpdir.cleanup()
        Base.metadata.drop_all(
            bind=self.engine,
            tables=[
                SystemNotificationUserState.__table__,
                SystemNotification.__table__,
                NotificationSettings.__table__,
                ModelTrainingJob.__table__,
                ModelVersion.__table__,
                CustomMLModel.__table__,
                Trade.__table__,
                Bot.__table__,
                User.__table__,
            ],
        )
        self.engine.dispose()

    def _create_model_and_version(
        self,
        model_id="mdl_crypto_1",
        user_id=1,
        market_type="crypto",
        model_type="Random Forest",
        name="Alpha RF",
        version_id="ver_1",
        file_path=None,
        dataset_path=None,
        metadata_path=None,
        explainability=None,
        set_active=True,
    ):
        db = self.TestSessionLocal()
        try:
            model = CustomMLModel(
                id=model_id,
                name=name,
                model_type=model_type,
                market_type=market_type,
                user_id=user_id,
                active_version_id=version_id if set_active else None,
            )
            db.add(model)
            db.flush()
            version = ModelVersion(
                id=version_id,
                model_id=model_id,
                version=1.0,
                file_path=file_path or os.path.join(self.tmpdir.name, f"{model_id}.pkl"),
                status=ModelStatus.READY,
                dataset_path=dataset_path,
                metadata_path=metadata_path,
                explainability=explainability,
            )
            db.add(version)
            db.commit()
        finally:
            db.close()

    # ── 1. Paper Replay Tests ──────────────────────────────────────────────

    def test_paper_replay_live_oos_with_joblib_and_csv(self):
        rng = np.random.default_rng(7)
        n_rows = 120
        feat_a = rng.normal(0, 1, n_rows)
        feat_b = rng.normal(0, 1, n_rows)
        close = 50000.0 + np.cumsum(rng.normal(25.0, 150.0, n_rows))
        y = (np.roll(close, -1) > close).astype(int)

        scaler = StandardScaler()
        X_raw = np.column_stack([feat_a, feat_b])
        X_scaled = scaler.fit_transform(X_raw)

        clf = RandomForestClassifier(n_estimators=10, random_state=42)
        clf.fit(X_scaled[:80], y[:80])

        model_path = os.path.join(self.tmpdir.name, "model_train_100.pkl")
        scaler_path = os.path.join(self.tmpdir.name, "scaler_train_100.pkl")
        meta_path = os.path.join(self.tmpdir.name, "model_train_100.json")
        csv_path = os.path.join(self.tmpdir.name, "oos_data.csv")

        joblib.dump(clf, model_path)
        joblib.dump(scaler, scaler_path)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "features": ["feat_a", "feat_b"],
                    "prediction_target": "classification",
                    "symbol": "BTC/USDT",
                    "timeframe": "15m",
                    "algorithm": "Random Forest",
                    "scaler_path": scaler_path,
                },
                f,
            )

        pd.DataFrame(
            {
                "Open": close - 20,
                "High": close + 40,
                "Low": close - 40,
                "Close": close,
                "Volume": np.full(n_rows, 100.0),
                "feat_a": feat_a,
                "feat_b": feat_b,
            }
        ).to_csv(csv_path, index=False)

        self._create_model_and_version(
            model_id="mdl_oos",
            file_path=model_path,
            dataset_path=csv_path,
            metadata_path=meta_path,
        )

        # Optional body omitted completely
        resp = self.client.post(f"{MOUNT_PREFIX}/paper-replay/mdl_oos")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["source"], "live_oos_replay")
        self.assertEqual(data["bars_replayed"], 120)
        self.assertEqual(len(data["equity_curve"]), 120)
        pt = data["equity_curve"][0]
        self.assertEqual(set(pt.keys()), {"bar", "price", "equity", "drawdown_pct", "signal"})
        for key in (
            "profit_pct",
            "win_rate",
            "max_drawdown",
            "profit_factor",
            "sharpe_ratio",
            "total_trades",
            "kelly_pct",
            "monte_carlo_var",
            "risk_of_ruin",
        ):
            self.assertIn(key, data)

        # Custom max_bars slicing
        resp2 = self.client.post(
            f"{MOUNT_PREFIX}/paper-replay/mdl_oos",
            json={"initial_balance": 5000.0, "stop_loss": 1.5, "take_profit": 3.0, "commission": 0.0005, "max_bars": 40},
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()["bars_replayed"], 40)
        self.assertEqual(resp2.json()["initial_balance"], 5000.0)

    def test_paper_replay_falls_back_to_cached_post_backtest(self):
        self._create_model_and_version(
            model_id="mdl_cached",
            file_path=os.path.join(self.tmpdir.name, "missing_model.pt"),
            dataset_path=None,
            explainability={
                "backtest_result": {
                    "profit_pct": 18.5,
                    "win_rate": 62.5,
                    "max_drawdown": 4.2,
                    "total_trades": 24,
                    "kelly_pct": 14.0,
                    "monte_carlo_var": 6.5,
                    "risk_of_ruin": 0.2,
                }
            },
        )

        resp = self.client.post(f"{MOUNT_PREFIX}/paper-replay/mdl_cached", json={"initial_balance": 20000.0})
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["source"], "cached_post_backtest")
        self.assertEqual(data["profit_pct"], 18.5)
        self.assertEqual(data["final_value"], 23700.0)
        self.assertEqual(data["win_rate"], 62.5)
        self.assertEqual(data["max_drawdown"], 4.2)
        self.assertEqual(data["total_trades"], 24)
        self.assertGreater(len(data["equity_curve"]), 5)

    def test_paper_replay_400_when_no_artifacts_or_backtest(self):
        self._create_model_and_version(
            model_id="mdl_empty",
            file_path=os.path.join(self.tmpdir.name, "nonexistent.pkl"),
            dataset_path=None,
            explainability={},
        )
        resp = self.client.post(f"{MOUNT_PREFIX}/paper-replay/mdl_empty")
        self.assertEqual(resp.status_code, 400)

    def test_paper_replay_rejects_forex_and_other_user(self):
        self._create_model_and_version(model_id="mdl_fx", market_type="forex", version_id="ver_fx")
        self._create_model_and_version(model_id="mdl_u2", user_id=2, version_id="ver_u2")

        self.assertEqual(self.client.post(f"{MOUNT_PREFIX}/paper-replay/mdl_fx").status_code, 400)
        self.assertEqual(self.client.post(f"{MOUNT_PREFIX}/paper-replay/mdl_u2").status_code, 404)

    # ── 2 & 3. WallHunter Listing & 1-Click Deploy Tests ───────────────────

    def test_wallhunter_bots_and_deploy_with_live_reload(self):
        db = self.TestSessionLocal()
        try:
            b1 = Bot(
                id=101,
                owner_id=1,
                name="WH BTC Active",
                exchange="binance",
                market="BTC/USDT",
                strategy="wall_hunter",
                timeframe="5m",
                status="active",
                config={"wall_threshold": 5.0},
            )
            b2 = Bot(
                id=102,
                owner_id=1,
                name="WH ETH Inactive",
                exchange="bybit",
                market="ETH/USDT",
                strategy="wall_hunter",
                timeframe="15m",
                status="inactive",
                config={"ai_model_id": "old_mdl", "enable_ml_filter": False, "ml_min_confidence": 0.55},
            )
            b_other_strat = Bot(
                id=103,
                owner_id=1,
                name="RSI Bot",
                exchange="binance",
                market="SOL/USDT",
                strategy="RSI Crossover",
                timeframe="1h",
                status="active",
                config={},
            )
            b_user2 = Bot(
                id=104,
                owner_id=2,
                name="U2 WH Bot",
                exchange="binance",
                market="BTC/USDT",
                strategy="wall_hunter",
                timeframe="5m",
                status="active",
                config={},
            )
            db.add_all([b1, b2, b_other_strat, b_user2])
            db.commit()
        finally:
            db.close()

        self._create_model_and_version(model_id="mdl_wh", name="L2 Spoof Hunter")

        list_resp = self.client.get(f"{MOUNT_PREFIX}/wallhunter-bots")
        self.assertEqual(list_resp.status_code, 200)
        bots = list_resp.json()
        self.assertEqual(len(bots), 2)
        self.assertEqual({b["id"] for b in bots}, {101, 102})
        b2_item = next(b for b in bots if b["id"] == 102)
        self.assertEqual(b2_item["current_ai_model_id"], "old_mdl")
        self.assertFalse(b2_item["enable_ml_filter"])
        self.assertEqual(b2_item["ml_min_confidence"], 0.55)

        mock_bm = MagicMock()
        mock_bm.update_live_bot = AsyncMock(return_value={"status": "success"})
        self.app.state.bot_manager = mock_bm

        deploy_resp = self.client.post(
            f"{MOUNT_PREFIX}/wallhunter",
            json={"bot_id": 101, "model_id": "mdl_wh", "enable_ml_filter": True, "min_confidence": 0.72},
        )
        self.assertEqual(deploy_resp.status_code, 200, deploy_resp.text)
        body = deploy_resp.json()
        self.assertTrue(body["success"])
        self.assertTrue(body["live_reloaded"])
        self.assertEqual(body["model_name"], "L2 Spoof Hunter")
        mock_bm.update_live_bot.assert_awaited_once_with(
            101,
            {"enable_ml_filter": True, "ai_model_id": "mdl_wh", "ml_min_confidence": 0.72},
        )

        # Verify DB config preserved wall_threshold and persisted new keys
        db = self.TestSessionLocal()
        try:
            bot_db = db.query(Bot).filter(Bot.id == 101).first()
            self.assertEqual(bot_db.config["wall_threshold"], 5.0)
            self.assertEqual(bot_db.config["ai_model_id"], "mdl_wh")
            self.assertTrue(bot_db.config["enable_ml_filter"])
            self.assertEqual(bot_db.config["ml_min_confidence"], 0.72)

            notif = (
                db.query(SystemNotification)
                .filter(SystemNotification.user_id == 1, SystemNotification.event_type == "ml_model_deployed")
                .first()
            )
            self.assertIsNotNone(notif)
            self.assertEqual(notif.category, "wallhunter")
            self.assertEqual(notif.severity, "success")
            self.assertEqual(notif.meta["bot_id"], 101)
            self.assertEqual(notif.meta["symbol"], "BTC/USDT")
        finally:
            db.close()

        # If bot_manager raises, deployment still succeeds with live_reloaded=False
        mock_bm.update_live_bot = AsyncMock(side_effect=RuntimeError("socket lost"))
        deploy_resp2 = self.client.post(
            f"{MOUNT_PREFIX}/wallhunter",
            json={"bot_id": 101, "model_id": "mdl_wh", "enable_ml_filter": False, "min_confidence": 0.65},
        )
        self.assertEqual(deploy_resp2.status_code, 200)
        self.assertFalse(deploy_resp2.json()["live_reloaded"])

        # Reject non-wallhunter strategy and user2 bot
        self.assertEqual(
            self.client.post(f"{MOUNT_PREFIX}/wallhunter", json={"bot_id": 103, "model_id": "mdl_wh"}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(f"{MOUNT_PREFIX}/wallhunter", json={"bot_id": 104, "model_id": "mdl_wh"}).status_code,
            404,
        )

    # ── 4. Manual Trade ML Filter Pin Tests ────────────────────────────────

    def test_manual_trade_pin_lifecycle_preserves_in_app_prefs(self):
        # Seed existing NotificationSettings with existing keys
        db = self.TestSessionLocal()
        try:
            db.add(NotificationSettings(user_id=1, in_app_prefs={"soundEnabled": False, "toastEnabled": True}))
            db.commit()
        finally:
            db.close()

        meta_path = os.path.join(self.tmpdir.name, "pin_meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"symbol": "ETH/USDT", "algorithm": "XGBoost"}, f)

        self._create_model_and_version(
            model_id="mdl_pin",
            name="ETH Sniper",
            model_type="XGBoost",
            metadata_path=meta_path,
        )

        # Initially None
        r_get0 = self.client.get(f"{MOUNT_PREFIX}/manual-trade-pin")
        self.assertEqual(r_get0.status_code, 200)
        self.assertIsNone(r_get0.json()["pinned"])

        # Pin model
        r_post = self.client.post(
            f"{MOUNT_PREFIX}/manual-trade-pin",
            json={"model_id": "mdl_pin", "min_confidence": 0.68, "enabled": True},
        )
        self.assertEqual(r_post.status_code, 200, r_post.text)
        self.assertTrue(r_post.json()["success"])
        self.assertEqual(r_post.json()["pinned"]["symbol"], "ETH/USDT")

        # GET reflects pinned model
        r_get1 = self.client.get(f"{MOUNT_PREFIX}/manual-trade-pin")
        self.assertEqual(r_get1.status_code, 200)
        pinned = r_get1.json()["pinned"]
        self.assertEqual(pinned["model_id"], "mdl_pin")
        self.assertEqual(pinned["model_name"], "ETH Sniper")
        self.assertEqual(pinned["algorithm"], "XGBoost")
        self.assertEqual(pinned["min_confidence"], 0.68)
        self.assertTrue(pinned["enabled"])

        # Verify existing in_app_prefs preserved and notification emitted
        db = self.TestSessionLocal()
        try:
            ns = db.query(NotificationSettings).filter(NotificationSettings.user_id == 1).first()
            self.assertFalse(ns.in_app_prefs["soundEnabled"])
            self.assertTrue(ns.in_app_prefs["toastEnabled"])
            notif = (
                db.query(SystemNotification)
                .filter(SystemNotification.user_id == 1, SystemNotification.event_type == "ml_model_pinned")
                .first()
            )
            self.assertIsNotNone(notif)
            self.assertEqual(notif.category, "manual_trade")
            self.assertEqual(notif.severity, "info")
        finally:
            db.close()

        # DELETE clears pin while preserving other prefs
        r_del = self.client.delete(f"{MOUNT_PREFIX}/manual-trade-pin")
        self.assertEqual(r_del.status_code, 200)
        self.assertTrue(r_del.json()["success"])
        self.assertIsNone(self.client.get(f"{MOUNT_PREFIX}/manual-trade-pin").json()["pinned"])

        db = self.TestSessionLocal()
        try:
            ns = db.query(NotificationSettings).filter(NotificationSettings.user_id == 1).first()
            self.assertFalse(ns.in_app_prefs["soundEnabled"])
            self.assertNotIn("pinned_manual_trade_ml", ns.in_app_prefs)
        finally:
            db.close()

    def test_manual_trade_pin_creates_notification_settings_if_missing(self):
        self._create_model_and_version(model_id="mdl_pin_new", name="SOL Scalper", model_type="LightGBM")
        r_post = self.client.post(f"{MOUNT_PREFIX}/manual-trade-pin", json={"model_id": "mdl_pin_new"})
        self.assertEqual(r_post.status_code, 200)
        self.assertEqual(self.client.get(f"{MOUNT_PREFIX}/manual-trade-pin").json()["pinned"]["model_id"], "mdl_pin_new")

    # ── 5. 1-Click Retrain Tests ───────────────────────────────────────────

    @patch("app.tasks.celery_train_model_task")
    def test_retrain_from_completed_training_job(self, mock_celery_task):
        mock_celery_task.apply_async = MagicMock()
        self._create_model_and_version(model_id="mdl_rt", name="BTC LSTM", model_type="LSTM")

        db = self.TestSessionLocal()
        try:
            db.add(
                ModelTrainingJob(
                    id="train_prev_1",
                    user_id=1,
                    symbol="BTC/USDT",
                    timeframe="15m",
                    algorithm="LSTM",
                    status=TrainingStatus.COMPLETED,
                    market_type="crypto",
                    config={"epochs": 30, "indicators": ["RSI", "MACD"]},
                    output_model_id="mdl_rt",
                )
            )
            db.commit()
        finally:
            db.close()

        resp = self.client.post(f"{MOUNT_PREFIX}/retrain/mdl_rt")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertTrue(data["job_id"].startswith("train_"))
        self.assertEqual(data["model_id"], "mdl_rt")
        self.assertEqual(data["symbol"], "BTC/USDT")
        self.assertEqual(data["timeframe"], "15m")
        self.assertEqual(data["algorithm"], "LSTM")

        mock_celery_task.apply_async.assert_called_once_with(
            args=[data["job_id"]],
            task_id=data["job_id"],
            queue="heavy",
        )

        db = self.TestSessionLocal()
        try:
            new_job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == data["job_id"]).first()
            self.assertIsNotNone(new_job)
            self.assertEqual(new_job.status, TrainingStatus.PENDING)
            self.assertEqual(new_job.config["incremental_retrain_model_id"], "mdl_rt")
            self.assertEqual(new_job.config["epochs"], 30)

            notif = (
                db.query(SystemNotification)
                .filter(SystemNotification.user_id == 1, SystemNotification.event_type == "retrain_queued")
                .first()
            )
            self.assertIsNotNone(notif)
            self.assertEqual(notif.category, "ml_training")
        finally:
            db.close()

    @patch("app.tasks.celery_train_model_task")
    def test_retrain_fallback_to_metadata_json_and_celery_error_safe(self, mock_celery_task):
        mock_celery_task.apply_async = MagicMock(side_effect=RuntimeError("broker down"))
        meta_path = os.path.join(self.tmpdir.name, "meta_rt.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "symbol": "AVAX/USDT",
                    "timeframe": "1h",
                    "algorithm": "LightGBM",
                    "features": ["Close", "Volume"],
                },
                f,
            )

        self._create_model_and_version(
            model_id="mdl_rt_meta",
            name="AVAX LGBM",
            model_type="LightGBM",
            metadata_path=meta_path,
        )

        resp = self.client.post(f"{MOUNT_PREFIX}/retrain/mdl_rt_meta")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["symbol"], "AVAX/USDT")
        self.assertEqual(resp.json()["timeframe"], "1h")
        self.assertEqual(resp.json()["algorithm"], "LightGBM")

    def test_retrain_400_when_missing_metadata_and_job(self):
        self._create_model_and_version(model_id="mdl_rt_empty", name="Uploaded Bare", model_type="Random Forest")
        resp = self.client.post(f"{MOUNT_PREFIX}/retrain/mdl_rt_empty")
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
