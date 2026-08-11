from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import List, Any
import logging

from app.api.deps import get_db
from app.forex import models, schemas
from app.forex.services.engine import ForexAlgoEngine
from app.forex.services.broker import OandaBrokerService

router = APIRouter()
logger = logging.getLogger(__name__)
engine = ForexAlgoEngine()

# Import WS Manager
from app.forex.services.ws_manager import forex_ws_manager

@router.websocket("/ws/market-data")
async def websocket_endpoint(websocket: WebSocket, broker: str = "Exness"):
    await forex_ws_manager.connect(websocket, broker)
    try:
        while True:
            # Client can send message to change broker dynamically if needed
            # For simplicity, they reconnect with a different query param.
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        forex_ws_manager.disconnect(websocket, broker)


@router.get("/dashboard", response_model=schemas.DashboardMetricsResponse)
async def get_dashboard_metrics(db: Session = Depends(get_db)) -> Any:
    """
    Get high-level metrics for the Forex Dashboard.
    """
    # In a real app, these would be calculated by aggregating ForexTrade models and querying the broker for live equity.
    active_bots = db.query(models.ForexBot).filter(models.ForexBot.status == "active").count()
    total_bots = db.query(models.ForexBot).count()
    
    return {
        "floating_pnl": 4250.00,
        "floating_pips": 425.0,
        "margin_level_percent": 845.2,
        "free_margin": 45230.50,
        "daily_swap_fees": -12.40,
        "active_bots_count": active_bots,
        "total_bots_count": total_bots
    }

@router.post("/bots", response_model=schemas.ForexBotResponse)
def create_bot(bot_in: schemas.ForexBotCreate, db: Session = Depends(get_db)) -> Any:
    """
    Deploy a new automated Forex Bot.
    """
    bot_data = bot_in.dict()
    bot_data["status"] = "active" # Always start as active when deployed
    db_bot = models.ForexBot(**bot_data)
    db.add(db_bot)
    db.commit()
    db.refresh(db_bot)
    
    return db_bot

@router.get("/bots", response_model=List[schemas.ForexBotResponse])
def list_bots(db: Session = Depends(get_db)) -> Any:
    """
    List all deployed Forex bots.
    """
    return db.query(models.ForexBot).order_by(models.ForexBot.id.desc()).all()

@router.patch("/bots/{bot_id}/status", response_model=schemas.ForexBotResponse)
def update_bot_status(bot_id: int, status_update: schemas.ForexBotStatusUpdate, db: Session = Depends(get_db)) -> Any:
    """
    Update the status of a deployed bot (e.g., stop, start).
    """
    bot = db.query(models.ForexBot).filter(models.ForexBot.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
        
    if status_update.status not in ["active", "stopped", "paused"]:
        raise HTTPException(status_code=400, detail="Invalid status")
        
    bot.status = status_update.status
    db.commit()
    db.refresh(bot)
    return bot

@router.patch("/bots/{bot_id}", response_model=schemas.ForexBotResponse)
def update_bot_settings(bot_id: int, settings_update: schemas.ForexBotSettingsUpdate, db: Session = Depends(get_db)) -> Any:
    """
    Update the settings of a deployed bot.
    """
    bot = db.query(models.ForexBot).filter(models.ForexBot.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
        
    update_data = settings_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(bot, key, value)
        
    db.commit()
    db.refresh(bot)
    return bot

@router.delete("/bots/{bot_id}")
def delete_bot(bot_id: int, db: Session = Depends(get_db)) -> Any:
    """
    Delete a deployed bot permanently.
    """
    bot = db.query(models.ForexBot).filter(models.ForexBot.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
        
    db.delete(bot)
    db.commit()
    return {"message": "Bot deleted successfully"}

@router.post("/bots/emergency-stop")
def emergency_stop_all(db: Session = Depends(get_db)) -> Any:
    """
    Global Kill Switch: Immediately stops ALL active algorithms.
    """
    active_bots = db.query(models.ForexBot).filter(models.ForexBot.status == "active").all()
    count = 0
    for bot in active_bots:
        bot.status = "stopped"
        count += 1
    
    db.commit()
    return {"message": f"Emergency stop executed successfully. {count} bots halted."}

@router.post("/execute_test_signal")
async def execute_test_signal(bot_id: int, signal: str, db: Session = Depends(get_db)) -> Any:
    """
    Manually trigger a signal for a bot to test execution.
    """
    bot = db.query(models.ForexBot).filter(models.ForexBot.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
        
    bot_config = {
        "name": bot.name,
        "pair": bot.pair,
        "lot_size": bot.lot_size,
        "use_news_filter": bot.use_news_filter,
        "max_spread_pips": bot.max_spread_pips
    }
    
    result = await engine.execute_strategy_signal(bot_config, signal.upper())
    if not result:
        raise HTTPException(status_code=400, detail="Trade blocked by Risk Manager (Spread/News)")
        
    return {"message": "Signal executed", "result": result}
