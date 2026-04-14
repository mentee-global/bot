# Backend

FastAPI service for the Mentee bot. Sister project: `../frontend` (TanStack Start, React 19).

## Stack

- Python 3.14 (`.venv/`)
- FastAPI 0.135 + Uvicorn 0.44
- Pydantic 2.13 (+ `pydantic-settings`, `pydantic-extra-types`)
- httpx 0.28

No dependency manifest exists yet (no `pyproject.toml` / `requirements.txt`). Packages live only in `.venv/`. When adding deps, introduce a manifest first — don't rely on the venv as the source of truth.

## Running

```bash
.venv/bin/uvicorn main:app --reload
```

## Library Agent Skills

FastAPI ships an official agent skill bundled with the package (see [https://tiangolo.com/ideas/library-agent-skills/](https://tiangolo.com/ideas/library-agent-skills/)). Read and follow it when writing or refactoring FastAPI / Pydantic code so conventions stay aligned with the library author's recommendations:

- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/SKILL.md` — main skill (CLI, app structure, routers, dependencies, Pydantic patterns)
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/dependencies.md` — dependency injection patterns
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/streaming.md` — streaming responses
- `.venv/lib/python3.14/site-packages/fastapi/.agents/skills/fastapi/references/other-tools.md` — companion tooling

Re-read the skill after upgrading FastAPI, since it is versioned with the installed package.

## Layout

- `main.py` — app entrypoint (currently a hello-world stub)

The project is in its initial scaffolding phase; structure (routers, models, settings, db) has not been chosen yet. Confirm conventions with the user before introducing them.