"""DocumentService — engine-agnostic orchestration.

This is the layer that never changes when the processor is swapped
(OpenAI → LlamaParse). It owns: ownership checks, blob storage, calling the
processor, persisting results, and assembling the compact context the agent
sees. The processor only ever turns bytes into text/JSON.

Phase 0 ships the constructor, the context builders (functional), and the
ownership seam. The upload/extract pipelines are wired in plan Phase 1/2.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from app.documents.base import (
    BlobStorePort,
    DocPurpose,
    DocStatus,
    DocumentProcessorPort,
    DocumentRetrievalPort,
)
from app.documents.store import DocumentNotFoundError, DocumentStore
from app.services.thread_store import ThreadNotFoundError, ThreadStore

logger = logging.getLogger(__name__)

# Recovery loop tuning (plan decision #11).
MAX_PROCESSING_ATTEMPTS = 3
STALE_PROCESSING_SECONDS = 300


def blob_key(user_id: str, document_id: str) -> str:
    """Deterministic BlobStore key for a document's raw bytes."""
    return f"{user_id}/{document_id}"


class ThreadOwnershipError(Exception):
    """Raised when a chat upload targets a thread the user doesn't own (#15)."""


class DocumentService:
    def __init__(
        self,
        *,
        store: DocumentStore,
        blobs: BlobStorePort,
        processor: DocumentProcessorPort,
        threads: ThreadStore,
        retrieval: DocumentRetrievalPort | None = None,
    ) -> None:
        self._store = store
        self._blobs = blobs
        self._processor = processor
        self._threads = threads
        self._retrieval = retrieval

    async def assert_thread_owned(self, *, user_id: str, thread_id: str) -> None:
        """Plan decision #15: prove the thread belongs to the user BEFORE any
        write. Reuses the user-scoped ThreadStore lookup."""
        try:
            await self._threads.get_thread(thread_id, user_id)
        except ThreadNotFoundError as exc:
            raise ThreadOwnershipError(thread_id) from exc

    async def process_chat_upload(
        self, *, user_id: str, thread_id: str, document_id: str
    ) -> None:
        """Load bytes → processor.parse() → persist summary + status.

        Runs in a BackgroundTask. `claim_for_processing` stamps
        processing_started_at and bumps attempts so the recovery loop can tell
        a stranded job from a slow one. Never raises — failures land as
        status='failed' with an error message."""
        try:
            doc = await self._store.claim_for_processing(document_id)
            data = await self._blobs.get(key=blob_key(user_id, document_id))
            parsed = await self._processor.parse(
                data=data, filename=doc.filename, mime_type=doc.mime_type
            )
            await self._store.update_document(
                document_id,
                status=DocStatus.READY,
                summary=parsed.summary,
                page_count=parsed.page_count,
                provider=parsed.provider,
                provider_file_id=parsed.provider_file_id,
                error_message=None,
            )
        except DocumentNotFoundError:
            logger.warning("process_chat_upload: document %s vanished", document_id)
        except Exception as exc:  # noqa: BLE001 — record, don't crash the worker
            logger.warning("process_chat_upload failed for %s: %s", document_id, exc)
            try:
                await self._store.update_document(
                    document_id, status=DocStatus.FAILED, error_message=str(exc)[:500]
                )
            except DocumentNotFoundError:
                pass

    async def recover_stuck(
        self,
        *,
        stale_seconds: int = STALE_PROCESSING_SECONDS,
        max_attempts: int = MAX_PROCESSING_ATTEMPTS,
    ) -> int:
        """Re-dispatch pending/orphaned documents; fail those past max attempts.

        Called at startup (all `processing` rows are orphaned by definition)
        and periodically from the cleanup loop (plan decision #11). Returns how
        many documents it acted on."""
        stale_before = datetime.now(UTC) - timedelta(seconds=stale_seconds)
        docs = await self._store.list_recoverable(stale_before=stale_before)
        acted = 0
        for doc in docs:
            acted += 1
            if doc.attempts >= max_attempts:
                await self._store.update_document(
                    doc.id,
                    status=DocStatus.FAILED,
                    error_message="exceeded processing retry limit",
                )
                continue
            if doc.purpose == DocPurpose.CHAT_ATTACHMENT and doc.thread_id:
                await self.process_chat_upload(
                    user_id=doc.user_id,
                    thread_id=doc.thread_id,
                    document_id=doc.id,
                )
            # profile_cv recovery is wired with extraction in plan Phase 2.
        if acted:
            logger.info("recover_stuck: re-dispatched/failed %d document(s)", acted)
        return acted

    async def extract_cv_profile(self, *, user_id: str, document_id: str) -> None:
        """Phase 2: processor.extract(ResumeSchema) → upsert_cv_draft (UNCONFIRMED).
        Injection waits until the user confirms (plan decision #10)."""
        raise NotImplementedError("Wired in plan Phase 2")

    async def build_thread_document_context(
        self, *, user_id: str, thread_id: str, latest_user_message: str
    ) -> str:
        """Compact 'documents in this thread' block for the agent prompt.

        Summary-only by default (plan decision #12) — inlining a full file is a
        Phase 1 concern for the just-uploaded/referenced doc. Scoped to
        (thread_id, user_id) so it can never surface another user's files.
        """
        docs = await self._store.list_thread_documents(thread_id, user_id)
        ready = [d for d in docs if d.status == "ready" and d.summary]
        if not ready:
            return ""
        lines = [f"- {d.filename}: {d.summary}" for d in ready]
        return "Documents attached in this conversation:\n" + "\n".join(lines)

    async def build_profile_context(self, *, user_id: str) -> str:
        """Compact CV facts for every chat — ONLY when the user has confirmed
        the extracted CV (cv_confirmed_at set; plan decision #10)."""
        profile = await self._store.get_profile(user_id)
        if profile is None or not profile.is_confirmed or not profile.cv_summary:
            return ""
        return f"The user's CV (confirmed):\n{profile.cv_summary}"
