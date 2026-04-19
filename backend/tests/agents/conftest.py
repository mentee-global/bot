from collections.abc import Iterator

import pytest
from pydantic import SecretStr

from app.agents.mentee.agent import MenteeAgent, build_mentee_agent
from app.core.config import Settings
from app.core.config import settings as real_settings


@pytest.fixture
def mentee_settings() -> Settings:
    """Settings clone with a dummy OpenAI key so build_mentee_agent doesn't bail."""
    return real_settings.model_copy(
        update={
            "openai_api_key": SecretStr("sk-test-key"),
            "agent_enable_web_search": False,
        }
    )


@pytest.fixture
def mentee_agent(mentee_settings: Settings) -> Iterator[MenteeAgent]:
    yield build_mentee_agent(mentee_settings)
