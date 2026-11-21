from fastapi import APIRouter, HTTPException, Body, Depends
from typing import List, Dict, Any
from app import models
from app.api import deps
from app.services.block_trade_monitor import block_trade_monitor

router = APIRouter()

@router.get("/config", response_model=Dict[str, Any])
def get_config(current_user: models.User = Depends(deps.get_current_user)):
    """
    Get current Block Trade Monitor configuration.
    """
    return block_trade_monitor.get_config()

@router.post("/config", response_model=Dict[str, Any])
async def update_config(
    payload: Dict[str, Any] = Body(...),
    current_user: models.User = Depends(deps.get_current_active_superuser),
):
    """
    Update Block Trade Monitor configuration.
    
    Payload example:
    {
        "min_block_value": 15000.0,
        "whale_value": 600000.0,
        "active_exchanges": ["binance", "bybit"]
    }
    """
    try:
        updated_config = await block_trade_monitor.update_config(payload)
        return updated_config
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
