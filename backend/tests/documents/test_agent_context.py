"""Agent memory wiring — MessageService builds thread document context that the
agent receives as `document_context` (plan Phase 1)."""

from __future__ import annotations

import asyncio

from app.documents.blob_store import DiskBlobStore
from app.documents.processors.local import LocalProcessor
from app.documents.service import DocumentService
from app.documents.store import InMemoryDocumentStore
from app.services.message_service import MessageService
from app.services.thread_store import InMemoryThreadStore


def _message_service(tmp_path):
    threads = InMemoryThreadStore()
    docstore = InMemoryDocumentStore()
    docsvc = DocumentService(
        store=docstore,
        blobs=DiskBlobStore(tmp_path),
        processor=LocalProcessor(),
        threads=threads,
    )
    # agent/budget unused by _document_context.
    svc = MessageService(store=threads, agent=None, budget=None, documents=docsvc)
    return svc, threads, docstore


def test_document_context_none_without_documents(tmp_path):
    threads = InMemoryThreadStore()
    svc = MessageService(store=threads, agent=None, budget=None, documents=None)

    async def scenario():
        thread = await threads.create_thread("u1")
        assert await svc._document_context("u1", thread, "hi") is None

    asyncio.run(scenario())


def test_document_context_includes_ready_summary(tmp_path):
    svc, threads, docstore = _message_service(tmp_path)

    async def scenario():
        thread = await threads.create_thread("u1")
        doc = await docstore.create_document(
            user_id="u1",
            thread_id=thread.id,
            purpose="chat_attachment",
            filename="cv.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            file_hash="h",
        )
        # Only ready docs with a summary surface.
        await docstore.update_document(doc.id, status="ready", summary="A CV for Jane.")

        ctx = await svc._document_context("u1", thread, "what's in my file?")
        assert ctx is not None
        assert "cv.pdf" in ctx and "A CV for Jane." in ctx

    asyncio.run(scenario())


def test_document_context_injects_full_text(tmp_path):
    svc, threads, docstore = _message_service(tmp_path)

    async def scenario():
        thread = await threads.create_thread("u1")
        doc = await docstore.create_document(
            user_id="u1",
            thread_id=thread.id,
            purpose="chat_attachment",
            filename="cv.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            file_hash="h",
        )
        full = "EXPERIENCE\nAcme Corp — Engineer\nEDUCATION\nBSc CS"
        # Full text wins over the (thin) summary so the agent sees the whole doc.
        await docstore.update_document(
            doc.id, status="ready", summary="short stub", extracted_text=full
        )
        ctx = await svc._document_context("u1", thread, "review my CV")
        assert ctx is not None
        assert "EXPERIENCE" in ctx and "EDUCATION" in ctx

    asyncio.run(scenario())


def test_document_context_excludes_other_users(tmp_path):
    svc, threads, docstore = _message_service(tmp_path)

    async def scenario():
        thread = await threads.create_thread("owner")
        doc = await docstore.create_document(
            user_id="owner",
            thread_id=thread.id,
            purpose="chat_attachment",
            filename="secret.pdf",
            mime_type="application/pdf",
            size_bytes=10,
            file_hash="h",
        )
        await docstore.update_document(doc.id, status="ready", summary="secret")
        # A different user asking in (a hypothetical reuse of) the thread id
        # gets nothing — scoped by (thread_id, user_id).
        assert await svc._document_context("intruder", thread, "hi") is None

    asyncio.run(scenario())
