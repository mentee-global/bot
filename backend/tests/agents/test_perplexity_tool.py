import json

import httpx
import pytest
import respx
from pydantic import SecretStr
from pydantic_ai import RunContext
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from app.agents.mentee.agent import build_mentee_agent
from app.agents.mentee.deps import MenteeDeps
from app.agents.mentee.ports import NullProfilePort
from app.agents.mentee.tools.search import search_perplexity
from app.core.config import settings as real_settings
from app.domain.models import User


def _deps(*, with_key: bool) -> MenteeDeps:
    settings = real_settings.model_copy(
        update={
            "openai_api_key": SecretStr("sk-test"),
            "perplexity_api_key": SecretStr("pplx-test") if with_key else None,
            "agent_enable_web_search": False,
        }
    )
    return MenteeDeps(
        user=User(
            id="u-1",
            email="m@x.com",
            name="Jose",
            role="mentee",
            role_id=2,
        ),
        settings=settings,
        profile_port=NullProfilePort(),
    )


def _run_ctx(deps: MenteeDeps) -> RunContext[MenteeDeps]:
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage())


@pytest.mark.asyncio
async def test_search_perplexity_returns_insufficient_when_no_key() -> None:
    ctx = _run_ctx(_deps(with_key=False))
    out = json.loads(await search_perplexity(ctx, query="Fulbright scholarships"))
    assert out["status"] == "insufficient_context"
    assert "perplexity_api_key" in out["missing_fields"]


@pytest.mark.asyncio
async def test_search_perplexity_returns_insufficient_when_empty_query() -> None:
    ctx = _run_ctx(_deps(with_key=True))
    out = json.loads(await search_perplexity(ctx, query=""))
    assert out["status"] == "insufficient_context"
    assert "query" in out["missing_fields"]


@pytest.mark.asyncio
async def test_search_perplexity_happy_path() -> None:
    fake_body = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "Here are 3 scholarships matching your filters...",
                }
            }
        ],
        "citations": [
            "https://example.org/scholarship-a",
            "https://example.org/scholarship-b",
        ],
    }
    ctx = _run_ctx(_deps(with_key=True))
    with respx.mock(base_url="https://api.perplexity.ai") as m:
        m.post("/chat/completions").mock(
            return_value=httpx.Response(200, json=fake_body)
        )
        raw = await search_perplexity(
            ctx,
            query="scholarships",
            intent="scholarships",
            country="Colombia",
            field="computer science",
        )
    out = json.loads(raw)
    assert out["status"] == "ok"
    assert out["source"] == "perplexity"
    assert "scholarships matching" in out["answer"]
    assert len(out["citations"]) == 2


@pytest.mark.asyncio
async def test_search_perplexity_reports_error_on_http_failure() -> None:
    ctx = _run_ctx(_deps(with_key=True))
    with respx.mock(base_url="https://api.perplexity.ai") as m:
        m.post("/chat/completions").mock(return_value=httpx.Response(503))
        out = json.loads(await search_perplexity(ctx, query="test"))
    assert out["status"] == "error"
    assert out["source"] == "perplexity"


def test_build_mentee_agent_registers_perplexity_only_when_key_present() -> None:
    # Without key: only analyze_career_path registered
    no_key = real_settings.model_copy(
        update={
            "openai_api_key": SecretStr("sk-test"),
            "perplexity_api_key": None,
            "agent_enable_web_search": False,
        }
    )
    agent_no_perp = build_mentee_agent(no_key)
    tool_names_no_perp = set(agent_no_perp.pydantic_agent._function_toolset.tools.keys())
    assert "analyze_career_path" in tool_names_no_perp
    assert "search_perplexity" not in tool_names_no_perp

    # With key: both registered
    with_key = no_key.model_copy(update={"perplexity_api_key": SecretStr("pplx-test")})
    agent_with_perp = build_mentee_agent(with_key)
    tool_names_with_perp = set(
        agent_with_perp.pydantic_agent._function_toolset.tools.keys()
    )
    assert "analyze_career_path" in tool_names_with_perp
    assert "search_perplexity" in tool_names_with_perp
