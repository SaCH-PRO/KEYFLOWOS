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
# and @keyflow/api imports @keyflow/db's declarations.
RUN pnpm --filter @keyflow/shared build
RUN pnpm --filter @keyflow/db build
RUN pnpm --filter @keyflow/api build
RUN pnpm --filter web build
RUN pnpm --filter server build
RUN pnpm --filter @keyflow/voice-agent build


# -----------------------------------------------------------------------------
# Server runtime — runs the COMPILED server (node dist/main.js).
# tsx cannot preserve emitDecoratorMetadata, so NestJS DI fails under it;
# the builder stage above compiles workspace packages + server with tsc.
# -----------------------------------------------------------------------------
FROM base AS server
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/db/package.json  ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/patches ./patches
# Full workspace install: filtered installs skip workspace deps' devDeps
# (including the prisma CLI needed for client generation). NODE_ENV is set
# only after generate so pnpm does not skip devDependencies.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @keyflow/db run db:generate
ENV NODE_ENV=production
ENV PORT=3001
# Compiled output from the builder stage
COPY --from=builder /app/apps/server/dist        ./apps/server/dist
COPY --from=builder /app/packages/db/dist        ./packages/db/dist
COPY --from=builder /app/packages/db/prisma      ./packages/db/prisma
COPY --from=builder /app/packages/api/dist       ./packages/api/dist
COPY --from=builder /app/packages/shared/dist    ./packages/shared/dist
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/main.js"]


# -----------------------------------------------------------------------------
# Voice agent runtime — KEY's LiveKit voice worker (compiled dist).
# -----------------------------------------------------------------------------
FROM base AS voice-agent
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/voice-agent/package.json ./apps/voice-agent/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @keyflow/db run db:generate
ENV NODE_ENV=production
COPY --from=builder /app/apps/voice-agent/dist ./apps/voice-agent/dist
COPY --from=builder /app/packages/db/dist      ./packages/db/dist
COPY --from=builder /app/packages/db/prisma    ./packages/db/prisma
# LiveKit agents CLI: `node dist/main.js start` runs the worker in production mode
ENTRYPOINT ["/sbin/tini", "--"]
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
COPY --from=builder /app/packages/ui/src ./packages/ui/src
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "web", "start"]
