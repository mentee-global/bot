# OAuth Backend Implementation Plan — Mentee Bot (FastAPI)

> **Audience**: the coding agent implementing the Bot-side OAuth client.
> **Repo**: `/Users/odzen/Job/Mentee/bot/backend` (FastAPI 0.135+, Python 3.14, uv).
> **Prereq**: read [`00-oauth-overview.md`](./00-oauth-overview.md) first — all design decisions and the **current Mentee provider status (§2.5)** and **client registration curl (§2.6)** are locked there.
> **Counterpart**: `/Users/odzen/Job/Mentee/mentee/docs/oauth/01-oauth-backend-plan.md` (the provider). Contracts in §8 and §11 here MUST match the provider's `/oauth/userinfo` response.
> **Deferred work**: [`deferred/01-backend-plan.md`](./deferred/01-backend-plan.md).
>
> **⚠ Refresh-grant gap** — Mentee's `grant_type=refresh_token` is NOT wired today (overview §2.5). The Bot must implement the refresh code path but degrade gracefully until Mentee ships it. See §9.1 below; this is the single biggest deviation between the plan and what runs against a live Mentee today.

---

## 1. Scope

Replace the stub implementations in:

- `backend/app/api/routes/auth.py` — `/api/auth/login`, `/api/auth/callback`, `/api/auth/me`, `/api/auth/logout`
- `backend/app/api/deps.py` — `_sessions` dict, `require_session`, `optional_session`
- `backend/app/domain/models.py` — extend `User`
- `backend/app/core/config.py` — OAuth + session settings

…with a real OAuth 2.1 / OIDC authorization-code + PKCE client that talks to the Mentee provider. Chat routes (`backend/app/api/routes/chat.py`) continue to work unchanged — they consume `session_id: str` via `require_session` and don't care about the internals.

**Stack:** FastAPI · SQLModel · Alembic · asyncpg · Postgres · Authlib (client role) · cryptography (Fernet).

---

## 1.5 Pre-flight — register the Bot in Mentee

**Blocker**: the Bot cannot complete login until a matching `oauth_clients` row exists. Do this **once per environment** before writing any Bot code, using the curl in `00-oauth-overview.md` §2.6. Cache the plaintext `client_secret` returned by the `POST` — Mentee stores only the bcrypt hash; if you lose it, rotate with `POST /api/admin/oauth-clients/<id>/rotate-secret`.

**Required env vars before `uv run uvicorn` will start** (§4):
- `MENTEE_OAUTH_CLIENT_ID=mentee-bot-local` (prod: `mentee-bot`)
- `MENTEE_OAUTH_CLIENT_SECRET=<plaintext secret from registration response>`
- `MENTEE_OAUTH_REDIRECT_URI=http://localhost:8001/api/auth/callback` (prod: `https://bot.menteeglobal.org/api/auth/callback`)
- `MENTEE_OAUTH_ISSUER=http://localhost:8000` (prod: `https://app.menteeglobal.org`)
- `SESSION_SECRET=<generated Fernet key>` — `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

**Smoke-test the registration** before touching Bot code:

```bash
# Should return the discovery doc with scopes_supported including "mentee.role".
curl -s http://localhost:8000/.well-known/openid-configuration | jq '.scopes_supported'

# Should 400 with {"error":"invalid_client"} — proves client_id lookup works.
curl -s "http://localhost:8000/oauth/authorize?response_type=code&client_id=does-not-exist&redirect_uri=http://x/&scope=openid&state=s&code_challenge=c&code_challenge_method=S256"

# Should 302 to the Mentee frontend's Firebase login (if you are NOT logged in to Mentee),
# or to the Bot callback with ?code=... (if you ARE logged in, because is_first_party=true skips consent).
curl -s -o /dev/null -w '%{http_code}\n%{redirect_url}\n' -c /tmp/mentee-cookies.txt \
  "http://localhost:8000/oauth/authorize?response_type=code&client_id=mentee-bot-local&redirect_uri=http://localhost:8001/api/auth/callback&scope=openid%20email%20profile%20mentee.role&state=test&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
