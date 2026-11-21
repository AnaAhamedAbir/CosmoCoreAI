"""merge_saas_and_legacy_heads

Revision ID: g7b8c9d0e1f2
Revises: 55f8037c51cd, 5d8e9f0a1b2c, f6a7b8c9d0e1
Create Date: 2026-11-21 21:46:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'g7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = ('55f8037c51cd', '5d8e9f0a1b2c', 'f6a7b8c9d0e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge existing repository heads into a single linear head."""
    pass


def downgrade() -> None:
    """Unmerge heads."""
    pass
