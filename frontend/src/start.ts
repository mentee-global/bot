import { createStart } from '@tanstack/react-start'

// Paraglide's request-scoped AsyncLocalStorage is set up in `src/server.ts`
// via `paraglideMiddleware` (server-only). This file must exist so that
// TanStack Start's `#tanstack-start-entry` alias resolves; keep it free of
// any Node-only imports so it can safely be evaluated in the client bundle.
export const startInstance = createStart(() => ({}))
