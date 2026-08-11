import torch
import torch.nn as nn

class ManagerAgent(nn.Module):
    """
    High-level agent that decides macro-level actions like risk limits, 
    asset allocation, or target SL/TP setup for the given period.
    """
    def __init__(self, obs_dim: int, goal_dim: int, hidden_dim: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, goal_dim) # Outputs a 'goal' or 'target' for the worker
        )
        
    def forward(self, obs):
        return self.net(obs)

class WorkerAgent(nn.Module):
    """
    Low-level agent that executes exact trade actions (buy/sell at specific price)
    conditioned on the Manager's goal.
    """
    def __init__(self, obs_dim: int, goal_dim: int, action_dim: int, hidden_dim: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim + goal_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim)
        )
        
    def forward(self, obs, goal):
        x = torch.cat([obs, goal], dim=-1)
        return self.net(x)

class HRLArchitecture(nn.Module):
    """
    Hierarchical RL Manager-Worker architecture.
    """
    def __init__(self, obs_dim: int, goal_dim: int, action_dim: int):
        super().__init__()
        self.manager = ManagerAgent(obs_dim, goal_dim)
        self.worker = WorkerAgent(obs_dim, goal_dim, action_dim)
        
    def forward(self, obs):
        # Manager generates a goal based on current observation
        goal = self.manager(obs)
        # Worker executes an action based on observation and manager's goal
        action = self.worker(obs, goal)
        return action, goal
