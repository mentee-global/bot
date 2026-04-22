from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.crypto import encrypt
from app.auth.db_models import SessionRecord, UserRecord
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
    ) -> tuple[UserRecord, SessionRecord]:
        """Upsert the user (by mentee_sub) and insert a fresh session in one tx.

        Returns (user, session). The user's profile fields are always
        overwritten with the latest OAuth claims — Mentee is authoritative.
        """
        now = _now()
        mentee_sub = str(claims["sub"])
        email = str(claims["email"])
        name = str(claims.get("name", ""))
        role = str(claims.get("role", ""))
        role_id = int(claims.get("role_id", 0))
        picture = _as_str_or_none(claims.get("picture"))
        preferred_language = _as_str_or_none(claims.get("preferred_language"))
        timezone = _as_str_or_none(claims.get("timezone"))

        async with self._factory() as session:
            upsert = (
                pg_insert(UserRecord)
                .values(
                    mentee_sub=mentee_sub,
                    email=email,
                    name=name,
                    role=role,
                    role_id=role_id,
                    picture=picture,
                    preferred_language=preferred_language,
                    timezone=timezone,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=[UserRecord.mentee_sub],
                    set_=dict(
                        email=email,
                        name=name,
                        role=role,
                        role_id=role_id,
                        picture=picture,
                        preferred_language=preferred_language,
                        timezone=timezone,
                        updated_at=now,
                    ),
                )
                .returning(UserRecord)
            )
            user_row = (await session.execute(upsert)).scalar_one()

            session_row = SessionRecord(
                session_id=session_id,
                user_id=user_row.id,
                access_token_enc=encrypt(access_token),
                access_token_expires_at=access_token_expires_at,
                refresh_token_enc=encrypt(refresh_token) if refresh_token else None,
                id_token_nonce=id_token_nonce,
                created_at=now,
                last_used_at=now,
            )
            session.add(session_row)
            await session.commit()
            await session.refresh(session_row)
            await session.refresh(user_row)
        return user_row, session_row

    async def get(self, session_id: str) -> SessionRecord | None:
        async with self._factory() as session:
            result = await session.execute(
                select(SessionRecord).where(SessionRecord.session_id == session_id)
            )
            return result.scalar_one_or_none()

    async def get_and_touch_with_user(
        self, session_id: str
    ) -> tuple[SessionRecord, UserRecord] | None:
        """Load the session + its user and bump last_used_at in one round-trip.

        Used on the hot auth path: every authenticated API call pays one DB
        query for identity instead of two (UPDATE session + SELECT user).
        """
        async with self._factory() as session:
            touched = await session.execute(
                update(SessionRecord)
                .where(SessionRecord.session_id == session_id)
                .values(last_used_at=_now())
                .returning(SessionRecord)
            )
            session_row = touched.scalar_one_or_none()
            if session_row is None:
                await session.commit()
                return None
            user_row = (
                await session.execute(
                    select(UserRecord).where(UserRecord.id == session_row.user_id)
                )
            ).scalar_one_or_none()
            await session.commit()
            if user_row is None:
                # FK violation should be impossible with ON DELETE CASCADE,
                # but treat it defensively as a stale session.
                return None
            return session_row, user_row

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
        """Refresh flow: tokens write to `sessions`; profile (when fetched
        successfully) writes to `users` via the session's FK."""
        now = _now()
        session_values: dict[str, Any] = {
            "access_token_enc": encrypt(access_token),
            "access_token_expires_at": access_token_expires_at,
            "last_used_at": now,
        }
        if refresh_token is not None:
            session_values["refresh_token_enc"] = encrypt(refresh_token)

        async with self._factory() as session:
            await session.execute(
                update(SessionRecord)
                .where(SessionRecord.session_id == session_id)
                .values(**session_values)
            )

            if profile is not None:
                user_values = {
                    "email": str(profile.get("email", "")),
                    "name": str(profile.get("name", "")),
                    "role": str(profile.get("role", "")),
                    "role_id": int(profile.get("role_id", 0)),
                    "picture": _as_str_or_none(profile.get("picture")),
                    "preferred_language": _as_str_or_none(
                        profile.get("preferred_language")
                    ),
                    "timezone": _as_str_or_none(profile.get("timezone")),
                    "updated_at": now,
                }
                await session.execute(
                    update(UserRecord)
                    .where(
                        UserRecord.id
                        == select(SessionRecord.user_id)
                        .where(SessionRecord.session_id == session_id)
                        .scalar_subquery()
                    )
                    .values(**user_values)
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

    async def list_sessions_for_user(
        self, user_id: UUID, *, limit: int = 10
    ) -> list[SessionRecord]:
        """Most-recent sessions for a given user, newest first."""
        async with self._factory() as session:
            result = await session.execute(
                select(SessionRecord)
                .where(SessionRecord.user_id == user_id)
                .order_by(SessionRecord.last_used_at.desc())
                .limit(limit)
            )
            return list(result.scalars().all())

    async def delete_all_for_user(self, user_id: UUID) -> int:
        """Admin force-logout: delete every session row for a user.
        Returns the number of rows deleted."""
        async with self._factory() as session:
            result = await session.execute(
                delete(SessionRecord).where(SessionRecord.user_id == user_id)
            )
            await session.commit()
            return result.rowcount or 0

    async def get_user_by_sub(self, mentee_sub: str) -> UserRecord | None:
        async with self._factory() as session:
            return (
                await session.execute(
                    select(UserRecord).where(UserRecord.mentee_sub == mentee_sub)
                )
            ).scalar_one_or_none()

    async def get_user_by_id(self, user_id: UUID) -> UserRecord | None:
        async with self._factory() as session:
            return (
                await session.execute(
                    select(UserRecord).where(UserRecord.id == user_id)
                )
            ).scalar_one_or_none()

    async def get_identities(
        self, user_ids: list[UUID]
    ) -> dict[UUID, tuple[str | None, str | None]]:
        """Return `user_id -> (email, name)` for the given ids. Missing ids are
        omitted from the result."""
        if not user_ids:
            return {}
        async with self._factory() as session:
            rows = (
                await session.execute(
                    select(UserRecord.id, UserRecord.email, UserRecord.name)
                    .where(UserRecord.id.in_(user_ids))
                )
            ).all()
        return {uid: (email or None, name or None) for uid, email, name in rows}

    async def list_users(
        self,
        *,
        limit: int = 25,
        offset: int = 0,
        role: str | None = None,
        query: str | None = None,
    ) -> list[tuple[UserRecord, datetime | None]]:
        """Users with their most-recent session `last_used_at`, most-active
        first. Returns `(user_row, last_used_at)` tuples; `last_used_at` is
        None for users who have no sessions (shouldn't happen in practice but
        we tolerate it after ON DELETE CASCADE cleanups)."""
        last_used = (
            select(
                SessionRecord.user_id.label("user_id"),
                func.max(SessionRecord.last_used_at).label("last_used_at"),
            )
            .group_by(SessionRecord.user_id)
            .subquery()
        )
        stmt = (
            select(UserRecord, last_used.c.last_used_at)
            .join(last_used, last_used.c.user_id == UserRecord.id, isouter=True)
            .order_by(
                last_used.c.last_used_at.desc().nulls_last(),
                UserRecord.created_at.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        stmt = _apply_user_filters(stmt, role=role, query=query)
        async with self._factory() as session:
            rows = (await session.execute(stmt)).all()
        return [(user, last) for user, last in rows]

    async def count_users(
        self, *, role: str | None = None, query: str | None = None
    ) -> int:
        stmt = select(func.count()).select_from(UserRecord)
        stmt = _apply_user_filters(stmt, role=role, query=query)
        async with self._factory() as session:
            return int((await session.execute(stmt)).scalar_one() or 0)


def _apply_user_filters(stmt, *, role: str | None, query: str | None):  # type: ignore[no-untyped-def]
    if role:
        stmt = stmt.where(UserRecord.role == role)
    if query:
        needle = f"%{query.lower()}%"
        stmt = stmt.where(
            or_(UserRecord.email.ilike(needle), UserRecord.name.ilike(needle))
        )
    return stmt


def _as_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value)
    return s if s else None
