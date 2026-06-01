"""Phase 2 backend tests — CV extraction + draft→confirm gate (decision #10).

Drives coroutines with asyncio.run() (no pytest-asyncio). A FakeProcessor
stands in for OpenAIDocumentProcessor so no network/key is needed; LocalProcessor
can't extract, so we need a model-backed double.
"""

from __future__ import annotations

import asyncio

from app.documents.base import DocumentError, ParsedDocument
from app.documents.blob_store import DiskBlobStore
from app.documents.schemas import ResumeSchema
from app.documents.service import DocumentService, blob_key
from app.documents.store import InMemoryDocumentStore
from app.services.thread_store import InMemoryThreadStore

_PDF = "application/pdf"

_CV_JSON = {
    "name": "Ada Lovelace",
    "location": "London, UK",
    "education": [
        {"degree": "B.S.", "institution": "Cambridge", "field_of_study": "Mathematics"}
    ],
    "work_experience": [
        {"company": "Analytical Engine Co", "position": "Mathematician",
         "start_date": "1842", "end_date": "Present"}
    ],
    "skills": ["Mathematics", "Algorithms", "Analysis"],
    "languages": ["English", "French"],
}


class FakeProcessor:
    """Minimal DocumentProcessorPort double: extract() returns canned JSON
    (or raises) so we can exercise the service without a model."""

    provider_id = "fake"

    def __init__(self, *, structured: dict | None = None, raises: Exception | None = None):
        self._structured = structured
        self._raises = raises

    def supports(self, mime_type: str) -> bool:
        return True

    async def parse(
        self, *, data: bytes, filename: str, mime_type: str
    ) -> ParsedDocument:
        return ParsedDocument(
            markdown="cv text", page_count=1, provider=self.provider_id
        )

    async def extract(
        self, *, data: bytes, filename: str, mime_type: str, schema: dict
    ) -> ParsedDocument:
        if self._raises is not None:
            raise self._raises
        return ParsedDocument(
            markdown="cv text",
            page_count=1,
            structured=self._structured,
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
    await blobs.put(key=blob_key(user_id, doc.id), data=b"%PDF-fake", content_type=_PDF)
    return doc


def test_extract_stores_unconfirmed_draft_not_injected(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(structured=_CV_JSON))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc.id)

        result = await store.get_document(doc.id, "u1")
        assert result.status == "ready"
        assert result.extracted_json["name"] == "Ada Lovelace"

        profile = await store.get_profile("u1")
        assert profile is not None
        assert profile.cv_structured["name"] == "Ada Lovelace"
        assert profile.cv_summary and "Ada Lovelace" in profile.cv_summary
        # Draft is UNCONFIRMED → must NOT be injected into chats (decision #10).
        assert not profile.is_confirmed
        assert await service.build_profile_context(user_id="u1") == ""

    asyncio.run(scenario())


def test_confirm_then_injected(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(structured=_CV_JSON))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc.id)

        # User edits + saves → confirm.
        edited = ResumeSchema.model_validate(_CV_JSON)
        edited.skills = ["Mathematics", "Algorithms", "Computing"]
        confirmed = await service.confirm_cv_profile(user_id="u1", resume=edited)
        assert confirmed.is_confirmed

        ctx = await service.build_profile_context(user_id="u1")
        assert ctx and "Ada Lovelace" in ctx and "Computing" in ctx

    asyncio.run(scenario())


def test_reupload_resets_to_unconfirmed(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(structured=_CV_JSON))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc.id)
        await service.confirm_cv_profile(
            user_id="u1", resume=ResumeSchema.model_validate(_CV_JSON)
        )
        assert await service.build_profile_context(user_id="u1") != ""

        # Re-uploading a new CV produces a fresh UNCONFIRMED draft → not injected
        # until the user saves again (decision #10).
        doc2 = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc2.id)
        profile = await store.get_profile("u1")
        assert not profile.is_confirmed
        assert await service.build_profile_context(user_id="u1") == ""

    asyncio.run(scenario())


def test_extract_marks_failed_on_invalid_structured(tmp_path):
    # Missing required `name` → ResumeSchema validation fails → status failed.
    service, store, blobs = _service(tmp_path, FakeProcessor(structured={"skills": []}))

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "failed"
        assert result.error_message
        # No draft persisted on failure.
        assert await store.get_profile("u1") is None

    asyncio.run(scenario())


def test_extract_marks_failed_on_processor_error(tmp_path):
    service, store, blobs = _service(
        tmp_path, FakeProcessor(raises=DocumentError("no text layer (scanned)"))
    )

    async def scenario():
        doc = await _upload_cv(store, blobs)
        await service.extract_cv_profile(user_id="u1", document_id=doc.id)
        result = await store.get_document(doc.id, "u1")
        assert result.status == "failed"
        assert "scanned" in (result.error_message or "")

    asyncio.run(scenario())


def test_recover_stuck_redispatches_profile_cv(tmp_path):
    service, store, blobs = _service(tmp_path, FakeProcessor(structured=_CV_JSON))

    async def scenario():
        doc = await _upload_cv(store, blobs)  # pending, bytes present
        acted = await service.recover_stuck(stale_seconds=0, max_attempts=3)
        assert acted == 1
        assert (await store.get_document(doc.id, "u1")).status == "ready"
        assert (await store.get_profile("u1")) is not None

    asyncio.run(scenario())
