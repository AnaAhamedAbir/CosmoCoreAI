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

def verify_timeframe(tf_name):
    print(f"\n=======================================================")
    print(f"🚀 Testing Candle Interval (Timeframe): {tf_name}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": tf_name,
        "algorithm": "Random Forest", 
        "config": {
            "indicators": ["RSI"],
            "epochs": 2,
            "prediction_target": "classification",
        }
    }
    
    res = client.post("/api/v1/model-training/train", json=payload)
    if res.status_code != 200:
        print(f"❌ Failed to start job: {res.text}")
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
        print(f"✅ Training PASSED with timeframe={tf_name}")
        return True
    else:
        print(f"❌ Training FAILED: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    timeframes_to_test = ["15m", "1h", "1d"]
    
    for tf in timeframes_to_test:
        results[tf] = verify_timeframe(tf)
    
    print("\n\n🏆 OVERALL CANDLE INTERVAL SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
