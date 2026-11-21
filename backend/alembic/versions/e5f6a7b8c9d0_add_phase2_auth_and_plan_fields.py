"""add_phase2_auth_and_plan_fields

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-11-21 21:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add Phase 2 email verification, TOTP 2FA, plan_tier, and forex_bots owner_id."""
    op.add_column('users', sa.Column('is_email_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('users', sa.Column('plan_tier', sa.String(), nullable=False, server_default='free'))
    op.add_column('users', sa.Column('totp_secret_encrypted', sa.String(), nullable=True))
    op.add_column('users', sa.Column('is_2fa_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('forex_bots', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_forex_bots_owner_id', 'forex_bots', 'users', ['owner_id'], ['id'])


def downgrade() -> None:
    """Remove Phase 2 columns."""
    op.drop_constraint('fk_forex_bots_owner_id', 'forex_bots', type_='foreignkey')
    op.drop_column('forex_bots', 'owner_id')
    op.drop_column('users', 'is_2fa_enabled')
    op.drop_column('users', 'totp_secret_encrypted')
    op.drop_column('users', 'plan_tier')
    op.drop_column('users', 'is_email_verified')
