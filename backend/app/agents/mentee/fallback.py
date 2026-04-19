"""Break-glass fallback when the main agent fails.

Calls OpenAI's Responses API directly with the last-N turns of conversation
and returns a short plain-text reply. No tools, no structured output — just
enough to avoid a dead response when the agent crashes.
"""

import logging

from openai import AsyncOpenAI

from app.core.config import Settings
from app.domain.enums import MessageRole
from app.domain.models import Message, User

logger = logging.getLogger(__name__)

_FALLBACK_SYSTEM = (
    "You are the Mentee Mentor. Something interrupted your main reasoning, "
    "so answer briefly and honestly. Only help with scholarships, study-abroad "
    "programs, or career advice. Never invent URLs, deadlines, or program "
    "names — if you're unsure, say so and suggest the mentee ask again."
)


async def fallback_response(
    history: list[Message],
    user: User | None,
    settings: Settings,
    *,
    max_turns: int = 10,
) -> str:
    if settings.openai_api_key is None:
        return (
            "Sorry — I hit an internal error and can't reach my reasoning model "
            "right now. Please try again in a moment."
        )

    recent = history[-max_turns:]
    messages: list[dict[str, str]] = [{"role": "system", "content": _FALLBACK_SYSTEM}]
    if user and user.name:
        messages.append(
            {
                "role": "system",
                "content": f"The mentee's name is {user.name}.",
            }
        )
    for m in recent:
        role = "user" if m.role == MessageRole.USER else "assistant"
        messages.append({"role": role, "content": m.body})

    client = AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value())
    try:
        completion = await client.chat.completions.create(
            model=settings.agent_model,
            messages=messages,
            timeout=settings.agent_request_timeout_s,
            max_tokens=600,
        )
        text = completion.choices[0].message.content or ""
        return text.strip() or "Sorry — I couldn't produce a reply just now."
    except Exception as exc:  # noqa: BLE001 — last-resort path
        logger.exception("fallback_response failed: %s", exc)
        return (
            "Sorry — I hit an internal error and can't produce a reply right now. "
            "Please try again shortly."
        )
    finally:
        await client.close()
