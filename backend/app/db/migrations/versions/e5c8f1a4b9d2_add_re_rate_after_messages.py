"""add_re_rate_after_messages

Revision ID: e5c8f1a4b9d2
Revises: d7f2a3e9b4c8
Create Date: 2026-05-07 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5c8f1a4b9d2'
down_revision: Union[str, Sequence[str], None] = 'd7f2a3e9b4c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Lets the rating prompt re-ask on a rated thread once the user has sent
    `re_rate_after_messages` more messages within that conversation. Default
    `0` preserves the prior behavior (a rated thread is locked forever) so
    the migration is a pure additive change for live deployments.
    """
    op.add_column(
        'feedback_trigger_config',
        sa.Column(
            're_rate_after_messages',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ),
    )
    op.create_check_constraint(
        'ck_feedback_trigger_config_re_rate',
        'feedback_trigger_config',
        're_rate_after_messages >= 0',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'ck_feedback_trigger_config_re_rate',
        'feedback_trigger_config',
        type_='check',
    )
    op.drop_column('feedback_trigger_config', 're_rate_after_messages')
