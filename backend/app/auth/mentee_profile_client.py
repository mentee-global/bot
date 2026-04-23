"""Client for Mentee's `GET /oauth/profile` endpoint.

See docs/oauth/04-mentee-api-profile.md for the DTO contract. The endpoint
is gated by scope `mentee.api.profile.read` — we always request it at login.

Degrades gracefully on 4xx/5xx/timeout (logs info, returns None, agent
falls back to the identity-only prompt). Raises ProfileFetchAuthError on
401 so AuthService can refresh-and-retry.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

import httpx

from app.auth.errors import ProfileFetchAuthError
from app.core.config import Settings
from app.domain.models import (
    MenteeEducation,
    MenteeMentor,
    MenteeOrganization,
    MenteeProfile,
)

logger = logging.getLogger(__name__)


class MenteeProfileClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http = http

    async def fetch(self, access_token: str) -> MenteeProfile | None:
        url = (
            f"{str(self._settings.mentee_oauth_issuer).rstrip('/')}"
            "/oauth/profile"
        )
        try:
            resp = await self._http.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=3.0,
            )
        except httpx.HTTPError as e:
            logger.info("profile fetch failed (network): %s", e)
            return None

        if resp.status_code == 401:
            raise ProfileFetchAuthError("profile endpoint returned 401")
        if resp.status_code == 403:
            logger.info(
                "profile fetch forbidden (scope not granted?); "
                "falling back to identity-only prompt"
            )
            return None
        if resp.status_code == 404:
            # Valid state: caller's role is not mentee. Nothing to attach.
            return None
        if resp.status_code >= 500:
            logger.info("profile fetch 5xx: %s", resp.status_code)
            return None
        if resp.status_code != 200:
            logger.info("profile fetch unexpected status: %s", resp.status_code)
            return None

        try:
            payload = resp.json()
        except ValueError:
            logger.warning("profile response was not valid JSON")
            return None

        if not isinstance(payload, dict) or payload.get("version") != 1:
            logger.warning(
                "profile response shape unexpected (version=%s)",
                payload.get("version") if isinstance(payload, dict) else "?",
            )
            return None

        data = payload.get("data")
        if not isinstance(data, dict):
            return MenteeProfile()
        return _parse_dto(data)


def _parse_dto(data: dict[str, Any]) -> MenteeProfile:
    """Best-effort parse. Mentee's DTO omits empty values — every key is
    optional. Coerce string timestamps; let Pydantic validate the rest.
    """
    kwargs: dict[str, Any] = {}

    for key in (
        "country",
        "location",
        "age",
        "gender",
        "biography",
        "application_notes",
        "education_level",
    ):
        v = data.get(key)
        if isinstance(v, str) and v:
            kwargs[key] = v

    for key in ("languages", "interests", "work_state", "immigrant_status"):
        v = data.get(key)
        if isinstance(v, list):
            kwargs[key] = [str(x) for x in v if isinstance(x, str | int | float)]

    for key in ("is_student", "socially_engaged"):
        v = data.get(key)
        if isinstance(v, bool):
            kwargs[key] = v

    birthday = data.get("birthday")
    if isinstance(birthday, str) and birthday:
        try:
            kwargs["birthday"] = date.fromisoformat(birthday)
        except ValueError:
            logger.debug("ignoring unparseable birthday: %r", birthday)

    joined_at = data.get("joined_at")
    if isinstance(joined_at, str) and joined_at:
        try:
            kwargs["joined_at"] = datetime.fromisoformat(
                joined_at.replace("Z", "+00:00")
            )
        except ValueError:
            logger.debug("ignoring unparseable joined_at: %r", joined_at)

    education = data.get("education")
    if isinstance(education, list):
        parsed: list[MenteeEducation] = []
        for item in education:
            if not isinstance(item, dict):
                continue
            try:
                parsed.append(MenteeEducation(**item))
            except Exception:  # noqa: BLE001 — resilient parse
                logger.debug("skipping education entry: %r", item)
        if parsed:
            kwargs["education"] = parsed

    org = data.get("organization")
    if isinstance(org, dict):
        try:
            kwargs["organization"] = MenteeOrganization(**org)
        except Exception:  # noqa: BLE001
            logger.debug("skipping organization: %r", org)

    mentor = data.get("mentor")
    if isinstance(mentor, dict):
        try:
            kwargs["mentor"] = MenteeMentor(**mentor)
        except Exception:  # noqa: BLE001
            logger.debug("skipping mentor: %r", mentor)

    return MenteeProfile(**kwargs)
