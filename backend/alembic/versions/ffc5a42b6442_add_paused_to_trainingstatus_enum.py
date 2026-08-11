"""Add PAUSED to trainingstatus enum

Revision ID: ffc5a42b6442
Revises: 3a9f1b2c4d5e
Create Date: 2026-06-05 15:10:17.990324

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
"""Add PAUSED to trainingstatus enum

Revision ID: ffc5a42b6442
Revises: 3a9f1b2c4d5e
Create Date: 2026-06-05 15:10:17.990324

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ffc5a42b6442'
down_revision: Union[str, Sequence[str], None] = '3a9f1b2c4d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE trainingstatus ADD VALUE IF NOT EXISTS 'PAUSED';")


def downgrade() -> None:
    """Downgrade schema."""
    # Note: Postgres does not support removing values from an ENUM type easily.
    pass
