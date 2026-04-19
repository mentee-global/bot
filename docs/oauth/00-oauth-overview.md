# OAuth — "Login with Mentee" — Implementation Overview (Mentee Bot)

> This document lives in the **Mentee Bot** repo (`/Users/odzen/Job/Mentee/bot`). Its sibling in the main Mentee app (`/Users/odzen/Job/Mentee/mentee/docs/oauth/00-oauth-overview.md`) describes the OAuth **provider** side. Read both before starting.
>
> **Deferred / nice-to-have features** (explicitly NOT in MVP) live in [`deferred/00-overview.md`](./deferred/00-overview.md).
>
> **Plan audit — 2026-04-18**: This plan was cross-checked against the current Mentee provider code (`/Users/odzen/Job/Mentee/mentee`). Sections 2.5 and 2.6 below record the **state of Mentee right now**, including two features advertised in the discovery doc but not yet wired end-to-end. Read them before §10 (delivery order) and before registering the client.

---

## 1. Goal

Replace the stub OAuth flow currently shipped in this repo with a real **"Login with Mentee"** flow, where:

- The **Mentee main app** (`app.menteeglobal.org`) is the **OAuth Authorization Server / Identity Provider**.
- The **Mentee Bot** (`bot.menteeglobal.org`, this repo) is an **OAuth Client** (confidential client — the FastAPI backend holds the client secret).
- A user never creates a separate account for the Bot. They click **Login with Mentee**, approve once, and receive a Bot session cookie derived from their Mentee identity.
- A user who is **already logged into Mentee** experiences a **one-click** login in the Bot (no credentials prompt, consent auto-skipped after first approval).

The flow must be **robust, revocable, and production-grade** from day one. The stub that currently lives at `backend/app/api/routes/auth.py` and `frontend/src/features/auth/data/auth.service.ts` must be replaced, not extended.

---

## 2. Locked decisions

All design decisions are finalized. This section is the source of truth; child plans implement it.

