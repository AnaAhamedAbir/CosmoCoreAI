from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class PaperReplayRequest(BaseModel):
    """Optional configuration for out-of-sample paper replay."""

    initial_balance: float = Field(default=10000.0, gt=0.0)
    stop_loss: float = Field(default=2.0, gt=0.0, le=100.0)
    take_profit: float = Field(default=4.0, gt=0.0, le=1000.0)
    commission: float = Field(default=0.001, ge=0.0, le=0.5)
    max_bars: int = Field(default=250, ge=10, le=5000)


class EquityCurvePoint(BaseModel):
    """Single bar point on the simulated paper replay equity curve."""

    bar: int
    price: float
    equity: float
    drawdown_pct: float
    signal: int


class PaperReplayResponse(BaseModel):
    """Paper replay equity curve and performance metrics response."""

    model_id: str
    model_name: str
    version_id: str
    algorithm: str
    source: Literal["live_oos_replay", "cached_post_backtest"]
    initial_balance: float
    final_value: float
    profit_pct: float
    win_rate: float
    max_drawdown: float
    profit_factor: float
    sharpe_ratio: float
    total_trades: int
    kelly_pct: float
    monte_carlo_var: float
    risk_of_ruin: float
    bars_replayed: int
    equity_curve: List[EquityCurvePoint] = Field(default_factory=list)


class WallHunterBotItem(BaseModel):
    """Summary of a user's Crypto WallHunter bot and its ML filter config."""

    id: int
    name: str
    exchange: str
    market: str
    status: str
    current_ai_model_id: Optional[str] = None
    enable_ml_filter: bool = False
    ml_min_confidence: float = 0.6

    model_config = ConfigDict(from_attributes=True)


class DeployToWallHunterRequest(BaseModel):
    """Request payload to attach a crypto ML model to a WallHunter bot."""

    bot_id: int
    model_id: str
    enable_ml_filter: bool = True
    min_confidence: float = Field(default=0.6, ge=0.0, le=1.0)


class DeployToWallHunterResponse(BaseModel):
    """Result of deploying an ML model to a WallHunter bot."""

    success: bool = True
    bot_id: int
    bot_name: str
    model_id: str
    model_name: str
    live_reloaded: bool = False


class ManualTradePinRequest(BaseModel):
    """Request payload to pin an ML model as the Manual Trade ML Filter."""

    model_id: str
    min_confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    enabled: bool = True


class ManualTradePinInfo(BaseModel):
    """Pinned Manual Trade ML Filter model metadata."""

    model_id: str
    model_name: str
    symbol: Optional[str] = None
    algorithm: str
    min_confidence: float = 0.6
    enabled: bool = True


class ManualTradePinResponse(BaseModel):
    """GET response returning the currently pinned Manual Trade ML model or None."""

    pinned: Optional[ManualTradePinInfo] = None


class ManualTradePinSetResponse(BaseModel):
    """POST response confirming Manual Trade ML pin update."""

    success: bool = True
    pinned: ManualTradePinInfo


class DeleteManualTradePinResponse(BaseModel):
    """DELETE response confirming Manual Trade ML pin removal."""

    success: bool = True


class RetrainModelResponse(BaseModel):
    """Response returned after queuing a 1-click retrain/fine-tune job."""

    success: bool = True
    job_id: str
    model_id: str
    symbol: str
    timeframe: str
    algorithm: str
