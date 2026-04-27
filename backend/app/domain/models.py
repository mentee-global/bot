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
    topics: str | None = Field(
        default=None,
        title="Organization focus",
        description=(
            "Focus area of the partner organization, populated when the org "
            "resolves to a PartnerProfile on Mentee."
        ),
    )


class MenteeMentor(BaseModel):
    id: str
    name: str
    professional_title: str | None = Field(
        default=None,
        description="The mentor's job title (e.g. 'Senior PM at Stripe').",
    )
    specializations: list[str] = Field(
        default_factory=list,
        description=(
            "What the mentor focuses on. Helps the bot complement, not "
            "duplicate, their advice."
        ),
    )
    languages: list[str] = Field(
        default_factory=list,
        description="Languages the mentor speaks (BCP-47 codes).",
    )


class MenteeProfile(BaseModel):
    """Richer profile for the mentee agent. Sourced from Mentee's
    `GET /oauth/profile` endpoint behind scope `mentee.api.profile.read`.
    See docs/oauth/04-mentee-api-profile.md §3 for the DTO contract.
    """

    country: str | None = Field(default=None, description="Country of residence.")
    location: str | None = Field(
        default=None, description="City or region they live in now."
    )
    languages: list[str] = Field(
        default_factory=list, description="Languages they speak."
    )
    age: str | None = None
    birthday: date | None = None
    gender: str | None = None
    is_student: bool | None = Field(
        default=None, description="Currently enrolled in education."
    )
    education_level: str | None = None
    education: list[MenteeEducation] = Field(default_factory=list)
    interests: list[str] = Field(
        default_factory=list,
        description="What they're focused on right now.",
    )
    topics: list[str] = Field(
        default_factory=list,
        title="Original intake topics",
        description=(
            "Mentor-matching topics they signed up with. Compared against "
            "`interests` lets the bot see how their focus has shifted."
        ),
    )
    identify: str | None = Field(
        default=None,
        title="Self-identification",
        description="Free-text from intake (e.g. pronouns).",
    )
    biography: str | None = Field(
        default=None, description="Short bio the mentee wrote about themselves."
    )
    work_state: list[str] = Field(
        default_factory=list,
        description="Employment / study tags (e.g. 'employed', 'job-seeking').",
    )
    immigrant_status: list[str] = Field(
        default_factory=list,
        description="Contextual flags they shared at intake.",
    )
    organization: MenteeOrganization | None = None
    mentor: MenteeMentor | None = None
    socially_engaged: bool | None = Field(
        default=None,
        description="Active in volunteer or community work.",
    )
    application_notes: str | None = Field(
        default=None,
        description="Free-text notes the mentee left at intake.",
    )
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
