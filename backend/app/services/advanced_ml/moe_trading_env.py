import numpy as np
import gymnasium as gym
from gymnasium import spaces

class MoETradingEnv(gym.Env):
    """
    A Custom Gym Environment for RL-Based Mixture of Experts (MoE).
    
    Observation Space:
        - Base model predictions for the current step.
        - Market state indicators (Volatility, RSI, MACD, etc.).
    
    Action Space:
        - Continuous weights for each base model.
    """
    metadata = {'render_modes': ['human']}

    def __init__(self, base_predictions, market_states, actual_returns, reward_target='Sharpe', commission=0.001, slippage=0.001):
        super(MoETradingEnv, self).__init__()
        
        # Data
        self.base_predictions = np.array(base_predictions) # Shape: (timesteps, num_models)
        self.market_states = np.array(market_states)       # Shape: (timesteps, num_features)
        self.actual_returns = np.array(actual_returns)     # Shape: (timesteps,)
        
        # Trading Params
        self.commission = commission
        self.slippage = slippage
        
        self.num_models = self.base_predictions.shape[1]
        self.num_features = self.market_states.shape[1]
        self.max_steps = len(self.base_predictions)
        
        self.reward_target = reward_target
        
        # Action space: weight for each model, range [0, 1]
        self.action_space = spaces.Box(low=0.0, high=1.0, shape=(self.num_models,), dtype=np.float32)
        
        # Observation space: model predictions + market features
        obs_dim = self.num_models + self.num_features
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(obs_dim,), dtype=np.float32)
        
        self.current_step = 0
        self.history_returns = []
        self.prev_position = 0

    def _get_obs(self):
        preds = self.base_predictions[self.current_step]
        state = self.market_states[self.current_step]
        return np.concatenate([preds, state], dtype=np.float32)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        self.history_returns = []
        self.prev_position = 0
        return self._get_obs(), {}

    def step(self, action):
        # Softmax the action to ensure weights sum to 1
        exp_action = np.exp(action - np.max(action))
        weights = exp_action / exp_action.sum()
        
        # Calculate ensemble prediction
        preds = self.base_predictions[self.current_step]
        ensemble_pred = np.sum(weights * preds)
        
        # Determine threshold logic
        has_negative_preds = np.any(self.base_predictions < 0)
        
        # Advanced simulated trading logic with Hold (0) position
        if has_negative_preds:
            # -1 to 1 range (Regression/Continuous)
            if ensemble_pred > 0.1:
                position = 1
            elif ensemble_pred < -0.1:
                position = -1
            else:
                position = 0
        else:
            # 0 to 1 range (Classification/Probability)
            if ensemble_pred > 0.55:
                position = 1
            elif ensemble_pred < 0.45:
                position = -1
            else:
                position = 0
        
        # Calculate step return
        actual = self.actual_returns[self.current_step]
        
        is_advanced = isinstance(actual, np.ndarray) and actual.size >= 3
        if is_advanced:
            current_y = actual[0]
            sl_pct = actual[1]
            tp_pct = actual[2]
            
            if position == 1:
                step_return = tp_pct if current_y > 0 else -sl_pct
            elif position == -1:
                step_return = tp_pct if current_y <= 0 else -sl_pct
            else:
                step_return = 0.0
        else:
            # If actual is binary (0/1 classification target), map 0 to -1 for reward symmetry
            if len(np.unique(self.actual_returns)) <= 2 and not np.any(self.actual_returns < 0):
                actual_dir = 1 if actual > 0 else -1
                step_return = position * actual_dir
            else:
                step_return = position * actual
            
        # Apply Transaction Costs
        transaction_cost = 0.0
        if position != 0 and position != self.prev_position:
            # Deduct commission and slippage only when entering or flipping
            # (If moving to hold, we technically exit. Let's charge half fee for exit to keep it simple, or full for full turnover)
            transaction_cost = self.commission + self.slippage
            
        self.prev_position = position
        step_return -= transaction_cost
            
        self.history_returns.append(step_return)
        
        # Calculate Reward based on target
        reward = 0.0
        if self.reward_target == 'PnL':
            reward = step_return
        elif self.reward_target == 'Sharpe':
            if len(self.history_returns) > 1:
                mean_ret = np.mean(self.history_returns)
                std_ret = np.std(self.history_returns) + 1e-9
                reward = mean_ret / std_ret
            else:
                reward = step_return
        elif self.reward_target == 'Sortino':
            if len(self.history_returns) > 1:
                mean_ret = np.mean(self.history_returns)
                negative_returns = [r for r in self.history_returns if r < 0]
                std_down = np.std(negative_returns) + 1e-9 if negative_returns else 1e-9
                reward = mean_ret / std_down
            else:
                reward = step_return
                
        self.current_step += 1
        terminated = self.current_step >= self.max_steps - 1
        truncated = False
        
        info = {
            'step': self.current_step,
            'weights': weights.tolist(),
            'ensemble_pred': float(ensemble_pred),
            'step_return': float(step_return)
        }
        
        return self._get_obs(), float(reward), terminated, truncated, info
