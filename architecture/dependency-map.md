# Dependency Map

This document summarizes the major import and dependency relationships discovered in the baseline cartography. For the raw import graph, see `architecture/dependencies.json` (produced by `dependency_scan.py`).

## Package-Level Dependencies

```
┌──────────────┐     imports      ┌──────────────┐
│   apps/web   │──────────────────▶│ @keyflow/ui  │
│              │──────────────────▶│ @keyflow/shared│
└──────┬───────┘                   └──────────────┘
       │
       │ HTTP / REST / tRPC / WebSocket
       ▼
┌──────────────┐     imports      ┌──────────────┐
│  apps/server │──────────────────▶│ @keyflow/api │
│              │──────────────────▶│ @keyflow/db  │
│              │──────────────────▶│ @keyflow/shared│
└──────┬───────┘                   └──────────────┘
       │
       │ imports
       ▼
┌──────────────────────────────────────────────┐
│ External SDKs: openai, stripe, paypal, livekit, │
│ bullmq, ioredis, @supabase/supabase-js, etc.    │
└──────────────────────────────────────────────┘
```

| Consumer | Workspace Dependencies | Key External Dependencies |
|----------|------------------------|---------------------------|
| `apps/web` | `@keyflow/ui`, `@keyflow/shared` | Next.js, React, Tailwind, Supabase client, LiveKit client, Sentry, Stripe/PayPal/Google Pay display SDKs |
| `apps/server` | `@keyflow/api`, `@keyflow/db`, `@keyflow/shared` | NestJS, tRPC, Prisma, OpenAI, Anthropic, Stripe, PayPal, Twilio, LiveKit, WhatsApp/Meta, Redis, BullMQ, S3 SDK |
| `apps/voice-agent` | `@keyflow/db` | LiveKit agents, OpenAI Realtime |
| `packages/api` | `@keyflow/db`, `@prisma/client` | tRPC 10, Zod |
| `packages/db` | — | Prisma 6, `@prisma/adapter-pg`, `pg`, `pgvector` |
| `packages/shared` | — | None (pure TypeScript) |
| `packages/ui` | — | React, Tailwind, Storybook/Vite |

## Cross-Module Coupling (Server)

### High-Fan Modules

- **`modules/ai`** — imported by 30+ other modules (bookings, commerce, crm, key-cortex, identity, etc.). It provides the `ModelGatewayService` and related AI utilities.
- **`modules/key-cortex`** — the largest module (~80 services, ~248 files). It aggregates context from many domains and is imported by command-center, commerce, crm, intelligence, and others.
- **`core/prisma`** — used by almost every service.
- **`core/redis`** — used by caches, queues, auth, and rate-limit stores.
- **`core/event-bus`** — global event emitter; many modules publish and subscribe.

### Circular Dependencies

The codebase uses `forwardRef(() => ...)` extensively to resolve circular module dependencies. Known clusters include:

- AI / Cortex / Autonomy / Commerce / CRM
- Business-genome / Business-genesis / Blueprint / Key-cortex
- Key-inbox / Communications / CRM

These cycles are currently handled by `forwardRef`, but they are a structural risk. See `architecture/architecture-risks.md`.

## tRPC Router Mounting

`packages/api/src/root.ts` composes all sub-routers. `apps/server/src/trpc.module.ts` imports `appRouter` and mounts it at `/trpc` using the tRPC Express adapter. Routers include:

`identity`, `crm`, `commerce`, `bookings`, `events`, `social`, `automation`, `site`, `admin`, `diagnostics`, `supplier`, `keyConnector`.

## Event-Driven Coupling

The NestJS event bus decouples some cross-module workflows. Key event families:

- `contact.*` — created/updated by CRM; consumed by key-inbox, communications, cortex.
- `booking.created` — emitted by tRPC bookings router and calendar services.
- `invoice.paid` — emitted by commerce router and payment services.
- `business-event.*` — canonical audit/event log persisted by `business-events` queue.

See `architecture/event-registry.yaml` for the full list of 276 event names.

## External Integration Dependencies

| Integration | Primary Server Files | Primary Web Files |
|-------------|----------------------|-------------------|
| Supabase Auth | `core/auth/*`, `modules/identity/*` | `app/auth/*`, `lib/api.ts`, `components/require-auth.tsx` |
| OpenAI / LLMs | `modules/ai/model-gateway.service.ts`, `voice-agent/src/main.ts` | — |
| LiveKit | `modules/livekit/livekit.service.ts` | `components/key/chat/key-live-voice.tsx` |
| Stripe | `modules/payments/payments.service.ts`, `modules/webhooks/webhooks.controller.ts` | `app/widgets/pay/[invoiceId]/page.tsx` |
| PayPal | `modules/payments/payments.service.ts`, `core/connectors/implementations/paypal.connector.ts` | — |
| Google OAuth / Drive / Gmail / Calendar | `modules/google-drive/*`, `core/connectors/implementations/google-*` | `app/api/*/callback/route.ts` |
| WhatsApp / Twilio | `modules/whatsapp/*` | — |
| Redis | `core/redis/*`, BullMQ queues | — |
| S3 / MinIO | `core/object-storage/objectStorage.ts` | — |
| Resend | `modules/notifications/system-email.service.ts` | — |

## Database Dependency

Nearly every module depends on `@keyflow/db` either directly or through `PrismaService`. The Prisma schema (`packages/db/prisma/schema.prisma`) is the single source of truth for ~439 models. Tenant isolation is applied transparently by the client extension in `packages/db/src/client.ts`.
