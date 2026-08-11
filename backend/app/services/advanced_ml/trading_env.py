import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd

class AdvancedTradingEnv(gym.Env):
    """
    A professional-grade trading environment for Reinforcement Learning.
    Developed for CosmoQuantAI by Antigravity.
    
    Features:
    - Supports Long, Short, and Neutral (Cash) positions.
    - Realistic transaction commissions and slippage models.
    - Reward functions based on Log Returns and Risk-Adjusted metrics.
    - Episode termination on bankruptcy (Equity < 10% of initial).
    """
    
    metadata = {"render_modes": ["human"]}

    def __init__(
        self, 
        df: pd.DataFrame, 
        features: list = None,
        initial_balance: float = 10000.0, 
        commission: float = 0.0002, # 0.02% per trade (Futures Maker Fee)
        slippage: float = 0.0001,   # 0.01% price impact
        max_leverage: float = 1.0,
        reward_type: str = 'log_returns',
        is_continuous: bool = False,
        prediction_target: str = 'classification'
    ):
        super(AdvancedTradingEnv, self).__init__()

        # Data validation
        required_cols = ['Close']
        for col in required_cols:
            if col not in df.columns:
                raise ValueError(f"DataFrame must contain '{col}' column for PnL calculation.")

        self.df = df.reset_index(drop=True)
        self.initial_balance = initial_balance
        self.commission = commission
        self.slippage = slippage
        self.max_leverage = max_leverage
        self.reward_type = reward_type
        self.is_continuous = is_continuous
        self.prediction_target = prediction_target

        if self.is_continuous:
            if self.prediction_target == "advanced_setup":
                # [Action (-1 to 1), SL_dist (0 to +inf), TP_dist (0 to +inf)]
                # Since Box needs symmetric bounds typically for DDPG/SAC natively (usually -1 to 1),
                # We can bound it to [-1, 1] for all 3, and then scale SL/TP during step().
                self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(3,), dtype=np.float32)
            else:
                self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(1,), dtype=np.float32)
        else:
            self.action_space = spaces.Discrete(3)

        # Observation Space
        if features is not None:
            # FIX: Ensure we only include features that actually exist in the dataframe
            self.feature_cols = [col for col in features if col in df.columns]
        else:
            self.feature_cols = [col for col in df.columns if col not in ['timestamp', 'Target', 'Raw_Close', 'Close']]

        self.observation_space = spaces.Box(
            low=-np.inf, 
            high=np.inf, 
            shape=(len(self.feature_cols),), 
            dtype=np.float32
        )

        # Initialize State
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        
        self.current_step = 0
        self.balance = self.initial_balance
        self.net_worth = self.initial_balance
        self.position = 0  # 0: Neutral, 1: Long, -1: Short
        self.entry_price = 0.0
        self.entry_net_worth = self.initial_balance
        
        self.equity_history = [self.initial_balance]
        self.trade_history = []
        
        # State observation
        obs = self._get_observation()
        info = self._get_info()
        
        return obs, info

    def _get_observation(self):
        # Returns current features as a flat vector
        # Future enhancement: Return sequence for Transformer
        obs = self.df.loc[self.current_step, self.feature_cols].values.astype(np.float32)
        # Prevent any NaNs or Infs from crashing the RL agent
        return np.nan_to_num(obs, nan=0.0, posinf=10.0, neginf=-10.0)

    def _get_info(self):
        return {
            "step": self.current_step,
            "net_worth": self.net_worth,
            "position": self.position,
            "balance": self.balance,
            "trades_count": len(self.trade_history)
        }

    def step(self, action):
        # 1. Update market state
        current_price = self.df.loc[self.current_step, 'Raw_Close'] if 'Raw_Close' in self.df.columns else self.df.loc[self.current_step, 'Close']
        prev_net_worth = self.net_worth
        
        # 2. Execute Action Logic (Trade)
        self.current_sl_dist = 0.0
        self.current_tp_dist = 0.0
        
        if self.is_continuous:
            action_val = action[0] if isinstance(action, (np.ndarray, list)) else action
            if self.prediction_target == "advanced_setup" and isinstance(action, (np.ndarray, list)) and len(action) >= 3:
                # Map from [-1, 1] to positive distances (e.g. up to 10% price movement)
                self.current_sl_dist = max(0.001, (action[1] + 1.0) / 2.0 * 0.1 * current_price)
                self.current_tp_dist = max(0.001, (action[2] + 1.0) / 2.0 * 0.1 * current_price)
                
            if action_val < -0.33:
                target_position = -1
            elif action_val > 0.33:
                target_position = 1
            else:
                target_position = 0
        else:
            # Action mapping: 0 -> 0 (Neutral), 1 -> 1 (Long), 2 -> -1 (Short)
            target_position = 0
            if action == 1: target_position = 1
            elif action == 2: target_position = -1
        
        # 2.5. Enforce Stop Loss and Take Profit (if position is already open)
        if self.position != 0 and self.prediction_target == "advanced_setup" and self.current_sl_dist > 0:
            if self.position == 1:
                sl_level = self.entry_price - self.current_sl_dist
                tp_level = self.entry_price + self.current_tp_dist
                if current_price <= sl_level or current_price >= tp_level:
                    target_position = 0 # Force close
            elif self.position == -1:
                sl_level = self.entry_price + self.current_sl_dist
                tp_level = self.entry_price - self.current_tp_dist
                if current_price >= sl_level or current_price <= tp_level:
                    target_position = 0 # Force close

        # 3. Update Net Worth based on current price BEFORE closing/opening positions
        self._update_net_worth(current_price)
        
        if target_position != self.position:
            self._handle_position_change(target_position, current_price)
        
        # 4. Calculate Reward
        reward = self._calculate_reward(prev_net_worth)
        
        # 5. Advance Step
        self.current_step += 1
        self.equity_history.append(self.net_worth)
        
        # 6. Check if Done
        terminated = self.current_step >= len(self.df) - 1
        truncated = self.net_worth < (self.initial_balance * 0.1) # Bankruptcy
        
        obs = self._get_observation() if not terminated else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = self._get_info()
        
        return obs, reward, terminated, truncated, info

    def _handle_position_change(self, target_position, price):
        """Logic to close existing position and open a new one with fees/slippage."""
        # 1. Close existing position if any
        if self.position != 0:
            # Closing fee based on current value
            exit_price = price * (1 - self.slippage * self.position)
            
            # Apply exit slippage to net_worth
            # net_worth was calculated using 'price', but we actually exit at 'exit_price'.
            # Slippage on exit roughly costs us `slippage` percentage of the position value.
            self.net_worth *= (1 - self.slippage)
            
            fee = self.net_worth * self.commission
            
            # Unrealized PnL is already in net_worth, we just deduct fee
            self.net_worth -= fee
            self.trade_history.append({
                "step": self.current_step,
                "type": "close",
                "price": exit_price,
                "pnl": self.net_worth - getattr(self, 'entry_net_worth', self.initial_balance)
            })

        # 2. Open new position
        if target_position != 0:
            # Entry price adjusted for slippage
            self.entry_price = price * (1 + self.slippage * target_position)
            if self.entry_price <= 0:
                self.entry_price = 1e-8
            # Entry fee
            fee = self.net_worth * self.commission
            self.net_worth -= fee
            
            self.entry_net_worth = self.net_worth
            
            self.trade_history.append({
                "step": self.current_step,
                "type": "open_" + ("long" if target_position == 1 else "short"),
                "price": self.entry_price
            })
            
        self.position = target_position

    def _update_net_worth(self, current_price):
        """Update net worth based on price action and current position."""
        if self.position == 0:
            return # Neutral stays the same (ignoring inflation/risk-free rate)
            
        if self.position == 1: # Long
            price_return = (current_price - self.entry_price) / self.entry_price
            # We don't update entry_price, we update net_worth relative to initial entry
            # But wait, net_worth should track the cumulative value.
            # Simpler way: current_value = invested_amount * (price / entry_price)
            # Since we use 100% of net_worth (leverage 1):
            pass # PnL is calculated in the next reward step effectively.
            
        # For simplicity in this step, we'll calculate the incremental change 
        # but the actual "net worth" is updated by the price delta.
        # Let's use a more robust way:
        # prev_price = self.df.loc[self.current_step - 1, 'Close'] if self.current_step > 0 else self.entry_price
        # return_pct = (current_price - prev_price) / prev_price * self.position
        # self.net_worth *= (1 + return_pct)
        
        # Correct approach for continuous step:
        if self.current_step > 0:
            prev_price = self.df.loc[self.current_step - 1, 'Raw_Close'] if 'Raw_Close' in self.df.columns else self.df.loc[self.current_step - 1, 'Close']
            # Since update happens BEFORE position change, if position was opened in the PREVIOUS step, it starts from entry_price
            if self.trade_history and self.trade_history[-1]['step'] == self.current_step - 1 and self.trade_history[-1]['type'].startswith('open'):
                ref_price = self.entry_price
            else:
                ref_price = prev_price
            
            if ref_price <= 0:
                ref_price = 1e-8
                
            price_change_pct = (current_price - ref_price) / ref_price
            step_return = price_change_pct * self.position
            
            # Cap the loss to 100% to prevent negative net worth
            step_return = max(step_return, -0.9999)
            
            self.net_worth *= (1 + step_return)
            
            if self.net_worth <= 0 or np.isnan(self.net_worth) or np.isinf(self.net_worth):
                self.net_worth = 1e-6

    def _calculate_reward(self, prev_net_worth):
        if prev_net_worth <= 0 or np.isnan(prev_net_worth) or np.isinf(prev_net_worth):
            prev_net_worth = 1e-6
            
        ratio = self.net_worth / prev_net_worth
        if ratio <= 0 or np.isnan(ratio) or np.isinf(ratio):
            ratio = 1e-6
            
        # RL algorithms require rewards to be of reasonable magnitude to compute healthy gradients.
        # Raw log returns on minute-level crypto data are extremely small (e.g., 0.0001).
        # We scale them by 1000 so the neural network can actually learn.
        scale_factor = 1000.0
            
        if self.reward_type == 'log_returns':
            return float(np.clip(np.log(ratio), -10.0, 10.0)) * scale_factor
        elif self.reward_type == 'pct_returns':
            return float(ratio - 1.0) * scale_factor
        else:
            return (float(self.net_worth - prev_net_worth) / self.initial_balance) * scale_factor


    def render(self, mode="human"):
        if mode == "human":
            print(f"Step: {self.current_step} | Net Worth: {self.net_worth:.2f} | Position: {self.position}")
