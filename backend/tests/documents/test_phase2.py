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

    def __init__(
        self,
        *,
        markdown: str = "cv markdown",
        raises: Exception | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model_sku: str | None = None,
    ):
        self._markdown = markdown
        self._raises = raises
        self._input_tokens = input_tokens
        self._output_tokens = output_tokens
        self._model_sku = model_sku

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
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            model_sku=self._model_sku,
        )


class FakeBudget:
    """Records the usage handed to record_document_usage and returns a fixed
    credit charge, so we can assert the charging seam without a DB."""

    def __init__(self, *, charge: int = 0):
        self._charge = charge
        self.calls: list[dict] = []

    async def record_document_usage(self, *, user_id, usage, document_id=None):
        self.calls.append(
            {
                "user_id": user_id,
                "document_id": document_id,
                "input_tokens": usage.openai_input_tokens,
                "output_tokens": usage.openai_output_tokens,
                "model_sku": usage.openai_model_sku,
            }
        )
        return self._charge


def _service(tmp_path, processor, *, budget=None):
    store = InMemoryDocumentStore()
    blobs = DiskBlobStore(tmp_path)
    service = DocumentService(
        store=store,
        blobs=blobs,
        processor=processor,
        threads=InMemoryThreadStore(),
        budget=budget,
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
        fname, md, credits = await service.get_cv_markdown(user_id="u1")
        assert fname == "cv.pdf" and md == _CV_MD
        # No budget wired in this fixture → nothing charged.
        assert credits == 0

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


def test_cv_ocr_charges_credits_and_records_on_document(tmp_path):
    budget = FakeBudget(charge=7)
    service, store, blobs = _service(
        tmp_path,
        FakeProcessor(
            markdown=_CV_MD,
            input_tokens=1234,
            output_tokens=567,
            model_sku="gpt-5.4",
        ),
        budget=budget,
    )

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)

        # The OCR usage was handed to the budget with the parsed token counts.
        assert len(budget.calls) == 1
        call = budget.calls[0]
        assert call["user_id"] == "u1" and call["document_id"] == doc.id
        assert call["input_tokens"] == 1234 and call["output_tokens"] == 567
        assert call["model_sku"] == "gpt-5.4"

        # The charge is persisted on the document and surfaced via get_cv_markdown.
        result = await store.get_document(doc.id, "u1")
        assert result.status == "ready" and result.ocr_credits_charged == 7
        _, _, credits = await service.get_cv_markdown(user_id="u1")
        assert credits == 7

    asyncio.run(scenario())


def test_cv_ocr_charge_failure_still_ships_cv(tmp_path):
    """A billing hiccup must not fail the upload — the model spend already
    happened, so the CV still goes ready (with 0 recorded credits)."""

    class BoomBudget(FakeBudget):
        async def record_document_usage(self, *, user_id, usage, document_id=None):
            raise RuntimeError("billing down")

    service, store, blobs = _service(
        tmp_path,
        FakeProcessor(markdown=_CV_MD, input_tokens=10, output_tokens=5),
        budget=BoomBudget(),
    )

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.process_cv_upload(user_id="u1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "ready" and result.ocr_credits_charged == 0
        assert result.extracted_text == _CV_MD

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
