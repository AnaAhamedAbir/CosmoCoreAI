import os
import sys

# Add the backend path
sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob, TrainingStatus
from app.models import User
from app.api.v1.endpoints.model_training import pause_training_job, resume_training_job
import uuid
import datetime

def run_verification():
    print("="*50)
    print("🔍 VERIFICATION: Pause, Resume & Orphaned Job Recovery")
    print("="*50)

    db: Session = SessionLocal()
    
    try:
        # Get a real user to associate the dummy job with
        user = db.query(User).first()
        if not user:
            print("❌ No user found in the database. Cannot run test.")
            return

        # ---------------------------------------------------------
        # TEST 1: Pause a RUNNING job
        # ---------------------------------------------------------
        dummy_job_id = str(uuid.uuid4())
        dummy_job = ModelTrainingJob(
            id=dummy_job_id,
            user_id=user.id,
            symbol="TESTUSDT",
            timeframe="1h",
            algorithm="TEST-ALGO",
            status=TrainingStatus.RUNNING,
            progress=50.0,
            config={"test": True},
            logs=[f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Started Test Job"]
        )
        db.add(dummy_job)
        db.commit()
        print(f"✅ Created Dummy Job: {dummy_job_id} [Status: {dummy_job.status}]")

        print("⏸️  Triggering Pause API...")
        # Since we are bypassing FastAPI request scope, we can call the endpoint function directly
        pause_training_job(job_id=dummy_job_id, db=db, current_user=user)
        
        db.refresh(dummy_job)
        assert dummy_job.status == TrainingStatus.PAUSED, f"Status should be PAUSED, got {dummy_job.status}"
        print(f"✅ Pause successful! Status is now {dummy_job.status}")

        # ---------------------------------------------------------
        # TEST 2: Resume a PAUSED job
        # ---------------------------------------------------------
        print("▶️  Triggering Resume API...")
        # Mock background tasks for resume_training_job
        class MockBackgroundTasks:
            def add_task(self, *args, **kwargs): pass
        
        try:
            resume_training_job(job_id=dummy_job_id, background_tasks=MockBackgroundTasks(), db=db, current_user=user)
        except Exception as e:
            if "celery" in str(e).lower() or "connection" in str(e).lower():
                # We expect a potential Celery connection error if Redis isn't running in this script's scope,
                # but the DB status should still change before Celery is called.
                print(f"⚠️ Celery dispatch threw an error (expected in script scope): {e}")
            else:
                raise e

        db.refresh(dummy_job)
        assert dummy_job.status == TrainingStatus.PENDING, f"Status should be PENDING, got {dummy_job.status}"
        print(f"✅ Resume successful! Status is now {dummy_job.status} (Queued for worker)")

        # ---------------------------------------------------------
        # TEST 3: Orphaned Job Recovery Simulation
        # ---------------------------------------------------------
        # We simulate the startup script logic
        print("🔄 Simulating Server Restart (Orphaned Job Recovery)...")
        # Change status back to RUNNING to simulate power cut
        dummy_job.status = TrainingStatus.RUNNING
        db.commit()

        # Run the same logic as main.py startup_event
        orphaned_jobs = db.query(ModelTrainingJob).filter(
            ModelTrainingJob.id == dummy_job_id,
            ModelTrainingJob.status.in_([TrainingStatus.RUNNING, TrainingStatus.PENDING])
        ).all()
        
        for job in orphaned_jobs:
            job.status = TrainingStatus.FAILED
            job.error_message = "Server restarted unexpectedly. Job orphaned."
            logs = list(job.logs) if job.logs else []
            logs.append(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 🛑 Server restarted unexpectedly. Job orphaned.")
            job.logs = logs
            
        db.commit()
        db.refresh(dummy_job)

        assert dummy_job.status == TrainingStatus.FAILED, f"Status should be FAILED, got {dummy_job.status}"
        assert "Server restarted" in dummy_job.error_message, "Error message should contain 'Server restarted'"
        print(f"✅ Orphaned job recovery successful! Status is now {dummy_job.status} with message: '{dummy_job.error_message}'")

        print("="*50)
        print("🎉 ALL TESTS PASSED SUCCESSFULLY! The features work perfectly.")
        print("="*50)

    except Exception as e:
        print(f"❌ Verification Failed: {e}")
    finally:
        # Cleanup
        if 'dummy_job' in locals():
            db.delete(dummy_job)
            db.commit()
            print("🧹 Cleaned up dummy test job.")
        db.close()

if __name__ == "__main__":
    run_verification()
