import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { getContext } from './integrations/tanstack-query/root-provider'
import { deLocalizeUrl, localizeUrl } from './paraglide/runtime'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Paraglide URL strategy: strip the locale prefix before the router matches
    // routes (so `/es/chat` resolves to the `/chat` route) and add it back when
    // the router emits URLs (so `Link to="/chat"` renders as `/es/chat` when the
    // active locale is Spanish).
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
