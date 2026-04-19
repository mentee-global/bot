import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import init_auth, shutdown_auth
from app.api.routes import auth, chat, health
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

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


app = FastAPI(title="Mentee Bot API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(o).rstrip("/") for o in settings.cors_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(auth.router)
