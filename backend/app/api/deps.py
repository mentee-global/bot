from typing import Annotated

from fastapi import Cookie, HTTPException, Request, status

from app.agents.mock.agent import MockAgent
from app.services.message_service import MessageService
from app.services.thread_store import ThreadStore

SESSION_COOKIE = "mentee_session"

# Process-wide singletons. Swap with a proper DI container when scope grows.
_store = ThreadStore()
_agent = MockAgent()
_service = MessageService(store=_store, agent=_agent)

# In-memory session -> user mapping. Replace with real OAuth session store later.
_sessions: dict[str, dict[str, str]] = {}


def get_message_service() -> MessageService:
    return _service


def get_sessions() -> dict[str, dict[str, str]]:
    return _sessions


def require_session(
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> str:
    if not session_id or session_id not in _sessions:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return session_id


def optional_session(request: Request) -> str | None:
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id and session_id in _sessions:
        return session_id
    return None
