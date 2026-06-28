"""CV profile endpoints (plan Phase 2).

`GET /api/profile` returns the user's current CV (draft or confirmed) so the
/profile page can prefill its form. `PUT /api/profile/cv` persists the
(possibly edited) fields and **confirms** them (plan decision #10) — only then
does `DocumentService.build_profile_context` inject the CV into chats.

The CV is uploaded through `POST /api/documents` with `purpose=profile_cv`;
extraction runs async, so the page polls `GET /api/documents/{id}` for status
and reads the extracted draft from here once it's ready.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_current_user, get_document_service, require_session
from app.documents.schemas import ResumeSchema
from app.documents.service import DocumentService
from app.domain.models import CvProfile, User

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    has_cv: bool
    confirmed: bool
    cv_structured: dict | None
    cv_summary: str | None
    cv_document_id: str | None
    updated_at: datetime | None

    @classmethod
    def from_profile(cls, p: CvProfile | None) -> ProfileResponse:
        if p is None:
            return cls(
                has_cv=False,
                confirmed=False,
                cv_structured=None,
                cv_summary=None,
                cv_document_id=None,
                updated_at=None,
            )
        return cls(
            has_cv=p.cv_structured is not None,
            confirmed=p.is_confirmed,
            cv_structured=p.cv_structured,
            cv_summary=p.cv_summary,
            cv_document_id=p.cv_document_id,
            updated_at=p.updated_at,
        )


@router.get("", response_model=ProfileResponse)
async def get_profile(
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[DocumentService, Depends(get_document_service)],
) -> ProfileResponse:
    profile = await service.get_cv_profile(user_id=user.id)
    return ProfileResponse.from_profile(profile)


@router.put("/cv", response_model=ProfileResponse)
async def save_cv(
    body: ResumeSchema,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[DocumentService, Depends(get_document_service)],
) -> ProfileResponse:
    # Confirms the (edited) CV — sets cv_confirmed_at, so it now flows into
    # every chat via build_profile_context (plan decision #10).
    profile = await service.confirm_cv_profile(user_id=user.id, resume=body)
    return ProfileResponse.from_profile(profile)
