import json
import math
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import ccxt
import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import CustomMLModel, MarketData, ModelTrainingJob, ModelVersion, TrainingPreset, TrainingStatus
from app.schemas.training_studio_tools import (
    CloneJobConfigOut,
    LeakageRiskInfo,
    ModelCompareItem,
    NanColumnInfo,
    OptunaTrialItem,
    OptunaTrialsOut,
    PreFlightRequest,
    PreFlightResponse,
    TopFeatureItem,
    TrainingPresetCreate,
    WorkerQueueJobItem,
    WorkerQueueStatusOut,
)

DATASET_DIR_MAP: Dict[str, str] = {
    "l2_orderbook": os.path.join("uploads", "l2_snapshots"),
    "hybrid_deep": os.path.join("uploads", "hybrid_snapshots"),
    "historical_trades": os.path.join("uploads", "historical_trades"),
}

_SUSPICIOUS_COL_RE = re.compile(r"(future|target|next_|lead_)", re.IGNORECASE)
_TIMESTAMP_COLS = {"timestamp", "datetime", "date", "time"}
_DEFAULT_ALGO_DURATION_SEC = 120.0


def _to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _validate_safe_dataset_path(base_dir: str, dataset_file: str) -> str:
    """Validate dataset filename and ensure resolved path remains strictly inside base_dir."""
    if (
        not dataset_file
        or ".." in dataset_file
        or "/" in dataset_file
        or "\\" in dataset_file
        or os.path.basename(dataset_file) != dataset_file
    ):
        raise HTTPException(status_code=400, detail="Invalid dataset filename: path traversal is not allowed.")

    safe_name = os.path.basename(dataset_file)
    base_real = os.path.realpath(base_dir)
    target_real = os.path.realpath(os.path.join(base_real, safe_name))
    if not target_real.startswith(base_real + os.sep):
        raise HTTPException(status_code=400, detail="Invalid dataset path: escapes allowed directory.")
    return target_real


def _load_local_dataset(data_source: str, dataset_file: Optional[str], lookback_limit: int) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
    base_dir = DATASET_DIR_MAP[data_source]
    if not dataset_file:
        return None, f"No dataset_file provided for data_source='{data_source}'."

    resolved_path = _validate_safe_dataset_path(base_dir, dataset_file)
    if not os.path.isfile(resolved_path):
        return None, f"Dataset file '{os.path.basename(dataset_file)}' not found in '{base_dir}'."

    try:
        if resolved_path.lower().endswith(".parquet"):
            df = pd.read_parquet(resolved_path)
        else:
            df = pd.read_csv(resolved_path)
        if len(df) > lookback_limit:
            df = df.tail(lookback_limit).reset_index(drop=True)
        return df, None
    except Exception as exc:
        return None, f"Failed to read dataset file '{os.path.basename(dataset_file)}': {exc}"


def _fetch_ohlcv_dataframe(
    db: Session,
    symbol: str,
    timeframe: str,
    exchange_name: str,
    lookback_limit: int,
) -> Tuple[Optional[pd.DataFrame], List[str]]:
    warnings: List[str] = []
    ex_id = (exchange_name or "binance").lower().strip()
    limit = min(max(int(lookback_limit), 10), 5000)

    exchange_cls = getattr(ccxt, ex_id, None)
    if exchange_cls is not None:
        client = exchange_cls({"enableRateLimit": True, "timeout": 6000})
        try:
            bars = client.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            if bars:
                df = pd.DataFrame(bars, columns=["timestamp", "open", "high", "low", "close", "volume"])
                return df, warnings
            warnings.append(f"CCXT '{ex_id}' returned 0 bars for {symbol} ({timeframe}); falling back to MarketData.")
        except Exception as exc:
            warnings.append(f"CCXT '{ex_id}' unavailable ({exc}); falling back to local MarketData.")
        finally:
            close_fn = getattr(client, "close", None)
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass
    else:
        warnings.append(f"Unknown CCXT exchange '{ex_id}'; falling back to local MarketData.")

    # Fallback to MarketData table
    rows = (
        db.query(MarketData)
        .filter(
            MarketData.exchange == ex_id,
            MarketData.symbol == symbol,
            MarketData.timeframe == timeframe,
        )
        .order_by(MarketData.timestamp.desc())
        .limit(limit)
        .all()
    )
    if not rows:
        rows = (
            db.query(MarketData)
            .filter(MarketData.symbol == symbol, MarketData.timeframe == timeframe)
            .order_by(MarketData.timestamp.desc())
            .limit(limit)
            .all()
        )

    if not rows:
        warnings.append(f"No fallback MarketData rows found for {symbol} ({timeframe}).")
        return None, warnings

    rows.reverse()
    df = pd.DataFrame(
        [
            {
                "timestamp": r.timestamp,
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
            }
            for r in rows
        ]
    )
    return df, warnings


