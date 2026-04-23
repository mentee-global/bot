from datetime import UTC, date, datetime
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
    user_id: str
    title: str | None = None
    messages: list[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class MenteeEducation(BaseModel):
    level: str
    school: str
    majors: list[str] = Field(default_factory=list)
    graduation_year: int | None = None


class MenteeOrganization(BaseModel):
    id: str | None = None
    name: str


class MenteeMentor(BaseModel):
    id: str
    name: str


class MenteeProfile(BaseModel):
    """Richer profile for the mentee agent. Sourced from Mentee's
    `GET /oauth/profile` endpoint behind scope `mentee.api.profile.read`.
    See docs/oauth/04-mentee-api-profile.md §3 for the DTO contract.
    """

    country: str | None = None
    location: str | None = None
    languages: list[str] = Field(default_factory=list)
    age: str | None = None
    birthday: date | None = None
    gender: str | None = None
    is_student: bool | None = None
    education_level: str | None = None
    education: list[MenteeEducation] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    biography: str | None = None
    work_state: list[str] = Field(default_factory=list)
    immigrant_status: list[str] = Field(default_factory=list)
    organization: MenteeOrganization | None = None
    mentor: MenteeMentor | None = None
    socially_engaged: bool | None = None
    application_notes: str | None = None
    joined_at: datetime | None = None


class User(BaseModel):
    id: str
    mentee_sub: str
    email: EmailStr
    name: str
    role: str
    role_id: int
    picture: HttpUrl | None = None
    preferred_language: str | None = None
    timezone: str | None = None
    mentee_profile: MenteeProfile | None = None
