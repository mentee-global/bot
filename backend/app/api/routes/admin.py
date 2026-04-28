"""Admin inspection + mutation API.

Gates on `require_admin` (see `app/api/deps.py`), which checks the session's
`role == "admin"` claim received from Mentee's OIDC userinfo. Non-admins get
404 so the surface is invisible.

Two mutation surfaces (v1.1): delete any thread, force-logout a user by
wiping their session rows. Both logged at WARNING with acting admin + target
so audit is greppable.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import (
    get_budget_service,
    get_message_service,
    get_session_store,
    require_admin,
)
from app.auth.db_models import UserRecord
from app.auth.session_store import SessionStore
from app.budget.db_models import MessageUsage
from app.budget.service import BudgetService
from app.db.engine import async_session_factory
from app.domain.models import Message, User
from app.services.db_models import MessageRecord, ThreadRecord
from app.services.message_service import MessageService
from app.services.thread_store import ThreadNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AdminUserSummary(BaseModel):
    user_id: str
    mentee_sub: str
    email: str
    name: str
    role: str
    role_id: int
    picture: str | None = None
    last_used_at: datetime | None = None
    created_at: datetime
    credits_remaining: int | None = None
    credits_used_period: int | None = None
    credits_granted_period: int | None = None
    cost_period_micros: int | None = None


class AdminUserListResponse(BaseModel):
    users: list[AdminUserSummary]
    total: int
    page: int
    page_size: int


class AdminThreadSummary(BaseModel):
    thread_id: str
    title: str | None = None
    user_id: str
    owner_email: str | None = None
    owner_name: str | None = None
    message_count: int
    created_at: datetime
    updated_at: datetime


class AdminThreadListResponse(BaseModel):
    threads: list[AdminThreadSummary]
    total: int
    page: int
    page_size: int


class AdminThreadResponse(BaseModel):
    thread_id: str
    title: str | None = None
    user_id: str
    owner_email: str | None = None
    owner_name: str | None = None
    created_at: datetime
    updated_at: datetime
    messages: list[Message]
    # Counts span the whole thread, not just the current page — the per-thread
    # admin view paginates messages so the client can't compute these locally.
    total_messages: int
    user_message_count: int
    assistant_message_count: int
    # `page`/`page_size` are null on the export endpoint (returns all
    # messages); set on the paginated view endpoint.
    page: int | None = None
    page_size: int | None = None


class AdminStatsResponse(BaseModel):
    users: int
    threads: int
    messages: int
    messages_24h: int


class AdminSessionRow(BaseModel):
    session_id_prefix: str
    created_at: datetime
    last_used_at: datetime
    access_token_expires_at: datetime


class AdminUserSessionsResponse(BaseModel):
    user_id: str
    session_count: int
    first_seen: datetime | None
    last_active: datetime | None
    recent_sessions: list[AdminSessionRow]


class AdminForceLogoutResponse(BaseModel):
    sessions_deleted: int


class AdminMetricsPoint(BaseModel):
    date: str  # ISO date "YYYY-MM-DD" (UTC)
    users: int
    threads: int
    messages: int


class AdminMetricsCostPoint(BaseModel):
    date: str
    cost_usd_micros: int
    input_tokens: int
    output_tokens: int
    requests: int


class AdminMetricsHourPoint(BaseModel):
    hour: int  # 0..23 UTC
    messages: int


class AdminMetricsRoleSlice(BaseModel):
    role: str  # "user" | "assistant"
    messages: int


class AdminMetricsModelSlice(BaseModel):
    model: str  # "openai" | "perplexity" | "web_search"
    requests: int
    input_tokens: int
    output_tokens: int
    cost_usd_micros: int


class AdminMetricsTopUser(BaseModel):
    user_id: str
    name: str
    email: str
    role: str
    messages: int


class AdminMetricsThreadLengthBucket(BaseModel):
    label: str  # "1", "2–3", "4–7", "8–15", "16+"
    threads: int


class AdminMetricsResponse(BaseModel):
    range_days: int
    series: list[AdminMetricsPoint]
    cost_series: list[AdminMetricsCostPoint]
    hour_of_day: list[AdminMetricsHourPoint]
    role_breakdown: list[AdminMetricsRoleSlice]
    model_breakdown: list[AdminMetricsModelSlice]
    top_users: list[AdminMetricsTopUser]
    thread_length_distribution: list[AdminMetricsThreadLengthBucket]
    totals: AdminStatsResponse
    new_users_period: int
    new_threads_period: int
    new_messages_period: int
    active_users_period: int
    avg_messages_per_thread: float
    cost_period_usd_micros: int
    input_tokens_period: int
    output_tokens_period: int
    requests_period: int


# ---------------------------------------------------------------------------
# Routes — reads
# ---------------------------------------------------------------------------


@router.get("/persona/schema")
async def get_persona_schema() -> dict[str, object]:
    """JSON Schema of the chat persona override payload.

    Used by the admin "Test persona" form to render itself: the form is
    pinned to whatever fields `ChatPersona` (and the embedded `MenteeProfile`)
    expose, so adding a field to either model surfaces in the form on next
    page load — no frontend change required.
    """
    from app.api.routes.chat import ChatPersona

    return ChatPersona.model_json_schema()


@router.get("/stats", response_model=AdminStatsResponse)
async def get_stats() -> AdminStatsResponse:
    """Four platform-wide counts. Issued concurrently for latency."""
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    users, threads, messages, messages_24h = await asyncio.gather(
        _scalar(select(func.count()).select_from(UserRecord)),
        _scalar(select(func.count()).select_from(ThreadRecord)),
        _scalar(select(func.count()).select_from(MessageRecord)),
        _scalar(
            select(func.count())
            .select_from(MessageRecord)
            .where(MessageRecord.created_at >= cutoff)
        ),
    )
    return AdminStatsResponse(
        users=users,
        threads=threads,
        messages=messages,
        messages_24h=messages_24h,
    )


_METRICS_MIN_DAYS = 1
_METRICS_MAX_DAYS = 365
_METRICS_DEFAULT_DAYS = 30


@router.get("/metrics", response_model=AdminMetricsResponse)
async def get_metrics(
    days: Annotated[
        int | None, Query(ge=_METRICS_MIN_DAYS, le=_METRICS_MAX_DAYS)
    ] = None,
    date_from: Annotated[
        str | None,
        Query(
            alias="from",
            min_length=10,
            max_length=10,
            pattern=r"^\d{4}-\d{2}-\d{2}$",
        ),
    ] = None,
    date_to: Annotated[
        str | None,
        Query(
            alias="to",
            min_length=10,
            max_length=10,
            pattern=r"^\d{4}-\d{2}-\d{2}$",
        ),
    ] = None,
) -> AdminMetricsResponse:
    """Daily time-series for a UTC date window, plus aggregates.

    Two ways to select the window: `?days=N` for the last N UTC days
    (inclusive of today), or `?from=YYYY-MM-DD&to=YYYY-MM-DD` for an
    explicit range. `from`/`to` win when both are present.
    """
    now = datetime.now(UTC)
    today = datetime(now.year, now.month, now.day, tzinfo=UTC)

    if date_from and date_to:
        try:
            start = datetime.fromisoformat(date_from).replace(tzinfo=UTC)
            to_day = datetime.fromisoformat(date_to).replace(tzinfo=UTC)
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format; expected YYYY-MM-DD.",
            ) from err
        if start > to_day:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="`from` must be on or before `to`.",
            )
        days = (to_day - start).days + 1
        if days > _METRICS_MAX_DAYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Range too large; max {_METRICS_MAX_DAYS} days.",
            )
        end_exclusive = to_day + timedelta(days=1)
    else:
        days = days or _METRICS_DEFAULT_DAYS
        start = today - timedelta(days=days - 1)
        end_exclusive = today + timedelta(days=1)

    user_day = func.date_trunc("day", UserRecord.created_at)
    thread_day = func.date_trunc("day", ThreadRecord.created_at)
    message_day = func.date_trunc("day", MessageRecord.created_at)
    usage_day = func.date_trunc("day", MessageUsage.created_at)
    # `extract('hour', tz_aware_ts)` is session-tz dependent — pin to UTC so
    # the hour buckets line up with how `created_at` was stored.
    message_hour = func.extract(
        "hour", func.timezone("UTC", MessageRecord.created_at)
    )

    user_stmt = (
        select(user_day.label("d"), func.count())
        .where(
            UserRecord.created_at >= start,
            UserRecord.created_at < end_exclusive,
        )
        .group_by(user_day)
    )
    thread_stmt = (
        select(thread_day.label("d"), func.count())
        .where(
            ThreadRecord.created_at >= start,
            ThreadRecord.created_at < end_exclusive,
        )
        .group_by(thread_day)
    )
    message_stmt = (
        select(message_day.label("d"), func.count())
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
        .group_by(message_day)
    )
    cost_stmt = (
        select(
            usage_day.label("d"),
            func.coalesce(func.sum(MessageUsage.cost_usd_micros), 0),
            func.coalesce(func.sum(MessageUsage.input_tokens), 0),
            func.coalesce(func.sum(MessageUsage.output_tokens), 0),
            func.coalesce(func.sum(MessageUsage.request_count), 0),
        )
        .where(
            MessageUsage.created_at >= start,
            MessageUsage.created_at < end_exclusive,
        )
        .group_by(usage_day)
    )
    hour_stmt = (
        select(message_hour.label("h"), func.count())
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
        .group_by(message_hour)
    )
    role_stmt = (
        select(MessageRecord.role, func.count())
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
        .group_by(MessageRecord.role)
    )
    model_stmt = (
        select(
            MessageUsage.model,
            func.coalesce(func.sum(MessageUsage.request_count), 0),
            func.coalesce(func.sum(MessageUsage.input_tokens), 0),
            func.coalesce(func.sum(MessageUsage.output_tokens), 0),
            func.coalesce(func.sum(MessageUsage.cost_usd_micros), 0),
        )
        .where(
            MessageUsage.created_at >= start,
            MessageUsage.created_at < end_exclusive,
        )
        .group_by(MessageUsage.model)
    )
    # Top users by message count over the period — JOIN through threads since
    # MessageRecord doesn't have user_id directly.
    user_message_count = func.count(MessageRecord.id).label("messages")
    top_users_stmt = (
        select(
            UserRecord.id,
            UserRecord.name,
            UserRecord.email,
            UserRecord.role,
            user_message_count,
        )
        .select_from(UserRecord)
        .join(ThreadRecord, ThreadRecord.user_id == UserRecord.id)
        .join(MessageRecord, MessageRecord.thread_id == ThreadRecord.id)
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
        .group_by(UserRecord.id, UserRecord.name, UserRecord.email, UserRecord.role)
        .order_by(user_message_count.desc())
        .limit(10)
    )
    # Thread length distribution: count messages per thread for threads that
    # had any activity in the window. Bucket in Python (only as many rows as
    # active threads, which scales with the period — a few hundred at most).
    thread_lengths_stmt = (
        select(MessageRecord.thread_id, func.count())
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
        .group_by(MessageRecord.thread_id)
    )

    totals_users = select(func.count()).select_from(UserRecord)
    totals_threads = select(func.count()).select_from(ThreadRecord)
    totals_messages = select(func.count()).select_from(MessageRecord)
    totals_messages_24h = (
        select(func.count())
        .select_from(MessageRecord)
        .where(MessageRecord.created_at >= now - timedelta(hours=24))
    )
    active_users_stmt = (
        select(func.count(func.distinct(ThreadRecord.user_id)))
        .select_from(ThreadRecord)
        .join(MessageRecord, MessageRecord.thread_id == ThreadRecord.id)
        .where(
            MessageRecord.created_at >= start,
            MessageRecord.created_at < end_exclusive,
        )
    )

    # Each query runs on its own session — async SQLAlchemy sessions are not
    # safe for concurrent `execute()` calls (raises IllegalStateChangeError),
    # so we mirror the `_scalar` helper's one-session-per-query pattern and
    # fan out via asyncio.gather across separate connections.
    async def _rows(stmt) -> list[tuple]:  # type: ignore[no-untyped-def]
        async with async_session_factory() as session:
            result = await session.execute(stmt)
            return list(result.all())

    (
        user_rows,
        thread_rows,
        message_rows,
        cost_rows,
        hour_rows,
        role_rows,
        model_rows,
        top_user_rows,
        thread_length_rows,
        users_total_n,
        threads_total_n,
        messages_total_n,
        messages_24h_n,
        active_users_n,
    ) = await asyncio.gather(
        _rows(user_stmt),
        _rows(thread_stmt),
        _rows(message_stmt),
        _rows(cost_stmt),
        _rows(hour_stmt),
        _rows(role_stmt),
        _rows(model_stmt),
        _rows(top_users_stmt),
        _rows(thread_lengths_stmt),
        _scalar(totals_users),
        _scalar(totals_threads),
        _scalar(totals_messages),
        _scalar(totals_messages_24h),
        _scalar(active_users_stmt),
    )

    user_buckets = {_bucket_key(d): int(n or 0) for d, n in user_rows}
    thread_buckets = {_bucket_key(d): int(n or 0) for d, n in thread_rows}
    message_buckets = {_bucket_key(d): int(n or 0) for d, n in message_rows}
    cost_buckets: dict[str, tuple[int, int, int, int]] = {
        _bucket_key(d): (
            int(cost or 0),
            int(in_tok or 0),
            int(out_tok or 0),
            int(req or 0),
        )
        for d, cost, in_tok, out_tok, req in cost_rows
    }
    # Hour buckets — Postgres extract returns a Decimal; coerce to int 0..23.
    hour_buckets: dict[int, int] = {
        int(h): int(n or 0) for h, n in hour_rows if h is not None
    }

    series: list[AdminMetricsPoint] = []
    new_users = 0
    new_threads = 0
    new_messages = 0
    for i in range(days):
        day = start + timedelta(days=i)
        key = day.strftime("%Y-%m-%d")
        u = user_buckets.get(key, 0)
        t = thread_buckets.get(key, 0)
        m = message_buckets.get(key, 0)
        new_users += u
        new_threads += t
        new_messages += m
        series.append(
            AdminMetricsPoint(date=key, users=u, threads=t, messages=m)
        )

    cost_series: list[AdminMetricsCostPoint] = []
    cost_period = 0
    in_tok_period = 0
    out_tok_period = 0
    req_period = 0
    for i in range(days):
        day = start + timedelta(days=i)
        key = day.strftime("%Y-%m-%d")
        cost, in_tok, out_tok, req = cost_buckets.get(key, (0, 0, 0, 0))
        cost_period += cost
        in_tok_period += in_tok
        out_tok_period += out_tok
        req_period += req
        cost_series.append(
            AdminMetricsCostPoint(
                date=key,
                cost_usd_micros=cost,
                input_tokens=in_tok,
                output_tokens=out_tok,
                requests=req,
            )
        )

    hour_of_day = [
        AdminMetricsHourPoint(hour=h, messages=hour_buckets.get(h, 0))
        for h in range(24)
    ]

    role_breakdown = [
        AdminMetricsRoleSlice(role=str(role), messages=int(n or 0))
        for role, n in role_rows
    ]
    model_breakdown = [
        AdminMetricsModelSlice(
            model=str(model),
            requests=int(req or 0),
            input_tokens=int(in_tok or 0),
            output_tokens=int(out_tok or 0),
            cost_usd_micros=int(cost or 0),
        )
        for model, req, in_tok, out_tok, cost in model_rows
    ]
    top_users = [
        AdminMetricsTopUser(
            user_id=str(uid),
            name=name,
            email=email,
            role=role,
            messages=int(messages or 0),
        )
        for uid, name, email, role, messages in top_user_rows
    ]
    thread_length_distribution = _bucket_thread_lengths(
        [int(n or 0) for _, n in thread_length_rows]
    )

    avg = (
        round(messages_total_n / threads_total_n, 2)
        if threads_total_n
        else 0.0
    )

    return AdminMetricsResponse(
        range_days=days,
        series=series,
        cost_series=cost_series,
        hour_of_day=hour_of_day,
        role_breakdown=role_breakdown,
        model_breakdown=model_breakdown,
        top_users=top_users,
        thread_length_distribution=thread_length_distribution,
        totals=AdminStatsResponse(
            users=users_total_n,
            threads=threads_total_n,
            messages=messages_total_n,
            messages_24h=messages_24h_n,
        ),
        new_users_period=new_users,
        new_threads_period=new_threads,
        new_messages_period=new_messages,
        active_users_period=active_users_n,
        avg_messages_per_thread=avg,
        cost_period_usd_micros=cost_period,
        input_tokens_period=in_tok_period,
        output_tokens_period=out_tok_period,
        requests_period=req_period,
    )


# Bucket edges as (max_inclusive, label). The last bucket is open-ended, so
# its max is sentinel `None`. Keep this in sync with the en-dash labels the
# frontend renders verbatim — the frontend pairs them with i18n strings.
_THREAD_LENGTH_BUCKETS: list[tuple[int | None, str]] = [
    (1, "1"),
    (3, "2–3"),
    (7, "4–7"),
    (15, "8–15"),
    (None, "16+"),
]


def _bucket_thread_lengths(
    counts: list[int],
) -> list[AdminMetricsThreadLengthBucket]:
    out = [
        AdminMetricsThreadLengthBucket(label=label, threads=0)
        for _, label in _THREAD_LENGTH_BUCKETS
    ]
    for n in counts:
        for idx, (cap, _) in enumerate(_THREAD_LENGTH_BUCKETS):
            if cap is None or n <= cap:
                out[idx].threads += 1
                break
    return out


def _bucket_key(value: object) -> str:
    # `date_trunc('day', ...)` returns a tz-aware datetime in Postgres; format
    # to a stable ISO date string for dict lookup.
    if isinstance(value, datetime):
        return value.astimezone(UTC).strftime("%Y-%m-%d")
    return str(value)[:10]


_PAGE_SIZE = 25


def _normalize_page(page: int | None) -> int:
    # 1-indexed page param from the client; clamp to >=1 to tolerate junk.
    return max(1, page or 1)


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    q: Annotated[str | None, Query(max_length=128)] = None,
    role: Annotated[str | None, Query(max_length=64)] = None,
    page: int | None = None,
) -> AdminUserListResponse:
    page = _normalize_page(page)
    offset = (page - 1) * _PAGE_SIZE
    query = (q or "").strip() or None
    role_filter = (role or "").strip() or None
    rows, total = await asyncio.gather(
        sessions.list_users(
            limit=_PAGE_SIZE, offset=offset, role=role_filter, query=query
        ),
        sessions.count_users(role=role_filter, query=query),
    )
    quotas = await budget.list_user_quotas([user.id for user, _ in rows])
    return AdminUserListResponse(
        users=[
            _user_summary(user, last_used_at, quotas.get(user.id))
            for user, last_used_at in rows
        ],
        total=total,
        page=page,
        page_size=_PAGE_SIZE,
    )


@router.get(
    "/users/{user_id}/threads", response_model=AdminThreadListResponse
)
async def list_user_threads(
    user_id: UUID,
    service: Annotated[MessageService, Depends(get_message_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    q: Annotated[str | None, Query(max_length=128)] = None,
    page: int | None = None,
) -> AdminThreadListResponse:
    page = _normalize_page(page)
    offset = (page - 1) * _PAGE_SIZE
    query = (q or "").strip() or None
    uid_str = str(user_id)
    threads, total = await asyncio.gather(
        service.store.list_threads(
            uid_str, query=query, limit=_PAGE_SIZE, offset=offset
        ),
        service.store.count_threads(uid_str, query=query),
    )
    counts = await service.store.count_messages_for_threads(
        [t.id for t in threads]
    )
    owners = await _resolve_owners(sessions, [t.user_id for t in threads])
    return AdminThreadListResponse(
        threads=[_thread_summary(t, counts, owners) for t in threads],
        total=total,
        page=page,
        page_size=_PAGE_SIZE,
    )


@router.get(
    "/users/{user_id}/sessions",
    response_model=AdminUserSessionsResponse,
)
async def get_user_sessions(
    user_id: UUID,
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> AdminUserSessionsResponse:
    rows = await sessions.list_sessions_for_user(user_id, limit=10)
    return AdminUserSessionsResponse(
        user_id=str(user_id),
        session_count=len(rows),
        first_seen=min((r.created_at for r in rows), default=None),
        last_active=max((r.last_used_at for r in rows), default=None),
        recent_sessions=[
            AdminSessionRow(
                session_id_prefix=r.session_id[:8],
                created_at=r.created_at,
                last_used_at=r.last_used_at,
                access_token_expires_at=r.access_token_expires_at,
            )
            for r in rows
        ],
    )


@router.get("/threads", response_model=AdminThreadListResponse)
async def list_all_threads(
    service: Annotated[MessageService, Depends(get_message_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    q: Annotated[str | None, Query(max_length=128)] = None,
    page: int | None = None,
) -> AdminThreadListResponse:
    page = _normalize_page(page)
    offset = (page - 1) * _PAGE_SIZE
    query = (q or "").strip() or None
    threads, total = await asyncio.gather(
        service.store.list_all_threads(
            query=query, limit=_PAGE_SIZE, offset=offset
        ),
        service.store.count_all_threads(query=query),
    )
    counts = await service.store.count_messages_for_threads(
        [t.id for t in threads]
    )
    owners = await _resolve_owners(sessions, [t.user_id for t in threads])
    return AdminThreadListResponse(
        threads=[_thread_summary(t, counts, owners) for t in threads],
        total=total,
        page=page,
        page_size=_PAGE_SIZE,
    )


_THREAD_MESSAGE_PAGE_SIZE = 50


@router.get("/threads/{thread_id}", response_model=AdminThreadResponse)
async def read_thread(
    thread_id: str,
    service: Annotated[MessageService, Depends(get_message_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    page: Annotated[int | None, Query(ge=1)] = None,
) -> AdminThreadResponse:
    """Per-thread admin read with paginated messages. A thread can grow into
    the thousands of turns, so pagination is mandatory here — `/export` below
    is the escape hatch for an admin who genuinely needs the whole transcript.
    """
    page_num = max(1, page or 1)
    offset = (page_num - 1) * _THREAD_MESSAGE_PAGE_SIZE
    try:
        thread = await service.store.get_any_thread_summary(thread_id)
        messages, total, role_counts = (
            await service.store.get_any_thread_messages_page(
                thread_id, limit=_THREAD_MESSAGE_PAGE_SIZE, offset=offset
            )
        )
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err
    owners = await _resolve_owners(sessions, [thread.user_id])
    owner = owners.get(thread.user_id)
    return AdminThreadResponse(
        thread_id=thread.id,
        title=thread.title,
        user_id=thread.user_id,
        owner_email=owner[0] if owner else None,
        owner_name=owner[1] if owner else None,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        messages=messages,
        total_messages=total,
        user_message_count=role_counts.get("user", 0),
        assistant_message_count=role_counts.get("assistant", 0),
        page=page_num,
        page_size=_THREAD_MESSAGE_PAGE_SIZE,
    )


@router.get(
    "/threads/{thread_id}/export", response_model=AdminThreadResponse
)
async def export_thread(
    thread_id: str,
    service: Annotated[MessageService, Depends(get_message_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> AdminThreadResponse:
    """Full transcript dump used by the JSON export button. Bypasses
    pagination on purpose — admin opt-in via an explicit click."""
    try:
        thread = await service.store.get_any_thread(thread_id)
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err
    owners = await _resolve_owners(sessions, [thread.user_id])
    owner = owners.get(thread.user_id)
    role_counts: dict[str, int] = {}
    for msg in thread.messages:
        key = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        role_counts[key] = role_counts.get(key, 0) + 1
    return AdminThreadResponse(
        thread_id=thread.id,
        title=thread.title,
        user_id=thread.user_id,
        owner_email=owner[0] if owner else None,
        owner_name=owner[1] if owner else None,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        messages=thread.messages,
        total_messages=len(thread.messages),
        user_message_count=role_counts.get("user", 0),
        assistant_message_count=role_counts.get("assistant", 0),
        page=None,
        page_size=None,
    )


# ---------------------------------------------------------------------------
# Routes — mutations
# ---------------------------------------------------------------------------


@router.delete(
    "/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_thread(
    thread_id: str,
    service: Annotated[MessageService, Depends(get_message_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> None:
    try:
        await service.store.delete_any_thread(thread_id)
    except ThreadNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found"
        ) from err
    logger.warning(
        "admin delete_thread: actor=%s thread_id=%s", actor.email, thread_id
    )


@router.post(
    "/users/{user_id}/force-logout",
    response_model=AdminForceLogoutResponse,
)
async def force_logout(
    user_id: UUID,
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    actor: Annotated[User, Depends(require_admin)],
) -> AdminForceLogoutResponse:
    deleted = await sessions.delete_all_for_user(user_id)
    logger.warning(
        "admin force_logout: actor=%s target=%s sessions_deleted=%d",
        actor.email,
        user_id,
        deleted,
    )
    return AdminForceLogoutResponse(sessions_deleted=deleted)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _scalar(stmt) -> int:  # type: ignore[no-untyped-def]
    async with async_session_factory() as session:
        result = await session.execute(stmt)
        return int(result.scalar_one() or 0)


def _user_summary(
    user: UserRecord, last_used_at: datetime | None, quota=None  # type: ignore[no-untyped-def]
) -> AdminUserSummary:
    return AdminUserSummary(
        user_id=str(user.id),
        mentee_sub=user.mentee_sub,
        email=user.email,
        name=user.name,
        role=user.role,
        role_id=user.role_id,
        picture=user.picture,
        last_used_at=last_used_at,
        created_at=user.created_at,
        credits_remaining=quota.credits_remaining if quota else None,
        credits_used_period=quota.credits_used_period if quota else None,
        credits_granted_period=quota.credits_granted_period if quota else None,
        cost_period_micros=None,  # available on the detail endpoint to avoid N+1.
    )


def _thread_summary(  # type: ignore[no-untyped-def]
    thread,
    counts: dict[str, int],
    owners: dict[str, tuple[str | None, str | None]],
) -> AdminThreadSummary:
    owner = owners.get(thread.user_id, (None, None))
    return AdminThreadSummary(
        thread_id=thread.id,
        title=thread.title,
        user_id=thread.user_id,
        owner_email=owner[0],
        owner_name=owner[1],
        message_count=counts.get(thread.id, 0),
        created_at=thread.created_at,
        updated_at=thread.updated_at,
    )


async def _resolve_owners(
    sessions: SessionStore, user_ids: list[str]
) -> dict[str, tuple[str | None, str | None]]:
    """Return `user_id (str) -> (email, name)` for the given ids. Missing ids
    are omitted; callers should treat them as unknown."""
    unique_strs = list({uid for uid in user_ids if uid})
    if not unique_strs:
        return {}
    uuids = [UUID(uid) for uid in unique_strs]
    resolved = await sessions.get_identities(uuids)
    return {str(uid): identity for uid, identity in resolved.items()}
