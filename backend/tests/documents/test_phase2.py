"""CV pipeline tests — OCR → faithful Markdown → active CV, plus the
free-text "about me". No structured extraction, no manual confirm step.

Drives coroutines with asyncio.run() (no pytest-asyncio). A FakeProcessor
stands in for the OpenAI multimodal OCR so no network/key is needed.
"""

from __future__ import annotations

import asyncio

import pytest

from app.documents.base import DocumentError, ParsedDocument
from app.documents.blob_store import DiskBlobStore
from app.documents.service import DocumentService, blob_key, cv_markdown_key
from app.documents.store import DocumentNotFoundError, InMemoryDocumentStore
from app.services.thread_store import InMemoryThreadStore

_PDF = "application/pdf"
_CV_MD = (
    "# Ada Lovelace\n\n**Location:** London, UK\n\n"
    "## Experience\n- Mathematician at Analytical Engine Co (1842–Present)\n\n"
    "## Skills\nMathematics, Algorithms, Analysis"
)


class FakeProcessor:
    """Minimal DocumentProcessorPort double: parse() returns canned Markdown
    (or raises) so we exercise the service without a model."""

    provider_id = "fake"

    def __init__(self, *, markdown: str = "cv markdown", raises: Exception | None = None):
        self._markdown = markdown
        self._raises = raises

    def supports(self, mime_type: str) -> bool:
        return True

    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        if self._raises is not None:
            raise self._raises
        return ParsedDocument(
            markdown=self._markdown,
            page_count=1,
            summary=self._markdown[:80],
            provider=self.provider_id,
        )


def _service(tmp_path, processor):
    store = InMemoryDocumentStore()
    blobs = DiskBlobStore(tmp_path)
    service = DocumentService(
        store=store, blobs=blobs, processor=processor, threads=InMemoryThreadStore()
    )
    return service, store, blobs


async def _upload_cv(store, blobs, *, user_id="u1"):
    doc = await store.create_document(
        user_id=user_id,
        thread_id=None,
        purpose="profile_cv",
        filename="cv.pdf",
        mime_type=_PDF,
        size_bytes=10,
        file_hash="h",
    )
    await blobs.put(
        key=blob_key(user_id, doc.id, "profile_cv"),
        data=b"%PDF-fake",
        content_type=_PDF,
    )
    return doc


def test_cv_ocr_stores_markdown_and_activates(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(markdown=_CV_MD))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)

        result = await store.get_document(doc.id, "u1")
        assert result.status == "ready"
        assert result.extracted_text == _CV_MD

        # Markdown is written next to the raw file in the bucket (user ask).
        md_blob = await blobs.get(key=cv_markdown_key("u1", doc.id))
        assert md_blob.decode() == _CV_MD

        # Active immediately (no manual confirm) → flows into chats.
        profile = await store.get_profile("u1")
        assert profile is not None and profile.is_confirmed
        assert profile.cv_document_id == doc.id

        ctx = await service.build_profile_context(user_id="u1")
        assert "Ada Lovelace" in ctx and "Mathematician" in ctx

        # The /profile page reads the transcription back.
        fname, md = await service.get_cv_markdown(user_id="u1")
        assert fname == "cv.pdf" and md == _CV_MD

    asyncio.run(scenario())


def test_cv_empty_ocr_marks_failed(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(markdown="   "))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "failed"
        assert result.error_message
        # Nothing activated → no CV context.
        assert await service.build_profile_context(user_id="u1") == ""

    asyncio.run(scenario())


def test_cv_processor_error_marks_failed(tmp_path):
    service, store, blobs = _service(
        tmp_path, FakeProcessor(raises=DocumentError("OCR call failed"))
    )

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "failed"
        assert "OCR" in (result.error_message or "")

    asyncio.run(scenario())


def test_reupload_replaces_active_cv(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(markdown=_CV_MD))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)
        doc2 = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc2.id)
        profile = await store.get_profile("u1")
        assert profile.cv_document_id == doc2.id and profile.is_confirmed

        # The previous CV is purged — one CV per user, no orphaned row/blobs.
        with pytest.raises(DocumentNotFoundError):
            await store.get_document(doc.id, "u1")
        for key in (
            blob_key("u1", doc.id, "profile_cv"),
            cv_markdown_key("u1", doc.id),
        ):
            with pytest.raises(FileNotFoundError):
                await blobs.get(key=key)
        # The new CV's markdown blob is present.
        assert await blobs.get(key=cv_markdown_key("u1", doc2.id))

    asyncio.run(scenario())


def test_recover_stuck_redispatches_profile_cv(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(markdown=_CV_MD))

    async def scenario():
        doc = await _upload_cv(store, blobs)  # pending, bytes present
        acted = await service.recover_stuck(stale_seconds=0, max_attempts=3)
        assert acted == 1
        assert (await store.get_document(doc.id, "u1")).status == "ready"
        assert (await store.get_profile("u1")) is not None

    asyncio.run(scenario())


def test_about_me_set_trimmed_and_cleared(tmp_path):
    service, _store, _blobs = _service(tmp_path, FakeProcessor())

    async def scenario():
        assert await service.build_about_context(user_id="u1") == ""
        await service.set_about_me(
            user_id="u1", about_me="  I'm a first-gen student aiming for a CS PhD.  "
        )
        ctx = await service.build_about_context(user_id="u1")
        assert ctx == "I'm a first-gen student aiming for a CS PhD."
        # Blank clears it.
        await service.set_about_me(user_id="u1", about_me="   ")
        assert await service.build_about_context(user_id="u1") == ""

    asyncio.run(scenario())


def test_about_me_preserved_when_cv_set(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(markdown=_CV_MD))

    async def scenario():
        await service.set_about_me(user_id="u1", about_me="Hi there")
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)
        profile = await store.get_profile("u1")
        assert profile.about_me == "Hi there"  # CV upload didn't clobber it
        assert profile.cv_document_id == doc.id

    asyncio.run(scenario())
