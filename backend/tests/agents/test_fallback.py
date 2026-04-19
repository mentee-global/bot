from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.events import TextDelta
from app.agents.mentee.agent import MenteeAgent
from app.domain.enums import MessageRole
from app.domain.models import Message, User

_USER = User(id="u-1", email="m@x.com", name="Jose", role="mentee", role_id=2)


def _msg(body: str, role: MessageRole = MessageRole.USER) -> Message:
    return Message(thread_id="t1", role=role, body=body)


@pytest.mark.asyncio
async def test_reply_falls_back_when_agent_run_raises(mentee_agent: MenteeAgent) -> None:
    fake_completion = MagicMock()
    fake_completion.choices = [MagicMock(message=MagicMock(content="fallback text"))]

    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_completion)
    fake_client.close = AsyncMock()

    with patch.object(
        mentee_agent.pydantic_agent,
        "run",
        side_effect=RuntimeError("boom"),
    ), patch(
        "app.agents.mentee.fallback.AsyncOpenAI",
        return_value=fake_client,
    ):
        out = await mentee_agent.reply(_msg("hello"), [_msg("hello")], user=_USER)

    assert out == "fallback text"
    fake_client.chat.completions.create.assert_awaited_once()


@pytest.mark.asyncio
async def test_stream_falls_back_when_run_stream_raises(
    mentee_agent: MenteeAgent,
) -> None:
    fake_completion = MagicMock()
    fake_completion.choices = [MagicMock(message=MagicMock(content="fallback stream"))]

    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_completion)
    fake_client.close = AsyncMock()

    with patch.object(
        mentee_agent.pydantic_agent,
        "run_stream",
        side_effect=RuntimeError("boom"),
    ), patch(
        "app.agents.mentee.fallback.AsyncOpenAI",
        return_value=fake_client,
    ):
        events = []
        async for event in mentee_agent.stream_reply(
            _msg("hello"), [_msg("hello")], user=_USER
        ):
            events.append(event)

    text_events = [e for e in events if isinstance(e, TextDelta)]
    assert "".join(e.text for e in text_events) == "fallback stream"
