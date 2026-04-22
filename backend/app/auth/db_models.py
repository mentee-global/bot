from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class UserRecord(SQLModel, table=True):
    __tablename__ = "users"

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
        sa_type=PG_UUID(as_uuid=True),
    )
    mentee_sub: str = Field(unique=True, index=True, max_length=64)
    email: str = Field(unique=True, sa_type=CITEXT())
    name: str
    role: str = Field(max_length=32)
    role_id: int
    picture: str | None = None
    preferred_language: str | None = Field(default=None, max_length=16)
    timezone: str | None = Field(default=None, max_length=64)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(sa_type=DateTime(timezone=True))


class SessionRecord(SQLModel, table=True):
    __tablename__ = "sessions"

    session_id: str = Field(primary_key=True, max_length=64)
    user_id: UUID = Field(
        foreign_key="users.id",
        index=True,
        sa_type=PG_UUID(as_uuid=True),
        ondelete="CASCADE",
    )
    access_token_enc: bytes
    access_token_expires_at: datetime = Field(sa_type=DateTime(timezone=True))
    refresh_token_enc: bytes | None = None
    id_token_nonce: str = Field(max_length=64)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    last_used_at: datetime = Field(sa_type=DateTime(timezone=True), index=True)


class OAuthStateRecord(SQLModel, table=True):
    __tablename__ = "oauth_state"

    state: str = Field(primary_key=True, max_length=64)
    code_verifier: str = Field(max_length=128)
    nonce: str = Field(max_length=64)
    redirect_to: str | None = Field(default=None, max_length=1024)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    expires_at: datetime = Field(sa_type=DateTime(timezone=True), index=True)
