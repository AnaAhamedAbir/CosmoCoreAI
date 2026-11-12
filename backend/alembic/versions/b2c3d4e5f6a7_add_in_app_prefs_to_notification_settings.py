"""add_in_app_prefs_to_notification_settings

Revision ID: b2c3d4e5f6a7
Revises: f2a4b6c8d0e2
Create Date: 2026-11-12 06:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'f2a4b6c8d0e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add in_app_prefs JSON column to notification_settings."""
    op.add_column('notification_settings', sa.Column('in_app_prefs', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Remove in_app_prefs column from notification_settings."""
    op.drop_column('notification_settings', 'in_app_prefs')
