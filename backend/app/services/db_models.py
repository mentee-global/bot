from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class ThreadRecord(SQLModel, table=True):
    __tablename__ = "threads"
    __table_args__ = (
        Index("ix_threads_user_id_updated_at", "user_id", "updated_at"),
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
    title: str | None = Field(default=None, max_length=200)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class MessageRecord(SQLModel, table=True):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_thread_id_created_at", "thread_id", "created_at"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    thread_id: UUID = Field(
        foreign_key="threads.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    role: str = Field(max_length=16)
    body: str
    created_at: datetime = Field(sa_type=DateTime(timezone=True))


class MessageRatingRecord(SQLModel, table=True):
    """Per-user thumbs feedback on assistant messages.

    Wire protocol uses 0 to mean "clear" but the column itself is constrained
    to ±1 — the service layer deletes the row when a clear comes in. This
    keeps `LEFT JOIN message_ratings` queries simple: present row = active
    rating, missing row = no rating.
    """

    __tablename__ = "message_ratings"
    __table_args__ = (
        UniqueConstraint(
            "message_id", "user_id", name="uq_message_ratings_user_msg"
        ),
        CheckConstraint("rating IN (-1, 1)", name="ck_message_ratings_rating"),
        Index("ix_message_ratings_user_id", "user_id"),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    message_id: UUID = Field(
        foreign_key="messages.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    user_id: UUID = Field(
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    rating: int = Field(sa_type=SmallInteger())
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class ThreadRatingRecord(SQLModel, table=True):
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

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    thread_id: UUID = Field(
        foreign_key="threads.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    user_id: UUID = Field(
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    stars: int = Field(sa_type=SmallInteger())
    comment: str | None = Field(default=None, sa_type=Text())
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class FeedbackTriggerConfigRecord(SQLModel, table=True):
    """Single-row config that drives the in-chat session rating prompt cadence.

    Singleton enforced by `id = 1` PK + CHECK. The seed row is created by
    the `add_feedback_trigger_config` migration so reads always succeed —
    admins flip fields in place via `PUT /api/admin/config/feedback-trigger`.
    """

    __tablename__ = "feedback_trigger_config"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_feedback_trigger_config_singleton"),
        CheckConstraint(
            "mode IN ('interactions', 'time', 'hybrid')",
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

    id: int = Field(default=1, primary_key=True, sa_type=SmallInteger())
    enabled: bool = Field(default=True, sa_type=Boolean())
    mode: str = Field(default="interactions", sa_type=Text())
    interactions_first: int = Field(default=5, sa_type=Integer())
    interactions_repeat: int = Field(default=15, sa_type=Integer())
    # Stored as minutes; UI converts to days/hours for display.
    time_first_minutes: int = Field(default=1440, sa_type=Integer())
    time_repeat_minutes: int = Field(default=10080, sa_type=Integer())
    # If > 0, a rated thread can be re-asked once the user has sent this many
    # more messages within that conversation. 0 = rated threads are locked
    # forever (the historical default).
    re_rate_after_messages: int = Field(default=0, sa_type=Integer())
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_by_user_id: UUID | None = Field(
        default=None,
        foreign_key="users.id",
        sa_type=PG_UUID(as_uuid=True),
        ondelete="SET NULL",
    )
