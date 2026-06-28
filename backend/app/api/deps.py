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
from app.documents.base import (
    BlobStorePort,
    DocumentProcessorPort,
    DocumentRetrievalPort,
)
from app.documents.blob_store import DiskBlobStore, S3BlobStore
from app.documents.processors.local import LocalProcessor
from app.documents.service import DocumentService
from app.documents.store import (
    DocumentStore,
    InMemoryDocumentStore,
    PostgresDocumentStore,
)
from app.domain.models import User
from app.reports.service import ReportsService
from app.services.feedback_config_service import FeedbackConfigService
from app.services.message_service import MessageService
from app.services.pg_thread_store import PostgresThreadStore
from app.services.thread_store import InMemoryThreadStore, ThreadStore

SESSION_COOKIE = settings.session_cookie_name
LOGIN_ATTEMPT_COOKIE = settings.login_attempt_cookie_name


def _build_agent(s: Settings, budget: BudgetService) -> AgentPort:
    if s.agent_impl == "mentee":
        from app.agents.mentee.agent import build_mentee_agent

        return build_mentee_agent(s, budget=budget)
    return MockAgent()


def _build_store(s: Settings) -> ThreadStore:
    if s.store_impl == "postgres":
        return PostgresThreadStore()
    return InMemoryThreadStore()


def _build_document_store(s: Settings) -> DocumentStore:
    if s.store_impl == "postgres":
        return PostgresDocumentStore()
    return InMemoryDocumentStore()


def _build_blob_store(s: Settings) -> BlobStorePort:
    if s.blob_store_impl == "s3":
        if (
            s.aws_s3_bucket_name is None
            or s.aws_access_key_id is None
            or s.aws_secret_access_key is None
        ):
            raise RuntimeError(
                "BLOB_STORE_IMPL=s3 requires AWS_S3_BUCKET_NAME, "
                "AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY"
            )
        return S3BlobStore(
            bucket=s.aws_s3_bucket_name,
            endpoint_url=s.aws_endpoint_url,
            region_name=s.aws_default_region,
            access_key_id=s.aws_access_key_id.get_secret_value(),
            secret_access_key=s.aws_secret_access_key.get_secret_value(),
            url_style=s.aws_s3_url_style,
        )
    return DiskBlobStore(s.blob_store_path)


def _build_doc_processor(s: Settings) -> DocumentProcessorPort:
    # "openai" needs a key (model-written summaries + future OCR); falls back to
    # the dependency-free local parser otherwise. "llamacloud" is plan Phase 5.
    if s.doc_processor_impl == "openai" and s.openai_api_key is not None:
        from app.documents.processors.openai import OpenAIDocumentProcessor

        return OpenAIDocumentProcessor(
            api_key=s.openai_api_key.get_secret_value(),
            model=s.agent_model,
        )
    return LocalProcessor()


def _build_retrieval(s: Settings) -> DocumentRetrievalPort | None:
    # Retrieval is a plan Phase 4 concern; "none" in the MVP.
    return None


# Process-wide singletons. Swap with a proper DI container when scope grows.
# Budget is built first so the agent can call it on provider errors.
_store: ThreadStore = _build_store(settings)
_budget = BudgetService()
_agent: AgentPort = _build_agent(settings, _budget)

# Document upload & processing singletons (plan Phase 0/1). Built before the
# MessageService so chat turns can inject thread document context.
_document_store: DocumentStore = _build_document_store(settings)
_blob_store: BlobStorePort = _build_blob_store(settings)
_doc_processor: DocumentProcessorPort = _build_doc_processor(settings)
_document_service = DocumentService(
    store=_document_store,
    blobs=_blob_store,
    processor=_doc_processor,
    threads=_store,
    retrieval=_build_retrieval(settings),
)

_service = MessageService(
    store=_store, agent=_agent, budget=_budget, documents=_document_service
)
_reports = ReportsService(budget=_budget, settings=settings)
_feedback_config = FeedbackConfigService()

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


def get_feedback_config_service() -> FeedbackConfigService:
    return _feedback_config


def get_document_store() -> DocumentStore:
    return _document_store


def get_blob_store() -> BlobStorePort:
    return _blob_store


def get_document_service() -> DocumentService:
    return _document_service


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
