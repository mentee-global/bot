"""CLI-testable mentor agent for `pai --agent app.agents.mentee.clai_agent:agent`.

Mirrors `app.agents.mentee.agent._build_pydantic_agent` but binds `Settings`
via closure instead of `RunContext` deps, so the agent can run under `clai`
(which always calls `agent.run(..., deps=None)`).

This is a test harness — not imported by the FastAPI app.
"""

from __future__ import annotations

from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.builtin_tools import WebSearchTool
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.agents.mentee.prompts import SYSTEM_PROMPT
from app.agents.mentee.tools.career import analyze_career_path
from app.agents.mentee.tools.perplexity import call_perplexity
from app.agents.mentee.tools.schemas import insufficient_context, ok
from app.core.config import Settings

_settings = Settings()

if _settings.openai_api_key is None:
    raise RuntimeError("OPENAI_API_KEY missing; set it in backend/.env before running clai.")

_provider = OpenAIProvider(
    openai_client=AsyncOpenAI(
        api_key=_settings.openai_api_key.get_secret_value(),
        timeout=_settings.agent_request_timeout_s,
    ),
)
_model = OpenAIResponsesModel(_settings.agent_model, provider=_provider)


async def search_perplexity_standalone(
    query: str,
    intent: str = "general",
    country: str | None = None,
    field: str | None = None,
    level: str | None = None,
) -> str:
    """Perplexity search with settings captured via closure (no RunContext)."""
    if _settings.perplexity_api_key is None:
        return insufficient_context(
            ["perplexity_api_key"],
            "Perplexity not configured; rely on web_search only.",
        )
    if not query or not query.strip():
        return insufficient_context(["query"], "Ask what to research.")

    system_prompts = {
        "scholarships": (
            "You are a scholarship research assistant. Return 3-6 real scholarships "
            "with name, eligibility, deadline, official URL. Never invent URLs."
        ),
        "abroad_programs": (
            "You are a study-abroad research assistant. Return 3-6 real programs "
            "with name, institution, country, tuition, deadline, official URL."
        ),
    }
    system = system_prompts.get(
        intent, "You are a research assistant. Answer concisely with citations."
    )
    filters = [
        f"{k}: {v}"
        for k, v in (("field", field), ("country", country), ("level", level))
        if v
    ]
    refined = f"{query} ({', '.join(filters)})" if filters else query

    try:
        result = await call_perplexity(
            api_key=_settings.perplexity_api_key.get_secret_value(),
            system_prompt=system,
            user_prompt=refined,
            model=_settings.perplexity_model,
            timeout_s=_settings.agent_request_timeout_s,
        )
    except Exception as exc:  # noqa: BLE001
        return f'{{"status": "error", "message": "perplexity failed: {exc}"}}'

    return ok(
        {
            "source": "perplexity",
            "intent": intent,
            "answer": result.answer,
            "citations": result.citations,
        }
    )


_tools: list = [analyze_career_path]
if _settings.perplexity_api_key is not None:
    _tools.append(search_perplexity_standalone)

agent: Agent[None, str] = Agent(
    _model,
    instructions=SYSTEM_PROMPT,
    tools=_tools,
    builtin_tools=[WebSearchTool(search_context_size="medium")]
    if _settings.agent_enable_web_search
    else [],
    retries=2,
)
