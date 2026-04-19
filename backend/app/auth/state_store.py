from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.db_models import OAuthStateRecord
from app.core.config import settings
from app.db.engine import async_session_factory


def _now() -> datetime:
    return datetime.now(UTC)


class StateStore:
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession] | None = None
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def put(
        self,
        *,
        state: str,
        code_verifier: str,
        nonce: str,
        redirect_to: str | None,
    ) -> None:
        now = _now()
        row = OAuthStateRecord(
            state=state,
            code_verifier=code_verifier,
            nonce=nonce,
            redirect_to=redirect_to,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.oauth_state_ttl_seconds),
        )
        async with self._factory() as session:
            session.add(row)
            await session.commit()

    async def pop(self, state: str) -> OAuthStateRecord | None:
        """Single-use read. Deletes the row whether or not it's still valid."""
        async with self._factory() as session:
            result = await session.execute(
                select(OAuthStateRecord).where(OAuthStateRecord.state == state)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            await session.delete(row)
            await session.commit()
            if row.expires_at <= _now():
                return None
            return row

    async def cleanup_expired(self) -> int:
        async with self._factory() as session:
            result = await session.execute(
                delete(OAuthStateRecord).where(OAuthStateRecord.expires_at <= _now())
            )
            await session.commit()
            return result.rowcount or 0
