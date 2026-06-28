from collections.abc import AsyncIterator

from app.agents.base import AgentPort
from app.agents.events import TextDelta, ToolEnd, ToolStart
from app.agents.mentee.citations import strip_empty_markdown_links
from app.budget.service import BudgetService
from app.budget.usage import UsageSummary
from app.documents.service import DocumentService
from app.documents.store import DocumentNotFoundError
from app.domain.enums import MessageRole
from app.domain.models import (
    Message,
    MessageAttachment,
    Thread,
    ThreadRating,
    User,
)
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
        documents: DocumentService | None = None,
    ) -> None:
        self.store = store
        self.agent = agent
        self.budget = budget
        # Optional so tests / non-document deployments construct without it.
        self.documents = documents

    async def _document_context(self, user_id: str, thread: Thread, body: str) -> str | None:
        """Compact 'documents in this thread' block for the agent, or None.

        Scoped to (thread_id, user_id) inside the service so it can never
        surface another user's files (plan decision #15)."""
        if self.documents is None:
            return None
        ctx = await self.documents.build_thread_document_context(
            user_id=user_id, thread_id=thread.id, latest_user_message=body
        )
        return ctx or None

    async def _cv_context(self, user_id: str) -> str | None:
        """Confirmed-CV facts for this user, injected into every chat, or None.

        Returns content only once the user has saved/confirmed their CV
        (cv_confirmed_at set) — the gate lives in build_profile_context
        (plan decision #10)."""
        if self.documents is None:
            return None
        ctx = await self.documents.build_profile_context(user_id=user_id)
        return ctx or None

    async def _message_attachments(
        self, user_id: str, thread: Thread, attachment_ids: list[str] | None
    ) -> list[MessageAttachment]:
        if not attachment_ids:
            return []
        if self.documents is None:
            raise DocumentNotFoundError(attachment_ids[0])
        return await self.documents.message_attachments(
            user_id=user_id, thread_id=thread.id, document_ids=attachment_ids
        )

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
        attachment_ids: list[str] | None = None,
        agent_user: User | None = None,
        ui_locale: str | None = None,
    ) -> tuple[Thread, Message, Message]:
        # `user` drives auth + budget; `agent_user`, when set, replaces the
        # context the model sees (admin "test persona" flow). Falls back to
        # `user` so non-persona requests behave identically.
        snap = await self.budget.check_can_chat(user)
        thread = await self._resolve_thread(user_id, thread_id, create_new=True)
        is_first_message = not thread.messages

        attachments = await self._message_attachments(user_id, thread, attachment_ids)
        user_message = Message(
            thread_id=thread.id,
            role=MessageRole.USER,
            body=body,
            attachments=attachments,
        )
        await self.store.append_message(thread, user_message)
        if is_first_message:
            await self._maybe_auto_title(thread, body)

        document_context = await self._document_context(user_id, thread, body)
        cv_context = await self._cv_context(user_id)
        usage = UsageSummary()
        reply_body = await self.agent.reply(
            user_message,
            thread.messages,
            user=agent_user or user,
            usage_out=usage,
            perplexity_enabled=not snap.perplexity_degraded,
            ui_locale=ui_locale,
            document_context=document_context,
            cv_context=cv_context,
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
        attachment_ids: list[str] | None = None,
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

        attachments = await self._message_attachments(user_id, thread, attachment_ids)
        user_message = Message(
            thread_id=thread.id,
            role=MessageRole.USER,
            body=body,
            attachments=attachments,
        )
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

        document_context = await self._document_context(user_id, thread, body)
        cv_context = await self._cv_context(user_id)
        usage = UsageSummary()
        chunks: list[str] = []
        async for event in self.agent.stream_reply(
            user_message,
            thread.messages,
            user=agent_user or user,
            usage_out=usage,
            perplexity_enabled=not snap.perplexity_degraded,
            ui_locale=ui_locale,
            document_context=document_context,
            cv_context=cv_context,
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

        # Cross-chunk cleanup: when the streaming stripper splits a
        # `[text](url)` across chunks (link text in chunk N, `(url)` in
        # chunk N+1), `_filter_off_allowlist_urls` strips the bare URL
        # inside the second chunk but leaves the empty `()` framing
        # behind. The resulting persisted body has `[text]()` artifacts
        # that render as empty-href anchors. Drop them on the joined body.
        persisted_body = strip_empty_markdown_links("".join(chunks))
        assistant_message = assistant_message.model_copy(
            update={"body": persisted_body}
        )
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

    async def rate_message(
        self, user_id: str, message_id: str, rating: int
    ) -> None:
        """Set/clear the user's thumbs rating for an assistant message.

        `rating` is -1, 0, or 1. 0 clears the row. The store enforces ownership
        (thread belongs to user) and role (assistant only) and raises
        MessageNotFoundError otherwise.
        """
        await self.store.set_message_rating(message_id, user_id, rating)

    async def rate_thread(
        self,
        user_id: str,
        thread_id: str,
        *,
        stars: int,
        comment: str | None,
    ) -> ThreadRating:
        """Set the per-conversation 1–5 star rating for a thread the user owns.

        Idempotent overwrite. The store raises ThreadNotFoundError when the
        thread is missing or owned by another user.
        """
        return await self.store.upsert_thread_rating(
            thread_id, user_id, stars=stars, comment=comment
        )

    async def get_thread_rating(
        self, user_id: str, thread_id: str
    ) -> ThreadRating | None:
        return await self.store.get_thread_rating(thread_id, user_id)
