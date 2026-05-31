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
    # Per-user thumbs rating: -1 (down), 1 (up), or None (unrated). Loaded by
    # ThreadStore via LEFT JOIN against `message_ratings` filtered to the
    # requesting user — never global, never aggregated, so each user only
    # sees their own rating.
    rating: int | None = None


class Thread(BaseModel):
    id: str = Field(default_factory=_uuid)
    user_id: str
    title: str | None = None
    messages: list[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class ThreadRating(BaseModel):
    thread_id: str
    stars: int  # 1..5
    comment: str | None = None
    created_at: datetime
    updated_at: datetime


class Document(BaseModel):
    """An uploaded document as seen by the API/service layer.

    `summary` / `extracted_json` are populated asynchronously, so they stay
    None until `status == "ready"`. See docs/documents/00-document-upload-plan.md.
    """

    id: str = Field(default_factory=_uuid)
    user_id: str
    thread_id: str | None = None
    purpose: str  # "chat_attachment" | "profile_cv"
    filename: str
    mime_type: str
    size_bytes: int
    status: str = "pending"  # pending | processing | ready | failed
    provider: str | None = None
    file_hash: str
    summary: str | None = None
    extracted_json: dict | None = None
    error_message: str | None = None
    page_count: int | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class CvProfile(BaseModel):
    """The canonical CV attached to a user profile (draft until confirmed)."""

    user_id: str
    cv_document_id: str | None = None
    cv_structured: dict | None = None
    cv_summary: str | None = None
    # None = unconfirmed draft; facts are injected into chats only once set.
    cv_confirmed_at: datetime | None = None
    updated_at: datetime = Field(default_factory=_now)

    @property
    def is_confirmed(self) -> bool:
        return self.cv_confirmed_at is not None


class FeedbackTriggerConfig(BaseModel):
    """Admin-controlled cadence for the in-chat session rating prompt.

    `mode` selects which gating logic the frontend trigger hook uses:
    - "interactions": every N user messages (lifetime, browser-scoped).
    - "time": time elapsed since first activity (first ask) and last shown.
    """

    enabled: bool
    mode: str  # "interactions" | "time"
    interactions_first: int
    interactions_repeat: int
    time_first_minutes: int
    time_repeat_minutes: int
    # 0 = rated threads stay locked forever; >0 = re-ask after N more user
    # messages in the same thread since the rating timestamp.
    re_rate_after_messages: int = 0
    updated_at: datetime
    updated_by_user_id: str | None = None


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
