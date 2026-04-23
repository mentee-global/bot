"""Quota + global-budget orchestration.

Every turn flows through two methods:

1. `check_can_chat(user)` — pre-run gate. Raises `QuotaError` / `BudgetError`
   if the user is out of credits or the provider kill-switch is engaged.
   Returns a snapshot of how many credits the user has and whether Perplexity
   is degraded.

2. `record_turn(user, message_id, thread_id, usage)` — post-run debit. Writes
   one `MessageUsage` row per model called, adjusts the user's remaining
   credits, and rolls the per-provider spend totals. The ledger is an estimate
   (tokens × configured pricing); the authoritative signal for "the provider
   is out of money" is the provider itself returning an insufficient-funds
   error — see `record_provider_out_of_funds`.

Admin reset / grant / revoke mutate `UserQuota` directly. All of it is
auditable via `MessageUsage` + WARNING-level logs on admin mutations.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.budget.db_models import (
    BudgetConfig,
    BudgetConfigChangeLog,
    GlobalBudgetState,
    MessageUsage,
    UserQuota,
)
from app.budget.pricing import compute_cost, micros_to_credits
from app.budget.usage import UsageSummary
from app.db.engine import async_session_factory
from app.domain.models import User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


def _as_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _period_start(now: datetime | None = None) -> datetime:
    """First day of the current month, UTC. Monthly quota resets anchor here."""
    now = now or _now()
    return datetime(now.year, now.month, 1, tzinfo=UTC)


class BudgetError(Exception):
    """Base class for budget / quota rejections."""


class QuotaExhaustedError(BudgetError):
    """The user has no credits remaining this month."""

    def __init__(self, credits_remaining: int, resets_at: datetime) -> None:
        super().__init__("User quota exhausted")
        self.credits_remaining = credits_remaining
        self.resets_at = resets_at


class GlobalBudgetExhaustedError(BudgetError):
    """The platform hit its global monthly cap; chat is paused."""

    def __init__(self, resets_at: datetime) -> None:
        super().__init__("Global budget exhausted")
        self.resets_at = resets_at


@dataclass(frozen=True)
class QuotaSnapshot:
    credits_remaining: int
    credits_used: int
    credits_total: int
    resets_at: datetime
    perplexity_degraded: bool
    is_admin: bool
    hard_stopped: bool


@dataclass(frozen=True)
class GlobalSpendSnapshot:
    period_start: datetime
    openai_spend_micros: int
    perplexity_spend_micros: int
    web_search_spend_micros: int
    total_spend_micros: int
    perplexity_degraded: bool
    hard_stopped: bool
    perplexity_degrade_reason: str | None
    perplexity_degraded_at: datetime | None
    hard_stop_reason: str | None
    hard_stopped_at: datetime | None


def _next_period_start(period_start: datetime) -> datetime:
    year = period_start.year
    month = period_start.month + 1
    if month > 12:
        month = 1
        year += 1
    return datetime(year, month, 1, tzinfo=UTC)


class BudgetService:
    """All quota / spend reads + writes. Construct one; share process-wide."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._factory = session_factory or async_session_factory

    # ---- Config ---------------------------------------------------------

    async def _load_config(self, session: AsyncSession) -> BudgetConfig:
        row = (
            await session.execute(select(BudgetConfig).where(BudgetConfig.id == 1))
        ).scalar_one_or_none()
        if row is None:
            row = BudgetConfig(id=1, updated_at=_now())
            session.add(row)
            await session.flush()
        return row

    async def get_config(self) -> BudgetConfig:
        async with self._factory() as session:
            cfg = await self._load_config(session)
            await session.commit()
            return cfg

    CONFIG_FIELDS = (
        "default_monthly_credits",
        "credit_usd_value_micros",
        "pricing_openai_input_per_mtok_micros",
        "pricing_openai_output_per_mtok_micros",
        "pricing_perplexity_input_per_mtok_micros",
        "pricing_perplexity_output_per_mtok_micros",
        "pricing_perplexity_request_fee_micros",
        "pricing_web_search_per_call_micros",
    )

    async def update_config(
        self,
        *,
        reason: str,
        actor_email: str,
        **changes: int,
    ) -> BudgetConfig:
        """Partial update with an audit row per changed field.

        Every admin edit must be accompanied by a `reason` string — a future
        admin looking at the history should understand *why* a rate moved.
        No-op fields (value unchanged) are skipped so the log only records
        real edits. Unknown keys are ignored; the caller (API layer) does
        value validation.
        """
        reason = reason.strip()
        if len(reason) < 5:
            raise ValueError("reason must be at least 5 characters")
        async with self._factory() as session:
            cfg = await self._load_config(session)
            now = _now()
            for key, value in changes.items():
                if key not in self.CONFIG_FIELDS or value is None:
                    continue
                new_value = int(value)
                old_value = int(getattr(cfg, key))
                if new_value == old_value:
                    continue
                setattr(cfg, key, new_value)
                session.add(
                    BudgetConfigChangeLog(
                        field=key,
                        old_value=old_value,
                        new_value=new_value,
                        reason=reason,
                        actor_email=actor_email,
                        changed_at=now,
                    )
                )
            cfg.updated_at = now
            session.add(cfg)
            await session.commit()
            await session.refresh(cfg)
            return cfg

    async def list_config_changes(
        self, *, limit: int = 50
    ) -> list[BudgetConfigChangeLog]:
        """Most recent config edits first. Capped so one scroll is bounded."""
        async with self._factory() as session:
            rows = (
                await session.execute(
                    select(BudgetConfigChangeLog)
                    .order_by(desc(BudgetConfigChangeLog.changed_at))
                    .limit(limit)
                )
            ).scalars().all()
            return list(rows)

    # ---- Global state ---------------------------------------------------

    async def _load_global_state(
        self, session: AsyncSession
    ) -> GlobalBudgetState:
        row = (
            await session.execute(
                select(GlobalBudgetState).where(GlobalBudgetState.id == 1)
            )
        ).scalar_one_or_none()
        now = _now()
        period = _period_start(now)
        if row is None:
            row = GlobalBudgetState(
                id=1,
                period_start=period,
                updated_at=now,
            )
            session.add(row)
            await session.flush()
            return row

        if row.period_start < period:
            # Monthly roll — zero the counters and clear the flags. Provider
            # balances reset at the calendar rollover too, so any reason that
            # was stamped for the previous period is no longer accurate.
            row.period_start = period
            row.openai_spend_micros = 0
            row.perplexity_spend_micros = 0
            row.web_search_spend_micros = 0
            row.perplexity_degraded = False
            row.hard_stopped = False
            row.perplexity_degrade_reason = None
            row.perplexity_degraded_at = None
            row.hard_stop_reason = None
            row.hard_stopped_at = None
            row.updated_at = now
            session.add(row)
            await session.flush()
        return row

    async def get_global_snapshot(self) -> GlobalSpendSnapshot:
        async with self._factory() as session:
            await self._load_config(session)
            state = await self._load_global_state(session)
            await session.commit()
        return GlobalSpendSnapshot(
            period_start=state.period_start,
            openai_spend_micros=state.openai_spend_micros,
            perplexity_spend_micros=state.perplexity_spend_micros,
            web_search_spend_micros=state.web_search_spend_micros,
            total_spend_micros=(
                state.openai_spend_micros
                + state.perplexity_spend_micros
                + state.web_search_spend_micros
            ),
            perplexity_degraded=state.perplexity_degraded,
            hard_stopped=state.hard_stopped,
            perplexity_degrade_reason=state.perplexity_degrade_reason,
            perplexity_degraded_at=state.perplexity_degraded_at,
            hard_stop_reason=state.hard_stop_reason,
            hard_stopped_at=state.hard_stopped_at,
        )

    async def override_flags(
        self,
        *,
        perplexity_degraded: bool | None = None,
        hard_stopped: bool | None = None,
        perplexity_degrade_reason: str | None = None,
        hard_stop_reason: str | None = None,
    ) -> GlobalSpendSnapshot:
        """Flip / clear the kill-switch flags with an optional reason string.

        Flipping ON stamps the supplied reason + timestamp. Flipping OFF clears
        both. Callers include the admin route (reason left as None for manual
        actions) and the agent layer (reason set to an insufficient-funds
        signal from the provider). Idempotent — no-ops if already in the
        requested state.
        """
        async with self._factory() as session:
            state = await self._load_global_state(session)
            now = _now()
            if perplexity_degraded is not None:
                if perplexity_degraded and not state.perplexity_degraded:
                    state.perplexity_degraded = True
                    state.perplexity_degrade_reason = perplexity_degrade_reason
                    state.perplexity_degraded_at = now
                elif not perplexity_degraded and state.perplexity_degraded:
                    state.perplexity_degraded = False
                    state.perplexity_degrade_reason = None
                    state.perplexity_degraded_at = None
            if hard_stopped is not None:
                if hard_stopped and not state.hard_stopped:
                    state.hard_stopped = True
                    state.hard_stop_reason = hard_stop_reason
                    state.hard_stopped_at = now
                elif not hard_stopped and state.hard_stopped:
                    state.hard_stopped = False
                    state.hard_stop_reason = None
                    state.hard_stopped_at = None
            state.updated_at = now
            session.add(state)
            await session.commit()
        return await self.get_global_snapshot()

    async def record_provider_out_of_funds(
        self, provider: str, *, reason: str
    ) -> GlobalSpendSnapshot:
        """Called from the agent layer when a provider returns an
        insufficient-funds error. OpenAI kills chat entirely; Perplexity just
        disables the Sonar tool. Safe to call repeatedly — `override_flags`
        is idempotent and won't overwrite a reason set by an earlier call.
        """
        if provider == "openai":
            logger.warning("provider out of funds: openai — hard-stopping chat")
            return await self.override_flags(
                hard_stopped=True, hard_stop_reason=reason
            )
        if provider == "perplexity":
            logger.warning("provider out of funds: perplexity — degrading Sonar")
            return await self.override_flags(
                perplexity_degraded=True,
                perplexity_degrade_reason=reason,
            )
        raise ValueError(f"unknown provider: {provider!r}")

    # ---- Per-user quota -------------------------------------------------

    async def _load_quota(
        self,
        session: AsyncSession,
        user_id: UUID,
        cfg: BudgetConfig,
    ) -> UserQuota:
        row = (
            await session.execute(
                select(UserQuota).where(UserQuota.user_id == user_id)
            )
        ).scalar_one_or_none()
        now = _now()
        period = _period_start(now)

        if row is None:
            starting = cfg.default_monthly_credits
            row = UserQuota(
                user_id=user_id,
                credits_remaining=starting,
                credits_used_period=0,
                credits_granted_period=starting,
                period_start=period,
                updated_at=now,
            )
            session.add(row)
            await session.flush()
            return row

        if row.period_start < period:
            # Monthly reset — honour per-user override if set.
            monthly = row.override_monthly_credits or cfg.default_monthly_credits
            row.credits_remaining = monthly
            row.credits_used_period = 0
            row.credits_granted_period = monthly
            row.period_start = period
            row.updated_at = now
            session.add(row)
            await session.flush()
        return row

    async def get_user_snapshot(self, user: User) -> QuotaSnapshot:
        uid = _as_uuid(user.id)
        async with self._factory() as session:
            cfg = await self._load_config(session)
            state = await self._load_global_state(session)
            quota = await self._load_quota(session, uid, cfg)
            await session.commit()
        resets_at = _next_period_start(quota.period_start)
        return QuotaSnapshot(
            credits_remaining=quota.credits_remaining,
            credits_used=quota.credits_used_period,
            credits_total=quota.credits_granted_period,
            resets_at=resets_at,
            perplexity_degraded=state.perplexity_degraded,
            is_admin=(user.role == "admin"),
            hard_stopped=state.hard_stopped,
        )

    # ---- Pre-run gate ---------------------------------------------------

    async def check_can_chat(self, user: User) -> QuotaSnapshot:
        """Raise if the turn cannot run. Returns the snapshot on success so the
        caller can decide whether to strip the Perplexity tool this turn."""
        snap = await self.get_user_snapshot(user)
        if snap.is_admin:
            return snap
        if snap.hard_stopped:
            raise GlobalBudgetExhaustedError(resets_at=snap.resets_at)
        if snap.credits_remaining <= 0:
            raise QuotaExhaustedError(
                credits_remaining=snap.credits_remaining,
                resets_at=snap.resets_at,
            )
        return snap

    # ---- Post-run debit -------------------------------------------------

    async def record_turn(
        self,
        *,
        user: User,
        thread_id: str | None,
        message_id: str | None,
        usage: UsageSummary,
    ) -> int:
        """Write usage rows + debit credits + update global spend. Returns
        credits charged (0 for admins / zero-cost turns).
        """
        uid = _as_uuid(user.id)
        tid = _as_uuid(thread_id) if thread_id else None
        mid = _as_uuid(message_id) if message_id else None
        async with self._factory() as session:
            cfg = await self._load_config(session)
            state = await self._load_global_state(session)
            breakdown = compute_cost(usage, cfg)
            now = _now()

            rows: list[MessageUsage] = []
            if (
                usage.openai_input_tokens > 0
                or usage.openai_output_tokens > 0
                or breakdown.openai_micros > 0
            ):
                rows.append(
                    MessageUsage(
                        user_id=uid,
                        message_id=mid,
                        thread_id=tid,
                        model="openai",
                        input_tokens=usage.openai_input_tokens,
                        output_tokens=usage.openai_output_tokens,
                        request_count=1,
                        cost_usd_micros=breakdown.openai_micros,
                        credits_charged=0,
                        created_at=now,
                    )
                )
            if usage.perplexity_calls:
                total_in = sum(c.input_tokens for c in usage.perplexity_calls)
                total_out = sum(c.output_tokens for c in usage.perplexity_calls)
                rows.append(
                    MessageUsage(
                        user_id=uid,
                        message_id=mid,
                        thread_id=tid,
                        model="perplexity",
                        input_tokens=total_in,
                        output_tokens=total_out,
                        request_count=len(usage.perplexity_calls),
                        cost_usd_micros=breakdown.perplexity_micros,
                        credits_charged=0,
                        created_at=now,
                    )
                )
            if usage.web_search_calls > 0:
                rows.append(
                    MessageUsage(
                        user_id=uid,
                        message_id=mid,
                        thread_id=tid,
                        model="web_search",
                        input_tokens=0,
                        output_tokens=0,
                        request_count=usage.web_search_calls,
                        cost_usd_micros=breakdown.web_search_micros,
                        credits_charged=0,
                        created_at=now,
                    )
                )

            credits_charged = 0
            if user.role != "admin":
                credits_charged = micros_to_credits(
                    breakdown.total_micros, cfg.credit_usd_value_micros
                )
                if credits_charged > 0:
                    quota = await self._load_quota(session, uid, cfg)
                    quota.credits_remaining = max(
                        0, quota.credits_remaining - credits_charged
                    )
                    quota.credits_used_period += credits_charged
                    quota.updated_at = now
                    session.add(quota)

            # Attach the per-turn credit charge to the first row so the
            # history view can show an integer cost per interaction.
            if rows and credits_charged > 0:
                rows[0].credits_charged = credits_charged
            for r in rows:
                session.add(r)

            state.openai_spend_micros += breakdown.openai_micros
            state.perplexity_spend_micros += breakdown.perplexity_micros
            state.web_search_spend_micros += breakdown.web_search_micros
            state.updated_at = now
            session.add(state)

            await session.commit()
            return credits_charged

    # ---- Admin mutations ------------------------------------------------

    async def grant_credits(
        self, user_id: str | UUID, amount: int, *, reason: str = ""
    ) -> UserQuota:
        if amount <= 0:
            raise ValueError("amount must be positive")
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            cfg = await self._load_config(session)
            quota = await self._load_quota(session, uid, cfg)
            quota.credits_remaining += amount
            quota.credits_granted_period += amount
            quota.updated_at = _now()
            session.add(quota)
            await session.commit()
            await session.refresh(quota)
        logger.warning(
            "budget grant: target=%s amount=%d reason=%r", uid, amount, reason
        )
        return quota

    async def revoke_credits(
        self, user_id: str | UUID, amount: int, *, reason: str = ""
    ) -> UserQuota:
        if amount <= 0:
            raise ValueError("amount must be positive")
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            cfg = await self._load_config(session)
            quota = await self._load_quota(session, uid, cfg)
            # Clamp to zero — revoking more than they have is still a valid
            # admin action, it just doesn't go negative.
            actual = min(amount, quota.credits_remaining)
            quota.credits_remaining -= actual
            quota.updated_at = _now()
            session.add(quota)
            await session.commit()
            await session.refresh(quota)
        logger.warning(
            "budget revoke: target=%s amount=%d actual=%d reason=%r",
            uid,
            amount,
            actual,
            reason,
        )
        return quota

    async def transfer_credits(
        self,
        *,
        from_user_id: str | UUID,
        to_user_id: str | UUID,
        amount: int,
        reason: str = "",
    ) -> tuple[UserQuota, UserQuota]:
        if amount <= 0:
            raise ValueError("amount must be positive")
        src_uid = _as_uuid(from_user_id)
        dst_uid = _as_uuid(to_user_id)
        if src_uid == dst_uid:
            raise ValueError("from and to must differ")
        async with self._factory() as session:
            cfg = await self._load_config(session)
            src = await self._load_quota(session, src_uid, cfg)
            dst = await self._load_quota(session, dst_uid, cfg)
            if src.credits_remaining < amount:
                raise ValueError(
                    "source user does not have enough credits to transfer"
                )
            src.credits_remaining -= amount
            dst.credits_remaining += amount
            dst.credits_granted_period += amount
            now = _now()
            src.updated_at = now
            dst.updated_at = now
            session.add(src)
            session.add(dst)
            await session.commit()
            await session.refresh(src)
            await session.refresh(dst)
        logger.warning(
            "budget transfer: from=%s to=%s amount=%d reason=%r",
            src_uid,
            dst_uid,
            amount,
            reason,
        )
        return src, dst

    async def reset_quota(self, user_id: str | UUID) -> UserQuota:
        """Reset the user's quota to the default for the current month."""
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            cfg = await self._load_config(session)
            quota = await self._load_quota(session, uid, cfg)
            monthly = quota.override_monthly_credits or cfg.default_monthly_credits
            quota.credits_remaining = monthly
            quota.credits_used_period = 0
            quota.credits_granted_period = monthly
            quota.period_start = _period_start()
            quota.updated_at = _now()
            session.add(quota)
            await session.commit()
            await session.refresh(quota)
        logger.warning("budget reset: target=%s monthly=%d", uid, monthly)
        return quota

    async def set_override_monthly_credits(
        self, user_id: str | UUID, amount: int | None
    ) -> UserQuota:
        """Set (or clear with None) a per-user monthly ceiling that overrides
        the global default on every reset."""
        if amount is not None and amount < 0:
            raise ValueError("amount must be >= 0 or None")
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            cfg = await self._load_config(session)
            quota = await self._load_quota(session, uid, cfg)
            quota.override_monthly_credits = amount
            quota.updated_at = _now()
            session.add(quota)
            await session.commit()
            await session.refresh(quota)
        logger.warning(
            "budget override: target=%s monthly=%s", uid, amount
        )
        return quota

    # ---- Reads for admin UI --------------------------------------------

    async def list_user_quotas(
        self, user_ids: list[UUID]
    ) -> dict[UUID, UserQuota]:
        if not user_ids:
            return {}
        async with self._factory() as session:
            rows = (
                await session.execute(
                    select(UserQuota).where(UserQuota.user_id.in_(user_ids))
                )
            ).scalars().all()
            return {r.user_id: r for r in rows}

    async def recent_usage_for_user(
        self, user_id: str | UUID, *, limit: int = 50
    ) -> list[MessageUsage]:
        uid = _as_uuid(user_id)
        async with self._factory() as session:
            rows = (
                await session.execute(
                    select(MessageUsage)
                    .where(MessageUsage.user_id == uid)
                    .order_by(desc(MessageUsage.created_at))
                    .limit(limit)
                )
            ).scalars().all()
            return list(rows)

    async def user_period_cost_micros(self, user_id: str | UUID) -> int:
        uid = _as_uuid(user_id)
        period = _period_start()
        async with self._factory() as session:
            result = (
                await session.execute(
                    select(func.coalesce(func.sum(MessageUsage.cost_usd_micros), 0))
                    .where(MessageUsage.user_id == uid)
                    .where(MessageUsage.created_at >= period)
                )
            ).scalar_one()
            return int(result or 0)
