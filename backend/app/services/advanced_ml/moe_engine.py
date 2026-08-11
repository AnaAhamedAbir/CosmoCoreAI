import os
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple
import logging
from stable_baselines3 import PPO, SAC, A2C, DDPG, TD3
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

from app.services.advanced_ml.moe_trading_env import MoETradingEnv

logger = logging.getLogger(__name__)

class RLMoEEngine:
    """
    Reinforcement Learning Master Agent for Mixture of Experts.
    Responsible for training PPO/SAC to dynamically weight base models.
    """
    def __init__(self, rl_algorithm: str = 'PPO', reward_target: str = 'Sharpe', commission: float = 0.001, slippage: float = 0.001):
        self.rl_algorithm = rl_algorithm.upper()
        self.reward_target = reward_target
        self.commission = commission
        self.slippage = slippage
        self.model = None
        self.vec_env = None
        self.base_estimators = []
        
    def prepare_environment(
        self, 
        base_predictions: np.ndarray, 
        market_states: np.ndarray, 
        actual_returns: np.ndarray
    ) -> DummyVecEnv:
        """
        Wraps the MoETradingEnv in a DummyVecEnv for Stable-Baselines3.
        """
        def make_env():
            return MoETradingEnv(
                base_predictions=base_predictions,
                market_states=market_states,
                actual_returns=actual_returns,
                reward_target=self.reward_target,
                commission=self.commission,
                slippage=self.slippage
            )
        
        env = DummyVecEnv([make_env])
        # Normalize observation space automatically
        env = VecNormalize(env, norm_obs=True, norm_reward=False, clip_obs=10.0)
        return env

    def train_master_agent(
        self, 
        base_predictions: np.ndarray, 
        market_states: np.ndarray, 
        actual_returns: np.ndarray,
        total_timesteps: int = 10000,
        model_save_path: str = None
    ) -> Dict[str, Any]:
        """
        Trains the RL agent on the outputs of the base models.
        """
        logger.info(f"🚀 Initializing RL-Based MoE Master Agent ({self.rl_algorithm})")
        logger.info(f"Targeting Reward: {self.reward_target}")
        
        env = self.prepare_environment(base_predictions, market_states, actual_returns)
        
        if self.rl_algorithm == 'PPO':
            self.model = PPO("MlpPolicy", env, verbose=1, learning_rate=0.0003)
        elif self.rl_algorithm == 'SAC':
            self.model = SAC("MlpPolicy", env, verbose=1, learning_rate=0.0003)
        elif self.rl_algorithm == 'A2C':
            self.model = A2C("MlpPolicy", env, verbose=1, learning_rate=0.0007)
        elif self.rl_algorithm == 'DDPG':
            self.model = DDPG("MlpPolicy", env, verbose=1, learning_rate=0.001)
        elif self.rl_algorithm == 'TD3':
            self.model = TD3("MlpPolicy", env, verbose=1, learning_rate=0.001)
        else:
            raise ValueError(f"Unsupported RL Algorithm for MoE: {self.rl_algorithm}")
            
        logger.info(f"Starting training for {total_timesteps} timesteps...")
        self.model.learn(total_timesteps=total_timesteps)
        logger.info("✅ Training completed.")
        
        # Save model if path provided
        if model_save_path:
            os.makedirs(os.path.dirname(model_save_path), exist_ok=True)
            self.model.save(model_save_path)
            logger.info(f"Model saved to {model_save_path}")
            
        # Run a quick evaluation on the same dataset (in-sample)
        eval_metrics = self._evaluate(env, len(actual_returns))
        
        return eval_metrics

    def fit(self, X, y):
        """
        Dummy fit method for Scikit-learn compatibility since training is handled by train_master_agent.
        """
        pass

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """
        Scikit-learn compatible predict method.
        """
        if self.model is None:
            raise ValueError("RL Model is not trained yet.")
            
        # Get base predictions
        preds_list = []
        for est in self.base_estimators:
            preds = est.predict(X)
            if len(preds.shape) > 1 and preds.shape[1] > 1:
                preds = preds[:, 0]
            preds_list.append(preds)
        base_preds = np.column_stack(preds_list)
        market_states = X.values
        
        final_preds = []
        for i in range(len(base_preds)):
            obs = np.concatenate([base_preds[i], market_states[i]], dtype=np.float32)
            action, _ = self.model.predict(obs, deterministic=True)
            # Softmax
            exp_a = np.exp(action - np.max(action))
            weights = exp_a / exp_a.sum()
            final_pred = np.sum(weights * base_preds[i])
            final_preds.append(final_pred)
            
        return np.array(final_preds)

    def _evaluate(self, env: DummyVecEnv, steps: int) -> Dict[str, Any]:
        """
        Evaluates the trained agent and returns metrics.
        """
        obs = env.reset()
        total_reward = 0
        final_info = {}
        
        for _ in range(steps - 1):
            action, _states = self.model.predict(obs, deterministic=True)
            obs, reward, done, info = env.step(action)
            total_reward += reward[0]
            final_info = info[0]
            if done[0]:
                break
                
        return {
            "total_eval_reward": total_reward,
            "final_step": final_info.get("step", steps),
            "final_weights": final_info.get("weights", []),
            "final_step_return": final_info.get("step_return", 0.0)
        }