```

Only proceed to §2 once the above behaves correctly. If it doesn't, fix the registration — do not paper over it in Bot code.

---

## 2. Pre-flight — port move

Before any OAuth code lands, move the Bot off the ports that collide with Mentee.

### Tasks

1. **`backend/app/core/config.py`**: default `frontend_url=http://localhost:3001`, `cors_origins=["http://localhost:3001"]`.
2. **`backend/.env.example`**: update defaults; add the full env var block from §4.
3. **`backend/README.md`**: dev run command `uv run uvicorn app.main:app --reload --port 8001`.
4. **`backend/CLAUDE.md`**: update port reference.
5. **Root `CLAUDE.md`**: "Dev ports" line → `backend on :8001, frontend on :3001`.
6. Verify existing chat tests (`uv run pytest`) still pass — TestClient doesn't care about ports.

### Acceptance
- `uv run uvicorn app.main:app --reload --port 8001` starts cleanly.
- `curl http://localhost:8001/health` returns 200.

---

## 3. Dependencies

Update `backend/pyproject.toml`:

```toml
[project]
dependencies = [
    # ...existing...
    "httpx>=0.28",                  # already present — verify
    "authlib>=1.6,<1.7",            # OAuth client + JWT + JWKS handling
    "cryptography>=43.0",           # Fernet for token-at-rest encryption
    "sqlmodel>=0.0.22",             # ORM (wraps SQLAlchemy 2.0)
    "sqlalchemy>=2.0",              # pinned for async + Alembic
    "asyncpg>=0.30",                # Postgres driver for SQLAlchemy
    "alembic>=1.14",                # migrations
    "psycopg2-binary>=2.9; python_version < '4'",  # used by Alembic's sync migration runner
]
```

Install: `uv lock && uv sync`.

**Why each**:

- **SQLModel** — Pydantic-style ORM on top of SQLAlchemy 2.0. Matches the codebase's Pydantic-everywhere style. One class = DB table + Pydantic model.
- **asyncpg** — fastest Postgres driver for Python; SQLAlchemy speaks to it via `postgresql+asyncpg://`.
- **Alembic** — schema migrations. Generates from SQLModel metadata.
- **Authlib** — id_token JWT verification + JWKS caching + the `AsyncOAuth2Client` for code/refresh exchange.
- **cryptography** — Fernet symmetric encryption for access/refresh tokens at rest.

---

## 4. Configuration — `app/core/config.py`

```python
from pydantic import AnyHttpUrl, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Environment
    environment: str = "local"
    frontend_url: AnyHttpUrl = AnyHttpUrl("http://localhost:3001")
    cors_origins: list[AnyHttpUrl] = [AnyHttpUrl("http://localhost:3001")]

    # OAuth client registration (issued by Mentee)
    mentee_oauth_issuer: AnyHttpUrl = AnyHttpUrl("http://localhost:8000")
    mentee_oauth_client_id: str = "mentee-bot-local"
    mentee_oauth_client_secret: SecretStr
    mentee_oauth_redirect_uri: AnyHttpUrl = AnyHttpUrl("http://localhost:8001/api/auth/callback")
    mentee_oauth_scopes: str = "openid email profile mentee.role"

    # Database — Postgres everywhere
    database_url: str = "postgresql+asyncpg://bot:bot@localhost:5432/bot_dev"

    # Session encryption + cookie
    session_secret: SecretStr                        # Fernet key: base64 url-safe 32 bytes
    session_cookie_name: str = "mentee_session"
    session_cookie_secure: bool = False              # prod: true
    session_cookie_samesite: str = "lax"
    session_max_age_seconds: int = 60 * 60 * 24 * 7  # 7 days

    # OAuth transient state
    oauth_state_ttl_seconds: int = 600

    @property
    def is_prod(self) -> bool:
        return self.environment == "production"

settings = Settings()
```

### Acceptance
- Missing `MENTEE_OAUTH_CLIENT_SECRET` or `SESSION_SECRET` raises at startup with a Pydantic error.
- `python -c "from app.core.config import settings; print(settings.database_url)"` prints the URL.

