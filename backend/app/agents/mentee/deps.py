from dataclasses import dataclass

from app.agents.mentee.ports import MenteeProfilePort
from app.core.config import Settings
from app.domain.models import User


@dataclass
class MenteeDeps:
    """Injected into pydantic-ai tools + instructions via RunContext."""

    user: User | None
    settings: Settings
    profile_port: MenteeProfilePort
