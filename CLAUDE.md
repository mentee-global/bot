# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mentee Bot for the **menteeglobal.org** platform. Its purpose is to guide platform mentees toward educational and scholarship opportunities and to support them through their learning journey.

## Repository Layout

The workspace is split into two independent projects — there is no root-level git, package manager, or build orchestrator. `cd` into the relevant subproject before running any commands.

- `backend/` — FastAPI service (Python 3.14, uv). See `backend/CLAUDE.md`.
- `frontend/` — React + TanStack Start app. See `frontend/CLAUDE.md` (also contains the TanStack skill-mapping table).

## Cross-cutting Architecture

- **Auth**: stub OAuth on the backend (`/api/auth/login` → `{frontend_url}/auth/callback?code=…` → sets an HttpOnly `mentee_session` cookie). The real MenteeGlobal OAuth will replace the callback body only — the frontend contract is stable.
- **Transport**: frontend uses `fetch` with `credentials: 'include'`; backend CORS allows `allow_credentials=True` against `cors_origins` (defaults to `http://localhost:3000`).
- **Agent**: `MockAgent` behind the `AgentPort` interface; swap for OpenAI / Perplexity / pydantic-ai without touching routes or services.
- **Dev ports**: backend on `:8001`, frontend on `:3001` (moved off `:8000`/`:3000` so the Mentee provider can keep those locally). Frontend points at the backend via `VITE_API_URL`.
