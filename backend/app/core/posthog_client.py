"""Thin wrapper around the posthog Python SDK.

PostHog ships product-analytics events to the same project the frontend uses,
joined on `distinct_id == user.id`. The frontend identifies on login (see
`frontend/src/integrations/posthog/useIdentifySession.ts`); the backend mirrors
the identify on every server-side capture so person rows stay in sync if the
frontend hasn't run yet (e.g. server-only flows, background jobs).

Without `POSTHOG_API_KEY` set the SDK is flipped to `posthog.disabled = True`
and every helper here becomes a no-op — no network, no errors, safe for local
dev. Same shape as the Logfire setup (`token` unset = local-only sink).

`user_attrs(user)` (from `app.core.observability`) is reused so PostHog event
properties carry the same identity attributes Logfire spans do — that lets
support staff filter PostHog by the same email/role attributes they already
use in Logfire queries.
"""

from __future__ import annotations

import logging
from typing import Any

import posthog

from app.core.observability import user_attrs
from app.domain.models import User

logger = logging.getLogger(__name__)


def _distinct_id(user: User | None) -> str:
    return user.id if user is not None else "anon"


def capture(
    user: User | None,
    event: str,
    properties: dict[str, Any] | None = None,
) -> None:
    """Fire a PostHog event tied to `user.id` (or 'anon' when unauthenticated).

    Always merges `user_attrs(user)` into properties so PostHog and Logfire
    carry parallel identity tags. No-op when `posthog.disabled` is True.
    """
    if posthog.disabled:
        return
    merged: dict[str, Any] = {**user_attrs(user), **(properties or {})}
    try:
        posthog.capture(event, distinct_id=_distinct_id(user), properties=merged)
    except Exception:  # noqa: BLE001 — analytics must never break the request
        logger.exception("posthog capture failed for event=%s", event)


def capture_exception(
    exc: BaseException,
    *,
    user: User | None = None,
    **context: Any,
) -> None:
    """Send an exception to PostHog error tracking. No-op when disabled."""
    if posthog.disabled:
        return
    merged: dict[str, Any] = {**user_attrs(user), **context}
    try:
        posthog.capture_exception(
            exc, distinct_id=_distinct_id(user), properties=merged
        )
    except Exception:  # noqa: BLE001
        logger.exception("posthog capture_exception failed")


def identify(user: User) -> None:
    """Mirror the frontend identify so person rows exist for server-only flows.

    posthog v7 dropped the dedicated `identify` call: setting properties via
    `posthog.set(...)` is the canonical way to write to a person profile.
    """
    if posthog.disabled:
        return
    try:
        posthog.set(
            distinct_id=user.id,
            properties={
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "preferred_language": user.preferred_language,
                "timezone": user.timezone,
                "auth_provider": "mentee",
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("posthog identify failed for user_id=%s", user.id)
