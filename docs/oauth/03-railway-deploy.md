# Railway Deployment — Mentee Bot

> **Audience**: the operator deploying the Bot to Railway for the first time.
> **Prereq**: local MVP works end-to-end (see [`00-oauth-overview.md`](./00-oauth-overview.md) §11 T5 / T10).

---

## Architecture

Two Railway services, one shared Postgres:

| Service | URL (example) | Purpose |
|---|---|---|
| **bot-backend** | `https://api.bot.menteeglobal.org` | FastAPI — OAuth client, sessions, chat API |
| **bot-frontend** | `https://bot.menteeglobal.org` | TanStack Start (SSR) — landing, chat UI |
| **Postgres** | `postgres.railway.internal:5432` | Session storage (Railway private network) |

Cookies stay on the backend host (`api.bot.menteeglobal.org`). Because both
subdomains share the same registrable domain (`menteeglobal.org`), SameSite=Lax
permits same-site cross-subdomain fetches. Keep cookies **host-only** — never
add a `Domain=` attribute.

---

## 1. Register the Bot in production Mentee

Run `backend/scripts/register_oauth_client.py` against the **production** Mentee
(not local). Save the plaintext `client_secret`:

```bash
cd <path-to-prod-mentee>/backend && .venv/bin/python scripts/register_oauth_client.py \
  --client-id mentee-bot \
  --name "Mentee Bot" \
  --redirect-uri https://api.bot.menteeglobal.org/api/auth/callback \
  --scope "openid email profile mentee.role" \
  --first-party
```

Alternative: run the admin curl in [`00-oauth-overview.md`](./00-oauth-overview.md) §2.6.

---

## 2. Provision the Postgres service

Railway → New Project → Add **Postgres**. The service exposes two URLs:

- **Private** (`postgres.railway.internal:5432`) — use inside Railway; zero egress cost.
- **Public** (`*.proxy.rlwy.net`) — use from your laptop if you need to inspect.

For prod, use the **private** URL on the Bot backend service.

---

## 3. Deploy the backend service

1. **New Service → Deploy from GitHub repo → point at this repo root.**
2. **Settings → Root Directory** → `backend`.
3. **Settings → Start Command** → leave blank (Railway picks up `railway.json`).
4. **Variables** (all required):

   ```
   ENVIRONMENT=production
   FRONTEND_URL=https://bot.menteeglobal.org
   CORS_ORIGINS=https://bot.menteeglobal.org

   MENTEE_OAUTH_ISSUER=https://app.menteeglobal.org
   MENTEE_OAUTH_CLIENT_ID=mentee-bot
   MENTEE_OAUTH_CLIENT_SECRET=<plaintext from step 1>
   MENTEE_OAUTH_REDIRECT_URI=https://api.bot.menteeglobal.org/api/auth/callback
   MENTEE_OAUTH_SCOPES=openid email profile mentee.role

   DATABASE_URL=postgresql+asyncpg://<user>:<pwd>@postgres.railway.internal:5432/railway

   SESSION_SECRET=<freshly generated Fernet key — NOT the dev one>
   SESSION_COOKIE_NAME=mentee_session
   SESSION_COOKIE_SECURE=true
   SESSION_COOKIE_SAMESITE=lax
   SESSION_MAX_AGE_SECONDS=604800

   OAUTH_STATE_TTL_SECONDS=600
   ```

   Generate the Fernet key locally:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

5. **Custom Domain** → `api.bot.menteeglobal.org`. Add the CNAME it shows you
   at your DNS provider.
6. **Deploy.** Railway runs:
   ```
   uv sync --frozen
   uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
   (see `backend/railway.json` + `backend/nixpacks.toml`). Expected boot log:
   ```
   INFO  [alembic.runtime.migration] Running upgrade -> <rev>, initial schema
   INFO  Application startup complete.
   ```
7. **Smoke test**:
   ```bash
   curl https://api.bot.menteeglobal.org/health
   # {"status":"ok"}
   curl https://api.bot.menteeglobal.org/.well-known/no-such — expect 404, not hang
   ```

---

## 4. Deploy the frontend service

1. **New Service → Deploy from GitHub repo**, same repo, **Root Directory** → `frontend`.
2. **Variables**:

   ```
   VITE_API_URL=https://api.bot.menteeglobal.org
   VITE_POSTHOG_KEY=<your PostHog project key>   # optional
   VITE_POSTHOG_HOST=https://us.i.posthog.com    # optional, EU cloud users change
   ```

   `VITE_*` vars are **inlined at build time** — changing them requires a redeploy,
   not just a restart.
3. **Custom Domain** → `bot.menteeglobal.org`.
4. **Deploy.** Railway runs:
   ```
   npm ci && npm run build
   npm run start   # → node server.mjs
   ```
   (see `frontend/railway.json`). `server.mjs` serves static assets from
   `dist/client/` and falls through to the TanStack Start SSR handler for
   everything else.

---

## 5. End-to-end smoke test (prod)

Follow [`00-oauth-overview.md`](./00-oauth-overview.md) §11:

1. **T1** — `curl https://app.menteeglobal.org/.well-known/openid-configuration`
   returns the discovery doc.
2. **T5** — log into Mentee in tab A, visit `https://bot.menteeglobal.org` in
   tab B, click **Login with Mentee**. Expect to land on `/chat` within ~2s.
3. **T10** — click Sign out. Expect Mentee's DB to show the refresh_token
   record flipped to `revoked=true`.

---

## 6. Rollback + operations

- **Deactivate the Bot client** (takes effect immediately for new logins):
  `PATCH /api/admin/oauth-clients/mentee-bot` body `{"is_active": false}` on
  Mentee.
- **Revoke all live Bot sessions**:
  `POST /api/admin/oauth-clients/mentee-bot/revoke-all-tokens`.
- **Rotate the client_secret**:
  `POST /api/admin/oauth-clients/mentee-bot/rotate-secret`. Paste the new
  plaintext into Railway → bot-backend → Variables → `MENTEE_OAUTH_CLIENT_SECRET`
  and redeploy.
- **Rotate `SESSION_SECRET`**: Generate a new Fernet key, update the env var,
  redeploy. All existing sessions become unreadable (Fernet fails to decrypt
  the encrypted `access_token_enc`) — users re-login transparently via Mentee.

---

## 7. Known caveats

- **Mentee refresh grant** is not yet wired on the provider (overview §2.5).
  Until it ships, Bot sessions expire cleanly after ~1h and users click
  **Login with Mentee** again (~1s). The Bot's code path for this is covered
  by `tests/auth/test_service.py::test_current_user_refresh_unsupported_deletes_session_and_logs_info`.
- **Python version**: `backend/nixpacks.toml` pins `python314`. If Railway's
  Nix channel hasn't caught up, drop to `python313` there and relax
  `requires-python` in `backend/pyproject.toml`.
- **SSR vs. SPA**: `frontend/server.mjs` runs the Vite-built fetch handler.
  To swap to an SPA-only deploy (dropping SSR), set a different adapter in
  `vite.config.ts` per the TanStack Start deployment skill.
