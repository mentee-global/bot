"""Postgres-backed ThreadStore.

Threads are owned by the internal `users.id` UUID so conversations persist
across logout / login. Lookup is always gated by `user_id` so one user can't
read another's chats.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.db_models import UserRecord
from app.db.engine import async_session_factory
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread
from app.services.db_models import MessageRecord, ThreadRecord
from app.services.thread_store import ThreadNotFoundError, ThreadStore


def _now() -> datetime:
    return datetime.now(UTC)


def _as_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _thread_from_record(
    row: ThreadRecord, messages: list[Message] | None = None
) -> Thread:
    return Thread(
        id=str(row.id),
        user_id=str(row.user_id),
        title=row.title,
        messages=messages or [],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class PostgresThreadStore(ThreadStore):
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def list_threads(
        self,
        user_id: str,
        *,
        query: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[Thread]:
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            stmt = (
                select(ThreadRecord)
                .where(ThreadRecord.user_id == uid)
                .order_by(ThreadRecord.updated_at.desc())
            )
            stmt = _apply_search(stmt, query, include_owner_email=False)
            if limit is not None:
                stmt = stmt.limit(limit)
            if offset:
                stmt = stmt.offset(offset)
            rows = (await session.execute(stmt)).scalars().all()
            return [_thread_from_record(r) for r in rows]

    async def count_threads(
        self, user_id: str, *, query: str | None = None
    ) -> int:
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            stmt = (
                select(func.count())
                .select_from(ThreadRecord)
                .where(ThreadRecord.user_id == uid)
            )
            stmt = _apply_search(stmt, query, include_owner_email=False)
            return int((await session.execute(stmt)).scalar_one() or 0)

    async def list_all_threads(
        self,
        *,
        query: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> list[Thread]:
        async with self._factory() as session:
            stmt = (
                select(ThreadRecord)
                .order_by(ThreadRecord.updated_at.desc())
                .limit(limit)
                .offset(offset)
            )
            stmt = _apply_search(stmt, query, include_owner_email=True)
            rows = (await session.execute(stmt)).scalars().all()
            return [_thread_from_record(r) for r in rows]

    async def count_all_threads(self, *, query: str | None = None) -> int:
        async with self._factory() as session:
            stmt = select(func.count()).select_from(ThreadRecord)
            stmt = _apply_search(stmt, query, include_owner_email=True)
            return int((await session.execute(stmt)).scalar_one() or 0)

    async def create_thread(
        self, user_id: str, *, title: str | None = None
    ) -> Thread:
        uid = _as_uuid(user_id)
        thread = Thread(user_id=str(uid), title=title)
        async with self._factory() as session:
            session.add(
                ThreadRecord(
                    id=UUID(thread.id),
                    user_id=uid,
                    title=title,
                    created_at=thread.created_at,
                    updated_at=thread.updated_at,
                )
            )
            await session.commit()
        return thread

    async def get_thread(self, thread_id: str, user_id: str) -> Thread:
        async with self._factory() as session:
            return await self._load_thread(
                session, _as_uuid(thread_id), _as_uuid(user_id)
            )

    async def get_any_thread(self, thread_id: str) -> Thread:
        async with self._factory() as session:
            return await self._load_thread(session, _as_uuid(thread_id), None)

    async def get_any_thread_summary(self, thread_id: str) -> Thread:
        tid = _as_uuid(thread_id)
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == tid)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ThreadNotFoundError(thread_id)
            return _thread_from_record(row, [])

    async def get_any_thread_messages_page(
        self,
        thread_id: str,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[Message], int, dict[str, int]]:
        tid = _as_uuid(thread_id)
        async with self._factory() as session:
            # AsyncSession isn't safe for concurrent execute() calls, so the
            # three queries run sequentially on the same session/transaction.
            exists = (
                await session.execute(
                    select(ThreadRecord.id).where(ThreadRecord.id == tid)
                )
            ).scalar_one_or_none()
            if exists is None:
                raise ThreadNotFoundError(thread_id)

            page_rows = (
                (
                    await session.execute(
                        select(MessageRecord)
                        .where(MessageRecord.thread_id == tid)
                        .order_by(MessageRecord.created_at)
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .scalars()
                .all()
            )
            total = int(
                (
                    await session.execute(
                        select(func.count())
                        .select_from(MessageRecord)
                        .where(MessageRecord.thread_id == tid)
                    )
                ).scalar_one()
                or 0
            )
            role_rows = (
                await session.execute(
                    select(MessageRecord.role, func.count())
                    .where(MessageRecord.thread_id == tid)
                    .group_by(MessageRecord.role)
                )
            ).all()
            role_counts = {str(r[0]): int(r[1]) for r in role_rows}
            messages = [
                Message(
                    id=str(m.id),
                    thread_id=str(m.thread_id),
                    role=MessageRole(m.role),
                    body=m.body,
                    created_at=m.created_at,
                )
                for m in page_rows
            ]
            return messages, total, role_counts

    async def _load_thread(
        self,
        session: AsyncSession,
        thread_id: UUID,
        user_id: UUID | None,
    ) -> Thread:
        row = (
            await session.execute(
                select(ThreadRecord).where(ThreadRecord.id == thread_id)
            )
        ).scalar_one_or_none()
        if row is None or (user_id is not None and row.user_id != user_id):
            raise ThreadNotFoundError(str(thread_id))

        message_rows = (
            (
                await session.execute(
                    select(MessageRecord)
                    .where(MessageRecord.thread_id == row.id)
                    .order_by(MessageRecord.created_at)
                )
            )
            .scalars()
            .all()
        )
        messages = [
            Message(
                id=str(m.id),
                thread_id=str(m.thread_id),
                role=MessageRole(m.role),
                body=m.body,
                created_at=m.created_at,
            )
            for m in message_rows
        ]
        return _thread_from_record(row, messages)

    async def get_or_create_latest(self, user_id: str) -> Thread:
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord)
                    .where(ThreadRecord.user_id == uid)
                    .order_by(ThreadRecord.updated_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is not None:
                return await self._load_thread(session, row.id, uid)

        return await self.create_thread(user_id)

    async def append_message(self, thread: Thread, message: Message) -> None:
        now = _now()
        thread_uuid = _as_uuid(thread.id)
        async with self._factory() as session:
            session.add(
                MessageRecord(
                    id=_as_uuid(message.id),
                    thread_id=thread_uuid,
                    role=message.role.value,
                    body=message.body,
                    created_at=message.created_at,
                )
            )
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == thread_uuid)
                )
            ).scalar_one_or_none()
            if row is not None:
                row.updated_at = now
                session.add(row)

            await session.commit()

        thread.messages.append(message)
        thread.updated_at = now

    async def set_title(
        self, thread_id: str, user_id: str, title: str
    ) -> None:
        tid = _as_uuid(thread_id)
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == tid)
                )
            ).scalar_one_or_none()
            if row is None or row.user_id != uid:
                raise ThreadNotFoundError(thread_id)
            row.title = title
            row.updated_at = _now()
            session.add(row)
            await session.commit()

    async def delete_thread(self, thread_id: str, user_id: str) -> None:
        tid = _as_uuid(thread_id)
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == tid)
                )
            ).scalar_one_or_none()
            if row is None or row.user_id != uid:
                raise ThreadNotFoundError(thread_id)
            # FK cascade removes messages automatically.
            await session.execute(
                delete(ThreadRecord).where(ThreadRecord.id == tid)
            )
            await session.commit()

    async def count_messages_for_threads(
        self, thread_ids: Sequence[str]
    ) -> dict[str, int]:
        if not thread_ids:
            return {}
        uuids = [_as_uuid(t) for t in thread_ids]
        async with self._factory() as session:
            stmt = (
                select(MessageRecord.thread_id, func.count())
                .where(MessageRecord.thread_id.in_(uuids))
                .group_by(MessageRecord.thread_id)
            )
            rows = (await session.execute(stmt)).all()
            return {str(tid): int(n) for tid, n in rows}

    async def delete_any_thread(self, thread_id: str) -> None:
        tid = _as_uuid(thread_id)
        async with self._factory() as session:
            exists = (
                await session.execute(
                    select(ThreadRecord.id).where(ThreadRecord.id == tid)
                )
            ).scalar_one_or_none()
            if exists is None:
                raise ThreadNotFoundError(thread_id)
            await session.execute(
                delete(ThreadRecord).where(ThreadRecord.id == tid)
            )
            await session.commit()


def _apply_search(  # type: ignore[no-untyped-def]
    stmt, query: str | None, *, include_owner_email: bool = False
):
    if not query:
        return stmt
    needle = f"%{query.lower()}%"
    clauses = [ThreadRecord.title.ilike(needle)]  # type: ignore[union-attr]
    if include_owner_email:
        # Admin-scope search also matches the thread's owner email / name so
        # typing "alice@..." pulls up all of Alice's conversations even if
        # her threads have no titles yet.
        owner_match = (
            select(UserRecord.id)
            .where(UserRecord.id == ThreadRecord.user_id)
            .where(
                or_(UserRecord.email.ilike(needle), UserRecord.name.ilike(needle))
            )
            .limit(1)
        )
        clauses.append(owner_match.exists())
    combined = clauses[0]
    for c in clauses[1:]:
        combined = combined | c
    return stmt.where(combined)
