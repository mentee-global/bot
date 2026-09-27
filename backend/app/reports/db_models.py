from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BugReport(Base):
    """User-submitted bug report. Anonymous visitors can submit too — `user_id`
    is nullable in that case and the form's email/name fields are captured into
    `user_email`/`user_name` directly.

    `email_sent` + `email_error` track whether the SendGrid alert to juan/
    letitia succeeded. Failures don't block the create — the row is the source
    of truth and admins can re-trigger the alert from the UI later.
    """

    __tablename__ = "bug_reports"
    __table_args__ = (
        Index("ix_bug_reports_status_created_at", "status", "created_at"),
        Index("ix_bug_reports_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    # Nullable: anonymous visitors can report bugs from the landing page.
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    user_email: Mapped[str] = mapped_column(String(255))
    user_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str] = mapped_column(String(4000))
    page_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Status / triage
    status: Mapped[str] = mapped_column(String(32), default="new", info={"init_default": "new"})
    priority: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    resolved_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Email alert outcome
    email_sent: Mapped[bool] = mapped_column(default=False, info={"init_default": False})
    email_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CreditRequest(Base):
    """User-submitted request for more credits when their quota is exhausted.

    Always tied to a logged-in user (no anonymous credit asks). Granting flows
    through `BudgetService.grant_credits`, which updates `UserQuota` atomically
    and is the same code path the admin Budget tab already uses.
    """

    __tablename__ = "credit_requests"
    __table_args__ = (
        Index("ix_credit_requests_status_created_at", "status", "created_at"),
        Index("ix_credit_requests_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_email: Mapped[str] = mapped_column(String(255))
    reason: Mapped[str] = mapped_column(String(2000))
    requested_amount: Mapped[int | None] = mapped_column(nullable=True)

    # Status: new → granted | denied. No "in_progress" intermediate — credit
    # decisions are typically a single click.
    status: Mapped[str] = mapped_column(String(32), default="new", info={"init_default": "new"})
    granted_amount: Mapped[int | None] = mapped_column(nullable=True)
    granted_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    # Email alert outcome
    email_sent: Mapped[bool] = mapped_column(default=False, info={"init_default": False})
    email_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
