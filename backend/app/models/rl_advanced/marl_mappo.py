import torch
import torch.nn as nn

class MAPPOAgent(nn.Module):
    """
    Multi-Agent PPO (MAPPO) Agent for cooperative multi-asset portfolio management.
    Actor uses local observation, Critic uses global observation (centralized training).
    """
    def __init__(self, local_obs_dim: int, global_obs_dim: int, action_dim: int, hidden_dim: int = 128):
        super().__init__()
        
        # Actor: Takes only local observations (e.g., EUR/USD specific data)
        self.actor = nn.Sequential(
            nn.Linear(local_obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim)
        )
        
        # Critic: Takes global state (all pairs, portfolio total value, macro data)
        self.critic = nn.Sequential(
            nn.Linear(global_obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1)
        )

    def get_action(self, local_obs):
        # In a real continuous action space, this would output mean and log_std
        return self.actor(local_obs)
        
    def get_value(self, global_obs):
        return self.critic(global_obs)

class MultiAgentPortfolioSystem(nn.Module):
    """
    Wrapper holding multiple MAPPO agents (e.g., one for each currency pair or asset).
    """
    def __init__(self, num_agents: int, local_obs_dim: int, global_obs_dim: int, action_dim: int):
        super().__init__()
        self.agents = nn.ModuleList([
            MAPPOAgent(local_obs_dim, global_obs_dim, action_dim) for _ in range(num_agents)
        ])
        
    def get_actions(self, local_observations):
        """
        local_observations: List of tensors, one for each agent
        """
        return [agent.get_action(obs) for agent, obs in zip(self.agents, local_observations)]
        
    def get_values(self, global_observation):
        """
        All agents evaluate the global state to estimate the shared portfolio value
        """
        return [agent.get_value(global_observation) for agent in self.agents]