def _empty_fail_preflight(warning_msg: str, recommendation_msg: str) -> PreFlightResponse:
    return PreFlightResponse(
        total_rows=0,
        feature_count=0,
        missing_pct=0.0,
        nan_columns=[],
        duplicate_rows=0,
        constant_columns=[],
        outlier_pct=0.0,
        class_balance=None,
        leakage_risks=[],
        health_score=0,
        status="FAIL",
        warnings=[warning_msg],
        recommendations=[recommendation_msg],
    )


def _compute_dataframe_health(df: pd.DataFrame, requested_features: List[str]) -> PreFlightResponse:
    warnings: List[str] = []
    recommendations: List[str] = []

    if df is None or df.empty:
        return _empty_fail_preflight(
            "Dataset contains 0 rows.",
            "Verify symbol/timeframe availability or upload a populated dataset file.",
        )

    work_df = df.replace([np.inf, -np.inf], np.nan)
    total_rows = int(len(work_df))
    feature_cols = [c for c in work_df.columns if str(c).lower() not in _TIMESTAMP_COLS]
    feature_count = len(feature_cols)

    # Missing statistics
    total_cells = max(1, total_rows * max(1, len(work_df.columns)))
    total_missing = int(work_df.isna().sum().sum())
    missing_pct = round(float(total_missing) / total_cells * 100.0, 2)

    nan_columns: List[NanColumnInfo] = []
    for col in work_df.columns:
        cnt = int(work_df[col].isna().sum())
        if cnt > 0:
            nan_columns.append(
                NanColumnInfo(
                    column=str(col),
                    missing_count=cnt,
                    missing_pct=round(cnt / total_rows * 100.0, 2),
                )
            )
    nan_columns.sort(key=lambda x: (-x.missing_count, x.column))
    nan_columns = nan_columns[:10]

    duplicate_rows = int(work_df.duplicated().sum())

    # Constant columns (zero variance / <= 1 distinct non-null value)
    constant_columns: List[str] = []
    for col in feature_cols:
        if work_df[col].dropna().nunique() <= 1:
            constant_columns.append(str(col))

    # Outliers: rows with |z-score| > 4 on any non-constant numeric feature column
    numeric_cols = [
        c for c in work_df[feature_cols].select_dtypes(include=[np.number]).columns
    ] if feature_cols else []
    outlier_pct = 0.0
    if numeric_cols and total_rows >= 2:
        outlier_row_mask = pd.Series(False, index=work_df.index)
        for col in numeric_cols:
            series = pd.to_numeric(work_df[col], errors="coerce")
            std = series.std(ddof=0)
            if pd.notna(std) and std > 0:
                z = (series - series.mean()).abs() / std
                outlier_row_mask = outlier_row_mask | (z > 4.0).fillna(False)
        outlier_pct = round(float(outlier_row_mask.sum()) / total_rows * 100.0, 2)

    # Class balance from next-bar return > 0 if close exists
    close_col = next((c for c in work_df.columns if str(c).lower() == "close"), None)
    class_balance: Optional[Dict[str, float]] = None
    next_ret: Optional[pd.Series] = None
    if close_col is not None and total_rows >= 2:
        close_series = pd.to_numeric(work_df[close_col], errors="coerce")
        next_ret = close_series.pct_change().shift(-1)
        valid_ret = next_ret.dropna()
        if len(valid_ret) > 0:
            up_pct = round(float((valid_ret > 0).mean() * 100.0), 2)
            down_pct = round(100.0 - up_pct, 2)
            class_balance = {"up_pct": up_pct, "down_pct": down_pct}

    # Leakage risk detection: suspicious names or >0.98 correlation with next-bar return
    leakage_risks: List[LeakageRiskInfo] = []
    flagged_cols = set()

    for col in list(feature_cols) + [f for f in requested_features if f not in feature_cols]:
        col_str = str(col)
        if _SUSPICIOUS_COL_RE.search(col_str) and col_str not in flagged_cols:
            flagged_cols.add(col_str)
            leakage_risks.append(
                LeakageRiskInfo(
                    column=col_str,
                    reason="Suspicious column name matching future/target/lead pattern",
                    correlation=None,
                )
            )

    if next_ret is not None and total_rows >= 5:
        for col in numeric_cols:
            col_str = str(col)
            if col_str in flagged_cols:
                continue
            series = pd.to_numeric(work_df[col], errors="coerce")
            aligned = pd.concat([series, next_ret], axis=1).dropna()
            if len(aligned) >= 5:
                s_std = aligned.iloc[:, 0].std(ddof=0)
                r_std = aligned.iloc[:, 1].std(ddof=0)
                if s_std > 0 and r_std > 0:
                    corr = _safe_float(aligned.iloc[:, 0].corr(aligned.iloc[:, 1]))
                    if corr is not None and abs(corr) > 0.98:
                        flagged_cols.add(col_str)
                        leakage_risks.append(
                            LeakageRiskInfo(
                                column=col_str,
                                reason=f"Extreme correlation ({corr:.4f}) with next-bar return",
                                correlation=round(corr, 4),
                            )
                        )

    # Health score & recommendations
    score = 100.0

    if total_rows < 50:
        score -= 45.0
        warnings.append(f"Very small dataset ({total_rows} rows); training may severely overfit.")
        recommendations.append("Increase lookback_limit or collect at least 200+ rows before training.")
    elif total_rows < 200:
        score -= 15.0
        warnings.append(f"Limited sample size ({total_rows} rows); cross-validation stability may suffer.")
        recommendations.append("Consider increasing lookback_limit to 500+ bars.")

    if missing_pct > 20.0:
        score -= 35.0
        warnings.append(f"High missing value rate ({missing_pct}%).")
        recommendations.append("Clean or impute missing values and drop sparse columns.")
    elif missing_pct > 5.0:
        score -= 15.0
        warnings.append(f"Moderate missing values ({missing_pct}%).")
        recommendations.append("Enable forward-fill or dropna cleaning in preprocessing.")
    elif missing_pct > 0.0:
        score -= min(8.0, missing_pct)
        warnings.append(f"Minor missing values detected ({missing_pct}%).")

    if duplicate_rows > 0:
        dup_pct = duplicate_rows / total_rows * 100.0
        score -= min(15.0, dup_pct * 0.5 + 3.0)
        warnings.append(f"Detected {duplicate_rows} duplicate rows ({dup_pct:.1f}%).")
        recommendations.append("Deduplicate timestamps/rows before training.")

    if constant_columns:
        score -= min(20.0, len(constant_columns) * 5.0)
        warnings.append(f"Zero-variance columns detected: {', '.join(constant_columns[:5])}.")
        recommendations.append("Remove constant columns as they carry zero predictive signal.")

    if outlier_pct > 5.0:
        score -= 15.0
        warnings.append(f"High outlier rate ({outlier_pct}% of rows exceed |z| > 4).")
        recommendations.append("Apply RobustScaler or winsorization to handle extreme spikes.")
    elif outlier_pct > 1.0:
        score -= 5.0
        warnings.append(f"Outliers detected in {outlier_pct}% of rows (|z| > 4).")

    if class_balance is not None and abs(class_balance["up_pct"] - 50.0) > 25.0:
        score -= 10.0
        warnings.append(
            f"Class imbalance detected (up={class_balance['up_pct']}%, down={class_balance['down_pct']}%)."
        )
        recommendations.append("Use SMOTE, class weights, or adjust fee_threshold.")

    if leakage_risks:
        score -= min(40.0, len(leakage_risks) * 20.0)
        cols_str = ", ".join(r.column for r in leakage_risks[:5])
        warnings.append(f"Potential target/future data leakage detected in: {cols_str}.")
        recommendations.append("Remove suspicious future/target columns before training.")

    health_score = int(max(0, min(100, round(score))))
    if total_rows < 20 or health_score < 50 or missing_pct > 40.0:
        status: str = "FAIL"
    elif health_score < 80 or warnings:
        status = "WARN"
    else:
        status = "PASS"

    return PreFlightResponse(
        total_rows=total_rows,
        feature_count=feature_count,
        missing_pct=missing_pct,
        nan_columns=nan_columns,
        duplicate_rows=duplicate_rows,
        constant_columns=constant_columns,
        outlier_pct=outlier_pct,
        class_balance=class_balance,
        leakage_risks=leakage_risks,
        health_score=health_score,
        status=status,
        warnings=warnings,
        recommendations=recommendations,
    )


