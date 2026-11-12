from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class PreFlightRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=64)
    timeframe: str = Field(default="1h", min_length=1, max_length=32)
    data_source: str = Field(default="ohlcv", min_length=1, max_length=64)
    exchange: str = Field(default="binance", min_length=1, max_length=64)
    dataset_file: Optional[str] = None
    features: List[str] = Field(default_factory=list)
    prediction_target: str = Field(default="classification", min_length=1, max_length=64)
    lookback_limit: int = Field(default=500, ge=10, le=5000)


class NanColumnInfo(BaseModel):
    column: str
    missing_count: int
    missing_pct: float


class LeakageRiskInfo(BaseModel):
    column: str
    reason: str
    correlation: Optional[float] = None


class PreFlightResponse(BaseModel):
    total_rows: int
    feature_count: int
    missing_pct: float
    nan_columns: List[NanColumnInfo] = Field(default_factory=list)
    duplicate_rows: int
    constant_columns: List[str] = Field(default_factory=list)
    outlier_pct: float
    class_balance: Optional[Dict[str, float]] = None
    leakage_risks: List[LeakageRiskInfo] = Field(default_factory=list)
    health_score: int = Field(..., ge=0, le=100)
    status: Literal["PASS", "WARN", "FAIL"]
    warnings: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)


class TopFeatureItem(BaseModel):
    name: str
    importance: float


class ModelCompareItem(BaseModel):
    model_id: str
    name: str
    algorithm: str
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    data_source: Optional[str] = None
    active_version_id: Optional[str] = None
    version: Optional[float] = None
    accuracy: Optional[float] = None
    f1_score: Optional[float] = None
    latency: Optional[float] = None
    profit_pct: Optional[float] = None
    win_rate: Optional[float] = None
    max_drawdown: Optional[float] = None
    kelly_pct: Optional[float] = None
    sharpe_or_var: Optional[float] = None
    total_trades: Optional[int] = None
    optuna_trials_count: int = 0
    top_features: List[TopFeatureItem] = Field(default_factory=list)
    created_at: Optional[datetime] = None


class WorkerQueueJobItem(BaseModel):
    job_id: str
    symbol: str
    algorithm: str
    status: str
    progress: float
    elapsed_seconds: float
    eta_seconds: Optional[float] = None
    is_mine: bool


class WorkerQueueStatusOut(BaseModel):
    active_jobs: int
    queued_jobs: int
    user_active_jobs: int
    user_queued_jobs: int
    celery_workers_online: int
    estimated_wait_seconds: float
    jobs: List[WorkerQueueJobItem] = Field(default_factory=list)


class OptunaTrialItem(BaseModel):
    number: int
    value: Optional[float] = None
    params: Dict[str, Any] = Field(default_factory=dict)
    state: str


class OptunaTrialsOut(BaseModel):
    model_id: str
    model_name: str
    algorithm: str
    trials: List[OptunaTrialItem] = Field(default_factory=list)
    best_trial_number: Optional[int] = None
    best_value: Optional[float] = None
    best_params: Optional[Dict[str, Any]] = None


class TrainingPresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    symbol: str = Field(..., min_length=1, max_length=64)
    timeframe: str = Field(..., min_length=1, max_length=32)
    algorithm: str = Field(..., min_length=1, max_length=64)
    config: Dict[str, Any] = Field(default_factory=dict)
    is_favorite: bool = False


class TrainingPresetOut(BaseModel):
    id: int
    user_id: int
    name: str
    description: Optional[str] = None
    symbol: str
    timeframe: str
    algorithm: str
    config: Dict[str, Any]
    is_favorite: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PresetDeleteOut(BaseModel):
    status: str
    deleted_id: int


class CloneJobConfigOut(BaseModel):
    job_id: str
    symbol: str
    timeframe: str
    algorithm: str
    config: Dict[str, Any] = Field(default_factory=dict)
