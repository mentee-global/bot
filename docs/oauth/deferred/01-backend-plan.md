# OAuth Backend — Deferred / Nice-to-Have Plan (Mentee Bot — FastAPI)

> **What this is**: implementation sketch for Bot-backend OAuth features that are **not** in MVP. Kept thin enough that a future session can estimate cost without re-reading archaeology; dense enough that it's actionable.
>
> **MVP plan**: [`../01-oauth-backend-plan.md`](../01-oauth-backend-plan.md).
> **Counterpart overview**: [`00-overview.md`](./00-overview.md).

---

## 1. Phase 2 — Silent auth via hidden iframe

### 1.1 New endpoints to add on Bot backend

```
GET  /api/auth/silent-start     → serves a tiny HTML page
POST /api/auth/silent-complete  → token exchange + cookie set (JSON, not redirect)
```

### 1.2 `/api/auth/silent-start` — what it returns

An HTML page that:
1. Runs server-side logic equivalent to `AuthService.start_login` (generates `state`, `code_verifier`, `nonce`; stores in `OAuthState`).
2. Renders inline JS that creates a hidden iframe pointing at Mentee's `/oauth/authorize?prompt=none&response_mode=web_message&...`.
3. Listens for `window.addEventListener("message", …)` on the expected origin (`settings.mentee_oauth_issuer`).
4. On receiving `{type: "authorization_response", code, state}`, POSTs to `/api/auth/silent-complete`.
5. On receiving `{error: "login_required"}` or `{error: "consent_required"}`, postMessages back to `window.parent` with `{ok: false, reason}`.

The page must set a strict CSP: `frame-ancestors <bot-frontend-origin>`; no inline script except the nonce'd block; no external resources.

### 1.3 `/api/auth/silent-complete` — same logic as `AuthService.complete_login`

Differences from the regular `/api/auth/callback`:
- Accepts `{code, state}` as JSON, not as query params.
- On success, sets the `mentee_session` cookie (same attributes) and returns JSON `{ok: true}`.
- On failure, returns JSON `{ok: false, reason}` — the outer iframe page relays it to the Bot frontend.

### 1.4 Code layout

New file: `backend/app/auth/silent.py`. Contains the HTML template (as a string or Jinja file) and the two route handlers. Wires into the existing `AuthService` — do NOT duplicate state/token logic.

### 1.5 Tests

- `test_silent_start_returns_html_with_csp` — response is 200 `text/html` with `Content-Security-Policy: frame-ancestors …`.
- `test_silent_complete_happy_path` — fake Mentee returns code; Bot sets cookie; returns `{ok: true}`.
- `test_silent_complete_rejects_bad_state` — 400.
- E2E with Playwright (new): load a test page that embeds `/api/auth/silent-start`, simulate Mentee `postMessage`, assert Bot cookie set.

### 1.6 Effort estimate

- ~1 day backend + 1 day frontend integration + 0.5 day CSP tuning and cross-browser testing (Safari ITP quirks).

---

## 2. `mentee.api` scope — calling Mentee APIs on the user's behalf

### 2.1 Scope request change

In `settings.mentee_oauth_scopes`, append `mentee.api` when the feature is enabled:

```bash
MENTEE_OAUTH_SCOPES=openid email profile mentee.role mentee.api
```

Gate behind a feature flag: `ENABLE_MENTEE_API_SCOPE=false` in MVP. When flipped on, the Bot starts requesting this scope on new logins; existing sessions don't retroactively gain it — they re-auth on next refresh-miss.

### 2.2 Storing the token for API use

The MVP `StoredSession` already holds `access_token_enc` + `refresh_token_enc`. No schema change. Re-use the same tokens for Mentee API calls.

### 2.3 New helper — `MenteeApiClient`

New file: `backend/app/integrations/mentee/client.py`.

```python
class MenteeApiClient:
    """Typed client for Mentee's REST API.
    
    Receives a session-id; fetches the user's decrypted access_token from
    the session store; handles token refresh transparently on 401.
    """
    def __init__(self, sessions: SessionStore, oauth: MenteeOAuthClient, http: httpx.AsyncClient): ...

    async def list_appointments(self, session_id: str) -> list[Appointment]: ...
    async def list_training(self, session_id: str) -> list[Training]: ...
    async def get_mentee_profile(self, session_id: str) -> MenteeProfile: ...
    # ... one method per Mentee endpoint the agent needs
```

Pattern: every call tries once with the current access_token; on 401, tries a refresh via `MenteeOAuthClient.refresh`; retries once; on still-401 → raises `MenteeApiAuthError`, which surfaces to the user as a prompt to re-login.

### 2.4 Agent integration

The `MockAgent` (and eventual real agent) grows a `user_context` parameter holding a `MenteeApiClient` instance. The agent decides which API calls to make based on prompt content. LLM tool-use patterns (pydantic-ai / OpenAI function-calling) map naturally:

```python
tools = [
    mentee_api.list_appointments,
    mentee_api.list_training,
    mentee_api.get_mentee_profile,
    # ...
]
```

### 2.5 Types

Mentee's API returns JSON that roughly matches its MongoDB models. Generate Pydantic schemas for each endpoint the Bot consumes — either hand-written in `backend/app/integrations/mentee/schemas.py` or auto-generated if Mentee publishes an OpenAPI spec later.

### 2.6 Error propagation

If a Mentee API call fails (network, 5xx, or post-refresh 401), the agent should degrade gracefully — respond in natural language *"I couldn't reach Mentee to check your schedule right now"*, not a stack trace. Encapsulate in `MenteeApiClient` via `try/except` → return `Result[T, Reason]`-style values or raise domain exceptions the agent understands.

### 2.7 Rate limiting outbound

The Bot could hammer Mentee if the agent triggers many tool calls per message. Add a per-session token-bucket limiter on `MenteeApiClient` (e.g., 20 calls/min per session) so a runaway LLM loop doesn't DoS Mentee. `limits` library or a handcrafted asyncio semaphore works.

### 2.8 Tests

- `test_mentee_api_client_refreshes_on_401` — first call 401; second call 200 after refresh.
- `test_mentee_api_client_handles_revoked_token` — 401 before and after refresh → raises domain error; session is invalidated.
- `test_mentee_api_client_respects_rate_limit` — 21st call within a minute is delayed.
- Contract tests: schema validation on real fixture payloads from Mentee.

### 2.9 Effort estimate

- ~2 days client + tests + 1 day agent integration + 1 day end-to-end testing with live Mentee dev.

---

## 3. Security checklist for both deferred features

When shipping either feature:

- [ ] Phase 2 silent-start HTML uses a nonce-based CSP; no `unsafe-inline`.
- [ ] Phase 2 `window.postMessage` listener verifies `event.origin === settings.mentee_oauth_issuer` — reject otherwise.
- [ ] Phase 2 accepts `postMessage` only from the expected iframe; verifies `event.source === iframe.contentWindow`.
- [ ] `mentee.api` scope is gated by a feature flag for first rollout; flip off instantly if abuse detected.
- [ ] `mentee.api` rate-limit on outbound calls prevents accidental DoS of Mentee.
- [ ] All new endpoints covered by the same logging/observability patterns as MVP routes.
- [ ] User-facing consent copy for `mentee.api` drafted and reviewed by product before enable.

---

## 4. Rollout ordering

If both features ship together, order of implementation:

1. `mentee.api` first (no browser changes needed; easier to roll back).
2. Phase 2 silent auth second (browser-sensitive, more fragile).

If shipped separately, either order is fine.
