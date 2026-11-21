"""
SaaS Administration, Audit Logging, and Subscription Billing Models
==================================================================
Tracks immutable Owner actions, user subscription states, and payment transactions.
"""

from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(64), nullable=False, index=True)
    target_type = Column(String(64), nullable=False)
    target_id = Column(String(64), nullable=True)
    ip_address = Column(String(64), nullable=True)
    details = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    admin = relationship("User")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    plan_tier = Column(String(32), nullable=False, default="free")
    billing_cycle = Column(String(16), nullable=False, default="monthly")  # monthly | yearly
    status = Column(String(32), nullable=False, default="active")          # active | trialing | past_due | canceled | comped
    provider = Column(String(32), nullable=False, default="manual")        # manual | stripe | nowpayments | lemonsqueezy
    provider_customer_id = Column(String(128), nullable=True)
    provider_subscription_id = Column(String(128), nullable=True, index=True)
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User")


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(32), nullable=False)
    provider_payment_id = Column(String(128), unique=True, nullable=False, index=True)
    amount_usd = Column(Float, nullable=False, default=0.0)
    currency = Column(String(16), nullable=False, default="USD")
    plan_tier = Column(String(32), nullable=False)
    billing_cycle = Column(String(16), nullable=False, default="monthly")
    status = Column(String(32), nullable=False, default="pending")  # pending | paid | failed | refunded
    checkout_url = Column(Text, nullable=True)
    raw_payload = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User")
