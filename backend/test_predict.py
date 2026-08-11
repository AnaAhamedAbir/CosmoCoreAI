import sys
import os
sys.path.append('/app')

from app.db.session import SessionLocal
from app import models as db_models
from app.services.ml_predictor import predict

db = SessionLocal()

version = db.query(db_models.ModelVersion).order_by(db_models.ModelVersion.id.desc()).first()
if version:
    print(f"Found version: {version.id}")
    model = db.query(db_models.CustomMLModel).filter(db_models.CustomMLModel.active_version_id == version.id).first()
    if model:
        print(f"Found model: {model.id}")
        try:
            res = predict(model.id, None, db)
            print("Predict result:", res)
        except Exception as e:
            print("Predict error:", e)
            import traceback
            traceback.print_exc()
    else:
        print("Model not found")
else:
    print("Version not found")
