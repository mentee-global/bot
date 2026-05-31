"""DocumentService — engine-agnostic orchestration.

This is the layer that never changes when the processor is swapped
(OpenAI → LlamaParse). It owns: ownership checks, blob storage, calling the
processor, persisting results, and assembling the compact context the agent
sees. The processor only ever turns bytes into text/JSON.

Phase 0 ships the constructor, the context builders (functional), and the
ownership seam. The upload/extract pipelines are wired in plan Phase 1/2.
"""

from __future__ import annotations

from app.documents.base import (
    BlobStorePort,
    DocumentProcessorPort,
    DocumentRetrievalPort,
)
from app.documents.store import DocumentStore
from app.services.thread_store import ThreadNotFoundError, ThreadStore


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
        """Phase 1: load bytes → processor.parse() → persist summary + status.
        Runs in a BackgroundTask; sets processing_started_at / attempts and
        flips status pending→processing→ready|failed."""
        raise NotImplementedError("Wired in plan Phase 1")

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
