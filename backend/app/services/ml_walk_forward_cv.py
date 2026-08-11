"""
ml_walk_forward_cv.py
────────────────────────────────────────────────────
Walk-Forward Cross-Validation for ML Training Pipeline.

Supports:
  - Tree-based models  : Random Forest, XGBoost, LightGBM, CatBoost
  - Deep Learning      : LSTM, GRU, 1D-CNN, DeepLOB, Transformer
  
For Deep Learning, uses fewer folds (3) and very few epochs (3)
to keep CV time reasonable.
────────────────────────────────────────────────────
"""

import numpy as np
from typing import List, Callable


# ─── Tree-Based CV ────────────────────────────────────────────────────────────

def _cv_tree_model(algorithm: str, X_train: np.ndarray, y_train: np.ndarray,
                   features: list, prediction_target: str,
                   epochs: int, learning_rate: float, max_depth: int,
                   n_splits: int, add_log: Callable) -> List[float]:
    """Run TimeSeriesSplit CV for tree-based models."""
    from sklearn.model_selection import TimeSeriesSplit
    import pandas as pd

    tscv = TimeSeriesSplit(n_splits=n_splits)
    X_df = pd.DataFrame(X_train, columns=features)
    y_flat = y_train.ravel()
    scores = []

    for fold_idx, (train_idx, val_idx) in enumerate(tscv.split(X_df)):
        X_fold_train = X_df.iloc[train_idx]
        X_fold_val   = X_df.iloc[val_idx]
        y_fold_train = y_flat[train_idx]
        y_fold_val   = y_flat[val_idx]

        try:
            if algorithm == "Random Forest":
                if prediction_target == "classification":
                    from sklearn.ensemble import RandomForestClassifier
                    m = RandomForestClassifier(n_estimators=min(epochs, 50), max_depth=max_depth, random_state=42)
                else:
                    from sklearn.ensemble import RandomForestRegressor
                    m = RandomForestRegressor(n_estimators=min(epochs, 50), max_depth=max_depth, random_state=42)

            elif algorithm == "XGBoost":
                if prediction_target == "classification":
                    from xgboost import XGBClassifier
                    m = XGBClassifier(n_estimators=min(epochs, 50), learning_rate=learning_rate, max_depth=max_depth, random_state=42, eval_metric='logloss', verbosity=0)
                else:
                    from xgboost import XGBRegressor
                    m = XGBRegressor(n_estimators=min(epochs, 50), learning_rate=learning_rate, max_depth=max_depth, random_state=42, verbosity=0)

            elif algorithm == "LightGBM":
                import lightgbm as lgb
                if prediction_target == "classification":
                    m = lgb.LGBMClassifier(n_estimators=min(epochs, 50), learning_rate=learning_rate, max_depth=max_depth, random_state=42, verbose=-1)
                else:
                    m = lgb.LGBMRegressor(n_estimators=min(epochs, 50), learning_rate=learning_rate, max_depth=max_depth, random_state=42, verbose=-1)

            elif algorithm == "CatBoost":
                import catboost as cb
                if prediction_target == "classification":
                    m = cb.CatBoostClassifier(iterations=min(epochs, 50), learning_rate=learning_rate, depth=max_depth, random_seed=42, verbose=False)
                else:
                    m = cb.CatBoostRegressor(iterations=min(epochs, 50), learning_rate=learning_rate, depth=max_depth, random_seed=42, verbose=False)
            else:
                return []

            m.fit(X_fold_train, y_fold_train)
            preds = m.predict(X_fold_val)

            if prediction_target == "classification":
                from sklearn.metrics import accuracy_score
                score = accuracy_score(y_fold_val.astype(int), preds.astype(int))
            else:
                from sklearn.metrics import r2_score
                score = max(0.0, r2_score(y_fold_val, preds))

            scores.append(score)
            add_log(f"[CV] Fold {fold_idx+1}/{n_splits}: {'Accuracy' if prediction_target == 'classification' else 'R2'} = {score*100:.1f}%")

        except Exception as e:
            add_log(f"[CV] Fold {fold_idx+1} failed: {e}")

    return scores


# ─── Deep Learning CV ─────────────────────────────────────────────────────────

