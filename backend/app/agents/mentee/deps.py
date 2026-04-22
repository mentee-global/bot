from dataclasses import dataclass, field

from app.agents.mentee.ports import MenteeProfilePort
from app.budget.usage import UsageSummary
from app.core.config import Settings
from app.domain.models import User


@dataclass
class MenteeDeps:
    """Injected into pydantic-ai tools + instructions via RunContext."""

    user: User | None
    settings: Settings
    profile_port: MenteeProfilePort
    usage: UsageSummary = field(default_factory=UsageSummary)
    perplexity_enabled: bool = True
