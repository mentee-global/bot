"""add_cv_ocr_usage_tracking

Adds the columns needed to track + bill CV OCR spend:
- message_usage.source: distinguishes "chat" turns from "cv_ocr" document
  processing in the ledger (the latter has no thread/message).
- documents.ocr_credits_charged: credits debited to OCR a CV, surfaced to the
  user so they can see what reading their CV cost.

Both get a server_default so existing rows backfill cleanly; the default is then
dropped so the schema matches the SQLModel definition (app-side default only).

Revision ID: b2d4f6a8c0e1
Revises: c1d2e3f4a5b6
Create Date: 2026-06-28 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2d4f6a8c0e1'
down_revision: str | Sequence[str] | None = 'c1d2e3f4a5b6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'message_usage',
        sa.Column(
            'source',
            sqlmodel.sql.sqltypes.AutoString(length=32),
            server_default=sa.text("'chat'"),
            nullable=False,
        ),
    )
    op.alter_column('message_usage', 'source', server_default=None)

    op.add_column(
        'documents',
        sa.Column(
            'ocr_credits_charged',
            sa.Integer(),
            server_default=sa.text('0'),
            nullable=False,
        ),
    )
    op.alter_column('documents', 'ocr_credits_charged', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('documents', 'ocr_credits_charged')
    op.drop_column('message_usage', 'source')
