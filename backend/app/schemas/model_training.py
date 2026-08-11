from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.models.model_training import TrainingStatus

class TrainingJobCreate(BaseModel):
    symbol: str
    timeframe: str
    algorithm: str
    market_type: Optional[str] = "crypto"
    config: Dict[str, Any]

class TrainingJobResponse(BaseModel):
    id: str
    user_id: int
    symbol: str
    timeframe: str
    algorithm: str
    market_type: str
    status: TrainingStatus
    progress: float
    config: Optional[Dict[str, Any]] = None
    logs: List[Any]
    output_model_id: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class StartL2CollectorRequest(BaseModel):
    symbol: str
    target_rows: int

class StartForexCollectorRequest(BaseModel):
    symbol: str
    target_rows: int
    timeframe: str = "15m"
    mode: str = "ticks" # "ticks" or "date"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    data_source: str = "oanda" # "oanda" or "dukascopy"

class StartHybridCollectorRequest(BaseModel):
    symbol: str
    target_rows: int
    resolution: str = "100ms"
    trigger_type: Optional[str] = None
    trigger_value: Optional[float] = None
    schedule_time: Optional[str] = None
