from datetime import UTC, datetime

from app.domain.models import Message, Thread


class ThreadStore:
    """In-memory thread store. Single thread per session for MVP.

    Swap for a real DB (Postgres/Mongo) later — keep the method signatures.
    """

    def __init__(self) -> None:
        self._threads_by_session: dict[str, Thread] = {}

    def get_or_create_for_session(self, session_id: str) -> Thread:
        thread = self._threads_by_session.get(session_id)
        if thread is None:
            thread = Thread(owner_session_id=session_id)
            self._threads_by_session[session_id] = thread
        return thread

    def append_message(self, thread: Thread, message: Message) -> None:
        thread.messages.append(message)
        thread.updated_at = datetime.now(UTC)
