"""multi thread per session

Revision ID: a7c5f91b2e44
Revises: 6dc44a21e1fd
Create Date: 2026-04-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'a7c5f91b2e44'
down_revision: Union[str, Sequence[str], None] = '6dc44a21e1fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop the unique constraint/index on owner_session_id and replace with a
    # plain index so one session can own many threads.
    op.drop_index(
        op.f('ix_chat_threads_owner_session_id'),
        table_name='chat_threads',
    )
    op.create_index(
        op.f('ix_chat_threads_owner_session_id'),
        'chat_threads',
        ['owner_session_id'],
        unique=False,
    )
    op.add_column(
        'chat_threads',
        sa.Column(
            'title',
            sqlmodel.sql.sqltypes.AutoString(length=200),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('chat_threads', 'title')
    op.drop_index(
        op.f('ix_chat_threads_owner_session_id'),
        table_name='chat_threads',
    )
    op.create_index(
        op.f('ix_chat_threads_owner_session_id'),
        'chat_threads',
        ['owner_session_id'],
        unique=True,
    )
