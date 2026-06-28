"""Phase 1 backend pipeline tests — upload processing + recovery.

Drives async coroutines with asyncio.run() (no pytest-asyncio in this repo).
Uses LocalProcessor so no network/OpenAI key is needed.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.documents.blob_store import DiskBlobStore
from app.documents.processors.local import LocalProcessor
from app.documents.service import DocumentService, blob_key
from app.documents.store import InMemoryDocumentStore
from app.services.thread_store import InMemoryThreadStore

_TEXT = "text/markdown"


def _service(tmp_path):
    store = InMemoryDocumentStore()
    blobs = DiskBlobStore(tmp_path)
    threads = InMemoryThreadStore()
    service = DocumentService(
        store=store, blobs=blobs, processor=LocalProcessor(), threads=threads
    )
    return service, store, blobs


def test_process_chat_upload_happy_path(tmp_path):
    service, store, blobs = _service(tmp_path)

    async def scenario():
        doc = await store.create_document(
            user_id="u1",
            thread_id="t1",
            purpose="chat_attachment",
            filename="note.md",
            mime_type=_TEXT,
            size_bytes=11,
            file_hash="h",
        )
        await blobs.put(
            key=blob_key("u1", doc.id, "chat_attachment"),
            data=b"Hello world",
            content_type=_TEXT,
        )
        await service.process_chat_upload(user_id="u1", thread_id="t1", document_id=doc.id)

        result = await store.get_document(doc.id, "u1")
        assert result.status == "ready"
        assert result.summary and "Hello world" in result.summary
        assert result.attempts == 1

    asyncio.run(scenario())


def test_process_chat_upload_marks_failed_on_missing_blob(tmp_path):
    service, store, _ = _service(tmp_path)

    async def scenario():
        doc = await store.create_document(
            user_id="u1",
            thread_id="t1",
            purpose="chat_attachment",
            filename="note.md",
            mime_type=_TEXT,
            size_bytes=1,
            file_hash="h",
        )
        # No bytes were stored → blob.get raises → status flips to failed.
        await service.process_chat_upload(user_id="u1", thread_id="t1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "failed"
        assert result.error_message

    asyncio.run(scenario())


def test_recover_stuck_redispatches_and_fails_over_limit(tmp_path):
    service, store, blobs = _service(tmp_path)

    async def scenario():
        # A pending doc with bytes present → recovery should process it.
        ok = await store.create_document(
            user_id="u1",
            thread_id="t1",
            purpose="chat_attachment",
            filename="ok.md",
            mime_type=_TEXT,
            size_bytes=2,
            file_hash="h",
        )
        await blobs.put(
            key=blob_key("u1", ok.id, "chat_attachment"),
            data=b"Recovered text",
            content_type=_TEXT,
        )

        # A doc already past the retry limit → recovery should fail it.
        dead = await store.create_document(
            user_id="u1",
            thread_id="t1",
            purpose="chat_attachment",
            filename="dead.md",
            mime_type=_TEXT,
            size_bytes=2,
            file_hash="h",
        )
        await store.update_document(dead.id, status="processing", attempts=3)
        # Make it look stale.
        store._docs[dead.id] = store._docs[dead.id].model_copy(
            update={"processing_started_at": datetime.now(UTC) - timedelta(hours=1)}
        )

        acted = await service.recover_stuck(stale_seconds=0, max_attempts=3)
        assert acted == 2
        assert (await store.get_document(ok.id, "u1")).status == "ready"
        assert (await store.get_document(dead.id, "u1")).status == "failed"

    asyncio.run(scenario())
