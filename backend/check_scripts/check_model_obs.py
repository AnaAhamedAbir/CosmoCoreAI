import os
import json
from stable_baselines3 import SAC
import sys

model_path = '/app/uploads/models/job_train_1784040633562/model_train_1784040633562.zip'

if not os.path.exists(model_path):
    print(f"Model path does not exist: {model_path}")
    sys.exit(1)

try:
    model = SAC.load(model_path)
    print("Model loaded successfully.")
    print("Observation space:", model.observation_space)
except Exception as e:
    print("Error loading model:", e)
