import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from app.auth.crypto import decrypt
from app.auth.db_models import SessionRecord
from app.auth.errors import (
    AuthError,
    RefreshFailedError,
    RefreshUnsupportedError,
    RevokeFailedError,
    StateMismatchError,
    UserinfoFetchError,
)
from app.auth.oauth_client import MenteeOAuthClient, s256_challenge
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import Settings
from app.domain.models import User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


class AuthService:
    """Orchestrates the Bot-side OAuth flow.

    Keeps routes thin: every interesting decision (PKCE gen, state single-use,
    transparent refresh, refresh-gap handling, best-effort revoke) lives here
    so it can be unit-tested without a FastAPI app spun up.
    """

    def __init__(
        self,
        *,
        oauth: MenteeOAuthClient,
        sessions: SessionStore,
        state: StateStore,
        settings: Settings,
    ) -> None:
        self._oauth = oauth
        self._sessions = sessions
        self._state = state
        self._settings = settings

    async def start_login(self, *, redirect_to: str | None = None) -> str:
        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = s256_challenge(code_verifier)
        nonce = secrets.token_urlsafe(16)
        await self._state.put(
            state=state,
            code_verifier=code_verifier,
            nonce=nonce,
            redirect_to=redirect_to,
        )
        logger.info("login started (state prefix %s)", state[:8])
        return self._oauth.build_authorize_url(
            state=state, code_challenge=code_challenge, nonce=nonce
        )

    async def complete_login(self, *, code: str, state: str) -> tuple[User, str]:
        state_row = await self._state.pop(state)
        if state_row is None:
            raise StateMismatchError()
        bundle = await self._oauth.exchange_code(
            code=code, code_verifier=state_row.code_verifier, nonce=state_row.nonce
        )
        profile = await self._oauth.userinfo(bundle.access_token)
        # userinfo is authoritative over id_token for user-visible fields.
        merged: dict[str, Any] = {**bundle.id_token_claims, **profile}
        session_id = secrets.token_urlsafe(32)
        await self._sessions.create(
            session_id=session_id,
            claims=merged,
            access_token=bundle.access_token,
            access_token_expires_at=bundle.expires_at,
            refresh_token=bundle.refresh_token,
            id_token_nonce=state_row.nonce,
        )
        logger.info(
            "login completed: session %s, role=%s",
            session_id[:8],
            merged.get("role", "?"),
        )
        return _claims_to_user(merged), session_id

    async def current_user(self, session_id: str) -> User:
        row = await self._sessions.get(session_id)
        if row is None:
            raise AuthError("Unknown session")
        if row.access_token_expires_at <= _now() + timedelta(seconds=60):
            row = await self._refresh(row)
        await self._sessions.touch(session_id)
        return _row_to_user(row)

    async def logout(self, session_id: str) -> None:
        row = await self._sessions.get(session_id)
        if row is not None and row.refresh_token_enc is not None:
            try:
                await self._oauth.revoke(decrypt(row.refresh_token_enc))
            except RevokeFailedError as e:
                logger.warning("revoke failed (best-effort): %s", e)
        await self._sessions.delete(session_id)
        logger.info("logout for session %s", session_id[:8])

    async def _refresh(self, row: SessionRecord) -> SessionRecord:
        if row.refresh_token_enc is None:
            await self._sessions.delete(row.session_id)
            raise RefreshFailedError("No refresh token stored")
        try:
            bundle = await self._oauth.refresh(decrypt(row.refresh_token_enc))
        except RefreshUnsupportedError:
            # Expected while Mentee's MenteeRefreshTokenGrant is un-wired
            # (docs/oauth/00-oauth-overview.md §2.5). Classified as INFO, not
            # WARNING — this is a normal outcome today, not a bug.
            await self._sessions.delete(row.session_id)
            logger.info(
                "refresh grant unsupported by provider; session %s expired",
                row.session_id[:8],
            )
            raise
        except RefreshFailedError as e:
            await self._sessions.delete(row.session_id)
            logger.warning(
                "refresh failed for session %s: %s", row.session_id[:8], e
            )
            raise

        profile: dict[str, Any] | None
        try:
            profile = await self._oauth.userinfo(bundle.access_token)
        except UserinfoFetchError as e:
            logger.warning(
                "userinfo fetch failed after refresh; keeping cached profile: %s", e
            )
            profile = None

        await self._sessions.update_tokens_and_profile(
            row.session_id,
            access_token=bundle.access_token,
            access_token_expires_at=bundle.expires_at,
            refresh_token=bundle.refresh_token,
            profile=profile,
        )
        refreshed = await self._sessions.get(row.session_id)
        assert refreshed is not None
        return refreshed


def _claims_to_user(claims: dict[str, Any]) -> User:
    return User(
        id=str(claims["sub"]),
        email=str(claims["email"]),
        name=str(claims.get("name", "")),
        role=str(claims.get("role", "")),
        role_id=int(claims.get("role_id", 0)),
        picture=claims.get("picture"),
        preferred_language=claims.get("preferred_language"),
        timezone=claims.get("timezone"),
    )


def _row_to_user(row: SessionRecord) -> User:
    return User(
        id=row.mentee_sub,
        email=row.email,
        name=row.name,
        role=row.role,
        role_id=row.role_id,
        picture=row.picture,
        preferred_language=row.preferred_language,
        timezone=row.timezone,
    )
