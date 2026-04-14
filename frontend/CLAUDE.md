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

- **Routing**: file-based via TanStack Router in `src/routes/`. `src/routeTree.gen.ts` is generated (Biome-ignored) — don't hand-edit. Root shell is `src/routes/__root.tsx` and wires `PostHogProvider`, `Header`/`Footer`, and `TanStackDevtools` (Router + Store + Query panels). The router is created in `src/router.tsx` via `getRouter()` with SSR+Query integration (`setupRouterSsrQueryIntegration`), `defaultPreload: 'intent'`, and `scrollRestoration: true`.
- **Path aliases**: both `#/*` and `@/*` resolve to `src/*` (tsconfig `paths` + package `imports`). Prefer these over relative paths across module boundaries.
- **i18n (Paraglide)**: generates into `src/paraglide/` during dev/build; messages live in `project.inlang/messages`. URLs are localized via the Paraglide Vite plugin and router `rewrite` hooks. Strategy is `['url', 'baseLocale']`.
- **Styling**: Tailwind v4 via `@tailwindcss/vite`; single import in `src/styles.css` (Biome-ignored). A pre-hydration `THEME_INIT_SCRIPT` in `__root.tsx` sets `light`/`dark`/`auto` from `localStorage` — preserve it when touching the root document.
- **React Compiler**: enabled via `babel-plugin-react-compiler` in `vite.config.ts`. Don't hand-apply `useMemo`/`useCallback` for the compiler's sake.
- **Vite plugin order** matters: `devtools()` stays first, then `paraglideVitePlugin`, `tailwindcss`, `tanstackStart`, `viteReact`.
- **Testing**: Vitest + jsdom + `@testing-library/react` are installed but no tests or setup file exist yet. If you add tests, set up the jsdom env and any global setup before writing them.

## Tooling Conventions

- Biome 2 is the single source for lint + format (tabs for indent, double quotes). `src/routeTree.gen.ts` and `src/styles.css` are excluded — don't override this.
- Strict TS: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports` are on. Use `import type` for type-only imports.
