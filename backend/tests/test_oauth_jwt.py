"""ID token verification against the current JOSE implementation."""

import asyncio
import time

import httpx
import pytest
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.auth.errors import InvalidIdTokenError
from app.auth.oauth_client import MenteeOAuthClient
from app.core.config import Settings


def test_id_token_keeps_signature_and_nonce_validation() -> None:
    key = RSAKey.generate_key(auto_kid=True)
    settings = Settings(mentee_oauth_client_id="bot-client")
    token = jwt.encode(
        {"alg": "RS256", "kid": key.kid},
        {
            "iss": str(settings.mentee_oauth_issuer).rstrip("/"),
            "aud": "bot-client",
            "sub": "mentee-1",
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": "expected",
        },
        key,
    )

    async def check() -> None:
        async with httpx.AsyncClient() as http:
            client = MenteeOAuthClient(settings, http)
            client._jwks = {"keys": [key.as_dict()]}

            claims = await client._verify_id_token(token, expected_nonce="expected")
            assert claims["sub"] == "mentee-1"

            with pytest.raises(InvalidIdTokenError, match="nonce mismatch"):
                await client._verify_id_token(token, expected_nonce="wrong")

    asyncio.run(check())
