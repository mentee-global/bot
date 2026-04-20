"""Postgres-backed ThreadStore.

Threads are owned by the Mentee user id (OAuth `sub`) so conversations
persist across logout / login. Lookup is always gated by `owner_user_id` so
one user can't read another's chats.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.engine import async_session_factory
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread
from app.services.db_models import MessageRecord, ThreadRecord
from app.services.thread_store import ThreadNotFoundError, ThreadStore


def _now() -> datetime:
    return datetime.now(UTC)


def _thread_from_record(
    row: ThreadRecord, messages: list[Message] | None = None
) -> Thread:
    return Thread(
        id=row.id,
        owner_user_id=row.owner_user_id,
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
        self, user_id: str, *, query: str | None = None
    ) -> list[Thread]:
        async with self._factory() as session:
            stmt = (
                select(ThreadRecord)
                .where(ThreadRecord.owner_user_id == user_id)
                .order_by(ThreadRecord.updated_at.desc())
            )
            if query:
                needle = f"%{query.lower()}%"
                # Match title OR any message body. The `exists(...)` subquery
                # keeps a single thread row even when multiple messages match.
                message_match = (
                    select(MessageRecord.id)
                    .where(MessageRecord.thread_id == ThreadRecord.id)
                    .where(MessageRecord.body.ilike(needle))
                    .limit(1)
                )
                stmt = stmt.where(
                    ThreadRecord.title.ilike(needle)  # type: ignore[union-attr]
                    | message_match.exists()
                )
            rows = (await session.execute(stmt)).scalars().all()
            return [_thread_from_record(r) for r in rows]

    async def create_thread(
        self, user_id: str, *, title: str | None = None
    ) -> Thread:
        thread = Thread(owner_user_id=user_id, title=title)
        async with self._factory() as session:
            session.add(
                ThreadRecord(
                    id=thread.id,
                    owner_user_id=user_id,
                    title=title,
                    created_at=thread.created_at,
                    updated_at=thread.updated_at,
                )
            )
            await session.commit()
        return thread

    async def get_thread(self, thread_id: str, user_id: str) -> Thread:
        async with self._factory() as session:
            return await self._load_thread(session, thread_id, user_id)

    async def _load_thread(
        self, session: AsyncSession, thread_id: str, user_id: str
    ) -> Thread:
        row = (
            await session.execute(
                select(ThreadRecord).where(ThreadRecord.id == thread_id)
            )
        ).scalar_one_or_none()
        if row is None or row.owner_user_id != user_id:
            raise ThreadNotFoundError(thread_id)

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
                id=m.id,
                thread_id=m.thread_id,
                role=MessageRole(m.role),
                body=m.body,
                created_at=m.created_at,
            )
            for m in message_rows
        ]
        return _thread_from_record(row, messages)

    async def get_or_create_latest(self, user_id: str) -> Thread:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord)
                    .where(ThreadRecord.owner_user_id == user_id)
                    .order_by(ThreadRecord.updated_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is not None:
                return await self._load_thread(session, row.id, user_id)

        return await self.create_thread(user_id)

    async def append_message(self, thread: Thread, message: Message) -> None:
        now = _now()
        async with self._factory() as session:
            session.add(
                MessageRecord(
                    id=message.id,
                    thread_id=thread.id,
                    role=message.role.value,
                    body=message.body,
                    created_at=message.created_at,
                )
            )
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == thread.id)
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
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == thread_id)
                )
            ).scalar_one_or_none()
            if row is None or row.owner_user_id != user_id:
                raise ThreadNotFoundError(thread_id)
            row.title = title
            row.updated_at = _now()
            session.add(row)
            await session.commit()

    async def delete_thread(self, thread_id: str, user_id: str) -> None:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == thread_id)
                )
            ).scalar_one_or_none()
            if row is None or row.owner_user_id != user_id:
                raise ThreadNotFoundError(thread_id)
            await session.execute(
                delete(MessageRecord).where(MessageRecord.thread_id == thread_id)
            )
            await session.execute(
                delete(ThreadRecord).where(ThreadRecord.id == thread_id)
            )
            await session.commit()
