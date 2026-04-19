"""Postgres-backed ThreadStore.

One thread per session (matches the in-memory impl) so the switch from memory
→ Postgres is transparent to callers. Conversations survive redeploys; each
message is an insert with no UPDATE path (mentor turns are append-only).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.engine import async_session_factory
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread
from app.services.db_models import MessageRecord, ThreadRecord
from app.services.thread_store import ThreadStore


def _now() -> datetime:
    return datetime.now(UTC)


class PostgresThreadStore(ThreadStore):
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def get_or_create_for_session(self, session_id: str) -> Thread:
        async with self._factory() as session:
            row = (
                await session.execute(
                    select(ThreadRecord).where(
                        ThreadRecord.owner_session_id == session_id
                    )
                )
            ).scalar_one_or_none()

            if row is None:
                thread = Thread(owner_session_id=session_id)
                session.add(
                    ThreadRecord(
                        id=thread.id,
                        owner_session_id=session_id,
                        created_at=thread.created_at,
                        updated_at=thread.updated_at,
                    )
                )
                await session.commit()
                return thread

            # Load existing messages in insertion order.
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
            return Thread(
                id=row.id,
                owner_session_id=row.owner_session_id,
                messages=messages,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

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
            # Bump the thread's updated_at; ignore the case where the row was
            # deleted between the caller's fetch and now — that's a caller bug.
            row = (
                await session.execute(
                    select(ThreadRecord).where(ThreadRecord.id == thread.id)
                )
            ).scalar_one_or_none()
            if row is not None:
                row.updated_at = now
                session.add(row)

            await session.commit()

        # Keep the caller's in-memory `Thread` coherent so subsequent calls
        # (the agent reading history for the same turn) see the new message
        # without another round trip.
        thread.messages.append(message)
        thread.updated_at = now
