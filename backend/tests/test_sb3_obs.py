import numpy as np
import gymnasium as gym
from stable_baselines3 import PPO

# Dummy Env
class DummyEnv(gym.Env):
    def __init__(self):
        super().__init__()
        self.observation_space = gym.spaces.Box(low=-1, high=1, shape=(5,), dtype=np.float32)
        self.action_space = gym.spaces.Discrete(2)
    def reset(self, seed=None, options=None):
        return np.zeros(5, dtype=np.float32), {}
    def step(self, action):
        return np.zeros(5, dtype=np.float32), 0, True, False, {}

env = DummyEnv()
model = PPO("MlpPolicy", env, n_steps=16, batch_size=16)
model.learn(total_timesteps=32)

obs_1d = np.zeros(5, dtype=np.float32)
obs_2d = np.zeros((1, 5), dtype=np.float32)

a1, _ = model.predict(obs_1d)
a2, _ = model.predict(obs_2d)

print("1D action shape:", np.shape(a1), "value:", a1)
print("2D action shape:", np.shape(a2), "value:", a2)
