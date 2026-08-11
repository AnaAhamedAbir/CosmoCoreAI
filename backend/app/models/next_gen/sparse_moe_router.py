import logging
from typing import Dict, Any
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .jepa_world_model import JEPACore
from .time_llm import TimeLLMCore
from .ttft import TTFTCore
from .gnn_rl import GNNRLCore
from .snn_liquid import SNNLiquidCore
from ..classic_dl_models import SimpleLSTM, SimpleGRU, CNN1D, DeepLOB, TCN, StandardTransformer

logger = logging.getLogger(__name__)

class GenericPyTorchWrapper(nn.Module):
    def __init__(self, core_module):
        super().__init__()
        self.core = core_module
    def forward(self, x):
        return self.core(x)

class SparseMoERouterModel:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        # 5 Next-Gen Experts + 6 Classic PyTorch Experts + 2 Dense MLPs = 13 Experts Total
        self.num_experts = 13
        self.top_k = config.get("top_k", 2)
        self.gate = None
        self.experts = nn.ModuleList()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def train(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 10):
        logger.info(f"Training Sparse MoE Router with {epochs} epochs on {X_train.shape} across {self.num_experts} Mixed Experts")
        
        input_dim = X_train.shape[1] if len(X_train.shape) == 2 else X_train.shape[-1]
        output_dim = y_train.shape[1] if len(y_train.shape) > 1 else 1
        
        # Initialize Gate
        self.gate = nn.Linear(input_dim, self.num_experts).to(self.device)
        
        # Initialize Real Next-Gen + Classic Experts
        self.experts = nn.ModuleList([
            # Next-Gen
            GenericPyTorchWrapper(JEPACore(input_dim, 128, output_dim)),
            GenericPyTorchWrapper(TimeLLMCore(input_dim, 64, output_dim)),
            GenericPyTorchWrapper(TTFTCore(input_dim, 64, output_dim)),
            GenericPyTorchWrapper(GNNRLCore(input_dim, 64, output_dim)),
            GenericPyTorchWrapper(SNNLiquidCore(input_dim, 128, output_dim)),
            # Classic
            GenericPyTorchWrapper(SimpleLSTM(input_size=input_dim, hidden_size=64, num_layers=2, output_size=output_dim)),
            GenericPyTorchWrapper(SimpleGRU(input_size=input_dim, hidden_size=64, num_layers=2, output_size=output_dim)),
            GenericPyTorchWrapper(CNN1D(input_size=input_dim, output_size=output_dim)),
            GenericPyTorchWrapper(DeepLOB(input_size=input_dim, output_size=output_dim)),
            GenericPyTorchWrapper(TCN(input_size=input_dim, output_size=output_dim)),
            GenericPyTorchWrapper(StandardTransformer(input_size=input_dim, output_size=output_dim, d_model=64, nhead=4, num_layers=2)),
            # Standard MLP for diversity
            nn.Sequential(nn.Linear(input_dim, 128), nn.GELU(), nn.Linear(128, output_dim)),
            nn.Sequential(nn.Linear(input_dim, 64), nn.ReLU(), nn.Linear(64, output_dim))
        ]).to(self.device)
            
        X_t = torch.FloatTensor(X_train).to(self.device)
        y_t = torch.FloatTensor(y_train).to(self.device)
        if len(y_t.shape) == 1:
            y_t = y_t.unsqueeze(1)
            
        criterion = nn.MSELoss()
        params = list(self.gate.parameters())
        for e in self.experts:
            params.extend(list(e.parameters()))
            
        optimizer = torch.optim.AdamW(params, lr=self.config.get("learning_rate", 0.001))
        
        for epoch in range(epochs):
            optimizer.zero_grad()
            
            # Gating logits - expect (Batch, Features)
            if len(X_t.shape) == 3:
                x_gate = X_t.mean(dim=1)
            else:
                x_gate = X_t
                
            gate_logits = self.gate(x_gate)
            
            # Top-k routing
            topk_values, topk_indices = torch.topk(gate_logits, self.top_k, dim=-1)
            routing_weights = F.softmax(topk_values, dim=-1)
            
            # Compute expert outputs
            final_out = torch.zeros_like(y_t)
            for batch_idx in range(X_t.size(0)):
                for k in range(self.top_k):
                    expert_idx = topk_indices[batch_idx, k]
                    weight = routing_weights[batch_idx, k]
                    
                    # Prepare input for expert
                    x_expert = X_t[batch_idx].unsqueeze(0)
                    
                    expert_out = self.experts[expert_idx](x_expert)
                    # If expert output is (1, seq, out) we take last seq element
                    if len(expert_out.shape) == 3:
                        expert_out = expert_out[:, -1, :]
                        
                    final_out[batch_idx] += weight * expert_out.squeeze(0)
            
            loss = criterion(final_out, y_t)
            
            # Add auxiliary load balancing loss
            importance = gate_logits.softmax(dim=-1).sum(dim=0)
            load_loss = importance.var() * 0.01
            total_loss = loss + load_loss
            
            total_loss.backward()
            optimizer.step()
            
            if epoch % max(1, epochs // 5) == 0:
                logger.info(f"Epoch {epoch}: Total Loss = {total_loss.item():.4f}, Main Loss = {loss.item():.4f}")
                
        return {"loss": loss.item(), "status": "completed"}

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.gate is None:
            return np.zeros((X.shape[0], 1))
            
        with torch.no_grad():
            X_t = torch.FloatTensor(X).to(self.device)
            if len(X_t.shape) == 3:
                x_gate = X_t.mean(dim=1)
            else:
                x_gate = X_t
                
            gate_logits = self.gate(x_gate)
            topk_values, topk_indices = torch.topk(gate_logits, self.top_k, dim=-1)
            routing_weights = F.softmax(topk_values, dim=-1)
            
            final_out = []
            for batch_idx in range(X_t.size(0)):
                out_b = 0
                for k in range(self.top_k):
                    expert_idx = topk_indices[batch_idx, k]
                    weight = routing_weights[batch_idx, k]
                    x_expert = X_t[batch_idx].unsqueeze(0)
                    expert_out = self.experts[expert_idx](x_expert)
                    if len(expert_out.shape) == 3:
                        expert_out = expert_out[:, -1, :]
                    out_b += weight * expert_out.squeeze(0)
                final_out.append(out_b.cpu().numpy())
                
        return np.array(final_out)
