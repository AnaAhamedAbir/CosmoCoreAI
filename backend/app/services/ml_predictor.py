"""
ml_predictor.py
─────────────────────────────────────────────────────────────
Live Prediction Service for ML Registry Models.

Supports ALL model types:
  - sklearn (Random Forest, XGBoost, LightGBM, CatBoost)
  - PyTorch  (LSTM, GRU, 1D-CNN, DeepLOB, Transformer)
  - PPO-RL   (not applicable — returns HOLD)

Data sources (inferred from metadata.json):
  - ohlcv         : Fetches live OHLCV from CCXT + recalculates indicators
  - l2_orderbook  : Fetches last L2 snapshot from DB
  - default       : Falls back to OHLCV

Flow:
  1. Load metadata.json  → features list, dataset_type, indicators
  2. Fetch live data      → correct source
  3. Calculate indicators → match training
  4. Scale data          → load .scaler file (joblib)
  5. Run inference       → model.predict()
  6. Return signal dict
─────────────────────────────────────────────────────────────
"""

import os
import json
import time
import threading
import numpy as np
import pandas as pd
import joblib
import traceback
from typing import Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session


# ─── Constants & In-Memory Caches ────────────────────────────────────────────

DEEP_LEARNING_ALGOS = {"LSTM", "GRU", "1D-CNN", "DeepLOB", "Transformer", "TCN", "TabNet", "Auto-Encoder"}
SKLEARN_ALGOS       = {"Random Forest", "XGBoost", "LightGBM", "CatBoost", "Custom Ensemble", "Ensemble"}
NEXT_GEN_ALGOS      = {"Mamba SSM", "KAN Network", "JEPA World Model", "Time-LLM", "TTFT", "GNN-RL", "SNN Liquid", "Sparse MoE Router"}

_MODEL_RAM_CACHE = {}       # { model_path: loaded_model }
_SCALER_RAM_CACHE = {}      # { scaler_path: loaded_scaler }
_PCA_RAM_CACHE = {}         # { pca_path: loaded_pca_dict }
_META_RAM_CACHE = {}        # { meta_path: parsed_json_dict }
_DB_MODEL_INFO_CACHE = {}   # { model_id: (model_path, algorithm, metadata_path, explainability, ts) }
_SHARED_CCXT_CLIENTS = {}   # { "binance" | "binanceusdm": ccxt_instance }
_FEATURE_ROW_CACHE = {}     # { f"{model_id}_{symbol}": {"df_tail": pd.DataFrame, "timestamp": float, "refreshing": bool} }
_THREAD_LOCAL = threading.local()


def _get_shared_ccxt_exchange(symbol: str):
    """Returns a singleton CCXT instance to avoid socket/file-descriptor leaks."""
    import ccxt
    key = "binanceusdm" if ":" in str(symbol or "") else "binance"
    ex = _SHARED_CCXT_CLIENTS.get(key)
    if ex is None:
        if key == "binanceusdm":
            ex = ccxt.binanceusdm({'enableRateLimit': True})
        else:
            ex = ccxt.binance({'enableRateLimit': True})
        _SHARED_CCXT_CLIENTS[key] = ex
    return ex


def _build_pre_pca_feature_df(
    symbol: str,
    timeframe: str,
    dataset_type: str,
    indicators: list,
    plp_features: list,
    features: list,
    db: Optional[Session] = None,
    sequence_length: Optional[int] = None,
    fast_limit: bool = False
) -> pd.DataFrame:
    """
    Fetches live OHLCV / L2 data and computes technical indicators, PLP, Forex, and Trade tick features
    (all steps prior to PCA and final scaling).
    """
    if dataset_type in ("l2_orderbook", "hybrid_deep", "hybrid"):
        if db is None:
            from app.db.session import SessionLocal
            tmp_db = SessionLocal()
            try:
                df = _fetch_live_l2_data(symbol, tmp_db, sequence_length=sequence_length)
            finally:
                tmp_db.close()
        else:
            df = _fetch_live_l2_data(symbol, db, sequence_length=sequence_length)
        if df is None or df.empty:
            raise RuntimeError(f"Live L2 data is currently unavailable for {symbol}. Cannot generate a valid prediction for an L2-trained model.")
    else:
        df = _fetch_live_ohlcv(symbol, timeframe, dataset_type, limit=250 if fast_limit else 1000)

    if df is None or df.empty:
        raise RuntimeError(f"Could not fetch live data for {symbol}.")

    # Calculate Indicators & PLP
    if dataset_type not in ("l2_orderbook", "hybrid_deep"):
        df = _calculate_indicators(df, indicators)

    if plp_features:
        try:
            from app.services.predatory_liquidity_pipeline import calculate_plp_features
            plp_df = calculate_plp_features(df, plp_features)
            for col in plp_df.columns:
                if col not in df.columns:
                    df[col] = plp_df[col]
        except Exception as e:
            print(f"[ml_predictor] Failed to calculate PLP features: {e}")

    # Fetch Forex Features
    if dataset_type == 'forex' or '_' in symbol or len(symbol) == 7 and '/' in symbol and not symbol.endswith('USDT'):
        try:
            from app.services.ml.forex_feature_engine import generate_ohlcv_features
            forex_feats_to_calc = plp_features if plp_features else [f for f in features if f in ["session_features", "macro_calendar", "cot_data", "order_flow_imbalance", "liquidity_voids", "retail_sentiment"]]
            forex_feats_to_calc = list(set(forex_feats_to_calc + features))
            if forex_feats_to_calc:
                df = generate_ohlcv_features(df, forex_feats_to_calc)
        except Exception as e:
            print(f"[ml_predictor] Failed to calculate Forex features: {e}")

    # Fetch Recent Trades for Hybrid/Trade features
    trade_features = {'cvd', 'buy_volume', 'sell_volume', 'trade_count', 'aggressor_ratio', 'large_trade_flag', 'vwap_deviation', 'trade_imbalance_ratio', 'tick_speed', 'price_impact', 'rolling_cvd_5', 'rolling_cvd_20'}
    missing_trade_feats = [f for f in features if f in trade_features and f not in df.columns]

    if missing_trade_feats:
        try:
            exchange = _get_shared_ccxt_exchange(symbol)
            trades = exchange.fetch_trades(symbol, limit=300 if fast_limit else 1000)
            if trades:
                t_data = []
                for t in trades:
                    t_data.append({
                        'timestamp': pd.to_datetime(t['timestamp'], unit='ms'),
                        'price': float(t['price']),
                        'qty': float(t['amount']),
                        'is_buyer_maker': t['side'] == 'sell'
                    })
                df_trades = pd.DataFrame(t_data)
                df_trades.set_index('timestamp', inplace=True)

                from app.services.hybrid_deep_pipeline import calculate_trade_tick_features
                df_trades = calculate_trade_tick_features(df_trades, missing_trade_feats)

                last_trade_row = df_trades.iloc[-1]
                for col in missing_trade_feats:
                    if col in df_trades.columns:
                        df[col] = last_trade_row[col]
        except Exception as e:
            print(f"[ml_predictor] Failed to fetch live trades: {e}")

    return df


