"""add_training_presets_table

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-12 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create training_presets table idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("training_presets"):
        return

    op.create_table(
        "training_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("symbol", sa.String(length=64), nullable=False),
        sa.Column("timeframe", sa.String(length=32), nullable=False),
        sa.Column("algorithm", sa.String(length=64), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("is_favorite", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_training_presets_id"), "training_presets", ["id"], unique=False)
    op.create_index(op.f("ix_training_presets_user_id"), "training_presets", ["user_id"], unique=False)


def downgrade() -> None:
    """Drop training_presets table if present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("training_presets"):
        return

    op.drop_index(op.f("ix_training_presets_user_id"), table_name="training_presets")
    op.drop_index(op.f("ix_training_presets_id"), table_name="training_presets")
    op.drop_table("training_presets")
