from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class BugReport(SQLModel, table=True):
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

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    # Nullable: anonymous visitors can report bugs from the landing page.
    user_id: UUID | None = Field(
        default=None,
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="SET NULL",
    )
    user_email: str = Field(max_length=255)
    user_name: str | None = Field(default=None, max_length=255)
    description: str = Field(max_length=4000)
    page_url: str | None = Field(default=None, max_length=1024)
    user_agent: str | None = Field(default=None, max_length=512)

    # Status / triage
    status: str = Field(default="new", max_length=32)
    priority: str | None = Field(default=None, max_length=32)
    admin_notes: str | None = Field(default=None, max_length=2000)
    resolved_by_email: str | None = Field(default=None, max_length=255)
    resolved_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )

    # Email alert outcome
    email_sent: bool = Field(default=False)
    email_error: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class CreditRequest(SQLModel, table=True):
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
    user_email: str = Field(max_length=255)
    reason: str = Field(max_length=2000)
    requested_amount: int | None = Field(default=None)

    # Status: new → granted | denied. No "in_progress" intermediate — credit
    # decisions are typically a single click.
    status: str = Field(default="new", max_length=32)
    granted_amount: int | None = Field(default=None)
    granted_by_email: str | None = Field(default=None, max_length=255)
    granted_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    admin_notes: str | None = Field(default=None, max_length=2000)

    # Email alert outcome
    email_sent: bool = Field(default=False)
    email_error: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))
