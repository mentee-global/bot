"""Integration probe for the per-run URL allowlist.

Runs the mentee agent against the same prompt that produced the broken
links in thread `ef4492ba-0d55-4790-ad85-6b84ea63bbd1` and reports:

- which URLs the search tools returned (the allowlist)
- which URLs ended up in the rendered reply
- whether any URL in the reply was *not* in the allowlist (would indicate
  the validator failed — should always be zero with the new code)

Hits the real OpenAI + Perplexity APIs, so costs a few cents per run.
Run from `backend/`:  uv run python scripts/test_url_allowlist.py
"""

from __future__ import annotations

import asyncio
import re
import sys

import httpx

from app.agents.mentee.agent import build_mentee_agent
from app.agents.mentee.deps import MenteeDeps
from app.budget.usage import UsageSummary
from app.core.config import settings
from app.domain.enums import MessageRole
from app.domain.models import Message

_URL_RE = re.compile(r'https?://[^\s<>"\)\]]+')
_TRAIL_PUNCT = ".,;:!?"


def _strip_trail(url: str) -> str:
    while url and url[-1] in _TRAIL_PUNCT:
        url = url[:-1]
    return url


PRIOR_USER = "Explain student or work mobility pathways"
PRIOR_ASSIST = (
    "Here's a practical way to think about student and work mobility pathways. "
    "Briefly: student mobility, post-study work, skilled migration, remote work."
)
# Specific enough to bypass the prompt's "scope gate" (otherwise the model
# asks clarifying questions instead of firing search tools, and we have
# nothing to validate).
TURN_USER = (
    "I'm in Colombia, full-time engineer with Python and React. "
    "Help me search for remote software engineering jobs open to Latin America "
    "right now. Use both web_search and search_perplexity."
)


async def main() -> int:
    if settings.openai_api_key is None or settings.perplexity_api_key is None:
        print("Need OPENAI_API_KEY and PERPLEXITY_API_KEY in .env", file=sys.stderr)
        return 1

    agent = build_mentee_agent(settings)

    # Build a deps the same way MenteeAgent.reply does, but keep a handle so
    # we can inspect cited_urls / dead_urls after the run.
    collector = UsageSummary()
    http_client = httpx.AsyncClient(timeout=2.0)
    deps = MenteeDeps(
        user=None,
        settings=settings,
        profile_port=agent._profile_port,  # noqa: SLF001 — script-only
        usage=collector,
        perplexity_enabled=True,
        budget=None,
        ui_locale="en",
        http_client=http_client,
    )

    history_msgs = [
        Message(thread_id="probe", role=MessageRole.USER, body=PRIOR_USER),
        Message(thread_id="probe", role=MessageRole.ASSISTANT, body=PRIOR_ASSIST),
    ]

    from app.agents.mentee.agent import (
        _filter_off_allowlist_urls,
        _format_more_sources,
        _gather_liveness,
        _harvest_urls_from_messages,
        _history_to_messages,
        _strip_citations,
    )

    print(f"Prompt: {TURN_USER!r}\n")
    try:
        result = await agent.pydantic_agent.run(
            TURN_USER,
            deps=deps,
            message_history=_history_to_messages(history_msgs, exclude_last=False) or None,
        )

        _harvest_urls_from_messages(result.all_messages(), deps)
        await _gather_liveness(deps)

        cleaned = _strip_citations(result.output)
        stripped: list[str] = []
        seen: set[str] = set()
        body = _filter_off_allowlist_urls(
            cleaned,
            deps.cited_urls,
            dead=deps.dead_urls,
            on_strip=stripped.append,
            on_keep=seen.add,
        )
        live_allow = deps.cited_urls - deps.dead_urls
        unused = sorted(live_allow - seen)
        final = body + _format_more_sources(unused)

        rendered_urls = [_strip_trail(u) for u in _URL_RE.findall(final)]
        leaked = [u for u in rendered_urls if u.rstrip("/") not in live_allow]

        print(f"Allowlist size:       {len(deps.cited_urls)}")
        for u in sorted(deps.cited_urls):
            tag = " (DEAD)" if u in deps.dead_urls else ""
            print(f"  allow  {u}{tag}")
        print(f"\nDead URLs (404/410):  {len(deps.dead_urls)}")
        for u in sorted(deps.dead_urls):
            print(f"  dead   {u}")
        print(f"\nURLs cited inline:    {len(seen)}")
        for u in sorted(seen):
            print(f"  cited  {u}")
        print(f"\nURLs appended (More): {len(unused)}")
        for u in unused:
            print(f"  more   {u}")
        print(f"\nStripped (off-allow): {len(stripped)}")
        for u in stripped:
            print(f"  drop   {u}")
        print(f"\nLeaked into final:    {len(leaked)} (must be 0)")
        if leaked:
            for u in leaked:
                print(f"  LEAK  {u}")
            return 2

        print("\n--- final reply ---")
        print(final)
        return 0
    finally:
        await http_client.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
