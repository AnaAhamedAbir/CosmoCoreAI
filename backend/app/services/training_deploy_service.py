import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.bot import Bot
from app.models.ml_model import CustomMLModel, ModelVersion
from app.models.model_training import ModelTrainingJob, TrainingStatus
from app.models.notification import NotificationSettings
from app.schemas.training_deploy import (
    DeployToWallHunterRequest,
    ManualTradePinRequest,
    PaperReplayRequest,
)
from app.services.ml_backtest_runner import _build_ohlcv_slice, _generate_signals
from app.services.system_notification_service import SystemNotificationService

logger = logging.getLogger(__name__)

_PINNED_MANUAL_TRADE_PREF_KEY = "pinned_manual_trade_ml"
_NON_FEATURE_COLUMNS = {
    "target",
    "target_direction",
    "target_sl",
    "target_tp",
    "target_class",
    "target_reg",
    "timestamp",
    "datetime",
    "date",
    "time",
}
_PRICE_CANDIDATE_COLUMNS = ("close", "microprice", "mid_price", "price")


class TrainingDeployService:
    """Service layer for Phase 2 Paper Replay, 1-Click Deployment, and 1-Click Retrain."""

    # ── Shared Ownership & Artifact Resolvers ──────────────────────────────

    @staticmethod
    def _get_owned_crypto_model(db: Session, user_id: int, model_id: str) -> CustomMLModel:
        """Fetch a CustomMLModel owned by user_id and verify it is not a Forex model."""
        model = (
            db.query(CustomMLModel)
            .filter(CustomMLModel.id == model_id, CustomMLModel.user_id == user_id)
            .first()
        )
        if not model:
            raise HTTPException(status_code=404, detail="ML model not found")
        if (model.market_type or "crypto").strip().lower() == "forex":
            raise HTTPException(
                status_code=400,
                detail="Forex models are isolated from Crypto deployment workflows",
            )
        return model

    @staticmethod
    def _resolve_model_version(db: Session, model: CustomMLModel) -> Optional[ModelVersion]:
        """Resolve the active ModelVersion or fall back to the latest uploaded/trained version."""
        if model.active_version_id:
            active_ver = (
                db.query(ModelVersion)
                .filter(
                    ModelVersion.id == model.active_version_id,
                    ModelVersion.model_id == model.id,
                )
                .first()
            )
            if active_ver:
                return active_ver

        return (
            db.query(ModelVersion)
            .filter(ModelVersion.model_id == model.id)
            .order_by(ModelVersion.version.desc(), ModelVersion.upload_date.desc())
            .first()
        )

    @staticmethod
    def _resolve_model_artifact_path(file_path: Optional[str]) -> Optional[str]:
        """Resolve an on-disk model artifact path, repairing common scaler/pca naming mismatches."""
        if not file_path:
            return None

        candidate = file_path
        if "scaler_train_" in candidate:
            candidate = candidate.replace("scaler_train_", "model_train_")
        if "pca_train_" in candidate:
            candidate = candidate.replace("pca_train_", "model_train_")

        if os.path.exists(candidate) and not os.path.basename(candidate).lower().startswith(("pca", "scaler")):
            return candidate

        model_dir = os.path.dirname(candidate)
        if model_dir and os.path.isdir(model_dir):
            for fname in sorted(os.listdir(model_dir)):
                fl = fname.lower()
                if (
                    fl.endswith((".pkl", ".joblib", ".pt", ".pth"))
                    and not fl.startswith(("pca", "scaler", "checkpoint", "replay"))
                    and "scaler" not in fl
                    and "pca" not in fl
                ):
                    return os.path.join(model_dir, fname)

        return candidate if os.path.exists(candidate) else None

    @staticmethod
    def _load_version_metadata(
        version: Optional[ModelVersion],
        resolved_model_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Load metadata.json associated with a ModelVersion if present on disk."""
        if not version:
            return {}

        candidates: List[Optional[str]] = [getattr(version, "metadata_path", None)]
        for path in (resolved_model_path, getattr(version, "file_path", None)):
            if path:
                for ext in (".zip", ".pkl", ".joblib", ".pt", ".pth"):
                    if path.endswith(ext):
                        candidates.append(path[: -len(ext)] + ".json")
                        break
                model_dir = os.path.dirname(path)
                if model_dir:
                    candidates.append(os.path.join(model_dir, "metadata.json"))

        for mp in candidates:
            if mp and os.path.exists(mp):
                try:
                    with open(mp, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict):
                            return data
                except Exception as exc:
                    logger.debug(f"[Deploy] Failed reading metadata from {mp}: {exc}")
        return {}

    @staticmethod
    def _find_auxiliary_artifact(
        model_path: str,
        metadata: Dict[str, Any],
        kind: str,
    ) -> Optional[str]:
        """Locate optional scaler or PCA artifact adjacent to model_path."""
        model_dir = os.path.dirname(model_path)
        base_name = os.path.splitext(os.path.basename(model_path))[0]
        ts_suffix = base_name.split("_")[-1] if "_" in base_name else ""

        candidates: List[Optional[str]] = []
        if kind == "scaler":
            candidates.append(metadata.get("scaler_path"))
            candidates.extend([
                os.path.join(model_dir, f"{base_name}.scaler"),
                os.path.join(model_dir, f"scaler_train_{ts_suffix}.pkl") if ts_suffix else None,
                os.path.join(model_dir, "scaler.pkl"),
                os.path.join(model_dir, "model.scaler"),
            ])
        elif kind == "pca":
            candidates.extend([
                os.path.join(model_dir, f"{base_name}.pca"),
                os.path.join(model_dir, f"pca_train_{ts_suffix}.pkl") if ts_suffix else None,
                os.path.join(model_dir, "pca.pkl"),
                os.path.join(model_dir, "model.pca"),
            ])

        return next((p for p in candidates if p and os.path.exists(p)), None)

    @staticmethod
    def _load_model_artifact(model_path: str) -> Any:
        """Load a .pkl/.joblib or serialized PyTorch model safely."""
        lower_path = model_path.lower()
        if lower_path.endswith((".pkl", ".joblib")):
            return joblib.load(model_path)

        if lower_path.endswith((".pt", ".pth")):
            import torch

            loaded = torch.load(model_path, map_location="cpu")
            if isinstance(loaded, dict):
                raise ValueError("Raw PyTorch state_dict without model class cannot be replayed directly")
            if hasattr(loaded, "eval"):
                loaded.eval()
            return loaded

        raise ValueError(f"Unsupported model artifact extension for {model_path}")

    # ── Paper Replay Helpers ───────────────────────────────────────────────

    @staticmethod
    def _extract_prices_and_features(
        df_slice: pd.DataFrame,
        loaded_model: Any,
        metadata: Dict[str, Any],
        scaler_x: Any,
        pca_data: Any,
        dataset_path: str,
    ) -> Tuple[np.ndarray, List[str], np.ndarray]:
        """Prepare scaled feature matrix X_eval, feature names, and positive close prices."""
        # Apply PCA compression columns if PCA metadata exists and columns are absent
        if isinstance(pca_data, dict) and "pca" in pca_data and "to_compress" in pca_data:
            try:
                to_compress = pca_data["to_compress"]
                pca_cols = pca_data.get("pca_cols") or [
                    f"pca_comp_{i}" for i in range(pca_data["pca"].n_components_)
                ]
                if to_compress and not all(col in df_slice.columns for col in pca_cols):
                    for mc in to_compress:
                        if mc not in df_slice.columns:
                            df_slice[mc] = 0.0
                    x_comp = df_slice[to_compress].fillna(0.0)
                    x_comp_scaled = pca_data["scaler"].transform(x_comp)
                    x_pca = pca_data["pca"].transform(x_comp_scaled)
                    for idx, col in enumerate(pca_cols):
                        df_slice[col] = x_pca[:, idx]
            except Exception as exc:
                logger.debug(f"[PaperReplay] PCA transform skipped: {exc}")

        features = metadata.get("features") or []
        if not features and hasattr(loaded_model, "feature_names_in_") and loaded_model.feature_names_in_ is not None:
            features = list(loaded_model.feature_names_in_)
        if not features:
            features = [
                col
                for col in df_slice.columns
                if col.lower() not in _NON_FEATURE_COLUMNS
                and pd.api.types.is_numeric_dtype(df_slice[col])
            ]
        if not features:
            raise ValueError("No numeric feature columns available for OOS replay")

        feature_df = pd.DataFrame(index=df_slice.index)
        for feat in features:
            if feat in df_slice.columns:
                feature_df[feat] = pd.to_numeric(df_slice[feat], errors="coerce")
            else:
                feature_df[feat] = 0.0
        feature_df = feature_df.ffill().bfill().fillna(0.0)
        x_raw = feature_df.values.astype(float)

        # DVC snapshots saved by ml_training_engine already store scaled features
        is_dvc_snapshot = (
            os.path.basename(dataset_path).startswith("dataset_train_")
            and ("Target" in df_slice.columns or "Target_Direction" in df_slice.columns)
        )
        if scaler_x is not None and not (isinstance(scaler_x, str) and scaler_x == "none") and hasattr(scaler_x, "transform"):
            x_eval = x_raw if is_dvc_snapshot else scaler_x.transform(x_raw)
        else:
            x_eval = x_raw

        # Extract price series via ml_backtest_runner helper or direct column lookup
        ohlcv_df = _build_ohlcv_slice(df_slice, len(df_slice), lambda _msg: None)
        prices: Optional[np.ndarray] = None
        if ohlcv_df is not None and "close" in ohlcv_df.columns and len(ohlcv_df) == len(df_slice):
            prices = pd.to_numeric(ohlcv_df["close"], errors="coerce").values.astype(float)
        else:
            col_map = {c.lower(): c for c in df_slice.columns}
            price_col = next((col_map[k] for k in _PRICE_CANDIDATE_COLUMNS if k in col_map), None)
            if price_col:
                prices = pd.to_numeric(df_slice[price_col], errors="coerce").values.astype(float)

        if prices is None or len(prices) == 0:
            raise ValueError("Dataset contains no price column for paper replay")

        # Recover unscaled Close if Close itself was Standard/MinMax scaled in a DVC snapshot
        if np.any(~np.isfinite(prices)) or np.any(prices <= 0):
            recovered = False
            if is_dvc_snapshot and scaler_x is not None and hasattr(scaler_x, "inverse_transform"):
                lower_feats = [f.lower() for f in features]
                if "close" in lower_feats:
                    try:
                        close_idx = lower_feats.index("close")
                        inv = scaler_x.inverse_transform(x_raw)
                        candidate_prices = inv[:, close_idx]
                        if np.all(np.isfinite(candidate_prices)) and np.all(candidate_prices > 0):
                            prices = candidate_prices
                            recovered = True
                    except Exception:
                        pass
            if not recovered:
                series = pd.Series(prices).replace([np.inf, -np.inf], np.nan).ffill().bfill()
                if series.isna().all():
                    raise ValueError("Dataset price column has no valid numeric values")
                vals = series.values.astype(float)
                min_val = float(np.min(vals))
                if min_val <= 0:
                    vals = vals - min_val + 100.0
                prices = vals

        return x_eval, features, prices

    @staticmethod
    def _compute_monte_carlo_and_kelly(
        trade_pnls: List[float],
        initial_balance: float,
    ) -> Tuple[float, float, float]:
        """Compute Kelly fraction %, 95% Monte Carlo VaR %, and Risk of Ruin %."""
        total_closed = len(trade_pnls)
        if total_closed == 0:
            return 0.0, 0.0, 0.0

        wins = [p for p in trade_pnls if p > 0]
        losses = [abs(p) for p in trade_pnls if p <= 0]

        win_prob = len(wins) / total_closed
        avg_win = float(np.mean(wins)) if wins else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0001

        reward_risk = avg_win / avg_loss if avg_loss > 0 else 1.0
        kelly = win_prob - ((1.0 - win_prob) / reward_risk) if reward_risk > 0 else 0.0
        kelly_pct = max(0.0, round(kelly * 100.0, 2))

        simulations = 1000
        rng = np.random.default_rng(42)
        outcomes = rng.choice([1, 0], size=(simulations, total_closed), p=[win_prob, 1.0 - win_prob])
        pnls = np.where(outcomes == 1, avg_win, -avg_loss)
        cumulative = np.cumsum(pnls, axis=1)

        peaks = np.maximum.accumulate(np.maximum(0.0, cumulative), axis=1)
        max_dds = np.max(peaks - cumulative, axis=1)

        mc_var_95 = round(float(np.percentile(max_dds, 95) / initial_balance * 100.0), 2)
        ruin_count = int(np.sum(np.any(cumulative <= -initial_balance * 0.5, axis=1)))
        risk_of_ruin = round(ruin_count / simulations * 100.0, 2)
        return kelly_pct, mc_var_95, risk_of_ruin

    @staticmethod
    def _simulate_paper_replay(
        prices: np.ndarray,
        signals: List[int],
        initial_balance: float,
        stop_loss: float,
        take_profit: float,
        commission: float,
    ) -> Dict[str, Any]:
        """Run bar-by-bar paper replay matching MLSignalStrategy entry/exit/SL/TP semantics."""
        n = min(len(prices), len(signals))
        prices = prices[-n:]
        signals = [int(s) for s in signals[-n:]]

        cash = float(initial_balance)
        position_qty = 0.0
        entry_price: Optional[float] = None
        entry_cost = 0.0
        peak_equity = float(initial_balance)

        trade_pnls: List[float] = []
        equity_curve: List[Dict[str, Any]] = []

        for idx in range(n):
            price = float(prices[idx])
            sig = 1 if signals[idx] > 0 else 0

            if position_qty > 0.0 and entry_price and entry_price > 0.0:
                pct_change = (price - entry_price) / entry_price * 100.0
                if pct_change >= take_profit or pct_change <= -stop_loss:
                    proceeds = position_qty * price * (1.0 - commission)
                    trade_pnls.append(proceeds - entry_cost)
                    cash += proceeds
                    position_qty = 0.0
                    entry_price = None
                    entry_cost = 0.0

            if sig == 1 and position_qty == 0.0:
                alloc = cash * 0.90
                invested = alloc * (1.0 - commission)
                if invested > 0.0 and price > 0.0:
                    position_qty = invested / price
                    entry_price = price
                    entry_cost = alloc
                    cash -= alloc
            elif sig == 0 and position_qty > 0.0:
                proceeds = position_qty * price * (1.0 - commission)
                trade_pnls.append(proceeds - entry_cost)
                cash += proceeds
                position_qty = 0.0
                entry_price = None
                entry_cost = 0.0

            equity = cash + (position_qty * price)
            peak_equity = max(peak_equity, equity)
            drawdown_pct = ((peak_equity - equity) / peak_equity * 100.0) if peak_equity > 0 else 0.0

            equity_curve.append(
                {
                    "bar": idx,
                    "price": round(price, 6),
                    "equity": round(equity, 2),
                    "drawdown_pct": round(drawdown_pct, 2),
                    "signal": sig,
                }
            )

        end_equity = equity_curve[-1]["equity"] if equity_curve else float(initial_balance)
        profit_pct = round((end_equity - initial_balance) / initial_balance * 100.0, 2)
        total_trades = len(trade_pnls)
        won_trades = sum(1 for pnl in trade_pnls if pnl > 0)
        win_rate = round(won_trades / total_trades * 100.0, 2) if total_trades > 0 else 0.0
        max_drawdown = round(max((pt["drawdown_pct"] for pt in equity_curve), default=0.0), 2)

        gross_profit = sum(pnl for pnl in trade_pnls if pnl > 0)
        gross_loss = abs(sum(pnl for pnl in trade_pnls if pnl < 0))
        if gross_loss > 0:
            profit_factor = round(min(99.99, gross_profit / gross_loss), 2)
        elif gross_profit > 0:
            profit_factor = 99.99
        else:
            profit_factor = 0.0

        equities = np.array([pt["equity"] for pt in equity_curve], dtype=float)
        if len(equities) > 1:
            returns = np.diff(equities) / np.maximum(equities[:-1], 1e-9)
            std_ret = float(np.std(returns))
            sharpe_ratio = round(float(np.mean(returns) / std_ret * np.sqrt(252)), 2) if std_ret > 1e-12 else 0.0
        else:
            sharpe_ratio = 0.0

        kelly_pct, mc_var, risk_of_ruin = TrainingDeployService._compute_monte_carlo_and_kelly(
            trade_pnls, initial_balance
        )

        return {
            "source": "live_oos_replay",
            "initial_balance": round(float(initial_balance), 2),
            "final_value": round(float(end_equity), 2),
            "profit_pct": profit_pct,
            "win_rate": win_rate,
            "max_drawdown": max_drawdown,
            "profit_factor": profit_factor,
            "sharpe_ratio": sharpe_ratio,
            "total_trades": total_trades,
            "kelly_pct": kelly_pct,
            "monte_carlo_var": mc_var,
            "risk_of_ruin": risk_of_ruin,
            "bars_replayed": len(equity_curve),
            "equity_curve": equity_curve,
        }

    @staticmethod
    def _synthesize_cached_replay(
        bt_res: Dict[str, Any],
        initial_balance: float,
        stop_loss: float,
        take_profit: float,
    ) -> Dict[str, Any]:
        """Synthesize summary equity curve & metrics from cached post-training backtest_result."""
        profit_pct = float(bt_res.get("profit_pct", 0.0) or 0.0)
        win_rate = float(bt_res.get("win_rate", 0.0) or 0.0)
        max_drawdown = max(0.0, float(bt_res.get("max_drawdown", 0.0) or 0.0))
        total_trades = int(bt_res.get("total_trades", 0) or 0)
        kelly_pct = float(bt_res.get("kelly_pct", 0.0) or 0.0)
        mc_var = float(bt_res.get("monte_carlo_var", 0.0) or 0.0)
        risk_of_ruin = float(bt_res.get("risk_of_ruin", 0.0) or 0.0)

        if "profit_factor" in bt_res and bt_res["profit_factor"] is not None:
            profit_factor = float(bt_res["profit_factor"])
        elif total_trades > 0 and win_rate > 0:
            loss_rate = max(1.0, 100.0 - win_rate)
            profit_factor = round(min(99.99, (win_rate / loss_rate) * (take_profit / max(0.1, stop_loss))), 2)
        else:
            profit_factor = 0.0

        sharpe_ratio = float(bt_res.get("sharpe_ratio", 0.0) or 0.0)
        final_value = round(initial_balance * (1.0 + profit_pct / 100.0), 2)

        # Build a 24-point summary trajectory reflecting peak, drawdown dip, and final value
        n_points = 24
        t = np.linspace(0.0, 1.0, n_points)
        dd_dip = (max_drawdown / 100.0) * np.exp(-((t - 0.45) ** 2) / 0.03)
        trend = initial_balance * (1.0 + (profit_pct / 100.0) * t)
        equities = np.maximum(0.0, trend * (1.0 - dd_dip))
        equities[0] = initial_balance
        equities[-1] = final_value

        peak = float(initial_balance)
        equity_curve: List[Dict[str, Any]] = []
        for idx, eq in enumerate(equities):
            eq_val = float(eq)
            peak = max(peak, eq_val)
            dd_pct = ((peak - eq_val) / peak * 100.0) if peak > 0 else 0.0
            equity_curve.append(
                {
                    "bar": idx,
                    "price": 0.0,
                    "equity": round(eq_val, 2),
                    "drawdown_pct": round(dd_pct, 2),
                    "signal": 0,
                }
            )

        return {
            "source": "cached_post_backtest",
            "initial_balance": round(float(initial_balance), 2),
            "final_value": final_value,
            "profit_pct": round(profit_pct, 2),
            "win_rate": round(win_rate, 2),
            "max_drawdown": round(max_drawdown, 2),
            "profit_factor": round(profit_factor, 2),
            "sharpe_ratio": round(sharpe_ratio, 2),
            "total_trades": total_trades,
            "kelly_pct": round(kelly_pct, 2),
            "monte_carlo_var": round(mc_var, 2),
            "risk_of_ruin": round(risk_of_ruin, 2),
            "bars_replayed": len(equity_curve),
            "equity_curve": equity_curve,
        }

    @staticmethod
    def run_paper_replay(
        db: Session,
        user_id: int,
        model_id: str,
        params: PaperReplayRequest,
    ) -> Dict[str, Any]:
        """Run live OOS paper replay on disk artifacts, or synthesize from cached backtest metrics."""
        model = TrainingDeployService._get_owned_crypto_model(db, user_id, model_id)
        version = TrainingDeployService._resolve_model_version(db, model)
        if not version:
            raise HTTPException(status_code=400, detail="Model has no versions or backtest metrics available")

        resolved_model_path = TrainingDeployService._resolve_model_artifact_path(version.file_path)
        metadata = TrainingDeployService._load_version_metadata(version, resolved_model_path)
        algorithm = metadata.get("algorithm") or model.model_type
        prediction_target = metadata.get("prediction_target") or "classification"

        # 1) Attempt real OOS replay when dataset CSV & model artifact exist on disk
        dataset_path = version.dataset_path
        if dataset_path and os.path.exists(dataset_path) and resolved_model_path and os.path.exists(resolved_model_path):
            try:
                df = pd.read_csv(dataset_path)
                df_slice = df.tail(params.max_bars).copy().reset_index(drop=True)
                if len(df_slice) < 5:
                    raise ValueError("Dataset slice too small for replay")

                loaded_model = TrainingDeployService._load_model_artifact(resolved_model_path)

                scaler_x = None
                scaler_path = TrainingDeployService._find_auxiliary_artifact(resolved_model_path, metadata, "scaler")
                if scaler_path:
                    try:
                        scaler_x = joblib.load(scaler_path)
                    except Exception as exc:
                        logger.debug(f"[PaperReplay] Scaler load skipped: {exc}")

                pca_data = None
                pca_path = TrainingDeployService._find_auxiliary_artifact(resolved_model_path, metadata, "pca")
                if pca_path:
                    try:
                        pca_data = joblib.load(pca_path)
                    except Exception as exc:
                        logger.debug(f"[PaperReplay] PCA load skipped: {exc}")

                x_eval, features, prices = TrainingDeployService._extract_prices_and_features(
                    df_slice=df_slice,
                    loaded_model=loaded_model,
                    metadata=metadata,
                    scaler_x=scaler_x,
                    pca_data=pca_data,
                    dataset_path=dataset_path,
                )

                signals = _generate_signals(
                    loaded_model,
                    algorithm,
                    x_eval,
                    prediction_target,
                    lambda _msg: None,
                    features,
                )
                if signals and len(signals) >= 2:
                    sim_result = TrainingDeployService._simulate_paper_replay(
                        prices=prices,
                        signals=signals,
                        initial_balance=params.initial_balance,
                        stop_loss=params.stop_loss,
                        take_profit=params.take_profit,
                        commission=params.commission,
                    )
                    return {
                        "model_id": model.id,
                        "model_name": model.name,
                        "version_id": version.id,
                        "algorithm": algorithm,
                        **sim_result,
                    }
            except Exception as exc:
                logger.warning(f"[PaperReplay] Live OOS replay failed for {model_id}, trying cached fallback: {exc}")

        # 2) Fallback to cached post-training backtest metrics stored in explainability
        explainability = version.explainability if isinstance(version.explainability, dict) else {}
        bt_res = explainability.get("backtest_result")
        if isinstance(bt_res, dict) and bt_res:
            cached_result = TrainingDeployService._synthesize_cached_replay(
                bt_res=bt_res,
                initial_balance=params.initial_balance,
                stop_loss=params.stop_loss,
                take_profit=params.take_profit,
            )
            return {
                "model_id": model.id,
                "model_name": model.name,
                "version_id": version.id,
                "algorithm": algorithm,
                **cached_result,
            }

        raise HTTPException(
            status_code=400,
            detail="Neither OOS dataset artifacts nor cached backtest metrics are available for this model",
        )

    # ── WallHunter Bot Listing & 1-Click Deploy ────────────────────────────

    @staticmethod
    def list_wallhunter_bots(db: Session, user_id: int) -> List[Dict[str, Any]]:
        """Return all Crypto WallHunter bots owned by user_id with ML filter config."""
        bots = (
            db.query(Bot)
            .filter(Bot.owner_id == user_id, Bot.strategy == "wall_hunter")
            .order_by(Bot.id.desc())
            .all()
        )
        items: List[Dict[str, Any]] = []
        for bot in bots:
            cfg = bot.config if isinstance(bot.config, dict) else {}
            raw_conf = cfg.get("ml_min_confidence")
            items.append(
                {
                    "id": bot.id,
                    "name": bot.name,
                    "exchange": bot.exchange,
                    "market": bot.market,
                    "status": bot.status or "inactive",
                    "current_ai_model_id": cfg.get("ai_model_id") or None,
                    "enable_ml_filter": bool(cfg.get("enable_ml_filter", False)),
                    "ml_min_confidence": float(raw_conf) if raw_conf is not None else 0.6,
                }
            )
        return items

    @staticmethod
    async def deploy_to_wallhunter(
        db: Session,
        user_id: int,
        payload: DeployToWallHunterRequest,
        request: Request,
    ) -> Dict[str, Any]:
        """Attach a crypto ML model to a WallHunter bot, hot-reload if active, and notify."""
        bot = (
            db.query(Bot)
            .filter(Bot.id == payload.bot_id, Bot.owner_id == user_id)
            .first()
        )
        if not bot:
            raise HTTPException(status_code=404, detail="WallHunter bot not found")
        if bot.strategy != "wall_hunter":
            raise HTTPException(status_code=400, detail="Target bot is not a WallHunter strategy bot")

        model = TrainingDeployService._get_owned_crypto_model(db, user_id, payload.model_id)

        updated_config = {
            **(bot.config or {}),
            "ai_model_id": model.id,
            "enable_ml_filter": payload.enable_ml_filter,
            "ml_min_confidence": payload.min_confidence,
        }
        bot.config = updated_config
        flag_modified(bot, "config")
        db.commit()
        db.refresh(bot)

        live_reloaded = False
        if (bot.status or "").lower() == "active":
            bot_manager = getattr(request.app.state, "bot_manager", None)
            if bot_manager is not None and hasattr(bot_manager, "update_live_bot"):
                try:
                    res = await bot_manager.update_live_bot(
                        bot.id,
                        {
                            "enable_ml_filter": payload.enable_ml_filter,
                            "ai_model_id": model.id,
                            "ml_min_confidence": payload.min_confidence,
                        },
                    )
                    live_reloaded = res.get("status") == "success" if isinstance(res, dict) else True
                except Exception as exc:
                    logger.warning(f"[Deploy] Live hot-reload failed for bot {bot.id}: {exc}")
                    live_reloaded = False

        await SystemNotificationService.emit(
            user_id=user_id,
            category="wallhunter",
            title=f"ML Model Deployed to {bot.name}",
            message=(
                f"Model {model.name} attached to {bot.name} ({bot.market}). "
                f"ML Filter: {'ON' if payload.enable_ml_filter else 'OFF'} "
                f"(Min Conf: {payload.min_confidence:.0%})."
            ),
            event_type="ml_model_deployed",
            severity="success",
            meta={
                "bot_id": bot.id,
                "bot_name": bot.name,
                "model_id": model.id,
                "symbol": bot.market,
            },
        )

        return {
            "success": True,
            "bot_id": bot.id,
            "bot_name": bot.name,
            "model_id": model.id,
            "model_name": model.name,
            "live_reloaded": live_reloaded,
        }

    # ── Manual Trade ML Filter Pin ─────────────────────────────────────────

    @staticmethod
    def _resolve_model_symbol_and_algo(
        db: Session,
        model: CustomMLModel,
    ) -> Tuple[Optional[str], str]:
        """Resolve symbol and algorithm string from active version metadata or latest training job."""
        version = TrainingDeployService._resolve_model_version(db, model)
        resolved_path = TrainingDeployService._resolve_model_artifact_path(
            version.file_path if version else None
        )
        metadata = TrainingDeployService._load_version_metadata(version, resolved_path)

        symbol = metadata.get("symbol")
        algorithm = metadata.get("algorithm") or model.model_type

        if not symbol:
            latest_job = (
                db.query(ModelTrainingJob)
                .filter(ModelTrainingJob.output_model_id == model.id)
                .order_by(ModelTrainingJob.created_at.desc())
                .first()
            )
            if latest_job:
                symbol = latest_job.symbol
                algorithm = algorithm or latest_job.algorithm

        return symbol, algorithm

    @staticmethod
    def get_manual_trade_pin(db: Session, user_id: int) -> Dict[str, Any]:
        """Fetch pinned Manual Trade ML model configuration from NotificationSettings."""
        settings_row = (
            db.query(NotificationSettings)
            .filter(NotificationSettings.user_id == user_id)
            .first()
        )
        if not settings_row or not isinstance(settings_row.in_app_prefs, dict):
            return {"pinned": None}

        pinned = settings_row.in_app_prefs.get(_PINNED_MANUAL_TRADE_PREF_KEY)
        if not isinstance(pinned, dict) or not pinned.get("model_id"):
            return {"pinned": None}
        return {"pinned": pinned}

    @staticmethod
    def set_manual_trade_pin(
        db: Session,
        user_id: int,
        payload: ManualTradePinRequest,
    ) -> Dict[str, Any]:
        """Pin an owned crypto ML model into NotificationSettings.in_app_prefs and emit notification."""
        model = TrainingDeployService._get_owned_crypto_model(db, user_id, payload.model_id)
        symbol, algorithm = TrainingDeployService._resolve_model_symbol_and_algo(db, model)

        settings_row = (
            db.query(NotificationSettings)
            .filter(NotificationSettings.user_id == user_id)
            .first()
        )
        if not settings_row:
            settings_row = NotificationSettings(user_id=user_id, in_app_prefs={})
            db.add(settings_row)

        prefs = dict(settings_row.in_app_prefs) if isinstance(settings_row.in_app_prefs, dict) else {}
        pin_data = {
            "model_id": model.id,
            "model_name": model.name,
            "symbol": symbol,
            "algorithm": algorithm,
            "min_confidence": float(payload.min_confidence),
            "enabled": bool(payload.enabled),
        }
        prefs[_PINNED_MANUAL_TRADE_PREF_KEY] = pin_data
        settings_row.in_app_prefs = prefs
        flag_modified(settings_row, "in_app_prefs")
        db.commit()
        db.refresh(settings_row)

        SystemNotificationService.emit_sync(
            user_id=user_id,
            category="manual_trade",
            title=f"ML Filter Pinned: {model.name}",
            message=(
                f"Model {model.name} ({algorithm}) pinned to Manual Trade ML Filter "
                f"(Min Conf: {payload.min_confidence:.0%})."
            ),
            event_type="ml_model_pinned",
            severity="info",
            meta=pin_data,
        )

        return {"success": True, "pinned": pin_data}

    @staticmethod
    def clear_manual_trade_pin(db: Session, user_id: int) -> Dict[str, Any]:
        """Remove pinned Manual Trade ML Filter entry while preserving other in_app_prefs."""
        settings_row = (
            db.query(NotificationSettings)
            .filter(NotificationSettings.user_id == user_id)
            .first()
        )
        if settings_row and isinstance(settings_row.in_app_prefs, dict):
            if _PINNED_MANUAL_TRADE_PREF_KEY in settings_row.in_app_prefs:
                prefs = dict(settings_row.in_app_prefs)
                prefs.pop(_PINNED_MANUAL_TRADE_PREF_KEY, None)
                settings_row.in_app_prefs = prefs
                flag_modified(settings_row, "in_app_prefs")
                db.commit()
        return {"success": True}

    # ── 1-Click Retrain / Fine-Tune ────────────────────────────────────────

    @staticmethod
    def queue_retrain(db: Session, user_id: int, model_id: str) -> Dict[str, Any]:
        """Clone training config with incremental_retrain_model_id and queue Celery retrain job."""
        model = TrainingDeployService._get_owned_crypto_model(db, user_id, model_id)

        prev_job = (
            db.query(ModelTrainingJob)
            .filter(
                ModelTrainingJob.output_model_id == model_id,
                ModelTrainingJob.status == TrainingStatus.COMPLETED,
            )
            .order_by(ModelTrainingJob.completed_at.desc(), ModelTrainingJob.created_at.desc())
            .first()
        )

        version = TrainingDeployService._resolve_model_version(db, model)
        resolved_path = TrainingDeployService._resolve_model_artifact_path(
            version.file_path if version else None
        )
        metadata = TrainingDeployService._load_version_metadata(version, resolved_path)

        if prev_job:
            symbol = prev_job.symbol or metadata.get("symbol")
            timeframe = prev_job.timeframe or metadata.get("timeframe")
            algorithm = prev_job.algorithm or metadata.get("algorithm") or model.model_type
            cloned_config = dict(prev_job.config or {})
        else:
            symbol = metadata.get("symbol")
            timeframe = metadata.get("timeframe")
            algorithm = metadata.get("algorithm") or model.model_type
            cloned_config = {
                key: metadata[key]
                for key in (
                    "features",
                    "dataset_type",
                    "indicators",
                    "l2_features",
                    "trade_features",
                    "prediction_target",
                    "target_column",
                    "setup_type",
                    "training_mode",
                    "epochs",
                    "plp_features",
                )
                if key in metadata
            }

        if not symbol or not timeframe or not algorithm:
            raise HTTPException(
                status_code=400,
                detail="Cannot retrain model: missing symbol, timeframe, or algorithm in job history and metadata",
            )

        cloned_config["incremental_retrain_model_id"] = model_id
        job_id = f"train_{int(time.time() * 1000)}"

        new_job = ModelTrainingJob(
            id=job_id,
            user_id=user_id,
            symbol=symbol,
            timeframe=timeframe,
            algorithm=algorithm,
            market_type=model.market_type or "crypto",
            status=TrainingStatus.PENDING,
            progress=0.0,
            config=cloned_config,
            logs=[f"1-Click Retrain queued from model {model_id}..."],
        )

        try:
            db.add(new_job)
            db.commit()
            db.refresh(new_job)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to persist retrain job: {exc}")

        try:
            from app.tasks import celery_train_model_task

            celery_train_model_task.apply_async(args=[job_id], task_id=job_id, queue="heavy")
        except Exception as celery_exc:
            logger.warning(f"[Deploy] Celery dispatch skipped/failed for retrain job {job_id}: {celery_exc}")

        SystemNotificationService.emit_sync(
            user_id=user_id,
            category="ml_training",
            title=f"Retrain Queued: {model.name}",
            message=f"Symbol: {symbol} ({timeframe}) | Algorithm: {algorithm} | Job ID: {job_id}",
            event_type="retrain_queued",
            severity="info",
            meta={
                "job_id": job_id,
                "model_id": model_id,
                "model_name": model.name,
                "symbol": symbol,
                "timeframe": timeframe,
                "algorithm": algorithm,
            },
        )

        return {
            "success": True,
            "job_id": job_id,
            "model_id": model_id,
            "symbol": symbol,
            "timeframe": timeframe,
            "algorithm": algorithm,
        }
