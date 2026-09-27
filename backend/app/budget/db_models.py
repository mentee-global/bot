from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Append-only audit trail for BudgetConfig edits. Every field change made via
# the admin UI writes one row here with the reason the admin supplied — so a
# future admin opening the history sees *why* rates / credit values moved,
# not just that they moved.


class UserQuota(Base):
    __tablename__ = "user_quota"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    credits_remaining: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    credits_used_period: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    credits_granted_period: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    # Snapshot of the user's starting credits at the *current* period's
    # rollover (or first creation). Frozen until the next rollover — admin
    # edits to default_monthly_credits or override_monthly_credits don't
    # rewrite history. The "extra granted this period" the UI shows is
    # `credits_granted_period - period_starting_credits`, which would lie if
    # we used the live monthly cap instead.
    period_starting_credits: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    override_monthly_credits: Mapped[int | None] = mapped_column(nullable=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MessageUsage(Base):
    __tablename__ = "message_usage"
    __table_args__ = (Index("ix_message_usage_user_id_created_at", "user_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    thread_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("threads.id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    model: Mapped[str] = mapped_column(String(64))
    # What produced this spend: "chat" for a normal turn, "cv_ocr" for the
    # background CV transcription (which has no thread/message). Lets the ledger
    # distinguish chat spend from document-processing spend without inferring it
    # from a NULL message_id.
    source: Mapped[str] = mapped_column(String(32), default="chat", info={"init_default": "chat"})
    # Specific model SKU as called (e.g. "gpt-5.4-mini", "sonar-pro"). Captured
    # at write-time from settings so a future model swap stays observable in
    # historical analytics without per-SKU pricing.
    model_sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    input_tokens: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    output_tokens: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    request_count: Mapped[int] = mapped_column(default=1, info={"init_default": 1})
    cost_usd_micros: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    credits_charged: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    # True when written by a non-prod instance that shares the DB with prod
    # (e.g. a local dev box). Excluded from global counters, the role split,
    # and credit debits — see `BudgetService.record_turn`.
    is_test: Mapped[bool] = mapped_column(default=False, info={"init_default": False})
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class GlobalBudgetState(Base):
    __tablename__ = "global_budget_state"

    id: Mapped[int] = mapped_column(default=1, info={"init_default": 1}, primary_key=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    openai_spend_micros: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    perplexity_spend_micros: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    web_search_spend_micros: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    perplexity_degraded: Mapped[bool] = mapped_column(default=False, info={"init_default": False})
    hard_stopped: Mapped[bool] = mapped_column(default=False, info={"init_default": False})
    # Flags are flipped either by an admin from the Controls tab or by the
    # agent layer when a provider returns an insufficient-funds error. The
    # reason is admin-only — users see generic copy.
    perplexity_degrade_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    perplexity_degraded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hard_stop_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hard_stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BudgetConfigChangeLog(Base):
    __tablename__ = "budget_config_change_log"
    __table_args__ = (
        Index(
            "ix_budget_config_change_log_changed_at",
            "changed_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    field: Mapped[str] = mapped_column(String(64))
    old_value: Mapped[int | None] = mapped_column(nullable=True)
    new_value: Mapped[int] = mapped_column(default=0, info={"init_default": 0})
    reason: Mapped[str] = mapped_column(String(500))
    actor_email: Mapped[str] = mapped_column(String(255))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BudgetConfig(Base):
    __tablename__ = "budget_config"

    id: Mapped[int] = mapped_column(default=1, info={"init_default": 1}, primary_key=True)

    # Per-user + unit
    default_monthly_credits: Mapped[int] = mapped_column(default=100, info={"init_default": 100})
    credit_usd_value_micros: Mapped[int] = mapped_column(
        default=10000, info={"init_default": 10000}
    )  # $0.01/credit  # $0.01/credit

    # Pricing — adjust when provider rates change. Per-million-token values are
    # stored as micros so admin edits stay integer-accurate.
    pricing_openai_input_per_mtok_micros: Mapped[int] = mapped_column(
        default=2500000, info={"init_default": 2500000}
    )  # $2.50     # $2.50
    pricing_openai_output_per_mtok_micros: Mapped[int] = mapped_column(
        default=15000000, info={"init_default": 15000000}
    )  # $15.00   # $15.00
    pricing_perplexity_input_per_mtok_micros: Mapped[int] = mapped_column(
        default=1000000, info={"init_default": 1000000}
    )  # $1.00  # $1.00
    pricing_perplexity_output_per_mtok_micros: Mapped[int] = mapped_column(
        default=1000000, info={"init_default": 1000000}
    )  # $1.00  # $1.00
    pricing_perplexity_request_fee_micros: Mapped[int] = mapped_column(
        default=5000, info={"init_default": 5000}
    )  # $0.005         # $0.005
    pricing_web_search_per_call_micros: Mapped[int] = mapped_column(
        default=10000, info={"init_default": 10000}
    )  # $0.01           # $0.01

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