def run_preflight_check(db: Session, payload: PreFlightRequest) -> PreFlightResponse:
    """Validate dataset source, detect path traversal, and compute Pre-Flight data health metrics."""
    if payload.dataset_file:
        # Enforce traversal check regardless of data_source if dataset_file is provided
        check_dir = DATASET_DIR_MAP.get(payload.data_source, os.path.join("uploads", "datasets"))
        _validate_safe_dataset_path(check_dir, payload.dataset_file)

    if payload.data_source in DATASET_DIR_MAP:
        df, err_msg = _load_local_dataset(payload.data_source, payload.dataset_file, payload.lookback_limit)
        if err_msg:
            return _empty_fail_preflight(
                err_msg,
                "Upload or select a valid CSV/Parquet dataset before starting training.",
            )
        return _compute_dataframe_health(df, payload.features)

    if payload.data_source == "ohlcv":
        df, fetch_warnings = _fetch_ohlcv_dataframe(
            db=db,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            exchange_name=payload.exchange,
            lookback_limit=payload.lookback_limit,
        )
        if df is None or df.empty:
            return _empty_fail_preflight(
                " ".join(fetch_warnings) or f"Could not fetch OHLCV bars for {payload.symbol}.",
                "Verify symbol/exchange format (e.g. BTC/USDT on binance) or populate MarketData.",
            )
        result = _compute_dataframe_health(df, payload.features)
        if fetch_warnings:
            result.warnings = fetch_warnings + result.warnings
            if result.status == "PASS":
                result.status = "WARN"
        return result

    return _empty_fail_preflight(
        f"Unsupported data_source '{payload.data_source}'.",
        "Use 'ohlcv', 'l2_orderbook', 'hybrid_deep', or 'historical_trades'.",
    )