---

## 5. Domain models

### 5.1 Extend `User` in `app/domain/models.py`

```python
from pydantic import BaseModel, EmailStr, HttpUrl

class User(BaseModel):
    id: str                                   # mentee_sub from id_token
    email: EmailStr
    name: str
    role: str                                 # "mentee" | "mentor" | ...
    role_id: int
    picture: HttpUrl | None = None
    preferred_language: str | None = None
    timezone: str | None = None
```

Update every construction site (`rg "User\("` in `backend/`) to pass the new fields.

### 5.2 SQLModel tables — `app/auth/db_models.py` (new)

```python
from datetime import datetime
from sqlmodel import SQLModel, Field

class SessionRecord(SQLModel, table=True):
    __tablename__ = "sessions"

    session_id: str = Field(primary_key=True, max_length=64)
    mentee_sub: str = Field(index=True, max_length=64)
    email: str
    name: str
    role: str = Field(max_length=32)
    role_id: int
    picture: str | None = None
    preferred_language: str | None = Field(default=None, max_length=16)
    timezone: str | None = Field(default=None, max_length=64)
    access_token_enc: bytes
    access_token_expires_at: datetime
    refresh_token_enc: bytes | None = None
    id_token_nonce: str = Field(max_length=64)
    created_at: datetime
    last_used_at: datetime


class OAuthStateRecord(SQLModel, table=True):
    __tablename__ = "oauth_state"

    state: str = Field(primary_key=True, max_length=64)
    code_verifier: str = Field(max_length=128)
    nonce: str = Field(max_length=64)
    redirect_to: str | None = Field(default=None, max_length=1024)
    created_at: datetime
    expires_at: datetime = Field(index=True)
```

---

## 6. Package layout

```
backend/app/auth/
├── __init__.py
├── db_models.py       # SQLModel tables
├── oauth_client.py    # Authlib wiring, JWKS cache, token exchange, userinfo, revoke
├── state_store.py     # CRUD on OAuthStateRecord
├── session_store.py   # CRUD on SessionRecord
├── crypto.py          # Fernet encrypt/decrypt helpers
├── service.py         # AuthService: orchestrates start_login / complete_login / refresh / logout
└── errors.py          # Typed exceptions

backend/app/db/
├── __init__.py
├── engine.py          # async engine + session factory (singleton)
└── migrations/        # Alembic (see §7)
```

`app/api/routes/auth.py` becomes a thin HTTP layer over `AuthService`.

---

## 7. Database setup (Postgres + Alembic)

### 7.1 Local dev — Docker Compose

Add `backend/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: bot
      POSTGRES_PASSWORD: bot
      POSTGRES_DB: bot_dev
    ports:
      - "5432:5432"
    volumes:
      - bot_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bot"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  bot_pg_data:
```

One-liner: `docker compose up -d`. `backend/README.md` documents this.

### 7.2 Async engine — `app/db/engine.py`

```python
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
```

### 7.3 Alembic initialization

From `backend/`:
```bash
uv run alembic init -t async app/db/migrations
```

Configure `app/db/migrations/env.py`:

```python
from logging.config import fileConfig
from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool
import asyncio
import sqlmodel  # noqa: F401 — registers type handlers

from app.core.config import settings
from app.auth.db_models import SessionRecord, OAuthStateRecord  # noqa
# future: from app.chat.db_models import ThreadRecord, MessageRecord

target_metadata = SQLModel.metadata

def run_migrations_online():
    config = context.config
    config.set_main_option("sqlalchemy.url", settings.database_url)
    ...  # standard Alembic async template
```

Initial migration:
```bash
uv run alembic revision --autogenerate -m "initial schema"
uv run alembic upgrade head
```

Commit the generated file in `app/db/migrations/versions/`.

### 7.4 Cleanup task — expired state rows

`app/auth/state_store.py::cleanup_expired()` — deletes rows where `expires_at < now()`. Called from a FastAPI background task every 5 min (lightweight in-process loop; no Celery needed).

