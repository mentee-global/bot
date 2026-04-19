"""End-to-end route tests for /api/auth/*.

Exercises the HTTP layer against an in-process FastAPI TestClient, with the
Mentee provider mocked via respx. Covers the matrix in plan §14 that isn't
already covered by test_service.py.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.db.engine import engine

from .conftest import FAKE_CLIENT_ID, make_id_token


def _token_endpoint_response(id_token: str) -> dict[str, Any]:
    return {
        "access_token": "at-1",
        "refresh_token": "rt-1",
        "id_token": id_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "openid email profile mentee.role",
    }


def _userinfo_payload() -> dict[str, Any]:
    return {
        "sub": "user-abc",
        "email": "user@example.com",
        "email_verified": True,
        "name": "Alice",
        "picture": "https://cdn.example/alice.jpg",
        "preferred_language": "es-AR",
        "timezone": "America/Argentina/Buenos_Aires",
        "role": "mentor",
        "role_id": 3,
    }


def _get_state_from_db() -> tuple[str, str]:
    import asyncio

    async def _pull() -> tuple[str, str]:
        async with engine.connect() as conn:
            row = (
                await conn.execute(text("SELECT state, nonce FROM oauth_state"))
            ).one()
        return row[0], row[1]

    return asyncio.run(_pull())


def test_login_returns_302_to_mentee_authorize(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get("/api/auth/login", follow_redirects=False)
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert "/oauth/authorize?" in location
    assert f"client_id={FAKE_CLIENT_ID}" in location
    assert "code_challenge_method=S256" in location
    assert "scope=openid+email+profile+mentee.role" in location


def test_callback_missing_code_redirects_to_error(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get("/api/auth/callback?state=abc", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/auth/error?reason=missing_params")


def test_callback_missing_state_redirects_to_error(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get("/api/auth/callback?code=abc", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/auth/error?reason=missing_params")


def test_callback_provider_error_passes_through(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get(
        "/api/auth/callback?error=access_denied&state=x", follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/auth/error?reason=access_denied")


def test_callback_unknown_error_collapses_to_generic(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get(
        "/api/auth/callback?error=surprise_error&state=x", follow_redirects=False
    )
    assert resp.headers["location"].endswith("/auth/error?reason=oauth")


def test_callback_bad_state_redirects_to_error(
    client: TestClient, mock_mentee
) -> None:
    resp = client.get(
        "/api/auth/callback?code=c&state=attacker", follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/auth/error?reason=oauth")


def test_callback_tampered_id_token_redirects_to_error(
    client: TestClient, mock_mentee, rsa_keypair: dict
) -> None:
    # Seed state
    client.get("/api/auth/login", follow_redirects=False)
    state, nonce = _get_state_from_db()

    good = make_id_token(rsa_keypair, nonce=nonce)
    header, payload, sig = good.split(".")
    # Flip a byte in the signature segment.
    tampered_sig = ("X" if sig[0] != "X" else "Y") + sig[1:]
    bad_id_token = ".".join([header, payload, tampered_sig])

    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(
            200, json=_token_endpoint_response(bad_id_token)
        )
    )

    resp = client.get(
        f"/api/auth/callback?code=c&state={state}", follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/auth/error?reason=oauth")


def test_callback_happy_path_sets_cookie_and_redirects_to_chat(
    client: TestClient, mock_mentee, rsa_keypair: dict
) -> None:
    client.get("/api/auth/login", follow_redirects=False)
    state, nonce = _get_state_from_db()

    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )

    resp = client.get(
        f"/api/auth/callback?code=c&state={state}", follow_redirects=False
    )
    assert resp.status_code == 302
    frontend = str(settings.frontend_url).rstrip("/")
    assert resp.headers["location"] == f"{frontend}/chat"

    # Session cookie is set with expected attrs.
    set_cookie = resp.headers.get("set-cookie", "")
    assert settings.session_cookie_name in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Domain=" not in set_cookie


def test_me_returns_extended_user_payload(
    authed_client: TestClient,
) -> None:
    resp = authed_client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()["user"]
    assert body["role"] == "mentee"
    assert body["role_id"] == 2
    assert body["preferred_language"] == "en-US"
    assert body["timezone"] == "UTC"


def test_me_401_when_no_cookie(client: TestClient, mock_mentee) -> None:
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_logout_revokes_and_clears_cookie(
    authed_client: TestClient, mock_mentee
) -> None:
    revoke_route = mock_mentee.post("/oauth/revoke").mock(
        return_value=httpx.Response(200)
    )
    resp = authed_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert revoke_route.called
    # Subsequent /me without cookie → 401
    authed_client.cookies.clear()
    me = authed_client.get("/api/auth/me")
    assert me.status_code == 401


def test_concurrent_sessions_independent(
    client: TestClient, mock_mentee, rsa_keypair: dict
) -> None:
    # Device A
    client.get("/api/auth/login", follow_redirects=False)
    state_a, nonce_a = _get_state_from_db()
    id_token_a = make_id_token(rsa_keypair, nonce=nonce_a, sub="user-a")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token_a))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(
            200, json=_userinfo_payload() | {"sub": "user-a"}
        )
    )
    resp_a = client.get(
        f"/api/auth/callback?code=c&state={state_a}", follow_redirects=False
    )
    cookie_a = _extract_session_cookie(resp_a)

    # Clear the client's auto-stored cookie before Device B's flow.
    client.cookies.clear()

    # Device B: new login, new state
    client.get("/api/auth/login", follow_redirects=False)
    import asyncio

    async def _second_state() -> tuple[str, str]:
        async with engine.connect() as conn:
            row = (
                await conn.execute(
                    text(
                        "SELECT state, nonce FROM oauth_state "
                        "ORDER BY created_at DESC LIMIT 1"
                    )
                )
            ).one()
        return row[0], row[1]

    state_b, nonce_b = asyncio.run(_second_state())
    id_token_b = make_id_token(rsa_keypair, nonce=nonce_b, sub="user-b")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token_b))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(
            200, json=_userinfo_payload() | {"sub": "user-b"}
        )
    )
    resp_b = client.get(
        f"/api/auth/callback?code=c&state={state_b}", follow_redirects=False
    )
    cookie_b = _extract_session_cookie(resp_b)

    assert cookie_a and cookie_b and cookie_a != cookie_b

    async def _row_count() -> int:
        async with engine.connect() as conn:
            return (
                await conn.execute(text("SELECT COUNT(*) FROM sessions"))
            ).scalar_one()

    assert asyncio.run(_row_count()) == 2


def test_state_single_use_at_route_layer(
    client: TestClient, mock_mentee, rsa_keypair: dict
) -> None:
    client.get("/api/auth/login", follow_redirects=False)
    state, nonce = _get_state_from_db()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    first = client.get(
        f"/api/auth/callback?code=c&state={state}", follow_redirects=False
    )
    assert first.status_code == 302 and first.headers["location"].endswith("/chat")

    second = client.get(
        f"/api/auth/callback?code=c&state={state}", follow_redirects=False
    )
    assert second.status_code == 302
    assert second.headers["location"].endswith("/auth/error?reason=oauth")


def test_state_expired_rejected(
    client: TestClient, mock_mentee, rsa_keypair: dict
) -> None:
    client.get("/api/auth/login", follow_redirects=False)
    state, _nonce = _get_state_from_db()

    import asyncio

    async def _age_state() -> None:
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE oauth_state SET expires_at = :past WHERE state = :s"),
                {"past": datetime.now(UTC) - timedelta(hours=1), "s": state},
            )

    asyncio.run(_age_state())

    # Even with a valid code/state, expired state is rejected as StateMismatch.
    id_token = make_id_token(rsa_keypair, nonce="whatever")
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    resp = client.get(
        f"/api/auth/callback?code=c&state={state}", follow_redirects=False
    )
    assert resp.headers["location"].endswith("/auth/error?reason=oauth")


def _extract_session_cookie(resp: httpx.Response) -> str:
    header = resp.headers.get("set-cookie", "")
    for part in header.split(","):
        stripped = part.strip()
        if stripped.startswith(f"{settings.session_cookie_name}="):
            return stripped.split("=", 1)[1].split(";")[0]
    return ""
