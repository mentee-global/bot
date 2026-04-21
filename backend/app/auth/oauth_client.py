import base64
import hashlib
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebToken
from authlib.jose.errors import JoseError

from app.auth.errors import (
    CodeExchangeError,
    InvalidIdTokenError,
    RefreshFailedError,
    RefreshUnsupportedError,
    RevokeFailedError,
    UserinfoFetchError,
)
from app.core.config import Settings


@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str | None
    id_token_claims: dict[str, Any]
    scope: str
    expires_at: datetime


def s256_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


class MenteeOAuthClient:
    """OAuth 2.1 / OIDC client for the Mentee provider.

    Wires against the endpoints published in
    /.well-known/openid-configuration. See docs/oauth/01-oauth-backend-plan.md
    §9 for the contract and §9.1 for the refresh-grant-gap handling.
    """

    _METADATA_TTL_SECONDS = 24 * 60 * 60

    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http = http
        self._metadata: dict[str, Any] | None = None
        self._jwks: dict[str, Any] | None = None
        self._metadata_fetched_at: float = 0.0
        self._jwt = JsonWebToken(["RS256"])

    @property
    def metadata(self) -> dict[str, Any] | None:
        return self._metadata

    async def load_metadata(self) -> dict[str, Any]:
        url = (
            f"{str(self._settings.mentee_oauth_issuer).rstrip('/')}"
            "/.well-known/openid-configuration"
        )
        resp = await self._http.get(url)
        resp.raise_for_status()
        self._metadata = resp.json()
        self._metadata_fetched_at = time.time()
        self._jwks = None
        return self._metadata

    async def _ensure_metadata(self) -> dict[str, Any]:
        if (
            self._metadata is None
            or time.time() - self._metadata_fetched_at > self._METADATA_TTL_SECONDS
        ):
            await self.load_metadata()
        assert self._metadata is not None
        return self._metadata

    async def _fetch_jwks(self) -> dict[str, Any]:
        meta = await self._ensure_metadata()
        resp = await self._http.get(meta["jwks_uri"])
        resp.raise_for_status()
        self._jwks = resp.json()
        return self._jwks

    async def _get_jwks(self) -> dict[str, Any]:
        if self._jwks is None:
            await self._fetch_jwks()
        assert self._jwks is not None
        return self._jwks

    def build_authorize_url(
        self,
        *,
        state: str,
        code_challenge: str,
        nonce: str,
        login_role_hint: str | None = None,
    ) -> str:
        if self._metadata is None:
            raise RuntimeError("Metadata not loaded; call load_metadata() first")
        params: dict[str, str] = {
            "response_type": "code",
            "client_id": self._settings.mentee_oauth_client_id,
            "redirect_uri": str(self._settings.mentee_oauth_redirect_uri),
            "scope": self._settings.mentee_oauth_scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if login_role_hint:
            # Mentee-specific hint: picks which role-scoped login form
            # (/admin, /support, ...) is shown to unauthenticated users.
            # Mentee owns the allowlist; unknown values fall back to /login.
            params["mentee_login_role"] = login_role_hint
        return f"{self._metadata['authorization_endpoint']}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, code_verifier: str, nonce: str
    ) -> TokenBundle:
        meta = await self._ensure_metadata()
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": str(self._settings.mentee_oauth_redirect_uri),
            "code_verifier": code_verifier,
        }
        resp = await self._http.post(
            meta["token_endpoint"],
            data=data,
            auth=(
                self._settings.mentee_oauth_client_id,
                self._settings.mentee_oauth_client_secret.get_secret_value(),
            ),
            headers={"Accept": "application/json"},
        )
        if resp.status_code != 200:
            raise CodeExchangeError(_error_summary(resp))
        payload = resp.json()
        id_token = payload.get("id_token")
        if not id_token:
            raise CodeExchangeError("No id_token in token response")
        claims = await self._verify_id_token(id_token, expected_nonce=nonce)
        expires_in = int(payload.get("expires_in", 3600))
        return TokenBundle(
            access_token=payload["access_token"],
            refresh_token=payload.get("refresh_token"),
            id_token_claims=claims,
            scope=payload.get("scope", ""),
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
        )

    async def refresh(self, refresh_token: str) -> TokenBundle:
        meta = await self._ensure_metadata()
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        resp = await self._http.post(
            meta["token_endpoint"],
            data=data,
            auth=(
                self._settings.mentee_oauth_client_id,
                self._settings.mentee_oauth_client_secret.get_secret_value(),
            ),
            headers={"Accept": "application/json"},
        )
        if resp.status_code != 200:
            err = _error_code(resp)
            if err in ("unsupported_grant_type", "invalid_grant"):
                raise RefreshUnsupportedError(err)
            raise RefreshFailedError(err or f"HTTP {resp.status_code}")
        payload = resp.json()
        id_token = payload.get("id_token")
        claims: dict[str, Any] = {}
        if id_token:
            claims = await self._verify_id_token(id_token, expected_nonce=None)
        expires_in = int(payload.get("expires_in", 3600))
        return TokenBundle(
            access_token=payload["access_token"],
            refresh_token=payload.get("refresh_token"),
            id_token_claims=claims,
            scope=payload.get("scope", ""),
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
        )

    async def userinfo(self, access_token: str) -> dict[str, Any]:
        meta = await self._ensure_metadata()
        resp = await self._http.get(
            meta["userinfo_endpoint"],
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            raise UserinfoFetchError(f"HTTP {resp.status_code}")
        return resp.json()

    async def revoke(
        self, token: str, token_type_hint: str = "refresh_token"
    ) -> None:
        meta = await self._ensure_metadata()
        endpoint = meta.get("revocation_endpoint")
        if not endpoint:
            raise RevokeFailedError("No revocation_endpoint in discovery doc")
        resp = await self._http.post(
            endpoint,
            data={"token": token, "token_type_hint": token_type_hint},
            auth=(
                self._settings.mentee_oauth_client_id,
                self._settings.mentee_oauth_client_secret.get_secret_value(),
            ),
            headers={"Accept": "application/json"},
        )
        if resp.status_code not in (200, 204):
            raise RevokeFailedError(f"HTTP {resp.status_code}")

    async def _verify_id_token(
        self, id_token: str, *, expected_nonce: str | None
    ) -> dict[str, Any]:
        jwks = await self._get_jwks()
        try:
            claims = self._jwt.decode(id_token, key=jwks)
        except JoseError as first_err:
            try:
                await self._fetch_jwks()
                claims = self._jwt.decode(id_token, key=self._jwks)
            except JoseError as second_err:
                raise InvalidIdTokenError(
                    f"signature verification failed: {second_err}"
                ) from second_err
            except Exception as e:
                raise InvalidIdTokenError(f"signature: {first_err}") from e

        now = int(time.time())
        expected_issuer = str(self._settings.mentee_oauth_issuer).rstrip("/")
        iss = str(claims.get("iss", "")).rstrip("/")
        if iss != expected_issuer:
            raise InvalidIdTokenError(
                f"iss mismatch: {iss!r} != {expected_issuer!r}"
            )
        aud = claims.get("aud")
        aud_list = aud if isinstance(aud, list) else [aud]
        if self._settings.mentee_oauth_client_id not in aud_list:
            raise InvalidIdTokenError(f"aud does not include client_id: {aud!r}")
        exp = int(claims.get("exp", 0))
        if exp + 60 < now:
            raise InvalidIdTokenError(f"expired: exp={exp}, now={now}")
        iat = int(claims.get("iat", 0))
        if iat > now + 60:
            raise InvalidIdTokenError(f"iat in the future: iat={iat}, now={now}")
        if iat and iat < now - 600:
            raise InvalidIdTokenError(f"iat too old: iat={iat}, now={now}")
        if expected_nonce is not None and claims.get("nonce") != expected_nonce:
            raise InvalidIdTokenError("nonce mismatch")
        if not claims.get("sub"):
            raise InvalidIdTokenError("missing sub")
        return dict(claims)


def _error_summary(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        return f"HTTP {resp.status_code}"
    return (
        f"HTTP {resp.status_code}: "
        f"{body.get('error', '')} - {body.get('error_description', '')}"
    )


def _error_code(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        return str(body.get("error", ""))
    except Exception:
        return ""
