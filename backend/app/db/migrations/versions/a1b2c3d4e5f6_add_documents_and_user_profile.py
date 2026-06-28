"""add documents and user_profile

Revision ID: a1b2c3d4e5f6
Revises: 3b8e1a4f2c9d
Create Date: 2026-05-31 21:00:00.000000

Phase 0 of document upload & processing — see
docs/documents/00-document-upload-plan.md.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '3b8e1a4f2c9d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'documents',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('thread_id', sa.UUID(), nullable=True),
        sa.Column('purpose', sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column('filename', sa.Text(), nullable=False),
        sa.Column('mime_type', sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('processing_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('provider', sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
        sa.Column('provider_file_id', sa.Text(), nullable=True),
        sa.Column('storage_uri', sa.Text(), nullable=True),
        sa.Column('file_hash', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('extracted_text', sa.Text(), nullable=True),
        sa.Column('extracted_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('page_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['thread_id'], ['threads.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_documents_user_thread', 'documents', ['user_id', 'thread_id'], unique=False
    )
    op.create_index(
        'ix_documents_file_hash', 'documents', ['file_hash'], unique=False
    )
    op.create_index(
        'ix_documents_status_started',
        'documents',
        ['status', 'processing_started_at'],
        unique=False,
    )

    op.create_table(
        'user_profile',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('cv_document_id', sa.UUID(), nullable=True),
        sa.Column('cv_structured', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('cv_summary', sa.Text(), nullable=True),
        sa.Column('cv_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['cv_document_id'], ['documents.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('user_profile')
    op.drop_index('ix_documents_status_started', table_name='documents')
    op.drop_index('ix_documents_file_hash', table_name='documents')
    op.drop_index('ix_documents_user_thread', table_name='documents')
    op.drop_table('documents')
