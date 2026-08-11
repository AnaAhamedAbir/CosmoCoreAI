import os
from unittest.mock import MagicMock
from app.services.ml_training_engine import train_model_task

print("Mocking DB and Job...")
mock_db = MagicMock()
mock_job = MagicMock()
mock_job.id = "test_resume_job_123"
mock_job.algorithm = "SAC-RL"
mock_job.symbol = "BTC/USDT"
mock_job.progress = 55.0
mock_job.config = {"dataset_type": "hybrid_deep", "fine_tune": False}
mock_db.query().filter().first.return_value = mock_job

# Create fake checkpoint files
model_dir = "uploads/models/job_test_resume_job_123"
dataset_dir = "uploads/datasets"
os.makedirs(model_dir, exist_ok=True)
os.makedirs(dataset_dir, exist_ok=True)

state_path = os.path.join(model_dir, "training_state.json")
checkpoint_path = os.path.join(model_dir, "checkpoint_latest.zip")
dataset_path = os.path.join(dataset_dir, "dataset_test_resume_job_123.csv")

with open(state_path, "w") as f: f.write('{"timestep": 1000}')
with open(checkpoint_path, "w") as f: f.write('dummy checkpoint')
with open(dataset_path, "w") as f: f.write('timestamp,Target,Close\n2023-01-01,1,100')

print("Created fake checkpoint files.")
print(f"Initial progress: {mock_job.progress}%")

try:
    # This will fail eventually due to mock limitations, but we can check if it reaches auto-resume logs
    train_model_task("test_resume_job_123", mock_db)
except Exception as e:
    print(f"Stopped execution at: {e}")

print("\n--- Logs ---")
if hasattr(mock_job, 'logs'):
    for log in mock_job.logs:
        print(log)
else:
    print("No logs generated")

# Cleanup
os.remove(state_path)
os.remove(checkpoint_path)
os.remove(dataset_path)
