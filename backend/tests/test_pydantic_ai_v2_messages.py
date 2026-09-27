"""Protect web-search billing and citations across Pydantic AI message changes."""

import asyncio

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelResponse,
    NativeToolCallPart,
    NativeToolReturnPart,
    TextPart,
)
from pydantic_ai.models.test import TestModel

from app.agents.events import TextDelta
from app.agents.mentee.agent import MenteeAgent, _count_builtin_tool_calls
from app.agents.mentee.deps import MenteeDeps
from app.agents.mentee.harvest import _harvest_urls_from_messages
from app.agents.mentee.ports import NullProfilePort
from app.budget.usage import UsageSummary
from app.core.config import Settings
from app.domain.enums import MessageRole
from app.domain.models import Message


def test_native_web_search_is_billed_and_its_source_is_available() -> None:
    deps = MenteeDeps(user=None, settings=Settings(), profile_port=NullProfilePort())
    usage = UsageSummary()
    messages = [
        ModelResponse(
            parts=[
                NativeToolCallPart(tool_name="web_search", tool_call_id="search-1"),
                NativeToolReturnPart(
                    tool_name="web_search",
                    tool_call_id="search-1",
                    content={
                        "sources": [
                            {"url": "https://example.org/scholarship", "title": "Scholarship"}
                        ]
                    },
                ),
                TextPart(content="See [Scholarship](https://example.org/scholarship)."),
            ]
        )
    ]

    _count_builtin_tool_calls(usage, messages)
    _harvest_urls_from_messages(messages, deps)

    assert usage.web_search_calls == 1
    citation = deps.citations["https://example.org/scholarship"]
    assert citation.source == "openai_web_search"
    assert citation.title == "Scholarship"


def test_reply_and_stream_use_the_v2_agent_result_and_events(monkeypatch) -> None:
    monkeypatch.setenv("PYDANTIC_AI_NO_BANNER", "1")
    monkeypatch.setenv("LOGFIRE_IGNORE_NO_CONFIG", "1")
    agent = MenteeAgent(
        pydantic_agent=Agent(TestModel(call_tools=[], custom_output_text="Hola")),
        settings=Settings(),
    )
    message = Message(thread_id="thread-1", role=MessageRole.USER, body="Saluda")

    async def check() -> None:
        assert await agent.reply(message, [message]) == "Hola"
        events = [event async for event in agent.stream_reply(message, [message])]
        assert "".join(event.text for event in events if isinstance(event, TextDelta)) == "Hola"

    asyncio.run(check())
