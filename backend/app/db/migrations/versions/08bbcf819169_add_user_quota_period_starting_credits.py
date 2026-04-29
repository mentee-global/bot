"""add user_quota.period_starting_credits

Revision ID: 08bbcf819169
Revises: 33a29e77fa4e
Create Date: 2026-04-29 15:39:50.032161

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '08bbcf819169'
down_revision: Union[str, Sequence[str], None] = '33a29e77fa4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Add `period_starting_credits` to user_quota — a frozen snapshot of how
    many credits the user got at the start of their current period. Used to
    compute the "extra granted this period" display value without it shifting
    when an admin retunes default_monthly_credits mid-period.

    Backfill: existing rows are seeded with `credits_granted_period`, which
    is correct for users with no active grants (the common case). Users with
    an active grant at migration time will show 0 bonus until their next
    rollover — that's a one-time blip; the underlying balance is untouched.
    """
    # Add nullable first so the backfill can run, then enforce NOT NULL.
    op.add_column(
        'user_quota',
        sa.Column('period_starting_credits', sa.Integer(), nullable=True),
    )
    op.execute(
        "UPDATE user_quota SET period_starting_credits = credits_granted_period"
    )
    op.alter_column('user_quota', 'period_starting_credits', nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user_quota', 'period_starting_credits')
