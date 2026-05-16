from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.agents.mentee.ports import MenteeProfilePort
from app.budget.service import BudgetService
from app.budget.usage import UsageSummary
from app.core.config import Settings
from app.domain.models import User

# Where a citation came from. Drives both telemetry (titled-by-WebSearch
# vs. URL-only-by-Perplexity) and merge-time precedence (when both tools
# return the same URL, the WebSearch instance wins because it has a
# trustworthy title). Add new sources here as we wire more grounding
# back-ends.
CitationSource = Literal["openai_web_search", "perplexity"]


@dataclass(slots=True)
class Citation:
    """A single URL surfaced by a grounded-search tool, with provenance.

    Stored on `MenteeDeps.citations` keyed by normalized URL (trailing
    slash stripped) so two tools returning the same page collapse into
    one entry. The first writer wins for `source` and `title`; subsequent
    writers may still upgrade an empty title (see `_add_url_to_allowlist`).
    """

    url: str
    source: CitationSource
    title: str | None = None
    snippet: str | None = None
    retrieved_at: datetime = field(default_factory=lambda: datetime.now(UTC))


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
    # Per-run citation ledger keyed by normalized URL. Populated by tools
    # (Perplexity, OpenAI web_search) and the streaming harness as searches
    # complete; consulted by the post-output validator to strip URLs the
    # model fabricated and by `_format_sources_trailer` to render the
    # frontend SOURCES bar. Membership tests (`url in deps.citations`)
    # and key iteration both work directly on the dict.
    citations: dict[str, Citation] = field(default_factory=dict)
