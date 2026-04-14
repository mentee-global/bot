# Backend

FastAPI service for the Mentee bot.

## Stack

- Python 3.14
- FastAPI 0.135 + Uvicorn 0.44
- Pydantic 2.13

## Setup

```bash
python3.14 -m venv .venv
source .venv/bin/activate
# Dependency manifest is pending — install packages manually for now:
pip install fastapi uvicorn pydantic pydantic-settings pydantic-extra-types httpx
```

## Running

```bash
.venv/bin/uvicorn main:app --reload
```

The app will be available at http://localhost:8000.

## Layout

- `main.py` — app entrypoint

Structure (routers, models, settings, db) is still being defined.
