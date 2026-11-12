from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base_class import Base


class TrainingPreset(Base):
    """Saved ML Training Studio hyperparameter and feature preset scoped per user."""

    __tablename__ = "training_presets"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(String(500), nullable=True)
    symbol = Column(String(64), nullable=False)
    timeframe = Column(String(32), nullable=False)
    algorithm = Column(String(64), nullable=False)
    config = Column(JSON, nullable=False, default=dict)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", backref="training_presets")
