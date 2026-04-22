from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Index
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
