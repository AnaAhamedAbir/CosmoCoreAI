from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ForexBotBase(BaseModel):
    name: str
    pair: str
    strategy: str
    lot_size: float = 0.1
    leverage: int = 100
    max_drawdown_percent: float = 5.0
    use_news_filter: bool = True
    max_spread_pips: float = 2.5
    default_take_profit: float = 20.0
    default_stop_loss: float = 10.0
    config: Optional[dict] = {}

class ForexBotCreate(ForexBotBase):
    pass

class ForexBotResponse(ForexBotBase):
    id: int
    status: str
    total_pips: float
    total_pnl: float
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class DashboardMetricsResponse(BaseModel):
    floating_pnl: float
    floating_pips: float
    margin_level_percent: float
    free_margin: float
    daily_swap_fees: float
    active_bots_count: int
    total_bots_count: int

class ForexBotStatusUpdate(BaseModel):
    status: str # "active", "stopped", "paused"

class ForexBotSettingsUpdate(BaseModel):
    lot_size: Optional[float] = None
    max_drawdown_percent: Optional[float] = None
    default_take_profit: Optional[float] = None
    default_stop_loss: Optional[float] = None
