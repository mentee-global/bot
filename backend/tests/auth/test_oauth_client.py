"""Unit tests for MenteeOAuthClient.

Focus: id_token verification (iss/aud/exp/iat/nonce/signature), authorize URL
construction, token exchange happy path, and the refresh-grant-gap behavior
documented in docs/oauth/00-oauth-overview.md §2.5 / 01-oauth-backend-plan.md
§9.1.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from app.auth.errors import (
    CodeExchangeError,
    InvalidIdTokenError,
    RefreshFailedError,
    RefreshUnsupportedError,
    UserinfoFetchError,
)
from app.auth.oauth_client import MenteeOAuthClient, s256_challenge
from app.core.config import settings

from .conftest import FAKE_CLIENT_ID, FAKE_ISSUER, make_id_token

FAKE_REDIRECT = str(settings.mentee_oauth_redirect_uri)


def test_s256_challenge_matches_rfc7636_sample() -> None:
    # RFC 7636 Appendix B sample verifier/challenge pair.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    assert s256_challenge(verifier) == expected


def test_build_authorize_url_has_pkce_and_required_params(
    oauth_client: MenteeOAuthClient,
) -> None:
    url = oauth_client.build_authorize_url(
        state="state-abc",
        code_challenge="chal-xyz",
        nonce="nonce-abc",
    )
    parsed = urlparse(url)
    qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    assert parsed.path.endswith("/oauth/authorize")
    assert qs["response_type"] == "code"
    assert qs["client_id"] == FAKE_CLIENT_ID
    assert qs["redirect_uri"] == FAKE_REDIRECT
    assert qs["scope"] == "openid email profile mentee.role"
    assert qs["state"] == "state-abc"
    assert qs["nonce"] == "nonce-abc"
    assert qs["code_challenge"] == "chal-xyz"
    assert qs["code_challenge_method"] == "S256"


async def test_exchange_code_happy_path(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, nonce="nonce-abc")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "at-1",
                "refresh_token": "rt-1",
                "id_token": id_token,
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "openid email profile mentee.role",
            },
        )
    )
    bundle = await oauth_client.exchange_code(
        code="code-1", code_verifier="ver-1", nonce="nonce-abc"
    )
    assert bundle.access_token == "at-1"
    assert bundle.refresh_token == "rt-1"
    assert bundle.id_token_claims["sub"] == "user-123"
    assert bundle.scope == "openid email profile mentee.role"


async def test_exchange_code_rejects_wrong_nonce(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, nonce="nonce-mismatch")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": id_token})
    )
    with pytest.raises(InvalidIdTokenError, match="nonce"):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_exchange_code_rejects_wrong_issuer(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, iss="http://evil.example")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": id_token})
    )
    with pytest.raises(InvalidIdTokenError, match="iss"):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_exchange_code_rejects_wrong_audience(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, aud="some-other-client")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": id_token})
    )
    with pytest.raises(InvalidIdTokenError, match="aud"):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_exchange_code_rejects_expired_id_token(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, iat_offset=-3700, exp_offset=-3600)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": id_token})
    )
    with pytest.raises(InvalidIdTokenError, match="expired"):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_exchange_code_rejects_tampered_signature(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    good = make_id_token(rsa_keypair, nonce="nonce-abc")
    # Flip a single base64url char in the signature segment.
    header, payload, signature = good.split(".")
    tampered_sig = ("B" if signature[0] != "B" else "C") + signature[1:]
    tampered = ".".join([header, payload, tampered_sig])
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": tampered})
    )
    with pytest.raises(InvalidIdTokenError):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_exchange_code_rejects_400_from_provider(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(
            400, json={"error": "invalid_grant", "error_description": "bad PKCE"}
        )
    )
    with pytest.raises(CodeExchangeError):
        await oauth_client.exchange_code(code="c", code_verifier="v", nonce="nonce-abc")


async def test_refresh_happy_path(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "at-2",
                "refresh_token": "rt-2",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "openid email profile mentee.role",
            },
        )
    )
    bundle = await oauth_client.refresh("rt-1")
    assert bundle.access_token == "at-2"
    assert bundle.refresh_token == "rt-2"


async def test_refresh_unsupported_grant_raises_typed(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(400, json={"error": "unsupported_grant_type"})
    )
    with pytest.raises(RefreshUnsupportedError):
        await oauth_client.refresh("rt-1")


async def test_refresh_invalid_grant_raises_typed(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(400, json={"error": "invalid_grant"})
    )
    with pytest.raises(RefreshUnsupportedError):
        await oauth_client.refresh("rt-1")


async def test_refresh_other_error_raises_generic(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(500, json={"error": "server_error"})
    )
    with pytest.raises(RefreshFailedError) as exc:
        await oauth_client.refresh("rt-1")
    assert not isinstance(exc.value, RefreshUnsupportedError)


async def test_userinfo_happy_path(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(
            200,
            json={
                "sub": "user-123",
                "email": "u@example.com",
                "email_verified": True,
                "name": "Demo",
                "role": "mentee",
                "role_id": 2,
            },
        )
    )
    info = await oauth_client.userinfo("at-1")
    assert info["sub"] == "user-123"
    assert info["role"] == "mentee"


async def test_userinfo_401_raises(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.get("/oauth/userinfo").mock(return_value=httpx.Response(401))
    with pytest.raises(UserinfoFetchError):
        await oauth_client.userinfo("at-1")


async def test_revoke_is_silent_on_success(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
) -> None:
    mock_mentee.post("/oauth/revoke").mock(return_value=httpx.Response(200))
    await oauth_client.revoke("rt-1")


async def test_build_authorize_url_uses_s256_pkce_by_default(
    oauth_client: MenteeOAuthClient,
) -> None:
    url = oauth_client.build_authorize_url(
        state="s", code_challenge=s256_challenge("v"), nonce="n"
    )
    assert "code_challenge_method=S256" in url


async def test_issuer_match_tolerates_trailing_slash(
    oauth_client: MenteeOAuthClient,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    id_token = make_id_token(rsa_keypair, iss=f"{FAKE_ISSUER}/")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "a", "id_token": id_token})
    )
    bundle = await oauth_client.exchange_code(
        code="c", code_verifier="v", nonce="nonce-abc"
    )
    assert bundle.access_token == "a"
