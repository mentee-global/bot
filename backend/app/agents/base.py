from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.agents.events import StreamEvent, TextDelta
from app.budget.usage import UsageSummary
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
        usage_out: UsageSummary | None = None,
        perplexity_enabled: bool = True,
        ui_locale: str | None = None,
        document_context: str | None = None,
        cv_context: str | None = None,
    ) -> str:
        """Return the assistant's reply body for the given user message.

        `usage_out` is filled in-place after the run so the caller can charge
        credits + roll spend totals. `perplexity_enabled=False` tells the
        agent to silently skip the Perplexity tool (used when the monthly
        Perplexity sub-budget is near exhausted). `ui_locale` is the chat
        UI's active locale when the user pressed send (e.g. "pt", "ar");
        agents should treat it as a strong hint for reply language.
        `document_context` is a compact, pre-built block describing files the
        user attached in this thread (summaries/facts) — agents inject it as
        untrusted data; None when there are no attachments.
        `cv_context` is the user's confirmed CV facts (plan Phase 2) injected
        the same way; None until the user uploads and saves a CV.
        """
        ...

    async def stream_reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
        usage_out: UsageSummary | None = None,
        perplexity_enabled: bool = True,
        ui_locale: str | None = None,
        document_context: str | None = None,
        cv_context: str | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield assistant reply deltas and tool lifecycle events.

        Default implementation emits a single `TextDelta` with the full
        non-streaming reply so every AgentPort implementation satisfies the
        streaming route without extra code.
        """
        yield TextDelta(
            text=await self.reply(
                user_message,
                history,
                user=user,
                usage_out=usage_out,
                perplexity_enabled=perplexity_enabled,
                ui_locale=ui_locale,
                document_context=document_context,
                cv_context=cv_context,
            )
        )
