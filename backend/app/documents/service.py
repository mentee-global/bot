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

from app.budget.service import BudgetService
from app.budget.usage import UsageSummary
from app.documents.base import (
    AttachmentFile,
    BlobStorePort,
    DocPurpose,
    DocStatus,
    DocumentError,
    DocumentProcessorPort,
    DocumentRetrievalPort,
)
from app.documents.store import DocumentNotFoundError, DocumentStore
from app.domain.models import MessageAttachment
from app.services.thread_store import ThreadNotFoundError, ThreadStore

logger = logging.getLogger(__name__)

# Recovery loop tuning (plan decision #11).
MAX_PROCESSING_ATTEMPTS = 3
STALE_PROCESSING_SECONDS = 300

# Per-document cap on text injected into the agent prompt. ~12k chars ≈ ~3k
# tokens — generous for a CV/letter, bounded so a large doc can't blow the
# turn's context. (Retrieval/RAG is the Phase 4 answer for big documents.)
DOC_CONTEXT_CHAR_CAP = 12_000
# "About me" is user-authored prose; keep it short enough to inject every turn.
ABOUT_CONTEXT_CHAR_CAP = 4_000
# Chat attachments are re-sent to the model as native input on EVERY turn in the
# thread so a file stays "visible" in a long conversation. Bound that so a thread
# with many/large files can't blow the turn's context/cost: keep the most recent
# files within these caps (older ones beyond the cap are dropped, with a log).
THREAD_ATTACHMENT_MAX_FILES = 6
THREAD_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024


# Top-level bucket folders, one per document purpose, so CVs and chat
# attachments are stored separately (matches the bot-bucket layout).
_PURPOSE_FOLDER = {
    DocPurpose.PROFILE_CV: "CVs",
    DocPurpose.CHAT_ATTACHMENT: "ChatDocuments",
}


def _folder(purpose: str) -> str:
    return _PURPOSE_FOLDER.get(DocPurpose(purpose), "misc")


def blob_key(user_id: str, document_id: str, purpose: str) -> str:
    """Deterministic BlobStore key for a document's raw bytes, namespaced by
    purpose-folder then user (e.g. `CVs/<user>/<doc>`)."""
    return f"{_folder(purpose)}/{user_id}/{document_id}"


