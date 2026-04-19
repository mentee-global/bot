from collections.abc import AsyncIterator

from app.agents.base import AgentPort
from app.agents.events import TextDelta, ToolEnd, ToolStart
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread, User
from app.services.thread_store import ThreadStore


class MessageService:
    def __init__(self, store: ThreadStore, agent: AgentPort) -> None:
        self.store = store
        self.agent = agent

    async def handle_user_message(
        self,
        session_id: str,
        body: str,
        *,
        user: User | None = None,
    ) -> tuple[Thread, Message, Message]:
        thread = await self.store.get_or_create_for_session(session_id)

        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        await self.store.append_message(thread, user_message)

        reply_body = await self.agent.reply(user_message, thread.messages, user=user)
        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=reply_body
        )
        await self.store.append_message(thread, assistant_message)

        return thread, user_message, assistant_message

    async def stream_user_message(
        self,
        session_id: str,
        body: str,
        *,
        user: User | None = None,
    ) -> AsyncIterator[tuple[str, dict | str]]:
        """Yield (event_name, payload) tuples for the SSE response.

        Order:
          ("meta", {thread_id, user_message_id, assistant_message_id})
          ("token", "delta text")*
          ("done", {assistant_message_id, body})

        The caller is responsible for SSE framing. The assistant message is
        persisted with the accumulated body just before emitting "done".
        """
        thread = await self.store.get_or_create_for_session(session_id)
        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        await self.store.append_message(thread, user_message)

        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=""
        )
        yield (
            "meta",
            {
                "thread_id": thread.id,
                "user_message_id": user_message.id,
                "assistant_message_id": assistant_message.id,
            },
        )

        chunks: list[str] = []
        async for event in self.agent.stream_reply(
            user_message, thread.messages, user=user
        ):
            if isinstance(event, TextDelta):
                if not event.text:
                    continue
                chunks.append(event.text)
                yield ("token", event.text)
            elif isinstance(event, ToolStart):
                yield (
                    "tool",
                    {
                        "status": "running",
                        "tool_call_id": event.tool_call_id,
                        "name": event.name,
                        "source": event.source,
                    },
                )
            elif isinstance(event, ToolEnd):
                yield (
                    "tool",
                    {
                        "status": "done",
                        "tool_call_id": event.tool_call_id,
                        "name": event.name,
                        "source": event.source,
                        "outcome": event.outcome,
                    },
                )

        assistant_message = assistant_message.model_copy(update={"body": "".join(chunks)})
        await self.store.append_message(thread, assistant_message)

        yield (
            "done",
            {
                "assistant_message_id": assistant_message.id,
                "body": assistant_message.body,
            },
        )

    async def get_thread(self, session_id: str) -> Thread:
        return await self.store.get_or_create_for_session(session_id)
