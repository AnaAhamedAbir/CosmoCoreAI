import torch
import torch.nn as nn
from typing import Tuple

class DualHeadModel(nn.Module):
    """
    A dynamic wrapper that takes any base PyTorch model and attaches two heads:
    - Classification Head (predicts market direction probability)
    - Regression Head (predicts exact return or price)
    """
    def __init__(self, base_model: nn.Module, hidden_dim: int):
        super(DualHeadModel, self).__init__()
        self.base_model = base_model
        self.hidden_dim = hidden_dim
        
        # Dual Heads
        self.classification_head = nn.Linear(hidden_dim, 1)
        self.regression_head = nn.Linear(hidden_dim, 1)

    def forward(self, x) -> Tuple[torch.Tensor, torch.Tensor]:
        # Extract features using the shared base model
        # Assuming base_model returns features of shape (batch_size, hidden_dim)
        # If the base model is LSTM, we might need to handle the tuple output
        features = self.base_model(x)
        
        # Sometimes base models return a tuple (output, (h_n, c_n)) like standard LSTM
        if isinstance(features, tuple):
            features = features[0]
            
        # If it returns sequence, take the last timestep
        if features.dim() == 3:
            features = features[:, -1, :]
            
        class_logits = self.classification_head(features)
        reg_value = self.regression_head(features)
        
        return class_logits, reg_value
