# Railway picks this Dockerfile up automatically when present and skips
# Railpack's auto-detection. Uses `npm install` (not `npm ci`) to side-step
# cross-platform lockfile quirks with Nitro's optional peer deps — the build
# still stays reproducible because the resulting image is locked by git SHA.

FROM node:22-alpine AS build
WORKDIR /app

# Vite inlines import.meta.env.VITE_* at build time, so these must be
# available during `npm run build`. Dockerfile builds on Railway don't see
# service env vars unless we accept them as ARGs.
ARG VITE_API_URL
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
