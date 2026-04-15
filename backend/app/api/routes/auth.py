from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import SESSION_COOKIE, get_sessions, optional_session
from app.core.config import settings
from app.domain.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Mock user returned by the stub login flow. Real OAuth against MenteeGlobal
# will replace this — the frontend contract stays the same.
_MOCK_USER = {
    "id": "mock-user-1",
    "email": "mentee@menteeglobal.org",
    "name": "Demo Mentee",
}


class MeResponse(BaseModel):
    user: User


class LoginCallbackResponse(BaseModel):
    user: User


@router.get("/login")
async def login() -> RedirectResponse:
    # Stub: redirects straight to the frontend callback with a mock code.
    # Real OAuth will redirect the browser to app.menteeglobal.org with a PKCE challenge;
    # MenteeGlobal then redirects back to {frontend_url}/auth/callback?code=<real-code>.
    return RedirectResponse(
        url=f"{settings.frontend_url}/auth/callback?code=mock",
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/callback", response_model=LoginCallbackResponse)
async def login_callback(
    response: Response,
    sessions: Annotated[dict[str, dict[str, str]], Depends(get_sessions)],
    code: str | None = None,
) -> LoginCallbackResponse:
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code")

    session_id = str(uuid4())
    sessions[session_id] = _MOCK_USER

    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=True,
        samesite="lax",
        secure=False,  # local dev over http
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return LoginCallbackResponse(user=User(**_MOCK_USER))


@router.get("/me", response_model=MeResponse)
async def me(
    sessions: Annotated[dict[str, dict[str, str]], Depends(get_sessions)],
    session_id: Annotated[str | None, Depends(optional_session)],
) -> MeResponse:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return MeResponse(user=User(**sessions[session_id]))


@router.post("/logout")
async def logout(
    response: Response,
    sessions: Annotated[dict[str, dict[str, str]], Depends(get_sessions)],
    session_id: Annotated[str | None, Depends(optional_session)],
) -> dict[str, bool]:
    if session_id:
        sessions.pop(session_id, None)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
