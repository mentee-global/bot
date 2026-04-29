from typing import Annotated

import httpx
from fastapi import Cookie, Depends, HTTPException, status

from app.agents.base import AgentPort
from app.agents.mock.agent import MockAgent
from app.auth.errors import AuthError
from app.auth.mentee_profile_client import MenteeProfileClient
from app.auth.oauth_client import MenteeOAuthClient
from app.auth.service import AuthService
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.budget.service import BudgetService
from app.core.config import Settings, settings
from app.domain.models import User
from app.reports.service import ReportsService
from app.services.message_service import MessageService
from app.services.pg_thread_store import PostgresThreadStore
from app.services.thread_store import InMemoryThreadStore, ThreadStore

SESSION_COOKIE = settings.session_cookie_name


def _build_agent(s: Settings, budget: BudgetService) -> AgentPort:
    if s.agent_impl == "mentee":
        from app.agents.mentee.agent import build_mentee_agent

        return build_mentee_agent(s, budget=budget)
    return MockAgent()


def _build_store(s: Settings) -> ThreadStore:
    if s.store_impl == "postgres":
        return PostgresThreadStore()
    return InMemoryThreadStore()


# Process-wide singletons. Swap with a proper DI container when scope grows.
# Budget is built first so the agent can call it on provider errors.
_store: ThreadStore = _build_store(settings)
_budget = BudgetService()
_agent: AgentPort = _build_agent(settings, _budget)
_service = MessageService(store=_store, agent=_agent, budget=_budget)
_reports = ReportsService(budget=_budget, settings=settings)

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
    profile_client = MenteeProfileClient(settings, _http)
    _auth_service = AuthService(
        oauth=_oauth_client,
        sessions=_session_store,
        state=_state_store,
        settings=settings,
        profile_client=profile_client,
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


def get_session_store() -> SessionStore:
    if _session_store is None:
        raise RuntimeError(
            "SessionStore not initialized — call init_auth() at startup"
        )
    return _session_store


def get_message_service() -> MessageService:
    return _service


def get_budget_service() -> BudgetService:
    return _budget


def get_reports_service() -> ReportsService:
    return _reports


async def _resolve_session(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> tuple[str, User]:
    # Single auth lookup per request. FastAPI caches Depends results, so both
    # require_session and get_current_user reuse this tuple without hitting
    # Postgres twice.
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        user = await auth.current_user(session_id)
    except AuthError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        ) from err
    return session_id, user


async def require_session(
    resolved: Annotated[tuple[str, User], Depends(_resolve_session)],
) -> str:
    return resolved[0]


async def get_current_user(
    resolved: Annotated[tuple[str, User], Depends(_resolve_session)],
) -> User:
    return resolved[1]


async def require_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    # 404 (not 403) keeps the admin surface invisible to non-admins —
    # response shape is indistinguishable from a non-existent route.
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
        )
    return user


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


async def get_optional_user(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User | None:
    """Resolve the current user when a valid session cookie is present, else
    return None. Used by endpoints that accept both authenticated and
    anonymous traffic — e.g. the bug-report submit endpoint, where a visitor
    on the landing page can report bugs without logging in but a logged-in
    user gets their identity auto-attached."""
    if not session_id:
        return None
    try:
        return await auth.current_user(session_id)
    except AuthError:
        return None