```python
# app/main.py
@app.on_event("startup")
async def _schedule_cleanup() -> None:
    asyncio.create_task(_cleanup_loop())

async def _cleanup_loop() -> None:
    while True:
        try:
            await state_store.cleanup_expired()
            await session_store.cleanup_expired(max_age=settings.session_max_age_seconds)
        except Exception as e:
            logger.warning("cleanup loop error: %s", e)
        await asyncio.sleep(300)
```

### 7.5 Acceptance
- `docker compose up -d` + `uv run alembic upgrade head` creates both tables.
- `uv run python -c "from sqlmodel import select; ..."` can query them.
- Railway prod setup: `DATABASE_URL` env var points at Railway Postgres; Railway's deploy command runs `alembic upgrade head` before starting the app.

---

## 8. Token encryption — `app/auth/crypto.py`

```python
from cryptography.fernet import Fernet
from app.core.config import settings

def _fernet() -> Fernet:
    return Fernet(settings.session_secret.get_secret_value().encode())

def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())

def decrypt(ciphertext: bytes) -> str:
    return _fernet().decrypt(ciphertext).decode()
```

Generate the Fernet key once per environment:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Paste into `.env` as `SESSION_SECRET=...`.

---

## 9. OAuth client — `app/auth/oauth_client.py`

### Responsibilities

1. Fetch + cache `/.well-known/openid-configuration` at startup; refresh every 24h.
2. Fetch + cache JWKS; refresh on `kid` miss.
3. Build authorize URL with PKCE S256 + state + nonce.
4. Exchange code at `/oauth/token` (HTTP Basic auth).
5. Verify id_token signature + standard claims.
6. Fetch userinfo.
7. Refresh access tokens.
8. Revoke tokens.

### Interface

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str | None
    id_token_claims: dict
    scope: str
    expires_at: datetime

class MenteeOAuthClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None: ...
    async def load_metadata(self) -> None: ...
    async def get_jwks(self) -> JsonWebKeySet: ...

    def build_authorize_url(self, *, state: str, code_challenge: str, nonce: str) -> str: ...
    async def exchange_code(self, *, code: str, code_verifier: str, nonce: str) -> TokenBundle: ...
    async def refresh(self, refresh_token: str) -> TokenBundle: ...
    async def userinfo(self, access_token: str) -> dict: ...
    async def revoke(self, token: str, token_type_hint: str = "refresh_token") -> None: ...