def _read_metadata_file(metadata_path: Optional[str]) -> Dict[str, Any]:
    if not metadata_path or not os.path.exists(metadata_path):
        return {}
    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _get_active_or_latest_version(db: Session, model: CustomMLModel) -> Optional[ModelVersion]:
    if model.active_version_id:
        active = (
            db.query(ModelVersion)
            .filter(ModelVersion.id == model.active_version_id, ModelVersion.model_id == model.id)
            .first()
        )
        if active is not None:
            return active
    return (
        db.query(ModelVersion)
        .filter(ModelVersion.model_id == model.id)
        .order_by(ModelVersion.version.desc(), ModelVersion.upload_date.desc())
        .first()
    )


def _extract_top_features(explain: Dict[str, Any], limit: int = 5) -> List[TopFeatureItem]:
    raw_fi = explain.get("featureImportance") or explain.get("feature_importance")
    items: List[TopFeatureItem] = []
    if isinstance(raw_fi, list):
        for entry in raw_fi:
            if isinstance(entry, dict) and entry.get("name") is not None:
                imp = _safe_float(entry.get("importance") if entry.get("importance") is not None else entry.get("value"))
                items.append(TopFeatureItem(name=str(entry["name"]), importance=imp if imp is not None else 0.0))
    elif isinstance(raw_fi, dict):
        for name, val in raw_fi.items():
            imp = _safe_float(val)
            items.append(TopFeatureItem(name=str(name), importance=imp if imp is not None else 0.0))
    items.sort(key=lambda x: abs(x.importance), reverse=True)
    return items[:limit]


