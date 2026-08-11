import sys
import os
import time

# Ensure we can import from app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app.models import ModelTrainingJob, User
from app.tasks import celery_train_model_task
from app.models import TrainingStatus

def verify_celery_ml_task():
    print("🚀 Starting Celery ML Task Verification...")
    db = SessionLocal()
    
    try:
        # 1. Check if there's any user in the DB to associate the job with
        user = db.query(User).first()
        if not user:
            print("⚠️ No user found in DB. Creating a dummy user for testing...")
            user = User(email="test_celery@example.com", username="test_celery")
            user.set_password("password")
            db.add(user)
            db.commit()
            db.refresh(user)
            
        # 2. Create a dummy ModelTrainingJob
        job_id = f"test_celery_job_{int(time.time())}"
        dummy_job = ModelTrainingJob(
            id=job_id,
            user_id=user.id,
            symbol="BTC/USDT",
            timeframe="15m",
            algorithm="Random Forest",
            config={
                "epochs": 1, 
                "max_depth": 3,
                "indicators": ["RSI"],
                "use_automl": False # Keep false for fast test
            },
            status=TrainingStatus.PENDING,
            progress=0.0,
            logs=["Task initialized for celery testing..."]
        )
        db.add(dummy_job)
        db.commit()
        
        print(f"✅ Created mock Training Job: {job_id}")
        
        # 3. Call the celery task directly (synchronously) for testing purposes
        # This verifies that the task logic and DB session handling inside it doesn't crash.
        print("⏳ Running celery_train_model_task synchronously...")
        result = celery_train_model_task(job_id=job_id)
        
        print(f"📊 Task Result: {result}")
        
        # 4. Verify DB status
        updated_job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
        print(f"🔍 DB Job Status: {updated_job.status}")
        
        if updated_job.status in [TrainingStatus.COMPLETED, TrainingStatus.FAILED]:
            print("✅ Verification PASSED: Task executed and updated DB successfully.")
        else:
            print("❌ Verification FAILED: Job status did not update correctly.")
            
    except Exception as e:
        print(f"❌ Verification crashed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    verify_celery_ml_task()
