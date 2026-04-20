from collections.abc import AsyncIterator

from app.agents.base import AgentPort
from app.agents.events import TextDelta, ToolEnd, ToolStart
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread, User
from app.services.thread_store import ThreadStore

_TITLE_MAX_LEN = 80


def _derive_title(body: str) -> str:
    cleaned = body.strip().splitlines()[0] if body.strip() else "New chat"
    if len(cleaned) > _TITLE_MAX_LEN:
        cleaned = cleaned[: _TITLE_MAX_LEN - 1].rstrip() + "\u2026"
    return cleaned or "New chat"


class MessageService:
    def __init__(self, store: ThreadStore, agent: AgentPort) -> None:
        self.store = store
        self.agent = agent

    async def _resolve_thread(
        self, user_id: str, thread_id: str | None
    ) -> Thread:
        if thread_id is None:
            return await self.store.get_or_create_latest(user_id)
        return await self.store.get_thread(thread_id, user_id)

    async def _maybe_auto_title(self, thread: Thread, first_body: str) -> None:
        if thread.title:
            return
        title = _derive_title(first_body)
        await self.store.set_title(thread.id, thread.owner_user_id, title)
        thread.title = title

    async def handle_user_message(
        self,
        user_id: str,
        body: str,
        *,
        user: User | None = None,
        thread_id: str | None = None,
    ) -> tuple[Thread, Message, Message]:
        thread = await self._resolve_thread(user_id, thread_id)
        is_first_message = not thread.messages

        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        await self.store.append_message(thread, user_message)
        if is_first_message:
            await self._maybe_auto_title(thread, body)

        reply_body = await self.agent.reply(user_message, thread.messages, user=user)
        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=reply_body
        )
        await self.store.append_message(thread, assistant_message)

        return thread, user_message, assistant_message

    async def stream_user_message(
        self,
        user_id: str,
        body: str,
        *,
        user: User | None = None,
        thread_id: str | None = None,
    ) -> AsyncIterator[tuple[str, dict | str]]:
        """Yield (event_name, payload) tuples for the SSE response.

        Order:
          ("meta", {thread_id, user_message_id, assistant_message_id})
          ("token", "delta text")*
          ("done", {assistant_message_id, body})

        The caller is responsible for SSE framing. The assistant message is
        persisted with the accumulated body just before emitting "done".
        """
        thread = await self._resolve_thread(user_id, thread_id)
        is_first_message = not thread.messages

        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        await self.store.append_message(thread, user_message)
        if is_first_message:
            await self._maybe_auto_title(thread, body)

        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=""
        )
        yield (
            "meta",
            {
                "thread_id": thread.id,
                "user_message_id": user_message.id,
                "assistant_message_id": assistant_message.id,
                "title": thread.title,
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

    async def list_threads(
        self, user_id: str, *, query: str | None = None
    ) -> list[Thread]:
        return await self.store.list_threads(user_id, query=query)

    async def rename_thread(
        self, user_id: str, thread_id: str, title: str
    ) -> Thread:
        await self.store.set_title(thread_id, user_id, title)
        return await self.store.get_thread(thread_id, user_id)

    async def create_thread(
        self, user_id: str, *, title: str | None = None
    ) -> Thread:
        return await self.store.create_thread(user_id, title=title)

    async def get_thread(
        self, user_id: str, thread_id: str | None = None
    ) -> Thread:
        return await self._resolve_thread(user_id, thread_id)

    async def delete_thread(self, user_id: str, thread_id: str) -> None:
        await self.store.delete_thread(thread_id, user_id)
