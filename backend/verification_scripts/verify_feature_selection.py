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

def verify_feature_selection(pca, shap, shap_var, auto, auto_count):
    print(f"\n=======================================================")
    print(f"🚀 Testing Feature Selection -> PCA: {pca}, SHAP: {shap} (Var: {shap_var}), Auto: {auto} (Count: {auto_count})")
    print(f"=======================================================")
    
    payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1d",
        "algorithm": "Random Forest",
        "config": {
            # Provide lots of indicators to force feature selection/reduction
            "indicators": ["RSI", "MACD", "ATR", "SMA_20", "EMA_50", "Bollinger_Bands", "Stochastic"],
            "epochs": 2,
            "prediction_target": "classification",
            
            # Feature Selection Params
            "apply_pca_collinearity": pca,
            "apply_shap_selection": shap,
            "shap_variance_threshold": shap_var,
            "auto_feature_selection": auto,
            "auto_feature_count": auto_count
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
        print(f"✅ Training PASSED with feature selection logic applied.")
        return True
    else:
        print(f"❌ Training FAILED: {job_data.get('error_message')}")
        return False

if __name__ == "__main__":
    results = {}
    
    # Test 1: Full Pipeline (PCA + SHAP + AUTO limit to 3 features)
    results["Full_Pipeline"] = verify_feature_selection(
        pca=True, shap=True, shap_var=0.90, auto=True, auto_count=3
    )
    
    # Test 2: Only PCA and SHAP with strict variance
    results["PCA_SHAP_Strict"] = verify_feature_selection(
        pca=True, shap=True, shap_var=0.70, auto=False, auto_count=50
    )
    
    print("\n\n🏆 OVERALL FEATURE SELECTION SUMMARY:")
    for k, v in results.items():
        print(f" - {k}: {'✅ PASSED' if v else '❌ FAILED'}")
