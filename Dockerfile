# syntax=docker/dockerfile:1.7
###############################################################################
# Multi-stage Dockerfile for the KeyflowOS pnpm monorepo.
#
# Targets:
#   - `deps`     : install full pnpm workspace + generated Prisma client
#   - `builder`  : compile NestJS server and Next.js web app
#   - `server`   : runtime image for the API on :3001
#   - `web`      : runtime image for the Next.js app on :5000
#
# Build either runtime image with `--target`:
#   docker build --target server -t keyflowos-api .
#   docker build --target web    -t keyflowos-web .
###############################################################################

ARG NODE_VERSION=20.18.1


# -----------------------------------------------------------------------------
# Base — pnpm + node, shared across stages.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat openssl tini
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app


# -----------------------------------------------------------------------------
# Deps — install everything (incl. dev deps so we can build the apps).
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm.patchedDependencies (next@16.2.4) is applied during install — the patch
# file must exist before `pnpm install` runs.
COPY patches ./patches
COPY apps/server/package.json apps/server/
COPY apps/web/package.json    apps/web/
COPY apps/voice-agent/package.json apps/voice-agent/
COPY packages/api/package.json packages/api/
COPY packages/db/package.json  packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json  packages/ui/
RUN pnpm install --frozen-lockfile --ignore-scripts


# -----------------------------------------------------------------------------
# Builder — copy source, generate Prisma client, build web app, compile server.
# -----------------------------------------------------------------------------
FROM deps AS builder
# Copy Prisma schema first for cacheable client generation
COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/package.json ./packages/db/
RUN pnpm --filter @keyflow/db run db:generate

# Copy remaining source and build apps
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined into the client bundle at build time — pass the
# deployment's public URLs in as build args (compose supplies them from
# .env.production).
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_LIVEKIT_URL=${NEXT_PUBLIC_LIVEKIT_URL}
# The server codebase is large; tsc exceeds Node's ~2GB default heap.
ENV NODE_OPTIONS=--max-old-space-size=4096
# Workspace packages first — web imports @keyflow/shared's compiled output,
# and @keyflow/api imports @keyflow/db's declarations. The runtime stage below
# copies these dist/ outputs — the server cannot run from source (see below).
RUN pnpm --filter @keyflow/shared build
RUN pnpm --filter @keyflow/db build
RUN pnpm --filter @keyflow/api build
RUN pnpm --filter web build
RUN pnpm --filter server build
RUN pnpm --filter @keyflow/voice-agent build


# -----------------------------------------------------------------------------
# Server runtime — runs the COMPILED output.
#
# This stage previously copied only src/ and relied on tsx, while CMD ran
# `pnpm --filter server start`, which is `node dist/main.js`. dist/ was never
# copied, so the container could not start at all.
#
# tsx is not an alternative: it does not emit `design:paramtypes`, so NestJS
# type-based dependency injection fails — 64 "undefined dependency" errors,
# 0 routes mapped, non-zero exit. Verified directly.
#
# The entrypoint is apps/server/dist/main.js, NOT dist/src/main.js. tsconfig
# compiles only src/**, so tsc infers rootDir as src/ and emits straight into
# dist/.
# -----------------------------------------------------------------------------
FROM base AS server
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/db/package.json  ./packages/db/
# Must precede the install: pnpm needs every workspace member's manifest present
# to resolve and link `@keyflow/shared`, which the server depends on.
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
# Prisma schema is still needed: db:generate below regenerates the client
# against this stage's node_modules layer.
COPY --from=builder /app/packages/db/prisma      ./packages/db/prisma
# pnpm.patchedDependencies is resolved during install — the patch files must
# exist in this stage too or `pnpm install` fails.
COPY --from=builder /app/patches ./patches
# Full workspace install, and intentionally NOT --prod: filtered installs skip
# workspace deps' devDeps, including the `prisma` CLI that the db:generate step
# below needs. NODE_ENV is set only after generate so pnpm does not skip
# devDependencies.
RUN pnpm install --frozen-lockfile --ignore-scripts
# Re-generate the Prisma client against this stage's node_modules layer.
RUN pnpm --filter @keyflow/db run db:generate
ENV NODE_ENV=production
ENV PORT=3001
# Compiled output from the builder stage
COPY --from=builder /app/apps/server/dist        ./apps/server/dist
COPY --from=builder /app/packages/db/dist        ./packages/db/dist
COPY --from=builder /app/packages/api/dist       ./packages/api/dist
COPY --from=builder /app/packages/shared/dist    ./packages/shared/dist
# Build identity. getReleaseVersion() (packages/shared/src/release-version.ts:57)
# resolves GIT_COMMIT -> SOURCE_COMMIT -> .deploy-version -> `git rev-parse HEAD`
# -> "unknown". In a container the last two can never work: .dockerignore:16
# excludes .git, and nothing writes .deploy-version. So /healthz reported
# "unknown" and production could not be asked what it was running — which, on
# 2026-08-08, meant confirming a security deploy by grepping compiled JS inside
# the container instead of reading one field.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/main.js"]


# -----------------------------------------------------------------------------
# Voice agent runtime — KEY's LiveKit voice worker (compiled dist).
# LiveKit's rtc native bindings have NO musl builds — this stage must run on
# glibc (Debian), not Alpine.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base-glibc
RUN apt-get update && apt-get install -y --no-install-recommends tini openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base-glibc AS voice-agent
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/voice-agent/package.json ./apps/voice-agent/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/prisma    ./packages/db/prisma
COPY --from=builder /app/patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @keyflow/db run db:generate
ENV NODE_ENV=production
COPY --from=builder /app/apps/voice-agent/dist ./apps/voice-agent/dist
COPY --from=builder /app/packages/db/dist      ./packages/db/dist
# LiveKit agents CLI: `node dist/main.js start` runs the worker in production mode
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/voice-agent/dist/main.js", "start"]


# -----------------------------------------------------------------------------
# Web runtime — Next.js production server
# -----------------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production
ENV PORT=5000
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/packages/ui/package.json ./packages/ui/
COPY --from=builder /app/patches ./patches
RUN pnpm install --frozen-lockfile --prod --filter web... --ignore-scripts
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/
# next.config.ts imports ./src/lib/env at load time
COPY --from=builder /app/apps/web/src/lib/env.ts ./apps/web/src/lib/env.ts
COPY --from=builder /app/packages/ui/src ./packages/ui/src
# Build identity — see the note on the server stage. This is the one /healthz
# actually reads, since /api/healthz is served by the web app.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "web", "start"]
