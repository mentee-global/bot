from typing import Annotated

import httpx
from fastapi import Cookie, Depends, HTTPException, status

from app.agents.base import AgentPort
from app.agents.mock.agent import MockAgent
from app.auth.errors import AuthError
from app.auth.oauth_client import MenteeOAuthClient
from app.auth.service import AuthService
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import Settings, settings
from app.domain.models import User
from app.services.message_service import MessageService
from app.services.pg_thread_store import PostgresThreadStore
from app.services.thread_store import InMemoryThreadStore, ThreadStore

SESSION_COOKIE = settings.session_cookie_name


def _build_agent(s: Settings) -> AgentPort:
    if s.agent_impl == "mentee":
        from app.agents.mentee.agent import build_mentee_agent

        return build_mentee_agent(s)
    return MockAgent()


def _build_store(s: Settings) -> ThreadStore:
    if s.store_impl == "postgres":
        return PostgresThreadStore()
    return InMemoryThreadStore()


# Process-wide singletons. Swap with a proper DI container when scope grows.
_store: ThreadStore = _build_store(settings)
_agent: AgentPort = _build_agent(settings)
_service = MessageService(store=_store, agent=_agent)

_http: httpx.AsyncClient | None = None
_oauth_client: MenteeOAuthClient | None = None
_session_store: SessionStore | None = None
_state_store: StateStore | None = None
_auth_service: AuthService | None = None


async def init_auth() -> None:
    """Called once at app startup. Loads the OIDC discovery doc so the first
    /api/auth/login request doesn't pay the latency.
    """
    global _http, _oauth_client, _session_store, _state_store, _auth_service
    if _auth_service is not None:
        return
    _http = httpx.AsyncClient(timeout=10.0)
    _oauth_client = MenteeOAuthClient(settings, _http)
    await _oauth_client.load_metadata()
    _session_store = SessionStore()
    _state_store = StateStore()
    _auth_service = AuthService(
        oauth=_oauth_client,
        sessions=_session_store,
        state=_state_store,
        settings=settings,
    )


async def shutdown_auth() -> None:
    global _http, _oauth_client, _session_store, _state_store, _auth_service
    if _http is not None:
        await _http.aclose()
    _http = None
    _oauth_client = None
    _session_store = None
    _state_store = None
    _auth_service = None


def get_auth_service() -> AuthService:
    if _auth_service is None:
        raise RuntimeError(
            "AuthService not initialized — call init_auth() at startup"
        )
    return _auth_service


def get_message_service() -> MessageService:
    return _service


async def require_session(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> str:
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        await auth.current_user(session_id)
    except AuthError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        ) from err
    return session_id


async def get_current_user(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str, Depends(require_session)],
) -> User:
    # require_session already resolved the user once; do it again to get the
    # User object. Cheap because SessionStore.get hits Postgres and both
    # reads happen inside the same request.
    return await auth.current_user(session_id)


async def optional_session(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> str | None:
    if not session_id:
        return None
    try:
        await auth.current_user(session_id)
    except AuthError:
        return None
    return session_id
