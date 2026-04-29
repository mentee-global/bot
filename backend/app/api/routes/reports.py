"""User-facing endpoints for submitting bug reports and credit requests.

Bug reports accept anonymous visitors (no session cookie required) — when a
session is present the route ignores any user_email/user_name in the body and
snapshots from the authenticated user instead. Credit requests require a
session because they're tied to a UserQuota row.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import EmailStr

from app.api.deps import (
    get_current_user,
    get_optional_user,
    get_reports_service,
)
from app.domain.models import User
from app.reports.schemas import (
    BugReportCreate,
    CreditRequestCreate,
    ReportCreatedResponse,
)
from app.reports.service import ReportsService

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.post(
    "/bugs",
    response_model=ReportCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_bug_report(
    payload: BugReportCreate,
    request: Request,
    user: Annotated[User | None, Depends(get_optional_user)],
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> ReportCreatedResponse:
    if user is None and not payload.user_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user_email is required when submitting anonymously",
        )

    # Prefer the request's User-Agent header over a client-supplied one — if
    # the body sent a UA at all it's only because we don't always have a
    # plain header (e.g. from a webview wrapper).
    ua = request.headers.get("user-agent") or payload.user_agent

    report = await reports.create_bug_report(
        description=payload.description,
        page_url=payload.page_url,
        user_agent=ua,
        user=user,
        anonymous_email=str(payload.user_email) if payload.user_email else None,
        anonymous_name=payload.user_name,
    )
    return ReportCreatedResponse(
        id=str(report.id),
        status=report.status,
        email_sent=report.email_sent,
    )


# Re-declared to silence ruff: EmailStr is referenced via the schema model so
# the import-time symbol isn't strictly needed here, but keeping it explicit
# matches the existing route style. (This file uses no other re-exports.)
_ = EmailStr


@router.post(
    "/credit-requests",
    response_model=ReportCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_credit_request(
    payload: CreditRequestCreate,
    user: Annotated[User, Depends(get_current_user)],
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> ReportCreatedResponse:
    request_row, _balance = await reports.create_credit_request(
        user=user,
        reason=payload.reason,
        requested_amount=payload.requested_amount,
    )
    return ReportCreatedResponse(
        id=str(request_row.id),
        status=request_row.status,
        email_sent=request_row.email_sent,
    )
