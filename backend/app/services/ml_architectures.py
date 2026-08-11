import torch
import torch.nn as nn
import numpy as np
import gymnasium as gym
from gymnasium import spaces

class SimpleLSTM(nn.Module):
    def __init__(self, input_size, hidden_size, num_layers, output_size):
        super(SimpleLSTM, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

class SimpleGRU(nn.Module):
    def __init__(self, input_size, hidden_size, num_layers, output_size):
        super(SimpleGRU, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.gru = nn.GRU(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.gru(x, h0)
        out = self.fc(out[:, -1, :])
        return out

class CNN1D(nn.Module):
    def __init__(self, input_size, output_size):
        super(CNN1D, self).__init__()
        self.conv1 = nn.Conv1d(in_channels=input_size, out_channels=16, kernel_size=3, padding=1)
        self.relu = nn.ReLU()
        self.adaptive_pool = nn.AdaptiveAvgPool1d(1)
        self.fc1 = nn.Linear(16, 32)
        self.fc2 = nn.Linear(32, output_size)
        
    def forward(self, x):
        # Expects (batch, seq_len, features)
        x = x.transpose(1, 2) # (batch, channels=features, seq_len)
        out = self.conv1(x)
        out = self.relu(out)
        out = self.adaptive_pool(out) # (batch, 16, 1)
        out = out.view(out.size(0), -1) # (batch, 16)
        out = self.relu(self.fc1(out))
        out = self.fc2(out)
        return out

class DeepLOB(nn.Module):
    def __init__(self, input_size, output_size):
        super(DeepLOB, self).__init__()
        self.conv1 = nn.Conv1d(in_channels=input_size, out_channels=16, kernel_size=2, padding=1)
        self.relu = nn.ReLU()
        self.lstm = nn.LSTM(16, 32, 1, batch_first=True)
        self.fc = nn.Linear(32, output_size)
        
    def forward(self, x):
        # Expects (batch, seq_len, features)
        x = x.transpose(1, 2) # (batch, features, seq_len)
        x = self.relu(self.conv1(x))
        x = x.transpose(1, 2) # (batch, seq_len, 16)
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

class TimeSeriesTransformer(nn.Module):
    def __init__(self, input_size, output_size):
        super(TimeSeriesTransformer, self).__init__()
        self.encoder_layer = nn.TransformerEncoderLayer(d_model=input_size, nhead=1, batch_first=True)
        self.transformer = nn.TransformerEncoder(self.encoder_layer, num_layers=1)
        self.fc = nn.Linear(input_size, output_size)
        
    def forward(self, x):
        # Expects (batch, seq_len, features)
        out = self.transformer(x)
        out = self.fc(out[:, -1, :])
        return out

class TradingEnv(gym.Env):
    """
    Custom Environment that follows gym interface.
    This environment is used both for training and inference (prediction) for the PPO agent.
    """
    def __init__(self, X, y=None, is_continuous=False):
        super(TradingEnv, self).__init__()
        self.X = np.array(X)
        self.y = np.array(y) if y is not None else np.zeros(len(X))
        self.current_step = 0
        self.max_steps = len(self.X) - 1
        self.is_continuous = is_continuous
        
        if self.is_continuous:
            self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(1,), dtype=np.float32)
        else:
            self.action_space = spaces.Discrete(2) # 0: Hold/Sell, 1: Buy
            
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(self.X.shape[1],), dtype=np.float32)
        
        # State tracking for Live Visualizer
        self.initial_balance = 10000.0
        self.balance = self.initial_balance
        self.net_worth = self.initial_balance
        self.position = 0
        self.equity_history = []
        self.trade_history = []
        
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        self.balance = self.initial_balance
        self.net_worth = self.initial_balance
        self.position = 0
        self.equity_history = [self.initial_balance]
        self.trade_history = []
        return self.X[self.current_step].astype(np.float32), {}
        
    def step(self, action):
        reward = 0
        if self.y is not None:
            if self.is_continuous:
                action_val = action[0] if isinstance(action, (np.ndarray, list)) else action
                discrete_action = 1 if action_val > 0 else 0
            else:
                discrete_action = action
                
            self.position = discrete_action
            is_advanced = isinstance(self.y[self.current_step], np.ndarray) and self.y[self.current_step].size >= 3
            if is_advanced:
                current_y = self.y[self.current_step][0]
                sl_pct = self.y[self.current_step][1]
                tp_pct = self.y[self.current_step][2]
                
                if discrete_action == 1 and current_y > 0:
                    reward = tp_pct
                    pnl = self.net_worth * tp_pct
                    self.net_worth += pnl
                    self.trade_history.append({"type": "open_long", "pnl": pnl})
                elif discrete_action == 1 and current_y <= 0:
                    reward = -sl_pct
                    pnl = -self.net_worth * sl_pct
                    self.net_worth += pnl
                    self.trade_history.append({"type": "close", "pnl": pnl})
                else:
                    # Hold/Short logic
                    if discrete_action == 0 and current_y <= 0:
                        reward = tp_pct
                        pnl = self.net_worth * tp_pct
                        self.net_worth += pnl
                        self.trade_history.append({"type": "open_short", "pnl": pnl})
                    elif discrete_action == 0 and current_y > 0:
                        reward = -sl_pct
                        pnl = -self.net_worth * sl_pct
                        self.net_worth += pnl
                        self.trade_history.append({"type": "close", "pnl": pnl})
            else:
                current_y = self.y[self.current_step][0] if isinstance(self.y[self.current_step], np.ndarray) and self.y[self.current_step].size > 1 else self.y[self.current_step]
                
                if discrete_action == 1 and current_y > 0:
                    reward = 1
                    self.net_worth += 10.0 # Dummy profit
                    self.trade_history.append({"type": "open_long", "pnl": 10.0})
                elif discrete_action == 1 and current_y <= 0:
                    reward = -1
                    self.net_worth -= 10.0 # Dummy loss
                    self.trade_history.append({"type": "close", "pnl": -10.0})
                else:
                    # Hold/Sell logic (neutral)
                    if discrete_action == 0 and current_y <= 0:
                        self.trade_history.append({"type": "open_short", "pnl": 5.0})
                        self.net_worth += 5.0
                    elif discrete_action == 0 and current_y > 0:
                        self.trade_history.append({"type": "close", "pnl": -5.0})
                        self.net_worth -= 5.0
                    
            self.equity_history.append(self.net_worth)
                
        self.current_step += 1
        done = self.current_step >= self.max_steps
        
        obs = self.X[self.current_step].astype(np.float32) if not done else np.zeros(self.observation_space.shape, dtype=np.float32)
        return obs, float(reward), done, False, {}
