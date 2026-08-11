import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

class MambaSSMModel:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.model = None
        
    def _build_model(self, input_dim: int, output_dim: int):
        try:
            from mamba_ssm import Mamba
            # Mamba expects (B, L, D) where L is sequence length. 
            # We will use a simple linear projection to Mamba's d_model
            d_model = self.config.get("mamba_d_model", 64)
            d_state = self.config.get("mamba_d_state", 16)
            d_conv = self.config.get("mamba_d_conv", 4)
            expand = self.config.get("mamba_expand", 2)
            
            self.proj_in = nn.Linear(input_dim, d_model)
            self.mamba_block = Mamba(
                d_model=d_model,
                d_state=d_state,
                d_conv=d_conv,
                expand=expand
            )
            self.proj_out = nn.Linear(d_model, output_dim)
            self.use_mamba = True
        except ImportError:
            logger.warning("mamba_ssm not installed. Falling back to GRU stub.")
            self.mamba_block = nn.GRU(input_dim, 64, batch_first=True)
            self.proj_out = nn.Linear(64, output_dim)
            self.use_mamba = False

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 10):
        logger.info(f"Training Mamba SSM with {epochs} epochs on shape {X_train.shape}")
        
        input_dim = X_train.shape[1]
        # Multi-output regression usually has shape (N, outputs)
        output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        self._build_model(input_dim, output_dim)
        
        # Convert to tensors
        X_t = torch.FloatTensor(X_train)
        y_t = torch.FloatTensor(y_train)
        
        # Mamba requires a sequence dimension: (Batch, SeqLen, Features)
        # We'll artificially add a sequence dimension of 1 if it's tabular
        X_t = X_t.unsqueeze(1)
        if len(y_t.shape) == 1:
            y_t = y_t.unsqueeze(1)
            
        criterion = nn.MSELoss()
        
        # Gather parameters
        if self.use_mamba:
            params = list(self.proj_in.parameters()) + list(self.mamba_block.parameters()) + list(self.proj_out.parameters())
        else:
            params = list(self.mamba_block.parameters()) + list(self.proj_out.parameters())
            
        optimizer = torch.optim.Adam(params, lr=self.config.get("learning_rate", 0.001))
        
        for epoch in range(epochs):
            optimizer.zero_grad()
            if self.use_mamba:
                x = self.proj_in(X_t)
                out = self.mamba_block(x)
                out = self.proj_out(out[:, -1, :]) # Take last step
            else:
                out, _ = self.mamba_block(X_t)
                out = self.proj_out(out[:, -1, :])
                
            loss = criterion(out, y_t)
            loss.backward()
            optimizer.step()
            
            if epoch % max(1, epochs // 5) == 0:
                logger.info(f"Epoch {epoch}: Loss = {loss.item():.4f}")
                
        return {"loss": loss.item(), "status": "completed"}

    def predict(self, X: np.ndarray) -> np.ndarray:
        logger.info(f"Predicting with Mamba model on input {X.shape}")
        # Stub: Implement inference
        return np.random.randn(X.shape[0], 1)
