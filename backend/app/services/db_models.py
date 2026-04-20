from datetime import datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


class ThreadRecord(SQLModel, table=True):
    __tablename__ = "chat_threads"

    id: str = Field(primary_key=True, max_length=64)
    owner_user_id: str = Field(index=True, max_length=64)
    title: str | None = Field(default=None, max_length=200)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class MessageRecord(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: str = Field(primary_key=True, max_length=64)
    thread_id: str = Field(
        foreign_key="chat_threads.id",
        index=True,
        max_length=64,
    )
    role: str = Field(max_length=16)
    body: str
    created_at: datetime = Field(sa_type=DateTime(timezone=True), index=True)
