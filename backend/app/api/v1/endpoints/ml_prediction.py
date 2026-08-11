from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Any, Dict
import hashlib
import random
from app import models, schemas
from app.api import deps
from app.db.session import get_db

router = APIRouter()

@router.post("/{model_id}/predict")
def predict_signal(
    model_id: str,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(deps.get_current_user),
) -> Any:
    """
    Generate a functional trading signal based on a specific price point and model.
    Since we don't have the underlying model weights injected, this simulates a 
    highly functional predictive engine using deterministic hashing and heuristics 
    to provide consistent, realistic trading signals, Entry, SL, TP, and metrics.
    """
    price_point = payload.get("price_point")
    if price_point is None:
        raise HTTPException(status_code=400, detail="price_point is required")
        
    try:
        price_point = float(price_point)
    except ValueError:
        raise HTTPException(status_code=400, detail="price_point must be a number")

    db_model = db.query(models.CustomMLModel).filter(
        models.CustomMLModel.id == model_id,
        models.CustomMLModel.user_id == current_user.id
    ).first()

    if not db_model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Call the real predictive engine
    symbol_override = payload.get("symbol")
    
    try:
        from app.services.ml_predictor import predict
        result = predict(
            model_id=model_id,
            symbol_override=symbol_override,
            db=db,
            sequence_length=1,
            price_point=price_point
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
        
    # Build dynamic metrics based on real inference
    metrics = {
        "confidence_score": round(result.get("confidence", 0) * 100, 1),
        "features_used": result.get("features_used", 0),
        "dataset_type": result.get("dataset_type", "unknown"),
        "algorithm": result.get("algorithm", "unknown")
    }

    # Format the final response
    response_data = {
        "model_id": model_id,
        "model_name": db_model.name,
        "price_point": result.get("price", price_point),
        "signal": result.get("signal", "HOLD"),
        "entry_price": result.get("price", price_point),
        "metrics": metrics,
        "timestamp": __import__("time").time()
    }
    
    # If the real model actually returned SL/TP (e.g. advanced_setup), include them
    if "sl" in result:
        response_data["sl"] = result["sl"]
    if "tp" in result:
        response_data["tp"] = result["tp"]
    if "predicted_return" in result:
        response_data["predicted_return"] = result["predicted_return"]
        
    return response_data
