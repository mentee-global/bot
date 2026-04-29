"""Bug-report + credit-request orchestration.

Persists rows to Postgres, fires SendGrid alerts on create, and bridges grant
decisions through `BudgetService.grant_credits` so credit balance updates flow
through the same atomic path the Budget admin tab uses.

Email failures never block the create — the row is the source of truth and
the admin UI surfaces `email_error` so a re-send action can be added later.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.budget.db_models import UserQuota
from app.budget.service import BudgetService
from app.core.config import Settings
from app.db.engine import async_session_factory
from app.domain.models import User
from app.reports.db_models import BugReport, CreditRequest
from app.reports.email import AlertMailer

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


def _as_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


class ReportNotFoundError(Exception):
    pass


class ReportStateError(Exception):
    """Raised when a mutation is invalid for the row's current state — e.g.
    granting an already-granted request."""


class ReportsService:
    def __init__(
        self,
        *,
        budget: BudgetService,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        mailer: AlertMailer | None = None,
    ) -> None:
        self._factory = session_factory or async_session_factory
        self._budget = budget
        self._settings = settings
        self._mailer = mailer or AlertMailer(settings)

    # ---- Bug reports ----------------------------------------------------

    async def create_bug_report(
        self,
        *,
        description: str,
        page_url: str | None,
        user_agent: str | None,
        user: User | None,
        anonymous_email: str | None = None,
        anonymous_name: str | None = None,
    ) -> BugReport:
        """Insert a row + fire the alert. `user` is None for anonymous
        visitors; in that case `anonymous_email` is required (the route does
        the validation)."""
        now = _now()
        if user is not None:
            user_id: UUID | None = _as_uuid(user.id)
            email = user.email
            name = user.name
        else:
            user_id = None
            assert anonymous_email is not None  # validated at route layer
            email = anonymous_email
            name = anonymous_name

        report = BugReport(
            user_id=user_id,
            user_email=email,
            user_name=name,
            description=description,
            page_url=page_url,
            user_agent=user_agent,
            status="new",
            email_sent=False,
            created_at=now,
            updated_at=now,
        )
        async with self._factory() as session:
            session.add(report)
            await session.commit()
            await session.refresh(report)

        logger.info(
            "bug_report_created id=%s user_id=%s email=%s",
            report.id,
            report.user_id,
            report.user_email,
        )

        sent, err = await self._mailer.send_bug_alert(report)
        # Patch the email outcome onto the row. Use a fresh session so the
        # row stays committed even if SendGrid times out.
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(BugReport).where(BugReport.id == report.id)
                )
            ).scalar_one()
            row.email_sent = sent
            row.email_error = err
            row.updated_at = _now()
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def list_bug_reports(
        self, *, status: str | None = None, limit: int = 200
    ) -> list[BugReport]:
        async with self._factory() as session:
            stmt = select(BugReport).order_by(desc(BugReport.created_at)).limit(limit)
            if status is not None:
                stmt = stmt.where(BugReport.status == status)
            rows = (await session.execute(stmt)).scalars().all()
            return list(rows)

    async def get_bug_report(self, report_id: UUID) -> BugReport:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(BugReport).where(BugReport.id == report_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"bug report {report_id} not found")
            return row

    async def update_bug_report(
        self,
        report_id: UUID,
        *,
        actor_email: str,
        status: str | None = None,
        priority: str | None = None,
        admin_notes: str | None = None,
    ) -> BugReport:
        """Partial update. When status flips to `resolved` we stamp resolver
        info; flipping it back to non-resolved clears those fields so the row
        accurately reflects current state."""
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(BugReport).where(BugReport.id == report_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"bug report {report_id} not found")
            now = _now()
            if status is not None and status != row.status:
                row.status = status
                if status == "resolved":
                    row.resolved_by_email = actor_email
                    row.resolved_at = now
                else:
                    row.resolved_by_email = None
                    row.resolved_at = None
            if priority is not None:
                row.priority = priority
            if admin_notes is not None:
                row.admin_notes = admin_notes
            row.updated_at = now
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    # ---- Credit requests ------------------------------------------------

    async def create_credit_request(
        self,
        *,
        user: User,
        reason: str,
        requested_amount: int | None,
    ) -> tuple[CreditRequest, int | None]:
        """Insert + fire alert. Returns (row, current_credits_remaining) so the
        admin alert can include the user's balance without a second round-trip.
        """
        now = _now()
        # Snapshot the balance for the email body. get_user_snapshot also
        # materialises the quota row if it doesn't exist yet.
        snap = await self._budget.get_user_snapshot(user)
        request = CreditRequest(
            user_id=_as_uuid(user.id),
            user_email=user.email,
            reason=reason,
            requested_amount=requested_amount,
            status="new",
            email_sent=False,
            created_at=now,
            updated_at=now,
        )
        async with self._factory() as session:
            session.add(request)
            await session.commit()
            await session.refresh(request)

        logger.info(
            "credit_request_created id=%s user_id=%s requested=%s",
            request.id,
            request.user_id,
            request.requested_amount,
        )

        sent, err = await self._mailer.send_credit_request_alert(
            request, credits_remaining=snap.credits_remaining
        )
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request.id)
                )
            ).scalar_one()
            row.email_sent = sent
            row.email_error = err
            row.updated_at = _now()
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row, snap.credits_remaining

    async def list_credit_requests(
        self, *, status: str | None = None, limit: int = 200
    ) -> list[CreditRequest]:
        async with self._factory() as session:
            stmt = (
                select(CreditRequest)
                .order_by(desc(CreditRequest.created_at))
                .limit(limit)
            )
            if status is not None:
                stmt = stmt.where(CreditRequest.status == status)
            rows = (await session.execute(stmt)).scalars().all()
            return list(rows)

    async def get_credit_request(self, request_id: UUID) -> CreditRequest:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"credit request {request_id} not found")
            return row

    async def grant_credit_request(
        self,
        request_id: UUID,
        *,
        amount: int,
        admin_email: str,
        notes: str | None = None,
    ) -> CreditRequest:
        """Bump UserQuota.credits_remaining via BudgetService.grant_credits and
        flip the request to `granted`. Rejects if the request isn't `new`."""
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"credit request {request_id} not found")
            if row.status != "new":
                raise ReportStateError(
                    f"credit request is {row.status}, not new"
                )

        # Run the credit grant outside the row's session so the budget
        # service uses its own transaction. If grant_credits raises (bad UUID,
        # etc.), the request stays `new` and the admin can retry.
        await self._budget.grant_credits(
            row.user_id,
            amount,
            reason=f"credit_request:{row.id} (admin {admin_email})",
        )

        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request_id)
                )
            ).scalar_one()
            now = _now()
            row.status = "granted"
            row.granted_amount = amount
            row.granted_by_email = admin_email
            row.granted_at = now
            if notes is not None:
                row.admin_notes = notes
            row.updated_at = now
            session.add(row)
            await session.commit()
            await session.refresh(row)

        logger.warning(
            "credit_request_granted id=%s user_id=%s amount=%d admin=%s",
            row.id,
            row.user_id,
            amount,
            admin_email,
        )
        return row

    async def deny_credit_request(
        self,
        request_id: UUID,
        *,
        admin_email: str,
        notes: str | None = None,
    ) -> CreditRequest:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"credit request {request_id} not found")
            if row.status != "new":
                raise ReportStateError(f"credit request is {row.status}, not new")
            now = _now()
            row.status = "denied"
            row.granted_by_email = admin_email
            row.granted_at = now
            if notes is not None:
                row.admin_notes = notes
            row.updated_at = now
            session.add(row)
            await session.commit()
            await session.refresh(row)
        logger.warning(
            "credit_request_denied id=%s user_id=%s admin=%s",
            row.id,
            row.user_id,
            admin_email,
        )
        return row

    async def update_credit_request_notes(
        self,
        request_id: UUID,
        *,
        admin_notes: str,
    ) -> CreditRequest:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(CreditRequest).where(CreditRequest.id == request_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ReportNotFoundError(f"credit request {request_id} not found")
            row.admin_notes = admin_notes
            row.updated_at = _now()
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    # ---- Helpers --------------------------------------------------------

    async def credits_remaining_for(self, user_id: UUID) -> int | None:
        """Direct read of the user's remaining credits — used for hydrating
        admin list rows without re-running the full snapshot path."""
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(UserQuota).where(UserQuota.user_id == user_id)
                )
            ).scalar_one_or_none()
            return row.credits_remaining if row is not None else None