```

### id_token verification rules (CRITICAL)

- `iss` equals `settings.mentee_oauth_issuer` exactly.
- `aud` contains `settings.mentee_oauth_client_id`.
- `exp` in future (60s clock skew tolerance).
- `iat` within last 10 min.
- `nonce` equals the nonce stored with the state.
- Signature verified with JWKS key matching `kid`. If unknown `kid` → refresh JWKS once, retry; still unknown → reject.
- On any failure, raise `InvalidIdTokenError`. NEVER trust an unverified id_token.

### Error taxonomy — `app/auth/errors.py`

```python
class AuthError(Exception): ...
class StateMismatchError(AuthError): ...
class CodeExchangeError(AuthError): ...
class InvalidIdTokenError(AuthError): ...
class RefreshFailedError(AuthError): ...
class RefreshUnsupportedError(RefreshFailedError): ...   # provider returned unsupported_grant_type
class UserinfoFetchError(AuthError): ...
class RevokeFailedError(AuthError): ...
```

---

## 9.1 Handling Mentee's un-wired refresh grant (current state)

Per overview §2.5, `POST /oauth/token` with `grant_type=refresh_token` on the real Mentee today returns an OAuth error response — in practice `{"error":"unsupported_grant_type"}` or `{"error":"invalid_grant"}`, HTTP 400. The Bot MUST treat this as a normal, expected outcome, **not an exception to log at ERROR level**.

### Required behavior

1. **Always attempt the refresh**. Do not feature-flag this based on Mentee version — the Bot discovers capability at runtime via the provider's response.
2. **Map provider errors to a dedicated exception**:

    ```python
    # app/auth/oauth_client.py::refresh
    try:
        token = await self._oauth2_client.refresh_token(
            url=self._metadata["token_endpoint"],
            refresh_token=refresh_token,
        )
    except OAuthError as e:
        if e.error in ("unsupported_grant_type", "invalid_grant"):
            raise RefreshUnsupportedError(e.error) from e
        raise RefreshFailedError(str(e)) from e
    ```

3. **`AuthService._refresh` deletes the session row** on any `RefreshFailedError` (including `RefreshUnsupportedError`) — see §10.
4. **`current_user` → 401** cleanly. The FastAPI route layer translates `AuthError` → `HTTPException(401)`.
5. **Log levels**:
    - `RefreshUnsupportedError` → `logger.info("refresh grant unsupported by provider; session expired")` — one line, no stack trace.
    - `RefreshFailedError` (other causes) → `logger.warning("refresh failed: %s", e)`.
    - No `ERROR` level; this is not a bug.
6. **No retries, no backoff** — the provider has definitively rejected the token. Retrying just burns rate budget (once Mentee enables limits).

### Forward compatibility

When Mentee registers `MenteeRefreshTokenGrant`, the provider will start returning a fresh `{access_token, refresh_token, id_token?, expires_in, scope}` bundle. The Bot's happy-path code in §10 `_refresh` already handles this exact response shape — **no Bot redeploy is needed** to start benefitting from refresh.

### Test obligations (see §14)

- Unit test: `refresh()` returns `RefreshUnsupportedError` when the mock provider responds 400 `unsupported_grant_type`.
- Integration test: `/api/auth/me` with an expired access token and a refresh-unsupported provider → 401, session row gone, log contains one INFO line.
- Integration test (happy path): mock provider replies with a rotated bundle → row updated, 200 with new user data.

---

## 10. Auth service — `app/auth/service.py`

```python
class AuthService:
    def __init__(self, *, oauth, sessions, state, settings): ...

    async def start_login(self, *, redirect_to: str | None = None) -> str:
        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = _s256_challenge(code_verifier)
        nonce = secrets.token_urlsafe(16)
        await self.state.put(state=state, code_verifier=code_verifier, nonce=nonce, redirect_to=redirect_to)
        return self.oauth.build_authorize_url(state=state, code_challenge=code_challenge, nonce=nonce)

    async def complete_login(self, *, code: str, state: str) -> tuple[User, str]:
        state_row = await self.state.pop(state)          # single-use
        if not state_row:
            raise StateMismatchError()
        bundle = await self.oauth.exchange_code(
            code=code, code_verifier=state_row.code_verifier, nonce=state_row.nonce,
        )
        profile = await self.oauth.userinfo(bundle.access_token)
        merged = {**bundle.id_token_claims, **profile}   # userinfo is authoritative
        session_id = secrets.token_urlsafe(32)
        await self.sessions.create(session_id=session_id, claims=merged, bundle=bundle)
        return User(**_claims_to_user(merged)), session_id

    async def current_user(self, session_id: str) -> User:
        row = await self.sessions.get(session_id)
        if not row:
            raise AuthError("Unknown session")
        if row.access_token_expires_at <= _now() + timedelta(seconds=60):
            row = await self._refresh(row)
        return _row_to_user(row)

    async def logout(self, session_id: str) -> None:
        row = await self.sessions.get(session_id)
        if row and row.refresh_token_enc:
            try:
                await self.oauth.revoke(decrypt(row.refresh_token_enc))
            except RevokeFailedError:
                pass                                     # best-effort
        await self.sessions.delete(session_id)

    async def _refresh(self, row: SessionRecord) -> SessionRecord:
        if not row.refresh_token_enc:
            await self.sessions.delete(row.session_id)
            raise RefreshFailedError("No refresh token stored")
        try:
            bundle = await self.oauth.refresh(decrypt(row.refresh_token_enc))
        except RefreshUnsupportedError:
            # Expected while Mentee's refresh grant is un-wired (overview §2.5).
            await self.sessions.delete(row.session_id)
            logger.info("refresh grant unsupported by provider; session %s expired", row.session_id[:8])
            raise
        except RefreshFailedError:
            await self.sessions.delete(row.session_id)   # tokens gone → session gone
            raise
        # Also refetch userinfo so role/name/etc propagate within 1h.
        # If userinfo fails after a successful refresh, keep the session — the refresh worked.
        try:
            profile = await self.oauth.userinfo(bundle.access_token)
        except UserinfoFetchError as e:
            logger.warning("userinfo fetch failed after refresh; keeping cached profile: %s", e)
            profile = None
        await self.sessions.update_tokens_and_profile(row.session_id, bundle=bundle, profile=profile)
        return await self.sessions.get(row.session_id)
