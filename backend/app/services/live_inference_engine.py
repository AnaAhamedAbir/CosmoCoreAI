import asyncio
import json
import os
import joblib
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional

from app.db.session import SessionLocal
from app import models

class LiveFeatureExtractor:
    def __init__(self, metadata: Dict[str, Any]):
        self.metadata = metadata
        self.features = metadata.get("features", [])
        self.target_columns = metadata.get("target_column", [])
        self.state = {} # Keep rolling history if needed (e.g., last 100 candles for RSI)
        
        self.scaler = None
        scaler_path = metadata.get("scaler_path")
        if scaler_path:
            # Need to resolve correct absolute path inside docker
            abs_scaler_path = os.path.join("/app", scaler_path) if not scaler_path.startswith("/") else scaler_path
            if os.path.exists(abs_scaler_path):
                try:
                    self.scaler = joblib.load(abs_scaler_path)
                    print(f"[LiveFeatureExtractor] Scaler loaded from {abs_scaler_path}")
                except Exception as e:
                    print(f"[LiveFeatureExtractor] Failed to load scaler: {e}")
            else:
                print(f"[LiveFeatureExtractor] Scaler path not found: {abs_scaler_path}")
        
    def process_tick(self, market_data: Dict[str, Any]) -> Optional[pd.DataFrame]:
        # Here we maintain a rolling buffer of market data (candles, orderbook)
        # and calculate the required features dynamically.
        # For simplicity in this skeleton, we extract directly if available,
        # or pad with 0.0 to match the exact feature shape the model expects.
        
        row = {}
        for feature in self.features:
            # Try to get from market data or state
            row[feature] = market_data.get(feature, 0.0)
            
        df = pd.DataFrame([row])
        
        if self.scaler is not None and hasattr(self.scaler, 'transform'):
            try:
                # The scaler might expect specific column names or order
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    scaled_values = self.scaler.transform(df.values)
                df = pd.DataFrame(scaled_values, columns=df.columns)
            except Exception as e:
                print(f"[LiveFeatureExtractor] Scaling error: {e}")
                
        return df

class LivePyTorchModel:
    def __init__(self, pt_path: str, algorithm: str, input_size: int, out_size: int, prediction_target: str):
        import torch
        import torch.nn as nn
        from app.services.advanced_ml.architectures import TCNModel, TabNetEncoder, AutoEncoder
        
        self.algorithm = algorithm
        self.prediction_target = prediction_target
        
        # Build Architecture
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
                self.model = DualHeadModel(base_model=base_model, hidden_dim=64)
            else:
                self.model = SimpleLSTM(input_size)

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
                self.model = DualHeadModel(base_model=base_model, hidden_dim=64)
            else:
                self.model = SimpleGRU(input_size)

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
            self.model = CNN1D(input_size)

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
            self.model = DeepLOB(input_size)

        elif algorithm == "TCN":
            self.model = TCNModel(input_size=input_size, num_channels=[32, 64, 128], output_size=out_size)

        elif algorithm == "TabNet":
            self.model = TabNetEncoder(input_dim=input_size, output_dim=out_size)

        elif algorithm == "Auto-Encoder":
            self.model = AutoEncoder(input_dim=input_size, hidden_dim=32)

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
            self.model = MLPFallback(input_size)

        # Load weights
        state = torch.load(pt_path, map_location='cpu')
        self.model.load_state_dict(state, strict=False)
        self.model.eval()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

    def predict(self, X):
        import torch
        import numpy as np
        
        # X is (1, feature) or (feature,) from live extraction
        if isinstance(X, pd.DataFrame):
            X = X.values
            
        if self.algorithm in ["LSTM", "GRU", "TCN"]:
            if len(X.shape) == 2:
                X_t = torch.FloatTensor(X).unsqueeze(0)
            else:
                X_t = torch.FloatTensor(X).unsqueeze(1)
        elif self.algorithm in ("1D-CNN",):
            if len(X.shape) == 2:
                X_t = torch.FloatTensor(X[-1:]).unsqueeze(0)
            else:
                X_t = torch.FloatTensor(X)
        elif self.algorithm == "DeepLOB":
            if len(X.shape) == 2:
                X_t = torch.FloatTensor(X[-1:])
            else:
                X_t = torch.FloatTensor(X)
        else:
            if len(X.shape) == 2:
                X_t = torch.FloatTensor(X[-1:])
            else:
                X_t = torch.FloatTensor(X)
                
        X_t = X_t.to(self.device)

        with torch.no_grad():
            if self.algorithm == "Auto-Encoder":
                reconstructed = self.model(X_t)
                raw = torch.mean((reconstructed - X_t) ** 2, dim=1).cpu().numpy().flatten()
                return raw
                
            out = self.model(X_t)
            
            if self.prediction_target == "multi_task":
                class_logits, reg_value = out
                cls_prob = torch.sigmoid(class_logits).cpu().numpy().flatten()
                reg_val = reg_value.cpu().numpy().flatten()
                return np.concatenate([cls_prob, reg_val])
            else:
                if isinstance(out, tuple):
                    out = out[0]
                if self.prediction_target == "advanced_setup":
                    # Keep raw logits or pass through sigmoid? ml_predictor uses raw.
                    # live_inference_engine expects 0-1 for direction. So sigmoid the first element.
                    cls_out = torch.sigmoid(out[:, 0:1])
                    if out.shape[1] > 1:
                        reg_out = out[:, 1:]
                        return torch.cat([cls_out, reg_out], dim=1).cpu().numpy().flatten()
                    return cls_out.cpu().numpy().flatten()
                else:
                    return torch.sigmoid(out).cpu().numpy().flatten()

