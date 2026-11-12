import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.api import deps  # noqa: E402
from app.api.v1.endpoints import training_studio_tools as tst_ep  # noqa: E402
from app.db.base_class import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.models import (  # noqa: E402
    CustomMLModel,
    MarketData,
    ModelStatus,
    ModelTrainingJob,
    ModelVersion,
    TrainingPreset,
    TrainingStatus,
    User,
)
from app.services import ml_automl  # noqa: E402
from app.services import training_studio_analytics as tsa_svc  # noqa: E402


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
            MarketData.__table__,
            CustomMLModel.__table__,
            ModelVersion.__table__,
            ModelTrainingJob.__table__,
            TrainingPreset.__table__,
        ],
    )
    return engine, sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TestTrainingStudioTools(unittest.TestCase):
    def setUp(self):
        self.engine, self.TestSessionLocal = _make_test_session_factory()
        db = self.TestSessionLocal()
        try:
            u1 = User(id=1, email="trader1@example.com", full_name="Trader One", hashed_password="x", is_active=True)
            u2 = User(id=2, email="trader2@example.com", full_name="Trader Two", hashed_password="x", is_active=True)
            db.add_all([u1, u2])
            db.commit()
        finally:
            db.close()

        self.current_user_id = 1
        self.app = FastAPI()
        self.app.include_router(tst_ep.router, prefix="/api/v1/model-training/tools")

        def override_get_db():
            session = self.TestSessionLocal()
            try:
                yield session
            finally:
                session.close()

        def override_get_current_user():
            session = self.TestSessionLocal()
            try:
                return session.query(User).filter(User.id == self.current_user_id).first()
            finally:
                session.close()

        self.app.dependency_overrides[get_db] = override_get_db
        self.app.dependency_overrides[deps.get_current_user] = override_get_current_user
        self.client = TestClient(self.app)

    def tearDown(self):
        Base.metadata.drop_all(
            bind=self.engine,
            tables=[
                TrainingPreset.__table__,
                ModelTrainingJob.__table__,
                ModelVersion.__table__,
                CustomMLModel.__table__,
                MarketData.__table__,
                User.__table__,
            ],
        )
        self.engine.dispose()

    def test_presets_crud_and_user_isolation(self):
        # User 1 creates two presets
        res1 = self.client.post(
            "/api/v1/model-training/tools/presets",
            json={
                "name": "BTC Scalper XGB",
                "description": "High freq XGBoost preset",
                "symbol": "BTC/USDT",
                "timeframe": "15m",
                "algorithm": "XGBoost",
                "config": {"epochs": 150, "use_automl": True, "automl_trials": 20},
                "is_favorite": True,
            },
        )
        self.assertEqual(res1.status_code, 200)
        p1 = res1.json()
        self.assertEqual(p1["name"], "BTC Scalper XGB")
        self.assertEqual(p1["user_id"], 1)
        self.assertTrue(p1["is_favorite"])

        res2 = self.client.post(
            "/api/v1/model-training/tools/presets",
            json={
                "name": "ETH Swing RF",
                "symbol": "ETH/USDT",
                "timeframe": "1h",
                "algorithm": "Random Forest",
                "config": {"epochs": 100},
                "is_favorite": False,
            },
        )
        self.assertEqual(res2.status_code, 200)
        p2 = res2.json()

        # User 1 lists presets (favorites first)
        list_res = self.client.get("/api/v1/model-training/tools/presets")
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["id"], p1["id"])

        # Switch to User 2: cannot see or delete User 1's preset
        self.current_user_id = 2
        u2_list = self.client.get("/api/v1/model-training/tools/presets")
        self.assertEqual(u2_list.status_code, 200)
        self.assertEqual(u2_list.json(), [])

        u2_del = self.client.delete(f"/api/v1/model-training/tools/presets/{p1['id']}")
        self.assertEqual(u2_del.status_code, 404)

        # Switch back to User 1: delete succeeds
        self.current_user_id = 1
        del_res = self.client.delete(f"/api/v1/model-training/tools/presets/{p2['id']}")
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["deleted_id"], p2["id"])

        after_list = self.client.get("/api/v1/model-training/tools/presets").json()
        self.assertEqual(len(after_list), 1)

    def test_clone_job_config_and_ownership(self):
        db = self.TestSessionLocal()
        try:
            j1 = ModelTrainingJob(
                id="job_u1_1",
                user_id=1,
                symbol="BTC/USDT",
                timeframe="1h",
                algorithm="LightGBM",
                status=TrainingStatus.COMPLETED,
                config={"epochs": 200, "learning_rate": 0.05, "indicators": ["RSI", "MACD"]},
            )
            j2 = ModelTrainingJob(
                id="job_u2_1",
                user_id=2,
                symbol="SOL/USDT",
                timeframe="5m",
                algorithm="XGBoost",
                status=TrainingStatus.COMPLETED,
                config={"epochs": 50},
            )
            db.add_all([j1, j2])
            db.commit()
        finally:
            db.close()

        ok_res = self.client.get("/api/v1/model-training/tools/jobs/job_u1_1/clone-config")
        self.assertEqual(ok_res.status_code, 200)
        body = ok_res.json()
        self.assertEqual(body["job_id"], "job_u1_1")
        self.assertEqual(body["symbol"], "BTC/USDT")
        self.assertEqual(body["algorithm"], "LightGBM")
        self.assertEqual(body["config"]["learning_rate"], 0.05)

        # Other user's job returns 404
        forbidden_res = self.client.get("/api/v1/model-training/tools/jobs/job_u2_1/clone-config")
        self.assertEqual(forbidden_res.status_code, 404)

        missing_res = self.client.get("/api/v1/model-training/tools/jobs/nonexistent/clone-config")
        self.assertEqual(missing_res.status_code, 404)

    def test_preflight_ohlcv_ccxt_pass_and_marketdata_fallback(self):
        # Generate 250 clean OHLCV bars via mocked CCXT
        rng = np.random.default_rng(42)
        closes = 50000.0 + np.cumsum(rng.normal(0, 100, size=250))
        bars = [
            [1700000000000 + i * 3600000, c - 10, c + 20, c - 20, c, 100.0 + i]
            for i, c in enumerate(closes)
        ]

        mock_client = MagicMock()
        mock_client.fetch_ohlcv.return_value = bars
        mock_exchange_cls = MagicMock(return_value=mock_client)

        with patch.object(tsa_svc.ccxt, "binance", mock_exchange_cls):
            res = self.client.post(
                "/api/v1/model-training/tools/preflight",
                json={
                    "symbol": "BTC/USDT",
                    "timeframe": "1h",
                    "data_source": "ohlcv",
                    "exchange": "binance",
                    "lookback_limit": 250,
                },
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_rows"], 250)
        self.assertEqual(data["feature_count"], 5)
        self.assertEqual(data["missing_pct"], 0.0)
        self.assertEqual(data["duplicate_rows"], 0)
        self.assertEqual(data["constant_columns"], [])
        self.assertEqual(data["status"], "PASS")
        self.assertGreaterEqual(data["health_score"], 80)
        self.assertIsNotNone(data["class_balance"])
        self.assertAlmostEqual(
            data["class_balance"]["up_pct"] + data["class_balance"]["down_pct"],
            100.0,
            places=1,
        )

        # Now simulate CCXT offline -> fallback to MarketData
        db = self.TestSessionLocal()
        try:
            base_ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
            for i in range(60):
                c = 3000.0 + (i * 5 if i % 2 == 0 else -i * 2)
                db.add(
                    MarketData(
                        exchange="binance",
                        symbol="ETH/USDT",
                        timeframe="1h",
                        timestamp=base_ts + timedelta(hours=i),
                        open=c - 2,
                        high=c + 5,
                        low=c - 5,
                        close=c,
                        volume=500.0 + i,
                    )
                )
            db.commit()
        finally:
            db.close()

        failing_client = MagicMock()
        failing_client.fetch_ohlcv.side_effect = RuntimeError("Network timeout")
        with patch.object(tsa_svc.ccxt, "binance", MagicMock(return_value=failing_client)):
            fb_res = self.client.post(
                "/api/v1/model-training/tools/preflight",
                json={"symbol": "ETH/USDT", "timeframe": "1h", "data_source": "ohlcv"},
            )
        self.assertEqual(fb_res.status_code, 200)
        fb_data = fb_res.json()
        self.assertEqual(fb_data["total_rows"], 60)
        self.assertIn(fb_data["status"], ("WARN", "PASS"))
        self.assertTrue(any("MarketData" in w for w in fb_data["warnings"]))

        # Offline CCXT + empty MarketData -> graceful FAIL
        with patch.object(tsa_svc.ccxt, "binance", MagicMock(return_value=failing_client)):
            empty_res = self.client.post(
                "/api/v1/model-training/tools/preflight",
                json={"symbol": "DOGE/USDT", "timeframe": "1h", "data_source": "ohlcv"},
            )
        self.assertEqual(empty_res.status_code, 200)
        self.assertEqual(empty_res.json()["status"], "FAIL")
        self.assertEqual(empty_res.json()["health_score"], 0)

    def test_preflight_csv_health_leakage_and_traversal_guard(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            l2_dir = os.path.join(tmpdir, "l2_snapshots")
            os.makedirs(l2_dir, exist_ok=True)
            patched_map = {
                "l2_orderbook": l2_dir,
                "hybrid_deep": os.path.join(tmpdir, "hybrid_snapshots"),
                "historical_trades": os.path.join(tmpdir, "historical_trades"),
            }

            # Build dirty CSV with NaNs, duplicates, constant column, outlier, and leakage
            n = 120
            rng = np.random.default_rng(7)
            close = 100.0 + np.cumsum(rng.normal(0, 0.5, size=n))
            close[-1] = close[-2]  # ensure last row has 0 next_ret before duplicating
            next_ret = pd.Series(close).pct_change().shift(-1).fillna(0.0).values

            df = pd.DataFrame(
                {
                    "timestamp": pd.date_range("2026-01-01", periods=n, freq="1min").astype(str),
                    "close": close,
                    "obi": rng.normal(0, 0.2, size=n),
                    "const_col": np.ones(n),
                    "future_signal": next_ret * 100.0,  # suspicious name + >0.98 corr
                    "leaky_hidden": next_ret * 2.0 + 1.0,  # >0.98 corr with next-bar return
                }
            )
            df.loc[5:15, "obi"] = np.nan
            df.loc[50, "obi"] = 5000.0  # extreme z > 4 outlier
            df = pd.concat([df, df.iloc[[-1, -1]]], ignore_index=True)  # duplicates with identical close -> 0.0 next_ret

            csv_path = os.path.join(l2_dir, "l2_sample.csv")
            df.to_csv(csv_path, index=False)

            with patch.dict(tsa_svc.DATASET_DIR_MAP, patched_map, clear=True):
                # 1. Path traversal attempts -> 400
                for bad_name in ["../secret.csv", "../../etc/passwd", "sub/l2_sample.csv", "a\\b.csv"]:
                    bad_res = self.client.post(
                        "/api/v1/model-training/tools/preflight",
                        json={
                            "symbol": "BTC/USDT",
                            "data_source": "l2_orderbook",
                            "dataset_file": bad_name,
                        },
                    )
                    self.assertEqual(bad_res.status_code, 400, f"Expected 400 for {bad_name}")

                # 2. Missing CSV -> graceful FAIL
                missing_res = self.client.post(
                    "/api/v1/model-training/tools/preflight",
                    json={
                        "symbol": "BTC/USDT",
                        "data_source": "l2_orderbook",
                        "dataset_file": "does_not_exist.csv",
                    },
                )
                self.assertEqual(missing_res.status_code, 200)
                self.assertEqual(missing_res.json()["status"], "FAIL")

                # 3. Valid CSV inspection
                ok_res = self.client.post(
                    "/api/v1/model-training/tools/preflight",
                    json={
                        "symbol": "BTC/USDT",
                        "data_source": "l2_orderbook",
                        "dataset_file": "l2_sample.csv",
                    },
                )
                self.assertEqual(ok_res.status_code, 200)
                report = ok_res.json()
                self.assertEqual(report["total_rows"], n + 2)
                self.assertGreater(report["missing_pct"], 0.0)
                self.assertTrue(any(c["column"] == "obi" for c in report["nan_columns"]))
                self.assertEqual(report["duplicate_rows"], 2)
                self.assertIn("const_col", report["constant_columns"])
                self.assertGreater(report["outlier_pct"], 0.0)
                leak_cols = {r["column"] for r in report["leakage_risks"]}
                self.assertIn("future_signal", leak_cols)
                self.assertIn("leaky_hidden", leak_cols)
                self.assertIn(report["status"], ("WARN", "FAIL"))
                self.assertTrue(len(report["warnings"]) >= 4)
                self.assertTrue(len(report["recommendations"]) >= 3)

    def test_compare_models_joins_versions_and_jobs(self):
        db = self.TestSessionLocal()
        try:
            # Crypto model for user 1
            m1 = CustomMLModel(
                id="m_crypto_1",
                name="BTC Alpha XGB",
                model_type="XGBoost",
                market_type="crypto",
                active_version_id="v1_m1",
                user_id=1,
            )
            v1 = ModelVersion(
                id="v1_m1",
                model_id="m_crypto_1",
                version=1.0,
                file_path="uploads/models/m1.pkl",
                status=ModelStatus.READY,
                accuracy=0.78,
                f1_score=0.76,
                latency=4.2,
                explainability={
                    "featureImportance": [
                        {"name": "RSI_14", "value": 0.42},
                        {"name": "MACD", "value": 0.31},
                    ],
                    "optuna_trials": [{"number": 0, "value": 0.72, "params": {}, "state": "COMPLETE"}],
                    "backtest_result": {
                        "profit_pct": 18.5,
                        "win_rate": 61.2,
                        "max_drawdown": 5.4,
                        "kelly_pct": 12.0,
                        "monte_carlo_var": 7.1,
                        "total_trades": 44,
                    },
                },
            )
            j1 = ModelTrainingJob(
                id="job_m1",
                user_id=1,
                symbol="BTC/USDT",
                timeframe="15m",
                algorithm="XGBoost",
                status=TrainingStatus.COMPLETED,
                output_model_id="m_crypto_1",
                config={"dataset_type": "ohlcv"},
                completed_at=datetime.now(timezone.utc),
            )

            # Forex model for user 1 (must be excluded)
            m_forex = CustomMLModel(
                id="m_forex_1",
                name="EURUSD Bot",
                model_type="LSTM",
                market_type="forex",
                user_id=1,
            )
            # Other user's crypto model (must be excluded)
            m_other = CustomMLModel(
                id="m_other_1",
                name="Other User Model",
                model_type="Random Forest",
                market_type="crypto",
                user_id=2,
            )
            db.add_all([m1, v1, j1, m_forex, m_other])
            db.commit()
        finally:
            db.close()

        res = self.client.get("/api/v1/model-training/tools/compare")
        self.assertEqual(res.status_code, 200)
        rows = res.json()
        self.assertEqual(len(rows), 1)
        item = rows[0]
        self.assertEqual(item["model_id"], "m_crypto_1")
        self.assertEqual(item["symbol"], "BTC/USDT")
        self.assertEqual(item["timeframe"], "15m")
        self.assertEqual(item["data_source"], "ohlcv")
        self.assertEqual(item["accuracy"], 0.78)
        self.assertEqual(item["profit_pct"], 18.5)
        self.assertEqual(item["win_rate"], 61.2)
        self.assertEqual(item["max_drawdown"], 5.4)
        self.assertEqual(item["kelly_pct"], 12.0)
        self.assertEqual(item["sharpe_or_var"], 7.1)
        self.assertEqual(item["total_trades"], 44)
        self.assertEqual(item["optuna_trials_count"], 1)
        self.assertEqual(item["top_features"][0], {"name": "RSI_14", "importance": 0.42})

    def test_queue_status_and_eta_with_mocked_celery(self):
        now = datetime.now(timezone.utc)
        db = self.TestSessionLocal()
        try:
            # Historical completed job (100 seconds)
            db.add(
                ModelTrainingJob(
                    id="job_done_1",
                    user_id=1,
                    symbol="BTC/USDT",
                    timeframe="1h",
                    algorithm="XGBoost",
                    status=TrainingStatus.COMPLETED,
                    created_at=now - timedelta(seconds=200),
                    completed_at=now - timedelta(seconds=100),
                )
            )
            # Active job for user 1 at 50% progress -> ~50s remaining
            db.add(
                ModelTrainingJob(
                    id="job_run_u1",
                    user_id=1,
                    symbol="BTC/USDT",
                    timeframe="1h",
                    algorithm="XGBoost",
                    status=TrainingStatus.RUNNING,
                    progress=50.0,
                    created_at=now - timedelta(seconds=40),
                )
            )
            # Queued job for user 2
            db.add(
                ModelTrainingJob(
                    id="job_pend_u2",
                    user_id=2,
                    symbol="ETH/USDT",
                    timeframe="15m",
                    algorithm="XGBoost",
                    status=TrainingStatus.PENDING,
                    progress=0.0,
                    created_at=now - timedelta(seconds=10),
                )
            )
            db.commit()
        finally:
            db.close()

        mock_inspect = MagicMock()
        mock_inspect.active.return_value = {"worker1@host": [{"id": "job_run_u1"}]}
        with patch("app.celery_app.celery_app.control.inspect", return_value=mock_inspect):
            res = self.client.get("/api/v1/model-training/tools/queue-status")
        self.assertEqual(res.status_code, 200)
        q = res.json()
        self.assertEqual(q["active_jobs"], 1)
        self.assertEqual(q["queued_jobs"], 1)
        self.assertEqual(q["user_active_jobs"], 1)
        self.assertEqual(q["user_queued_jobs"], 0)
        self.assertEqual(q["celery_workers_online"], 1)
        self.assertEqual(len(q["jobs"]), 2)
        self.assertTrue(q["jobs"][0]["is_mine"])
        self.assertFalse(q["jobs"][1]["is_mine"])
        self.assertAlmostEqual(q["jobs"][0]["eta_seconds"], 50.0, delta=1.0)
        self.assertGreater(q["estimated_wait_seconds"], 0.0)

        # Celery inspect raises -> never crashes
        with patch("app.celery_app.celery_app.control.inspect", side_effect=ConnectionError("Redis offline")):
            safe_res = self.client.get("/api/v1/model-training/tools/queue-status")
        self.assertEqual(safe_res.status_code, 200)
        self.assertEqual(safe_res.json()["celery_workers_online"], 0)

    def test_optuna_trials_endpoint_and_automl_trials_out(self):
        # 1. Verify run_optuna_study populates trials_out sorted by number
        rng = np.random.default_rng(123)
        X_tr = pd.DataFrame(rng.normal(size=(40, 4)), columns=["f1", "f2", "f3", "f4"])
        y_tr = (X_tr["f1"].values > 0).astype(int)
        X_va = pd.DataFrame(rng.normal(size=(20, 4)), columns=["f1", "f2", "f3", "f4"])
        y_va = (X_va["f1"].values > 0).astype(int)

        trials_out = []
        best_params = ml_automl.run_optuna_study(
            algorithm="Random Forest",
            X_train=X_tr,
            y_train=y_tr,
            X_val=X_va,
            y_val=y_va,
            is_classification=True,
            n_trials=3,
            trials_out=trials_out,
        )
        self.assertIsInstance(best_params, dict)
        self.assertGreater(len(best_params), 0)
        self.assertEqual(len(trials_out), 3)
        self.assertEqual([t["number"] for t in trials_out], [0, 1, 2])
        self.assertIn("n_estimators", trials_out[0]["params"])
        self.assertEqual(trials_out[0]["state"], "COMPLETE")

        # 2. Verify GET /optuna-trials/{model_id} from explainability & metadata.json fallback
        with tempfile.TemporaryDirectory() as tmpdir:
            meta_file = os.path.join(tmpdir, "meta.json")
            with open(meta_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "prediction_target": "regression",
                        "explainability": {
                            "optuna_trials": [
                                {"number": 1, "value": 0.015, "params": {"max_depth": 4}, "state": "COMPLETE"},
                                {"number": 0, "value": 0.042, "params": {"max_depth": 8}, "state": "COMPLETE"},
                            ]
                        },
                    },
                    f,
                )

            db = self.TestSessionLocal()
            try:
                m_exp = CustomMLModel(
                    id="m_opt_1",
                    name="Optuna Cls",
                    model_type="Random Forest",
                    active_version_id="v_opt_1",
                    user_id=1,
                )
                v_exp = ModelVersion(
                    id="v_opt_1",
                    model_id="m_opt_1",
                    version=1.0,
                    file_path="m.pkl",
                    status=ModelStatus.READY,
                    explainability={
                        "prediction_target": "classification",
                        "optuna_trials": trials_out,
                    },
                )
                m_meta = CustomMLModel(
                    id="m_opt_2",
                    name="Optuna Reg Meta",
                    model_type="XGBoost",
                    active_version_id="v_opt_2",
                    user_id=1,
                )
                v_meta = ModelVersion(
                    id="v_opt_2",
                    model_id="m_opt_2",
                    version=1.0,
                    file_path="m2.pkl",
                    metadata_path=meta_file,
                    status=ModelStatus.READY,
                    explainability=None,
                )
                db.add_all([m_exp, v_exp, m_meta, v_meta])
                db.commit()
            finally:
                db.close()

            r1 = self.client.get("/api/v1/model-training/tools/optuna-trials/m_opt_1")
            self.assertEqual(r1.status_code, 200)
            d1 = r1.json()
            self.assertEqual(len(d1["trials"]), 3)
            self.assertIsNotNone(d1["best_trial_number"])
            self.assertIsNotNone(d1["best_value"])

            # Regression fallback from metadata.json should pick min value (trial 1 -> 0.015)
            r2 = self.client.get("/api/v1/model-training/tools/optuna-trials/m_opt_2")
            self.assertEqual(r2.status_code, 200)
            d2 = r2.json()
            self.assertEqual([t["number"] for t in d2["trials"]], [0, 1])
            self.assertEqual(d2["best_trial_number"], 1)
            self.assertAlmostEqual(d2["best_value"], 0.015)
            self.assertEqual(d2["best_params"], {"max_depth": 4})

            # Ownership check
            self.current_user_id = 2
            r_unauth = self.client.get("/api/v1/model-training/tools/optuna-trials/m_opt_1")
            self.assertEqual(r_unauth.status_code, 404)


if __name__ == "__main__":
    unittest.main()
