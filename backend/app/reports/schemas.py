"""Pydantic shapes for report routes."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# ----- Status / priority enums (string-typed at the DB layer for portability)


BugStatus = Literal["new", "in_progress", "resolved", "closed"]
BugPriority = Literal["low", "medium", "high", "critical"]
CreditRequestStatus = Literal["new", "granted", "denied"]


# ----- User-facing create payloads ------------------------------------------


class BugReportCreate(BaseModel):
    """User-facing payload for submitting a bug report.

    `user_email` / `user_name` are only used for anonymous submissions. When a
    session cookie is present the route ignores them and snapshots from the
    authenticated User instead.
    """

    description: str = Field(min_length=1, max_length=4000)
    page_url: str | None = Field(default=None, max_length=1024)
    user_agent: str | None = Field(default=None, max_length=512)
    # Anonymous-only: the route requires email when no session cookie is
    # present. Name is optional for anon.
    user_email: EmailStr | None = None
    user_name: str | None = Field(default=None, max_length=255)


class CreditRequestCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    requested_amount: int | None = Field(default=None, ge=1, le=100_000)


class ReportCreatedResponse(BaseModel):
    id: str
    status: str
    email_sent: bool


# ----- Admin response shapes ------------------------------------------------


class BugReportResponse(BaseModel):
    id: str
    user_id: str | None
    user_email: str
    user_name: str | None
    description: str
    page_url: str | None
    user_agent: str | None
    status: BugStatus
    priority: BugPriority | None
    admin_notes: str | None
    resolved_by_email: str | None
    resolved_at: datetime | None
    email_sent: bool
    email_error: str | None
    created_at: datetime
    updated_at: datetime


class BugReportListResponse(BaseModel):
    reports: list[BugReportResponse]


class CreditRequestResponse(BaseModel):
    id: str
    user_id: str
    user_email: str
    reason: str
    requested_amount: int | None
    status: CreditRequestStatus
    granted_amount: int | None
    granted_by_email: str | None
    granted_at: datetime | None
    admin_notes: str | None
    # Snapshot of the user's current credit balance — populated from
    # UserQuota at read time so admins can size grants without leaving
    # the row.
    current_credits_remaining: int | None
    email_sent: bool
    email_error: str | None
    created_at: datetime
    updated_at: datetime


class CreditRequestListResponse(BaseModel):
    requests: list[CreditRequestResponse]


# ----- Admin mutations -------------------------------------------------------


class BugReportUpdate(BaseModel):
    """Partial admin update. Status flip to `resolved` auto-stamps the
    `resolved_by_email` / `resolved_at` columns server-side."""

    status: BugStatus | None = None
    priority: BugPriority | None = None
    admin_notes: str | None = Field(default=None, max_length=2000)


class CreditRequestGrant(BaseModel):
    amount: int = Field(ge=1, le=100_000)
    notes: str | None = Field(default=None, max_length=2000)


class CreditRequestDeny(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)
