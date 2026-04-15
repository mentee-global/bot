from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.api.deps as deps_module
from app.agents.mock.agent import MockAgent
from app.main import app
from app.services.message_service import MessageService
from app.services.thread_store import ThreadStore


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """TestClient with fresh in-memory store and sessions per test."""
    fresh_store = ThreadStore()
    fresh_agent = MockAgent()
    fresh_service = MessageService(store=fresh_store, agent=fresh_agent)
    fresh_sessions: dict[str, dict[str, str]] = {}

    monkeypatch.setattr(deps_module, "_service", fresh_service)
    monkeypatch.setattr(deps_module, "_sessions", fresh_sessions)

    with TestClient(app) as c:
        yield c


@pytest.fixture
def authed_client(client: TestClient) -> TestClient:
    """Client with a stub session cookie set via the login callback."""
    response = client.get("/api/auth/callback", params={"code": "mock"})
    assert response.status_code == 200
    return client
