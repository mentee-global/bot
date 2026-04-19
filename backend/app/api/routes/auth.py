import logging
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import SESSION_COOKIE, get_auth_service
from app.auth.errors import (
    AuthError,
    CodeExchangeError,
    InvalidIdTokenError,
    StateMismatchError,
    UserinfoFetchError,
)
from app.auth.service import AuthService
from app.core.config import settings
from app.domain.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# OAuth 2.0 standard error codes Mentee passes through on the callback.
# Anything else collapses to "oauth" so /auth/error never leaks provider
# internals (backend plan §16).
_PASSTHROUGH_ERRORS = {"access_denied", "login_required", "invalid_scope"}


class MeResponse(BaseModel):
    user: User


@router.get("/login")
async def login(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    redirect_to: str | None = None,
) -> RedirectResponse:
    authorize_url = await auth.start_login(redirect_to=redirect_to)
    return RedirectResponse(authorize_url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
async def callback(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    frontend = str(settings.frontend_url).rstrip("/")

    if error:
        reason = error if error in _PASSTHROUGH_ERRORS else "oauth"
        return RedirectResponse(
            f"{frontend}/auth/error?reason={reason}",
            status_code=status.HTTP_302_FOUND,
        )
    if not code or not state:
        return RedirectResponse(
            f"{frontend}/auth/error?reason=missing_params",
            status_code=status.HTTP_302_FOUND,
        )

    try:
        _, session_id = await auth.complete_login(code=code, state=state)
    except StateMismatchError:
        return RedirectResponse(
            f"{frontend}/auth/error?reason=oauth",
            status_code=status.HTTP_302_FOUND,
        )
    except (CodeExchangeError, InvalidIdTokenError, UserinfoFetchError) as exc:
        logger.warning("OAuth callback failed: %s", exc)
        return RedirectResponse(
            f"{frontend}/auth/error?reason=oauth",
            status_code=status.HTTP_302_FOUND,
        )

    response = RedirectResponse(
        f"{frontend}/chat", status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        max_age=settings.session_max_age_seconds,
        path="/",
    )
    return response


@router.get("/me", response_model=MeResponse)
async def me(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> MeResponse:
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        user = await auth.current_user(session_id)
    except AuthError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        ) from err
    return MeResponse(user=user)


@router.post("/logout")
async def logout(
    response: Response,
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict[str, bool]:
    if session_id:
        await auth.logout(session_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
