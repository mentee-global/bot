"""Admin control surface for the budget + quota system.

- Read config, global spend, per-user quotas, per-user usage history
- Edit config (pricing, caps, thresholds, default credits/user/month)
- Grant / revoke / transfer / reset / cap individual user credits
- Force degrade / hard-stop flags

All mutations are logged at WARNING with the acting admin + target so the
audit trail is `grep`-able, matching the existing admin.py pattern.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_budget_service, get_session_store, require_admin
from app.auth.service import _user_from_row
from app.auth.session_store import SessionStore
from app.budget.providers import (
    ProviderSpend,
    get_openai_spend,
    get_perplexity_spend,
)
from app.budget.service import BudgetService
from app.core.config import settings
from app.domain.models import User

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/budget",
    tags=["admin-budget"],
    dependencies=[Depends(require_admin)],
)


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------


class BudgetConfigResponse(BaseModel):
    default_monthly_credits: int
    credit_usd_value_micros: int
    pricing_openai_input_per_mtok_micros: int
    pricing_openai_output_per_mtok_micros: int
    pricing_perplexity_input_per_mtok_micros: int
    pricing_perplexity_output_per_mtok_micros: int
    pricing_perplexity_request_fee_micros: int
    pricing_web_search_per_call_micros: int
    updated_at: datetime


class BudgetConfigUpdate(BaseModel):
    default_monthly_credits: int | None = Field(default=None, ge=0)
    credit_usd_value_micros: int | None = Field(default=None, ge=1)
    pricing_openai_input_per_mtok_micros: int | None = Field(default=None, ge=0)
    pricing_openai_output_per_mtok_micros: int | None = Field(default=None, ge=0)
    pricing_perplexity_input_per_mtok_micros: int | None = Field(default=None, ge=0)
    pricing_perplexity_output_per_mtok_micros: int | None = Field(default=None, ge=0)
    pricing_perplexity_request_fee_micros: int | None = Field(default=None, ge=0)
    pricing_web_search_per_call_micros: int | None = Field(default=None, ge=0)


class GlobalSpendResponse(BaseModel):
    period_start: datetime
    openai_spend_micros: int
    perplexity_spend_micros: int
    web_search_spend_micros: int
    total_spend_micros: int
    perplexity_degraded: bool
    hard_stopped: bool
    perplexity_degrade_reason: str | None = None
    perplexity_degraded_at: datetime | None = None
    hard_stop_reason: str | None = None
    hard_stopped_at: datetime | None = None


class FlagsUpdate(BaseModel):
    perplexity_degraded: bool | None = None
    hard_stopped: bool | None = None


class UserQuotaResponse(BaseModel):
    user_id: str
    credits_remaining: int
    credits_used_period: int
    credits_granted_period: int
    override_monthly_credits: int | None
    period_start: datetime
    updated_at: datetime
    cost_period_micros: int


class UserQuotaListResponse(BaseModel):
    quotas: list[UserQuotaResponse]


class CreditsMutation(BaseModel):
    amount: int = Field(ge=1)
    reason: str = Field(default="", max_length=200)


class TransferRequest(BaseModel):
    to_user_id: str = Field(min_length=1, max_length=64)
    amount: int = Field(ge=1)
    reason: str = Field(default="", max_length=200)


class OverrideRequest(BaseModel):
    # Null clears the override.
    amount: int | None = Field(default=None, ge=0)


class ProviderSpendResponse(BaseModel):
    provider: str
    available: bool
    period_start: datetime | None = None
    spend_micros: int = 0
    currency: str = "usd"
    reason: str | None = None
    dashboard_url: str | None = None
    fetched_at: datetime | None = None
    ledger_spend_micros: int | None = None


class ProvidersResponse(BaseModel):
    openai: ProviderSpendResponse
    perplexity: ProviderSpendResponse


class MessageUsageResponse(BaseModel):
    id: str
    user_id: str
    message_id: str | None
    thread_id: str | None
    model: str
    input_tokens: int
    output_tokens: int
    request_count: int
    cost_usd_micros: int
    credits_charged: int
    created_at: datetime


class UserUsageResponse(BaseModel):
    user_id: str
    quota: UserQuotaResponse
    recent_usage: list[MessageUsageResponse]


# ---------------------------------------------------------------------------
# Config + global state
# ---------------------------------------------------------------------------


@router.get("/config", response_model=BudgetConfigResponse)
async def get_config(
    budget: Annotated[BudgetService, Depends(get_budget_service)],
) -> BudgetConfigResponse:
    cfg = await budget.get_config()
    return BudgetConfigResponse.model_validate(cfg, from_attributes=True)


@router.patch("/config", response_model=BudgetConfigResponse)
async def update_config(
    payload: BudgetConfigUpdate,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> BudgetConfigResponse:
    changes = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not changes:
        cfg = await budget.get_config()
    else:
        cfg = await budget.update_config(**changes)
        logger.warning(
            "admin budget_config: actor=%s changes=%s", actor.email, changes
        )
    return BudgetConfigResponse.model_validate(cfg, from_attributes=True)


def _snap_to_response(snap) -> GlobalSpendResponse:  # type: ignore[no-untyped-def]
    return GlobalSpendResponse(
        period_start=snap.period_start,
        openai_spend_micros=snap.openai_spend_micros,
        perplexity_spend_micros=snap.perplexity_spend_micros,
        web_search_spend_micros=snap.web_search_spend_micros,
        total_spend_micros=snap.total_spend_micros,
        perplexity_degraded=snap.perplexity_degraded,
        hard_stopped=snap.hard_stopped,
        perplexity_degrade_reason=snap.perplexity_degrade_reason,
        perplexity_degraded_at=snap.perplexity_degraded_at,
        hard_stop_reason=snap.hard_stop_reason,
        hard_stopped_at=snap.hard_stopped_at,
    )


@router.get("/state", response_model=GlobalSpendResponse)
async def get_global_state(
    budget: Annotated[BudgetService, Depends(get_budget_service)],
) -> GlobalSpendResponse:
    snap = await budget.get_global_snapshot()
    return _snap_to_response(snap)


@router.patch("/flags", response_model=GlobalSpendResponse)
async def update_flags(
    payload: FlagsUpdate,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> GlobalSpendResponse:
    # Manual admin toggle — stamp a reason so the audit trail shows *who*
    # tripped the kill-switch vs. an automatic provider-error flip.
    reason = f"manual (admin {actor.email})"
    snap = await budget.override_flags(
        perplexity_degraded=payload.perplexity_degraded,
        hard_stopped=payload.hard_stopped,
        perplexity_degrade_reason=reason if payload.perplexity_degraded else None,
        hard_stop_reason=reason if payload.hard_stopped else None,
    )
    logger.warning(
        "admin budget_flags: actor=%s degraded=%s hard_stopped=%s",
        actor.email,
        payload.perplexity_degraded,
        payload.hard_stopped,
    )
    return _snap_to_response(snap)


# ---------------------------------------------------------------------------
# Providers (real billing data from OpenAI / Perplexity)
# ---------------------------------------------------------------------------


@router.get("/providers", response_model=ProvidersResponse)
async def get_providers(
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    refresh: bool = False,
) -> ProvidersResponse:
    """Best-effort read of real provider-side spend for the current month.

    OpenAI is pulled via `/v1/organization/costs` when an admin key is
    configured. Perplexity has no public usage API — it always reports
    `available=False` with a pointer to the web dashboard.

    `refresh=true` busts the 5-minute response cache.
    """
    openai_raw, perplexity_raw, snap = await _gather_providers(budget, refresh)
    # Attach our ledger's view so the UI can show the delta side-by-side.
    openai_raw.ledger_spend_micros = snap.openai_spend_micros
    perplexity_raw.ledger_spend_micros = snap.perplexity_spend_micros
    return ProvidersResponse(
        openai=_to_response(openai_raw),
        perplexity=_to_response(perplexity_raw),
    )


async def _gather_providers(
    budget: BudgetService, refresh: bool
) -> tuple[ProviderSpend, ProviderSpend, object]:
    snap = await budget.get_global_snapshot()
    openai = await get_openai_spend(settings, refresh=refresh)
    perplexity = await get_perplexity_spend(settings)
    return openai, perplexity, snap


def _to_response(p: ProviderSpend) -> ProviderSpendResponse:
    return ProviderSpendResponse(
        provider=p.provider,
        available=p.available,
        period_start=p.period_start,
        spend_micros=p.spend_micros,
        currency=p.currency,
        reason=p.reason,
        dashboard_url=p.dashboard_url,
        fetched_at=p.fetched_at,
        ledger_spend_micros=p.ledger_spend_micros,
    )


# ---------------------------------------------------------------------------
# Per-user reads + mutations
# ---------------------------------------------------------------------------


@router.get("/users/{user_id}", response_model=UserUsageResponse)
async def get_user_usage(
    user_id: UUID,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> UserUsageResponse:
    user_row = await sessions.get_user_by_id(user_id)
    if user_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user = _user_from_row(user_row)
    # Materialize the quota row (also handles first-time creation + monthly reset).
    await budget.get_user_snapshot(user)
    quota_resp = await _quota_after(budget, user_id)
    recent = await budget.recent_usage_for_user(user_id, limit=50)
    return UserUsageResponse(
        user_id=str(user_id),
        quota=quota_resp,
        recent_usage=[_usage_to_response(r) for r in recent],
    )


@router.post("/users/{user_id}/grant", response_model=UserQuotaResponse)
async def grant(
    user_id: UUID,
    payload: CreditsMutation,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserQuotaResponse:
    await budget.grant_credits(user_id, payload.amount, reason=payload.reason)
    logger.warning(
        "admin grant: actor=%s target=%s amount=%d",
        actor.email, user_id, payload.amount,
    )
    return await _quota_after(budget, user_id)


@router.post("/users/{user_id}/revoke", response_model=UserQuotaResponse)
async def revoke(
    user_id: UUID,
    payload: CreditsMutation,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserQuotaResponse:
    await budget.revoke_credits(user_id, payload.amount, reason=payload.reason)
    logger.warning(
        "admin revoke: actor=%s target=%s amount=%d",
        actor.email, user_id, payload.amount,
    )
    return await _quota_after(budget, user_id)


@router.post("/users/{user_id}/transfer", response_model=UserQuotaResponse)
async def transfer(
    user_id: UUID,
    payload: TransferRequest,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserQuotaResponse:
    try:
        to_uuid = UUID(payload.to_user_id)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="to_user_id must be a valid UUID",
        ) from err
    try:
        await budget.transfer_credits(
            from_user_id=user_id,
            to_user_id=to_uuid,
            amount=payload.amount,
            reason=payload.reason,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)
        ) from err
    logger.warning(
        "admin transfer: actor=%s from=%s to=%s amount=%d",
        actor.email, user_id, to_uuid, payload.amount,
    )
    return await _quota_after(budget, user_id)


@router.post("/users/{user_id}/reset", response_model=UserQuotaResponse)
async def reset(
    user_id: UUID,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserQuotaResponse:
    await budget.reset_quota(user_id)
    logger.warning("admin reset: actor=%s target=%s", actor.email, user_id)
    return await _quota_after(budget, user_id)


@router.patch(
    "/users/{user_id}/override", response_model=UserQuotaResponse
)
async def set_override(
    user_id: UUID,
    payload: OverrideRequest,
    budget: Annotated[BudgetService, Depends(get_budget_service)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserQuotaResponse:
    await budget.set_override_monthly_credits(user_id, payload.amount)
    logger.warning(
        "admin override: actor=%s target=%s amount=%s",
        actor.email, user_id, payload.amount,
    )
    return await _quota_after(budget, user_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _quota_after(
    budget: BudgetService, user_id: UUID
) -> UserQuotaResponse:
    rows = await budget.list_user_quotas([user_id])
    row = rows.get(user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Quota not found"
        )
    period_cost = await budget.user_period_cost_micros(user_id)
    return UserQuotaResponse(
        user_id=str(row.user_id),
        credits_remaining=row.credits_remaining,
        credits_used_period=row.credits_used_period,
        credits_granted_period=row.credits_granted_period,
        override_monthly_credits=row.override_monthly_credits,
        period_start=row.period_start,
        updated_at=row.updated_at,
        cost_period_micros=period_cost,
    )


def _usage_to_response(row) -> MessageUsageResponse:  # type: ignore[no-untyped-def]
    return MessageUsageResponse(
        id=str(row.id),
        user_id=str(row.user_id),
        message_id=str(row.message_id) if row.message_id else None,
        thread_id=str(row.thread_id) if row.thread_id else None,
        model=row.model,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        request_count=row.request_count,
        cost_usd_micros=row.cost_usd_micros,
        credits_charged=row.credits_charged,
        created_at=row.created_at,
    )
