from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocumentRecord(Base):
    """An uploaded document — chat attachment or profile CV.

    Ownership invariant (plan decision #15): for `purpose='chat_attachment'`
    the row's `user_id` MUST equal the owning thread's `user_id`. This is
    enforced in `DocumentService` (composite `(thread_id, user_id)` lookup
    before insert), since a cross-table CHECK isn't expressible here. A NULL
    `thread_id` is only valid for `purpose='profile_cv'`.
    """

    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_user_thread", "user_id", "thread_id"),
        Index("ix_documents_file_hash", "file_hash"),
        # Recovery loop (plan decision #11) scans by (status, processing_started_at).
        Index("ix_documents_status_started", "status", "processing_started_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    thread_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=True
    )
    purpose: Mapped[str] = mapped_column(String(32))  # DocPurpose
    filename: Mapped[str] = mapped_column(Text())
    mime_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(Integer())
    status: Mapped[str] = mapped_column(
        String(16), default="pending", info={"init_default": "pending"}
    )  # DocStatus

    # Recovery / durability (plan decision #11).
    attempts: Mapped[int] = mapped_column(Integer(), default=0, info={"init_default": 0})
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_file_id: Mapped[str | None] = mapped_column(Text(), nullable=True)
    storage_uri: Mapped[str | None] = mapped_column(Text(), nullable=True)
    file_hash: Mapped[str] = mapped_column(String(64))  # sha256 — dedupe / cache key

    summary: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # PII: populated only when genuinely needed (plan decision #14).
    extracted_text: Mapped[str | None] = mapped_column(Text(), nullable=True)
    extracted_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # Credits debited for model-backed OCR of this document (CVs). 0 for chat
    # attachments and local-decode formats, which cost no model spend. Surfaced
    # to the user so they can see what reading their CV cost.
    ocr_credits_charged: Mapped[int] = mapped_column(Integer(), default=0, info={"init_default": 0})

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserProfileRecord(Base):
    """1:1 with users — the things the bot should know about a mentee beyond
    their Mentee-platform profile: an uploaded CV and a free-text "about me".

    The CV's faithful Markdown transcription lives on its `DocumentRecord`
    (`extracted_text`); this row just points at the active CV
    (`cv_document_id`) and stamps `cv_confirmed_at` when it's ready to inject.
    `about_me` is user-authored prose, injected into every chat as-is.
    """

    __tablename__ = "user_profile"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    cv_document_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    # Set when a CV finishes OCR; the confirmed CV's Markdown is injected into
    # chats while this is non-NULL and `cv_document_id` still resolves.
    cv_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Free-text prose the mentee wants the bot to remember about them, so they
    # don't have to repeat it in every thread. Injected into every chat.
    about_me: Mapped[str | None] = mapped_column(Text(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
