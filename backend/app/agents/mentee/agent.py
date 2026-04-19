"""Pydantic-AI mentor agent for the Mentee Bot.

Built on the OpenAI Responses API so the built-in `web_search` tool is
available for grounding scholarship + study-abroad recommendations.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable, AsyncIterator

import logfire
from openai import AsyncOpenAI
from pydantic_ai import Agent, RunContext
from pydantic_ai.builtin_tools import WebSearchTool
from pydantic_ai.messages import (
    AgentStreamEvent,
    BuiltinToolCallEvent,
    BuiltinToolResultEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

from app.agents.base import AgentPort
from app.agents.events import StreamEvent, TextDelta, ToolEnd, ToolStart
from app.agents.mentee.deps import MenteeDeps
from app.agents.mentee.fallback import fallback_response
from app.agents.mentee.ports import MenteeProfilePort, NullProfilePort
from app.agents.mentee.prompts import SYSTEM_PROMPT
from app.agents.mentee.tools.career import analyze_career_path
from app.agents.mentee.tools.search import search_perplexity
from app.core.config import Settings
from app.domain.enums import MessageRole
from app.domain.models import Message, User

logger = logging.getLogger(__name__)


def _build_pydantic_agent(settings: Settings) -> Agent[MenteeDeps, str]:
    if settings.openai_api_key is None:
        raise RuntimeError(
            "MenteeAgent requires OPENAI_API_KEY. Set it in .env or flip AGENT_IMPL=mock."
        )

    provider = OpenAIProvider(
        openai_client=AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(),
            timeout=settings.agent_request_timeout_s,
        ),
    )
    model = OpenAIResponsesModel(settings.agent_model, provider=provider)

    builtin_tools = (
        [WebSearchTool(search_context_size="medium")]
        if settings.agent_enable_web_search
        else []
    )

    tools: list = [analyze_career_path]
    if settings.perplexity_api_key is not None:
        # Parallel grounding: model is instructed (in prompts.py) to fan-out
        # both tools concurrently for scholarship / abroad questions and
        # reconcile their source lists in the reply.
        tools.append(search_perplexity)

    agent: Agent[MenteeDeps, str] = Agent(
        model,
        deps_type=MenteeDeps,
        instructions=SYSTEM_PROMPT,
        retries=2,
        instrument=True,
        tools=tools,
        builtin_tools=builtin_tools,
    )

    @agent.instructions
    async def add_user_context(ctx: RunContext[MenteeDeps]) -> str:
        user = ctx.deps.user
        if user is None:
            return "The mentee has not identified themselves yet; be welcoming."
        parts: list[str] = [f"You are talking to {user.name} (role: {user.role})."]
        if user.preferred_language:
            parts.append(
                f"Their preferred language is {user.preferred_language} — "
                "prefer it unless they write in a different language."
            )
        if user.timezone:
            parts.append(f"Their timezone is {user.timezone}.")
        return " ".join(parts)

    return agent


def _convert_tool_event(event: AgentStreamEvent) -> StreamEvent | None:
    if isinstance(event, FunctionToolCallEvent):
        return ToolStart(
            tool_call_id=event.part.tool_call_id,
            name=event.part.tool_name,
            source="function",
        )
    if isinstance(event, FunctionToolResultEvent):
        return ToolEnd(
            tool_call_id=event.result.tool_call_id,
            name=event.result.tool_name,
            source="function",
            outcome=getattr(event.result, "outcome", "success") or "success",
        )
    if isinstance(event, BuiltinToolCallEvent):
        return ToolStart(
            tool_call_id=event.part.tool_call_id,
            name=event.part.tool_name,
            source="builtin",
        )
    if isinstance(event, BuiltinToolResultEvent):
        return ToolEnd(
            tool_call_id=event.result.tool_call_id,
            name=event.result.tool_name,
            source="builtin",
            outcome=getattr(event.result, "outcome", "success") or "success",
        )
    return None


def _history_to_messages(history: list[Message], exclude_last: bool) -> list[ModelMessage]:
    """Convert domain messages to pydantic-ai ModelMessage list.

    `exclude_last` drops the most recent user message so it can be re-sent as
    the fresh `user_prompt` argument to `run` / `run_stream`.
    """
    items = history[:-1] if exclude_last and history else history
    out: list[ModelMessage] = []
    for m in items:
        if m.role == MessageRole.USER:
            out.append(ModelRequest(parts=[UserPromptPart(content=m.body)]))
        else:
            out.append(ModelResponse(parts=[TextPart(content=m.body)]))
    return out


class MenteeAgent(AgentPort):
    agent_id = "mentee-agent"

    def __init__(
        self,
        pydantic_agent: Agent[MenteeDeps, str],
        settings: Settings,
        profile_port: MenteeProfilePort | None = None,
    ) -> None:
        self._agent = pydantic_agent
        self._settings = settings
        self._profile_port: MenteeProfilePort = profile_port or NullProfilePort()
        self._usage_limits = UsageLimits(
            request_limit=settings.agent_request_limit,
            total_tokens_limit=settings.agent_total_tokens_limit,
        )

    @property
    def pydantic_agent(self) -> Agent[MenteeDeps, str]:
        return self._agent

    def _deps(self, user: User | None) -> MenteeDeps:
        return MenteeDeps(
            user=user,
            settings=self._settings,
            profile_port=self._profile_port,
        )

    async def reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
    ) -> str:
        with logfire.span(
            "agent.mentee.run",
            agent_id=self.agent_id,
            model=self._settings.agent_model,
            history_length=len(history),
        ):
            try:
                result = await self._agent.run(
                    user_message.body,
                    deps=self._deps(user),
                    message_history=_history_to_messages(history, exclude_last=True)
                    or None,
                    usage_limits=self._usage_limits,
                )
                return result.output
            except Exception as exc:  # noqa: BLE001 — fallback path
                logger.exception("mentee agent failed, using fallback: %s", exc)
                return await fallback_response(history, user, self._settings)

    async def stream_reply(
        self,
        user_message: Message,
        history: list[Message],
        *,
        user: User | None = None,
    ) -> AsyncIterator[StreamEvent]:
        with logfire.span(
            "agent.mentee.stream",
            agent_id=self.agent_id,
            model=self._settings.agent_model,
            history_length=len(history),
        ):
            queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

            async def tool_event_handler(
                _ctx: RunContext[MenteeDeps],
                events: AsyncIterable[AgentStreamEvent],
            ) -> None:
                async for event in events:
                    converted = _convert_tool_event(event)
                    if converted is not None:
                        await queue.put(converted)

            async def drive() -> None:
                try:
                    async with self._agent.run_stream(
                        user_message.body,
                        deps=self._deps(user),
                        message_history=_history_to_messages(history, exclude_last=True)
                        or None,
                        usage_limits=self._usage_limits,
                        event_stream_handler=tool_event_handler,
                    ) as stream:
                        async for delta in stream.stream_text(delta=True):
                            if delta:
                                await queue.put(TextDelta(text=delta))
                finally:
                    queue.put_nowait(None)

            task = asyncio.create_task(drive())
            try:
                while True:
                    event = await queue.get()
                    if event is None:
                        break
                    yield event
                await task  # surface exceptions from drive()
            except Exception as exc:  # noqa: BLE001 — fallback path
                logger.exception("mentee agent stream failed, using fallback: %s", exc)
                if not task.done():
                    task.cancel()
                text = await fallback_response(history, user, self._settings)
                if text:
                    yield TextDelta(text=text)


def build_mentee_agent(
    settings: Settings,
    profile_port: MenteeProfilePort | None = None,
) -> MenteeAgent:
    pydantic_agent = _build_pydantic_agent(settings)
    return MenteeAgent(
        pydantic_agent=pydantic_agent, settings=settings, profile_port=profile_port
    )
