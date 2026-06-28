"""profile: add about_me, drop structured CV columns

The CV pipeline moved from structured extraction to faithful Markdown OCR: the
transcription now lives on the document (`documents.extracted_text`) and is
injected into chats in full, so `user_profile.cv_structured` / `cv_summary`
are no longer used. Adds `about_me` free-text prose.

Revision ID: c1d2e3f4a5b6
Revises: b6c7d8e9f0a1
Create Date: 2026-06-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_profile",
        sa.Column("about_me", sa.Text(), nullable=True),
    )
    op.drop_column("user_profile", "cv_structured")
    op.drop_column("user_profile", "cv_summary")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "user_profile",
        sa.Column("cv_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "user_profile",
        sa.Column(
            "cv_structured",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.drop_column("user_profile", "about_me")
