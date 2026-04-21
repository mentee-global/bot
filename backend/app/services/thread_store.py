"""ThreadStore port + in-memory implementation.

The production impl lives in `app/services/pg_thread_store.py`; pick one via
`settings.store_impl` ("memory" for tests + local dev, "postgres" for real
deployments).

Threads are owned by a **user id** (the Mentee OAuth `sub`) rather than a
session cookie, so the conversation history persists across logout/login.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime

from app.domain.models import Message, Thread


class ThreadNotFoundError(Exception):
    """Raised when a thread lookup by id returns nothing the caller can own."""


class ThreadStore(ABC):
    @abstractmethod
    async def list_threads(
        self,
        user_id: str,
        *,
        query: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[Thread]:
        """Return threads for `user_id`, newest-first, WITHOUT messages.

        If `query` is provided, filter to threads whose title OR any message
        body contains it (case-insensitive). `limit`/`offset` paginate when
        set; otherwise the full matching set is returned (used by chat).
        """

    @abstractmethod
    async def count_threads(
        self, user_id: str, *, query: str | None = None
    ) -> int:
        """Number of threads for a user matching `query` (same match rules as
        `list_threads`). Used with `list_threads` to paginate."""

    @abstractmethod
    async def list_all_threads(
        self,
        *,
        query: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> list[Thread]:
        """Admin cross-user feed: newest-updated first, optionally filtered
        by title/body/owner-email (implementation-specific — Postgres matches
        owner email via SessionRecord EXISTS; in-memory ignores owner)."""

    @abstractmethod
    async def count_all_threads(self, *, query: str | None = None) -> int:
        """Total threads matching `query` for pagination of `list_all_threads`."""

    @abstractmethod
    async def create_thread(
        self, user_id: str, *, title: str | None = None
    ) -> Thread: ...

    @abstractmethod
    async def get_thread(self, thread_id: str, user_id: str) -> Thread:
        """Return the thread with its messages. Raises ThreadNotFoundError if
        the thread is missing or owned by a different user."""

    @abstractmethod
    async def get_any_thread(self, thread_id: str) -> Thread:
        """Admin read: return the thread with its messages regardless of owner.

        Raises ThreadNotFoundError only when the thread does not exist. The
        user-scoped `get_thread` remains the default safe path for every
        non-admin surface.
        """

    @abstractmethod
    async def get_or_create_latest(self, user_id: str) -> Thread:
        """Return the most recent thread for the user, creating one if none
        exist. Used to keep the legacy single-thread API working."""

    @abstractmethod
    async def append_message(self, thread: Thread, message: Message) -> None: ...

    @abstractmethod
    async def set_title(
        self, thread_id: str, user_id: str, title: str
    ) -> None: ...

    @abstractmethod
    async def delete_thread(self, thread_id: str, user_id: str) -> None: ...

    @abstractmethod
    async def delete_any_thread(self, thread_id: str) -> None:
        """Admin-only hard delete. Removes the thread row and all messages.
        Raises ThreadNotFoundError only when the thread does not exist."""


class InMemoryThreadStore(ThreadStore):
    """Process-local store. Used in tests and for dev loops where we
    deliberately don't want conversations to persist.
    """

    def __init__(self) -> None:
        self._threads_by_id: dict[str, Thread] = {}

    async def list_threads(
        self,
        user_id: str,
        *,
        query: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[Thread]:
        threads = [
            t
            for t in self._threads_by_id.values()
            if t.owner_user_id == user_id
        ]
        matches = _filter_sort_strip(threads, query=query)
        start = offset or 0
        return matches[start : start + limit] if limit is not None else matches[start:]

    async def count_threads(
        self, user_id: str, *, query: str | None = None
    ) -> int:
        threads = [
            t
            for t in self._threads_by_id.values()
            if t.owner_user_id == user_id
        ]
        return len(_filter_sort_strip(threads, query=query))

    async def list_all_threads(
        self,
        *,
        query: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> list[Thread]:
        matches = _filter_sort_strip(
            list(self._threads_by_id.values()), query=query
        )
        return matches[offset : offset + limit]

    async def count_all_threads(self, *, query: str | None = None) -> int:
        return len(
            _filter_sort_strip(list(self._threads_by_id.values()), query=query)
        )

    async def create_thread(
        self, user_id: str, *, title: str | None = None
    ) -> Thread:
        thread = Thread(owner_user_id=user_id, title=title)
        self._threads_by_id[thread.id] = thread
        return thread

    async def get_thread(self, thread_id: str, user_id: str) -> Thread:
        thread = self._threads_by_id.get(thread_id)
        if thread is None or thread.owner_user_id != user_id:
            raise ThreadNotFoundError(thread_id)
        return thread

    async def get_any_thread(self, thread_id: str) -> Thread:
        thread = self._threads_by_id.get(thread_id)
        if thread is None:
            raise ThreadNotFoundError(thread_id)
        return thread

    async def get_or_create_latest(self, user_id: str) -> Thread:
        threads = [
            t
            for t in self._threads_by_id.values()
            if t.owner_user_id == user_id
        ]
        if not threads:
            return await self.create_thread(user_id)
        threads.sort(key=lambda t: t.updated_at, reverse=True)
        return threads[0]

    async def append_message(self, thread: Thread, message: Message) -> None:
        thread.messages.append(message)
        thread.updated_at = datetime.now(UTC)
        stored = self._threads_by_id.get(thread.id)
        if stored is not None and stored is not thread:
            stored.messages.append(message)
            stored.updated_at = thread.updated_at

    async def set_title(
        self, thread_id: str, user_id: str, title: str
    ) -> None:
        thread = await self.get_thread(thread_id, user_id)
        thread.title = title
        thread.updated_at = datetime.now(UTC)

    async def delete_thread(self, thread_id: str, user_id: str) -> None:
        thread = self._threads_by_id.get(thread_id)
        if thread is None or thread.owner_user_id != user_id:
            raise ThreadNotFoundError(thread_id)
        del self._threads_by_id[thread_id]

    async def delete_any_thread(self, thread_id: str) -> None:
        if thread_id not in self._threads_by_id:
            raise ThreadNotFoundError(thread_id)
        del self._threads_by_id[thread_id]


def _filter_sort_strip(
    threads: list[Thread], *, query: str | None
) -> list[Thread]:
    if query:
        needle = query.lower()
        threads = [
            t
            for t in threads
            if (t.title and needle in t.title.lower())
            or any(needle in m.body.lower() for m in t.messages)
        ]
    threads.sort(key=lambda t: t.updated_at, reverse=True)
    return [
        Thread(
            id=t.id,
            owner_user_id=t.owner_user_id,
            title=t.title,
            messages=[],
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in threads
    ]
