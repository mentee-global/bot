from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ThreadRecord(Base):
    __tablename__ = "threads"
    __table_args__ = (Index("ix_threads_user_id_updated_at", "user_id", "updated_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MessageRecord(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_thread_id_created_at", "thread_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    thread_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(String())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MessageDocumentRecord(Base):
    """Documents attached to a specific chat message."""

    __tablename__ = "message_documents"
    __table_args__ = (
        UniqueConstraint("message_id", "document_id", name="uq_message_documents_msg_doc"),
        Index("ix_message_documents_document_id", "document_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    message_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE")
    )
    document_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )


class MessageRatingRecord(Base):
    """Per-user thumbs feedback on assistant messages.

    Wire protocol uses 0 to mean "clear" but the column itself is constrained
    to ±1 — the service layer deletes the row when a clear comes in. This
    keeps `LEFT JOIN message_ratings` queries simple: present row = active
    rating, missing row = no rating.
    """

    __tablename__ = "message_ratings"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_message_ratings_user_msg"),
        CheckConstraint("rating IN (-1, 1)", name="ck_message_ratings_rating"),
        Index("ix_message_ratings_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    message_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE")
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    rating: Mapped[int] = mapped_column(SmallInteger())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ThreadRatingRecord(Base):
    """Per-conversation 1–5 star rating with optional comment.

    Sibling to `MessageRatingRecord` but scoped to the whole thread, not a
    single message. Cardinality is enforced by `UNIQUE (thread_id)` so the
    upsert can target the conflict directly. The `comment` column is bounded
    at 200 chars by a CHECK in addition to the Pydantic-side limit.
    """

    __tablename__ = "thread_ratings"
    __table_args__ = (
        UniqueConstraint("thread_id", name="uq_thread_ratings_thread"),
        CheckConstraint("stars BETWEEN 1 AND 5", name="ck_thread_ratings_stars"),
        CheckConstraint(
            "comment IS NULL OR char_length(comment) <= 200",
            name="ck_thread_ratings_comment_len",
        ),
        Index("ix_thread_ratings_user_id", "user_id"),
        Index("ix_thread_ratings_stars_created_at", "stars", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), default=uuid4, info={"init_default": uuid4}, primary_key=True
    )
    thread_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE")
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    stars: Mapped[int] = mapped_column(SmallInteger())
    comment: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FeedbackTriggerConfigRecord(Base):
    """Single-row config that drives the in-chat session rating prompt cadence.

    Singleton enforced by `id = 1` PK + CHECK. The seed row is created by
    the `add_feedback_trigger_config` migration so reads always succeed —
    admins flip fields in place via `PUT /api/admin/config/feedback-trigger`.
    """

    __tablename__ = "feedback_trigger_config"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_feedback_trigger_config_singleton"),
        CheckConstraint(
            "mode IN ('interactions', 'time')",
            name="ck_feedback_trigger_config_mode",
        ),
        CheckConstraint(
            "interactions_first >= 1",
            name="ck_feedback_trigger_config_interactions_first",
        ),
        CheckConstraint(
            "interactions_repeat >= 1",
            name="ck_feedback_trigger_config_interactions_repeat",
        ),
        CheckConstraint(
            "time_first_minutes >= 1",
            name="ck_feedback_trigger_config_time_first",
        ),
        CheckConstraint(
            "time_repeat_minutes >= 1",
            name="ck_feedback_trigger_config_time_repeat",
        ),
        CheckConstraint(
            "re_rate_after_messages >= 0",
            name="ck_feedback_trigger_config_re_rate",
        ),
    )

    id: Mapped[int] = mapped_column(
        SmallInteger(), default=1, info={"init_default": 1}, primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean(), default=True, info={"init_default": True})
    mode: Mapped[str] = mapped_column(
        Text(), default="interactions", info={"init_default": "interactions"}
    )
    interactions_first: Mapped[int] = mapped_column(Integer(), default=5, info={"init_default": 5})
    interactions_repeat: Mapped[int] = mapped_column(
        Integer(), default=15, info={"init_default": 15}
    )
    # Stored as minutes; UI converts to days/hours for display.
    time_first_minutes: Mapped[int] = mapped_column(
        Integer(), default=1440, info={"init_default": 1440}
    )
    time_repeat_minutes: Mapped[int] = mapped_column(
        Integer(), default=10080, info={"init_default": 10080}
    )
    # If > 0, a rated thread can be re-asked once the user has sent this many
    # more messages within that conversation. 0 = rated threads are locked
    # forever (the historical default).
    re_rate_after_messages: Mapped[int] = mapped_column(
        Integer(), default=0, info={"init_default": 0}
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
