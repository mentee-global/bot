from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, EmailStr, Field, HttpUrl

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
    email: EmailStr
    name: str
    role: str
    role_id: int
    picture: HttpUrl | None = None
    preferred_language: str | None = None
    timezone: str | None = None
