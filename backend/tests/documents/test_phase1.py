"""Chat-attachment backend tests — native multimodal input (no OCR) + recovery.

Chat attachments are stored and handed to the agent as raw bytes
(pydantic-ai BinaryContent), so there's no server-side OCR; the upload route
marks them ready immediately and `load_thread_attachments` returns the bytes for
the turn. Drives coroutines with asyncio.run() (no pytest-asyncio in this repo).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.documents.blob_store import DiskBlobStore
from app.documents.processors.local import LocalProcessor
from app.documents.service import DocumentService, blob_key
from app.documents.store import InMemoryDocumentStore
from app.services.thread_store import InMemoryThreadStore

_PNG = "image/png"


def _service(tmp_path):
    store = InMemoryDocumentStore()
    blobs = DiskBlobStore(tmp_path)
    service = DocumentService(
        store=store, blobs=blobs, processor=LocalProcessor(), threads=InMemoryThreadStore()
    )
    return service, store, blobs


async def _ready_attachment(
    store, blobs, *, user_id="u1", thread_id="t1", data=b"\x89PNG-bytes"
):
    doc = await store.create_document(
        user_id=user_id,
        thread_id=thread_id,
        purpose="chat_attachment",
        filename="pic.png",
        mime_type=_PNG,
        size_bytes=len(data),
        file_hash="h",
    )
    await blobs.put(
        key=blob_key(user_id, doc.id, "chat_attachment"), data=data, content_type=_PNG
    )
    await store.update_document(doc.id, status="ready")  # ready on upload, no OCR
    return doc


def test_load_thread_attachments_returns_raw_bytes(tmp_path):
    service, store, blobs = _service(tmp_path)

    async def scenario():
        await _ready_attachment(store, blobs, data=b"\x89PNG-rawbytes")
        files = await service.load_thread_attachments(user_id="u1", thread_id="t1")
        assert len(files) == 1
        assert files[0].filename == "pic.png"
        assert files[0].mime_type == _PNG
        assert files[0].data == b"\x89PNG-rawbytes"

    asyncio.run(scenario())


def test_load_thread_attachments_scopes_and_skips_unready(tmp_path):
    service, store, blobs = _service(tmp_path)

    async def scenario():
        await _ready_attachment(store, blobs)
        # Not ready yet → skipped.
        await store.create_document(
            user_id="u1", thread_id="t1", purpose="chat_attachment",
            filename="x.png", mime_type=_PNG, size_bytes=1, file_hash="h",
        )
        # Ready but a different thread → skipped.
        await _ready_attachment(store, blobs, thread_id="t2")

        files = await service.load_thread_attachments(user_id="u1", thread_id="t1")
        assert len(files) == 1 and files[0].filename == "pic.png"

        # A different user gets nothing.
        assert (
            await service.load_thread_attachments(
                user_id="intruder", thread_id="t1"
            )
            == []
        )

    asyncio.run(scenario())


def test_recover_stuck_fails_doc_over_limit(tmp_path):
    # Chat attachments are ready on upload, so recovery only ever fails a doc
    # stuck past the retry limit (here a CV that never finished).
    service, store, blobs = _service(tmp_path)

    async def scenario():
        dead = await store.create_document(
            user_id="u1", thread_id=None, purpose="profile_cv",
            filename="cv.pdf", mime_type="application/pdf", size_bytes=2, file_hash="h",
        )
        await store.update_document(dead.id, status="processing", attempts=3)
        store._docs[dead.id] = store._docs[dead.id].model_copy(
            update={"processing_started_at": datetime.now(UTC) - timedelta(hours=1)}
        )
        acted = await service.recover_stuck(stale_seconds=0, max_attempts=3)
        assert acted == 1
        assert (await store.get_document(dead.id, "u1")).status == "failed"

    asyncio.run(scenario())