def _trigger_bg_feature_refresh(
    cache_key: str,
    symbol: str,
    timeframe: str,
    dataset_type: str,
    indicators: list,
    plp_features: list,
    features: list,
    seq_len: int
):
    """Non-blocking background refresh of _FEATURE_ROW_CACHE so fast_mode predictions stay <5ms."""
    def _worker():
        try:
            df_fresh = _build_pre_pca_feature_df(
                symbol=symbol,
                timeframe=timeframe,
                dataset_type=dataset_type,
                indicators=indicators,
                plp_features=plp_features,
                features=features,
                db=None,
                sequence_length=seq_len,
                fast_limit=True
            )
            if df_fresh is not None and not df_fresh.empty:
                _FEATURE_ROW_CACHE[cache_key] = {
                    "df_tail": df_fresh.tail(max(seq_len, 5)).copy(),
                    "timestamp": time.time(),
                    "refreshing": False
                }
        except Exception as e:
            print(f"[ml_predictor] Background feature refresh warning for {cache_key}: {e}")
            if cache_key in _FEATURE_ROW_CACHE:
                _FEATURE_ROW_CACHE[cache_key]["refreshing"] = False

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def warmup_model_and_features(model_id: str, symbol: str) -> bool:
    """Pre-loads the model into RAM and populates _FEATURE_ROW_CACHE for 0ms manual trade execution."""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        predict(
            model_id=str(model_id),
            symbol_override=symbol,
            db=db,
            fast_mode=True
        )
        return True
    except Exception as e:
        print(f"[ml_predictor] Warmup warning for model {model_id} on {symbol}: {e}")
        return False
    finally:
        db.close()


# ─── Public Entry Point ───────────────────────────────────────────────────────

