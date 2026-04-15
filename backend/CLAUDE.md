# Backend

FastAPI service for the Mentee bot. Sister project: `../frontend` (TanStack Start, React 19).

## Stack

- Python 3.14 (`.venv/`, managed by [uv](https://docs.astral.sh/uv/))
- FastAPI 0.135 + Uvicorn 0.44
- Pydantic 2.13 + `pydantic-settings`
- httpx 0.28
- pytest + pytest-asyncio + ruff (dev)

Dependencies are declared in `pyproject.toml` and locked in `uv.lock`. Use `uv add <pkg>` / `uv sync` — don't `pip install` into the venv.

## Running

```bash
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check .
```

## Architecture

Hexagonal-lite: the service layer talks to abstract ports, so implementations swap without touching routes.

- `app/agents/base.py::AgentPort` — swap `MockAgent` for OpenAI / pydantic-ai / Perplexity.
- `app/services/thread_store.py::ThreadStore` — swap in-memory for Postgres / Mongo.
- `app/api/routes/auth.py` — stub OAuth; real MenteeGlobal flow will replace the callback body only.
- `app/api/deps.py` — process-wide singletons for store / agent / service / sessions, plus `require_session` / `optional_session` cookie dependencies. Tests swap `_service` and `_sessions` via `monkeypatch` in `tests/conftest.py` to get isolation per test.

Session auth uses an HttpOnly `mentee_session` cookie (`SESSION_COOKIE`) set by `GET /api/auth/callback`. Route handlers take `Annotated[str, Depends(require_session)]` to gate access.

See `README.md` for the full layout.

## Library Agent Skills

FastAPI ships an official agent skill bundled with the package (see [https://tiangolo.com/ideas/library-agent-skills/](https://tiangolo.com/ideas/library-agent-skills/)). Read and follow it when writing or refactoring FastAPI / Pydantic code:

- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/SKILL.md` — main skill (CLI, app structure, routers, dependencies, Pydantic patterns)
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/dependencies.md` — dependency injection patterns
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/streaming.md` — streaming responses
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/other-tools.md` — companion tooling

Re-read the skill after upgrading FastAPI, since it is versioned with the installed package.

## Conventions

- All request / response bodies are Pydantic `BaseModel`s under `app/domain/` or defined locally in the route module.
- Routers mount under `/api/<resource>` (except `/health`).
- Dependencies injected via `Annotated[..., Depends(...)]` — see `app/api/routes/chat.py`.
- Tests live in `tests/`, mirror the `app/` tree, use the `client` / `authed_client` fixtures from `conftest.py` (monkeypatches the in-memory store per test).