class LiveInferenceEngine:
    def __init__(self):
        self.active_model_id = None
        self.model = None
        self.extractor = None
        self.metadata = None
        self.is_running = False
        self._last_prediction_time = 0
        self.throttle_ms = 1000 # 1 second throttle

    def load_model(self, model_id: str) -> bool:
        if self.active_model_id == model_id and self.model is not None:
            return True
            
        db = SessionLocal()
        try:
            db_model = db.query(models.CustomMLModel).filter(models.CustomMLModel.id == model_id).first()
            if not db_model or not db_model.active_version_id:
                print(f"[InferenceEngine] Model {model_id} not found or no active version.")
                return False
                
            version = db.query(models.ModelVersion).filter(models.ModelVersion.id == db_model.active_version_id).first()
            if not version:
                print(f"[InferenceEngine] Model version missing for {model_id}.")
                return False
                
            model_path = version.file_path
            if model_path and not os.path.exists(model_path) and os.path.exists(model_path.replace(".pkl", ".pt")):
                model_path = model_path.replace(".pkl", ".pt")
                
            if not model_path or not os.path.exists(model_path):
                print(f"[InferenceEngine] Model file missing for {model_id}.")
                return False
                
            # Load scaler_y if exists
            scaler_y_path = model_path.replace(".pkl", ".scaler_y").replace(".pt", ".scaler_y").replace(".zip", ".scaler_y")
            self.scaler_y = None
            if os.path.exists(scaler_y_path):
                self.scaler_y = joblib.load(scaler_y_path)
            else:
                scaler_y_path_fallback = os.path.join(os.path.dirname(model_path), "model.scaler_y")
                if os.path.exists(scaler_y_path_fallback):
                    self.scaler_y = joblib.load(scaler_y_path_fallback)

            # Load metadata
            meta = {}
            if version.metadata_path and os.path.exists(version.metadata_path):
                with open(version.metadata_path, 'r') as f:
                    meta = json.load(f)
                    
            print(f"[InferenceEngine] Loading model {model_id} from {model_path}")
            
            try:
                algorithm = meta.get("algorithm", "")
                rl_algos = ["PPO-RL", "SAC-RL", "A2C-RL", "DDPG-RL", "DQN-RL", "TD3-RL"]
                pytorch_algos = ["1D-CNN", "LSTM", "GRU", "DeepLOB", "TCN", "TabNet", "Auto-Encoder"]
                
                if algorithm in rl_algos:
                    from stable_baselines3 import PPO, SAC, A2C, DDPG, DQN, TD3
                    algo_map = {
                        "PPO-RL": PPO, "SAC-RL": SAC, "A2C-RL": A2C,
                        "DDPG-RL": DDPG, "DQN-RL": DQN, "TD3-RL": TD3
                    }
                    ModelClass = algo_map.get(algorithm)
                    if ModelClass:
                        self.model = ModelClass.load(model_path)
                    else:
                        print(f"[InferenceEngine] Unsupported RL algorithm: {algorithm}")
                        return False
                elif algorithm in pytorch_algos:
                    # Dynamically build PyTorch model for live inference
                    features = meta.get("features", [])
                    prediction_target = meta.get("prediction_target", "classification")
                    input_size = len(features) if features else 1
                    out_size = 3 if prediction_target == "advanced_setup" else 1
                    
                    self.model = LivePyTorchModel(
                        pt_path=model_path,
                        algorithm=algorithm,
                        input_size=input_size,
                        out_size=out_size,
                        prediction_target=prediction_target
                    )
                else:
                    # Load joblib/pickle model
                    self.model = joblib.load(model_path)
            except Exception as e:
                print(f"[InferenceEngine] Failed to load model file: {e}")
                return False
                
            self.metadata = meta
            self.extractor = LiveFeatureExtractor(meta)
            self.active_model_id = model_id
            return True
        finally:
            db.close()

    def process_market_data(self, market_data: Dict[str, Any]) -> Optional[Dict[str, float]]:
        """
        Called when new market data (tick/candle) arrives.
        Returns predicted TP/SL if inference runs.
        """
        if not self.model or not self.extractor:
            return None
            
        current_time = asyncio.get_event_loop().time() * 1000
        if current_time - self._last_prediction_time < self.throttle_ms:
            # Throttled
            return None
            
        self._last_prediction_time = current_time
        
        # 1. Feature Extraction
        features_df = self.extractor.process_tick(market_data)
        if features_df is None:
            return None
            
        # 2. Prediction
        try:
            algorithm = self.metadata.get("algorithm", "")
            rl_algos = ["PPO-RL", "SAC-RL", "A2C-RL", "DDPG-RL", "DQN-RL", "TD3-RL"]
            
            if algorithm in rl_algos:
                obs = features_df.values
                action, _ = self.model.predict(obs, deterministic=True)
                preds = action
                
                # RL Scaling Logic for advanced_setup
                if self.metadata.get("prediction_target") == "advanced_setup" and isinstance(action, (list, np.ndarray)):
                    if len(action.shape) > 1:
                        action = action[0]
                    
                    # Extract current price from market data
                    current_price = float(market_data.get("currentPrice", market_data.get("price", market_data.get("Close", market_data.get("midPrice", 0.0)))))
                    
                    # Debug log
                    print(f"[InferenceEngine] Action: {action}, len: {len(action)}, price: {current_price}")
                    
                    if len(action) >= 3 and current_price > 0:
                        sl_dist = max(0.001, (action[1] + 1.0) / 2.0 * 0.1 * current_price)
                        tp_dist = max(0.001, (action[2] + 1.0) / 2.0 * 0.1 * current_price)
                        
                        action_val = action[0]
                    elif len(action) == 1 and current_price > 0:
                        # Legacy models trained without proper action space shape
                        sl_dist = 0.005 * current_price
                        tp_dist = 0.005 * current_price
                        action_val = action[0]
                    else:
                        print(f"[InferenceEngine] Failed condition: len(action)={len(action)}, current_price={current_price} > 0")
                        return {}
                    
                    if action_val > 0.33: # Long
                        target_tp = current_price + tp_dist
                        target_sl = current_price - sl_dist
                    elif action_val < -0.33: # Short
                        target_tp = current_price - tp_dist
                        target_sl = current_price + sl_dist
                    else: # Neutral
                        target_tp = current_price + tp_dist
                        target_sl = current_price - sl_dist
                        
                    result_dict = {
                        "Target_TP": float(target_tp),
                        "Target_SL": float(target_sl)
                    }
                    print(f"[InferenceEngine] Returning RL Result: {result_dict}")
                    return result_dict
            else:
                preds = self.model.predict(features_df)
            
            # Format output based on metadata target columns
            result = {}
            
            if isinstance(preds, (list, np.ndarray)):
                if len(preds.shape) > 1:
                    preds = preds[0]
                    
                target_cols = self.metadata.get("target_column", [])
                prediction_target = self.metadata.get("prediction_target", "")
                
                if prediction_target == "advanced_setup" and len(preds) >= 3:
                    # Apply scaler_y if available
                    if getattr(self, 'scaler_y', None) is not None:
                        try:
                            unscaled = self.scaler_y.inverse_transform([preds[1:3]])[0]
                            preds[1] = unscaled[0]
                            preds[2] = unscaled[1]
                        except Exception as e:
                            print(f"[InferenceEngine] Scaler inverse transform failed: {e}")

                    direction = float(preds[0]) # 1.0 (Long) or 0.0 (Short)
                    sl_dist = abs(float(preds[1]))
                    tp_dist = abs(float(preds[2]))
                    
                    current_price = float(market_data.get("currentPrice", market_data.get("price", market_data.get("Close", market_data.get("midPrice", 0.0)))))
                    
                    if current_price > 0:
                        if direction >= 0.5: # Long
                            target_sl = current_price * (1 - sl_dist)
                            target_tp = current_price * (1 + tp_dist)
                        else: # Short
                            target_sl = current_price * (1 + sl_dist)
                            target_tp = current_price * (1 - tp_dist)
                            
                        result = {
                            "Target_TP": float(target_tp),
                            "Target_SL": float(target_sl)
                        }
                        print(f"[InferenceEngine] Returning Multi-Output Result: {result}")
                        return result

                if isinstance(target_cols, list) and len(target_cols) > 0:
                    for i, col in enumerate(target_cols):
                        if i < len(preds):
                            result[col] = float(preds[i])
                else:
                    # Fallback mapping if targets aren't clearly defined
                    if len(preds) >= 2:
                        if len(preds) == 2:
                            result["Target_TP"] = float(preds[0])
                            result["Target_SL"] = float(preds[1])
                        else:
                            result["Target_TP"] = float(preds[1])
                            result["Target_SL"] = float(preds[2])
                        
            return result
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[InferenceEngine] Prediction error: {e}")
            return None

# Global Singleton Instance
inference_engine = LiveInferenceEngine()
