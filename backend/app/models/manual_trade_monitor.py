from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.sql import func

from app.db.base_class import Base


class ManualTradeMonitor(Base):
    """
    Persistent state for active Manual Trade background monitors:
    - software_sl (Smart Chase trigger monitor, Trailing SL, Trailing Chase, Fixed SL / Auto-Breakeven)
    - smart_chase (Active Smart Chase maker limit execution loop)
    - entry_monitor (Pending Limit Entry waiting for fill to spawn TP/SL brackets)
    - smart_peg (Active Smart Peg maker entry loop)
    - native_otoco (Native Binance Spot OTO/OTOCO notification watcher)
    """

    __tablename__ = "manual_trade_monitors"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    monitor_id = Column(String(128), unique=True, nullable=False, index=True)
    kind = Column(String(32), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False, index=True)

    symbol = Column(String(64), nullable=False, index=True)
    is_futures = Column(Boolean, nullable=False, default=False)
    side = Column(String(16), nullable=False)
    status = Column(String(32), nullable=False, default="active", index=True)

    sl_type = Column(String(32), nullable=True)
    sl_mode = Column(String(32), nullable=True)

    amount = Column(Float, nullable=False, default=0.0)
    entry_price = Column(Float, nullable=False, default=0.0)
    trigger_price = Column(Float, nullable=True)
    highest_price = Column(Float, nullable=True)
    lowest_price = Column(Float, nullable=True)

    entry_order_id = Column(String(128), nullable=True, index=True)
    tp_order_id = Column(String(128), nullable=True)
    tp_price = Column(Float, nullable=True)
    disaster_sl_order_id = Column(String(128), nullable=True)

    breakeven_activated = Column(Boolean, nullable=False, default=False)
    manual_trigger_override = Column(Float, nullable=True)

    config = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
