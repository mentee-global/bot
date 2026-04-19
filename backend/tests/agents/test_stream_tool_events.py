"""Verify `stream_reply` forwards tool start/end events alongside text.

Uses TestModel with a canned tool call so we exercise the real event_stream
plumbing without hitting OpenAI.
"""

import pytest
from pydantic_ai.models.test import TestModel

from app.agents.events import TextDelta, ToolEnd, ToolStart
from app.agents.mentee.agent import MenteeAgent
from app.domain.enums import MessageRole
from app.domain.models import Message, User

_USER = User(id="u-1", email="m@x.com", name="Jose", role="mentee", role_id=2)


def _msg(body: str, role: MessageRole = MessageRole.USER) -> Message:
    return Message(thread_id="t1", role=role, body=body)


@pytest.mark.asyncio
async def test_stream_emits_tool_events_around_function_tool_call(
    mentee_agent: MenteeAgent,
) -> None:
    # TestModel(call_tools="all") will invoke every registered tool once before
    # emitting its final text. In this fixture the Perplexity key is None so
    # only `analyze_career_path` is registered — the model will call it.
    test_model = TestModel(
        call_tools=["analyze_career_path"],
        custom_output_text="I checked your career path.",
    )
    with mentee_agent.pydantic_agent.override(model=test_model):
        events = []
        async for event in mentee_agent.stream_reply(
            _msg("what should I learn next?"), [_msg("what should I learn next?")], user=_USER
        ):
            events.append(event)

    starts = [e for e in events if isinstance(e, ToolStart)]
    ends = [e for e in events if isinstance(e, ToolEnd)]
    text_deltas = [e for e in events if isinstance(e, TextDelta)]

    # At least one ToolStart + matching ToolEnd for analyze_career_path
    assert any(s.name == "analyze_career_path" for s in starts)
    assert any(e.name == "analyze_career_path" for e in ends)
    # Start/end are correlated by tool_call_id
    start_ids = {s.tool_call_id for s in starts}
    end_ids = {e.tool_call_id for e in ends}
    assert start_ids == end_ids
    # Final text still arrives
    assert "".join(e.text for e in text_deltas) == "I checked your career path."
