from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class DocumentRecord(SQLModel, table=True):
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

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    user_id: UUID = Field(
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    thread_id: UUID | None = Field(
        default=None,
        foreign_key="threads.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    purpose: str = Field(max_length=32)  # DocPurpose
    filename: str = Field(sa_type=Text())
    mime_type: str = Field(max_length=128)
    size_bytes: int = Field(sa_type=Integer())
    status: str = Field(default="pending", max_length=16)  # DocStatus

    # Recovery / durability (plan decision #11).
    attempts: int = Field(default=0, sa_type=Integer())
    processing_started_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )

    provider: str | None = Field(default=None, max_length=32)
    provider_file_id: str | None = Field(default=None, sa_type=Text())
    storage_uri: str | None = Field(default=None, sa_type=Text())
    file_hash: str = Field(max_length=64)  # sha256 — dedupe / cache key

    summary: str | None = Field(default=None, sa_type=Text())
    # PII: populated only when genuinely needed (plan decision #14).
    extracted_text: str | None = Field(default=None, sa_type=Text())
    extracted_json: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    error_message: str | None = Field(default=None, sa_type=Text())
    page_count: int | None = Field(default=None, sa_type=Integer())

    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class UserProfileRecord(SQLModel, table=True):
    """1:1 with users — the things the bot should know about a mentee beyond
    their Mentee-platform profile: an uploaded CV and a free-text "about me".

    The CV's faithful Markdown transcription lives on its `DocumentRecord`
    (`extracted_text`); this row just points at the active CV
    (`cv_document_id`) and stamps `cv_confirmed_at` when it's ready to inject.
    `about_me` is user-authored prose, injected into every chat as-is.
    """

    __tablename__ = "user_profile"

    user_id: UUID = Field(
        primary_key=True,
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    cv_document_id: UUID | None = Field(
        default=None,
        foreign_key="documents.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="SET NULL",
    )
    # Set when a CV finishes OCR; the confirmed CV's Markdown is injected into
    # chats while this is non-NULL and `cv_document_id` still resolves.
    cv_confirmed_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    # Free-text prose the mentee wants the bot to remember about them, so they
    # don't have to repeat it in every thread. Injected into every chat.
    about_me: str | None = Field(default=None, sa_type=Text())
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))
