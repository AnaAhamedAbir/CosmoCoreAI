from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob

db = SessionLocal()
job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == 'train_1784040633562').first()
if job:
    print("Found job!")
    features = job.config.get("features", [])
    print(f"Number of features in config: {len(features)}")
    if len(features) > 0:
        print(features)
else:
    print("Job not found.")
db.close()
