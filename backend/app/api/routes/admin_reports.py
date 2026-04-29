"""Admin triage surface for bug reports and credit requests.

All routes are gated by `require_admin` at the router level — non-admins get
404 (not 403) so the surface stays invisible, matching the rest of the admin
API. The grant endpoint flows through `BudgetService.grant_credits`, the
same path the existing Budget admin uses for manual top-ups.
"""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import (
    get_reports_service,
    require_admin,
)
from app.domain.models import User
from app.reports.db_models import BugReport, CreditRequest
from app.reports.schemas import (
    BugReportListResponse,
    BugReportResponse,
    BugReportUpdate,
    CreditRequestDeny,
    CreditRequestGrant,
    CreditRequestListResponse,
    CreditRequestResponse,
)
from app.reports.service import (
    ReportNotFoundError,
    ReportsService,
    ReportStateError,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin",
    tags=["admin-reports"],
    dependencies=[Depends(require_admin)],
)


# ---- Bug reports ------------------------------------------------------------


def _bug_to_response(row: BugReport) -> BugReportResponse:
    return BugReportResponse(
        id=str(row.id),
        user_id=str(row.user_id) if row.user_id else None,
        user_email=row.user_email,
        user_name=row.user_name,
        description=row.description,
        page_url=row.page_url,
        user_agent=row.user_agent,
        status=row.status,  # type: ignore[arg-type]
        priority=row.priority,  # type: ignore[arg-type]
        admin_notes=row.admin_notes,
        resolved_by_email=row.resolved_by_email,
        resolved_at=row.resolved_at,
        email_sent=row.email_sent,
        email_error=row.email_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/bug-reports", response_model=BugReportListResponse)
async def list_bug_reports(
    reports: Annotated[ReportsService, Depends(get_reports_service)],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> BugReportListResponse:
    rows = await reports.list_bug_reports(status=status_filter, limit=limit)
    return BugReportListResponse(reports=[_bug_to_response(r) for r in rows])


@router.get("/bug-reports/{report_id}", response_model=BugReportResponse)
async def get_bug_report(
    report_id: UUID,
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> BugReportResponse:
    try:
        row = await reports.get_bug_report(report_id)
    except ReportNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(err)
        ) from err
    return _bug_to_response(row)


@router.patch("/bug-reports/{report_id}", response_model=BugReportResponse)
async def update_bug_report(
    report_id: UUID,
    payload: BugReportUpdate,
    actor: Annotated[User, Depends(require_admin)],
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> BugReportResponse:
    try:
        row = await reports.update_bug_report(
            report_id,
            actor_email=actor.email,
            status=payload.status,
            priority=payload.priority,
            admin_notes=payload.admin_notes,
        )
    except ReportNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(err)
        ) from err
    logger.warning(
        "admin bug_report_update: actor=%s id=%s status=%s priority=%s",
        actor.email, report_id, payload.status, payload.priority,
    )
    return _bug_to_response(row)


# ---- Credit requests --------------------------------------------------------


async def _credit_to_response(
    row: CreditRequest,
    reports: ReportsService,
) -> CreditRequestResponse:
    balance = await reports.credits_remaining_for(row.user_id)
    return CreditRequestResponse(
        id=str(row.id),
        user_id=str(row.user_id),
        user_email=row.user_email,
        reason=row.reason,
        requested_amount=row.requested_amount,
        status=row.status,  # type: ignore[arg-type]
        granted_amount=row.granted_amount,
        granted_by_email=row.granted_by_email,
        granted_at=row.granted_at,
        admin_notes=row.admin_notes,
        current_credits_remaining=balance,
        email_sent=row.email_sent,
        email_error=row.email_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/credit-requests", response_model=CreditRequestListResponse)
async def list_credit_requests(
    reports: Annotated[ReportsService, Depends(get_reports_service)],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> CreditRequestListResponse:
    rows = await reports.list_credit_requests(status=status_filter, limit=limit)
    # Hydrate balances sequentially — for the admin list this is bounded by
    # `limit` (default 200) and each lookup is a single PK read; not worth
    # the complexity of fanning out concurrently.
    items = [await _credit_to_response(r, reports) for r in rows]
    return CreditRequestListResponse(requests=items)


@router.get(
    "/credit-requests/{request_id}", response_model=CreditRequestResponse
)
async def get_credit_request(
    request_id: UUID,
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> CreditRequestResponse:
    try:
        row = await reports.get_credit_request(request_id)
    except ReportNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(err)
        ) from err
    return await _credit_to_response(row, reports)


@router.post(
    "/credit-requests/{request_id}/grant",
    response_model=CreditRequestResponse,
)
async def grant_credit_request(
    request_id: UUID,
    payload: CreditRequestGrant,
    actor: Annotated[User, Depends(require_admin)],
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> CreditRequestResponse:
    try:
        row = await reports.grant_credit_request(
            request_id,
            amount=payload.amount,
            admin_email=actor.email,
            notes=payload.notes,
        )
    except ReportNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(err)
        ) from err
    except ReportStateError as err:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(err)
        ) from err
    return await _credit_to_response(row, reports)


@router.post(
    "/credit-requests/{request_id}/deny",
    response_model=CreditRequestResponse,
)
async def deny_credit_request(
    request_id: UUID,
    payload: CreditRequestDeny,
    actor: Annotated[User, Depends(require_admin)],
    reports: Annotated[ReportsService, Depends(get_reports_service)],
) -> CreditRequestResponse:
    try:
        row = await reports.deny_credit_request(
            request_id,
            admin_email=actor.email,
            notes=payload.notes,
        )
    except ReportNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(err)
        ) from err
    except ReportStateError as err:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(err)
        ) from err
    return await _credit_to_response(row, reports)