def _cv_deep_model(algorithm: str, X_train: np.ndarray, y_train: np.ndarray,
                   prediction_target: str, n_splits: int, add_log: Callable) -> List[float]:
    """Run a lightweight CV for PyTorch deep learning models (3 folds, 3 epochs)."""
    import torch
    import torch.nn as nn
    from sklearn.model_selection import TimeSeriesSplit

    tscv = TimeSeriesSplit(n_splits=n_splits)
    scores = []
    CV_EPOCHS = 3  # Intentionally small to keep time reasonable

    for fold_idx, (train_idx, val_idx) in enumerate(tscv.split(X_train)):
        X_fold_train = X_train[train_idx]
        X_fold_val   = X_train[val_idx]
        y_fold_train = y_train.ravel()[train_idx].astype(float)
        y_fold_val   = y_train.ravel()[val_idx].astype(float)

        try:
            input_size = X_fold_train.shape[1]

            # Build a tiny version of the chosen architecture
            if algorithm in ["LSTM", "GRU"]:
                class _RNNModel(nn.Module):
                    def __init__(self, rnn_type, input_size):
                        super().__init__()
                        rnn_cls = nn.LSTM if rnn_type == "LSTM" else nn.GRU
                        self.rnn = rnn_cls(input_size, 32, 1, batch_first=True)
                        self.fc = nn.Linear(32, 1)
                    def forward(self, x):
                        out, _ = self.rnn(x)
                        return self.fc(out[:, -1, :])

                model = _RNNModel(algorithm, input_size)
                X_tr_t  = torch.FloatTensor(X_fold_train).unsqueeze(1)
                X_val_t = torch.FloatTensor(X_fold_val).unsqueeze(1)

            elif algorithm in ["1D-CNN", "DeepLOB"]:
                class _CNNModel(nn.Module):
                    def __init__(self, input_size):
                        super().__init__()
                        self.conv = nn.Conv1d(1, 8, kernel_size=3, padding=1)
                        self.relu = nn.ReLU()
                        self.pool = nn.AdaptiveAvgPool1d(1)
                        self.fc   = nn.Linear(8, 1)
                    def forward(self, x):
                        x = x.unsqueeze(1)
                        x = self.pool(self.relu(self.conv(x)))
                        return self.fc(x.squeeze(-1))

                model = _CNNModel(input_size)
                X_tr_t  = torch.FloatTensor(X_fold_train)
                X_val_t = torch.FloatTensor(X_fold_val)

            else:
                # Transformer or unknown deep model — simple MLP approximation
                class _MLPModel(nn.Module):
                    def __init__(self, input_size):
                        super().__init__()
                        self.net = nn.Sequential(
                            nn.Linear(input_size, 32), nn.ReLU(),
                            nn.Linear(32, 1)
                        )
                    def forward(self, x):
                        return self.net(x)

                model = _MLPModel(input_size)
                X_tr_t  = torch.FloatTensor(X_fold_train)
                X_val_t = torch.FloatTensor(X_fold_val)

            y_tr_t = torch.FloatTensor(y_fold_train)

            if prediction_target == "classification":
                criterion = nn.BCEWithLogitsLoss()
            else:
                criterion = nn.MSELoss()

            optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

            # Tiny training loop
            model.train()
            for _ in range(CV_EPOCHS):
                out = model(X_tr_t)
                optimizer.zero_grad()
                loss = criterion(out.squeeze(-1), y_tr_t.view(-1))
                loss.backward()
                optimizer.step()

            # Evaluate
            model.eval()
            with torch.no_grad():
                val_out = model(X_val_t).squeeze(-1).numpy()

            if prediction_target == "classification":
                from sklearn.metrics import accuracy_score
                preds = (1 / (1 + np.exp(-val_out)) > 0.5).astype(int)
                score = accuracy_score(y_fold_val.astype(int), preds)
            else:
                from sklearn.metrics import r2_score
                score = max(0.0, r2_score(y_fold_val, val_out))

            scores.append(score)
            add_log(f"[CV-DL] Fold {fold_idx+1}/{n_splits}: {'Accuracy' if prediction_target == 'classification' else 'R2'} = {score*100:.1f}%")

        except Exception as e:
            add_log(f"[CV-DL] Fold {fold_idx+1} failed: {e}")

    return scores


# ─── Public Entry Point ───────────────────────────────────────────────────────

TREE_MODELS = {"Random Forest", "XGBoost", "LightGBM", "CatBoost"}
DEEP_MODELS = {"LSTM", "GRU", "1D-CNN", "DeepLOB", "Transformer"}


def run_walk_forward_cv(
    algorithm: str,
    X_train: np.ndarray,
    y_train: np.ndarray,
    features: list,
    prediction_target: str,
    epochs: int,
    learning_rate: float,
    max_depth: int,
    add_log: Callable
) -> dict:
    """
    Run Walk-Forward Cross-Validation for all supported model types.
    
    Returns a dict:
      {
        "cv_scores": [0.65, 0.67, ...],
        "cv_avg":    0.663,
        "cv_std":    0.012
      }
    or empty dict on failure.
    """
    is_tree = algorithm in TREE_MODELS
    is_deep = algorithm in DEEP_MODELS

    if not is_tree and not is_deep:
        add_log(f"[CV] Walk-Forward CV skipped for '{algorithm}' (not supported).")
        return {}

    n_splits = 5 if is_tree else 3  # Fewer folds for DL to save time
    label = "Walk-Forward CV" if is_tree else "Walk-Forward CV (DL — Lightweight)"
    add_log(f"[CV] Starting {label} for {algorithm} ({n_splits} folds)...")

    try:
        if is_tree:
            scores = _cv_tree_model(
                algorithm, X_train, y_train, features, prediction_target,
                epochs, learning_rate, max_depth, n_splits, add_log
            )
        else:
            scores = _cv_deep_model(
                algorithm, X_train, y_train,
                prediction_target, n_splits, add_log
            )

        if not scores:
            add_log("[CV] No folds completed successfully.")
            return {}

        avg   = float(np.mean(scores))
        std   = float(np.std(scores))
        metric_label = "Accuracy" if prediction_target == "classification" else "R2"
        add_log(f"[CV] ✅ Avg {metric_label}: {avg*100:.1f}% (±{std*100:.1f}%)")

        return {
            "cv_scores": [round(s, 4) for s in scores],
            "cv_avg":    round(avg, 4),
            "cv_std":    round(std, 4)
        }

    except Exception as e:
        add_log(f"[CV] Walk-Forward CV failed: {e}")
        return {}
