"""Process-wide rate limiter.

Built on `slowapi`. The limiter is created here so routes can `from
app.core.rate_limit import limiter` without importing `app.main` (which
would create an import cycle through `init_auth`).

We key by session-cookie when present, falling back to remote IP. That
way an authenticated user can't shed limits by rotating IPs, and a single
NAT can't exhaust a per-user budget for everyone behind it.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings


def _key_func(request: Request) -> str:
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie:
        # Truncate so the key doesn't pin a full 32-char URL-safe token in
        # memory across the in-process limiter store. First 16 chars give
        # ~96 bits of entropy — more than enough for keying.
        return f"sess:{cookie[:16]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=_key_func)
