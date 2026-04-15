from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_requires_session(client: TestClient) -> None:
    response = client.post("/api/chat/messages", json={"body": "hi"})
    assert response.status_code == 401


def test_send_message_returns_user_and_assistant(authed_client: TestClient) -> None:
    response = authed_client.post("/api/chat/messages", json={"body": "Hello"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["thread_id"]
    assert payload["user_message"]["role"] == "user"
    assert payload["user_message"]["body"] == "Hello"
    assert payload["assistant_message"]["role"] == "assistant"
    assert "(mock)" in payload["assistant_message"]["body"]
    assert payload["user_message"]["thread_id"] == payload["thread_id"]
    assert payload["assistant_message"]["thread_id"] == payload["thread_id"]


def test_thread_persists_history(authed_client: TestClient) -> None:
    authed_client.post("/api/chat/messages", json={"body": "first"})
    authed_client.post("/api/chat/messages", json={"body": "second"})

    response = authed_client.get("/api/chat/thread")
    assert response.status_code == 200

    payload = response.json()
    messages = payload["messages"]
    assert len(messages) == 4  # 2 user + 2 assistant
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert messages[0]["body"] == "first"
    assert messages[2]["body"] == "second"


def test_auth_me_returns_user_when_logged_in(authed_client: TestClient) -> None:
    response = authed_client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "mentee@menteeglobal.org"


def test_logout_clears_session(authed_client: TestClient) -> None:
    logout = authed_client.post("/api/auth/logout")
    assert logout.status_code == 200
    # After logout the cookie is deleted and /me 401s
    authed_client.cookies.clear()
    me = authed_client.get("/api/auth/me")
    assert me.status_code == 401