```

### Invariants

- `state` is single-use (pop, not get).
- After every successful refresh, userinfo is refetched and profile fields updated on the row.
- `refresh` failure deletes the session (session is gone once tokens are gone).

---

## 11. Routes — `app/api/routes/auth.py` (rewrite)

```python
router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/login")
async def login(
    auth: AuthService = Depends(get_auth_service),
    redirect_to: str | None = None,
) -> RedirectResponse:
    authorize_url = await auth.start_login(redirect_to=redirect_to)
    return RedirectResponse(authorize_url, status_code=302)

@router.get("/callback")
async def callback(
    response: Response,
    auth: AuthService = Depends(get_auth_service),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error:
        # Mentee uses OAuth 2.0 standard error codes: access_denied, login_required, invalid_scope, etc.
        # Pass them through verbatim so the frontend's translateReason() can localize properly.
        reason = error if error in {"access_denied", "login_required", "invalid_scope"} else "oauth"
        return RedirectResponse(
            f"{settings.frontend_url}/auth/error?reason={reason}", status_code=302
        )
    if not code or not state:
        return RedirectResponse(
            f"{settings.frontend_url}/auth/error?reason=missing_params", status_code=302
        )

    try:
        _, session_id = await auth.complete_login(code=code, state=state)
    except StateMismatchError:
        return RedirectResponse(
            f"{settings.frontend_url}/auth/error?reason=oauth", status_code=302
        )
    except (CodeExchangeError, InvalidIdTokenError, UserinfoFetchError) as e:
        logger.warning("OAuth callback failed: %s", e)
        return RedirectResponse(
            f"{settings.frontend_url}/auth/error?reason=oauth", status_code=302
        )

    response = RedirectResponse(f"{settings.frontend_url}/chat", status_code=302)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        max_age=settings.session_max_age_seconds,
        path="/",
    )
    return response

