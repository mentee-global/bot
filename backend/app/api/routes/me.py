"""Lightweight self-introspection endpoint the frontend polls to show the
credits pill and render degraded / paused banners. Served under /api/me.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_budget_service, get_current_user, require_session
from app.budget.service import BudgetService
from app.domain.models import User

router = APIRouter(prefix="/api/me", tags=["me"])


class CreditsInfo(BaseModel):
    remaining: int
    used: int
    total: int
    resets_at: datetime
    # Admins don't consume credits — the UI can hide the pill for them.
    unlimited: bool


class AgentStateInfo(BaseModel):
    perplexity_degraded: bool
    hard_stopped: bool


class MeResponse(BaseModel):
    user: User
    credits: CreditsInfo
    agent_state: AgentStateInfo


@router.get("", response_model=MeResponse)
async def get_me(
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    budget: Annotated[BudgetService, Depends(get_budget_service)],
) -> MeResponse:
    snap = await budget.get_user_snapshot(user)
    return MeResponse(
        user=user,
        credits=CreditsInfo(
            remaining=snap.credits_remaining,
            used=snap.credits_used,
            total=snap.credits_total,
            resets_at=snap.resets_at,
            unlimited=snap.is_admin,
        ),
        agent_state=AgentStateInfo(
            perplexity_degraded=snap.perplexity_degraded,
            hard_stopped=snap.hard_stopped,
        ),
    )
