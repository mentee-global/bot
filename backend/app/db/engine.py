from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# Pool sized for a single-process Uvicorn dev / small Railway deploy. Railway's
# public Postgres proxy adds ~500ms of TCP+TLS handshake per new socket, so
# every unpooled query paid that cost — the default async pool keeps a handful
# of warm connections around and drops the steady-state cost to a single
# round-trip. `pool_pre_ping` guards against Railway reaping idle sockets, and
# `pool_recycle` rolls connections before they hit the proxy's idle timeout.
engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=1800,
)

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)
