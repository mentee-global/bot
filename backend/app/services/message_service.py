from collections.abc import AsyncIterator

from app.agents.base import AgentPort
from app.agents.events import TextDelta, ToolEnd, ToolStart
from app.budget.service import BudgetService
from app.budget.usage import UsageSummary
from app.domain.enums import MessageRole
from app.domain.models import Message, Thread, User
from app.services.thread_store import ThreadStore

_TITLE_MAX_LEN = 80


def _derive_title(body: str) -> str:
    cleaned = body.strip().splitlines()[0] if body.strip() else "New chat"
    if len(cleaned) > _TITLE_MAX_LEN:
        cleaned = cleaned[: _TITLE_MAX_LEN - 1].rstrip() + "…"
    return cleaned or "New chat"


class MessageService:
    def __init__(
        self,
        store: ThreadStore,
        agent: AgentPort,
        budget: BudgetService,
    ) -> None:
        self.store = store
        self.agent = agent
        self.budget = budget

    async def _resolve_thread(
        self, user_id: str, thread_id: str | None, *, create_new: bool = False
    ) -> Thread:
        # `create_new=True` means the caller is starting a fresh conversation
        # (multi-thread chat UI's draft "new chat" flow) — never append to the
        # user's most-recent thread. The default keeps the legacy single-thread
        # GET endpoint working.
        if thread_id is None:
            if create_new:
                return await self.store.create_thread(user_id)
            return await self.store.get_or_create_latest(user_id)
        return await self.store.get_thread(thread_id, user_id)

    async def _maybe_auto_title(self, thread: Thread, first_body: str) -> None:
        if thread.title:
            return
        title = _derive_title(first_body)
        await self.store.set_title(thread.id, thread.user_id, title)
        thread.title = title

    async def handle_user_message(
        self,
        user_id: str,
        body: str,
        *,
        user: User,
        thread_id: str | None = None,
        agent_user: User | None = None,
        ui_locale: str | None = None,
    ) -> tuple[Thread, Message, Message]:
        # `user` drives auth + budget; `agent_user`, when set, replaces the
        # context the model sees (admin "test persona" flow). Falls back to
        # `user` so non-persona requests behave identically.
        snap = await self.budget.check_can_chat(user)
        thread = await self._resolve_thread(user_id, thread_id, create_new=True)
        is_first_message = not thread.messages

        user_message = Message(thread_id=thread.id, role=MessageRole.USER, body=body)
        await self.store.append_message(thread, user_message)
        if is_first_message:
            await self._maybe_auto_title(thread, body)

        usage = UsageSummary()
        reply_body = await self.agent.reply(
            user_message,
            thread.messages,
            user=agent_user or user,
            usage_out=usage,
            perplexity_enabled=not snap.perplexity_degraded,
            ui_locale=ui_locale,
        )
        assistant_message = Message(
            thread_id=thread.id, role=MessageRole.ASSISTANT, body=reply_body
        )
        await self.store.append_message(thread, assistant_message)

        await self.budget.record_turn(
            user=user,
            thread_id=thread.id,
            message_id=assistant_message.id,
            usage=usage,
        )

        return thread, user_message, assistant_message

    async def stream_user_message(
        self,
        user_id: str,
        body: str,
        *,
        user: User,
        thread_id: str | None = None,
        agent_user: User | None = None,
        ui_locale: str | None = None,
    ) -> AsyncIterator[tuple[str, dict | str]]:
        """Yield (event_name, payload) tuples for the SSE response.

        Events arrive as: one `meta`, zero-or-more `token`/`tool`, then
        `done`. The caller handles SSE framing. The assistant message is
        persisted with the accumulated body just before `done`.
        """
        snap = await self.budget.check_can_chat(user)
        thread = await self._resolve_thread(user_id, thread_id, create_new=True)
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

        usage = UsageSummary()
        chunks: list[str] = []
        async for event in self.agent.stream_reply(
            user_message,
            thread.messages,
            user=agent_user or user,
            usage_out=usage,
            perplexity_enabled=not snap.perplexity_degraded,
            ui_locale=ui_locale,
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

        await self.budget.record_turn(
            user=user,
            thread_id=thread.id,
            message_id=assistant_message.id,
            usage=usage,
        )

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
