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

from fastapi import APIRouter, Depends, HTTPException, status
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


# ---------------------------------------------------------------------------
# Routes — reads
# ---------------------------------------------------------------------------


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


_PAGE_SIZE = 25


def _normalize_page(page: int | None) -> int:
    # 1-indexed page param from the client; clamp to >=1 to tolerate junk.
    return max(1, page or 1)


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    sessions: Annotated[SessionStore, Depends(get_session_store)],
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    q: str | None = None,
    role: str | None = None,
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
    q: str | None = None,
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
    q: str | None = None,
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


@router.get("/threads/{thread_id}", response_model=AdminThreadResponse)
async def read_thread(
    thread_id: str,
    service: Annotated[MessageService, Depends(get_message_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> AdminThreadResponse:
    try:
        thread = await service.store.get_any_thread(thread_id)
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
        messages=thread.messages,
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