def compare_user_models(db: Session, user_id: int) -> List[ModelCompareItem]:
    """Compare all non-forex CustomMLModels owned by the user."""
    models_list = (
        db.query(CustomMLModel)
        .filter(CustomMLModel.user_id == user_id, CustomMLModel.market_type != "forex")
        .order_by(CustomMLModel.created_at.desc())
        .all()
    )

    results: List[ModelCompareItem] = []
    for model in models_list:
        version = _get_active_or_latest_version(db, model)
        job = (
            db.query(ModelTrainingJob)
            .filter(
                ModelTrainingJob.user_id == user_id,
                ModelTrainingJob.output_model_id == model.id,
                ModelTrainingJob.status == TrainingStatus.COMPLETED,
            )
            .order_by(ModelTrainingJob.completed_at.desc(), ModelTrainingJob.created_at.desc())
            .first()
        )

        meta = _read_metadata_file(version.metadata_path if version else None)
        explain = (
            dict(version.explainability)
            if version and isinstance(version.explainability, dict)
            else dict(meta.get("explainability") or {})
        )
        bt = explain.get("backtest_result") if isinstance(explain.get("backtest_result"), dict) else {}

        job_cfg = job.config if (job and isinstance(job.config, dict)) else {}
        optuna_trials = explain.get("optuna_trials")
        optuna_count = len(optuna_trials) if isinstance(optuna_trials, list) else 0

        sharpe_or_var = (
            _safe_float(explain.get("sharpe_ratio"))
            or _safe_float(bt.get("sharpe_ratio"))
            or _safe_float(bt.get("monte_carlo_var"))
            or _safe_float(explain.get("monte_carlo_var"))
        )

        results.append(
            ModelCompareItem(
                model_id=model.id,
                name=model.name,
                algorithm=model.model_type or (job.algorithm if job else "Unknown"),
                symbol=job.symbol if job else meta.get("symbol"),
                timeframe=job.timeframe if job else meta.get("timeframe"),
                data_source=job_cfg.get("dataset_type") or meta.get("dataset_type"),
                active_version_id=version.id if version else model.active_version_id,
                version=_safe_float(version.version) if version else None,
                accuracy=_safe_float(version.accuracy) if version else None,
                f1_score=_safe_float(version.f1_score) if version else None,
                latency=_safe_float(version.latency) if version else None,
                profit_pct=_safe_float(bt.get("profit_pct") if "profit_pct" in bt else explain.get("total_return_pct")),
                win_rate=_safe_float(bt.get("win_rate") if "win_rate" in bt else explain.get("win_rate")),
                max_drawdown=_safe_float(bt.get("max_drawdown") if "max_drawdown" in bt else explain.get("max_drawdown")),
                kelly_pct=_safe_float(bt.get("kelly_pct") if "kelly_pct" in bt else explain.get("kelly_pct")),
                sharpe_or_var=sharpe_or_var,
                total_trades=_safe_int(bt.get("total_trades") if "total_trades" in bt else explain.get("trades_count")),
                optuna_trials_count=optuna_count,
                top_features=_extract_top_features(explain, limit=5),
                created_at=model.created_at,
            )
        )

    return results


def _get_celery_workers_online() -> int:
    try:
        from app.celery_app import celery_app

        insp = celery_app.control.inspect(timeout=0.8)
        active = insp.active()
        if isinstance(active, dict):
            return len(active)
    except Exception:
        pass
    return 0


