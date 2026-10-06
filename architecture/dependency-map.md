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

## Agent Control Plane: Authority Fold

`scripts/agent-control` is plain Node ESM with no workspace dependencies. The live typed-authority fold (KF-META-STATE-REDUCER-LIVE-001; path in `execution-paths.md` §12) imports in one direction only, as recorded in `dependencies.json`:

```
orchestrate.mjs, status.mjs → lib/truth.mjs → lib/reconcile.mjs → lib/authority-effects.mjs
lib/reconcile.mjs, lib/authority-effects.mjs → lib/control-envelope.mjs (the one #80 parser)
lib/authority-effects.mjs → lib/state-machine.mjs (HEALTH), lib/state.mjs (validateState)
lib/reconcile.mjs → lib/state.mjs (validateState)
normalize-event.mjs, orchestrate.mjs → lib/events.mjs → lib/authority-effects.mjs (readEffect), lib/control-envelope.mjs
```

`lib/events.mjs` reads a HOLD or RESUME comment's effect with the fold's own `readEffect()`, so the wake decision and the fold cannot read the same comment differently.

`authority-effects.mjs` does no I/O. `truth.mjs` alone reads #80 and repository truth through `gh`.

## KEY Action Boundary

KF-EXEC-ACTION-001 (`execution-paths.md` §13). `KeyActionBoundaryService` is provided and exported by `KeyAutonomyModule`.

```
flow-orchestrator.service.ts            → key-autonomy/action-boundary/key-action-boundary.service.ts (ModuleRef, at call time)
key-action-proposal.service.ts          → key-action-boundary.service.ts (constructor)
key-action-boundary.service.ts          → capabilities/capability-contract.service.ts
                                        → ai/ai-oversight.service.ts
                                        → helpdesk/helpdesk.service.ts
                                        → temporal-flow/temporal-flow.service.ts
                                          (all four through ModuleRef, at call time)
                                        → action-envelope.ts, control-clearance.ts, shadow-parity.ts
control-clearance.ts                    → core/authority/approval-tier.ts, core/authority/module-vocabulary.ts
shadow-parity.ts                        → control-clearance.ts (types)
```

The three pure files import nothing from NestJS or Prisma. `action-envelope.ts` imports only `crypto`.

The surfaces see the `ActionContext` type only through the orchestrator's method signatures. `phone-voice`, `conversational-ai`, `action-dispatcher`, `key-cortex-action-executor.plugin`, `key-cortex-efferent-bridge` and `graph-actions.controller` each pass a literal `{ surface: '...' }`. One of them imports the boundary file: `key-cortex-efferent-bridge.service.ts` imports `ActionNotClearedError` from it, to tell a boundary answer from a failure. `key-cortex` already imports `key-autonomy`, so this adds no module edge.

No new module edge: `AiModule`, `KeyAutonomyModule` and `KeyCortexModule` already `forwardRef` each other, which is why every cross-module collaborator above is resolved lazily.

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

Nearly every module depends on `@keyflow/db` either directly or through `PrismaService`. The Prisma schema (`packages/db/prisma/schema.prisma`) is the single source of truth for ~440 models (verified 2026-08-11). Tenant isolation is applied transparently by the client extension in `packages/db/src/client.ts`.
