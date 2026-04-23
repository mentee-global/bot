"""Perplexity-backed `search_perplexity` tool.

Registered alongside OpenAI's built-in `web_search` so the model can fan out
both calls in parallel for scholarship + study-abroad questions. Each tool
returns an independent source list; the model is instructed to reconcile and
cross-cite both.
"""

from __future__ import annotations

import json
import logging

from perplexity import APIConnectionError, APIStatusError, APITimeoutError
from pydantic_ai import RunContext

from app.agents.mentee.deps import MenteeDeps
from app.agents.mentee.tools.perplexity import call_perplexity
from app.agents.mentee.tools.schemas import insufficient_context, ok
from app.budget.provider_errors import build_reason, is_insufficient_funds

logger = logging.getLogger(__name__)

_SCHOLARSHIP_SYSTEM = (
    "You are a scholarship research assistant. Return 3 to 6 real, currently "
    "accepting scholarships or fellowships that match the user's filters. "
    "For each, include: name, a one-line eligibility summary, the deadline "
    "(or 'rolling' / 'varies'), and the official URL. Prefer fully-funded "
    "programs. Never invent URLs — cite only what you can link to. If nothing "
    "matches, say so plainly."
)

_ABROAD_SYSTEM = (
    "You are a study-abroad research assistant. Return 3 to 6 real programs "
    "that match the filters (field, destination country, level). For each, "
    "include: program name, host institution, country, language of "
    "instruction, approximate tuition range, admissions deadline, and the "
    "official URL. Never invent URLs. If nothing matches, say so plainly."
)

_GENERAL_SYSTEM = (
    "You are a research assistant for a career mentor. Answer the user's "
    "question concisely with citations. Never invent URLs or facts. If "
    "uncertain, say so."
)


async def search_perplexity(
    ctx: RunContext[MenteeDeps],
    query: str,
    intent: str = "general",
    country: str | None = None,
    field: str | None = None,
    level: str | None = None,
) -> str:
    """Ground the mentee's question against Perplexity `sonar-pro`.

    Args:
        query: The natural-language research question. Be specific and include
            the mentee's filters (field, country, level) — don't just search
            "scholarships".
        intent: One of "scholarships", "abroad_programs", "general". Drives
            which research system prompt Perplexity sees.
        country, field, level: Optional filters echoed into the query so they
            carry into the grounded result.

    Returns:
        JSON string: `{"status": "ok", "source": "perplexity", "answer": "…",
        "citations": [urls…]}` on success, or an `insufficient_context` /
        `error` envelope that the agent should read and surface to the mentee.
    """
    settings = ctx.deps.settings
    if settings.perplexity_api_key is None:
        return insufficient_context(
            ["perplexity_api_key"],
            "Perplexity is not configured on the server. Ask the mentee to rely "
            "on web_search results only.",
        )

    if not ctx.deps.perplexity_enabled:
        # Silent degrade: the monthly Perplexity sub-budget is near-exhausted.
        # Tell the model to fall back to web_search so the mentee still gets a
        # grounded answer without blowing the cap.
        return insufficient_context(
            ["perplexity_quota"],
            "Perplexity is temporarily unavailable this month. Rely on "
            "web_search results only.",
        )

    if not query or not query.strip():
        return insufficient_context(
            ["query"],
            "Ask the mentee what specifically they want researched.",
        )

    system_prompt = {
        "scholarships": _SCHOLARSHIP_SYSTEM,
        "abroad_programs": _ABROAD_SYSTEM,
    }.get(intent, _GENERAL_SYSTEM)

    filters_note = []
    if field:
        filters_note.append(f"field: {field}")
    if country:
        filters_note.append(f"country: {country}")
    if level:
        filters_note.append(f"level: {level}")
    refined = query if not filters_note else f"{query} ({', '.join(filters_note)})"

    try:
        result = await call_perplexity(
            api_key=settings.perplexity_api_key.get_secret_value(),
            system_prompt=system_prompt,
            user_prompt=refined,
            model=settings.perplexity_model,
            timeout_s=settings.agent_request_timeout_s,
        )
    except (APIStatusError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("perplexity sdk error: %s", exc)
        # If Perplexity rejected the call because the account is out of funds,
        # flip the degrade flag so this tool gets skipped on subsequent turns
        # instead of burning latency + retries on every request.
        if ctx.deps.budget is not None and is_insufficient_funds(exc):
            try:
                await ctx.deps.budget.record_provider_out_of_funds(
                    "perplexity",
                    reason=build_reason(exc, provider="perplexity"),
                )
            except Exception:  # noqa: BLE001 — best-effort
                logger.exception("failed to record perplexity out-of-funds flag")
        return json.dumps(
            {
                "status": "error",
                "source": "perplexity",
                "message": "Perplexity search failed; rely on web_search results.",
            }
        )

    ctx.deps.usage.record_perplexity(
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )

    return ok(
        {
            "source": "perplexity",
            "intent": intent,
            "answer": result.answer,
            "citations": result.citations,
        }
    )
