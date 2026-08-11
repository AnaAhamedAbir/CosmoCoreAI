import gymnasium as gym
import numpy as np

class MaxDrawdownActionMasker(gym.Wrapper):
    """
    A modular Gym Wrapper that enforces a Maximum Drawdown Risk Limit on RL Trading Environments.
    If the current drawdown exceeds the max_allowed_drawdown limit, this wrapper intercepts 
    the model's action and forces a "Neutral/Cash" position, safely overriding the AI's decision.
    """
    def __init__(self, env, max_allowed_drawdown=None):
        super().__init__(env)
        self.max_allowed_drawdown = float(max_allowed_drawdown) if max_allowed_drawdown is not None else 0.0
        # If the value is <= 0, we consider the risk layer disabled.
        self.is_enabled = self.max_allowed_drawdown > 0.0
        
        # We need to track the peak net worth independently to calculate drawdown dynamically
        self.peak_net_worth = getattr(env.unwrapped, 'initial_balance', 10000.0)

    def reset(self, **kwargs):
        obs, info = self.env.reset(**kwargs)
        self.peak_net_worth = getattr(self.env.unwrapped, 'initial_balance', 10000.0)
        return obs, info

    def step(self, action):
        if not self.is_enabled:
            return self.env.step(action)
            
        current_net_worth = getattr(self.env.unwrapped, 'net_worth', 10000.0)
        # Update peak net worth
        self.peak_net_worth = max(self.peak_net_worth, current_net_worth)
        
        # Calculate dynamic drawdown
        drawdown_pct = ((self.peak_net_worth - current_net_worth) / self.peak_net_worth) * 100.0
        
        if drawdown_pct > self.max_allowed_drawdown:
            # Enforce Action Masking / Neutral Position
            is_continuous = getattr(self.env.unwrapped, 'is_continuous', False)
            
            if is_continuous:
                # For continuous spaces like SAC (action shape depends on env, usually Box(1))
                # 0.0 generally maps to Neutral in AdvancedTradingEnv
                safe_action = np.zeros_like(self.env.action_space.sample())
            else:
                # For discrete spaces like PPO, A2C
                # 0 corresponds to Neutral in AdvancedTradingEnv
                safe_action = 0
                
            obs, reward, terminated, truncated, info = self.env.step(safe_action)
            
            # Apply a harsh negative reward penalty to teach the AI not to trigger the risk limiter
            penalty = -10.0
            reward += penalty
            
            # Add info marker for debugging/metrics
            info['risk_layer_triggered'] = True
            
            return obs, reward, terminated, truncated, info
            
        return self.env.step(action)
