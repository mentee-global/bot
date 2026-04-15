@AGENTS.md

# Frontend

TanStack Start app (React 19, TanStack Router/Query/Store, Tailwind 4, Biome, Vite, Paraglide i18n, PostHog). See `AGENTS.md` above for the skill-mapping table — load the linked `SKILL.md` when working in the listed areas.

## Commands

```bash
npm run dev        # vite dev on port 3000
npm run build
npm run preview
npm run test       # vitest run (single pass; append filename/pattern to target one test)
npm run lint       # biome lint
npm run format     # biome format
npm run check      # biome check (lint + format)
```

Shadcn components: `pnpm dlx shadcn@latest add <component>` (per `.cursorrules`).

## Architecture Notes

- **Routing**: file-based via TanStack Router in `src/routes/`. `src/routeTree.gen.ts` is generated (Biome-ignored) — don't hand-edit. Root shell is `src/routes/__root.tsx` and wires `PostHogProvider`, `Header`/`Footer`, and `TanStackDevtools` (Router + Query panels). The router is created in `src/router.tsx` via `getRouter()` with SSR+Query integration (`setupRouterSsrQueryIntegration`), `defaultPreload: 'intent'`, and `scrollRestoration: true`.
- **Path aliases**: both `#/*` and `@/*` resolve to `src/*` (tsconfig `paths` + package `imports`). Prefer these over relative paths across module boundaries.
- **Feature modules** live under `src/features/<domain>/` with a fixed shape:
	- `data/` — `<domain>.service.ts` (fetch calls + `queryOptions`) and `<domain>.types.ts` (API-shape types, snake_case to mirror FastAPI responses).
	- `hooks/` — React Query hooks (`use*Query`, `use*Mutation`) + a `<domain>Keys.ts` key factory.
	- `components/` — domain-scoped UI (e.g. `ChatInput`, `MessageList`, `ChatMessage`).
	Routes in `src/routes/` are thin — they compose feature hooks and components, and only own page layout / redirect logic.
- **API client**: `src/lib/api/client.ts` is the single fetch wrapper. It reads `VITE_API_URL` (default `http://localhost:8000`), always sends `credentials: 'include'` (session cookie), and throws `ApiError` (`src/lib/api/errors.ts`) on non-2xx. Never call `fetch` directly from feature code — go through `api.get/post/delete`.
- **Auth flow**: `authService.startLogin()` does a full redirect to `GET /api/auth/login`; backend redirects to `/auth/callback?code=…`; `src/routes/auth.callback.tsx` exchanges the code via `authService.exchangeCode`, seeds `sessionQueryOptions` with `queryClient.setQueryData`, then navigates to `/chat`. `useSession()` (`features/auth/hooks/useSession.ts`) is the single source of truth for the current user; it returns `null` on 401.
- **Chat mutation**: `useSendMessageMutation` optimistically merges both the user and assistant messages into the `chatKeys.thread()` cache via `queryClient.setQueryData` — no refetch round-trip. Preserve this when touching the chat flow.
- **i18n (Paraglide)**: generates into `src/paraglide/` during dev/build; messages live in `messages/<locale>.json`. Base locale is `en` (unprefixed); additional locales (e.g. `es`) live under `/<locale>/*`. Wiring:
	- Strategy `['url', 'cookie', 'preferredLanguage', 'baseLocale']` in `vite.config.ts`: URL is the source of truth; a `PARAGLIDE_LOCALE` cookie makes the choice sticky across first-hit navigations; `Accept-Language` is the fallback on first visit before falling back to the base locale.
	- `src/router.tsx` sets `rewrite.input = deLocalizeUrl` and `rewrite.output = localizeUrl` so the same route tree serves both `/about` and `/es/about`, and `<Link to="/about">` emits `/es/about` when the active locale is Spanish.
	- `src/server.ts` is the TanStack Start server entry and wraps `@tanstack/react-start/server-entry` with Paraglide's `paraglideMiddleware`. The middleware extracts the locale per request and sets up `serverAsyncLocalStorage` via a dynamic `async_hooks` import (server-only, never bundled for the browser). It passes the **original** `req` to the handler — TanStack Router does its own de-localization via `rewrite.input`, so passing the middleware's delocalized request would redirect-loop.
	- `LocaleSwitcher` iterates over the runtime `locales` array (so it auto-scales when you add a locale to `project.inlang/settings.json`). Selecting a locale calls `setLocale()` which full-navigates to the localized URL.
	- `src/routes/__root.tsx` renders `<title>` / `<meta name="description">` via `m.meta_*()` and emits `<link rel="alternate" hreflang>` for every locale + an `x-default`, using the leaf `match.pathname` (which is already delocalized thanks to `rewrite.input`). Add route-level `head()` if a page needs a more specific title.
	- **RTL**: `RootDocument` sets `<html dir>` from a `RTL_LOCALES` set in `__root.tsx`. When adding RTL languages (ar, fa, he, ur, …), extend that set — Paraglide doesn't track direction itself.
	- **Adding a locale**: (1) add the code to `project.inlang/settings.json` `locales`; (2) create `messages/<locale>.json` with every key present in `messages/en.json` (missing keys fall back to the base locale); (3) restart `vite dev` so Paraglide regenerates `src/paraglide/runtime.js` and its `urlPatterns` (e.g. `/pt/*` auto-registers); (4) if you want a nicer label than the uppercased code, add an entry to `LOCALE_LABELS` in `LocaleSwitcher.tsx`; (5) extend `RTL_LOCALES` if the new locale is RTL.
- **Styling**: Tailwind v4 via `@tailwindcss/vite`; single import in `src/styles.css` (Biome-ignored). Theme tokens are CSS custom properties (`var(--theme-*)`) — prefer these over hard-coded colors. A pre-hydration `THEME_INIT_SCRIPT` in `__root.tsx` sets `light`/`dark`/`auto` from `localStorage` — preserve it when touching the root document.
- **React Compiler**: enabled via `babel-plugin-react-compiler` in `vite.config.ts`. Don't hand-apply `useMemo`/`useCallback` for the compiler's sake.
- **Vite plugin order** matters: `devtools()` stays first, then `paraglideVitePlugin`, `tailwindcss`, `tanstackStart`, `viteReact`.
- **Testing**: Vitest + jsdom + `@testing-library/react` are installed but no tests or setup file exist yet. If you add tests, set up the jsdom env and any global setup before writing them.

## Environment

`.env.local` (see `.env.example`):

- `VITE_API_URL` — backend base URL (default `http://localhost:8000`).
- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` — optional analytics.

## Tooling Conventions

- Biome 2 is the single source for lint + format (tabs for indent, double quotes). `src/routeTree.gen.ts` and `src/styles.css` are excluded — don't override this.
- Strict TS: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports` are on. Use `import type` for type-only imports.
