"""Read + update the singleton `feedback_trigger_config` row.

Admins write through the admin route; logged-in users read via the
chat-side endpoint so the trigger hook can honor live changes without a
redeploy. The seed row is created by the `add_feedback_trigger_config`
migration, so `get()` always returns something.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.engine import async_session_factory
from app.domain.models import FeedbackTriggerConfig
from app.services.db_models import FeedbackTriggerConfigRecord

_VALID_MODES = frozenset({"interactions", "time"})


class FeedbackConfigError(Exception):
    """Raised on invalid update payloads. Maps to 400 in the route."""


def _to_domain(row: FeedbackTriggerConfigRecord) -> FeedbackTriggerConfig:
    return FeedbackTriggerConfig(
        enabled=row.enabled,
        mode=row.mode,
        interactions_first=row.interactions_first,
        interactions_repeat=row.interactions_repeat,
        time_first_minutes=row.time_first_minutes,
        time_repeat_minutes=row.time_repeat_minutes,
        re_rate_after_messages=row.re_rate_after_messages,
        updated_at=row.updated_at,
        updated_by_user_id=str(row.updated_by_user_id)
        if row.updated_by_user_id is not None
        else None,
    )


class FeedbackConfigService:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._factory = session_factory or async_session_factory

    async def get(self) -> FeedbackTriggerConfig:
        async with self._factory() as session:
            row = await self._load(session)
            return _to_domain(row)

    async def update(
        self,
        *,
        actor_id: str,
        enabled: bool,
        mode: str,
        interactions_first: int,
        interactions_repeat: int,
        time_first_minutes: int,
        time_repeat_minutes: int,
        re_rate_after_messages: int,
    ) -> FeedbackTriggerConfig:
        if mode not in _VALID_MODES:
            raise FeedbackConfigError(
                f"mode must be one of {sorted(_VALID_MODES)}; got {mode!r}"
            )
        # Pydantic + DB CHECK both enforce these bounds, but keep the
        # service-side guard so callers get a clean 400 instead of a CHECK
        # violation. `re_rate_after_messages` allows 0 (= never re-ask).
        for name, value in (
            ("interactions_first", interactions_first),
            ("interactions_repeat", interactions_repeat),
            ("time_first_minutes", time_first_minutes),
            ("time_repeat_minutes", time_repeat_minutes),
        ):
            if value < 1:
                raise FeedbackConfigError(f"{name} must be >= 1")
        if re_rate_after_messages < 0:
            raise FeedbackConfigError(
                "re_rate_after_messages must be >= 0"
            )

        async with self._factory() as session:
            row = await self._load(session)
            row.enabled = enabled
            row.mode = mode
            row.interactions_first = interactions_first
            row.interactions_repeat = interactions_repeat
            row.time_first_minutes = time_first_minutes
            row.time_repeat_minutes = time_repeat_minutes
            row.re_rate_after_messages = re_rate_after_messages
            row.updated_at = datetime.now(UTC)
            row.updated_by_user_id = UUID(actor_id)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return _to_domain(row)

    async def _load(
        self, session: AsyncSession
    ) -> FeedbackTriggerConfigRecord:
        # Singleton — `id = 1` is enforced by CHECK + seeded by migration.
        row = (
            await session.execute(
                select(FeedbackTriggerConfigRecord).where(
                    FeedbackTriggerConfigRecord.id == 1
                )
            )
        ).scalar_one_or_none()
        if row is None:
            # Defensive fallback if the seed somehow disappeared (e.g., the
            # row was manually deleted). Recreate it inline so callers don't
            # see a 500.
            now = datetime.now(UTC)
            row = FeedbackTriggerConfigRecord(
                id=1,
                enabled=True,
                mode="interactions",
                interactions_first=5,
                interactions_repeat=15,
                time_first_minutes=1440,
                time_repeat_minutes=10080,
                re_rate_after_messages=0,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
        return row
