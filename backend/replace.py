import re

with open('app/services/ml_predictor.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace _infer_torch completely
pattern = r"def _infer_torch\(.*?\):.*?return signal_str, confidence"
replacement = '''def _infer_torch(model_path: str, algorithm: str, X: np.ndarray, prediction_target: str, anomaly_threshold: float = None, current_price: float = 0.0, scaler_y=None):
    \"\"\"Inference for PyTorch models. Imports architecture from classic_dl_models.\"\"\"
    import torch
    import torch.nn as nn
    from app.services.advanced_ml.architectures import TCNModel, TabNetEncoder, AutoEncoder
    from app.models.classic_dl_models import SimpleLSTM, SimpleGRU, CNN1D, DeepLOB
    import numpy as np
    import os

    pt_path = model_path if model_path.endswith(".pt") else model_path.replace(".pkl", ".pt")
    if not os.path.exists(pt_path):
        raise FileNotFoundError(f"PyTorch checkpoint not found: {pt_path}")

    input_size = X.shape[1]

    if prediction_target == "multi_task":
        out_size = 2
    elif prediction_target == "advanced_setup":
        out_size = 3
    else:
        out_size = 1

    # ── Architecture Selection ──
    if algorithm == "LSTM":
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = SimpleLSTM(input_size=input_size, hidden_size=64, num_layers=2, output_size=64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = SimpleLSTM(input_size=input_size, hidden_size=64, num_layers=2, output_size=out_size)
        
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X).unsqueeze(1)

    elif algorithm == "GRU":
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = SimpleGRU(input_size=input_size, hidden_size=64, num_layers=2, output_size=64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = SimpleGRU(input_size=input_size, hidden_size=64, num_layers=2, output_size=out_size)
            
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X).unsqueeze(1)

    elif algorithm in ("1D-CNN",):
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = CNN1D(input_size=input_size, output_size=64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = CNN1D(input_size=input_size, output_size=out_size)
            
        if len(X.shape) == 2:
            X_t = torch.FloatTensor(X[-1:]).unsqueeze(0)
        else:
            X_t = torch.FloatTensor(X)

    elif algorithm == "DeepLOB":
        if prediction_target == "multi_task":
            from app.services.mtl.wrapper import DualHeadModel
            base_model = DeepLOB(input_size=input_size, output_size=64)
            model = DualHeadModel(base_model=base_model, hidden_dim=64)
        else:
            model = DeepLOB(input_size=input_size, output_size=out_size)
            
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

    # Load weights
    state = torch.load(pt_path, map_location="cpu")
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
                prob = torch.sigmoid(class_logits).numpy().flatten()[0]
                raw_return = reg_value.numpy().flatten()[0]
                if scaler_y is not None:
                    raw_return = float(scaler_y.inverse_transform(np.array([[raw_return]]))[0][0])
            else:
                if isinstance(out, tuple):
                    out = out[0]
                raw = out.numpy().flatten()[0]

    if algorithm == "Auto-Encoder":
        if anomaly_threshold is not None and raw > anomaly_threshold:
            signal_str = "Market can sudden crash"
            confidence = min(0.99, float(raw / (anomaly_threshold + 1e-9)))
        else:
            signal_str = "Market can pump heavily"
            confidence = 0.5
    else:
        if prediction_target == "multi_task":
            signal_str = "BUY" if float(prob) >= 0.5 else "SELL"
            confidence = (float(prob) if float(prob) >= 0.5 else 1.0 - float(prob)) * min(1.0, max(0.1, abs(float(raw_return)) * 100.0))
            confidence = min(0.99, max(0.1, confidence))
            confidence = float(confidence)
            return signal_str, confidence, None, None, float(raw_return)
        elif prediction_target == "classification":
            prob = float(1 / (1 + np.exp(-float(raw))))
            signal_str = "BUY" if prob >= 0.5 else "SELL"
            confidence = prob if prob >= 0.5 else 1.0 - prob
        else:
            signal_str = "BUY" if float(raw) > 0 else "SELL"
            confidence = min(0.95, abs(float(raw)))
            
        confidence = float(confidence)

    return signal_str, confidence'''

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('app/services/ml_predictor.py', 'w', encoding='utf-8') as f:
    f.write(content)