@router.get("/me", response_model=MeResponse)
async def me(
    auth: AuthService = Depends(get_auth_service),
    session_id: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> MeResponse:
    if not session_id:
        raise HTTPException(401, "Not authenticated")
    try:
        user = await auth.current_user(session_id)
    except AuthError:
        raise HTTPException(401, "Not authenticated")
    return MeResponse(user=user)

@router.post("/logout")
async def logout(
    response: Response,
    auth: AuthService = Depends(get_auth_service),
    session_id: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> dict[str, bool]:
    if session_id:
        await auth.logout(session_id)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}
```

### Notable changes vs. stub

- `/callback` redirects to `/chat` instead of returning JSON. The frontend reads `/me` on page load. Eliminates the XHR callback-exchange in the current stub.
- All errors → `/auth/error?reason=...` on the frontend.

---

## 12. Dependencies wiring — `app/api/deps.py`

```python
from app.auth.service import AuthService
from app.auth.session_store import SessionStore
from app.auth.state_store import StateStore
from app.auth.oauth_client import MenteeOAuthClient

_http: httpx.AsyncClient | None = None
_oauth_client: MenteeOAuthClient | None = None
_session_store: SessionStore | None = None
_state_store: StateStore | None = None
_auth_service: AuthService | None = None

async def init_auth() -> None:
    global _http, _oauth_client, _session_store, _state_store, _auth_service
    _http = httpx.AsyncClient(timeout=10.0)
    _oauth_client = MenteeOAuthClient(settings, _http)
    await _oauth_client.load_metadata()
    _session_store = SessionStore()
    _state_store = StateStore()
    _auth_service = AuthService(
        oauth=_oauth_client, sessions=_session_store,
        state=_state_store, settings=settings,
    )

def get_auth_service() -> AuthService:
    assert _auth_service is not None, "Auth not initialized"
    return _auth_service

async def require_session(
    session_id: str | None = Cookie(default=None, alias=settings.session_cookie_name),
    auth: AuthService = Depends(get_auth_service),
) -> str:
    if not session_id:
        raise HTTPException(401, "Not authenticated")
    try:
        await auth.current_user(session_id)              # also refreshes tokens if needed
    except AuthError:
        raise HTTPException(401, "Not authenticated")
    return session_id

async def optional_session(
    session_id: str | None = Cookie(default=None, alias=settings.session_cookie_name),
    auth: AuthService = Depends(get_auth_service),
) -> str | None:
    if not session_id:
        return None
    try:
        await auth.current_user(session_id)
    except AuthError:
        return None
    return session_id
```

In `app/main.py`:
```python
@app.on_event("startup")
async def _startup() -> None:
    await init_auth()
    asyncio.create_task(_cleanup_loop())
```

Existing `chat.py` routes work unchanged — they only consume `session_id: str` via `require_session`.

---

## 13. CORS + cookie settings

`app/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(o).rstrip("/") for o in settings.cors_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)
```

Prod `.env`:
- `CORS_ORIGINS=https://bot.menteeglobal.org`
- `FRONTEND_URL=https://bot.menteeglobal.org`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAMESITE=lax`
- Do NOT set `Domain` on the cookie — keeps it scoped to `bot.menteeglobal.org`.

---

## 14. Tests — `backend/tests/`

Follow the existing TestClient + `monkeypatch` pattern.

### New fixtures

- `fake_mentee_provider` — `respx` mocks for `/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/oauth/token`, `/oauth/userinfo`, `/oauth/revoke`. Signs with a fixture RSA keypair generated in `conftest.py`.
- `test_db` — per-test Postgres schema via SQLModel's `metadata.create_all` against a test database (use `TEST_DATABASE_URL` env var or a throwaway schema). For speed, can use SQLite with `sqlite+aiosqlite:///:memory:` for pure-logic tests, but prefer Postgres for integration.
- `override_oauth_client` — points the Bot at the mock provider's URL.
- `authed_client` — completes a full OAuth flow via the fake provider and yields a TestClient with the session cookie set.

### Test matrix

