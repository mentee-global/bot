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
    # Per-run allowlist of URLs returned by grounded-search tools (Perplexity
    # citations, OpenAI web_search sources/annotations). Populated by tools
    # and the streaming harness as searches complete; consulted by the
    # post-output validator to strip URLs the model fabricated.
    cited_urls: set[str] = field(default_factory=set)
    # Per-run liveness state. `http_client` is an `httpx.AsyncClient`; typed
    # as `object` to keep this dataclass independent of httpx. As URLs land
    # in `cited_urls`, a HEAD-check task is spawned and parked in
    # `liveness_tasks`; tasks that confirm a 404/410 add the URL to
    # `dead_urls`, which the validator subtracts from the allowlist.
    http_client: object | None = None
    liveness_tasks: dict[str, object] = field(default_factory=dict)
    dead_urls: set[str] = field(default_factory=set)
