# OAuth Frontend Implementation Plan — Mentee Bot (TanStack Start + React 19)

> **Audience**: the coding agent implementing the Bot-side OAuth client in the frontend.
> **Repo**: `/Users/odzen/Job/Mentee/bot/frontend` (React 19, TanStack Start/Router/Query, Vite, Tailwind 4, Paraglide).
> **Prereq**: read [`00-oauth-overview.md`](./00-oauth-overview.md) and [`01-oauth-backend-plan.md`](./01-oauth-backend-plan.md) first.
> **Deferred work**: [`deferred/02-frontend-plan.md`](./deferred/02-frontend-plan.md).
>
> **Current-state note**: Mentee's refresh-token grant is not yet live (overview §2.5). For the Bot that means a user hits a silent 401 at most 1h after login, triggering the 401 handling in §8 which sends them to `/` where they see "Login with Mentee" again. With Mentee's first-party flag + 14-day `mentee_web_session`, the re-login is still 1 click and ~1s, so no new frontend handling is needed — but the 401 path in §8 is **not** an edge case; it is the daily UX for now. Make sure the "logged out" → home transition is smooth (no error toast, no flash of authenticated UI).

---

## 1. Scope

Ship the MVP click-through login UX:

- 1 click on "Login with Mentee" → redirect chain → land on `/chat` authenticated.
- Extend the `User` type to carry role + profile claims.
- Add `/auth/error` route for provider-side failures.
- Delete the obsolete XHR-based `/auth/callback` exchange (backend now redirects server-side).

Silent-auth iframe (Phase 2) is **not** in MVP — see deferred plan.

---

## 2. Pre-flight — port move

Change Vite to `:3001`; point at backend on `:8001`.

### Tasks

1. **`frontend/vite.config.ts`** (or `.js`): `server.port = 3001`, `server.strictPort = true`.
2. **`frontend/.env.example`** and **`.env.local`**: `VITE_API_URL=http://localhost:8001`.
3. **`frontend/README.md`**: URL updates.
4. **`frontend/CLAUDE.md`**: port reference.
5. Paraglide config: no change.
6. PostHog `api_host`: no change.

### Acceptance
- `npm run dev` starts on `http://localhost:3001`.
- From browser console: `fetch('http://localhost:8001/health', {credentials: 'include'})` succeeds.

---

## 3. User model extension

`frontend/src/features/auth/data/auth.types.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  role: "mentee" | "mentor" | "admin" | "partner" | "guest" | "support" | "hub" | "moderator";
  role_id: number;
  picture?: string | null;
  preferred_language?: string | null;
  timezone?: string | null;
}

export interface MeResponse {
  user: User;
}
```

Remove the `CallbackResponse` type — no longer used.

### Acceptance
- `rg "CallbackResponse"` in `frontend/` returns nothing.
- `npm run typecheck` passes after every consumer of `User` is updated.

---

## 4. Auth service — `frontend/src/features/auth/data/auth.service.ts`

The stub currently XHRs `/api/auth/callback`. Under the MVP flow, the backend handles the code exchange server-side and redirects to `/chat` with the session cookie set. **The frontend never touches `/api/auth/callback` directly.**

Rewrite:

```typescript
import { api } from "@/lib/api/client";
import { API_URL } from "@/lib/api/config";

export const authService = {
  /**
   * Full redirect to the backend /api/auth/login endpoint. The backend runs
   * the PKCE flow, redirects the browser through Mentee, and lands the user
   * on /chat with a session cookie already set.
   */
  startLogin: (opts?: { redirectTo?: string }) => {
    const qs = opts?.redirectTo
      ? `?redirect_to=${encodeURIComponent(opts.redirectTo)}`
      : "";
    window.location.href = `${API_URL}/api/auth/login${qs}`;
  },

  logout: () => api.post<{ ok: boolean }>("/api/auth/logout"),
};
```

### Acceptance
- `rg "exchangeCode" frontend/src/` → no matches.
- `startLogin({redirectTo: "/chat"})` navigates to `http://localhost:8001/api/auth/login?redirect_to=%2Fchat`.

---

## 5. Routes

