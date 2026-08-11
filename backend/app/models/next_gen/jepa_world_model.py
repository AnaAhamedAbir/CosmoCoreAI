import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

logger = logging.getLogger(__name__)

class JEPAEncoder(nn.Module):
    def __init__(self, input_dim, embed_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Linear(256, embed_dim)
        )
    def forward(self, x):
        return self.net(x)

class JEPAPredictor(nn.Module):
    def __init__(self, embed_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(embed_dim, 256),
            nn.GELU(),
            nn.Linear(256, embed_dim)
        )
    def forward(self, x):
        return self.net(x)

class JEPACore(nn.Module):
    def __init__(self, input_dim, embed_dim, output_dim):
        super().__init__()
        self.encoder = JEPAEncoder(input_dim, embed_dim)
        self.predictor = JEPAPredictor(embed_dim)
        self.head = nn.Linear(embed_dim, output_dim)
    
    def forward(self, x):
        z = self.encoder(x)
        # JEPA predicts future latent states. For basic implementation, we just pass through predictor.
        z_pred = self.predictor(z) 
        out = self.head(z_pred)
        return out

class JEPAWorldModel:
    """
    Joint Embedding Predictive Architecture (JEPA)
    Learns high-level representations by predicting missing parts of the market state
    in latent space, avoiding pixel-level/raw-level generative overhead.
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.embed_dim = config.get("embed_dim", 128)
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Initialized JEPAWorldModel (embed_dim={self.embed_dim}) on {self.device}")

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 10):
        logger.info(f"Training JEPA World Model on shape {X_train.shape}")
        
        input_dim = X_train.shape[1]
        output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        self.model = JEPACore(input_dim, self.embed_dim, output_dim).to(self.device)
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
            
        logger.info(f"JEPA training completed. Final Loss: {loss.item():.4f}")
        return {"status": "success", "loss": float(loss.item())}

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("JEPA model is not trained yet.")
        self.model.eval()
        with torch.no_grad():
            X_tensor = torch.FloatTensor(X).to(self.device)
            preds = self.model(X_tensor)
        return preds.cpu().numpy()

