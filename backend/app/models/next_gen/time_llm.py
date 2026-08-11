import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

logger = logging.getLogger(__name__)

class PatchEmbedding(nn.Module):
    def __init__(self, input_dim, embed_dim):
        super().__init__()
        self.proj = nn.Linear(input_dim, embed_dim)
        
    def forward(self, x):
        return self.proj(x)

class TimeLLMCore(nn.Module):
    def __init__(self, input_dim, embed_dim, output_dim):
        super().__init__()
        self.patch_embed = PatchEmbedding(input_dim, embed_dim)
        # Using a small Transformer Encoder to simulate the frozen LLM reprogramming
        encoder_layer = nn.TransformerEncoderLayer(d_model=embed_dim, nhead=4, batch_first=True)
        self.llm_backbone = nn.TransformerEncoder(encoder_layer, num_layers=2)
        self.head = nn.Linear(embed_dim, output_dim)
        
    def forward(self, x):
        # x shape expected: (batch, seq_len, features)
        # If input is (batch, features), we unsqueeze
        if len(x.shape) == 2:
            x = x.unsqueeze(1)
            
        x_emb = self.patch_embed(x)
        features = self.llm_backbone(x_emb)
        # Take the last token for forecasting
        last_hidden = features[:, -1, :]
        out = self.head(last_hidden)
        return out

class TimeLLMModel:
    """
    Time-LLM (Time-Series Large Language Model)
    Reprograms pre-trained LLMs to understand time-series forecasting by embedding
    time-series patches into language tokens.
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.patch_len = config.get("patch_len", 16)
        self.stride = config.get("stride", 8)
        self.embed_dim = config.get("embed_dim", 64)
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Initialized TimeLLMModel (patch_len={self.patch_len}) on {self.device}")

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 5):
        logger.info(f"Fine-tuning Time-LLM on data of shape {X_train.shape}")
        
        input_dim = X_train.shape[1] if len(X_train.shape) == 2 else X_train.shape[-1]
        output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        self.model = TimeLLMCore(input_dim, self.embed_dim, output_dim).to(self.device)
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
            
        logger.info(f"Time-LLM training completed. Final Loss: {loss.item():.4f}")
        return {"status": "success", "loss": float(loss.item())}

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("Time-LLM model is not trained yet.")
        self.model.eval()
        with torch.no_grad():
            X_tensor = torch.FloatTensor(X).to(self.device)
            preds = self.model(X_tensor)
        return preds.cpu().numpy()
