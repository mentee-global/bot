import asyncio

from app.agents.base import AgentPort
from app.budget.usage import UsageSummary
from app.domain.enums import MessageRole
from app.domain.models import Message, User

_SUGGESTIONS = [
    "Tell me about your target role and I can sketch a learning path.",
    "I can surface scholarships once you share your field and country.",
    "Want me to break down the top skills for that role?",
    "Let's talk timelines — how many hours a week can you commit?",
]


class MockAgent(AgentPort):
    agent_id = "mock-agent"

    async def reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
        usage_out: UsageSummary | None = None,
        perplexity_enabled: bool = True,
        ui_locale: str | None = None,
    ) -> str:
        del usage_out, perplexity_enabled, ui_locale  # mock agent ignores these
        # Small delay so the frontend loading state is observable during dev.
        await asyncio.sleep(0.2)

        prior_user_turns = sum(1 for m in history if m.role == MessageRole.USER)
        suggestion = _SUGGESTIONS[prior_user_turns % len(_SUGGESTIONS)]
        greeting = f"Hi {user.name.split()[0]}! " if user and user.name else ""

        return (
            f"(mock) {greeting}You said: {user_message.body!r}. "
            f"I'm a placeholder mentor — real OpenAI replies will slot in later. "
            f"{suggestion}"
        )
