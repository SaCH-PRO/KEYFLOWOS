# System Overview

KEYFLOWOS is a vertically integrated business operating system. It combines a NestJS API, a Next.js App Router frontend, a LiveKit/OpenAI Realtime voice worker, and shared workspace packages into a single monorepo.

## Purpose

KEYFLOWOS provides small and medium businesses with CRM, commerce/invoicing, bookings, projects, finance, communications, marketing, contracts, AI assistance (KEY), and business-genome intelligence in one cohesive platform.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Web Client (Next.js 16)                                                    │
│  apps/web/ ── Server Components + Client Components + PWA + service worker  │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │ HTTP / REST / tRPC / WebSocket
┌───────────────────────▼─────────────────────────────────────────────────────┐
│  API Server (NestJS 11)                                                     │
│  apps/server/ ── Controllers, Services, tRPC, Event Bus, Queues, Connectors │
└───────┬───────────────────────┬───────────────────────┬─────────────────────┘
        │                       │                       │
┌───────▼───────┐   ┌───────────▼──────────┐   ┌───────▼────────┐
│ @keyflow/db   │   │ @keyflow/api         │   │ @keyflow/shared│
│ Prisma + pg   │   │ tRPC routers         │   │ Domain consts  │
└───────────────┘   └──────────────────────┘   └────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────────────────┐
│  PostgreSQL + pgvector, Redis, BullMQ, S3/MinIO, LiveKit, external APIs     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Applications and Packages

| Name | Path | Technology | Role |
|------|------|------------|------|
| `server` | `apps/server/` | NestJS 11, tRPC 10, BullMQ, Vitest | API, background jobs, connectors, AI gateway |
| `web` | `apps/web/` | Next.js 16.2.4, React 19, Tailwind | App Router frontend, PWA, admin, public pages |
| `voice-agent` | `apps/voice-agent/` | LiveKit agents, OpenAI Realtime | Full-duplex in-app voice worker |
| `@keyflow/db` | `packages/db/` | Prisma 6, `pg` adapter | Schema, generated client, tenant/soft-delete/encryption extensions |
| `@keyflow/api` | `packages/api/` | tRPC 10, Zod | Typed routers mounted by the server |
| `@keyflow/shared` | `packages/shared/` | TypeScript | Domain constants and pure helpers (contacts, calendar, relationships) |
| `@keyflow/ui` | `packages/ui/` | React, Tailwind, Storybook | Shared presentational components |

## Main Entry Points

| Runtime | Entry File | Notes |
|---------|-----------|-------|
| API server dev/prod | `apps/server/src/main.ts` → `apps/server/dist/main.js` | Must be compiled; `tsx` breaks decorator metadata. Listens on `PORT` (default 3001). |
| Web app | `apps/web/src/app/layout.tsx` (root) / `apps/web/src/app/app/layout.tsx` (auth shell) | Next.js App Router, standalone output, port 5000. |
| Voice worker | `apps/voice-agent/src/main.ts` → `apps/voice-agent/dist/main.js` | LiveKit agents CLI. |
| tRPC API | `packages/api/src/root.ts` mounted via `apps/server/src/trpc.module.ts` at `/trpc` | Context built from Express `req.user`/`req.business`. |
| DB client | `packages/db/src/index.ts` → `packages/db/src/client.ts` | Requires `setTenantContextProvider()` before serving traffic. |
| Health probes | API: `apps/server/src/app.controller.ts`; Web: `apps/web/src/app/api/healthz/route.ts` | Web probes API `/readyz`. |

## Key Runtime Characteristics

- **Monorepo tooling:** pnpm 9.15.0 workspaces + Turborepo.
- **Compiled server required:** workspace packages and server must be built before dev/start.
- **Tenant isolation:** `AsyncLocalStorage`-based Prisma extension auto-injects `businessId` for intercepted operations.
- **Dual auth:** Supabase JWT primary; local HMAC-JWT admin token fallback.
- **Event-driven:** `@nestjs/event-emitter` with 276 registered event names.
- **Queue-backed:** BullMQ for business-event log and temporal-flow memory.
- **Connector framework:** 24 connector types with OAuth credential encryption.
