"""add_alert_manual_trade

Revision ID: e1f2a3b4c5d6
Revises: 1d65ecace55c
Create Date: 2026-10-31 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = '1d65ecace55c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('notification_settings', sa.Column('alert_manual_trade', sa.Boolean(), nullable=True, server_default=sa.text('true')))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('notification_settings', 'alert_manual_trade')

