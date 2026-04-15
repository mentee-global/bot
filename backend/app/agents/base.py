from abc import ABC, abstractmethod

from app.domain.models import Message


class AgentPort(ABC):
    """Interface every agent implementation must satisfy.

    Swap the concrete agent (MockAgent, OpenAI, Perplexity, pydantic-ai) without
    touching the service layer.
    """

    agent_id: str = "unknown-agent"

    @abstractmethod
    async def reply(self, user_message: Message, history: list[Message]) -> str:
        """Return the assistant's reply body for the given user message."""
        ...
