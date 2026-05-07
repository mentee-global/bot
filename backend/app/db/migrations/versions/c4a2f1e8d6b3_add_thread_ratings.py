"""add_thread_ratings

Revision ID: c4a2f1e8d6b3
Revises: e8e566efeda2
Create Date: 2026-05-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a2f1e8d6b3'
down_revision: Union[str, Sequence[str], None] = 'e8e566efeda2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Per-conversation 1–5 star rating with optional 200-char comment.
    Sibling to `message_ratings`: this is per-thread (one row max per thread,
    enforced by `UNIQUE (thread_id)`), used by the in-chat session rating
    card and the admin Feedback section. Comment column is hard-bounded by
    a CHECK to defend against bypasses of the Pydantic 200-char limit.
    """
    op.create_table(
        'thread_ratings',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('thread_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('stars', sa.SmallInteger(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ['thread_id'], ['threads.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('thread_id', name='uq_thread_ratings_thread'),
        sa.CheckConstraint(
            'stars BETWEEN 1 AND 5', name='ck_thread_ratings_stars'
        ),
        sa.CheckConstraint(
            'comment IS NULL OR char_length(comment) <= 200',
            name='ck_thread_ratings_comment_len',
        ),
    )
    op.create_index(
        'ix_thread_ratings_user_id', 'thread_ratings', ['user_id']
    )
    op.create_index(
        'ix_thread_ratings_stars_created_at',
        'thread_ratings',
        ['stars', 'created_at'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'ix_thread_ratings_stars_created_at', table_name='thread_ratings'
    )
    op.drop_index('ix_thread_ratings_user_id', table_name='thread_ratings')
    op.drop_table('thread_ratings')
