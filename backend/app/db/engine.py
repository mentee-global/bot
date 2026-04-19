from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings

# NullPool: one connection per acquire, closed on release. Trades perf for
# robustness across async event loops (tests create fresh loops per test,
# pooled asyncpg sockets can't cross that boundary). Fine for our traffic;
# Railway closes idle connections aggressively anyway.
engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
)

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)
