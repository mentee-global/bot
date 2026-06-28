"""Profile endpoints — what the bot knows about a mentee beyond their
Mentee-platform profile.

`GET /api/profile` returns the active CV (filename + faithful Markdown
transcription) and the free-text "about me", so the /profile page can render
them. The CV is uploaded via `POST /api/documents` (purpose=profile_cv); OCR
runs async and the page polls `GET /api/documents/{id}` for status, then reads
the transcription here. `PUT /api/profile/about` saves the prose. Both the CV
Markdown and the about-me are injected into every chat (see DocumentService).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, get_document_service, require_session
from app.documents.service import DocumentService
from app.domain.models import User

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    has_cv: bool
    cv_document_id: str | None
    cv_filename: str | None
    cv_markdown: str | None
    about_me: str | None
    updated_at: datetime | None


class AboutUpdate(BaseModel):
    # Generous cap; injected into every chat, so bound it. Empty/blank clears it.
    about_me: str | None = Field(default=None, max_length=8_000)


async def _profile_response(
    service: DocumentService, user_id: str
) -> ProfileResponse:
    profile = await service.get_cv_profile(user_id=user_id)
    cv_filename, cv_markdown = await service.get_cv_markdown(user_id=user_id)
    return ProfileResponse(
        has_cv=bool(profile and profile.cv_document_id and cv_markdown),
        cv_document_id=profile.cv_document_id if profile else None,
        cv_filename=cv_filename,
        cv_markdown=cv_markdown,
        about_me=profile.about_me if profile else None,
        updated_at=profile.updated_at if profile else None,
    )


@router.get("", response_model=ProfileResponse)
async def get_profile(
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[DocumentService, Depends(get_document_service)],
) -> ProfileResponse:
    return await _profile_response(service, user.id)


@router.put("/about", response_model=ProfileResponse)
async def save_about(
    body: AboutUpdate,
    _session_id: Annotated[str, Depends(require_session)],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[DocumentService, Depends(get_document_service)],
) -> ProfileResponse:
    await service.set_about_me(user_id=user.id, about_me=body.about_me)
    return await _profile_response(service, user.id)
