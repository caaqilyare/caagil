# syntax=docker/dockerfile:1
# ── build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
# Cache mounts keep the npm download cache between updates: a rebuild only
# downloads packages that are not already on disk, and `npm ci` fails fast
# when the lockfile drifted out of sync (falls back to npm install).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js keeps its incremental build cache in .next/cache; persisting it in
# a BuildKit cache mount makes repeat panel updates rebuild only what changed
# instead of recompiling the whole app from zero.
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ── run ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache git openssh-client ca-certificates tzdata

# Commit the panel was built from, used by the updater to tell whether
# GitHub main is ahead of the running image.
ARG CAAQIL_COMMIT=unknown
ENV CAAQIL_COMMIT=$CAAQIL_COMMIT

ENV NODE_ENV=production \
    PORT=4000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 4000
CMD ["node", "server.js"]