def cv_markdown_key(user_id: str, document_id: str) -> str:
    """BlobStore key for a CV's faithful Markdown transcription, stored next to
    the raw file in the CVs/ folder (user ask: keep the OCR output in the
    bucket with the file)."""
    return f"{_folder(DocPurpose.PROFILE_CV)}/{user_id}/{document_id}.md"


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
        budget: BudgetService | None = None,
    ) -> None:
        self._store = store
        self._blobs = blobs
        self._processor = processor
        self._threads = threads
        self._retrieval = retrieval
        # Optional so tests / non-billing deployments construct without it.
        # When set, CV OCR debits credits for its model spend.
        self._budget = budget

    async def assert_thread_owned(self, *, user_id: str, thread_id: str) -> None:
        """Plan decision #15: prove the thread belongs to the user BEFORE any
        write. Reuses the user-scoped ThreadStore lookup."""
        try:
            await self._threads.get_thread(thread_id, user_id)
        except ThreadNotFoundError as exc:
            raise ThreadOwnershipError(thread_id) from exc

    async def message_attachments(
        self, *, user_id: str, thread_id: str, document_ids: list[str]
    ) -> list[MessageAttachment]:
        """Validate document ids supplied with a chat turn.

        Every id must resolve to a ready chat attachment owned by `user_id` and
        scoped to `thread_id`; anything else is treated as not found.
        """
        attachments: list[MessageAttachment] = []
        seen: set[str] = set()
        for document_id in document_ids:
            if document_id in seen:
                continue
            seen.add(document_id)
            try:
                doc = await self._store.get_document(document_id, user_id)
            except (DocumentNotFoundError, ValueError) as exc:
                raise DocumentNotFoundError(document_id) from exc
            if (
                doc.thread_id != thread_id
                or doc.purpose != DocPurpose.CHAT_ATTACHMENT
                or doc.status != DocStatus.READY
            ):
                raise DocumentNotFoundError(document_id)
            attachments.append(
                MessageAttachment(
                    document_id=doc.id,
                    filename=doc.filename,
                    status=doc.status,
                )
            )
        return attachments

    async def load_thread_attachments(
        self, *, user_id: str, thread_id: str
    ) -> list[AttachmentFile]:
        """Raw bytes of EVERY ready chat attachment in the thread, so the agent
        reads them as native multimodal input (pydantic-ai BinaryContent) on
        every turn — a file stays visible across a long conversation, not just
        the turn it was uploaded. No OCR, no Markdown.

        Bounded by THREAD_ATTACHMENT_MAX_FILES / _MAX_BYTES, keeping the most
        recent files; anything beyond the cap is dropped (logged, not silent).
        Scoped to (thread_id, user_id) by the store, so it can't surface another
        user's or thread's files."""
        docs = await self._store.list_thread_documents(thread_id, user_id)
        ready = [
            d
            for d in docs
            if d.purpose == DocPurpose.CHAT_ATTACHMENT
            and d.status == DocStatus.READY
        ]
        # Newest first so the cap keeps the most recently shared files.
        ready.sort(key=lambda d: d.created_at, reverse=True)
        files: list[AttachmentFile] = []
        total = 0
        dropped = 0
        for d in ready:
            if (
                len(files) >= THREAD_ATTACHMENT_MAX_FILES
                or total + d.size_bytes > THREAD_ATTACHMENT_MAX_BYTES
            ):
                dropped += 1
                continue
            try:
                data = await self._blobs.get(
                    key=blob_key(user_id, d.id, d.purpose)
                )
            except Exception as exc:  # noqa: BLE001 — skip an unreadable blob
                logger.warning("attachment blob load failed for %s: %s", d.id, exc)
                continue
            files.append(
                AttachmentFile(filename=d.filename, mime_type=d.mime_type, data=data)
            )
            total += len(data)
        if dropped:
            logger.info(
                "thread %s: %d older attachment(s) over the per-turn cap not sent",
                thread_id,
                dropped,
            )
        files.reverse()  # back to chronological order for the model
        return files

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
            # Only CVs are processed asynchronously now; chat attachments are
            # marked ready on upload (read natively by the agent, no OCR).
            if doc.purpose == DocPurpose.PROFILE_CV:
                await self.process_cv_upload(
                    user_id=doc.user_id, document_id=doc.id
                )
        if acted:
            logger.info("recover_stuck: re-dispatched/failed %d document(s)", acted)
        return acted

    async def process_cv_upload(self, *, user_id: str, document_id: str) -> None:
        """Load bytes → processor.parse() (OCR) → store the faithful Markdown
        transcription and activate it as the user's CV.

        The Markdown is persisted on the document (`extracted_text`) for
        injection AND written next to the raw file in the bucket (user ask).
        `set_cv` stamps cv_confirmed_at so it flows into every chat via
        `build_profile_context`.

        Runs in a BackgroundTask; never raises — failures land as
        status='failed' so the recovery loop and the UI can react."""
        try:
            doc = await self._store.claim_for_processing(document_id)
            # The CV currently active (if any) — replaced once this one is ready.
            prev = await self._store.get_profile(user_id)
            prev_cv_id = prev.cv_document_id if prev else None
            data = await self._blobs.get(
                key=blob_key(user_id, document_id, doc.purpose)
            )
            parsed = await self._processor.parse(
                data=data, filename=doc.filename, mime_type=doc.mime_type
            )
            markdown = (parsed.markdown or "").strip()
            if not markdown:
                raise DocumentError("CV transcription produced no readable text")
            # Keep the OCR output in the bucket alongside the original file.
            try:
                await self._blobs.put(
                    key=cv_markdown_key(user_id, document_id),
                    data=markdown.encode("utf-8"),
                    content_type="text/markdown; charset=utf-8",
                )
            except Exception as exc:  # noqa: BLE001 — DB copy is the source of truth
                logger.warning(
                    "cv markdown blob write failed for %s: %s", document_id, exc
                )
            # Charge the user for the OCR model spend. The money is already
            # spent, so a billing hiccup must not fail the upload — log and ship
            # the CV anyway (credits_charged stays 0). Local-decode CVs carry no
            # tokens, so record_document_usage no-ops.
            credits_charged = 0
            if self._budget is not None:
                usage = UsageSummary(
                    openai_input_tokens=parsed.input_tokens,
                    openai_output_tokens=parsed.output_tokens,
                    openai_model_sku=parsed.model_sku,
                )
                try:
                    credits_charged = await self._budget.record_document_usage(
                        user_id=user_id, usage=usage, document_id=document_id
                    )
                except Exception as exc:  # noqa: BLE001 — never fail OCR on billing
                    logger.warning(
                        "cv ocr credit charge failed for %s: %s", document_id, exc
                    )
            await self._store.update_document(
                document_id,
                status=DocStatus.READY,
                summary=parsed.summary,
                extracted_text=markdown,
                page_count=parsed.page_count,
                provider=parsed.provider,
                provider_file_id=parsed.provider_file_id,
                ocr_credits_charged=credits_charged,
                error_message=None,
            )
            # Activate immediately: the transcription is faithful, so there's
            # nothing to "confirm" — the user can replace or remove it instead.
            await self._store.set_cv(user_id=user_id, cv_document_id=document_id)
            # Re-upload: drop the previous CV (row + raw + markdown blobs) so we
            # keep exactly one CV per user and don't orphan storage.
            if prev_cv_id and prev_cv_id != document_id:
                await self.purge_document(user_id=user_id, document_id=prev_cv_id)
        except DocumentNotFoundError:
            logger.warning("process_cv_upload: document %s vanished", document_id)
        except Exception as exc:  # noqa: BLE001 — record, don't crash the worker
            logger.warning("process_cv_upload failed for %s: %s", document_id, exc)
            try:
                await self._store.update_document(
                    document_id, status=DocStatus.FAILED, error_message=str(exc)[:500]
                )
            except DocumentNotFoundError:
                pass

    async def purge_document(self, *, user_id: str, document_id: str) -> None:
        """Best-effort removal of a document's row + all its blobs (raw, and the
        Markdown sidecar for a CV). Used on CV re-upload and hard deletes so the
        DB and bucket don't accumulate orphans. Never raises."""
        purpose = DocPurpose.CHAT_ATTACHMENT
        try:
            doc = await self._store.get_document(document_id, user_id)
            purpose = DocPurpose(doc.purpose)
        except (DocumentNotFoundError, ValueError):
            pass
        try:
            await self._store.delete_document(document_id, user_id)
        except DocumentNotFoundError:
            pass
        keys = [blob_key(user_id, document_id, purpose)]
        if purpose == DocPurpose.PROFILE_CV:
            keys.append(cv_markdown_key(user_id, document_id))
        for key in keys:
            try:
                await self._blobs.delete(key=key)
            except Exception as exc:  # noqa: BLE001 — best-effort cleanup
                logger.warning("blob delete failed for %s: %s", key, exc)

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
        """The user's profile row (CV link + about_me), or None."""
        return await self._store.get_profile(user_id)

    async def get_cv_markdown(
        self, *, user_id: str
    ) -> tuple[str | None, str | None, int]:
        """(filename, Markdown, ocr_credits_charged) of the active CV document,
        or (None, None, 0).

        Used by the /profile page to show the transcription back to the user
        and how many credits reading it cost.
        """
        profile = await self._store.get_profile(user_id)
        if profile is None or not profile.cv_document_id:
            return None, None, 0
        try:
            doc = await self._store.get_document(profile.cv_document_id, user_id)
        except DocumentNotFoundError:
            return None, None, 0
        return doc.filename, (doc.extracted_text or None), doc.ocr_credits_charged

    async def set_about_me(self, *, user_id: str, about_me: str | None):
        """Persist the user's free-text 'about me' (injected into every chat)."""
        cleaned = (about_me or "").strip() or None
        return await self._store.set_about_me(user_id=user_id, about_me=cleaned)

    async def build_profile_context(self, *, user_id: str) -> str:
        """The mentee's full CV transcription for every chat — only once a CV
        has finished OCR (cv_confirmed_at set) and its document still resolves.
        """
        profile = await self._store.get_profile(user_id)
        if profile is None or not profile.is_confirmed or not profile.cv_document_id:
            return ""
        try:
            doc = await self._store.get_document(profile.cv_document_id, user_id)
        except DocumentNotFoundError:
            return ""
        content = (doc.extracted_text or "").strip()
        if doc.status != DocStatus.READY or not content:
            return ""
        if len(content) > DOC_CONTEXT_CHAR_CAP:
            content = content[:DOC_CONTEXT_CHAR_CAP] + "\n…[truncated]"
        return f"The mentee's CV/resume (transcribed from their upload):\n{content}"

    async def build_about_context(self, *, user_id: str) -> str:
        """The mentee's free-text 'about me' for every chat, or ''."""
        profile = await self._store.get_profile(user_id)
        if profile is None or not profile.about_me or not profile.about_me.strip():
            return ""
        text = profile.about_me.strip()
        if len(text) > ABOUT_CONTEXT_CHAR_CAP:
            text = text[:ABOUT_CONTEXT_CHAR_CAP] + "\n…[truncated]"
        return text
