from typing import Protocol


class MentorProfile(Protocol):
    """Extra profile data the Mentee platform can surface (goals, learning
    interests, onboarding answers). Stubbed for now — shape will firm up once
    the Mentee API + `mentee.api` OAuth scope are implemented.
    """

    goals: list[str]
    interests: list[str]
    current_field: str | None


class MenteeProfilePort(Protocol):
    """Loads richer mentee profile beyond what's in the session User object."""

    async def load(self, user_id: str) -> MentorProfile | None: ...


class NullProfilePort:
    """No-op profile port used until the Mentee Profile API is ready."""

    async def load(self, user_id: str) -> None:
        return None
