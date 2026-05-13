# Railway picks this Dockerfile up automatically when present and skips
# Railpack's auto-detection.
#
# Layout follows the official pnpm CI Docker example
# (https://pnpm.io/docker, "Build on CI"): a `pnpm fetch` layer populates the
# virtual store using only the lockfile + pnpm-workspace.yaml, so the dep
# fetch cache survives package.json edits that don't change the lockfile.
#
# Supply-chain controls (defaults in pnpm 11): minimumReleaseAge=1440 (24h
# cooldown on freshly published versions), blockExoticSubdeps, strictDepBuilds
# with an explicit `allowBuilds` allowlist in pnpm-workspace.yaml.

FROM node:22-alpine AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Vite inlines import.meta.env.VITE_* at build time, so these must be
# available during `pnpm run build`. Dockerfile builds on Railway don't see
# service env vars unless we accept them as ARGs.
ARG VITE_API_URL
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

# Activate corepack and pre-download the pnpm version pinned in
# package.json#packageManager. Keep the version pin here in sync with
# package.json — corepack will refuse a mismatch.
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

# Layer 1: hydrate the pnpm store from the lockfile only. Caches independently
# of source and even of package.json metadata edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# Layer 2: bring in the rest of the project and link from the pre-fetched
# store. `--offline` enforces that no network calls happen here, so a
# lockfile/store mismatch fails fast instead of silently re-fetching.
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Nitro self-bundles every runtime dep into .output/server/, so the runtime
# image needs neither pnpm nor node_modules.
COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
