"""add_feedback_trigger_config

Revision ID: d7f2a3e9b4c8
Revises: c4a2f1e8d6b3
Create Date: 2026-05-07 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7f2a3e9b4c8'
down_revision: Union[str, Sequence[str], None] = 'c4a2f1e8d6b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Single-row config that drives the in-chat session rating prompt cadence.
    Admins edit it from `/admin/feedback`; logged-in users read it via
    `GET /api/chat/feedback-trigger-config` so the trigger hook honors live
    changes without a redeploy.

    Singleton enforced by `id = 1` PK + CHECK — keeps the table free of stale
    revisions and lets every read be `SELECT ... WHERE id = 1`.
    """
    op.create_table(
        'feedback_trigger_config',
        sa.Column('id', sa.SmallInteger(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
        sa.Column('mode', sa.Text(), nullable=False, server_default=sa.text("'interactions'")),
        sa.Column('interactions_first', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('interactions_repeat', sa.Integer(), nullable=False, server_default=sa.text('15')),
        # Stored as minutes for precision + a single unit. UI converts to
        # hours/days for display. Defaults: first ask 1 day after first
        # message, repeat every 7 days.
        sa.Column('time_first_minutes', sa.Integer(), nullable=False, server_default=sa.text('1440')),
        sa.Column('time_repeat_minutes', sa.Integer(), nullable=False, server_default=sa.text('10080')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_by_user_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ['updated_by_user_id'], ['users.id'], ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('id = 1', name='ck_feedback_trigger_config_singleton'),
        sa.CheckConstraint(
            "mode IN ('interactions', 'time', 'hybrid')",
            name='ck_feedback_trigger_config_mode',
        ),
        sa.CheckConstraint(
            'interactions_first >= 1',
            name='ck_feedback_trigger_config_interactions_first',
        ),
        sa.CheckConstraint(
            'interactions_repeat >= 1',
            name='ck_feedback_trigger_config_interactions_repeat',
        ),
        sa.CheckConstraint(
            'time_first_minutes >= 1',
            name='ck_feedback_trigger_config_time_first',
        ),
        sa.CheckConstraint(
            'time_repeat_minutes >= 1',
            name='ck_feedback_trigger_config_time_repeat',
        ),
    )
    # Seed the singleton row so `GET` always returns something. Subsequent
    # admin updates flip `enabled` / mode / thresholds in place.
    op.execute(
        """
        INSERT INTO feedback_trigger_config (
            id, enabled, mode, interactions_first, interactions_repeat,
            time_first_minutes, time_repeat_minutes, updated_at
        ) VALUES (
            1, TRUE, 'interactions', 5, 15, 1440, 10080, now()
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('feedback_trigger_config')
