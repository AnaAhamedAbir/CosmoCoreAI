import os
import sys
import time
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

# Add the parent directory to sys.path so we can import 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app import models
from app.main import app
from app.api import deps
from app.services.ml_training_engine import train_model_task

# Setup mock user and db
def override_get_db():
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_test_user(db: Session):
    user = db.query(models.User).filter(models.User.email == "test_ml_training@example.com").first()
    if not user:
        user = models.User(email="test_ml_training@example.com", full_name="Test ML Training", hashed_password="fake", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

db = SessionLocal()
test_user = get_test_user(db)
db.close()

def override_get_current_user():
    return test_user

app.dependency_overrides[deps.get_db] = override_get_db
app.dependency_overrides[deps.get_current_user] = override_get_current_user

client = TestClient(app)

def run_target_test(target_name: str, algorithm: str):
    print(f"\n=======================================================")
    print(f"🚀 Testing Prediction Target: {target_name.upper()} with {algorithm}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": algorithm,
        "config": {
            "indicators": ["RSI", "MACD"],
            "epochs": 3,
            "prediction_target": target_name,
            "max_depth": 3, # Just for trees
            "is_deep_training": False
        }
    }
    
    response = client.post("/api/v1/model-training/train", json=payload)
    if response.status_code != 200:
        print(f"❌ Failed to start training for {target_name}: {response.text}")
        return False
        
    job = response.json()
    job_id = job["id"]
    print(f"✅ Job Started! ID: {job_id}")
    
    print(f"⚙️ Executing Training Engine (Background Task simulation)...")
    db_session = SessionLocal()
    try:
        train_model_task(job_id, db_session)
    except Exception as e:
        print(f"❌ Training Exception for {target_name}: {e}")
        db_session.close()
        return False
    
    db_session.close()
    
    # Check results
    response = client.get(f"/api/v1/model-training/jobs/{job_id}")
    job_data = response.json()
    
    print(f"Final Status: {job_data['status']}")
    if job_data["logs"]:
        print("Relevant Logs:")
        for log in job_data["logs"][-15:]:
            print(f"   > {log}")
            
    if job_data['status'] == "COMPLETED":
        print(f"✅ {target_name.upper()} successfully verified!")
        return True
    else:
        print(f"❌ {target_name.upper()} verification failed: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    results["classification"] = run_target_test("classification", "Random Forest")
    results["regression"] = run_target_test("regression", "Random Forest")
    results["multi_task"] = run_target_test("multi_task", "LSTM")
    results["advanced_setup"] = run_target_test("advanced_setup", "LSTM")
    
    print("\n\n🏆 OVERALL VERIFICATION SUMMARY:")
    for tgt, res in results.items():
        status = "✅ PASSED" if res else "❌ FAILED"
        print(f" - {tgt.upper()}: {status}")
