import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

logger = logging.getLogger(__name__)

class TTFTCore(nn.Module):
    def __init__(self, input_dim, d_token, output_dim):
        super().__init__()
        # Tokenize tabular features
        self.feature_tokenizer = nn.Linear(input_dim, d_token)
        
        # Temporal dependencies via Transformer
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_token, nhead=4, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=3)
        
        self.head = nn.Sequential(
            nn.Linear(d_token, d_token // 2),
            nn.GELU(),
            nn.Linear(d_token // 2, output_dim)
        )
        
    def forward(self, x):
        # x shape: (batch, seq_len, input_dim)
        if len(x.shape) == 2:
            x = x.unsqueeze(1)
            
        tokens = self.feature_tokenizer(x)
        encoded = self.transformer(tokens)
        
        # Aggregate temporal sequence
        pooled = torch.mean(encoded, dim=1)
        return self.head(pooled)

class TTFTModel:
    """
    Temporal Tabular Foundation Models (TTFT)
    Designed to handle heterogeneous tabular data with temporal dependencies,
    making it perfect for combined orderbook, on-chain, and macro data.
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.d_token = config.get("d_token", 64)
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Initialized TTFTModel (d_token={self.d_token}) on {self.device}")

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 10):
        logger.info(f"Training TTFT on tabular sequence {X_train.shape}")
        
        input_dim = X_train.shape[1] if len(X_train.shape) == 2 else X_train.shape[-1]
        output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        self.model = TTFTCore(input_dim, self.d_token, output_dim).to(self.device)
        optimizer = optim.AdamW(self.model.parameters(), lr=0.001)
        criterion = nn.MSELoss()
        
        X_tensor = torch.FloatTensor(X_train).to(self.device)
        y_tensor = torch.FloatTensor(y_train).to(self.device)
        if len(y_tensor.shape) == 1:
            y_tensor = y_tensor.unsqueeze(1)
            
        self.model.train()
        for epoch in range(epochs):
            optimizer.zero_grad()
            outputs = self.model(X_tensor)
            loss = criterion(outputs, y_tensor)
            loss.backward()
            optimizer.step()
            
        logger.info(f"TTFT training completed. Final Loss: {loss.item():.4f}")
        return {"status": "success", "loss": float(loss.item())}

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("TTFT model is not trained yet.")
        self.model.eval()
        with torch.no_grad():
            X_tensor = torch.FloatTensor(X).to(self.device)
            preds = self.model(X_tensor)
        return preds.cpu().numpy()
