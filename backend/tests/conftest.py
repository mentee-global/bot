"""Top-level test fixtures.

Pulls in the RSA keypair / Mentee mocks from tests/auth/conftest.py so chat
tests can boot the FastAPI lifespan (which calls init_auth → load_metadata)
against the same mocked discovery doc.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.deps as deps_module
from app.agents.mock.agent import MockAgent
from app.auth.crypto import encrypt
from app.auth.db_models import SessionRecord
from app.core.config import settings
from app.db.engine import async_session_factory, engine
from app.main import app
from app.services.message_service import MessageService
from app.services.thread_store import ThreadStore
from tests.auth.conftest import (  # noqa: F401 — re-exported fixtures
    fake_settings,
    mock_mentee,
    rsa_keypair,
)

SEED_SESSION_ID = "test-session-id-1234567890"
SEED_USER = {
    "sub": "mock-user-1",
    "email": "mentee@menteeglobal.org",
    "name": "Demo Mentee",
    "role": "mentee",
    "role_id": 2,
    "picture": None,
    "preferred_language": "en-US",
    "timezone": "UTC",
}


async def _truncate_auth_tables() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE sessions, oauth_state"))


async def _seed_session(session_id: str, user: dict[str, Any]) -> None:
    now = datetime.now(UTC)
    row = SessionRecord(
        session_id=session_id,
        mentee_sub=user["sub"],
        email=user["email"],
        name=user["name"],
        role=user["role"],
        role_id=user["role_id"],
        picture=user.get("picture"),
        preferred_language=user.get("preferred_language"),
        timezone=user.get("timezone"),
        access_token_enc=encrypt("fake-access-token"),
        access_token_expires_at=now + timedelta(hours=1),
        refresh_token_enc=encrypt("fake-refresh-token"),
        id_token_nonce="fake-nonce",
        created_at=now,
        last_used_at=now,
    )
    async with async_session_factory() as session:
        session.add(row)
        await session.commit()


@pytest.fixture
def client(
    monkeypatch: pytest.MonkeyPatch,
    mock_mentee,  # noqa: F811 — respx mock must be live for lifespan init_auth
) -> Iterator[TestClient]:
    """TestClient with a fresh in-memory chat service per test.

    The FastAPI lifespan triggers `init_auth()` which calls the real Mentee
    discovery URL — respx intercepts it via the `mock_mentee` fixture.
    """
    fresh_store = ThreadStore()
    fresh_agent = MockAgent()
    fresh_service = MessageService(store=fresh_store, agent=fresh_agent)
    monkeypatch.setattr(deps_module, "_service", fresh_service)

    # Reset the auth singleton so each test gets a fresh load_metadata call
    # against the mocked provider.
    monkeypatch.setattr(deps_module, "_auth_service", None)

    import asyncio

    asyncio.run(_truncate_auth_tables())

    with TestClient(app) as c:
        yield c


@pytest.fixture
def authed_client(
    client: TestClient, mock_mentee  # noqa: F811
) -> TestClient:
    """TestClient with a seeded DB session row + cookie already set.

    Bypasses the OAuth redirect chain for chat/me/logout tests.
    """
    import asyncio

    asyncio.run(_seed_session(SEED_SESSION_ID, SEED_USER))
    # Mock revoke so logout tests don't try to hit a real Mentee.
    mock_mentee.post("/oauth/revoke").mock(
        return_value=_mock_response(200)
    )
    client.cookies.set(settings.session_cookie_name, SEED_SESSION_ID)
    return client


def _mock_response(status_code: int):
    import httpx

    return httpx.Response(status_code)
