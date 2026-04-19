"""Fixtures for the Bot's OAuth client tests.

Mentee is mocked entirely via respx against a session-wide RSA keypair. The
issuer URL mirrors `.env` (via `settings.mentee_oauth_issuer`), so init_auth
hits the same respx-mocked endpoints as the unit tests themselves.
"""

import time
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from authlib.jose import JsonWebKey, JsonWebToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.oauth_client import MenteeOAuthClient
from app.core.config import Settings, settings

FAKE_ISSUER = str(settings.mentee_oauth_issuer).rstrip("/")
FAKE_CLIENT_ID = settings.mentee_oauth_client_id
FAKE_KID = "test-key-1"


@pytest.fixture(scope="session")
def rsa_keypair() -> dict[str, Any]:
    """One RSA keypair for the whole test session — 2048-bit gen is slow."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_private = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    jwk_obj = JsonWebKey.import_key(pem_private)
    jwk_dict = jwk_obj.as_dict(is_private=False)
    jwk_dict["kid"] = FAKE_KID
    jwk_dict["alg"] = "RS256"
    jwk_dict["use"] = "sig"
    return {
        "pem_private": pem_private,
        "jwks": {"keys": [jwk_dict]},
    }


@pytest.fixture
def fake_settings() -> Settings:
    return settings


def make_id_token(
    rsa_keypair: dict[str, Any],
    *,
    iss: str = FAKE_ISSUER,
    aud: str | list[str] = FAKE_CLIENT_ID,
    nonce: str | None = "nonce-abc",
    sub: str = "user-123",
    iat_offset: int = 0,
    exp_offset: int = 3600,
    extra: dict[str, Any] | None = None,
    kid: str = FAKE_KID,
) -> str:
    jwt = JsonWebToken(["RS256"])
    now = int(time.time())
    payload: dict[str, Any] = {
        "iss": iss,
        "aud": aud,
        "sub": sub,
        "iat": now + iat_offset,
        "exp": now + exp_offset,
    }
    if nonce is not None:
        payload["nonce"] = nonce
    if extra:
        payload.update(extra)
    token = jwt.encode(
        header={"alg": "RS256", "kid": kid},
        payload=payload,
        key=rsa_keypair["pem_private"],
    )
    return token.decode() if isinstance(token, bytes) else token


def make_discovery_doc() -> dict[str, Any]:
    return {
        "issuer": FAKE_ISSUER,
        "authorization_endpoint": f"{FAKE_ISSUER}/oauth/authorize",
        "token_endpoint": f"{FAKE_ISSUER}/oauth/token",
        "userinfo_endpoint": f"{FAKE_ISSUER}/oauth/userinfo",
        "jwks_uri": f"{FAKE_ISSUER}/.well-known/jwks.json",
        "revocation_endpoint": f"{FAKE_ISSUER}/oauth/revoke",
        "scopes_supported": ["openid", "email", "profile", "mentee.role"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": [
            "client_secret_basic",
            "client_secret_post",
        ],
    }


@pytest.fixture
def mock_mentee(rsa_keypair: dict[str, Any]) -> Iterator[respx.MockRouter]:
    with respx.mock(base_url=FAKE_ISSUER, assert_all_called=False) as router:
        router.get("/.well-known/openid-configuration").mock(
            return_value=httpx.Response(200, json=make_discovery_doc())
        )
        router.get("/.well-known/jwks.json").mock(
            return_value=httpx.Response(200, json=rsa_keypair["jwks"])
        )
        yield router


@pytest.fixture
async def oauth_client(
    fake_settings: Settings, mock_mentee: respx.MockRouter
) -> MenteeOAuthClient:
    http = httpx.AsyncClient(timeout=5.0)
    client = MenteeOAuthClient(fake_settings, http)
    await client.load_metadata()
    return client


@pytest.fixture
async def clean_db() -> None:
    """Truncate both auth tables so each test starts from a clean slate."""
    from sqlalchemy import text

    from app.db.engine import engine

    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE sessions, oauth_state"))


@pytest.fixture
async def auth_service(
    fake_settings: Settings,
    oauth_client: MenteeOAuthClient,
    clean_db: None,
):
    from app.auth.service import AuthService
    from app.auth.session_store import SessionStore
    from app.auth.state_store import StateStore

    return AuthService(
        oauth=oauth_client,
        sessions=SessionStore(),
        state=StateStore(),
        settings=fake_settings,
    )