def get_worker_queue_status(db: Session, user_id: int) -> WorkerQueueStatusOut:
    """Summarize active/pending training jobs, historical ETA by algorithm, and Celery worker count."""
    now = datetime.now(timezone.utc)

    # Historical average duration per algorithm from recent completed jobs
    completed_jobs = (
        db.query(ModelTrainingJob)
        .filter(
            ModelTrainingJob.status == TrainingStatus.COMPLETED,
            ModelTrainingJob.completed_at.isnot(None),
            ModelTrainingJob.created_at.isnot(None),
        )
        .order_by(ModelTrainingJob.completed_at.desc())
        .limit(200)
        .all()
    )

    durations_by_algo: Dict[str, List[float]] = {}
    all_durations: List[float] = []
    for cj in completed_jobs:
        start = _to_utc(cj.created_at)
        end = _to_utc(cj.completed_at)
        if start and end:
            dur = (end - start).total_seconds()
            if dur > 0:
                durations_by_algo.setdefault(cj.algorithm, []).append(dur)
                all_durations.append(dur)

    avg_by_algo = {algo: sum(vals) / len(vals) for algo, vals in durations_by_algo.items()}
    overall_avg = (sum(all_durations) / len(all_durations)) if all_durations else _DEFAULT_ALGO_DURATION_SEC

    open_jobs = (
        db.query(ModelTrainingJob)
        .filter(ModelTrainingJob.status.in_([TrainingStatus.RUNNING, TrainingStatus.PENDING]))
        .order_by(ModelTrainingJob.created_at.asc())
        .all()
    )

    celery_workers_online = _get_celery_workers_online()
    concurrency = max(1, celery_workers_online)

    active_jobs = 0
    queued_jobs = 0
    user_active_jobs = 0
    user_queued_jobs = 0
    running_remaining_total = 0.0
    pending_ahead_wait = 0.0

    # First pass for running jobs so queued jobs include active backlog
    job_items: List[WorkerQueueJobItem] = []
    running_list = [j for j in open_jobs if j.status == TrainingStatus.RUNNING]
    pending_list = [j for j in open_jobs if j.status == TrainingStatus.PENDING]

    for j in running_list:
        active_jobs += 1
        is_mine = j.user_id == user_id
        if is_mine:
            user_active_jobs += 1
        created_utc = _to_utc(j.created_at)
        elapsed = max(0.0, (now - created_utc).total_seconds()) if created_utc else 0.0
        prog = max(0.0, min(100.0, float(j.progress or 0.0)))
        expected = avg_by_algo.get(j.algorithm, overall_avg)
        eta = max(0.0, round(expected * max(0.0, 1.0 - prog / 100.0), 1))
        running_remaining_total += eta
        job_items.append(
            WorkerQueueJobItem(
                job_id=j.id,
                symbol=j.symbol,
                algorithm=j.algorithm,
                status=j.status.value if hasattr(j.status, "value") else str(j.status),
                progress=round(prog, 2),
                elapsed_seconds=round(elapsed, 1),
                eta_seconds=eta,
                is_mine=is_mine,
            )
        )

    base_wait = running_remaining_total / concurrency
    for j in pending_list:
        queued_jobs += 1
        is_mine = j.user_id == user_id
        if is_mine:
            user_queued_jobs += 1
        created_utc = _to_utc(j.created_at)
        elapsed = max(0.0, (now - created_utc).total_seconds()) if created_utc else 0.0
        expected = avg_by_algo.get(j.algorithm, overall_avg)
        eta = round(base_wait + pending_ahead_wait + expected, 1)
        pending_ahead_wait += expected / concurrency
        job_items.append(
            WorkerQueueJobItem(
                job_id=j.id,
                symbol=j.symbol,
                algorithm=j.algorithm,
                status=j.status.value if hasattr(j.status, "value") else str(j.status),
                progress=round(float(j.progress or 0.0), 2),
                elapsed_seconds=round(elapsed, 1),
                eta_seconds=eta,
                is_mine=is_mine,
            )
        )

    estimated_wait_seconds = round(base_wait + pending_ahead_wait, 1)

    return WorkerQueueStatusOut(
        active_jobs=active_jobs,
        queued_jobs=queued_jobs,
        user_active_jobs=user_active_jobs,
        user_queued_jobs=user_queued_jobs,
        celery_workers_online=celery_workers_online,
        estimated_wait_seconds=estimated_wait_seconds,
        jobs=job_items,
    )


