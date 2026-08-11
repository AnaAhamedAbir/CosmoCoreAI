import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

from app.services.ml_architectures import TradingEnv

class StableBaselinesWrapper:
    """
    Scikit-Learn compatible wrapper for Reinforcement Learning (RL) agents via stable-baselines3.
    It encapsulates the environment creation and RL training loops.
    """
    def __init__(self, algo_name="PPO", epochs=10, **kwargs):
        self.algo_name = algo_name
        self.epochs = int(epochs) if epochs else 10
        self.model = None

    def fit(self, X: pd.DataFrame, y: pd.Series, callback=None):
        try:
            from stable_baselines3 import PPO, SAC, A2C, DDPG, TD3, DQN
            # Map strings to classes
            algo_map = {
                'PPO': PPO,
                'SAC': SAC,
                'A2C': A2C,
                'DDPG': DDPG,
                'TD3': TD3,
                'DQN': DQN
            }
            # Determine if continuous
            is_continuous = self.algo_name.split('-')[0] in ['SAC', 'DDPG', 'TD3']
            
            # Create Custom Gym Environment for Trading
            env = TradingEnv(X=X.values, y=y.values, is_continuous=is_continuous)
            
            # Select algorithm
            RLClass = algo_map.get(self.algo_name.split('-')[0], PPO)
            
            # Initialize Agent
            self.model = RLClass("MlpPolicy", env, verbose=0)
            
            # Calculate total timesteps based on epochs
            total_timesteps = max(10000, self.epochs * len(X))
            
            # Train Agent
            self.model.learn(total_timesteps=total_timesteps, callback=callback)
            
        except ImportError:
            print("Warning: stable_baselines3 not installed. Using dummy RL.")
            self.model = "dummy"
            
        return self

    def predict(self, X: pd.DataFrame):
        if self.model == "dummy":
            return np.random.choice([0, 1], size=len(X))
            
        is_continuous = self.algo_name.split('-')[0] in ['SAC', 'DDPG', 'TD3']
        env = TradingEnv(X=X.values, is_continuous=is_continuous)
        obs, _ = env.reset()
        
        preds = []
        done = False
        while not done:
            # Predict action from observation
            action, _states = self.model.predict(obs, deterministic=True)
            if is_continuous:
                action_val = action[0] if isinstance(action, (np.ndarray, list)) else action
                discrete_action = 1 if action_val > 0 else 0
            else:
                discrete_action = action
                
            preds.append(discrete_action)
            obs, reward, done, truncated, info = env.step(action)
            if done or truncated:
                break
                
        # Ensure length matches X (env loop might be missing 1 step based on max_steps setup)
        preds = np.array(preds)
        if len(preds) < len(X):
            padding = [preds[-1]] * (len(X) - len(preds)) if len(preds) > 0 else [0]*len(X)
            preds = np.append(preds, padding)
            
        return preds

    def score(self, X: pd.DataFrame, y: pd.Series):
        preds = self.predict(X)
        return np.mean(preds == y.values)


# Explicit RL Wrappers for the Factory
class ForexPPORL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="PPO", **kwargs)

class ForexSACRL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="SAC", **kwargs)

class ForexA2CRL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="A2C", **kwargs)

class ForexDDPGRL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="DDPG", **kwargs)

class ForexTD3RL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="TD3", **kwargs)

class ForexDQNRL(StableBaselinesWrapper):
    def __init__(self, **kwargs):
        super().__init__(algo_name="DQN", **kwargs)

class ForexAdvancedRL(StableBaselinesWrapper):
    # Fallback for QR-DQN, CQL, GAIL, Decision-Transformer using PPO for now 
    # until d3rlpy/custom offline RL libraries are fully wired up
    def __init__(self, algo_name="PPO", **kwargs):
        super().__init__(algo_name="PPO", **kwargs)
