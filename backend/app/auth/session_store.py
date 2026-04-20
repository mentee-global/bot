from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.crypto import encrypt
from app.auth.db_models import SessionRecord
from app.db.engine import async_session_factory


def _now() -> datetime:
    return datetime.now(UTC)


class SessionStore:
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession] | None = None
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def create(
        self,
        *,
        session_id: str,
        claims: Mapping[str, Any],
        access_token: str,
        access_token_expires_at: datetime,
        refresh_token: str | None,
        id_token_nonce: str,
    ) -> SessionRecord:
        now = _now()
        row = SessionRecord(
            session_id=session_id,
            mentee_sub=str(claims["sub"]),
            email=str(claims["email"]),
            name=str(claims.get("name", "")),
            role=str(claims.get("role", "")),
            role_id=int(claims.get("role_id", 0)),
            picture=_as_str_or_none(claims.get("picture")),
            preferred_language=_as_str_or_none(claims.get("preferred_language")),
            timezone=_as_str_or_none(claims.get("timezone")),
            access_token_enc=encrypt(access_token),
            access_token_expires_at=access_token_expires_at,
            refresh_token_enc=encrypt(refresh_token) if refresh_token else None,
            id_token_nonce=id_token_nonce,
            created_at=now,
            last_used_at=now,
        )
        async with self._factory() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)
        return row

    async def get(self, session_id: str) -> SessionRecord | None:
        async with self._factory() as session:
            result = await session.execute(
                select(SessionRecord).where(SessionRecord.session_id == session_id)
            )
            return result.scalar_one_or_none()

    async def get_and_touch(self, session_id: str) -> SessionRecord | None:
        """Load the session and bump last_used_at in a single round-trip.

        Used on the hot auth path so every authenticated API call pays one
        DB query for identity instead of two (SELECT + UPDATE).
        """
        async with self._factory() as session:
            result = await session.execute(
                update(SessionRecord)
                .where(SessionRecord.session_id == session_id)
                .values(last_used_at=_now())
                .returning(SessionRecord)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return row

    async def touch(self, session_id: str) -> None:
        async with self._factory() as session:
            await session.execute(
                update(SessionRecord)
                .where(SessionRecord.session_id == session_id)
                .values(last_used_at=_now())
            )
            await session.commit()

    async def update_tokens_and_profile(
        self,
        session_id: str,
        *,
        access_token: str,
        access_token_expires_at: datetime,
        refresh_token: str | None,
        profile: Mapping[str, Any] | None,
    ) -> None:
        values: dict[str, Any] = {
            "access_token_enc": encrypt(access_token),
            "access_token_expires_at": access_token_expires_at,
            "last_used_at": _now(),
        }
        if refresh_token is not None:
            values["refresh_token_enc"] = encrypt(refresh_token)
        if profile is not None:
            values["email"] = str(profile.get("email", ""))
            values["name"] = str(profile.get("name", ""))
            values["role"] = str(profile.get("role", ""))
            values["role_id"] = int(profile.get("role_id", 0))
            values["picture"] = _as_str_or_none(profile.get("picture"))
            values["preferred_language"] = _as_str_or_none(profile.get("preferred_language"))
            values["timezone"] = _as_str_or_none(profile.get("timezone"))
        async with self._factory() as session:
            await session.execute(
                update(SessionRecord)
                .where(SessionRecord.session_id == session_id)
                .values(**values)
            )
            await session.commit()

    async def delete(self, session_id: str) -> None:
        async with self._factory() as session:
            await session.execute(
                delete(SessionRecord).where(SessionRecord.session_id == session_id)
            )
            await session.commit()

    async def cleanup_expired(self, max_age: int) -> int:
        cutoff = _now() - timedelta(seconds=max_age)
        async with self._factory() as session:
            result = await session.execute(
                delete(SessionRecord).where(SessionRecord.created_at <= cutoff)
            )
            await session.commit()
            return result.rowcount or 0


def _as_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value)
    return s if s else None
