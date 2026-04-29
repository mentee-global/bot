"""add_message_ratings

Revision ID: e8e566efeda2
Revises: 08bbcf819169
Create Date: 2026-04-29 17:48:47.306400

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8e566efeda2'
down_revision: Union[str, Sequence[str], None] = '08bbcf819169'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Per-user thumbs feedback on assistant messages. One row per (message,
    user); the wire protocol uses 0 to mean "clear" — the service layer
    deletes the row instead of inserting a 0, so the column itself is
    constrained to ±1 and queries can `LEFT JOIN` to a non-null rating.
    """
    op.create_table(
        'message_ratings',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('message_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('rating', sa.SmallInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ['message_id'], ['messages.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'message_id', 'user_id', name='uq_message_ratings_user_msg'
        ),
        sa.CheckConstraint(
            'rating IN (-1, 1)', name='ck_message_ratings_rating'
        ),
    )
    op.create_index(
        'ix_message_ratings_user_id', 'message_ratings', ['user_id']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_message_ratings_user_id', table_name='message_ratings')
    op.drop_table('message_ratings')
