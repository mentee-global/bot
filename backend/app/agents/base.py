from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.agents.events import StreamEvent, TextDelta
from app.domain.models import Message, User


class AgentPort(ABC):
    """Interface every agent implementation must satisfy.

    Swap the concrete agent (MockAgent, MenteeAgent, …) without touching the
    service layer.
    """

    agent_id: str = "unknown-agent"

    @abstractmethod
    async def reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
    ) -> str:
        """Return the assistant's reply body for the given user message."""
        ...

    async def stream_reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield assistant reply deltas and tool lifecycle events.

        Default implementation emits a single `TextDelta` with the full
        non-streaming reply so every AgentPort implementation satisfies the
        streaming route without extra code.
        """
        yield TextDelta(text=await self.reply(user_message, history, user=user))
