"""DocumentStore port + in-memory and Postgres implementations.

Mirrors `app/services/thread_store.py`: pick the impl via `settings.store_impl`
("memory" for tests/local, "postgres" for real deploys). Every read/write is
gated by `user_id` so one user can't touch another's documents (plan #15).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.engine import async_session_factory
from app.documents.db_models import DocumentRecord, UserProfileRecord
from app.domain.models import CvProfile, Document


def _now() -> datetime:
    return datetime.now(UTC)


class DocumentNotFoundError(Exception):
    """Raised when a document lookup returns nothing the caller can own."""


def _as_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _doc_from_record(r: DocumentRecord) -> Document:
    return Document(
        id=str(r.id),
        user_id=str(r.user_id),
        thread_id=str(r.thread_id) if r.thread_id else None,
        purpose=r.purpose,
        filename=r.filename,
        mime_type=r.mime_type,
        size_bytes=r.size_bytes,
        status=r.status,
        attempts=r.attempts,
        processing_started_at=r.processing_started_at,
        provider=r.provider,
        file_hash=r.file_hash,
        summary=r.summary,
        extracted_json=r.extracted_json,
        error_message=r.error_message,
        page_count=r.page_count,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _profile_from_record(r: UserProfileRecord) -> CvProfile:
    return CvProfile(
        user_id=str(r.user_id),
        cv_document_id=str(r.cv_document_id) if r.cv_document_id else None,
        cv_structured=r.cv_structured,
        cv_summary=r.cv_summary,
        cv_confirmed_at=r.cv_confirmed_at,
        updated_at=r.updated_at,
    )


# Fields the service is allowed to patch post-create (async processing results).
_MUTABLE = {
    "status",
    "provider",
    "provider_file_id",
    "storage_uri",
    "summary",
    "extracted_text",
    "extracted_json",
    "error_message",
    "page_count",
    "attempts",
    "processing_started_at",
}


class DocumentStore(ABC):
    @abstractmethod
    async def create_document(
        self,
        *,
        user_id: str,
        thread_id: str | None,
        purpose: str,
        filename: str,
        mime_type: str,
        size_bytes: int,
        file_hash: str,
        storage_uri: str | None = None,
    ) -> Document: ...

    @abstractmethod
    async def get_document(self, document_id: str, user_id: str) -> Document:
        """User-scoped read. Raises DocumentNotFoundError on miss/wrong owner."""

    @abstractmethod
    async def list_thread_documents(
        self, thread_id: str, user_id: str
    ) -> list[Document]: ...

    @abstractmethod
    async def update_document(self, document_id: str, /, **fields) -> Document:
        """Patch processing-result fields (see `_MUTABLE`). Not user-scoped —
        called from the background worker which already resolved ownership."""

    @abstractmethod
    async def claim_for_processing(self, document_id: str) -> Document:
        """Mark a document `processing`: set processing_started_at=now and
        increment attempts, atomically. Called as a worker picks it up."""

    @abstractmethod
    async def list_recoverable(self, *, stale_before: datetime) -> list[Document]:
        """Documents needing attention: still `pending`, or `processing` but
        started before `stale_before` (orphaned by a crash/redeploy). The
        attempts/retry decision is the caller's (recover_stuck), so rows at the
        attempt cap still surface here and can be failed (plan #11)."""

    @abstractmethod
    async def delete_document(self, document_id: str, user_id: str) -> None: ...

    @abstractmethod
    async def get_profile(self, user_id: str) -> CvProfile | None: ...

    @abstractmethod
    async def upsert_cv_draft(
        self,
        *,
        user_id: str,
        cv_document_id: str,
        structured: dict,
        summary: str,
    ) -> CvProfile:
        """Write an UNCONFIRMED draft (cv_confirmed_at stays NULL)."""

    @abstractmethod
    async def confirm_cv(
        self, *, user_id: str, structured: dict, summary: str
    ) -> CvProfile:
        """Persist the (possibly edited) CV and set cv_confirmed_at."""


class InMemoryDocumentStore(DocumentStore):
    """Dict-backed store for tests and local dev (store_impl='memory')."""

    def __init__(self) -> None:
        self._docs: dict[str, Document] = {}
        self._profiles: dict[str, CvProfile] = {}

    async def create_document(
        self,
        *,
        user_id: str,
        thread_id: str | None,
        purpose: str,
        filename: str,
        mime_type: str,
        size_bytes: int,
        file_hash: str,
        storage_uri: str | None = None,
    ) -> Document:
        doc = Document(
            user_id=user_id,
            thread_id=thread_id,
            purpose=purpose,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            file_hash=file_hash,
        )
        self._docs[doc.id] = doc
        return doc

    async def get_document(self, document_id: str, user_id: str) -> Document:
        doc = self._docs.get(document_id)
        if doc is None or doc.user_id != user_id:
            raise DocumentNotFoundError(document_id)
        return doc

    async def list_thread_documents(
        self, thread_id: str, user_id: str
    ) -> list[Document]:
        return [
            d
            for d in self._docs.values()
            if d.thread_id == thread_id and d.user_id == user_id
        ]

    async def update_document(self, document_id: str, /, **fields) -> Document:
        doc = self._docs.get(document_id)
        if doc is None:
            raise DocumentNotFoundError(document_id)
        updated = doc.model_copy(
            update={k: v for k, v in fields.items() if k in _MUTABLE}
            | {"updated_at": _now()}
        )
        self._docs[document_id] = updated
        return updated

    async def claim_for_processing(self, document_id: str) -> Document:
        doc = self._docs.get(document_id)
        if doc is None:
            raise DocumentNotFoundError(document_id)
        updated = doc.model_copy(
            update={
                "status": "processing",
                "processing_started_at": _now(),
                "attempts": doc.attempts + 1,
                "updated_at": _now(),
            }
        )
        self._docs[document_id] = updated
        return updated

    async def list_recoverable(self, *, stale_before: datetime) -> list[Document]:
        out: list[Document] = []
        for d in self._docs.values():
            if d.status == "pending":
                out.append(d)
            elif d.status == "processing" and (
                d.processing_started_at is None
                or d.processing_started_at < stale_before
            ):
                out.append(d)
        return out

    async def delete_document(self, document_id: str, user_id: str) -> None:
        doc = self._docs.get(document_id)
        if doc is None or doc.user_id != user_id:
            raise DocumentNotFoundError(document_id)
        del self._docs[document_id]

    async def get_profile(self, user_id: str) -> CvProfile | None:
        return self._profiles.get(user_id)

    async def upsert_cv_draft(
        self, *, user_id: str, cv_document_id: str, structured: dict, summary: str
    ) -> CvProfile:
        profile = CvProfile(
            user_id=user_id,
            cv_document_id=cv_document_id,
            cv_structured=structured,
            cv_summary=summary,
            cv_confirmed_at=None,
        )
        self._profiles[user_id] = profile
        return profile

    async def confirm_cv(
        self, *, user_id: str, structured: dict, summary: str
    ) -> CvProfile:
        existing = self._profiles.get(user_id)
        profile = CvProfile(
            user_id=user_id,
            cv_document_id=existing.cv_document_id if existing else None,
            cv_structured=structured,
            cv_summary=summary,
            cv_confirmed_at=_now(),
        )
        self._profiles[user_id] = profile
        return profile


class PostgresDocumentStore(DocumentStore):
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession] | None = None
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def create_document(
        self,
        *,
        user_id: str,
        thread_id: str | None,
        purpose: str,
        filename: str,
        mime_type: str,
        size_bytes: int,
        file_hash: str,
        storage_uri: str | None = None,
    ) -> Document:
        now = _now()
        record = DocumentRecord(
            user_id=_as_uuid(user_id),
            thread_id=_as_uuid(thread_id) if thread_id else None,
            purpose=purpose,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            file_hash=file_hash,
            storage_uri=storage_uri,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        async with self._factory() as session:
            session.add(record)
            await session.commit()
            await session.refresh(record)
            return _doc_from_record(record)

    async def get_document(self, document_id: str, user_id: str) -> Document:
        async with self._factory() as session:
            record = await session.get(DocumentRecord, _as_uuid(document_id))
            if record is None or record.user_id != _as_uuid(user_id):
                raise DocumentNotFoundError(document_id)
            return _doc_from_record(record)

    async def list_thread_documents(
        self, thread_id: str, user_id: str
    ) -> list[Document]:
        async with self._factory() as session:
            stmt = (
                select(DocumentRecord)
                .where(DocumentRecord.thread_id == _as_uuid(thread_id))
                .where(DocumentRecord.user_id == _as_uuid(user_id))
                .order_by(DocumentRecord.created_at.asc())
            )
            rows = (await session.execute(stmt)).scalars().all()
            return [_doc_from_record(r) for r in rows]

    async def update_document(self, document_id: str, /, **fields) -> Document:
        patch = {k: v for k, v in fields.items() if k in _MUTABLE}
        patch["updated_at"] = _now()
        async with self._factory() as session:
            stmt = (
                update(DocumentRecord)
                .where(DocumentRecord.id == _as_uuid(document_id))
                .values(**patch)
                .returning(DocumentRecord)
            )
            record = (await session.execute(stmt)).scalar_one_or_none()
            if record is None:
                raise DocumentNotFoundError(document_id)
            await session.commit()
            return _doc_from_record(record)

    async def claim_for_processing(self, document_id: str) -> Document:
        now = _now()
        async with self._factory() as session:
            stmt = (
                update(DocumentRecord)
                .where(DocumentRecord.id == _as_uuid(document_id))
                .values(
                    status="processing",
                    processing_started_at=now,
                    attempts=DocumentRecord.attempts + 1,
                    updated_at=now,
                )
                .returning(DocumentRecord)
            )
            record = (await session.execute(stmt)).scalar_one_or_none()
            if record is None:
                raise DocumentNotFoundError(document_id)
            await session.commit()
            return _doc_from_record(record)

    async def list_recoverable(self, *, stale_before: datetime) -> list[Document]:
        async with self._factory() as session:
            stmt = (
                select(DocumentRecord)
                .where(
                    (DocumentRecord.status == "pending")
                    | (
                        (DocumentRecord.status == "processing")
                        & (
                            (DocumentRecord.processing_started_at.is_(None))
                            | (DocumentRecord.processing_started_at < stale_before)
                        )
                    )
                )
                .order_by(DocumentRecord.created_at.asc())
            )
            rows = (await session.execute(stmt)).scalars().all()
            return [_doc_from_record(r) for r in rows]

    async def delete_document(self, document_id: str, user_id: str) -> None:
        async with self._factory() as session:
            record = await session.get(DocumentRecord, _as_uuid(document_id))
            if record is None or record.user_id != _as_uuid(user_id):
                raise DocumentNotFoundError(document_id)
            await session.delete(record)
            await session.commit()

    async def get_profile(self, user_id: str) -> CvProfile | None:
        async with self._factory() as session:
            record = await session.get(UserProfileRecord, _as_uuid(user_id))
            return _profile_from_record(record) if record else None

    async def upsert_cv_draft(
        self, *, user_id: str, cv_document_id: str, structured: dict, summary: str
    ) -> CvProfile:
        return await self._upsert_profile(
            user_id=user_id,
            cv_document_id=cv_document_id,
            structured=structured,
            summary=summary,
            confirmed_at=None,
        )

    async def confirm_cv(
        self, *, user_id: str, structured: dict, summary: str
    ) -> CvProfile:
        return await self._upsert_profile(
            user_id=user_id,
            cv_document_id=None,
            structured=structured,
            summary=summary,
            confirmed_at=_now(),
        )

    async def _upsert_profile(
        self,
        *,
        user_id: str,
        cv_document_id: str | None,
        structured: dict,
        summary: str,
        confirmed_at: datetime | None,
    ) -> CvProfile:
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            record = await session.get(UserProfileRecord, uid)
            now = _now()
            if record is None:
                record = UserProfileRecord(user_id=uid, updated_at=now)
                session.add(record)
            record.cv_structured = structured
            record.cv_summary = summary
            record.cv_confirmed_at = confirmed_at
            if cv_document_id is not None:
                record.cv_document_id = _as_uuid(cv_document_id)
            record.updated_at = now
            await session.commit()
            await session.refresh(record)
            return _profile_from_record(record)
