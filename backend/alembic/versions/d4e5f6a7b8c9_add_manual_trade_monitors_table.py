"""add_manual_trade_monitors_table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-20 09:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create manual_trade_monitors table idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("manual_trade_monitors"):
        return

    op.create_table(
        "manual_trade_monitors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("monitor_id", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("api_key_id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=64), nullable=False),
        sa.Column("is_futures", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("side", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("sl_type", sa.String(length=32), nullable=True),
        sa.Column("sl_mode", sa.String(length=32), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("entry_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("trigger_price", sa.Float(), nullable=True),
        sa.Column("highest_price", sa.Float(), nullable=True),
        sa.Column("lowest_price", sa.Float(), nullable=True),
        sa.Column("entry_order_id", sa.String(length=128), nullable=True),
        sa.Column("tp_order_id", sa.String(length=128), nullable=True),
        sa.Column("tp_price", sa.Float(), nullable=True),
        sa.Column("disaster_sl_order_id", sa.String(length=128), nullable=True),
        sa.Column("breakeven_activated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("manual_trigger_override", sa.Float(), nullable=True),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_manual_trade_monitors_id"), "manual_trade_monitors", ["id"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_monitor_id"), "manual_trade_monitors", ["monitor_id"], unique=True)
    op.create_index(op.f("ix_manual_trade_monitors_kind"), "manual_trade_monitors", ["kind"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_user_id"), "manual_trade_monitors", ["user_id"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_api_key_id"), "manual_trade_monitors", ["api_key_id"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_symbol"), "manual_trade_monitors", ["symbol"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_status"), "manual_trade_monitors", ["status"], unique=False)
    op.create_index(op.f("ix_manual_trade_monitors_entry_order_id"), "manual_trade_monitors", ["entry_order_id"], unique=False)


def downgrade() -> None:
    """Drop manual_trade_monitors table if present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("manual_trade_monitors"):
        return

    op.drop_index(op.f("ix_manual_trade_monitors_entry_order_id"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_status"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_symbol"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_api_key_id"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_user_id"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_kind"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_monitor_id"), table_name="manual_trade_monitors")
    op.drop_index(op.f("ix_manual_trade_monitors_id"), table_name="manual_trade_monitors")
    op.drop_table("manual_trade_monitors")
