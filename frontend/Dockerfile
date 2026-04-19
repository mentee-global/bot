# Railway picks this Dockerfile up automatically when present and skips
# Railpack's auto-detection. Uses `npm install` (not `npm ci`) to side-step
# cross-platform lockfile quirks with Nitro's optional peer deps — the build
# still stays reproducible because the resulting image is locked by git SHA.

FROM node:22-alpine AS build
WORKDIR /app

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
