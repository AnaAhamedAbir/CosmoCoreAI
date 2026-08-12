import os
import sys
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.db.session import SessionLocal
from app import models
from app.main import app
from app.api import deps
from app.services.ml_training_engine import train_model_task

def override_get_db():
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_test_user(db: Session):
    return db.query(models.User).filter(models.User.email == "test_ml_training@example.com").first()

db = SessionLocal()
test_user = get_test_user(db)
db.close()

app.dependency_overrides[deps.get_db] = override_get_db
app.dependency_overrides[deps.get_current_user] = lambda: test_user
client = TestClient(app)

def verify_fractional_diff(enable_fd, d_value):
    print(f"\n=======================================================")
    print(f"🚀 Testing Fractional Differentiation -> Enabled: {enable_fd}, d_value: {d_value}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": "Random Forest",
        "config": {
            "indicators": ["RSI", "MACD"],
            "epochs": 2,
            "prediction_target": "classification",
            "fractional_diff": enable_fd,
            "fractional_d_value": d_value
        }
    }
    
    res = client.post("/api/v1/model-training/train", json=payload)
    if res.status_code != 200:
        print(f"❌ Failed to queue: {res.text}")
        return False
        
    job_id = res.json()["id"]
    db_session = SessionLocal()
    try:
        train_model_task(job_id, db_session)
    except Exception as e:
        print(f"❌ Training Exception: {e}")
        db_session.close()
        return False
    db_session.close()
    
    res = client.get(f"/api/v1/model-training/jobs/{job_id}")
    job_data = res.json()
    
    if job_data['status'] == "COMPLETED":
        print(f"✅ Training PASSED with Fractional Diff enabled.")
        return True
    else:
        print(f"❌ Training FAILED: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    
    # Test 1: Fractional Diff with d=0.5 (Memory retaining differencing)
    results["FracDiff_0.5"] = verify_fractional_diff(enable_fd=True, d_value=0.5)
    
    # Test 2: Fractional Diff with d=0.1 (Very close to original series)
    results["FracDiff_0.1"] = verify_fractional_diff(enable_fd=True, d_value=0.1)
    
    print("\n\n🏆 OVERALL FRACTIONAL DIFFERENTIATION SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
