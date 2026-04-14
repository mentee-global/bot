# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mentee Bot for the **menteeglobal.org** platform. Its purpose is to guide platform mentees toward educational and scholarship opportunities and to support them through their learning journey.

## Repository Layout

The workspace is split into two independent projects — there is no root-level git, package manager, or build orchestrator. `cd` into the relevant subproject before running any commands.

- `backend/` — FastAPI service. See `backend/CLAUDE.md`.
- `frontend/` — React + TanStack Start app. See `frontend/CLAUDE.md` (which also pulls in `frontend/AGENTS.md` for the TanStack skill-mapping table).
