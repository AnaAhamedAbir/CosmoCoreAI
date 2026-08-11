import os
import sys
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, r"d:\CosmoQuantAI\backend")
from app.db.session import SessionLocal
from app.models.ml_model import CustomMLModel, ModelVersion

db = SessionLocal()

# Find the model
model = db.query(CustomMLModel).filter(CustomMLModel.id == "model_1784826708505").first()
if model and model.active_version_id:
    version = db.query(ModelVersion).filter(ModelVersion.id == model.active_version_id).first()
    if version:
        metadata_file_path = "uploads/models/job_train_1784826346422/model_train_1784826346422.json"
        
        # 1. Update DB
        version.metadata_path = metadata_file_path
        db.commit()
        print(f"Updated DB metadata_path for version {version.id}")
        
        # 2. Update JSON
        real_path = os.path.join("/app", metadata_file_path)
        with open(real_path, 'r') as f:
            meta = json.load(f)
            
        meta["setup_type"] = "advanced_sl_tp"
        meta["training_mode"] = "advanced_setup_sl_tp"
        
        with open(real_path, 'w') as f:
            json.dump(meta, f)
        print("Updated JSON file")

db.close()