def predict(
    model_id: str,
    symbol_override: Optional[str],
    db: Session,
    sequence_length: Optional[int] = None,
    price_point: Optional[float] = None,
    fast_mode: bool = False
) -> dict:
    """
    Generate a live prediction signal for the given model.
    
    Returns:
        {
          "signal":       "BUY" | "SELL" | "HOLD",
          "confidence":   0.73,
          "bullish_prob": 0.73,
          "bearish_prob": 0.27,
          "price":        67250.0,
          "symbol":       "BTC/USDT",
          "algorithm":    "Random Forest",
          "timestamp":    "2026-05-14T12:00:00Z"
        }
    """
    from app import models as db_models

    start_time = time.time()

    # ── 1. Load model from Registry (with RAM cache for fast_mode) ──────────
    cached_db_info = _DB_MODEL_INFO_CACHE.get(model_id)
    if fast_mode and cached_db_info and (start_time - cached_db_info[4] < 120.0) and os.path.exists(cached_db_info[0]):
        model_path, algorithm, version_meta_path, version_explainability, _ = cached_db_info
    else:
        db_model = db.query(db_models.CustomMLModel).filter(db_models.CustomMLModel.id == model_id).first()
        if not db_model:
            raise ValueError(f"Model '{model_id}' not found in Registry.")

        if not db_model.active_version_id:
            raise ValueError(f"Model '{model_id}' has no active version.")

        version = db.query(db_models.ModelVersion).filter(db_models.ModelVersion.id == db_model.active_version_id).first()
        if not version:
            raise ValueError("Active version record not found.")

        if version.status != db_models.ModelStatus.READY:
            raise ValueError("Model is not in READY state.")

        model_path = version.file_path
        if model_path:
            if "scaler_train_" in model_path:
                model_path = model_path.replace("scaler_train_", "model_train_")
            if "pca_train_" in model_path:
                model_path = model_path.replace("pca_train_", "model_train_")

            m_dir = os.path.dirname(model_path)
            if (
                not os.path.exists(model_path)
                or os.path.basename(model_path).lower().startswith(("pca", "scaler"))
            ) and os.path.isdir(m_dir):
                for f in sorted(os.listdir(m_dir)):
                    fl = f.lower()
                    if (
                        f.endswith((".pkl", ".pt", ".zip"))
                        and not fl.startswith(("pca", "scaler", "checkpoint", "replay"))
                        and "scaler" not in fl
                        and "pca" not in fl
                    ):
                        model_path = os.path.join(m_dir, f)
                        if fl.startswith("model"):
                            break

            if model_path != version.file_path and os.path.exists(model_path):
                try:
                    version.file_path = model_path
                    db.commit()
                except Exception:
                    db.rollback()

        if model_path and not os.path.exists(model_path) and os.path.exists(model_path.replace(".pkl", ".pt")):
            model_path = model_path.replace(".pkl", ".pt")
            
        if not model_path or not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found: {model_path}")

        algorithm = db_model.model_type
        version_meta_path = version.metadata_path
        version_explainability = version.explainability
        _DB_MODEL_INFO_CACHE[model_id] = (model_path, algorithm, version_meta_path, version_explainability, start_time)

    # ── 2. Load metadata (cached in RAM) ────────────────────────────────────
    metadata = None
    candidate_meta_paths = [
        version_meta_path,
        os.path.join(os.path.dirname(model_path), "metadata.json"),
        model_path.replace(".pkl", ".json").replace(".pt", ".json").replace(".zip", ".json")
    ]
    for mp in candidate_meta_paths:
        if mp and mp in _META_RAM_CACHE:
            metadata = _META_RAM_CACHE[mp]
            break
        if mp and os.path.exists(mp):
            try:
                with open(mp, "r") as f:
                    metadata = json.load(f)
                _META_RAM_CACHE[mp] = metadata
                print(f"[ml_predictor] Loaded metadata from path: {mp}")
                break
            except Exception as e:
                print(f"[ml_predictor] Failed to read metadata from {mp}: {e}")

    if metadata is None:
        fallback_symbol = symbol_override or "BTC/USDT"
        print(f"[ml_predictor] No metadata found for model {model_id}. Using fallback symbol: {fallback_symbol}")
        metadata = {
            "features": ["Open", "High", "Low", "Close", "Volume"],
            "dataset_type": "ohlcv",
            "indicators": [],
            "timeframe": "1h",
            "symbol": fallback_symbol,
            "prediction_target": "classification"
        }

    features     = metadata.get("features", [])
    dataset_type = metadata.get("dataset_type", "ohlcv")
    indicators   = metadata.get("indicators", [])
    timeframe    = metadata.get("timeframe", "1h")
    symbol       = symbol_override or metadata.get("symbol", "BTC/USDT")
    prediction_target = metadata.get("prediction_target", "classification")
    plp_features = metadata.get("plp_features", [])

    if not features:
        raise ValueError("No features found in model metadata.")

    # ── 3. Load Scaler & PCA (cached in RAM — zero file descriptor leaks) ───
    model_dir = os.path.dirname(model_path)
    base_name = os.path.splitext(os.path.basename(model_path))[0]
    ts_suffix = base_name.split('_')[-1] if '_' in base_name else ''

    candidate_scalers = [
        model_path.replace(".pkl", ".scaler").replace(".pt", ".scaler").replace(".zip", ".scaler"),
        os.path.join(model_dir, f"scaler_train_{ts_suffix}.pkl"),
        os.path.join(model_dir, "model.scaler"),
        os.path.join(model_dir, "scaler.pkl")
    ]
    if os.path.isdir(model_dir):
        for f in os.listdir(model_dir):
            if f.lower().startswith("scaler") and f.lower().endswith((".pkl", ".scaler")) and not f.lower().endswith(".scaler_y"):
                candidate_scalers.append(os.path.join(model_dir, f))

    scaler_x = None
    scaler_path_found = next((p for p in candidate_scalers if p and os.path.exists(p)), None)
    if scaler_path_found:
        if scaler_path_found not in _SCALER_RAM_CACHE:
            _SCALER_RAM_CACHE[scaler_path_found] = joblib.load(scaler_path_found)
        scaler_x = _SCALER_RAM_CACHE[scaler_path_found]

    scaler_y_path = model_path.replace(".pkl", ".scaler_y").replace(".pt", ".scaler_y").replace(".zip", ".scaler_y")
    scaler_y = None
    if os.path.exists(scaler_y_path):
        if scaler_y_path not in _SCALER_RAM_CACHE:
            _SCALER_RAM_CACHE[scaler_y_path] = joblib.load(scaler_y_path)
        scaler_y = _SCALER_RAM_CACHE[scaler_y_path]
    else:
        scaler_y_path_fallback = os.path.join(model_dir, "model.scaler_y")
        if os.path.exists(scaler_y_path_fallback):
            if scaler_y_path_fallback not in _SCALER_RAM_CACHE:
                _SCALER_RAM_CACHE[scaler_y_path_fallback] = joblib.load(scaler_y_path_fallback)
            scaler_y = _SCALER_RAM_CACHE[scaler_y_path_fallback]
            
    # Handle explicit 'none' string saved by our new pipeline
    if isinstance(scaler_x, str) and scaler_x == "none":
        scaler_x = None

    # Load PCA Model (cached in RAM)
    candidate_pcas = [
        model_path.replace(".pkl", ".pca").replace(".pt", ".pca").replace(".zip", ".pca"),
        os.path.join(model_dir, f"pca_train_{ts_suffix}.pkl"),
        os.path.join(model_dir, "model.pca"),
        os.path.join(model_dir, "pca.pkl")
    ]
    if os.path.isdir(model_dir):
        for f in os.listdir(model_dir):
            if f.lower().startswith("pca") and f.lower().endswith((".pkl", ".pca")):
                candidate_pcas.append(os.path.join(model_dir, f))

    pca_model_data = None
    pca_path_found = next((p for p in candidate_pcas if p and os.path.exists(p)), None)
    if pca_path_found:
        if pca_path_found not in _PCA_RAM_CACHE:
            loaded_pca = joblib.load(pca_path_found)
            if isinstance(loaded_pca, dict) and "pca" in loaded_pca and "to_compress" in loaded_pca:
                _PCA_RAM_CACHE[pca_path_found] = loaded_pca
            else:
                _PCA_RAM_CACHE[pca_path_found] = None
        pca_model_data = _PCA_RAM_CACHE.get(pca_path_found)

    # ── 4 & 5. Fetch Live Data & Compute Features (RAM-Cached in fast_mode) ─
    seq_len = sequence_length if sequence_length and sequence_length > 1 else 1
    cache_key = f"{model_id}_{symbol}"
    df = None

    if fast_mode:
        cached_entry = _FEATURE_ROW_CACHE.get(cache_key)
        now_ts = time.time()
        if cached_entry and cached_entry.get("df_tail") is not None and (now_ts - cached_entry.get("timestamp", 0)) < 300.0:
            df = cached_entry["df_tail"].copy()
            # Trigger non-blocking background refresh if older than 8 seconds
            if (now_ts - cached_entry.get("timestamp", 0)) > 8.0 and not cached_entry.get("refreshing", False):
                cached_entry["refreshing"] = True
                _trigger_bg_feature_refresh(
                    cache_key=cache_key,
                    symbol=symbol,
                    timeframe=timeframe,
                    dataset_type=dataset_type,
                    indicators=indicators,
                    plp_features=plp_features,
                    features=features,
                    seq_len=seq_len
                )
        else:
            df_full = _build_pre_pca_feature_df(
                symbol=symbol,
                timeframe=timeframe,
                dataset_type=dataset_type,
                indicators=indicators,
                plp_features=plp_features,
                features=features,
                db=db,
                sequence_length=seq_len,
                fast_limit=True
            )
            df_tail = df_full.tail(max(seq_len, 5)).copy()
            _FEATURE_ROW_CACHE[cache_key] = {
                "df_tail": df_tail,
                "timestamp": time.time(),
                "refreshing": False
            }
            df = df_tail.copy()
    else:
        df = _build_pre_pca_feature_df(
            symbol=symbol,
            timeframe=timeframe,
            dataset_type=dataset_type,
            indicators=indicators,
            plp_features=plp_features,
            features=features,
            db=db,
            sequence_length=seq_len,
            fast_limit=False
        )
        _FEATURE_ROW_CACHE[cache_key] = {
            "df_tail": df.tail(max(seq_len, 5)).copy(),
            "timestamp": time.time(),
            "refreshing": False
        }

    # Apply price_point override prior to PCA so PCA components also reflect the live entry price
    if price_point is not None and float(price_point) > 0:
        pp = float(price_point)
        if 'Close' in df.columns:
            df.iloc[-1, df.columns.get_loc('Close')] = pp
        elif 'close' in df.columns:
            df.iloc[-1, df.columns.get_loc('close')] = pp
        if 'High' in df.columns and pp > float(df['High'].iloc[-1]):
            df.iloc[-1, df.columns.get_loc('High')] = pp
        if 'Low' in df.columns and pp < float(df['Low'].iloc[-1]):
            df.iloc[-1, df.columns.get_loc('Low')] = pp

    # ── 5.6 Apply PCA (if applicable) ────────────────────────────────────────
    if pca_model_data is not None:
        try:
            to_compress = pca_model_data['to_compress']
            pca_cols = pca_model_data['pca_cols']
            
            # Extract features to compress. If missing, fill with 0
            missing_cols = [c for c in to_compress if c not in df.columns]
            for mc in missing_cols:
                df[mc] = 0.0
                
            X_comp = df[to_compress].fillna(0)
            X_scaled_full = pca_model_data['scaler'].transform(X_comp)
            X_pca_full = pca_model_data['pca'].transform(X_scaled_full)
            
            df_pca = pd.DataFrame(X_pca_full, columns=pca_cols, index=df.index)
            # Add PCA columns to df
            for col in pca_cols:
                df[col] = df_pca[col]
            if not fast_mode:
                print(f"[ml_predictor] Applied PCA compression on {len(to_compress)} features.")
        except Exception as e:
            print(f"[ml_predictor] Failed to apply live PCA: {e}")

    # ── 6. Prepare Feature Row / Sequence ────────────────────────────────────
    available_features = [f for f in features if f in df.columns]
    if not available_features:
        raise ValueError(f"None of the training features found in live data. Expected: {features[:5]}")

    df[available_features] = df[available_features].ffill().fillna(0)

    current_price = float(df['Close'].iloc[-1]) if 'Close' in df.columns else float(df['close'].iloc[-1])
    if price_point is not None and float(price_point) > 0:
        current_price = float(price_point)
        if 'Close' in df.columns:
            df.iloc[-1, df.columns.get_loc('Close')] = float(price_point)
        elif 'close' in df.columns:
            df.iloc[-1, df.columns.get_loc('close')] = float(price_point)

    # Extract last `seq_len` rows
    sequence_data = df[available_features].tail(seq_len).values.astype(float)

    # Pad missing features (columns) with 0
    if len(available_features) < len(features):
        padded_seq = np.zeros((sequence_data.shape[0], len(features)))
        for i, feat in enumerate(features):
            if feat in available_features:
                col_idx = available_features.index(feat)
                padded_seq[:, i] = sequence_data[:, col_idx]
        sequence_data = padded_seq

    # If rows are fewer than requested seq_len, pad by repeating the first available row
    if sequence_data.shape[0] < seq_len:
        padding_needed = seq_len - sequence_data.shape[0]
        padding = np.repeat(sequence_data[0:1], padding_needed, axis=0)
        sequence_data = np.vstack([padding, sequence_data])

    # ── 7. Run Inference ─────────────────────────────────────────────────────
    sl_price, tp_price, raw_return = None, None, None
    bullish_prob, bearish_prob = 0.0, 0.0
    try:
        X = sequence_data  # Shape: (seq_len, features)
        
        # Scale
        if scaler_x is not None:
            X = scaler_x.transform(X)

        # Extract anomaly threshold for Auto-Encoder
        anomaly_threshold = None
        if version_explainability and isinstance(version_explainability, dict):
            anomaly_threshold = version_explainability.get("anomaly_threshold")

        _THREAD_LOCAL.bullish_prob = None
        _THREAD_LOCAL.bearish_prob = None
        inference_result = _run_inference(model_path, algorithm, X, prediction_target, features, anomaly_threshold, current_price, scaler_y=scaler_y)
        if not fast_mode:
            print(f"[ml_predictor DEBUG] _run_inference returned: {inference_result}")
        if len(inference_result) == 5:
            signal_str, confidence, sl_price, tp_price, raw_return = inference_result
        elif len(inference_result) == 4:
            signal_str, confidence, sl_price, tp_price = inference_result
        else:
            signal_str, confidence = inference_result
            
        # Post-process Auto-Encoder signal with momentum heuristic
        if algorithm == "Auto-Encoder" and signal_str == "Market can sudden crash":
            try:
                if 'Close' in df.columns:
                    returns = df['Close'].pct_change().dropna().tail(10)
                    if returns.sum() > 0:
                        signal_str = "CRASH RISK"  # Anomaly during uptrend -> Crash
                    else:
                        signal_str = "PUMP RISK"   # Anomaly during downtrend -> Pump
            except Exception:
                signal_str = "ANOMALY"
        elif algorithm == "Auto-Encoder":
            signal_str = "NORMAL"

        tl_bull = getattr(_THREAD_LOCAL, "bullish_prob", None)
        tl_bear = getattr(_THREAD_LOCAL, "bearish_prob", None)
        if tl_bull is not None and tl_bear is not None:
            bullish_prob = float(tl_bull)
            bearish_prob = float(tl_bear)
        elif signal_str in ("BUY", "PUMP RISK"):
            bullish_prob = float(confidence)
            bearish_prob = max(0.0, 1.0 - float(confidence))
        elif signal_str in ("SELL", "CRASH RISK"):
            bearish_prob = float(confidence)
            bullish_prob = max(0.0, 1.0 - float(confidence))
        else:
            bullish_prob = 0.0
            bearish_prob = 0.0
            
    except Exception as e:
        print(f"[ml_predictor] Inference error: {e}")
        signal_str, confidence = "HOLD", 0.0
        bullish_prob, bearish_prob = 0.0, 0.0

    latency = time.time() - start_time
    try:
        from app.metrics import ML_PREDICTION_COUNT, ML_INFERENCE_LATENCY
        ML_PREDICTION_COUNT.labels(model_name=algorithm, symbol=symbol, signal=signal_str).inc()
        ML_INFERENCE_LATENCY.labels(model_name=algorithm).observe(latency)
    except Exception as e:
        print(f"[ml_predictor] Metrics error: {e}")

    # Save to PredictionLog for Drift Monitoring (skip synchronous DB write in fast_mode)
    if not fast_mode:
        try:
            from app.models.prediction_log import PredictionLog
            log_entry = PredictionLog(
                model_id=model_id,
                symbol=symbol,
                timeframe=timeframe,
                predicted_signal=signal_str,
                confidence=round(confidence, 4),
                predicted_price=current_price,
                timestamp=datetime.utcnow(),
                metadata_json={"dataset_type": dataset_type, "features_used": len(available_features)}
            )
            db.add(log_entry)
            db.commit()
        except Exception as e:
            print(f"[ml_predictor] Failed to save prediction log: {e}")
            db.rollback()

    res = {
        "signal":        signal_str,
        "confidence":    round(confidence, 4),
        "bullish_prob":  round(bullish_prob, 4),
        "bearish_prob":  round(bearish_prob, 4),
        "price":         current_price,
        "symbol":        symbol,
        "algorithm":     algorithm,
        "timestamp":     datetime.utcnow().isoformat() + "Z",
        "features_used": len(available_features),
        "dataset_type":  dataset_type,
        "latency_ms":    round(latency * 1000, 2)
    }
    if sl_price is not None:
        res["sl"] = sl_price
    if tp_price is not None:
        res["tp"] = tp_price
    if raw_return is not None:
        res["predicted_return"] = raw_return
    return res


