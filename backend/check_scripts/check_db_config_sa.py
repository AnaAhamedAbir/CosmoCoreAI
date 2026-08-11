from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.model_training import ModelTrainingJob
import json

engine = create_engine('sqlite:///bot_database.db')
Session = sessionmaker(bind=engine)
session = Session()

job = session.query(ModelTrainingJob).filter(ModelTrainingJob.id == 'train_1784040633562').first()
if job:
    print("Old Job Config Features:")
    config = job.config
    if isinstance(config, str):
        config = json.loads(config)
    print("features:", len(config.get('features', [])))
    print("l2_features:", len(config.get('l2_features', [])))
    print("plp_features:", len(config.get('plp_features', [])))
else:
    print("Job not found")
