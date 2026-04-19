from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from app.agents.mentee.agent import _history_to_messages
from app.domain.enums import MessageRole
from app.domain.models import Message


def _msg(role: MessageRole, body: str) -> Message:
    return Message(thread_id="t1", role=role, body=body)


def test_history_converter_empty_list() -> None:
    assert _history_to_messages([], exclude_last=False) == []


def test_history_converter_preserves_order_and_role() -> None:
    history = [
        _msg(MessageRole.USER, "first question"),
        _msg(MessageRole.ASSISTANT, "first answer"),
        _msg(MessageRole.USER, "second question"),
        _msg(MessageRole.ASSISTANT, "second answer"),
    ]
    result = _history_to_messages(history, exclude_last=False)
    assert len(result) == 4
    assert isinstance(result[0], ModelRequest)
    assert isinstance(result[0].parts[0], UserPromptPart)
    assert result[0].parts[0].content == "first question"
    assert isinstance(result[1], ModelResponse)
    assert isinstance(result[1].parts[0], TextPart)
    assert result[1].parts[0].content == "first answer"
    assert isinstance(result[2], ModelRequest)
    assert result[2].parts[0].content == "second question"


def test_history_converter_exclude_last_drops_most_recent() -> None:
    history = [
        _msg(MessageRole.USER, "old"),
        _msg(MessageRole.ASSISTANT, "old-reply"),
        _msg(MessageRole.USER, "current"),  # dropped
    ]
    result = _history_to_messages(history, exclude_last=True)
    assert len(result) == 2
    assert result[-1].parts[0].content == "old-reply"
