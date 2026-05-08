"""add_message_usage_is_test

Revision ID: 3b8e1a4f2c9d
Revises: f1a3c5d2e7b4
Create Date: 2026-05-08 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3b8e1a4f2c9d'
down_revision: Union[str, Sequence[str], None] = 'f1a3c5d2e7b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Flag rows produced by a non-prod instance that shares the DB with prod
    # (local dev boxes use the same Postgres). Test rows are written but not
    # counted toward global spend, role split, or per-user credit debit.
    # Default false so existing data is treated as production traffic.
    op.add_column(
        'message_usage',
        sa.Column(
            'is_test',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('message_usage', 'is_test')
