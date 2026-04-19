# Frontend

TanStack Start app for the Mentee bot.

## Stack

- React 19 + React Compiler
- TanStack Start / Router / Query / Store
- Vite
- Tailwind CSS 4
- Biome (lint + format)
- Paraglide (i18n)
- PostHog (analytics)

## Setup

```bash
npm install
cp .env.local.example .env.local  # if present — otherwise create .env.local
```

## Commands

```bash
npm run dev       # vite dev server on port 3001
npm run build     # production build
npm run preview   # preview production build
npm run test      # vitest (single run)
npm run lint      # biome lint
npm run format    # biome format
npm run check     # biome lint + format
```

## Project Layout

- `src/routes/` — file-based routes (TanStack Router)
- `src/components/` — shared components
- `src/integrations/` — third-party integrations (PostHog, TanStack Query)
- `src/lib/` — utilities
- `messages/` — i18n message sources (Paraglide)
- `project.inlang/` — Paraglide i18n config

Path aliases `#/*` and `@/*` both resolve to `src/*`.

## Environment

Required `.env.local` variables:

- `VITE_API_URL` — backend base URL (defaults to `http://localhost:8001`)
- `VITE_POSTHOG_KEY` — PostHog project API key
- `VITE_POSTHOG_HOST` — optional, set for EU Cloud or self-hosted PostHog

## Adding UI Components

This project uses [shadcn/ui](https://ui.shadcn.com/):

```bash
pnpm dlx shadcn@latest add <component>
```
