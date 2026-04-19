"""Unit tests for AuthService.

These hit the real Railway Postgres (per user's call: one DB for dev + tests
+ prod, cleaned after). Each test TRUNCATEs sessions + oauth_state via the
`clean_db` fixture. External HTTP calls to Mentee are mocked via respx.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from sqlalchemy import text

from app.auth.crypto import decrypt
from app.auth.errors import (
    AuthError,
    RefreshUnsupportedError,
    StateMismatchError,
)
from app.auth.service import AuthService
from app.db.engine import engine

from .conftest import make_id_token


def _token_endpoint_response(id_token: str) -> dict:
    return {
        "access_token": "at-1",
        "refresh_token": "rt-1",
        "id_token": id_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "openid email profile mentee.role",
    }


def _userinfo_payload() -> dict:
    return {
        "sub": "user-123",
        "email": "u@example.com",
        "email_verified": True,
        "name": "Demo Mentee",
        "picture": "https://cdn.example/u.jpg",
        "preferred_language": "en-US",
        "timezone": "America/New_York",
        "role": "mentee",
        "role_id": 2,
    }


async def test_start_login_persists_state_and_returns_authorize_url(
    auth_service: AuthService,
) -> None:
    url = await auth_service.start_login(redirect_to="/chat")
    assert "code_challenge_method=S256" in url
    assert "state=" in url and "nonce=" in url
    async with engine.connect() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM oauth_state"))).scalar_one()
    assert count == 1


async def test_complete_login_creates_session_row_and_returns_user(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    authorize_url = await auth_service.start_login()
    # Pull state out so we can replay a fake callback.
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                text("SELECT state, nonce, code_verifier FROM oauth_state")
            )
        ).one()
    state, nonce, _verifier = row

    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )

    user, session_id = await auth_service.complete_login(code="the-code", state=state)
    assert user.role == "mentee"
    assert user.email == "u@example.com"
    assert user.preferred_language == "en-US"
    assert len(session_id) > 20

    async with engine.connect() as conn:
        sessions_count = (
            await conn.execute(text("SELECT COUNT(*) FROM sessions"))
        ).scalar_one()
        state_count = (
            await conn.execute(text("SELECT COUNT(*) FROM oauth_state"))
        ).scalar_one()
    assert sessions_count == 1
    assert state_count == 0, "state row must be consumed (single-use)"

    # Tokens must be encrypted at rest — the raw column must not contain 'at-1'.
    async with engine.connect() as conn:
        enc = (
            await conn.execute(text("SELECT access_token_enc FROM sessions"))
        ).scalar_one()
    assert b"at-1" not in enc
    assert decrypt(enc) == "at-1"
    assert authorize_url  # keep pyflakes happy


async def test_state_is_single_use(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()

    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )

    await auth_service.complete_login(code="c", state=state)
    with pytest.raises(StateMismatchError):
        await auth_service.complete_login(code="c", state=state)


async def test_unknown_state_raises(auth_service: AuthService) -> None:
    with pytest.raises(StateMismatchError):
        await auth_service.complete_login(code="c", state="never-stored")


async def test_current_user_unknown_session_raises(
    auth_service: AuthService,
) -> None:
    with pytest.raises(AuthError):
        await auth_service.current_user("no-such-session")


async def test_current_user_triggers_refresh_when_near_expiry(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    # Seed a session.
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    _, session_id = await auth_service.complete_login(code="c", state=state)

    # Force the access token to be expired.
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE sessions SET access_token_expires_at = :past "
                "WHERE session_id = :sid"
            ),
            {"past": datetime.now(UTC) - timedelta(minutes=5), "sid": session_id},
        )

    # Re-mock with fresh tokens.
    refreshed_userinfo = _userinfo_payload() | {"name": "Updated Name"}
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
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=refreshed_userinfo)
    )

    user = await auth_service.current_user(session_id)
    assert user.name == "Updated Name", "userinfo is refetched after refresh"

    async with engine.connect() as conn:
        enc = (
            await conn.execute(
                text("SELECT access_token_enc FROM sessions WHERE session_id = :sid"),
                {"sid": session_id},
            )
        ).scalar_one()
    assert decrypt(enc) == "at-2"


async def test_current_user_refresh_unsupported_deletes_session_and_logs_info(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Seed a session, force expired, then mock unsupported_grant_type.
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    _, session_id = await auth_service.complete_login(code="c", state=state)

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE sessions SET access_token_expires_at = :past "
                "WHERE session_id = :sid"
            ),
            {"past": datetime.now(UTC) - timedelta(minutes=5), "sid": session_id},
        )

    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(400, json={"error": "unsupported_grant_type"})
    )

    caplog.set_level(logging.INFO, logger="app.auth.service")
    with pytest.raises(RefreshUnsupportedError):
        await auth_service.current_user(session_id)

    async with engine.connect() as conn:
        count = (
            await conn.execute(
                text("SELECT COUNT(*) FROM sessions WHERE session_id = :sid"),
                {"sid": session_id},
            )
        ).scalar_one()
    assert count == 0, "session row must be deleted on refresh gap"

    info_lines = [
        r for r in caplog.records
        if r.name == "app.auth.service" and r.levelno == logging.INFO
    ]
    warning_lines = [
        r for r in caplog.records
        if r.name == "app.auth.service" and r.levelno >= logging.WARNING
    ]
    assert any("refresh grant unsupported" in r.getMessage() for r in info_lines)
    assert not warning_lines, (
        "refresh-gap is not a bug; must never log WARNING/ERROR"
    )


async def test_current_user_userinfo_fail_after_successful_refresh_keeps_session(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    _, session_id = await auth_service.complete_login(code="c", state=state)

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE sessions SET access_token_expires_at = :past "
                "WHERE session_id = :sid"
            ),
            {"past": datetime.now(UTC) - timedelta(minutes=5), "sid": session_id},
        )

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
    # userinfo fails after refresh — we keep the session.
    mock_mentee.get("/oauth/userinfo").mock(return_value=httpx.Response(500))

    user = await auth_service.current_user(session_id)
    assert user.email == "u@example.com", "stale profile retained after userinfo fail"


async def test_logout_deletes_session_and_attempts_revoke(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    _, session_id = await auth_service.complete_login(code="c", state=state)

    revoke_route = mock_mentee.post("/oauth/revoke").mock(
        return_value=httpx.Response(200)
    )

    await auth_service.logout(session_id)

    assert revoke_route.called
    async with engine.connect() as conn:
        count = (
            await conn.execute(
                text("SELECT COUNT(*) FROM sessions WHERE session_id = :sid"),
                {"sid": session_id},
            )
        ).scalar_one()
    assert count == 0


async def test_logout_survives_revoke_failure(
    auth_service: AuthService,
    mock_mentee: respx.MockRouter,
    rsa_keypair: dict,
) -> None:
    await auth_service.start_login()
    async with engine.connect() as conn:
        state, nonce = (
            await conn.execute(text("SELECT state, nonce FROM oauth_state"))
        ).one()
    id_token = make_id_token(rsa_keypair, nonce=nonce)
    mock_mentee.post("/oauth/token").mock(
        return_value=httpx.Response(200, json=_token_endpoint_response(id_token))
    )
    mock_mentee.get("/oauth/userinfo").mock(
        return_value=httpx.Response(200, json=_userinfo_payload())
    )
    _, session_id = await auth_service.complete_login(code="c", state=state)

    mock_mentee.post("/oauth/revoke").mock(return_value=httpx.Response(500))

    # Must not raise — best-effort.
    await auth_service.logout(session_id)

    async with engine.connect() as conn:
        count = (
            await conn.execute(
                text("SELECT COUNT(*) FROM sessions WHERE session_id = :sid"),
                {"sid": session_id},
            )
        ).scalar_one()
    assert count == 0
