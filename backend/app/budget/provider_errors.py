"""Classify provider-side insufficient-funds errors.

The bot ledger is an estimate — we never know the *real* provider balance. The
authoritative signal that a provider has run out of money is the provider
returning a billing error on a normal API call. This module sniffs the
exception shape from the OpenAI / Perplexity SDKs and answers two questions:

1. Is this an "out of funds" error (vs. a transient network blip, rate limit,
   bad prompt, etc.)?
2. What's a short human-readable reason string to stamp on the kill-switch
   flag so an admin opening the panel can see *why* chat is paused?

Detection is duck-typed — `status_code` / `status` / body text — so SDK
version bumps don't silently flip the classification. When the body shape is
unexpected, fall closed: treat as "not insufficient funds" rather than risk
a false hard-stop that pauses the whole platform on a transient error.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Phrases that appear in OpenAI's and Perplexity's billing error bodies.
# Matched case-insensitively against the flattened error body.
_BILLING_KEYWORDS = (
    "insufficient_quota",
    "exceeded_current_quota",
    "billing_hard_limit_reached",
    "billing",
    "balance",
    "out of credit",
    "insufficient credit",
    "insufficient funds",
    "payment required",
)


def _walk_causes(exc: BaseException) -> list[BaseException]:
    """Flatten the exception + cause/context chain so wrapped SDK errors are
    still inspectable. Bounded depth to avoid pathological cycles."""
    seen: list[BaseException] = []
    current: BaseException | None = exc
    for _ in range(8):
        if current is None or current in seen:
            break
        seen.append(current)
        current = current.__cause__ or current.__context__
    return seen


def _status(exc: BaseException) -> int | None:
    for attr in ("status_code", "status", "http_status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        sc = getattr(response, "status_code", None)
        if isinstance(sc, int):
            return sc
    return None


def _extract_body(exc: BaseException) -> Any:
    for attr in ("body", "response_body"):
        body = getattr(exc, attr, None)
        if body is not None:
            return body
    response = getattr(exc, "response", None)
    if response is None:
        return None
    try:
        return response.json()
    except Exception:  # noqa: BLE001 — best-effort read
        return getattr(response, "text", None)


def _flatten(body: Any) -> str:
    if body is None:
        return ""
    if isinstance(body, str):
        return body
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, str):
            return err
        if isinstance(err, dict):
            parts = [
                str(err.get(k))
                for k in ("code", "type", "message", "param", "detail")
                if err.get(k)
            ]
            if parts:
                return " ".join(parts)
    return str(body)


def is_insufficient_funds(exc: BaseException) -> bool:
    """True when `exc` looks like a provider billing / out-of-funds error.

    Matches on:
    - HTTP 402 (Payment Required) — unambiguous.
    - HTTP 429 with `insufficient_quota` in the body — OpenAI's signal for a
      pay-as-you-go account that ran out.
    - HTTP 401 / 403 combined with a billing keyword in the body — some
      providers return auth-shaped errors when billing is suspended.
    """
    for candidate in _walk_causes(exc):
        status = _status(candidate)
        body_text = _flatten(_extract_body(candidate)).lower()
        if status == 402:
            return True
        if status == 429 and any(
            kw in body_text for kw in ("insufficient_quota", "exceeded_current_quota")
        ):
            return True
        if status in (401, 403) and any(kw in body_text for kw in _BILLING_KEYWORDS):
            return True
    return False


def build_reason(exc: BaseException, *, provider: str) -> str:
    """Build the reason string stamped on the kill-switch flag for admins."""
    for candidate in _walk_causes(exc):
        status = _status(candidate)
        body_text = _flatten(_extract_body(candidate))
        if status is None and not body_text:
            continue
        snippet = body_text.strip().replace("\n", " ")
        if len(snippet) > 140:
            snippet = snippet[:137] + "…"
        detail = snippet or type(candidate).__name__
        return f"{provider} returned HTTP {status or '?'} — {detail}"
    return f"{provider} returned an insufficient-funds error ({type(exc).__name__})"
