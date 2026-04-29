"""Helpers for attaching consistent identity/context to Logfire spans.

`user_attrs(user)` is the canonical way to enrich a span with who is acting.
Every span across the app should use this so the attribute names line up in
Logfire's query UI (`attributes.user_id = "..."`, `attributes.user_role = "..."`).

Both `user_email` (human-readable, great for triage) and `user_email_hash`
(stable short SHA-256 prefix, safe to share in screenshots/exports without
revealing addresses) are emitted. `user_email_hash` lets you "group by user"
without leaking the address; the plain email lets support staff jump straight
to a user's traces by typing their address into the filter bar.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.domain.models import User


def email_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()[:16]


def user_attrs(user: User | None) -> dict[str, Any]:
    if user is None:
        return {}
    return {
        "user_id": user.id,
        "user_role": user.role,
        "user_email": user.email,
        "user_email_hash": email_hash(user.email),
    }
