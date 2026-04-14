# Agent instructions

This project is a TanStack Start app (React 19, TanStack Router file-based routes in `src/routes/`, TanStack Query, TanStack Store, Tailwind CSS 4, Vite, Biome).

<!-- intent-skills:start -->
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "Creating or modifying file-based routes under src/routes/ (route trees, createFileRoute, root route)"
    load: "node_modules/@tanstack/router-core/skills/router-core/SKILL.md"

  - task: "Route loaders, staleTime/gcTime caching, pending/error components, router context, deferred data"
    load: "node_modules/@tanstack/router-core/skills/router-core/data-loading/SKILL.md"

  - task: "Link, useNavigate, preloading, navigation blocking, scroll restoration"
    load: "node_modules/@tanstack/router-core/skills/router-core/navigation/SKILL.md"

  - task: "Search params validation with Zod/Valibot, fallback, search middlewares, custom serialization"
    load: "node_modules/@tanstack/router-core/skills/router-core/search-params/SKILL.md"

  - task: "Dynamic path segments ($param), splat routes, optional params, useParams"
    load: "node_modules/@tanstack/router-core/skills/router-core/path-params/SKILL.md"

  - task: "Route protection with beforeLoad, redirects, authenticated layout routes, RBAC"
    load: "node_modules/@tanstack/router-core/skills/router-core/auth-and-guards/SKILL.md"

  - task: "Code splitting with .lazy.tsx, createLazyFileRoute, getRouteApi, lazyRouteComponent"
    load: "node_modules/@tanstack/router-core/skills/router-core/code-splitting/SKILL.md"

  - task: "notFound(), errorComponent, CatchBoundary, route masking"
    load: "node_modules/@tanstack/router-core/skills/router-core/not-found-and-errors/SKILL.md"

  - task: "Type-safe router usage: Register declaration, from narrowing, getRouteApi, LinkProps"
    load: "node_modules/@tanstack/router-core/skills/router-core/type-safety/SKILL.md"

  - task: "TanStack Router Vite plugin: autoCodeSplitting, routesDirectory, code split groupings"
    load: "node_modules/@tanstack/router-plugin/skills/router-plugin/SKILL.md"

  - task: "React bindings for TanStack Start: createStart, StartClient, StartServer, useServerFn"
    load: "node_modules/@tanstack/react-start/skills/react-start/SKILL.md"

  - task: "TanStack Start Vite plugin, getRouter() factory, root route document shell (HeadContent, Scripts, Outlet)"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/SKILL.md"

  - task: "createServerFn, inputValidator, useServerFn, server context, streaming, FormData"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/server-functions/SKILL.md"

  - task: "Server-side API endpoints on createFileRoute (GET/POST/PUT/DELETE), createHandlers"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/server-routes/SKILL.md"

  - task: "createMiddleware for request/server-function middleware, context passing, sendContext, global middleware"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/middleware/SKILL.md"

  - task: "Isomorphic code: createServerOnlyFn/createClientOnlyFn, ClientOnly, env var safety (VITE_ prefix)"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/execution-model/SKILL.md"

  - task: "Deploy to Cloudflare/Netlify/Vercel/Node/Bun, SSR per route, SPA mode, prerendering, ISR"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md"

  - task: "Server runtime: createStartHandler, getRequest, setResponseHeader, setCookie/getCookie, useSession"
    load: "node_modules/@tanstack/start-server-core/skills/start-server-core/SKILL.md"

  - task: "SSR specifics: RouterClient/RouterServer, streaming, HeadContent/Scripts, head option (meta/links)"
    load: "node_modules/@tanstack/router-core/skills/router-core/ssr/SKILL.md"

  - task: "Adding a TanStack ecosystem integration/add-on to this existing app (tanstack add)"
    load: "node_modules/@tanstack/cli/skills/add-addons-existing-app/SKILL.md"

  - task: "Discovering add-on ids and ecosystem partner options (tanstack ecosystem, --list-add-ons --json)"
    load: "node_modules/@tanstack/cli/skills/choose-ecosystem-integrations/SKILL.md"

  - task: "Retrieving machine-readable TanStack docs/metadata (tanstack libraries, tanstack doc, tanstack search-docs)"
    load: "node_modules/@tanstack/cli/skills/query-docs-library-metadata/SKILL.md"

  - task: "Installing TanStack Devtools shell, picking adapter, registering plugins, hotkeys/theme config"
    load: "node_modules/@tanstack/devtools/skills/devtools-app-setup/SKILL.md"

  - task: "Stripping/guarding devtools for production (removeDevtoolsOnBuild, NoOp variants, conditional imports)"
    load: "node_modules/@tanstack/devtools/skills/devtools-production/SKILL.md"

  - task: "Configuring @tanstack/devtools-vite plugin (must be FIRST plugin): source inspection, console piping, editor integration"
    load: "node_modules/@tanstack/devtools-vite/skills/devtools-vite-plugin/SKILL.md"

  - task: "Creating a typed EventClient for a library (event maps, pluginId, emit/on, SSR fallbacks, singleton)"
    load: "node_modules/@tanstack/devtools-event-client/skills/devtools-event-client/SKILL.md"
<!-- intent-skills:end -->
