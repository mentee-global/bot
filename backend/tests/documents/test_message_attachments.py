"""Per-message attachment persistence.

Documents are thread-scoped, but the chat UI needs to show which uploaded file
belonged to which user message after a reload.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.documents.blob_store import DiskBlobStore
from app.documents.processors.local import LocalProcessor
from app.documents.service import DocumentService
from app.documents.store import DocumentNotFoundError, InMemoryDocumentStore
from app.domain.models import User
from app.services.message_service import MessageService
from app.services.thread_store import InMemoryThreadStore


class _FakeAgent:
    async def reply(self, *args, **kwargs) -> str:
        return "ok"


class _FakeBudget:
    async def check_can_chat(self, user: User):
        return SimpleNamespace(perplexity_degraded=False)

    async def record_turn(self, **kwargs) -> None:
        return None


def _user() -> User:
    return User(
        id="u1",
        mentee_sub="sub",
        email="jane@example.com",
        name="Jane",
        role="mentee",
        role_id=1,
    )


def _service(tmp_path):
    threads = InMemoryThreadStore()
    docs = InMemoryDocumentStore()
    docsvc = DocumentService(
        store=docs,
        blobs=DiskBlobStore(tmp_path),
        processor=LocalProcessor(),
        threads=threads,
    )
    messages = MessageService(
        store=threads,
        agent=_FakeAgent(),
        budget=_FakeBudget(),
        documents=docsvc,
    )
    return messages, threads, docs


def test_user_message_persists_ready_attachment(tmp_path):
    messages, threads, docs = _service(tmp_path)

    async def scenario():
        thread = await threads.create_thread("u1")
        doc = await docs.create_document(
            user_id="u1",
            thread_id=thread.id,
            purpose="chat_attachment",
            filename="cv.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            file_hash="h",
        )
        await docs.update_document(doc.id, status="ready", summary="CV")

        _thread, user_msg, _assistant = await messages.handle_user_message(
            "u1",
            "review this",
            user=_user(),
            thread_id=thread.id,
            attachment_ids=[doc.id],
        )

        reloaded = await threads.get_thread(thread.id, "u1")
        stored = next(m for m in reloaded.messages if m.id == user_msg.id)
        assert stored.attachments[0].document_id == doc.id
        assert stored.attachments[0].filename == "cv.pdf"
        assert stored.attachments[0].status == "ready"

    asyncio.run(scenario())


def test_message_attachment_rejects_wrong_thread(tmp_path):
    messages, threads, docs = _service(tmp_path)

    async def scenario():
        thread = await threads.create_thread("u1")
        other_thread = await threads.create_thread("u1")
        doc = await docs.create_document(
            user_id="u1",
            thread_id=other_thread.id,
            purpose="chat_attachment",
            filename="other.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            file_hash="h",
        )
        await docs.update_document(doc.id, status="ready", summary="Other")

        with pytest.raises(DocumentNotFoundError):
            await messages.handle_user_message(
                "u1",
                "review this",
                user=_user(),
                thread_id=thread.id,
                attachment_ids=[doc.id],
            )

    asyncio.run(scenario())
