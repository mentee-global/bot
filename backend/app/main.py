import asyncio
import logging
from contextlib import asynccontextmanager

import logfire
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import init_auth, shutdown_auth
from app.api.routes import admin, auth, chat, health
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import settings

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(o).rstrip("/") for o in settings.cors_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(auth.router)
app.include_router(admin.router)