| # | Decision | Choice |
|---|---|---|
| 1 | Prod domains | Mentee = `https://app.menteeglobal.org`, Bot = `https://bot.menteeglobal.org` (Railway) |
| 2 | SSO gate on Mentee | Flask server-session cookie (`mentee_web_session`) layered on Firebase; strictly additive |
| 3 | Consent UX | Shown once per user per client, remembered in `oauth_consents`. Skipped thereafter. Transactional copy tone |
| 4 | Auto-login UX | Phase 1 click-through (≤1s, 1 click). Silent iframe (Phase 2) deferred |
| 5 | Bot-calls-Mentee-API | Deferred. Scope name `mentee.api` reserved but unimplemented |
| 6 | Access-token format | Opaque (random, hashed at rest, revocable) |
| 7 | Bot database | Postgres everywhere — Docker locally, Railway Postgres in prod |
| 8 | Refresh-token rotation | Rotate on every use + replay detection (revoke chain on reuse) |
| 9 | Role-change latency | Propagated on access-token refresh (≤1h) |
| 10 | Token TTLs | auth_code 10 min · access 1h · refresh 30d · Bot session 7d · Mentee session 14d |
| 11 | Scope naming | Short dotted (`mentee.role`, future `mentee.api.*`) |
| 12 | id_token signing key | RS256. Env var `OIDC_PRIVATE_KEY_PEM` in prod; file in dev |
| 13 | Client admin surface | Admin UI (`/admin/oauth-clients`) + user-facing Connected Apps page (`/settings/connected-apps`) |
| 14 | Rate limits | `/oauth/token` 20/min/IP · `/oauth/authorize` 60/min/IP · `/oauth/userinfo` 120/min/token · `/oauth/revoke` 20/min/IP · admin 10/min/admin |
| 15 | `/oauth/userinfo` CORS | Wildcard `*`; security is the bearer token |
| 16 | Consent-page i18n | Reuse Mentee's existing i18next language detector |
| 17 | Authlib version | Latest 1.6.x |
| 18 | Bot `is_first_party` flag | **`true`** — Bot is a Mentee-owned first-party app. Consent screen is skipped entirely on Mentee. The `oauth_consents` row is never created for the Bot. |
| 19 | Bot whitelist config | **Empty** (`whitelist_user_ids=[]`, `whitelist_roles=[]`) — open to every logged-in Mentee user. Can be tightened later without a Bot redeploy. |
| 20 | Rate limits (decision #14) | **Target, not yet enforced in Mentee.** Bot must not assume 429s. If/when Mentee enables Flask-Limiter, Bot retries are already correct (they surface 4xx as `invalid_grant` and re-login). |

Bot stack confirmed: **FastAPI · SQLModel · Alembic · asyncpg · Postgres · Authlib** (client role).

---

## 2.5 Current Mentee provider status (verified 2026-04-18)

Before coding the Bot client, know exactly what the Mentee provider does and does not do **today**. Paths below are in `/Users/odzen/Job/Mentee/mentee/backend/`.

**Implemented and working:**
- `GET /.well-known/openid-configuration` (`api/views/oauth.py:100`) — includes `issuer`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `revocation_endpoint`, `scopes_supported=["openid","email","profile","mentee.role"]`, `response_types_supported=["code"]`, `grant_types_supported=["authorization_code","refresh_token"]`, `code_challenge_methods_supported=["S256"]`, `token_endpoint_auth_methods_supported=["client_secret_basic","client_secret_post"]`
- `GET /.well-known/jwks.json` (`api/views/oauth.py:141`) — RS256 public key with `kid` from `OIDC_KEY_ID`
- `GET /oauth/authorize` (`api/views/oauth.py:182`) — PKCE S256 mandatory; consent auto-skipped for `is_first_party=true` clients
- `POST /oauth/authorize` (`api/views/oauth.py:280`) — consent decision endpoint (only used by non-first-party clients)
- `GET /oauth/consent-request` (`api/views/oauth.py:344`) — React consent page XHR
- `POST /oauth/token` with `grant_type=authorization_code` (`api/views/oauth.py:399`) — returns `access_token`, `refresh_token`, `id_token`, `token_type=Bearer`, `expires_in=3600`, `scope`
- `GET /oauth/userinfo` (`api/views/oauth.py:428`) — returns `sub`, and conditionally: `email` + `email_verified` (scope `email`), `name` + `picture` + `preferred_language` + `timezone` (scope `profile`, **omitted** when missing — never `null`), `role` + `role_id` (scope `mentee.role`)
- `POST /oauth/revoke` (`api/views/oauth.py:474`) — RFC 7009. Cascades: revoking a refresh_token flips `revoked=true` on every descendant access_token. Returns 200 even for unknown tokens.
- Consent persistence (`oauth_consents` collection, unique on `(user_id, client_id)`) — applies only to non-first-party clients.

**Advertised but NOT YET implemented** (⚠️ treat as gaps):

- **`grant_type=refresh_token` on `/oauth/token` does not work today.** `MenteeRefreshTokenGrant` is defined but not registered in Authlib (`api/utils/oauth_server.py:96`, TODO comment). The discovery doc lists it because the contract is locked; the wire-up is a follow-up on the Mentee side. **Impact on Bot**: see §6 below and `01-oauth-backend-plan.md` §9.1 for the degraded-mode behavior the Bot must ship with.
- **Rate limiting (decision #14) is not enforced.** No Flask-Limiter decorators on any OAuth endpoint. The Bot should not rely on Mentee to throttle abuse — but the Bot's own retry/backoff logic should still be correct so nothing breaks when Mentee does enable it.
- **`/oauth/introspect` (RFC 7662) does not exist.** The Bot must not call it. Use `/oauth/userinfo` for "is this token alive?" checks.

**Error behavior (verified):**
- Pre-redirect errors (`invalid_client`, unregistered `redirect_uri`, bad PKCE, unknown scope, whitelist denial) → **400 JSON** with `{"error": "...", "error_description": "..."}`. Mentee never 302s to an unvalidated `redirect_uri`.
- Post-validation errors (user denies consent, login required) → **302 to the registered `redirect_uri`** with `?error=access_denied&state=...` (or `error=login_required`). OAuth 2.0 §4.1.2.1.
- Missing/invalid bearer on `/oauth/userinfo` → **401** (commit `10cc752` fixed this from 500).

---

## 2.6 Bot client registration in Mentee (do this BEFORE writing Bot code)

The Bot cannot complete a login until Mentee has a matching `oauth_clients` row. The admin surface in Mentee (`POST /api/admin/oauth-clients`) requires an admin bearer token. Register **two** clients — one for local dev, one for prod.

**Local dev client** (run once; rerun whenever the Mentee DB is reset):

```bash
# From any shell with $MENTEE_ADMIN_TOKEN set to an admin Firebase ID token.
curl -sS -X POST http://localhost:8000/api/admin/oauth-clients \
  -H "Authorization: Bearer $MENTEE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "mentee-bot-local",
    "client_name": "Mentee Bot (local)",
    "redirect_uris": ["http://localhost:8001/api/auth/callback"],
    "allowed_scopes": ["openid", "email", "profile", "mentee.role"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_basic",
    "is_first_party": true,
    "is_active": true,
    "whitelist_user_ids": [],
    "whitelist_roles": []
  }'
```

The response body returns the **plaintext `client_secret` exactly once** — copy it into `backend/.env` as `MENTEE_OAUTH_CLIENT_SECRET`. Mentee stores only the bcrypt hash (`OAuthClient.client_secret_hash`); the secret cannot be retrieved later. To replace it, `POST /api/admin/oauth-clients/mentee-bot-local/rotate-secret`.

**Prod client** (run once, in the production Mentee):

```json
{
  "client_id": "mentee-bot",
  "client_name": "Mentee Bot",
  "redirect_uris": ["https://bot.menteeglobal.org/api/auth/callback"],
  "allowed_scopes": ["openid", "email", "profile", "mentee.role"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "is_first_party": true,
  "is_active": true,
  "whitelist_user_ids": [],
  "whitelist_roles": []
}
```

**Field-by-field rationale:**

| Field | Value | Why |
|---|---|---|
| `redirect_uris` | exactly one URL per env | Mentee matches exactly — no prefix matching, no trailing-slash tolerance. Typos fail authorize with 400. |
| `allowed_scopes` | `openid email profile mentee.role` | Matches the Bot's `MENTEE_OAUTH_SCOPES`. Any requested scope not in this list fails authorize. |
| `grant_types` | includes `refresh_token` | Forward-compatible. Harmless while §2.5 gap exists. |
| `token_endpoint_auth_method` | `client_secret_basic` | HTTP Basic Auth with `client_id:client_secret`. Authlib's `AsyncOAuth2Client` default. |
| `is_first_party` | `true` | Bot is Mentee-owned. Skips the consent screen → truly 1-click UX. |
| `whitelist_user_ids` / `whitelist_roles` | `[]` / `[]` | Union semantics: both empty = open to any logged-in user. Set later via `PATCH` without redeploying the Bot. |
| `is_active` | `true` | Required. Set to `false` later to freeze; required for hard-delete. |

**Verify registration:**

```bash
curl -sS http://localhost:8000/api/admin/oauth-clients/mentee-bot-local \
  -H "Authorization: Bearer $MENTEE_ADMIN_TOKEN" | jq
# Expect: is_active=true, is_first_party=true, redirect_uris includes :8001 callback.
```

**If something goes wrong**, the teardown sequence (in Mentee's admin UI or via curl) is:

1. `PATCH /api/admin/oauth-clients/<client_id>` with `{"is_active": false}` — stops new auth flows immediately.
2. `POST /api/admin/oauth-clients/<client_id>/revoke-all-tokens` — kills every live session held by Bot users.
3. `DELETE /api/admin/oauth-clients/<client_id>` with body `{"confirm_client_id": "<client_id>"}` — hard delete. Client must already be `is_active=false`. Cascades to codes, tokens, consents.

---

## 3. High-level flow (happy path)

```
┌────────────┐    1 click "Login with Mentee"     ┌───────────────┐
│  Bot FE    │ ─────────────────────────────────▶│ Bot BE        │
│ :3001 dev  │                                   │ :8001 dev     │
└────────────┘                                   └───────┬───────┘
      ▲                                                  │ 2 302 to Mentee /oauth/authorize
      │                                                  │   (with PKCE challenge + state)
      │                                                  ▼
      │                                          ┌───────────────┐
      │                                          │ Mentee FE     │
      │                                          │ consent UI    │
      │                                          │ (1st time only)│
      │                                          └───────┬───────┘
      │   4 302 to Bot /api/auth/callback?code=...&state=...
      │                                                  │ 3 user approves
      │                                                  ▼
      │                                          ┌───────────────┐
      │                                          │ Mentee BE     │
      │                                          │ stores code   │
      │                                          └───────┬───────┘
      │                                                  │
  ◀───┼──────────────────────────────────────────────────┘
      │   5 Bot BE verifies state, POSTs /oauth/token
      │      (code + code_verifier + client_secret)
      │      ─▶ receives access_token + refresh_token + id_token
      │   6 Bot BE GETs /oauth/userinfo
      │   7 Bot BE creates session in Postgres, sets mentee_session cookie
      │   8 Bot BE 302s to /chat
```

### Endpoints by role

**Mentee provider** (`/Users/odzen/Job/Mentee/mentee`):
- `GET  /oauth/authorize` — consent + code issuance
- `POST /oauth/token` — code / refresh exchange
- `GET  /oauth/userinfo` — user profile by bearer
- `POST /oauth/revoke` — RFC 7009
- `GET  /.well-known/openid-configuration` — discovery doc
- `GET  /.well-known/jwks.json` — id_token verification keys
- Admin: `GET/POST/PATCH /api/admin/oauth-clients[/<id>][/rotate-secret][/revoke-all-tokens]`
- User: `GET /api/user/connected-apps`, `DELETE /api/user/connected-apps/<client_id>`

**Bot client** (this repo):
- `GET  /api/auth/login` — kicks off OAuth (302 to Mentee)
- `GET  /api/auth/callback` — exchanges code, sets session cookie, redirects to `/chat`
- `GET  /api/auth/me` — returns current user (transparent refresh if needed)
- `POST /api/auth/logout` — clears session + revokes Mentee refresh_token

---

## 4. Bot session storage

Stored in **Postgres**, keyed by session id (also the cookie value). Access/refresh tokens encrypted at rest with Fernet (keyed by `SESSION_SECRET`).

Schema (SQLModel; see `01-oauth-backend-plan.md` §5):

```python
class SessionRecord(SQLModel, table=True):
    session_id: str = Field(primary_key=True, max_length=64)
    mentee_sub: str = Field(index=True, max_length=64)
    email: str
    name: str
    role: str
    role_id: int
    picture: str | None = None
    preferred_language: str | None = None
    timezone: str | None = None
    access_token_enc: bytes
    access_token_expires_at: datetime
    refresh_token_enc: bytes | None = None
    id_token_nonce: str
    created_at: datetime
    last_used_at: datetime
```

Cookie attributes: `mentee_session` · HttpOnly · SameSite=Lax · Secure (prod) · Path=/ · Max-Age=7d.

---

## 5. Scopes & userinfo contract

Requested scopes: `openid email profile mentee.role`.

| Scope | Claims returned |
|---|---|
| `openid` | `sub` (+ `iss`, `aud`, `exp`, `iat`, `nonce` in id_token) |
| `email` | `email`, `email_verified` |
| `profile` | `name`, `picture`, `preferred_language`, `timezone` |
| `mentee.role` | `role` (string), `role_id` (int) |

`/oauth/userinfo` response (authoritative contract):

```json
{
  "sub": "65f1a2b3c4d5e6f7a8b9c0d1",
  "email": "jane@example.com",
  "email_verified": true,
  "name": "Jane Doe",
  "picture": "https://cdn.menteeglobal.org/u/jane.jpg",
  "preferred_language": "en-US",
  "timezone": "America/New_York",
  "role": "mentee",
  "role_id": 2
}
```

Missing fields are **omitted**, not returned as `null` (OIDC §5.3.2).

The Bot's `User` Pydantic model mirrors this exactly — see `02-oauth-frontend-plan.md` §3 and `01-oauth-backend-plan.md` §4.

---

## 6. Auto-login (MVP behavior)

Required product outcome: *"if someone is already Logged with Mentee, they should be automatically logged into the Bot."*

**MVP solution — click-through SSO:**

1. User lands on Bot. Bot frontend calls `GET /api/auth/me`. If 401 → renders "Login with Mentee" button.
2. User clicks. Bot backend generates PKCE + state, 302s to Mentee.
3. Mentee `/oauth/authorize` sees the user's active `mentee_web_session` cookie (set at Mentee login time). Skips the Firebase password prompt entirely.
4. Because the Bot is registered with `is_first_party=true` (decision #18), Mentee **skips the consent screen on every attempt** — no `oauth_consents` row is ever created. If you later downgrade the Bot to third-party, the first authorize would show consent once and subsequent authorizes would match an `oauth_consents` row.
5. Mentee 302s back to the Bot callback with `code` + `state`.
6. Bot backend exchanges the code, creates a session, sets the cookie, 302s to `/chat`.

Net UX: 1 click, ~1 second, no credentials re-entered, no consent screen.

**Zero-click (Phase 2 silent iframe) is deferred** — see [`deferred/00-overview.md`](./deferred/00-overview.md) §A.

---

## 7. Logout semantics

On `POST /api/auth/logout` the Bot must:

1. Look up the stored `refresh_token` for the session (decrypt).
2. Best-effort `POST https://app.menteeglobal.org/oauth/revoke` for the refresh token (provider cascades to dependent access tokens).
3. Delete the Bot session row.
4. Clear the `mentee_session` cookie.

Failure on step 2 is **not fatal** — still clear local state. The Bot does not drop the user out of Mentee itself; they may be using Mentee in another tab.

External revocation (admin in Mentee, password reset, user revokes via Connected Apps) is discovered by the Bot on the next userinfo fetch or refresh attempt: a 401 / `invalid_grant` response → Bot deletes the session and returns 401 to the client. See `01-oauth-backend-plan.md` §10 for the auto-detection logic.

### 7.1 Interim behavior while Mentee's refresh grant is un-wired (§2.5)

Until Mentee's `MenteeRefreshTokenGrant` is registered, `POST /oauth/token` with `grant_type=refresh_token` returns an OAuth error (most likely `unsupported_grant_type`, possibly `invalid_grant`). The Bot stores the `refresh_token` the provider issues on code exchange — but cannot redeem it.

**UX impact**: At most **1 hour** after login, the Bot's access token expires. The Bot's session row is then unrefreshable, so `/api/auth/me` returns 401 and the user sees the "Login with Mentee" button. Clicking it re-runs the full redirect chain — still 1 click (no re-entering credentials, since `mentee_web_session` lasts 14 days and `is_first_party=true` skips consent).

**Not a blocker for MVP.** The Bot code must be written to survive this gap without ever raising a 500; when Mentee ships the grant, the Bot's refresh path (`01-oauth-backend-plan.md` §10 `_refresh`) starts succeeding with no Bot redeploy needed. See `01-oauth-backend-plan.md` §9.1 for the exact feature-detection logic.

---

## 8. Local development — port assignments

Both repos historically bind `:8000` / `:3000`. Mentee keeps those; **Bot moves to `:8001` / `:3001`.**

| | Mentee (unchanged) | Bot (new) |
|---|---|---|
| Backend | `:8000` | **`:8001`** |
| Frontend | `:3000` | **`:3001`** |

Changes required in the Bot repo — enumerated in `01-oauth-backend-plan.md` §2 and `02-oauth-frontend-plan.md` §2.

---

## 9. Environment variables (summary — exhaustive lists in child docs)

**Bot backend** (`backend/.env`):

```bash
ENVIRONMENT=local
FRONTEND_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3001

# OAuth client (issued by Mentee — see mentee/docs/oauth/01-oauth-backend-plan.md §4)
MENTEE_OAUTH_ISSUER=http://localhost:8000            # prod: https://app.menteeglobal.org
MENTEE_OAUTH_CLIENT_ID=mentee-bot-local              # prod: mentee-bot
MENTEE_OAUTH_CLIENT_SECRET=<generated, 32+ bytes base64>
MENTEE_OAUTH_REDIRECT_URI=http://localhost:8001/api/auth/callback
MENTEE_OAUTH_SCOPES=openid email profile mentee.role

# Database (Postgres in all envs)
DATABASE_URL=postgresql+asyncpg://bot:bot@localhost:5432/bot_dev
# prod: postgresql+asyncpg://<user>:<password>@<railway-host>/<db>

# Session secrets
SESSION_SECRET=<generated Fernet key; base64 url-safe 32 bytes>
SESSION_COOKIE_NAME=mentee_session
SESSION_COOKIE_SECURE=false                          # prod: true
SESSION_COOKIE_SAMESITE=lax
SESSION_MAX_AGE_SECONDS=604800                       # 7 days

# OAuth transient state TTL
OAUTH_STATE_TTL_SECONDS=600                          # 10 minutes
```

**Bot frontend** (`frontend/.env.local`):

```bash
VITE_API_URL=http://localhost:8001
```

(`VITE_ENABLE_SILENT_AUTH` and related flags belong to Phase 2 — not MVP.)

---

## 10. Cross-repo delivery order

1. **Mentee backend** — OAuth provider endpoints, client registration, discovery/JWKS, Flask server-session cookie. See `/mentee/docs/oauth/01-oauth-backend-plan.md`. **Deliverable**: the Bot can be registered and the authorize/token/userinfo/revoke endpoints respond correctly to `curl` tests.
2. **Mentee frontend** — consent screen, admin UI, user-facing Connected Apps page. See `/mentee/docs/oauth/02-oauth-frontend-plan.md`.
3. **Bot backend** — real OAuth client replacing the stub. See `01-oauth-backend-plan.md`. **Deliverable**: hitting `GET /api/auth/login` in a browser completes the full flow.
4. **Bot frontend** — update login button, callback route, user type, analytics. See `02-oauth-frontend-plan.md`.
5. **End-to-end tests** — see §11.

Steps 1 and 2 can overlap (different file trees). Steps 3 and 4 can overlap once step 1 is usable.

---

## 11. Test plan — verifying the connection between the apps

Concrete reproducible checks. Run in order.

### T1 — Discovery doc reachable (Mentee)
`curl -s http://localhost:8000/.well-known/openid-configuration | jq` returns JSON containing `issuer`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`.

### T2 — Client registered (Mentee)
Run the `POST /api/admin/oauth-clients` curl in §2.6 (or use the admin UI at `/admin/oauth-clients`). Verify the response body includes a plaintext `client_secret` — paste it into the Bot's `backend/.env` as `MENTEE_OAUTH_CLIENT_SECRET`. Confirm the `GET` on the same URL returns `is_first_party=true`, `is_active=true`, `redirect_uris=["http://localhost:8001/api/auth/callback"]`.

### T3 — Authorize rejects unknown client
`curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8000/oauth/authorize?response_type=code&client_id=bogus&redirect_uri=http://evil.example/&scope=openid&state=x&code_challenge=y&code_challenge_method=S256"` → **400**. Never 302 (prevents open-redirector attacks).

### T4 — Authorize rejects mismatched redirect_uri
Same call with a real `client_id` but an unregistered `redirect_uri` → **400**.

### T5 — Happy-path flow in a browser (both apps)
- Start both stacks: Mentee `:8000`/`:3000`, Bot `:8001`/`:3001`.
- Log into Mentee in tab A (existing Firebase login).
- In tab B, visit `http://localhost:3001`. Click **Login with Mentee**.
- Expect: redirect chain completes → land on `http://localhost:3001/chat` with `mentee_session` cookie set on `localhost:8001`.
- Verify: `GET http://localhost:8001/api/auth/me` returns the user with `role`, `picture`, `preferred_language` matching the logged-in Mentee user.

### T6 — Bot verifies state (CSRF)
Hand-craft `curl "http://localhost:8001/api/auth/callback?code=anything&state=attacker-state"` → **302** to `/auth/error?reason=oauth`. Cookie must NOT be set.

### T7 — Bot verifies PKCE
In a debugger: confirm Bot sends `code_verifier` to `/oauth/token` and Mentee computes `SHA256(verifier)` and compares to `code_challenge`. Tamper with verifier → Mentee returns **400 invalid_grant**.

### T8 — id_token signature + claims
Bot backend unit test with a fixture JWKS: verify `iss`, `aud`, `exp`, `iat`, `nonce`, `sub`. Tampered id_token rejected.

### T9 — /api/auth/me reflects Mentee profile
Change the user's `name` in Mentee (admin action). Force a Bot access-token refresh (`UPDATE sessions SET access_token_expires_at = now() WHERE session_id=...`) and call `/api/auth/me` → updated name returned.

### T10 — Logout revokes Mentee tokens
`curl -X POST http://localhost:8001/api/auth/logout --cookie mentee_session=...`. In Mentee's DB, the user's refresh_token record is `revoked=true`. Subsequent `/api/auth/me` → 401.

### T11 — External revocation propagates
Set `revoked=true` directly on the user's refresh_token in Mentee's DB. From the Bot, force-expire the access_token. Trigger `/api/auth/me` → 401 + Bot session row deleted.

### T12 — CORS / cookie boundaries
- From Bot frontend on `:3001`, `fetch('http://localhost:8001/api/auth/me', {credentials: 'include'})` succeeds after login.
- From `http://evil.example`, the same request is rejected by CORS.
- `document.cookie` in devtools does NOT show `mentee_session`.

### T13 — Concurrent sessions / multi-device
Log in on device A and device B with the same user → two distinct rows in `sessions`. Logout on A does NOT log out B.

### T14 — Expired access-token auto-refresh (blocked by §2.5 gap — test with fake provider)
Set `access_token_expires_at` to the past. Call `/api/auth/me` → Bot attempts to refresh via `/oauth/token?grant_type=refresh_token`.
- **With the real Mentee provider today**: expect the Bot to detect `unsupported_grant_type` / `invalid_grant`, delete the session, and return 401. The user re-clicks "Login with Mentee" and is back in within ~1s (Mentee session + first-party flag skip everything).
- **With the fake provider in Bot unit tests** (`tests/auth/`): mock `/oauth/token` to return a rotated refresh_token + new access_token. The Bot updates the row and serves the request silently. This is the code path that will become live once Mentee registers `MenteeRefreshTokenGrant`.

### T15 — Consent persistence (N/A for first-party Bot)
Because the Bot is `is_first_party=true`, Mentee skips the consent screen and never writes to `oauth_consents`. To manually verify the consent path in Mentee, register a second throwaway client with `is_first_party=false` and run the flow against it. Approve once → consent row created → second login skips the prompt.

### T16 — Admin UI end-to-end
Log into Mentee as admin. Visit `/admin/oauth-clients`. Create a test client. Rotate its secret. Deactivate it. Attempt to log in with the deactivated client → `invalid_client` error. `DELETE` without the `confirm_client_id` body → 400. `DELETE` with the body but the client still `is_active=true` → 400. Set `is_active=false`, repeat DELETE → 200.

### T17 — Connected Apps end-to-end (only relevant for non-first-party clients)
Log into Mentee as a regular user who has authorized a non-first-party test client. Visit `/settings/connected-apps` → the client is listed. Click "Revoke access" → in Mentee's DB, all that user's refresh_tokens for the client are revoked. On the Bot, the next `/api/auth/me` returns 401. For the Bot itself (first-party), Connected Apps does not list it by design.

### T18 — Refresh grant gap detection (Bot resilience today)
With a real Mentee dev instance: complete login on the Bot, then `UPDATE sessions SET access_token_expires_at = now() WHERE session_id='...';` in Bot Postgres. Call `/api/auth/me` — Bot must respond **401** (not 500), and the row must be **deleted**. Check logs: one WARNING line for the refresh failure, no stack trace. Redo the login → works.

---

## 12. Related documents

### MVP (what's being built)
- **This document**: `00-oauth-overview.md`
- **Backend plan**: [`01-oauth-backend-plan.md`](./01-oauth-backend-plan.md)
- **Frontend plan**: [`02-oauth-frontend-plan.md`](./02-oauth-frontend-plan.md)

### Deferred / nice-to-have (NOT in MVP)
- **Overview**: [`deferred/00-overview.md`](./deferred/00-overview.md)
- **Backend**: [`deferred/01-backend-plan.md`](./deferred/01-backend-plan.md)
- **Frontend**: [`deferred/02-frontend-plan.md`](./deferred/02-frontend-plan.md)

### Mentee side
- Overview: `/Users/odzen/Job/Mentee/mentee/docs/oauth/00-oauth-overview.md`
- Backend: `/Users/odzen/Job/Mentee/mentee/docs/oauth/01-oauth-backend-plan.md`
- Frontend: `/Users/odzen/Job/Mentee/mentee/docs/oauth/02-oauth-frontend-plan.md`
- Deferred: `/Users/odzen/Job/Mentee/mentee/docs/oauth/deferred/`
