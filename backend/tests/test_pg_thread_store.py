import pytest
from sqlalchemy import text

from app.db.engine import engine
from app.domain.enums import MessageRole
from app.domain.models import Message
from app.services.pg_thread_store import PostgresThreadStore


async def _truncate() -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("TRUNCATE TABLE chat_messages, chat_threads RESTART IDENTITY CASCADE")
        )


@pytest.mark.asyncio
async def test_get_or_create_inserts_and_is_idempotent() -> None:
    await _truncate()
    store = PostgresThreadStore()

    first = await store.get_or_create_for_session("session-abc")
    second = await store.get_or_create_for_session("session-abc")

    assert first.id == second.id
    assert first.owner_session_id == "session-abc"
    assert second.messages == []


@pytest.mark.asyncio
async def test_append_message_persists_across_reloads() -> None:
    await _truncate()
    store = PostgresThreadStore()

    thread = await store.get_or_create_for_session("session-xyz")
    user_msg = Message(thread_id=thread.id, role=MessageRole.USER, body="hi")
    assistant_msg = Message(
        thread_id=thread.id, role=MessageRole.ASSISTANT, body="hello!"
    )
    await store.append_message(thread, user_msg)
    await store.append_message(thread, assistant_msg)

    # New store instance to prove it round-trips through Postgres.
    fresh_store = PostgresThreadStore()
    reloaded = await fresh_store.get_or_create_for_session("session-xyz")

    assert reloaded.id == thread.id
    assert len(reloaded.messages) == 2
    assert reloaded.messages[0].role == MessageRole.USER
    assert reloaded.messages[0].body == "hi"
    assert reloaded.messages[1].role == MessageRole.ASSISTANT
    assert reloaded.messages[1].body == "hello!"
    assert reloaded.messages[0].id == user_msg.id
    assert reloaded.messages[1].id == assistant_msg.id


@pytest.mark.asyncio
async def test_separate_sessions_get_separate_threads() -> None:
    await _truncate()
    store = PostgresThreadStore()

    a = await store.get_or_create_for_session("session-A")
    b = await store.get_or_create_for_session("session-B")
    assert a.id != b.id

    await store.append_message(
        a, Message(thread_id=a.id, role=MessageRole.USER, body="in A")
    )
    await store.append_message(
        b, Message(thread_id=b.id, role=MessageRole.USER, body="in B")
    )

    reloaded_a = await PostgresThreadStore().get_or_create_for_session("session-A")
    reloaded_b = await PostgresThreadStore().get_or_create_for_session("session-B")
    assert [m.body for m in reloaded_a.messages] == ["in A"]
    assert [m.body for m in reloaded_b.messages] == ["in B"]
