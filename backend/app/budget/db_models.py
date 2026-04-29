from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel

# Append-only audit trail for BudgetConfig edits. Every field change made via
# the admin UI writes one row here with the reason the admin supplied — so a
# future admin opening the history sees *why* rates / credit values moved,
# not just that they moved.


class UserQuota(SQLModel, table=True):
    __tablename__ = "user_quota"

    user_id: UUID = Field(
        primary_key=True,
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    credits_remaining: int = Field(default=0)
    credits_used_period: int = Field(default=0)
    credits_granted_period: int = Field(default=0)
    override_monthly_credits: int | None = Field(default=None)
    period_start: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class MessageUsage(SQLModel, table=True):
    __tablename__ = "message_usage"
    __table_args__ = (
        Index("ix_message_usage_user_id_created_at", "user_id", "created_at"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    user_id: UUID = Field(
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    thread_id: UUID | None = Field(
        default=None,
        foreign_key="threads.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="SET NULL",
    )
    message_id: UUID | None = Field(
        default=None,
        foreign_key="messages.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="SET NULL",
    )
    model: str = Field(max_length=64)
    # Specific model SKU as called (e.g. "gpt-5.4-mini", "sonar-pro"). Captured
    # at write-time from settings so a future model swap stays observable in
    # historical analytics without per-SKU pricing.
    model_sku: str | None = Field(default=None, max_length=128)
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    request_count: int = Field(default=1)
    cost_usd_micros: int = Field(default=0)
    credits_charged: int = Field(default=0)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))


class GlobalBudgetState(SQLModel, table=True):
    __tablename__ = "global_budget_state"

    id: int = Field(primary_key=True, default=1)
    period_start: datetime = Field(sa_type=DateTime(timezone=True))
    openai_spend_micros: int = Field(default=0)
    perplexity_spend_micros: int = Field(default=0)
    web_search_spend_micros: int = Field(default=0)
    perplexity_degraded: bool = Field(default=False)
    hard_stopped: bool = Field(default=False)
    # Flags are flipped either by an admin from the Controls tab or by the
    # agent layer when a provider returns an insufficient-funds error. The
    # reason is admin-only — users see generic copy.
    perplexity_degrade_reason: str | None = Field(default=None, max_length=200)
    perplexity_degraded_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    hard_stop_reason: str | None = Field(default=None, max_length=200)
    hard_stopped_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class BudgetConfigChangeLog(SQLModel, table=True):
    __tablename__ = "budget_config_change_log"
    __table_args__ = (
        Index(
            "ix_budget_config_change_log_changed_at",
            "changed_at",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    field: str = Field(max_length=64)
    old_value: int | None = Field(default=None)
    new_value: int = Field(default=0)
    reason: str = Field(max_length=500)
    actor_email: str = Field(max_length=255)
    changed_at: datetime = Field(sa_type=DateTime(timezone=True))


class BudgetConfig(SQLModel, table=True):
    __tablename__ = "budget_config"

    id: int = Field(primary_key=True, default=1)

    # Per-user + unit
    default_monthly_credits: int = Field(default=100)
    credit_usd_value_micros: int = Field(default=10_000)  # $0.01/credit

    # Pricing — adjust when provider rates change. Per-million-token values are
    # stored as micros so admin edits stay integer-accurate.
    pricing_openai_input_per_mtok_micros: int = Field(default=750_000)       # $0.75
    pricing_openai_output_per_mtok_micros: int = Field(default=4_500_000)    # $4.50
    pricing_perplexity_input_per_mtok_micros: int = Field(default=1_000_000)  # $1.00
    pricing_perplexity_output_per_mtok_micros: int = Field(default=1_000_000)  # $1.00
    pricing_perplexity_request_fee_micros: int = Field(default=5_000)         # $0.005
    pricing_web_search_per_call_micros: int = Field(default=10_000)           # $0.01

    updated_at: datetime = Field(sa_type=DateTime(timezone=True))
