from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Index, SmallInteger, UniqueConstraint
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
