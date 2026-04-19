from datetime import datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


class SessionRecord(SQLModel, table=True):
    __tablename__ = "sessions"

    session_id: str = Field(primary_key=True, max_length=64)
    mentee_sub: str = Field(index=True, max_length=64)
    email: str
    name: str
    role: str = Field(max_length=32)
    role_id: int
    picture: str | None = None
    preferred_language: str | None = Field(default=None, max_length=16)
    timezone: str | None = Field(default=None, max_length=64)
    access_token_enc: bytes
    access_token_expires_at: datetime = Field(sa_type=DateTime(timezone=True))
    refresh_token_enc: bytes | None = None
    id_token_nonce: str = Field(max_length=64)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    last_used_at: datetime = Field(sa_type=DateTime(timezone=True))


class OAuthStateRecord(SQLModel, table=True):
    __tablename__ = "oauth_state"

    state: str = Field(primary_key=True, max_length=64)
    code_verifier: str = Field(max_length=128)
    nonce: str = Field(max_length=64)
    redirect_to: str | None = Field(default=None, max_length=1024)
    created_at: datetime = Field(sa_type=DateTime(timezone=True))
    expires_at: datetime = Field(sa_type=DateTime(timezone=True), index=True)
