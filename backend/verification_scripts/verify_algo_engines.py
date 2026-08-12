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

def verify_algorithm_engine(algo_name, prediction_target="classification"):
    print(f"\n=======================================================")
    print(f"🚀 Testing Algorithm Engine -> {algo_name}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": algo_name,
        "config": {
            "indicators": ["RSI", "MACD"],
            "epochs": 2,
            "prediction_target": prediction_target
        }
    }
    
    res = client.post("/api/v1/model-training/train", json=payload)
    if res.status_code != 200:
        print(f"❌ Failed to queue {algo_name}: {res.text}")
        return False
        
    job_id = res.json()["id"]
    db_session = SessionLocal()
    try:
        train_model_task(job_id, db_session)
    except Exception as e:
        print(f"❌ Training Exception for {algo_name}: {e}")
        db_session.close()
        return False
    db_session.close()
    
    res = client.get(f"/api/v1/model-training/jobs/{job_id}")
    job_data = res.json()
    
    if job_data['status'] == "COMPLETED":
        print(f"✅ Training PASSED for Engine: {algo_name}.")
        return True
    else:
        print(f"❌ Training FAILED for {algo_name}: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    
    # Test a few different engines across categories
    
    # 1. Tabular (Gradient Boosting)
    results["LightGBM"] = verify_algorithm_engine("LightGBM")
    
    # 2. Deep Learning (Sequence)
    results["GRU"] = verify_algorithm_engine("GRU")
    
    print("\n\n🏆 OVERALL ALGORITHM ENGINE SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
