# syntax=docker/dockerfile:1.7
# Railway picks this Dockerfile up automatically when present and skips
# Nixpacks/Railpack auto-detection. Two-stage: install deps with the
# official uv image (a single image pull, no cache.nixos.org round-trip),
# then copy the resulting venv into a slim runtime image.

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build
WORKDIR /app

# UV_LINK_MODE=copy: cache and target live on different filesystems on
# Railway builders, so hardlinking warns and falls back anyway.
# UV_COMPILE_BYTECODE=1: ship .pyc next to .py so first-request import
# isn't paying the compile cost.
# UV_PYTHON_DOWNLOADS=never: use the Python that's already in the image.
# UV_PROJECT_ENVIRONMENT: install into /opt/venv so the runtime stage can
# COPY one well-known directory.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

# Resolve and install deps before copying source so editing app code
# doesn't bust this layer. --no-install-project because pyproject.toml
# has no [build-system] (we manage a venv, not a publishable package).
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY alembic.ini ./
COPY app ./app


FROM python:3.13-slim-bookworm AS runtime
WORKDIR /app

RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --create-home app

COPY --from=build --chown=app:app /opt/venv /opt/venv
COPY --from=build --chown=app:app /app /app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER app

# Railway injects PORT at runtime; default for plain `docker run`.
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
