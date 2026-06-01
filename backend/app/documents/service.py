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

from pydantic import ValidationError

from app.documents.base import (
    BlobStorePort,
    DocPurpose,
    DocStatus,
    DocumentError,
    DocumentProcessorPort,
    DocumentRetrievalPort,
)
from app.documents.schemas import ResumeSchema
from app.documents.store import DocumentNotFoundError, DocumentStore
from app.services.thread_store import ThreadNotFoundError, ThreadStore

logger = logging.getLogger(__name__)

# Recovery loop tuning (plan decision #11).
MAX_PROCESSING_ATTEMPTS = 3
STALE_PROCESSING_SECONDS = 300

# Per-document cap on text injected into the agent prompt. ~12k chars ≈ ~3k
# tokens — generous for a typed CV/letter, bounded so a large doc can't blow
# the turn's context. (Retrieval/RAG is the Phase 4 answer for big documents.)
DOC_CONTEXT_CHAR_CAP = 12_000


def blob_key(user_id: str, document_id: str) -> str:
    """Deterministic BlobStore key for a document's raw bytes."""
    return f"{user_id}/{document_id}"


# Compact CV facts (a few hundred chars) injected into every chat once the user
# confirms (plan decision #14: CV keeps compact facts, not raw text). Built
# deterministically from the validated schema — no extra LLM call, nothing to
# hallucinate. Mirrors the density of `_build_profile_lines` in the agent.
_CV_SUMMARY_CHAR_CAP = 1_200


