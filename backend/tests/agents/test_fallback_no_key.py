import pytest
from pydantic import SecretStr

from app.agents.mentee.agent import MenteeAgent, build_mentee_agent
from app.agents.mentee.fallback import fallback_response
from app.core.config import settings as real_settings
from app.domain.models import User


@pytest.mark.asyncio
async def test_fallback_returns_safe_error_when_no_key() -> None:
    settings = real_settings.model_copy(update={"openai_api_key": None})
    text = await fallback_response(
        history=[],
        user=User(id="u", email="m@x.com", name="J", role="mentee", role_id=2),
        settings=settings,
    )
    assert "internal error" in text.lower() or "sorry" in text.lower()


def test_build_mentee_agent_raises_without_openai_key() -> None:
    settings = real_settings.model_copy(update={"openai_api_key": None})
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        build_mentee_agent(settings)


def test_build_mentee_agent_produces_agent_with_key() -> None:
    settings = real_settings.model_copy(
        update={
            "openai_api_key": SecretStr("sk-test"),
            "agent_enable_web_search": False,
        }
    )
    agent = build_mentee_agent(settings)
    assert isinstance(agent, MenteeAgent)
    assert agent.agent_id == "mentee-agent"