# ─── Internal Helpers ─────────────────────────────────────────────────────────

def _fetch_live_ohlcv(symbol: str, timeframe: str, dataset_type: str = "ohlcv", limit: int = 1000) -> Optional[pd.DataFrame]:
    """Fetch the last `limit` candles via CCXT or OANDA for Forex."""
    try:
        if dataset_type == 'forex' or '_' in symbol or len(symbol) == 7 and '/' in symbol and not symbol.endswith('USDT'):
            # It's likely a Forex pair
            import requests
            import os
            from datetime import datetime
            import yfinance as yf
            
            clean_symbol = symbol.replace('_', '/')
            if '/' not in clean_symbol and len(clean_symbol) == 6:
                clean_symbol = f"{clean_symbol[:3]}/{clean_symbol[3:]}"
                
            tf_map = {'1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D'}
            oanda_tf = tf_map.get(timeframe, 'H1')
            oanda_symbol = clean_symbol.replace("/", "_")
            
            account_id = os.getenv("OANDA_ACCOUNT_ID")
            api_key = os.getenv("OANDA_API_KEY")
            
            df = None
            if account_id and api_key:
                url = f"https://api-fxpractice.oanda.com/v3/instruments/{oanda_symbol}/candles?count=1000&granularity={oanda_tf}&price=M"
                headers = {"Authorization": f"Bearer {api_key}"}
                try:
                    response = requests.get(url, headers=headers, timeout=5)
                    response.raise_for_status()
                    data = response.json()
                    candles = data.get("candles", [])
                    formatted_data = []
                    for c in candles:
                        if c["complete"]:
                            dt = datetime.fromisoformat(c["time"].replace('Z', '+00:00'))
                            formatted_data.append({
                                "timestamp": dt,
                                "Open": float(c["mid"]["o"]),
                                "High": float(c["mid"]["h"]),
                                "Low": float(c["mid"]["l"]),
                                "Close": float(c["mid"]["c"]),
                                "Volume": int(c["volume"])
                            })
                    if formatted_data:
                        df = pd.DataFrame(formatted_data)
                        df.set_index('timestamp', inplace=True)
                except Exception as e:
                    print(f"OANDA API failed for {symbol}: {e}. Falling back to yfinance.")
            
            if df is None or df.empty:
                print(f"Using yfinance fallback for {symbol}")
                yf_symbol = f"{clean_symbol.replace('/', '')}=X"
                yf_tf_map = {'1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '1d': '1d'}
                yf_tf = yf_tf_map.get(timeframe, '1h')
                period = "1mo"
                if timeframe == '1m': period = "7d"
                
                ticker = yf.Ticker(yf_symbol)
                yf_df = ticker.history(period=period, interval=yf_tf)
                if not yf_df.empty:
                    yf_df = yf_df.tail(1000)
                    yf_df.reset_index(inplace=True)
                    # Yfinance index is usually 'Datetime' or 'Date'
                    time_col = 'Datetime' if 'Datetime' in yf_df.columns else 'Date'
                    yf_df.rename(columns={time_col: 'timestamp'}, inplace=True)
                    # Convert to naive UTC
                    yf_df['timestamp'] = pd.to_datetime(yf_df['timestamp'], utc=True).dt.tz_convert(None)
                    yf_df.set_index('timestamp', inplace=True)
                    df = yf_df[['Open', 'High', 'Low', 'Close', 'Volume']]
            
            if df is None or df.empty:
                return None
            return df

        # Default Crypto CCXT logic (reuse singleton CCXT client)
        tf_map = {
            "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
            "1h": "1h", "4h": "4h", "1d": "1d"
        }
        tf = tf_map.get(timeframe, "1h")

        exchange = _get_shared_ccxt_exchange(symbol)
        ohlcv = exchange.fetch_ohlcv(symbol, tf, limit=limit)
        if not ohlcv:
            return None
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'Open', 'High', 'Low', 'Close', 'Volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        return df
    except Exception as e:
        print(f"[ml_predictor] OHLCV fetch failed: {e}")
        return None


def _compute_micro_features_from_raw(bids, asks):
    """
    Compute obi, spread, microprice from raw bids/asks.
    Supports two formats:
      - Binance WebSocket: [[price_str, qty_str], ...]
      - Heatmap service:   [{'price': float, 'volume': float}, ...]
    Returns (obi, spread, microprice) or (None, None, None) on failure.
    """
    try:
        def _parse_level(level):
            if isinstance(level, dict):
                return float(level.get('price', 0) or 0), float(level.get('volume', level.get('qty', 0)) or 0)
            return float(level[0]), float(level[1])

        parsed_bids = [_parse_level(b) for b in (bids or [])[:10]]
        parsed_asks = [_parse_level(a) for a in (asks or [])[:10]]

        # Filter out zero-price levels (bad data from heatmap bucketing at 0)
        parsed_bids = [(p, q) for p, q in parsed_bids if p > 0]
        parsed_asks = [(p, q) for p, q in parsed_asks if p > 0]

        if not parsed_bids or not parsed_asks:
            return None, None, None

        best_bid = parsed_bids[0][0]
        best_ask = parsed_asks[0][0]
        spread   = best_ask - best_bid

        bid_vol = sum(q for _, q in parsed_bids)
        ask_vol = sum(q for _, q in parsed_asks)
        total   = bid_vol + ask_vol

        if total <= 0:
            return None, None, None

        obi        = (bid_vol - ask_vol) / total
        microprice = (best_bid * ask_vol + best_ask * bid_vol) / total
        return obi, spread, microprice
    except Exception:
        return None, None, None


def _fetch_live_l2_data(symbol: str, db: Session, sequence_length: Optional[int] = None) -> Optional[pd.DataFrame]:
    """
    Fetch Live L2 Data. If sequence_length > 1, prioritize fetching from DB to build sequence,
    then append the latest API call for exact real-time ending.
    """
    from app.services.auto_feature_selector import calculate_l2_advanced_features
    
    seq_len = sequence_length if sequence_length and sequence_length > 1 else 1
    
    # ALWAYS fetch at least 300 rows to ensure feature engineering engines (Swing/Candle) have historical context
    min_required_history = max(seq_len, 300)

    df_db = None
    if min_required_history > 1:
        print(f"[ml_predictor] Fetching recent {min_required_history} snapshots from DB for {symbol} (Context Fetch)...")
        try:
            from app.models.orderbook_snapshot import OrderBookSnapshot
            since = datetime.now(timezone.utc) - timedelta(hours=6)
            clean_symbol = symbol.upper().split(":")[0].replace("/", "")
            slash_symbol = symbol.upper().split(":")[0]

            snapshots = db.query(OrderBookSnapshot).filter(
                OrderBookSnapshot.symbol.in_([clean_symbol, slash_symbol]),
                OrderBookSnapshot.timestamp >= since
            ).order_by(OrderBookSnapshot.timestamp.desc()).limit(min_required_history).all()
            
            if snapshots:
                data = []
                for s in reversed(snapshots): # asc order
                    obi, spread, microprice = s.obi, s.spread, s.microprice
                    if obi is None or microprice is None:
                        obi, spread, microprice = _compute_micro_features_from_raw(s.bids, s.asks)
                    if microprice is None or microprice == 0: continue
                    data.append({
                        "timestamp": s.timestamp,
                        "Close": microprice,
                        "obi": obi,
                        "spread": spread,
                        "microprice": microprice,
                        "bids": s.bids,
                        "asks": s.asks,
                    })
                if data:
                    df_db = pd.DataFrame(data)
                    df_db.set_index("timestamp", inplace=True)
        except Exception as e:
            print(f"[ml_predictor] DB L2 fetch failed: {e}")

    print(f"[ml_predictor] Fetching LIVE L2 Orderbook directly from Binance API for {symbol}...")
    try:
        exchange = _get_shared_ccxt_exchange(symbol)
        ob = exchange.fetch_order_book(symbol, limit=20)
        obi, spread, microprice = _compute_micro_features_from_raw(ob.get('bids', []), ob.get('asks', []))
        
        if microprice is not None and microprice > 0:
            df = pd.DataFrame([{
                "timestamp": pd.to_datetime(exchange.milliseconds(), unit='ms', utc=True),
                "Close": microprice,
                "obi": obi,
                "spread": spread,
                "microprice": microprice,
                "bids": ob.get('bids', []),
                "asks": ob.get('asks', []),
            }])
            df.set_index("timestamp", inplace=True)
            try:
                df_feats, _ = calculate_l2_advanced_features(df.reset_index())
                df_feats['timestamp'] = df.index
                df_feats.set_index('timestamp', inplace=True)
                for col in df_feats.columns:
                    if col not in df.columns:
                        df[col] = df_feats[col]
            except Exception:
                pass
            
            df.drop(columns=['bids', 'asks'], inplace=True, errors='ignore')
            if df_db is not None and not df_db.empty:
                df_db.drop(columns=['bids', 'asks'], inplace=True, errors='ignore')
                df = pd.concat([df_db, df]).drop_duplicates()
                df.sort_index(inplace=True)
            return df
    except Exception as api_err:
        print(f"[ml_predictor] Live API L2 fetch failed: {api_err}. Falling back to DB historical snapshots.")
        if df_db is not None and not df_db.empty:
            try:
                df_feats, _ = calculate_l2_advanced_features(df_db.reset_index())
                df_feats['timestamp'] = df_db.index
                df_feats.set_index('timestamp', inplace=True)
                for col in df_feats.columns:
                    if col not in df_db.columns:
                        df_db[col] = df_feats[col]
            except Exception:
                pass
            return df_db

    # ── Fallback to DB (If seq_len == 1 but API failed) ──────────────────────
    try:
        from app.models.orderbook_snapshot import OrderBookSnapshot
        since = datetime.now(timezone.utc) - timedelta(hours=6)
        clean_symbol = symbol.upper().split(":")[0].replace("/", "")   # BTCUSDT
        slash_symbol = symbol.upper().split(":")[0]                     # BTC/USDT

        snapshots = db.query(OrderBookSnapshot).filter(
            OrderBookSnapshot.symbol == clean_symbol,
            OrderBookSnapshot.timestamp >= since
        ).order_by(OrderBookSnapshot.timestamp.asc()).all()

        if not snapshots:
            snapshots = db.query(OrderBookSnapshot).filter(
                OrderBookSnapshot.symbol == slash_symbol,
                OrderBookSnapshot.timestamp >= since
            ).order_by(OrderBookSnapshot.timestamp.asc()).all()

        if not snapshots:
            since_wide = datetime.now(timezone.utc) - timedelta(hours=24)
            snapshots = db.query(OrderBookSnapshot).filter(
                OrderBookSnapshot.symbol.in_([clean_symbol, slash_symbol]),
                OrderBookSnapshot.timestamp >= since_wide
            ).order_by(OrderBookSnapshot.timestamp.asc()).all()

        # ── Build DataFrame; recompute features from bids/asks when NULL ───
        data = []
        for s in snapshots:
            obi, spread, microprice = s.obi, s.spread, s.microprice

            # If core metrics are NULL (snapshot saved by orderbook_snapshot_service
            # which only stores raw bids/asks), recompute them on-the-fly.
            if obi is None or microprice is None:
                obi, spread, microprice = _compute_micro_features_from_raw(s.bids, s.asks)

            if microprice is None or microprice == 0:
                continue   # Skip unparseable rows

            data.append({
                "timestamp":  s.timestamp,
                "Close":      microprice,
                "obi":        obi,
                "spread":     spread,
                "microprice": microprice,
                "bids":       s.bids,
                "asks":       s.asks,
            })

        if not data:
            print(f"[ml_predictor] All {len(snapshots)} snapshots for {symbol} had null/zero microprice. Falling back to OHLCV.")
            return None

        df = pd.DataFrame(data)
        df.set_index("timestamp", inplace=True)

        # Cast to float (rows may have been stored as objects)
        for col in ["Close", "obi", "spread", "microprice"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # Add advanced features
        try:
            df_feats, _ = calculate_l2_advanced_features(df.reset_index())
            df_feats['timestamp'] = df.index
            df_feats.set_index('timestamp', inplace=True)
            for col in df_feats.columns:
                if col not in df.columns:
                    df[col] = df_feats[col]
        except Exception:
            pass
            
        df.drop(columns=['bids', 'asks'], inplace=True, errors='ignore')

        return df
    except Exception as e:
        print(f"[ml_predictor] L2 data fetch failed: {e}")
        return None


def _calculate_indicators(df: pd.DataFrame, indicators: list) -> pd.DataFrame:
    """Calculate the same technical indicators as used during training."""
    import pandas_ta as ta

    # pandas_ta requires lowercase column names for some methods
    from app.services.helpers.vwap_calculator import calculate_vwap_sd_features
    from app.services.helpers.institutional_features import add_smc_fvg, add_ict_killzones, add_wick_rejection, add_swing_structure, add_order_blocks

    INDICATOR_MAP = {
        "RSI":            lambda d: d.ta.rsi(append=True),
        "Stoch":          lambda d: d.ta.stoch(append=True),
        "ROC":            lambda d: d.ta.roc(append=True),
        "CCI":            lambda d: d.ta.cci(append=True),
        "WillR":          lambda d: d.ta.willr(append=True),
        "MFI":            lambda d: d.ta.mfi(append=True),
        "MACD":           lambda d: d.ta.macd(append=True),
        "EMA":            lambda d: d.ta.ema(append=True),
        "SMA":            lambda d: d.ta.sma(append=True),
        "ADX":            lambda d: d.ta.adx(append=True),
        "Supertrend":     lambda d: d.ta.supertrend(append=True),
        "Parabolic SAR":  lambda d: d.ta.psar(append=True),
        "BBANDS":         lambda d: d.ta.bbands(append=True),
        "ATR":            lambda d: d.ta.atr(append=True),
        "Keltner Channel":lambda d: d.ta.kc(append=True),
        "Donchian Channel":lambda d: d.ta.donchian(append=True),
        "OBV":            lambda d: d.ta.obv(append=True),
        "VWAP":           lambda d: d.ta.vwap(append=True),
        "CMF":            lambda d: d.ta.cmf(append=True),
        "ADOSC":          lambda d: d.ta.adosc(append=True),
        "SMC FVG":        lambda d: add_smc_fvg(d),
        "ICT Killzones":  lambda d: add_ict_killzones(d),
        "Wick Rejection": lambda d: add_wick_rejection(d),
        "Market Structure":lambda d: add_swing_structure(d),
        "Order Blocks":   lambda d: add_order_blocks(d),
    }

    for ind in indicators:
        try:
            if ind == "VWAP_SD":
                vwap_feats = calculate_vwap_sd_features(df, anchor='Daily')
                df['VWAP_Z_Score'] = vwap_feats['VWAP_Z_Score']
            elif ind in INDICATOR_MAP:
                INDICATOR_MAP[ind](df)
        except Exception:
            pass

    return df


def _run_inference(model_path: str, algorithm: str, X: np.ndarray, prediction_target: str, features: list = None, anomaly_threshold: float = None, current_price: float = 0.0, scaler_y=None):
    """
    Load model and run inference. Returns (signal_str, confidence).
    signal_str : "BUY", "SELL", or "HOLD"
    confidence : 0.0 – 1.0
    """
    if algorithm in DEEP_LEARNING_ALGOS:
        return _infer_torch(model_path, algorithm, X, prediction_target, anomaly_threshold, current_price, scaler_y=scaler_y)
    elif algorithm in SKLEARN_ALGOS:
        return _infer_sklearn(model_path, X, prediction_target, features, current_price, scaler_y=scaler_y)
    elif algorithm in ["PPO-RL", "SAC-RL", "A2C-RL", "DDPG-RL", "DQN-RL", "TD3-RL", "QR-DQN", "CQL", "GAIL", "Decision-Transformer", "Liquid-NN"]:
        return _infer_rl(model_path, algorithm, X, prediction_target=prediction_target, features=features, current_price=current_price)
    elif algorithm in NEXT_GEN_ALGOS:
        pt_path = model_path.replace(".pkl", ".pt")
        return _infer_nextgen(pt_path, algorithm, X, prediction_target, current_price=current_price, scaler_y=scaler_y)
    else:
        # Unknown — try sklearn first, then torch, then RL
        try:
            return _infer_sklearn(model_path, X, prediction_target, features, current_price, scaler_y=scaler_y)
        except Exception:
            try:
                pt_path = model_path.replace(".pkl", ".pt")
                return _infer_torch(pt_path, algorithm, X, prediction_target, anomaly_threshold, current_price, scaler_y=scaler_y)
            except Exception:
                return _infer_rl(model_path, algorithm, X, features=features, current_price=current_price)


def _infer_rl(model_path: str, algorithm: str, X: np.ndarray, prediction_target: str = "", features: list = None, current_price: float = 0.0):
    """Inference for Stable-Baselines3 Reinforcement Learning agents."""
    try:
        from stable_baselines3 import PPO, SAC, A2C, DDPG, DQN, TD3
        import numpy as np
        model_class = None
        if "PPO" in algorithm: model_class = PPO
        elif "SAC" in algorithm: model_class = SAC
        elif "A2C" in algorithm: model_class = A2C
        elif "DDPG" in algorithm: model_class = DDPG
        elif "DQN" in algorithm: model_class = DQN
        elif "TD3" in algorithm: model_class = TD3
        else:
            # Fallback to PPO loading mechanism if algo uses same architecture
            model_class = PPO
            
        if not model_class:
            return "HOLD", 0.5

        model = _MODEL_RAM_CACHE.get(model_path)
        if model is None:
            model = model_class.load(model_path)
            _MODEL_RAM_CACHE[model_path] = model
        
        # The training environment (AdvancedTradingEnv) only uses `features` for observations.
        # It does not manually append `current_price` if `Close` is omitted.
        obs = X[-1:] # Take the last row for RL by default
            
        obs = obs.astype(np.float32)
        action, _ = model.predict(obs, deterministic=True)
        
        # Action is usually a 1D array or scalar
        
        # ── Handle Advanced Setup (Continuous Box Action Space with 3 outputs: [direction, sl, tp]) ──
        if prediction_target == "advanced_setup" and isinstance(action[0], (np.ndarray, list)) and len(action[0]) >= 3:
            direction = float(action[0][0])
            # Map from [-1, 1] to positive distances (up to 10% price movement) as in AdvancedTradingEnv
            sl_dist = max(0.001, (float(action[0][1]) + 1.0) / 2.0 * 0.1 * current_price)
            tp_dist = max(0.001, (float(action[0][2]) + 1.0) / 2.0 * 0.1 * current_price)
            
            signal_str = "BUY" if direction > 0 else "SELL"
            confidence = 0.95
            
            if signal_str == "BUY":
                sl_price = current_price - sl_dist
                tp_price = current_price + tp_dist
            else:
                sl_price = current_price + sl_dist
                tp_price = current_price - tp_dist
                
            return signal_str, confidence, sl_price, tp_price
            
        action_val = action[0] if isinstance(action, (np.ndarray, list)) and len(action) > 0 else action

        # Map to Signal
        is_continuous = algorithm in ["SAC-RL", "DDPG-RL", "TD3-RL"]
        
        if is_continuous:
            action_val = float(action_val)
            if action_val < -0.33:
                return "SELL", min(0.99, abs(action_val))
            elif action_val > 0.33:
                return "BUY", min(0.99, abs(action_val))
            else:
                return "HOLD", 0.5
        else:
            action_val = int(action_val)
            if action_val == 1:
                return "BUY", 0.8
            elif action_val == 2:
                return "SELL", 0.8
            else:
                return "HOLD", 0.5
                
    except Exception as e:
        print(f"[ml_predictor] RL Inference error: {e}")
        return "HOLD", 0.5


def _infer_sklearn(model_path: str, X: np.ndarray, prediction_target: str, features: list = None, current_price: float = 0.0, scaler_y=None):
    """Inference for sklearn-compatible models (RAM-cached, zero file descriptor leaks)."""
    import os
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"

    # Load model into RAM cache WITHOUT mmap_mode='c' so we never leak file descriptors ([Errno 24])
    model = _MODEL_RAM_CACHE.get(model_path)
    if model is None or isinstance(model, dict):
        loaded_model = joblib.load(model_path)
        if isinstance(loaded_model, dict):
            loaded_model = loaded_model.get("model") or loaded_model.get("estimator") or loaded_model
        if hasattr(loaded_model, 'n_jobs'):
            loaded_model.n_jobs = 1
        if hasattr(loaded_model, 'estimators_'):
            for est in loaded_model.estimators_:
                if hasattr(est, 'n_jobs'):
                    est.n_jobs = 1
        _MODEL_RAM_CACHE[model_path] = loaded_model
        model = loaded_model

    # ── Wrap X in DataFrame with feature names to suppress sklearn warning ─────
    if features is not None:
        try:
            X_input = pd.DataFrame(X, columns=features[:X.shape[1]])
        except Exception:
            X_input = X
    else:
        X_input = X

    # Sklearn expects 2D array, we extract the last row if sequence was requested
    X_input = X_input[-1:] if isinstance(X_input, (np.ndarray, pd.DataFrame)) else X_input

    with joblib.parallel_backend('threading', n_jobs=1):
        if prediction_target == "advanced_setup":
            pred = model.predict(X_input)[0]
            if np.isscalar(pred) or (hasattr(pred, "shape") and len(pred.shape) == 0):
                direction = float(pred)
                sl_dist = 0.01
                tp_dist = 0.01
            elif len(pred) < 3:
                direction = float(pred[0])
                sl_dist = 0.01
                tp_dist = 0.01
            else:
                if scaler_y is not None:
                    try:
                        pred[1:] = scaler_y.inverse_transform([pred[1:]])[0]
                    except Exception:
                        pass
                direction = pred[0]
                tp_dist = abs(pred[1])
                sl_dist = abs(pred[2])
            signal_str = "BUY" if direction > 0.5 else "SELL"
            confidence = 0.95
            _THREAD_LOCAL.bullish_prob = float(direction) if 0.0 <= float(direction) <= 1.0 else (0.95 if signal_str == "BUY" else 0.05)
            _THREAD_LOCAL.bearish_prob = 1.0 - _THREAD_LOCAL.bullish_prob

            if signal_str == "BUY":
                sl_price = current_price * (1 - sl_dist)
                tp_price = current_price * (1 + tp_dist)
            else:
                sl_price = current_price * (1 + sl_dist)
                tp_price = current_price * (1 - tp_dist)
                
            return signal_str, confidence, sl_price, tp_price
        
        elif prediction_target == "classification":
            try:
                if hasattr(model, 'predict_proba'):
                    proba = model.predict_proba(X_input)[0]
                    label = int(np.argmax(proba))
                    confidence = float(proba[label])
                    if len(proba) == 3:
                        # 3-class Triple Barrier: [0]=SELL (Bearish), [1]=HOLD, [2]=BUY (Bullish)
                        _THREAD_LOCAL.bearish_prob = float(proba[0])
                        _THREAD_LOCAL.bullish_prob = float(proba[2])
                    elif len(proba) >= 2:
                        _THREAD_LOCAL.bearish_prob = float(proba[0])
                        _THREAD_LOCAL.bullish_prob = float(proba[1])
                else:
                    label = int(model.predict(X_input)[0])
                    confidence = 0.6
            except Exception as e:
                print(f"[ml_predictor DEBUG] sklearn prediction failed: {e}")
                import traceback
                traceback.print_exc()
                raise e

            # Check if it's a 3-class Triple Barrier model
            if hasattr(model, 'classes_') and len(model.classes_) == 3:
                if label == 2:
                    signal_str = "BUY"
                elif label == 0:
                    signal_str = "SELL"
                else:
                    signal_str = "HOLD"
            else:
                signal_str = "BUY" if label == 1 else "SELL"
        else:
            pred = float(model.predict(X_input)[0])
            if scaler_y is not None:
                try:
                    pred = float(scaler_y.inverse_transform([[pred]])[0][0])
                except Exception:
                    pass
            
            if current_price and current_price > 0:
                if abs((pred - current_price) / current_price) < 0.5:
                    pred_return = (pred - current_price) / current_price
                else:
                    pred_return = pred
            else:
                pred_return = pred
                
            signal_str = "BUY" if pred_return > 0 else "SELL"
            confidence = min(0.95, abs(pred_return) * 10)
            return signal_str, confidence, None, None, float(pred_return)

        return signal_str, confidence


def _infer_torch(model_path: str, algorithm: str, X: np.ndarray, prediction_target: str, anomaly_threshold: float = None, current_price: float = 0.0, scaler_y=None):
    """Inference for PyTorch models. Reconstructs same tiny architecture as training."""
    import torch
    import torch.nn as nn
    from app.services.advanced_ml.architectures import TCNModel, TabNetEncoder, AutoEncoder

    pt_path = model_path if model_path.endswith(".pt") else model_path.replace(".pkl", ".pt")
    if not os.path.exists(pt_path):
        raise FileNotFoundError(f"PyTorch checkpoint not found: {pt_path}")

    input_size = X.shape[1]
    out_size = 3 if prediction_target == "advanced_setup" else 1

    # ── Rebuild Architecture ──────────────────────────────────────────────────
    if algorithm == "LSTM":
        class SimpleLSTM(nn.Module):
            def __init__(self, input_size):
                super().__init__()
                self.lstm = nn.LSTM(input_size, 64, 2, batch_first=True)
                self.fc   = nn.Linear(64, out_size)
            def forward(self, x):
                out, _ = self.lstm(x)
                return self.fc(out[:, -1, :])
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = SimpleLSTM(input_size)
            base_model.fc = nn.Linear(64, 64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = SimpleLSTM(input_size)
        
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X).unsqueeze(1)

    elif algorithm == "GRU":
        class SimpleGRU(nn.Module):
            def __init__(self, input_size):
                super().__init__()
                self.gru = nn.GRU(input_size, 64, 2, batch_first=True)
                self.fc  = nn.Linear(64, out_size)
            def forward(self, x):
                out, _ = self.gru(x)
                return self.fc(out[:, -1, :])
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = SimpleGRU(input_size)
            base_model.fc = nn.Linear(64, 64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = SimpleGRU(input_size)
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X).unsqueeze(1)

    elif algorithm in ("1D-CNN",):
        class CNN1D(nn.Module):
            def __init__(self, input_size):
                super().__init__()
                self.conv1 = nn.Conv1d(1, 16, 3, padding=1)
                self.relu  = nn.ReLU()
                self.pool  = nn.MaxPool1d(2)
                self.fc1   = nn.Linear(16 * (input_size // 2), 32)
                self.fc2   = nn.Linear(32, out_size)
            def forward(self, x):
                x = x.unsqueeze(1)
                out = self.pool(self.relu(self.conv1(x)))
                out = out.view(out.size(0), -1)
                return self.fc2(self.relu(self.fc1(out)))
        model = CNN1D(input_size)
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X[-1:]).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X)

    elif algorithm == "DeepLOB":
        class DeepLOB(nn.Module):
            def __init__(self, input_size):
                super().__init__()
                self.conv1 = nn.Conv1d(1, 16, 2, padding=1)
                self.relu  = nn.ReLU()
                self.lstm  = nn.LSTM(16, 32, 1, batch_first=True)
                self.fc    = nn.Linear(32, out_size)
            def forward(self, x):
                x = x.unsqueeze(1)
                x = self.relu(self.conv1(x))
                x = x.transpose(1, 2)
                out, _ = self.lstm(x)
                return self.fc(out[:, -1, :])
        model = DeepLOB(input_size)
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X[-1:])
        else:
            X_t = torch.FloatTensor(X)

    elif algorithm == "TCN":
        model = TCNModel(input_size=input_size, num_channels=[32, 64, 128], output_size=out_size)
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X).unsqueeze(1)

    elif algorithm == "TabNet":
        model = TabNetEncoder(input_dim=input_size, output_dim=out_size)
        X_t = torch.FloatTensor(X[-1:])

    elif algorithm == "Auto-Encoder":
        model = AutoEncoder(input_dim=input_size, hidden_dim=32)
        X_t = torch.FloatTensor(X[-1:])

    else:
        class MLPFallback(nn.Module):
            def __init__(self, input_size):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(input_size, 64), nn.ReLU(),
                    nn.Linear(64, 32), nn.ReLU(),
                    nn.Linear(32, out_size)
                )
            def forward(self, x):
                return self.net(x)
        model = MLPFallback(input_size)
        X_t = torch.FloatTensor(X[-1:])

    # Load weights from RAM cache if available
    state = _MODEL_RAM_CACHE.get(pt_path)
    if state is None:
        state = torch.load(pt_path, map_location='cpu')
        _MODEL_RAM_CACHE[pt_path] = state
    model.load_state_dict(state, strict=False)
    model.eval()

    with torch.no_grad():
        if algorithm == "Auto-Encoder":
            reconstructed = model(X_t)
            raw = torch.mean((reconstructed - X_t) ** 2, dim=1).numpy().flatten()[0]
        else:
            out = model(X_t)
            if prediction_target == "multi_task":
                class_logits, reg_value = out
                prob = float(torch.sigmoid(class_logits).numpy().flatten()[0])
                _THREAD_LOCAL.bullish_prob = prob
                _THREAD_LOCAL.bearish_prob = 1.0 - prob
                raw = reg_value.numpy().flatten()[0]
                if scaler_y is not None:
                    try:
                        raw = float(scaler_y.inverse_transform(np.array([[raw]]))[0][0])
                    except Exception:
                        pass
                
                if current_price and current_price > 0:
                    if abs((raw - current_price) / current_price) < 0.5:
                        pred_return = (raw - current_price) / current_price
                    else:
                        pred_return = raw
                else:
                    pred_return = raw
                    
                signal_str = "BUY" if prob >= 0.5 else "SELL"
                confidence = float(prob if prob >= 0.5 else 1.0 - prob) * min(1.0, max(0.1, abs(pred_return) * 100.0))
                confidence = min(0.99, max(0.1, confidence))
                return signal_str, float(confidence), None, None, float(pred_return)
            else:
                if isinstance(out, tuple): out = out[0]
                if prediction_target == "advanced_setup":
                    pred = out.numpy().flatten()
                    if scaler_y is not None:
                        try:
                            pred[1:] = scaler_y.inverse_transform([pred[1:]])[0]
                        except Exception:
                            pass
                    direction = pred[0]
                    sl_dist = abs(pred[1])
                    tp_dist = abs(pred[2])
                    signal_str = "BUY" if direction > 0.5 else "SELL"
                    confidence = 0.95
                    if signal_str == "BUY":
                        sl_price = current_price * (1 - sl_dist)
                        tp_price = current_price * (1 + tp_dist)
                    else:
                        sl_price = current_price * (1 + sl_dist)
                        tp_price = current_price * (1 - tp_dist)
                    return signal_str, confidence, float(sl_price), float(tp_price)
                else:
                    raw = out.numpy().flatten()[0]

    if algorithm == "Auto-Encoder":
        if anomaly_threshold is not None and raw > anomaly_threshold:
            signal_str = "Market can sudden crash"
            confidence = min(0.99, float(raw / (anomaly_threshold + 1e-9)))
        else:
            signal_str = "Market can pump heavily"
            confidence = 0.5
    else:
        if prediction_target == "classification":
            prob = float(1 / (1 + np.exp(-raw)))
            _THREAD_LOCAL.bullish_prob = prob
            _THREAD_LOCAL.bearish_prob = 1.0 - prob
            signal_str = "BUY" if prob >= 0.5 else "SELL"
            confidence = prob if prob >= 0.5 else 1 - prob
        else:
            if scaler_y is not None:
                try:
                    raw = float(scaler_y.inverse_transform(np.array([[raw]]))[0][0])
                except Exception:
                    pass
            
            if current_price and current_price > 0:
                if abs((raw - current_price) / current_price) < 0.5:
                    pred_return = (raw - current_price) / current_price
                else:
                    pred_return = raw
            else:
                pred_return = raw
                
            signal_str = "BUY" if pred_return > 0 else "SELL"
            confidence = min(0.95, abs(float(pred_return)) * 10)
            return signal_str, confidence, None, None, float(pred_return)

    return signal_str, confidence


