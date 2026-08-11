import json
import traceback
from stable_baselines3 import SAC

file_path = "uploads/models/job_train_1784826346422/model_train_1784826346422.zip"

try:
    print("Trying to load SAC model...")
    model = SAC.load(file_path)
    print("Model loaded successfully!")
except Exception as e:
    print(f"Error loading model: {e}")
    traceback.print_exc()
