"""drop_hybrid_feedback_mode

Revision ID: f1a3c5d2e7b4
Revises: e5c8f1a4b9d2
Create Date: 2026-05-07 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a3c5d2e7b4'
down_revision: Union[str, Sequence[str], None] = 'e5c8f1a4b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Drops the `hybrid` trigger mode from `feedback_trigger_config`. Any row
    that happens to be set to `hybrid` is migrated to `interactions` (the
    seed default) before the new CHECK is applied so the constraint can
    pass without manual cleanup.
    """
    op.execute(
        "UPDATE feedback_trigger_config SET mode = 'interactions' "
        "WHERE mode = 'hybrid'"
    )
    op.drop_constraint(
        'ck_feedback_trigger_config_mode',
        'feedback_trigger_config',
        type_='check',
    )
    op.create_check_constraint(
        'ck_feedback_trigger_config_mode',
        'feedback_trigger_config',
        "mode IN ('interactions', 'time')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'ck_feedback_trigger_config_mode',
        'feedback_trigger_config',
        type_='check',
    )
    op.create_check_constraint(
        'ck_feedback_trigger_config_mode',
        'feedback_trigger_config',
        "mode IN ('interactions', 'time', 'hybrid')",
    )
