# Backend

FastAPI service for the Mentee bot.

## Stack

- Python 3.14
- FastAPI 0.135 + Uvicorn 0.44
- Pydantic 2.13 + `pydantic-settings`
- Managed with [uv](https://docs.astral.sh/uv/)

## Setup

```bash
uv sync
cp .env.example .env   # tweak if needed
```

## Running

```bash
uv run uvicorn app.main:app --reload --port 8000
```

The app will be available at http://localhost:8000. Interactive docs at `/docs`.

## Testing

```bash
uv run pytest
uv run ruff check .
```

## Layout

```
app/
├── main.py              # FastAPI app, CORS, router wiring
├── core/config.py       # Settings (pydantic-settings)
├── domain/              # Message, Thread, User, MessageRole
├── agents/
│   ├── base.py          # AgentPort abstract interface
│   └── mock/agent.py    # MockAgent (deterministic replies, no LLM)
├── services/
│   ├── thread_store.py  # In-memory store (swap later for DB)
│   └── message_service.py  # Orchestrates user msg → agent → assistant msg
└── api/
    ├── deps.py          # Session + service injection helpers
    └── routes/
        ├── chat.py      # POST /api/chat/messages, GET /api/chat/thread
        ├── auth.py      # Stub OAuth: /login, /callback, /me, /logout
        └── health.py    # GET /health
```

## Extension seams

- Replace `MockAgent` with pydantic-ai / OpenAI / Perplexity — implement `AgentPort`, swap in `app/api/deps.py`.
- Replace `ThreadStore` with Postgres / Mongo — keep the same method signatures.
- Replace stub auth in `app/api/routes/auth.py` with real MenteeGlobal OAuth — frontend contract stays identical.
