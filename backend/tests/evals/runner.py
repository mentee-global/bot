"""Eval task wiring: build a fresh agent per case, run it, return a
`MenteeOutput` for the evaluators to grade.

We can't reuse `MenteeAgent.reply()` directly because it doesn't return
the citations dict the evaluators need. Instead we replicate its body
inline — same pipeline (run agent, harvest URLs, gather liveness,
filter off-allowlist, format trailer), just with the deps exposed.

When subsequent PRs change `reply()`, mirror the change here so the
eval stays faithful to user-visible behavior. The pieces we mirror are
small (~30 lines) and the call graph is documented in the agent file.
"""

from __future__ import annotations

import asyncio

from app.agents.mentee.agent import (
    _count_builtin_tool_calls,
    _dedup_response_text,
    _filter_off_allowlist_urls,
    _format_sources_trailer,
    _harvest_urls_from_messages,
    _history_to_messages,
    _strip_citations,
    build_mentee_agent,
)
from app.agents.mentee.deps import MenteeDeps
from app.agents.mentee.ports import NullProfilePort
from app.budget.usage import UsageSummary
from app.core.config import settings as default_settings
from app.domain.enums import MessageRole
from app.domain.models import (
    MenteeProfile,
    Message,
    User,
)

from .dataset import MenteeInput, MenteeOutput


def _fixture_user(inputs: MenteeInput) -> User:
    """Build a `User` from the case's input. Most fields are stubbed —
    only the bits the agent's instructions actually read matter
    (`name`, `role`, `preferred_language`, and the per-case profile).
    """
    profile = None
    if inputs.profile is not None:
        profile = MenteeProfile(
            country=inputs.profile.country,
            location=inputs.profile.location,
            biography=inputs.profile.biography,
        )
    return User(
        id="eval-user",
        mentee_sub="eval-user",
        email="eval@example.com",
        name=inputs.user_name,
        role="mentee",
        role_id=0,
        preferred_language=inputs.preferred_language,
        timezone="America/Bogota",
        mentee_profile=profile,
    )


def _fixture_history(inputs: MenteeInput) -> list[Message]:
    """Turn the per-case mini-history into `Message` objects.

    The agent appends the current turn message at the end and excludes
    it from the history slice, so we mirror that here: history list
    contains the prior turns, and the current user turn is appended
    last but it'll be stripped via `_history_to_messages(...,
    exclude_last=True)`.
    """
    thread_id = "eval-thread"
    history: list[Message] = []
    for entry in inputs.history:
        history.append(
            Message(
                thread_id=thread_id,
                role=MessageRole(entry.role),
                body=entry.body,
            )
        )
    current = Message(
        thread_id=thread_id,
        role=MessageRole.USER,
        body=inputs.message,
    )
    history.append(current)
    return history


async def run_mentee(inputs: MenteeInput) -> MenteeOutput:
    """Task function passed to `Dataset.evaluate(...)`.

    Builds a fresh `MenteeAgent`, runs it on the case's message, then
    runs the same post-processing pipeline as `MenteeAgent.reply()` so
    the body we grade is the user-visible body (post-strip,
    post-trailer).
    """
    agent = build_mentee_agent(default_settings)
    user = _fixture_user(inputs)
    history = _fixture_history(inputs)
    deps = MenteeDeps(
        user=user,
        settings=default_settings,
        profile_port=NullProfilePort(),
        usage=UsageSummary(),
        perplexity_enabled=True,
        budget=None,
        ui_locale=inputs.ui_locale,
    )

    user_message = history[-1]
    result = await agent.pydantic_agent.run(
        user_message.body,
        deps=deps,
        message_history=_history_to_messages(history, exclude_last=True) or None,
    )

    _count_builtin_tool_calls(deps.usage, result.all_messages())
    _harvest_urls_from_messages(result.all_messages(), deps)
    deduped = _dedup_response_text(result.all_messages())
    cited_keys = deps.citations.keys()
    cleaned = _strip_citations(
        deduped if deduped is not None else result.output,
    )
    body = _filter_off_allowlist_urls(cleaned, cited_keys)
    body = body + _format_sources_trailer(deps.citations, body)

    citations_payload = {
        url: {
            "title": citation.title,
            "source": citation.source,
            "snippet": citation.snippet,
        }
        for url, citation in deps.citations.items()
    }

    tools_fired: list[str] = []
    if deps.usage.perplexity_calls:
        tools_fired.append("search_perplexity")
    if deps.usage.web_search_calls > 0:
        tools_fired.append("web_search")

    return MenteeOutput(
        body=body,
        citations=citations_payload,
        tools_fired=tools_fired,
        citations_count=len(deps.citations),
        citations_titled=sum(
            1 for c in deps.citations.values() if (c.title or "").strip()
        ),
    )


def run_mentee_sync(inputs: MenteeInput) -> MenteeOutput:
    """Sync entry point used when called from a synchronous test runner."""
    return asyncio.run(run_mentee(inputs))
