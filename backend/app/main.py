import asyncio
import logging
from contextlib import asynccontextmanager

import logfire
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.deps import init_auth, shutdown_auth
from app.api.routes import admin, admin_budget, auth, chat, health, me
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import settings
from app.core.rate_limit import limiter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def _configure_logfire() -> None:
    """Wire Logfire tracing + third-party instrumentations.

    Safe to call when no LOGFIRE_TOKEN is set: logfire.configure(send_to_logfire=False)
    gives us a local-only noop sink so spans are still created (and emitted to
    stdout in verbose mode) but nothing leaves the process.
    """
    logfire.configure(
        service_name=settings.logfire_service_name,
        environment=settings.environment,
        send_to_logfire=(
            settings.logfire_send_to_cloud and settings.logfire_token is not None
        ),
        token=(
            settings.logfire_token.get_secret_value()
            if settings.logfire_token is not None
            else None
        ),
    )
    logfire.instrument_pydantic_ai()
    logfire.instrument_openai()
    logfire.instrument_httpx()


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


@asynccontextmanager
async def lifespan(app: FastAPI):
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

app = FastAPI(title="Mentee Bot API", version="0.1.0", lifespan=lifespan)
logfire.instrument_fastapi(app, capture_headers=False)

# Wire slowapi. The limiter object is shared with route modules via
# `app.core.rate_limit`; routes attach `@limiter.limit(...)` decorators.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


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
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(admin.router)
app.include_router(admin_budget.router)
