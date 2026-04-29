import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

import logfire
import posthog
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.api.deps import init_auth, shutdown_auth
from app.api.routes import (
    admin,
    admin_budget,
    admin_reports,
    auth,
    chat,
    health,
    me,
    reports,
)
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core import posthog_client
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.engine import async_session_factory

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def _configure_logfire() -> None:
    """Wire Logfire tracing + third-party instrumentations.

    Cloud send is gated only on token presence: with a token, traces ship to
    Logfire; without one, spans still exist locally but nothing leaves the
    process. Pydantic AI is configured to include prompt + completion content
    so message bodies are queryable in the UI.
    """
    has_token = settings.logfire_token is not None
    logfire.configure(
        service_name=settings.logfire_service_name,
        environment=settings.environment,
        send_to_logfire=has_token,
        token=(
            settings.logfire_token.get_secret_value() if has_token else None
        ),
    )
    logfire.instrument_pydantic_ai(include_content=True)
    logfire.instrument_openai()
    logfire.instrument_httpx()


def _configure_posthog() -> None:
    """Wire the posthog Python SDK against module-level globals.

    Token unset = `posthog.disabled = True` and every helper in
    `app.core.posthog_client` becomes a no-op. With a key, server-side events
    ship to the same project the frontend uses; identify joins on user.id.
    """
    if settings.posthog_api_key is None:
        posthog.disabled = True
        return
    posthog.api_key = settings.posthog_api_key.get_secret_value()
    posthog.host = settings.posthog_host
    posthog.debug = not settings.is_prod


_cleanup_task: asyncio.Task[None] | None = None


async def _cleanup_loop() -> None:
    state = StateStore()
    sessions = SessionStore()
    while True:
        try:
            await state.cleanup_expired()
            await sessions.cleanup_expired(max_age=settings.session_max_age_seconds)
        except Exception as exc:  # noqa: BLE001 — loop must never die
            logger.warning("cleanup loop error: %s", exc)
        await asyncio.sleep(300)


class SchemaDriftError(RuntimeError):
    """Raised when the live database is on an older Alembic revision than the
    code expects. Refusing to start with a clear message beats letting the next
    query crash on a missing column halfway through a request."""


def _alembic_head_revision() -> str:
    """Read the latest migration revision from the alembic scripts directory.
    Pure file-system read; no DB roundtrip."""
    cfg = AlembicConfig(
        str(Path(__file__).resolve().parent.parent / "alembic.ini")
    )
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()
    if head is None:
        raise SchemaDriftError("alembic has no migrations defined")
    return head


async def _verify_schema_up_to_date() -> None:
    """Compare the DB's `alembic_version` row to the latest migration script.

    Production deploys run `alembic upgrade head` as a release step (see
    `Procfile` / `railway.json`), so this check is a no-op there. In local dev
    it catches the case where someone pulled new code that depends on a
    migration they haven't run yet — preventing column-not-exist errors from
    reaching live requests.
    """
    head = _alembic_head_revision()
    async with async_session_factory() as session:
        try:
            row = (
                await session.execute(
                    text("SELECT version_num FROM alembic_version")
                )
            ).scalar_one_or_none()
        except Exception as err:
            raise SchemaDriftError(
                f"Cannot read alembic_version (is the DB initialized?): {err}"
            ) from err
    if row is None:
        raise SchemaDriftError(
            "Database has no alembic_version row. "
            "Run: cd backend && uv run alembic upgrade head"
        )
    if row != head:
        raise SchemaDriftError(
            f"Database is on revision {row!r} but code expects {head!r}. "
            "Run: cd backend && uv run alembic upgrade head"
        )
    logger.info("schema check ok: alembic_version=%s", row)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await _verify_schema_up_to_date()
    except SchemaDriftError as err:
        # Fail loudly. uvicorn --reload will repeat this until the user runs
        # the migration; nothing past this point would work anyway.
        logger.error("=" * 72)
        logger.error("SCHEMA DRIFT — refusing to start: %s", err)
        logger.error("=" * 72)
        raise
    await init_auth()
    global _cleanup_task
    _cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        if _cleanup_task is not None:
            _cleanup_task.cancel()
            try:
                await _cleanup_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        await shutdown_auth()


# Configure Logfire once at import time. Instrumentors (fastapi, openai, httpx)
# patch global state and bark if called twice, so keep this outside lifespan —
# the TestClient re-enters the lifespan per test.
_configure_logfire()
_configure_posthog()

app = FastAPI(title="Mentee Bot API", version="0.1.0", lifespan=lifespan)
logfire.instrument_fastapi(app, capture_headers=False)

# Wire slowapi. The limiter object is shared with route modules via
# `app.core.rate_limit`; routes attach `@limiter.limit(...)` decorators.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def unhandled_exception_handler(  # type: ignore[no-untyped-def]
    request: Request, exc: Exception
):
    """Return structured 500s so the admin UI can show actionable detail.

    In non-production environments we include the exception class and message
    plus the last few frames of the traceback. In production we keep the body
    minimal to avoid leaking internals.

    Always logged at ERROR level with the full trace regardless of verbosity.
    """
    logger.exception(
        "unhandled error on %s %s: %s",
        request.method,
        request.url.path,
        exc,
    )
    posthog_client.capture_exception(
        exc, path=request.url.path, method=request.method
    )
    payload: dict[str, object] = {"detail": "Internal server error"}
    if not settings.is_prod:
        tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
        # Last ~12 lines is enough to pinpoint the failing call without
        # dumping the entire async machinery underneath it.
        payload["type"] = type(exc).__name__
        payload["message"] = str(exc)
        payload["trace"] = "".join(tb[-12:])
        payload["path"] = f"{request.method} {request.url.path}"
    return JSONResponse(status_code=500, content=payload)


_ALLOWED_ORIGINS = {str(o).rstrip("/") for o in settings.cors_origins}
_MUTATING_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})


@app.middleware("http")
async def origin_guard_and_security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Defence-in-depth on top of CORS + SameSite=lax.

    For mutating methods we require the `Origin` header to match
    `cors_origins`. Browsers always attach Origin to cross-site POST/PATCH/
    PUT/DELETE, so a mismatch means the request is forged or coming from a
    non-browser tool — reject before the route runs.

    Same-origin requests where the browser omits Origin (older Safari on
    GET-following-redirect cases) aren't affected: we only enforce on
    mutating methods.

    The OAuth callback and the public health endpoint live on GET, so they
    bypass this naturally.
    """
    if request.method in _MUTATING_METHODS:
        origin = request.headers.get("origin")
        if origin is not None and origin.rstrip("/") not in _ALLOWED_ORIGINS:
            return JSONResponse(
                status_code=403,
                content={"detail": "Origin not allowed"},
            )
    response: Response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-UI-Locale"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(admin.router)
app.include_router(admin_budget.router)
app.include_router(reports.router)
app.include_router(admin_reports.router)
