from dataclasses import dataclass, field

from app.agents.mentee.ports import MenteeProfilePort
from app.budget.service import BudgetService
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
    # Optional so unit tests / the clai harness can construct deps without a
    # real budget service; the Perplexity tool skips the flag flip when None.
    budget: BudgetService | None = None
    # The chat UI's active locale at the time of the turn (e.g. "en", "es",
    # "pt", "ar"). Surfaces in the per-turn profile block as the strongest
    # signal for reply language, beating the user's stored preferred_language.
    ui_locale: str | None = None
