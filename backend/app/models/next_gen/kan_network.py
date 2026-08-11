import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

class KANNetworkModel:
    """
    Kolmogorov-Arnold Network (KAN)
    Uses learnable activation functions on edges instead of nodes.
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.model = None
        self.input_dim = None
        self.output_dim = None
        self.use_kan = False

    def __getstate__(self):
        state = self.__dict__.copy()
        if self.model is not None:
            state['model_state_dict'] = self.model.state_dict()
            del state['model']
        return state

    def __setstate__(self, state):
        model_state_dict = state.pop('model_state_dict', None)
        self.__dict__.update(state)
        self.model = None
        if model_state_dict is not None and self.input_dim is not None and self.output_dim is not None:
            if getattr(self, 'use_kan', False):
                try:
                    from kan import KAN
                    self.model = KAN(width=[self.input_dim, 5, self.output_dim], grid=5, k=3, seed=0)
                except ImportError:
                    pass
            if self.model is None:
                self.model = nn.Sequential(
                    nn.Linear(self.input_dim, 32),
                    nn.ReLU(),
                    nn.Linear(32, self.output_dim)
                )
            # PyTorch load_state_dict
            self.model.load_state_dict(model_state_dict)

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 10):
        logger.info(f"Training KAN Network with {epochs} epochs on shape {X_train.shape}")
        
        self.input_dim = X_train.shape[1]
        self.output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        try:
            from kan import KAN
            self.model = KAN(width=[self.input_dim, 5, self.output_dim], grid=5, k=3, seed=0)
            self.use_kan = True
        except ImportError:
            logger.warning("pykan not installed. Falling back to MLP stub.")
            self.model = nn.Sequential(
                nn.Linear(self.input_dim, 32),
                nn.ReLU(),
                nn.Linear(32, self.output_dim)
            )
            self.use_kan = False
            
        X_t = torch.FloatTensor(X_train)
        y_t = torch.FloatTensor(y_train)
        if len(y_t.shape) == 1:
            y_t = y_t.unsqueeze(1)
            
        criterion = nn.MSELoss()
        
        if self.use_kan:
            optimizer = torch.optim.LBFGS(self.model.parameters(), lr=1)
            
            for epoch in range(epochs):
                def closure():
                    optimizer.zero_grad()
                    out = self.model(X_t)
                    loss = criterion(out, y_t)
                    loss.backward()
                    return loss
                optimizer.step(closure)
                if epoch % max(1, epochs // 5) == 0:
                    out = self.model(X_t)
                    loss = criterion(out, y_t)
                    logger.info(f"Epoch {epoch}: Loss = {loss.item():.4f}")
            loss_val = criterion(self.model(X_t), y_t).item()
        else:
            optimizer = torch.optim.Adam(self.model.parameters(), lr=self.config.get("learning_rate", 0.01))
            for epoch in range(epochs):
                optimizer.zero_grad()
                out = self.model(X_t)
                loss = criterion(out, y_t)
                loss.backward()
                optimizer.step()
                if epoch % max(1, epochs // 5) == 0:
                    logger.info(f"Epoch {epoch}: Loss = {loss.item():.4f}")
            loss_val = loss.item()
                
        return {"loss": loss_val, "status": "completed"}

    def predict(self, X: np.ndarray) -> np.ndarray:
        logger.info(f"Predicting with KAN on input {X.shape}")
        if self.model is None:
            return np.zeros((X.shape[0], 1))
        
        with torch.no_grad():
            X_t = torch.FloatTensor(X)
            return self.model(X_t).numpy()
