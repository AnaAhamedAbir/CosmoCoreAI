from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any
from datetime import datetime

class ModelVersionBase(BaseModel):
    version: float
    description: Optional[str] = None

class ModelVersionCreate(ModelVersionBase):
    pass

class ModelVersionResponse(ModelVersionBase):
    id: str
    model_id: str
    file_path: str
    upload_date: datetime
    status: str
    accuracy: Optional[float] = None
    f1_score: Optional[float] = None
    latency: Optional[float] = None
    explainability: Optional[Any] = None
    features: Optional[List[str]] = None

    model_config = ConfigDict(from_attributes=True)

class CustomMLModelBase(BaseModel):
    name: str
    model_type: str
    market_type: Optional[str] = "crypto"

class CustomMLModelCreate(CustomMLModelBase):
    pass

class CustomMLModelUpdate(BaseModel):
    active_version_id: str

class CustomMLModelResponse(CustomMLModelBase):
    id: str
    market_type: str
    active_version_id: Optional[str] = None
    is_auto_retrain: Optional[int] = 0
    retrain_interval_hours: Optional[int] = 6
    data_lookback_hours: Optional[float] = 6.0
    created_at: datetime
    updated_at: Optional[datetime] = None
    versions: List[ModelVersionResponse] = []

    model_config = ConfigDict(from_attributes=True)
