import logging
import re
from typing import Annotated
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
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
from app.core.rate_limit import limiter
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
@limiter.limit("10/minute")
async def login(
    request: Request,  # required for slowapi key_func
    auth: Annotated[AuthService, Depends(get_auth_service)],
    redirect_to: str | None = None,
    role_hint: str | None = None,
) -> RedirectResponse:
    authorize_url = await auth.start_login(
        redirect_to=redirect_to, login_role_hint=role_hint
    )
    return RedirectResponse(authorize_url, status_code=status.HTTP_302_FOUND)


# Same-origin relative paths only. Reject anything with a scheme, netloc,
# backslash (Chrome/Safari normalise `\` → `/`), control char (raw or
# percent-encoded — `/%09//evil.com` becomes `/\t//evil.com` after browser
# decode → protocol-relative), or a leading `//`.
_SAFE_PATH_RE = re.compile(r"^/[A-Za-z0-9_\-./?&=%~:@!$',;+*]*$")
_CONTROL_OR_BACKSLASH_RE = re.compile(r"[\x00-\x1f\x7f\\]")


def _safe_post_login_path(redirect_to: str | None) -> str:
    if not redirect_to:
        return "/chat"
    candidate = redirect_to.strip()
    if not candidate or not candidate.startswith("/"):
        return "/chat"
    # Reject obvious protocol-relative + raw control chars / backslash.
    if candidate.startswith("//") or _CONTROL_OR_BACKSLASH_RE.search(candidate):
        return "/chat"
    # Re-check the percent-decoded form: browsers will decode before redirecting.
    decoded = unquote(candidate)
    if (
        decoded.startswith("//")
        or _CONTROL_OR_BACKSLASH_RE.search(decoded)
        or not decoded.startswith("/")
    ):
        return "/chat"
    parts = urlsplit(candidate)
    if parts.scheme or parts.netloc:
        return "/chat"
    if not _SAFE_PATH_RE.match(candidate):
        return "/chat"
    return candidate


@router.get("/callback")
@limiter.limit("30/minute")
async def callback(
    request: Request,
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
        _, session_id, redirect_to = await auth.complete_login(
            code=code, state=state
        )
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
        f"{frontend}{_safe_post_login_path(redirect_to)}",
        status_code=status.HTTP_302_FOUND,
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
