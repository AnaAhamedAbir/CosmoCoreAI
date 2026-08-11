from sqlalchemy import Column, String, Float, DateTime, Boolean, JSON, Integer
from datetime import datetime
from app.db.base_class import Base

class PredictionLog(Base):
    __tablename__ = "prediction_logs"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(String, index=True, nullable=False)
    symbol = Column(String, index=True, nullable=False)
    timeframe = Column(String, nullable=False)
    predicted_signal = Column(String, nullable=False) # BUY, SELL, HOLD
    confidence = Column(Float, nullable=False)
    predicted_price = Column(Float, nullable=False) # Market price at the time of prediction
    
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    # These will be updated later by the drift monitoring background task
    actual_outcome_price = Column(Float, nullable=True) 
    is_correct = Column(Boolean, nullable=True) # True if prediction was profitable
    
    # Optional metadata like dataset type, feature snapshot (if we want deep drift analysis)
    metadata_json = Column(JSON, nullable=True)
