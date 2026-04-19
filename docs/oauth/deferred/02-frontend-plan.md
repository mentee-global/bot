# OAuth Frontend — Deferred / Nice-to-Have Plan (Mentee Bot — TanStack Start + React 19)

> **MVP plan**: [`../02-oauth-frontend-plan.md`](../02-oauth-frontend-plan.md).
> **Companion**: [`00-overview.md`](./00-overview.md), [`01-backend-plan.md`](./01-backend-plan.md).

---

## 1. Phase 2 — Silent auth iframe probe on app mount

### 1.1 Behavior

On Bot root mount, before showing the login button, check if the user is already logged into Mentee and silently establish a Bot session if so.

### 1.2 Flow

1. `RootComponent` mounts → reads `useSession()` query.
2. If session is `null` AND `VITE_ENABLE_SILENT_AUTH=true`:
   - Render an invisible iframe whose src is `${API_URL}/api/auth/silent-start`.
   - The Bot backend serves HTML that itself renders a hidden iframe pointed at Mentee (`prompt=none`).
   - When Mentee posts the auth code back, the outer iframe posts a result message to `window.parent`.
3. Parent listens: `window.addEventListener("message", handler)`.
4. On `{ok: true}`: invalidate the session query — `/api/auth/me` now returns the user.
5. On `{ok: false, reason}`: remove the iframe; render the normal "Login with Mentee" button.
6. Timeout: 5 seconds. If no message by then, treat as failed and show the button.

### 1.3 Service addition

In `frontend/src/features/auth/data/auth.service.ts`:

```typescript
const SILENT_AUTH_TIMEOUT_MS = 5000;

trySilentLogin: (): Promise<boolean> => new Promise((resolve) => {
  if (!import.meta.env.VITE_ENABLE_SILENT_AUTH) {
    resolve(false);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = `${API_URL}/api/auth/silent-start`;
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");

  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    iframe.remove();
    clearTimeout(timer);
  };

  const expectedOrigin = new URL(API_URL).origin;

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== expectedOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    if (typeof event.data !== "object" || !("ok" in event.data)) return;
    cleanup();
    resolve(!!event.data.ok);
  };

  const timer = setTimeout(() => {
    cleanup();
    resolve(false);
  }, SILENT_AUTH_TIMEOUT_MS);

  window.addEventListener("message", onMessage);
  document.body.appendChild(iframe);
}),
```

### 1.4 Root wiring

In `frontend/src/routes/__root.tsx`:

```tsx
useEffect(() => {
  if (session.isPending || session.data) return;
  if (!import.meta.env.VITE_ENABLE_SILENT_AUTH) return;

  authService.trySilentLogin().then((ok) => {
    if (ok) {
      queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
    }
  });
}, [session.isPending, session.data]);
```

### 1.5 Env var

```bash
VITE_ENABLE_SILENT_AUTH=true
```

Leave `false` for staging until security review signs off on the iframe origin + CSP setup.

### 1.6 Browser caveats

- **Safari ITP** (Intelligent Tracking Prevention): blocks third-party cookies by default. Since `bot.menteeglobal.org` and `app.menteeglobal.org` share a registrable domain, the Mentee session cookie in the iframe is **first-party from the iframe's perspective** — ITP should not block. Verify explicitly on Safari 17+.
- **Brave / strict privacy browsers**: may block `postMessage` cross-origin even same-site. Accept graceful fallback: user sees the login button as if silent auth wasn't configured.
- **Chrome third-party cookie deprecation**: same-site case is unaffected.

### 1.7 Tests

- Unit: `authService.trySilentLogin` resolves `false` when env var is off.
- Unit: ignores messages from wrong origin.
- Unit: resolves `true` on `{ok: true}` message from expected iframe.
- Unit: resolves `false` on timeout.
- Integration (Playwright): mount app with a mocked backend that posts `{ok: true}` — assert session query is invalidated and `/chat` nav is available.

### 1.8 Analytics event

Fire a `silent_auth_attempted` event with `{result: "success"|"failure"|"timeout"}` so you can measure the zero-click success rate in production. Informs whether the feature is worth keeping.

---

## 2. `mentee.api` scope — UI treatment when the Bot uses user's data

### 2.1 Consent copy (handled on Mentee side)

The Mentee consent screen lists `mentee.api` as a permission when the Bot requests it. Copy: *"Take actions and read information in your Mentee account on your behalf."* — Mentee's i18n handles this; nothing for the Bot frontend to do at authorization time.

### 2.2 In-chat indicators

When the agent makes a live Mentee API call (via a tool-use event), surface it in the chat UI:

- Each assistant message that grounded on Mentee data shows a small badge: *"Based on your Mentee appointments"* / *"Based on your Mentee profile"* — driven by a `sources: string[]` field on the assistant message, populated by the backend when tools are invoked.
- Hover state reveals which Mentee data was used.

Implementation:
- Extend `Message` type in `frontend/src/features/chat/data/chat.types.ts`:
  ```typescript
  export interface Message {
    id: string;
    thread_id: string;
    role: MessageRole;
    body: string;
    created_at: string;
    sources?: MessageSource[];
  }
  export interface MessageSource {
    kind: "mentee_appointments" | "mentee_training" | "mentee_profile";
    label: string;  // localized display label
  }
  ```
- Render badge components under each assistant message when `sources?.length`.
- New i18n keys for each source kind.

### 2.3 Error surfacing

If the Bot backend can't reach Mentee (auth expired, Mentee down), the agent returns a structured error that the UI renders as a gentle banner:
- *"I couldn't access your Mentee data just now. [Try again / Sign in again]"*.

The "Sign in again" link re-runs the full OAuth flow (since the token was probably revoked or refresh failed).

### 2.4 Tests

- Snapshot test for an assistant message with `sources`.
- Unit test: error banner renders when the agent response contains a structured `mentee_unreachable` flag.

### 2.5 i18n keys needed

```json
{
  "chat_sources_appointments":  "Based on your Mentee appointments",
  "chat_sources_training":      "Based on your training progress",
  "chat_sources_profile":       "Based on your profile",
  "chat_mentee_unreachable":    "I couldn't reach Mentee right now.",
  "chat_signin_again":          "Sign in again"
}
```

---

## 3. Effort estimate

| Feature | Frontend work |
|---|---|
| Phase 2 silent auth | ~1 day (iframe, message handler, tests, CSP tuning with backend) |
| `mentee.api` UI treatment | ~2 days (badges, error states, copy, i18n across all locales) |

---

## 4. Rollout

Ship with analytics / observability enabled. Measure:
- Silent-auth success rate (per browser).
- % of assistant messages that use `sources` once `mentee.api` is enabled.
- Error rate on `mentee_unreachable`.

Pull the features if data shows low value or high breakage.
