import os
import sys
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, r"d:\CosmoQuantAI\backend")
from app.db.session import SessionLocal
from app.models.ml_model import CustomMLModel

db = SessionLocal()
models = db.query(CustomMLModel).order_by(CustomMLModel.created_at.desc()).all()

print(f"Total models: {len(models)}")
for model in models:
    print(f"\nModel ID: {model.id} | Name: {model.name} | Type: {model.model_type}")
    if model.active_version_id:
        version = next((v for v in model.versions if v.id == model.active_version_id), None)
        if version:
            print(f"  Active Version: {version.id} | Metadata path: {version.metadata_path}")
            if version.metadata_path and os.path.exists(version.metadata_path):
                with open(version.metadata_path, 'r') as f:
                    meta = json.load(f)
                    print(f"  Metadata snippet: {{k: meta[k] for k in ('target_column', 'training_mode', 'setup_type', 'symbol') if k in meta}}")
                    if 'config' in meta and 'symbol' in meta['config']:
                        print(f"  Config symbol: {meta['config']['symbol']}")
            else:
                print("  Metadata file NOT FOUND")
        else:
            print("  Active version NOT FOUND in versions list")
    else:
        print("  No active version")

db.close()
