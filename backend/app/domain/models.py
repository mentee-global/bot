from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, Field

from app.domain.enums import MessageRole


def _uuid() -> str:
    return str(uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class Message(BaseModel):
    id: str = Field(default_factory=_uuid)
    thread_id: str
    role: MessageRole
    body: str
    created_at: datetime = Field(default_factory=_now)


class Thread(BaseModel):
    id: str = Field(default_factory=_uuid)
    owner_session_id: str
    messages: list[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class User(BaseModel):
    id: str
    email: str
    name: str