def get_model_optuna_trials(db: Session, model_id: str, user_id: int) -> OptunaTrialsOut:
    """Fetch Optuna trial history for a user-owned model from ModelVersion.explainability or metadata.json."""
    model = (
        db.query(CustomMLModel)
        .filter(CustomMLModel.id == model_id, CustomMLModel.user_id == user_id)
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    version = _get_active_or_latest_version(db, model)
    explain = dict(version.explainability) if (version and isinstance(version.explainability, dict)) else {}
    meta = _read_metadata_file(version.metadata_path if version else None)

    raw_trials = explain.get("optuna_trials")
    if not raw_trials and isinstance(meta.get("explainability"), dict):
        raw_trials = meta["explainability"].get("optuna_trials")
    if not raw_trials:
        raw_trials = meta.get("optuna_trials")

    trials: List[OptunaTrialItem] = []
    if isinstance(raw_trials, list):
        for item in raw_trials:
            if isinstance(item, dict) and "number" in item:
                trials.append(
                    OptunaTrialItem(
                        number=int(item["number"]),
                        value=_safe_float(item.get("value")),
                        params=dict(item.get("params") or {}),
                        state=str(item.get("state") or "COMPLETE"),
                    )
                )
        trials.sort(key=lambda t: t.number)

    prediction_target = explain.get("prediction_target") or meta.get("prediction_target") or "classification"
    is_regression = str(prediction_target).lower() == "regression"

    valued = [t for t in trials if t.value is not None and t.state.upper() == "COMPLETE"]
    if not valued:
        valued = [t for t in trials if t.value is not None]

    best_trial: Optional[OptunaTrialItem] = None
    if valued:
        best_trial = min(valued, key=lambda t: t.value) if is_regression else max(valued, key=lambda t: t.value)

    return OptunaTrialsOut(
        model_id=model.id,
        model_name=model.name,
        algorithm=model.model_type,
        trials=trials,
        best_trial_number=best_trial.number if best_trial else None,
        best_value=best_trial.value if best_trial else None,
        best_params=best_trial.params if best_trial else None,
    )


def list_presets(db: Session, user_id: int) -> List[TrainingPreset]:
    return (
        db.query(TrainingPreset)
        .filter(TrainingPreset.user_id == user_id)
        .order_by(TrainingPreset.is_favorite.desc(), TrainingPreset.created_at.desc())
        .all()
    )


def create_preset(db: Session, user_id: int, payload: TrainingPresetCreate) -> TrainingPreset:
    preset = TrainingPreset(
        user_id=user_id,
        name=payload.name.strip(),
        description=payload.description,
        symbol=payload.symbol.strip(),
        timeframe=payload.timeframe.strip(),
        algorithm=payload.algorithm.strip(),
        config=payload.config or {},
        is_favorite=payload.is_favorite,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


def delete_preset(db: Session, user_id: int, preset_id: int) -> int:
    preset = (
        db.query(TrainingPreset)
        .filter(TrainingPreset.id == preset_id, TrainingPreset.user_id == user_id)
        .first()
    )
    if not preset:
        raise HTTPException(status_code=404, detail="Training preset not found")
    db.delete(preset)
    db.commit()
    return preset_id


def get_clone_job_config(db: Session, user_id: int, job_id: str) -> CloneJobConfigOut:
    job = (
        db.query(ModelTrainingJob)
        .filter(ModelTrainingJob.id == job_id, ModelTrainingJob.user_id == user_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
    return CloneJobConfigOut(
        job_id=job.id,
        symbol=job.symbol,
        timeframe=job.timeframe,
        algorithm=job.algorithm,
        config=dict(job.config) if isinstance(job.config, dict) else {},
    )
