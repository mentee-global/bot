import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.auth.crypto import decrypt
from app.auth.db_models import SessionRecord, UserRecord
from app.auth.errors import (
    AuthError,
    ProfileFetchAuthError,
    RefreshFailedError,
    RefreshUnsupportedError,
    RevokeFailedError,
    StateMismatchError,
    UserinfoFetchError,
)
from app.auth.mentee_profile_client import MenteeProfileClient
from app.auth.oauth_client import MenteeOAuthClient, s256_challenge
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.core.config import Settings
from app.domain.models import MenteeProfile, User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class _CachedProfile:
    profile: MenteeProfile | None
    expires_at: datetime


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
        profile_client: MenteeProfileClient | None = None,
    ) -> None:
        self._oauth = oauth
        self._sessions = sessions
        self._state = state
        self._settings = settings
        self._profile_client = profile_client
        self._profile_cache: dict[str, _CachedProfile] = {}

    async def start_login(
        self,
        *,
        redirect_to: str | None = None,
        login_role_hint: str | None = None,
    ) -> str:
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
            state=state,
            code_challenge=code_challenge,
            nonce=nonce,
            login_role_hint=login_role_hint,
        )

    async def complete_login(
        self, *, code: str, state: str
    ) -> tuple[User, str, str | None]:
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
        user_row, _session_row = await self._sessions.create(
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
            user_row.role or "?",
        )
        return _user_from_row(user_row), session_id, state_row.redirect_to

    async def current_user(self, session_id: str) -> User:
        loaded = await self._sessions.get_and_touch_with_user(session_id)
        if loaded is None:
            raise AuthError("Unknown session")
        session_row, user_row = loaded
        if session_row.access_token_expires_at <= _now() + timedelta(seconds=60):
            session_row, user_row = await self._refresh(session_row)
        user = _user_from_row(user_row)
        user.mentee_profile = await self._resolve_profile(session_row)
        return user

    async def logout(self, session_id: str) -> None:
        row = await self._sessions.get(session_id)
        if row is not None and row.refresh_token_enc is not None:
            try:
                await self._oauth.revoke(decrypt(row.refresh_token_enc))
            except RevokeFailedError as e:
                logger.warning("revoke failed (best-effort): %s", e)
        await self._sessions.delete(session_id)
        self._profile_cache.pop(session_id, None)
        logger.info("logout for session %s", session_id[:8])

    async def _resolve_profile(
        self, session_row: SessionRecord
    ) -> MenteeProfile | None:
        """Return the mentee's richer profile (cached 15 min by default).
        Returns None when the profile client is disabled or degrades gracefully.
        """
        if self._profile_client is None:
            return None

        session_id = session_row.session_id
        cached = self._profile_cache.get(session_id)
        if cached is not None and cached.expires_at > _now():
            return cached.profile

        access_token = decrypt(session_row.access_token_enc)
        try:
            profile = await self._profile_client.fetch(access_token)
        except ProfileFetchAuthError:
            # Access token rejected. Try to refresh once, then retry.
            try:
                refreshed_session, _ = await self._refresh(session_row)
            except (RefreshFailedError, RefreshUnsupportedError):
                return None
            try:
                profile = await self._profile_client.fetch(
                    decrypt(refreshed_session.access_token_enc)
                )
            except ProfileFetchAuthError:
                logger.info(
                    "profile still 401 after refresh; falling back to identity prompt"
                )
                return None

        ttl = self._settings.bot_profile_cache_ttl_seconds
        self._profile_cache[session_id] = _CachedProfile(
            profile=profile,
            expires_at=_now() + timedelta(seconds=ttl),
        )
        return profile

    async def _refresh(
        self, row: SessionRecord
    ) -> tuple[SessionRecord, UserRecord]:
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
        # Invalidate cached profile on refresh — data may have changed in
        # Mentee since last fetch; let the next current_user() repopulate.
        self._profile_cache.pop(row.session_id, None)
        refreshed = await self._sessions.get_and_touch_with_user(row.session_id)
        assert refreshed is not None
        return refreshed


def _user_from_row(user: UserRecord) -> User:
    return User(
        id=str(user.id),
        mentee_sub=user.mentee_sub,
        email=user.email,
        name=user.name,
        role=user.role,
        role_id=user.role_id,
        picture=user.picture,
        preferred_language=user.preferred_language,
        timezone=user.timezone,
    )
