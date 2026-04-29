"""add_message_usage_model_sku

Revision ID: 4f1a8b2d9c30
Revises: a95d27470bc2
Create Date: 2026-04-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '4f1a8b2d9c30'
down_revision: Union[str, Sequence[str], None] = 'a95d27470bc2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Additive nullable column — old rows stay NULL (renders "—" in the admin
    # UI). New rows record the exact SKU the agent called (e.g. "gpt-5.4-mini",
    # "sonar-pro") so a future model swap stays observable in analytics
    # without per-SKU pricing.
    op.add_column(
        'message_usage',
        sa.Column(
            'model_sku',
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('message_usage', 'model_sku')
