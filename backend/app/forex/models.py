from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.db.base_class import Base

class ForexBot(Base):
    __tablename__ = "forex_bots"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    pair = Column(String, index=True) # e.g., 'EUR/USD'
    strategy = Column(String) # e.g., 'LondonScalper'
    lot_size = Column(Float, default=0.1)
    leverage = Column(Integer, default=100)
    max_drawdown_percent = Column(Float, default=5.0)
    use_news_filter = Column(Boolean, default=True)
    max_spread_pips = Column(Float, default=2.5)
    default_take_profit = Column(Float, default=20.0)
    default_stop_loss = Column(Float, default=10.0)
    config = Column(JSON, default=dict)
    
    status = Column(String, default="inactive") # active, inactive, paused
    total_pips = Column(Float, default=0.0)
    total_pnl = Column(Float, default=0.0)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ForexTrade(Base):
    __tablename__ = "forex_trades"
    
    id = Column(Integer, primary_key=True, index=True)
    bot_id = Column(Integer, index=True)
    pair = Column(String, index=True)
    side = Column(String) # BUY, SELL
    lot_size = Column(Float)
    entry_price = Column(Float)
    exit_price = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    stop_loss = Column(Float, nullable=True)
    pips_gained = Column(Float, default=0.0)
    pnl = Column(Float, default=0.0)
    swap_fee = Column(Float, default=0.0)
    status = Column(String, default="OPEN") # OPEN, CLOSED
    
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)
