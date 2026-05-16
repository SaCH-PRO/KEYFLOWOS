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
COPY apps/server/package.json apps/server/
COPY apps/web/package.json    apps/web/
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
RUN pnpm --filter web build

# Compile workspace packages and server for CI validation / future migration.
# The runtime stage below still uses tsx for maximum compatibility.
RUN pnpm --filter @keyflow/shared build
RUN pnpm --filter @keyflow/api build
RUN pnpm --filter @keyflow/db build
RUN pnpm --filter server build


# -----------------------------------------------------------------------------
# Server runtime — runs TypeScript directly via tsx.
# NOTE: Compiled dist/ is built above and ready for a future switch to
# `node apps/server/dist/src/main.js` once ESM/CJS interop is fully validated.
# -----------------------------------------------------------------------------
FROM base AS server
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/db/package.json  ./packages/db/
# NOTE: we intentionally do NOT pass --prod here. The server runs from
# TypeScript source via `tsx` (no compiled dist/), and `prisma` (the CLI
# used by the db:generate step below) is a devDependency of @keyflow/db.
RUN pnpm install --frozen-lockfile --filter server... --ignore-scripts
COPY --from=builder /app/apps/server/src       ./apps/server/src
COPY --from=builder /app/apps/server/tsconfig.json ./apps/server/
COPY --from=builder /app/tsconfig.base.json    ./
COPY --from=builder /app/packages/db/prisma    ./packages/db/prisma
COPY --from=builder /app/packages/db/src       ./packages/db/src
COPY --from=builder /app/packages/api/src      ./packages/api/src
# Re-generate the Prisma client against the prod node_modules layer.
RUN pnpm --filter @keyflow/db run db:generate
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "server", "start"]


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
RUN pnpm install --frozen-lockfile --prod --filter web... --ignore-scripts
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/
COPY --from=builder /app/packages/ui/src ./packages/ui/src
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "web", "start"]
