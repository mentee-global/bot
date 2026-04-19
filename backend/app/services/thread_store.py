"""ThreadStore port + in-memory implementation.

The production impl lives in `app/services/pg_thread_store.py`; pick one via
`settings.store_impl` ("memory" for tests + local dev, "postgres" for real
deployments).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime

from app.domain.models import Message, Thread


class ThreadStore(ABC):
    @abstractmethod
    async def get_or_create_for_session(self, session_id: str) -> Thread: ...

    @abstractmethod
    async def append_message(self, thread: Thread, message: Message) -> None: ...


class InMemoryThreadStore(ThreadStore):
    """Process-local store. Single thread per session. Used in tests and for
    dev loops where we deliberately don't want conversations to persist.
    """

    def __init__(self) -> None:
        self._threads_by_session: dict[str, Thread] = {}

    async def get_or_create_for_session(self, session_id: str) -> Thread:
        thread = self._threads_by_session.get(session_id)
        if thread is None:
            thread = Thread(owner_session_id=session_id)
            self._threads_by_session[session_id] = thread
        return thread

    async def append_message(self, thread: Thread, message: Message) -> None:
        thread.messages.append(message)
        thread.updated_at = datetime.now(UTC)
