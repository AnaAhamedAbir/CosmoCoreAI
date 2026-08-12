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

def verify_hyperparameters(use_automl=False, max_depth=None, learning_rate=None):
    print(f"\n=======================================================")
    print(f"🚀 Testing Advanced Hyperparameters -> AutoML: {use_automl}, maxDepth: {max_depth}, lr: {learning_rate}")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": "XGBoost", # Good algorithm to test both standard and automl
        "config": {
            "indicators": ["RSI", "MACD"],
            "epochs": 2,
            "prediction_target": "classification",
            
            # Hyperparameters
            "use_automl": use_automl,
            "automl_trials": 2 if use_automl else 0, # Keep trials very low for testing speed
            "maxDepth": max_depth,
            "learningRate": learning_rate
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
        print(f"✅ Training PASSED with Hyperparameters configured.")
        return True
    else:
        print(f"❌ Training FAILED: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    
    # Test 1: Manual standard hyperparameters
    results["Manual_Hyperparams"] = verify_hyperparameters(use_automl=False, max_depth=3, learning_rate=0.01)
    
    # Test 2: AutoML (Optuna) hyperparameters
    results["AutoML_Optuna"] = verify_hyperparameters(use_automl=True)
    
    print("\n\n🏆 OVERALL HYPERPARAMETER SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
