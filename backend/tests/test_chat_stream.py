import json

from fastapi.testclient import TestClient


def _parse_sse(raw: str) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    event: str | None = None
    for line in raw.splitlines():
        if line.startswith("event: "):
            event = line[len("event: ") :]
        elif line.startswith("data: ") and event is not None:
            events.append((event, line[len("data: ") :]))
            event = None
    return events


def test_stream_requires_session(client: TestClient) -> None:
    r = client.post("/api/chat/messages/stream", json={"body": "hi"})
    assert r.status_code == 401


def test_stream_emits_meta_token_done(authed_client: TestClient) -> None:
    # The default fixture uses MockAgent, whose AgentPort base yields a single
    # chunk. We just need to verify the SSE framing and that the thread
    # persisted the assistant message afterward.
    r = authed_client.post(
        "/api/chat/messages/stream",
        json={"body": "Hello"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(r.text)
    kinds = [e for e, _ in events]
    assert kinds[0] == "meta"
    assert kinds[-1] == "done"
    assert "token" in kinds

    meta = json.loads(events[0][1])
    assert meta["thread_id"]
    assert meta["user_message_id"]
    assert meta["assistant_message_id"]

    done = json.loads(events[-1][1])
    assert done["assistant_message_id"] == meta["assistant_message_id"]
    assert done["body"]

    # Thread fetch should include the persisted user + assistant messages.
    thread = authed_client.get("/api/chat/thread").json()
    roles = [m["role"] for m in thread["messages"]]
    assert roles == ["user", "assistant"]
    assert thread["messages"][1]["id"] == meta["assistant_message_id"]
