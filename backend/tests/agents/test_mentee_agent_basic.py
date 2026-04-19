import pytest
from pydantic_ai.models.test import TestModel

from app.agents.mentee.agent import MenteeAgent
from app.domain.enums import MessageRole
from app.domain.models import Message, User

_USER = User(
    id="u-1",
    email="mentee@example.com",
    name="Jose Ortiz",
    role="mentee",
    role_id=2,
)


def _user_msg(body: str) -> Message:
    return Message(thread_id="t1", role=MessageRole.USER, body=body)


@pytest.mark.asyncio
async def test_reply_returns_test_model_text(mentee_agent: MenteeAgent) -> None:
    with mentee_agent.pydantic_agent.override(
        model=TestModel(custom_output_text="Hi Jose — let's start with your field.")
    ):
        out = await mentee_agent.reply(_user_msg("hi"), [_user_msg("hi")], user=_USER)
    assert out == "Hi Jose — let's start with your field."


@pytest.mark.asyncio
async def test_stream_reply_yields_text_deltas(mentee_agent: MenteeAgent) -> None:
    from app.agents.events import TextDelta

    with mentee_agent.pydantic_agent.override(
        model=TestModel(custom_output_text="Streaming reply body.")
    ):
        events = []
        async for event in mentee_agent.stream_reply(
            _user_msg("hi"), [_user_msg("hi")], user=_USER
        ):
            events.append(event)
    text_deltas = [e for e in events if isinstance(e, TextDelta)]
    assert "".join(e.text for e in text_deltas) == "Streaming reply body."


@pytest.mark.asyncio
async def test_reply_without_user_still_runs(mentee_agent: MenteeAgent) -> None:
    with mentee_agent.pydantic_agent.override(
        model=TestModel(custom_output_text="Hello friend.")
    ):
        out = await mentee_agent.reply(_user_msg("hi"), [_user_msg("hi")], user=None)
    assert out == "Hello friend."
