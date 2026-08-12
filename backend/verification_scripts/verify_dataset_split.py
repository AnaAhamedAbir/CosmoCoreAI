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

def verify_dataset_split(split_method, train_ratio, imbalance):
    print(f"\n=======================================================")
    print(f"🚀 Testing Dataset -> Split: {split_method}, Ratio: {train_ratio}%, Imbalance: {imbalance}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": "Random Forest",
        "config": {
            "indicators": ["RSI", "MACD"],
            "epochs": 2,
            "prediction_target": "classification",
            
            # Dataset Split & Imbalance Params
            "split_method": split_method,
            "train_ratio": train_ratio,
            "imbalance_strategy": imbalance,
            "purge_length": 5
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
        print(f"✅ Training PASSED with Data Split & Imbalance enabled.")
        return True
    else:
        print(f"❌ Training FAILED: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    
    # Test 1: Random Split + 70% Train + No Imbalance Strategy
    results["Random_70_None"] = verify_dataset_split("random", 70.0, "none")
    
    # Test 2: Purged CV Split + 80% Train + SMOTE Imbalance Strategy
    results["Purged_80_SMOTE"] = verify_dataset_split("purged_cv", 80.0, "smote")
    
    print("\n\n🏆 OVERALL DATASET SPLIT & IMBALANCE SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