def _infer_nextgen(model_path: str, algorithm: str, X: np.ndarray, prediction_target: str, current_price: float = 0.0, scaler_y=None):
    """Inference for Next-Gen PyTorch wrappers."""
    import torch
    import os
    from app.models.next_gen import NEXT_GEN_MODELS  # Required for torch.load to unpickle custom classes
    
    
    if not os.path.exists(model_path):
        print(f"[_infer_nextgen] Error: Model file missing at {model_path}")
        return "HOLD", 0.5
        
    try:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = _MODEL_RAM_CACHE.get(model_path)
        if model is None:
            model = torch.load(model_path, map_location=device, weights_only=False)
            _MODEL_RAM_CACHE[model_path] = model
        
        if hasattr(model, 'device'):
            model.device = device
            
        preds = model.predict(X)
        
        if len(preds.shape) > 0:
            raw = preds[-1]
        else:
            raw = preds
            
        if prediction_target == "advanced_setup":
            pred = raw.flatten() if isinstance(raw, np.ndarray) else np.array([raw]).flatten()
            if len(pred) >= 3:
                if scaler_y is not None:
                    try:
                        pred[1:3] = scaler_y.inverse_transform([pred[1:3]])[0]
                    except Exception:
                        pass
                direction = pred[0]
                sl_dist = abs(pred[1])
                tp_dist = abs(pred[2])
                signal_str = "BUY" if direction > 0.5 else "SELL"
                confidence = 0.95
                if signal_str == "BUY":
                    sl_price = current_price * (1 - sl_dist)
                    tp_price = current_price * (1 + tp_dist)
                else:
                    sl_price = current_price * (1 + sl_dist)
                    tp_price = current_price * (1 - tp_dist)
                return signal_str, confidence, float(sl_price), float(tp_price)
            else:
                signal_str = "BUY" if float(pred[0]) > 0 else "SELL"
                confidence = 0.5
                return signal_str, confidence
                
        elif prediction_target == "classification":
            prob = float(1 / (1 + np.exp(-raw)))
            _THREAD_LOCAL.bullish_prob = prob
            _THREAD_LOCAL.bearish_prob = 1.0 - prob
            signal_str = "BUY" if prob >= 0.5 else "SELL"
            confidence = prob if prob >= 0.5 else 1 - prob
        else:
            if scaler_y is not None:
                try:
                    raw = float(scaler_y.inverse_transform(np.array([[raw]]))[0][0])
                except Exception:
                    pass
            
            if current_price and current_price > 0:
                if abs((raw - current_price) / current_price) < 0.5:
                    pred_return = (raw - current_price) / current_price
                else:
                    pred_return = raw
            else:
                pred_return = raw
                
            signal_str = "BUY" if pred_return > 0 else "SELL"
            confidence = min(0.95, abs(float(pred_return)) * 10)
            return signal_str, confidence, None, None, float(pred_return)
            
        return signal_str, confidence
        
    except Exception as e:
        print(f"[_infer_nextgen] Error running inference for {algorithm}: {e}")
        return "HOLD", 0.5