def _build_cv_summary(resume: ResumeSchema) -> str:
    parts: list[str] = [f"Name: {resume.name}"]
    if resume.location:
        parts.append(f"Location: {resume.location}")
    if resume.work_experience:
        recent = resume.work_experience[:3]
        roles = "; ".join(
            " ".join(
                seg
                for seg in (
                    w.position,
                    w.company and f"at {w.company}",
                    (w.start_date or w.end_date)
                    and f"({w.start_date or '?'}–{w.end_date or '?'})",
                )
                if seg
            )
            for w in recent
        )
        parts.append(f"Experience: {roles}")
    if resume.education:
        edu = "; ".join(
            " ".join(
                seg
                for seg in (
                    e.degree,
                    e.field_of_study and f"in {e.field_of_study}",
                    e.institution and f"at {e.institution}",
                    e.graduation_date and f"({e.graduation_date})",
                )
                if seg
            )
            for e in resume.education[:3]
        )
        parts.append(f"Education: {edu}")
    if resume.skills:
        parts.append("Skills: " + ", ".join(resume.skills[:15]))
    if resume.languages:
        parts.append("Languages: " + ", ".join(resume.languages))
    if resume.certifications:
        parts.append("Certifications: " + ", ".join(resume.certifications[:8]))
    if resume.summary:
        parts.append(f"Summary: {resume.summary}")
    return "\n".join(parts)[:_CV_SUMMARY_CHAR_CAP]


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
                # Persist the full parsed text so the agent can read the whole
                # document (a 600-char summary is too thin for e.g. CV review).
                extracted_text=parsed.markdown or None,
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
            elif doc.purpose == DocPurpose.PROFILE_CV:
                await self.extract_cv_profile(
                    user_id=doc.user_id, document_id=doc.id
                )
        if acted:
            logger.info("recover_stuck: re-dispatched/failed %d document(s)", acted)
        return acted

    async def extract_cv_profile(self, *, user_id: str, document_id: str) -> None:
        """Load bytes → processor.extract(ResumeSchema) → store an UNCONFIRMED
        CV draft (plan decision #10). The draft prefills /profile immediately
        but is NOT injected into chats until the user clicks Save.

        Runs in a BackgroundTask. Like process_chat_upload it never raises —
        failures land as status='failed' so the recovery loop and the UI can
        react (the /profile page then offers manual entry, decision #10)."""
        try:
            doc = await self._store.claim_for_processing(document_id)
            data = await self._blobs.get(key=blob_key(user_id, document_id))
            parsed = await self._processor.extract(
                data=data,
                filename=doc.filename,
                mime_type=doc.mime_type,
                schema=ResumeSchema.model_json_schema(),
            )
            # Validate the model's JSON against the canonical schema. Engine
            # -agnostic on purpose: the processor stays a generic dict-in/out
            # vendor seam (plan decision #4); CV semantics live here.
            try:
                resume = ResumeSchema.model_validate(parsed.structured or {})
            except ValidationError as exc:
                raise DocumentError(
                    f"extracted CV did not match the expected shape: {exc}"
                ) from exc
            structured = resume.model_dump()
            summary = _build_cv_summary(resume)
            # Draft → promote: cv_confirmed_at stays NULL (upsert_cv_draft), so
            # build_profile_context won't inject this until the user saves.
            await self._store.upsert_cv_draft(
                user_id=user_id,
                cv_document_id=document_id,
                structured=structured,
                summary=summary,
            )
            await self._store.update_document(
                document_id,
                status=DocStatus.READY,
                summary=summary,
                # CV is PII (decision #14): keep compact structured facts, not
                # the raw text. extracted_json holds the validated CV.
                extracted_json=structured,
                page_count=parsed.page_count,
                provider=parsed.provider,
                provider_file_id=parsed.provider_file_id,
                error_message=None,
            )
        except DocumentNotFoundError:
            logger.warning("extract_cv_profile: document %s vanished", document_id)
        except Exception as exc:  # noqa: BLE001 — record, don't crash the worker
            logger.warning("extract_cv_profile failed for %s: %s", document_id, exc)
            try:
                await self._store.update_document(
                    document_id, status=DocStatus.FAILED, error_message=str(exc)[:500]
                )
            except DocumentNotFoundError:
                pass

    async def build_thread_document_context(
        self, *, user_id: str, thread_id: str, latest_user_message: str
    ) -> str:
        """Compact 'documents in this thread' block for the agent prompt.

        Summary-only by default (plan decision #12) — inlining a full file is a
        Phase 1 concern for the just-uploaded/referenced doc. Scoped to
        (thread_id, user_id) so it can never surface another user's files.
        """
        docs = await self._store.list_thread_documents(thread_id, user_id)
        ready = [d for d in docs if d.status == "ready"]
        blocks: list[str] = []
        for d in ready:
            # Prefer the full parsed text so the agent can read the whole
            # document; fall back to the summary for older/empty rows.
            content = (d.extracted_text or d.summary or "").strip()
            if not content:
                continue
            if len(content) > DOC_CONTEXT_CHAR_CAP:
                content = content[:DOC_CONTEXT_CHAR_CAP] + "\n…[truncated]"
            blocks.append(f"### {d.filename}\n{content}")
        if not blocks:
            return ""
        return (
            "Full text of documents the user attached in this conversation:\n\n"
            + "\n\n".join(blocks)
        )

    async def get_cv_profile(self, *, user_id: str):
        """The user's CV profile row (draft or confirmed), or None."""
        return await self._store.get_profile(user_id)

    async def confirm_cv_profile(self, *, user_id: str, resume: ResumeSchema):
        """Persist the user-edited CV and mark it confirmed (plan decision #10).

        Recomputes the compact summary from the (possibly edited) fields, then
        sets cv_confirmed_at — from here `build_profile_context` injects it into
        every chat."""
        structured = resume.model_dump()
        summary = _build_cv_summary(resume)
        return await self._store.confirm_cv(
            user_id=user_id, structured=structured, summary=summary
        )

    async def build_profile_context(self, *, user_id: str) -> str:
        """Compact CV facts for every chat — ONLY when the user has confirmed
        the extracted CV (cv_confirmed_at set; plan decision #10)."""
        profile = await self._store.get_profile(user_id)
        if profile is None or not profile.is_confirmed or not profile.cv_summary:
            return ""
        return f"The user's CV (confirmed):\n{profile.cv_summary}"
