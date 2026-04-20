"""threads owned by user

Revision ID: b9d3e028f41a
Revises: a7c5f91b2e44
Create Date: 2026-04-20 11:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9d3e028f41a'
down_revision: Union[str, Sequence[str], None] = 'a7c5f91b2e44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename owner_session_id → owner_user_id.

    Threads are now keyed by the Mentee user id (OAuth `sub`) so conversations
    survive logout/login — a new session cookie no longer orphans history.
    """
    op.drop_index(
        op.f('ix_chat_threads_owner_session_id'),
        table_name='chat_threads',
    )
    op.alter_column(
        'chat_threads',
        'owner_session_id',
        new_column_name='owner_user_id',
    )
    op.create_index(
        op.f('ix_chat_threads_owner_user_id'),
        'chat_threads',
        ['owner_user_id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f('ix_chat_threads_owner_user_id'),
        table_name='chat_threads',
    )
    op.alter_column(
        'chat_threads',
        'owner_user_id',
        new_column_name='owner_session_id',
    )
    op.create_index(
        op.f('ix_chat_threads_owner_session_id'),
        'chat_threads',
        ['owner_session_id'],
        unique=False,
    )
