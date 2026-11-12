"""add_system_notifications_table

Revision ID: f2a4b6c8d0e2
Revises: e1f2a3b4c5d6
Create Date: 2026-11-12 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a4b6c8d0e2'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'system_notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('category', sa.String(length=32), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False, server_default='info'),
        sa.Column('severity', sa.String(length=16), nullable=False, server_default='info'),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('meta', sa.JSON(), nullable=False),
        sa.Column('dedup_key', sa.String(length=128), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_dismissed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_system_notifications_id'), 'system_notifications', ['id'], unique=False)
    op.create_index(op.f('ix_system_notifications_user_id'), 'system_notifications', ['user_id'], unique=False)
    op.create_index(op.f('ix_system_notifications_category'), 'system_notifications', ['category'], unique=False)
    op.create_index(op.f('ix_system_notifications_dedup_key'), 'system_notifications', ['dedup_key'], unique=False)
    op.create_index(op.f('ix_system_notifications_created_at'), 'system_notifications', ['created_at'], unique=False)

    op.create_table(
        'system_notification_user_states',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('notification_id', sa.Integer(), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_dismissed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['notification_id'], ['system_notifications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'notification_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('system_notification_user_states')
    op.drop_index(op.f('ix_system_notifications_created_at'), table_name='system_notifications')
    op.drop_index(op.f('ix_system_notifications_dedup_key'), table_name='system_notifications')
    op.drop_index(op.f('ix_system_notifications_category'), table_name='system_notifications')
    op.drop_index(op.f('ix_system_notifications_user_id'), table_name='system_notifications')
    op.drop_index(op.f('ix_system_notifications_id'), table_name='system_notifications')
    op.drop_table('system_notifications')