| File | Name | Assertion |
|---|---|---|
| `tests/auth/test_login.py` | `test_login_redirects_to_mentee` | 302 Location contains PKCE params |
| `tests/auth/test_callback.py` | `test_callback_missing_code_redirects_error` | 302 → `/auth/error` |
| ″ | `test_callback_bad_state_redirects_error` | 302 → `/auth/error?reason=oauth` |
| ″ | `test_callback_tampered_id_token_rejected` | 302 → `/auth/error?reason=oauth` |
| ″ | `test_callback_happy_path_sets_cookie_and_redirects` | 302 → `/chat`; cookie set; session row exists |
| `tests/auth/test_me.py` | `test_me_returns_extended_user` | `role`, `picture`, `preferred_language` present |
| ″ | `test_me_refreshes_expired_token` | Mock provider's refresh endpoint called; row updated (forward-compat: exercises the path that goes live when Mentee registers the grant) |
| ″ | `test_me_refresh_unsupported_by_provider` | Mock `/oauth/token` → 400 `unsupported_grant_type` (today's real Mentee). Expect 401, session row deleted, INFO log exactly once |
| ″ | `test_me_invalid_grant_from_provider` | Mock `/oauth/token` → 400 `invalid_grant`. Same expectation (external revocation looks identical on the wire) |
| ″ | `test_me_userinfo_fails_after_refresh_keeps_session` | Refresh succeeds, userinfo 500s → keep the row with stale profile; no 401 |
| ″ | `test_me_detects_revocation_and_deletes_session` | 401 + session row deleted |
| `tests/auth/test_logout.py` | `test_logout_revokes_and_clears_cookie` | Provider's `/revoke` called; cookie gone; `/me` → 401 |
| `tests/auth/test_sessions.py` | `test_concurrent_sessions_independent` | Two flows → two rows; logout A ≠ logout B |
| `tests/auth/test_crypto.py` | `test_tokens_encrypted_at_rest` | Raw SQL row doesn't contain plaintext token |
| `tests/auth/test_state.py` | `test_state_single_use` | Second callback with same state → 302 /auth/error |
| `tests/auth/test_expiry.py` | `test_state_expired_rejected` | State older than TTL → same |

### Existing chat tests

Swap `authed_client` fixture to use the fake OAuth provider. Chat test bodies unchanged.

### Coverage target

`uv run pytest --cov=app.auth` ≥ 85%.

---

## 15. Observability

- INFO: start of login, success, logout, token refresh success.
- WARNING: state mismatch, invalid id_token, refresh failure, revoke failure.
- ERROR: provider 5xx, JWKS fetch failure.
- NEVER log: access_tokens, refresh_tokens, id_tokens, code, code_verifier, client_secret.
- Correlation id from request middleware.

---

## 16. Security checklist (pre-ship)

- [ ] `mentee_oauth_client_secret` and `session_secret` are `SecretStr` — no repr leaks.
- [ ] State values are `secrets.token_urlsafe(32)`.
- [ ] State is single-use; expired rows cleaned.
- [ ] PKCE `S256`; `plain` never used.
- [ ] `redirect_uri` registered once (env) and matches exactly.
- [ ] id_token signature verified every time.
- [ ] `nonce` checked.
- [ ] Access + refresh tokens encrypted at rest with Fernet.
- [ ] Session cookie: HttpOnly + Secure (prod) + SameSite=Lax.
- [ ] CORS: `allow_credentials=True` paired with explicit origin list (never `*`).
- [ ] Tokens revoked best-effort on logout.
- [ ] Expired sessions reaped every 5 min.
- [ ] `/auth/error` doesn't leak provider response bodies.
- [ ] Rate-limit on `/api/auth/callback` (20 req/min/IP via Starlette middleware or LB). Note: Mentee does not currently enforce rate limits (overview §2.5). Apply at Bot's ingress (Railway / a Starlette middleware) so the Bot is protected regardless.
- [ ] `RefreshUnsupportedError` is classified as INFO, not WARNING/ERROR — grep logs after running `test_me_refresh_unsupported_by_provider` to confirm.
- [ ] On provider-returned `error=access_denied` at the callback, Bot redirects to `/auth/error?reason=access_denied`, not `reason=oauth`.

---

## 17. Rollout order

1. §2 port move + config defaults.
2. §3 deps added.
3. §4 settings class + `.env.example` update.
4. §5 `User` model extension + `rg "User\("` updates.
5. §7 Postgres + Alembic scaffold + initial migration.
6. §6 `app/auth/` package — `db_models`, `crypto`, `state_store`, `session_store` (empty methods first).
7. §9 `oauth_client` + unit tests for id_token verification.
8. §10 `AuthService` + unit tests.
9. §11 routes rewritten.
10. §12 deps wiring + startup hooks.
11. §13 CORS/cookie tightening.
12. §14 full test suite + chat regression tests.
13. §15 logging.
14. §16 security review.

After each step: `uv run pytest && uv run ruff check . && uv run alembic upgrade head` and commit.

---

## 18. Definition of done

- `docker compose up -d && uv run alembic upgrade head && uv run uvicorn app.main:app --reload --port 8001` starts cleanly with no warnings.
- In a browser with Mentee running locally: clicking "Login with Mentee" completes the flow and lands on `/chat`.
- `/api/auth/me` returns `role`, `picture`, `preferred_language`.
- Logout revokes the Mentee refresh token (verifiable in Mentee's DB).
- Access-token refresh is transparent to the user.
- `uv run pytest` green.
- `grep -R "MOCK_USER\|_MOCK_USER\|mock_session" backend/` returns nothing.
- `backend/CLAUDE.md` updated to describe the real flow.