### 5.1 Delete `src/routes/auth.callback.tsx`

The backend redirects to `/chat` directly; there is no code-exchange step on the client. Remove the file and let TanStack's router regenerate `routeTree.gen.ts`.

*If you're worried about in-flight user redirects landing here during a deploy overlap, replace the body with* `<Navigate to="/chat" />` *and remove in a follow-up release.*

### 5.2 New `/auth/error` route — `src/routes/auth.error.tsx`

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";

type ErrorSearch = { reason?: string };

export const Route = createFileRoute("/auth/error")({
  validateSearch: (search: Record<string, unknown>): ErrorSearch => ({
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: AuthErrorPage,
});

function AuthErrorPage() {
  const { reason } = Route.useSearch();
  const message = translateReason(reason);

  return (
    <main className="page-wrap px-4 pb-16 pt-20 text-center">
      <section className="mx-auto max-w-md">
        <h1 className="display-title mb-3 text-2xl font-bold text-[var(--theme-primary)]">
          {m.auth_error_title()}
        </h1>
        <p className="mb-6 text-[var(--theme-muted)]">{message}</p>
        <Link to="/" className="btn-primary">
          {m.auth_back_home()}
        </Link>
      </section>
    </main>
  );
}

function translateReason(reason?: string): string {
  // Reasons match the backend's /api/auth/callback error mapping (backend plan §11).
  // Mentee (the provider) passes OAuth 2.0 standard error codes through verbatim.
  switch (reason) {
    case "access_denied":   return m.auth_error_denied();
    case "login_required":  return m.auth_error_login_required();
    case "invalid_scope":   return m.auth_error_generic();
    case "missing_params":  return m.auth_error_generic();
    case "oauth":           return m.auth_error_generic();
    default:                return m.auth_error_unknown();
  }
}
```

### 5.3 Landing page — unchanged structure

`src/routes/index.tsx` already branches on `useSession()` and calls `authService.startLogin()`. Only the service call-site changes (no more `exchangeCode`).

### 5.4 Route tree regen

`npm run dev` auto-regenerates `routeTree.gen.ts` via `@tanstack/react-start`.

### Acceptance
- `/auth/callback` returns 404 (or redirects to `/chat` if you kept the stub Navigate).
- `/auth/error?reason=access_denied` renders the localized message.

---

## 6. Session hook — `src/features/auth/hooks/useSession.ts`

Signature unchanged: `useSession()` returns `UseQueryResult<User | null>`. The `User` shape is richer (see §3).

Behavior tweak: after the browser returns from the OAuth redirect chain, the cookie is freshly set, but React Query may have cached `null` at initial page load. Invalidate on `/chat` mount:

```tsx
// src/routes/chat.tsx
import { useQueryClient } from "@tanstack/react-query";
import { sessionQueryOptions } from "@/features/auth/data/session.query";

function ChatPage() {
  const qc = useQueryClient();
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    qc.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
  }, [qc]);

  useEffect(() => {
    if (!session.isPending && !session.data) navigate({ to: "/" });
  }, [session.isPending, session.data, navigate]);

  if (session.isPending) return <PageShell>{m.chat_loading_conversation()}</PageShell>;
  if (!session.data)     return null;
  return <PageShell><ChatView userName={session.data.name} /></PageShell>;
}
```

Alternative: set `refetchOnMount: "always"` on `sessionQueryOptions`.

### Acceptance
- After the OAuth redirect chain, `/chat` shows the user's name without a visible "loading then not-logged-in" flash.

---

## 7. Logout flow

```typescript
export function useLogoutMutation() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authService.logout,
    onSuccess: () => {
      qc.setQueryData(sessionQueryOptions.queryKey, null);
      qc.invalidateQueries({ queryKey: ["chat"] });
      navigate({ to: "/" });
    },
  });
}
```

Backend revokes the Mentee refresh token server-side (see backend plan §10). Frontend just clears local cache + sends the user home.

---

## 8. 401 handling on gated routes

So expired sessions degrade gracefully: on any `ApiError` with status 401, clear the session cache and nav home.

Two approaches:

**Approach A — in `lib/api/client.ts`** (global)
```typescript
// pseudo-code; avoid circular deps by injecting queryClient/router at construction time
if (response.status === 401) {
  queryClient.setQueryData(sessionQueryOptions.queryKey, null);
  if (router.state.location.pathname !== "/") router.navigate({ to: "/" });
}
```

**Approach B — per-consumer error boundary** (simpler, less coupling)
Each query that might 401 has `throwOnError` set, and an error boundary at the layout level handles the redirect.

Pick A or B based on code style preference; the behavior is identical.

### Acceptance
- Force-expire a session server-side (delete the row in Postgres). Click around the chat. The app redirects to `/`; no red console errors.

---

## 9. UI copy (i18n)

Add to `messages/en.json` (and every other locale file present):

```json
{
  "landing_cta_signin":         "Login with Mentee",
  "auth_error_title":           "Sign-in didn't complete",
  "auth_error_denied":          "You declined to share your Mentee account.",
  "auth_error_login_required":  "You need to be signed in to Mentee first.",
  "auth_error_generic":         "Something went wrong talking to Mentee. Please try again.",
  "auth_error_unknown":         "We couldn't sign you in. Please try again.",
  "auth_back_home":             "Back to home"
}
```

Run `npx paraglide-js compile` after editing.

---

## 10. Analytics (PostHog)

On `useSession().data` transitioning null → User, call `posthog.identify(user.id, {email, name, role})`. On logout, `posthog.reset()`. Gate on `VITE_POSTHOG_KEY` presence.

```tsx
useEffect(() => {
  if (session.data) {
    posthog.identify(session.data.id, {
      email: session.data.email,
      name: session.data.name,
      role: session.data.role,
    });
  }
}, [session.data?.id]);
```

---

## 11. Tests (Vitest + jsdom)

### Unit

- `features/auth/data/auth.service.test.ts`:
  - `startLogin` sets `window.location.href` correctly.
  - `startLogin({redirectTo: "/chat"})` URL-encodes the path.

### Component

- `routes/auth.error.test.tsx`: every `reason` renders correct message.
- `routes/index.test.tsx`:
  - Shows "Login with Mentee" when session is `null`.
  - Shows "Go to Chat" when session is a User.
  - Clicking the login button calls `authService.startLogin`.
- `routes/chat.test.tsx`:
  - Redirects to `/` when session is null.
  - Renders chat when session is a User.

### Integration (optional — Playwright)

Stub the backend's `/api/auth/login` → 302 to an endpoint that sets the cookie directly. Verify landing on `/chat` authenticated.

---

## 12. Visual QA checklist

- [ ] Landing (logged out): localized "Login with Mentee" button visible.
- [ ] Click → redirect chain → `/chat` with user name in header.
- [ ] Refresh `/chat`: still authenticated.
- [ ] Click logout → back to `/`, button is "Login with Mentee".
- [ ] Delete `mentee_session` cookie manually → reload `/chat` → redirected to `/`.
- [ ] `/auth/error?reason=access_denied` → localized error.
- [ ] Mobile + desktop.
- [ ] `document.cookie` in devtools never shows `mentee_session`.
- [ ] Network tab: `/api/auth/me` returns extended User; no `Authorization` header sent by frontend (cookies only).

---

## 13. Rollout order

1. §2 port move.
2. §3 User type extension.
3. §4 authService rewrite.
4. §5 routes (delete callback, add error).
5. §9 i18n keys.
6. §6 useSession tweak.
7. §7 logout navigation.
8. §8 401 handling.
9. §10 analytics.
10. §11 tests.

After each step: `npm run lint && npm run typecheck && npm run test`.

---

## 14. Definition of done

- 1 click on "Login with Mentee" on `http://localhost:3001` with a logged-in Mentee session completes in ≤2 seconds; user lands on `/chat` with real Mentee name + role visible.
- Logging out clears the session and returns to `/`.
- Forcing a 401 anywhere degrades cleanly: no error toast, redirect to `/`.
- `npm run typecheck` passes with the extended `User` type.
- All Vitest tests in §11 pass.
- Paraglide compiles; every new key exists in every locale.
- `frontend/CLAUDE.md` describes the real flow; stub references removed.
