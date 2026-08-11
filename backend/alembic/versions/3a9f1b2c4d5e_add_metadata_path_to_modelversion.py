"""Add metadata_path to ModelVersion

Revision ID: 3a9f1b2c4d5e
Revises: 2b7d3ea6b81b
Create Date: 2026-05-21 19:48:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3a9f1b2c4d5e'
down_revision: Union[str, Sequence[str], None] = '2b7d3ea6b81b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add metadata_path column to model_versions table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('model_versions')]
    if 'metadata_path' not in columns:
        op.add_column('model_versions', sa.Column('metadata_path', sa.String(), nullable=True))


def downgrade() -> None:
    """Remove metadata_path column from model_versions table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('model_versions')]
    if 'metadata_path' in columns:
        op.drop_column('model_versions', 'metadata_path')
