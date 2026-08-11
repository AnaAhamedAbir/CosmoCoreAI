import torch
import torch.nn as nn

class MuZeroDynamicsEngine(nn.Module):
    """
    MuZero / DreamerV3 Model-Based Dynamics Engine.
    This component learns the internal transition dynamics of the market,
    allowing the agent to simulate future states without executing trades.
    Designed for memory efficiency (batch processing).
    """
    def __init__(self, observation_dim: int, action_dim: int, hidden_dim: int = 256):
        super().__init__()
        self.observation_dim = observation_dim
        self.action_dim = action_dim
        
        # Representation Network: Maps raw market observation to hidden state
        self.representation_net = nn.Sequential(
            nn.Linear(observation_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        # Dynamics Network: Predicts next hidden state and intermediate reward
        # given current hidden state and action
        self.dynamics_net = nn.Sequential(
            nn.Linear(hidden_dim + action_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim + 1) # +1 for reward prediction
        )
        
        # Prediction Network: Predicts policy (action distribution) and value
        self.prediction_net = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU()
        )
        self.policy_head = nn.Linear(hidden_dim, action_dim)
        self.value_head = nn.Linear(hidden_dim, 1)

    def represent(self, observation: torch.Tensor) -> torch.Tensor:
        """Encode observation into latent state"""
        return self.representation_net(observation)

    def dynamics(self, hidden_state: torch.Tensor, action: torch.Tensor):
        """Simulate next state and reward"""
        x = torch.cat([hidden_state, action], dim=-1)
        out = self.dynamics_net(x)
        next_hidden, reward = out[..., :-1], out[..., -1:]
        return next_hidden, reward

    def predict(self, hidden_state: torch.Tensor):
        """Predict policy and value from latent state"""
        x = self.prediction_net(hidden_state)
        policy_logits = self.policy_head(x)
        value = self.value_head(x)
        return policy_logits, value
