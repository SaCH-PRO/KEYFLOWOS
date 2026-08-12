# Repository Map

This document is a baseline cartography of the KEYFLOWOS monorepo. It combines a canonical directory tree with a responsibility table for the most architecturally significant files. For an exhaustive file list, run `.agents/skills/codebase-architect/scripts/inventory.py`.

## Canonical Directory Tree

```text
.
├── .agents/                    # Agent skill definitions
│   └── skills/
│       └── codebase-architect/ # This skill package
├── .github/                    # CI/CD workflows, PR templates, branch policy
├── apps/
│   ├── server/                 # NestJS API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── app-bootstrap.ts
│   │   │   ├── app.controller.ts
│   │   │   ├── trpc.module.ts
│   │   │   ├── core/           # Cross-cutting infrastructure
│   │   │   │   ├── auth/
│   │   │   │   ├── config/
│   │   │   │   ├── connectors/
│   │   │   │   ├── event-bus/
│   │   │   │   ├── prisma/
│   │   │   │   ├── redis/
│   │   │   │   ├── tenant/
│   │   │   │   └── ...
│   │   │   ├── modules/        # 109 feature modules
│   │   │   └── types/
│   │   └── test/               # Integration / smoke / e2e tests
│   ├── web/                    # Next.js App Router frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (marketing)/
│   │   │   │   ├── auth/
│   │   │   │   ├── app/        # Authenticated shell
│   │   │   │   ├── api/        # Next.js route handlers
│   │   │   │   ├── widgets/
│   │   │   │   ├── book/[slug]/
│   │   │   │   ├── pay/[invoiceId]/
│   │   │   │   └── site/[slug]/
│   │   │   ├── components/
│   │   │   ├── contexts/
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   ├── e2e/                # Playwright specs
│   │   └── public/             # PWA icons, service worker
│   └── voice-agent/            # LiveKit + OpenAI Realtime worker
│       └── src/main.ts
├── packages/
│   ├── api/                    # tRPC routers
│   ├── db/                     # Prisma schema + client extensions
│   ├── shared/                 # Shared TypeScript utilities
│   └── ui/                     # Shared React components + Storybook
├── architecture/               # Architecture memory + generated registries
├── infrastructure/             # Caddyfile, LiveKit configs, env template
├── scripts/                    # Dev, deploy, CI, backfill, audit scripts
├── docs/                       # Runbooks, audits, roadmaps, ADRs
├── AGENTS.md                   # Agent guidance (includes Codebase Architect Policy)
├── docker-compose.yml
├── docker-compose.production.yml
├── Dockerfile
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## Responsibility Table

### Root / Monorepo

| Path | Responsibility | Layer |
|------|----------------|-------|
| `package.json` | Workspace root scripts, engines, pnpm overrides | Root config |
| `pnpm-workspace.yaml` | Declares `apps/*` and `packages/*` | Root config |
| `turbo.json` | Build/test pipeline and remote-cache env list | Root config |
| `tsconfig.base.json` | Shared TS config and path aliases | Root config |
| `Dockerfile` | Multi-stage build for server/web/voice-agent | Infrastructure |
| `docker-compose.yml` | Local dev services (db, redis, minio, docling, livekit, chatwoot) | Infrastructure |
| `docker-compose.production.yml` | Production VPS stack | Infrastructure |
| `.env.example` | Documented environment template | Config reference |

### Server — Bootstrap and Core

| Path | Responsibility | Layer |
|------|----------------|-------|
| `apps/server/src/main.ts` | Bootstraps NestJS, validates env, installs tenant provider, listens on `::`:`PORT` | Entry / Bootstrap |
| `apps/server/src/app-bootstrap.ts` | Express middleware: trust proxy, compression, helmet, CORS, rate limit, timeouts | Bootstrap |
| `apps/server/src/app.module.ts` | Root NestJS module wiring 120+ feature modules and global interceptors | Composition root |
| `apps/server/src/app.controller.ts` | `/healthz`, `/readyz`, `/healthz/events` | Controller |
| `apps/server/src/trpc.module.ts` | Mounts tRPC Express adapter at `/trpc` | Transport / API |
| `apps/server/src/core/config/env.ts` | Boot-time Zod env validation | Config |
| `apps/server/src/core/prisma/prisma.service.ts` | Wraps `@keyflow/db`; connection retry and health check | Data access |
| `apps/server/src/core/auth/auth.middleware.ts` | Attaches `req.user` from Supabase JWT or admin HMAC token | Security |
| `apps/server/src/core/auth/supabase-auth.service.ts` | Verifies access tokens locally or via Supabase | Security |
| `apps/server/src/core/redis/redis.service.ts` | Thin Redis wrapper (get/set/json/ttl/keys/del) | Infrastructure |
| `apps/server/src/core/event-bus/events.types.ts` | Canonical domain event payload definitions | Domain contracts |
| `apps/server/src/core/tenant/tenant-context.ts` | AsyncLocalStorage tenant scope | Infrastructure |
| `apps/server/src/core/tenant/tenant.interceptor.ts` | Sets ALS tenant from params/body/query | Infrastructure |
| `apps/server/src/core/connectors/connector.module.ts` | Registers connector framework + implementations | Integration |
| `apps/server/src/core/connectors/connector.interface.ts` | Connector contract types | Integration contract |

### Server — Major Domain Modules

| Path | Responsibility | Layer |
|------|----------------|-------|
| `apps/server/src/modules/ai/model-gateway.service.ts` | Multi-provider LLM gateway with fallback, budgeting, cost tracking | AI layer |
| `apps/server/src/modules/key-cortex/key-cortex.module.ts` | Large AI/Cortex module wiring ~80 services | AI layer |
| `apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts` | Assembles cross-module business context for AI | AI layer |
| `apps/server/src/modules/business-events/business-event.queue.ts` | BullMQ queue + worker for canonical business event log | Domain / Queue |
| `apps/server/src/modules/payments/payments.service.ts` | Payment processing + reconciliation (Stripe, PayPal, WiPay) | Commerce / Finance |
| `apps/server/src/modules/livekit/livekit.service.ts` | Voice room/token management and agent dispatch | Voice |
| `apps/server/src/modules/whatsapp/whatsapp.service.ts` | WhatsApp inbound/outbound messaging | Communications |
| `apps/server/src/modules/webhooks/webhooks.controller.ts` | Stripe + custom webhook ingress | Webhooks |
| `apps/server/src/modules/identity/identity.controller.ts` | Auth endpoints (signup/login/me/bootstrap) | Identity |

### Web — Shell, Auth, and API Foundation

| Path | Responsibility | Layer |
|------|----------------|-------|
| `apps/web/src/app/layout.tsx` | Root HTML layout, fonts, PWA meta, SW cleanup scripts | Entry / Layout |
| `apps/web/src/app/app/layout.tsx` | Authenticated app shell: auth gate, sidebar, header, mobile nav, KEY bubble | Layout |
| `apps/web/src/app/app/page.tsx` | Redirects `/app` → `/app/command-center` | Entry |
| `apps/web/src/middleware.ts` | Edge auth gate and URL redirects | Middleware |
| `apps/web/src/components/providers.tsx` | Global client providers wrapper | Provider |
| `apps/web/src/components/require-auth.tsx` | Client auth boundary | Auth |
| `apps/web/src/lib/env.ts` | Build/runtime env validation | Config |
| `apps/web/src/lib/api.ts` | Typed fetch wrappers with retry and plan-limit events | API client |
| `apps/web/src/lib/client.ts` | Legacy monolithic API client + Zod schemas | API client |
| `apps/web/src/lib/workspace.ts` | Token/business identity persistence | Auth / State |
| `apps/web/src/lib/nav-config.ts` | Canonical navigation definitions | Navigation |
| `apps/web/next.config.ts` | Next.js config, `/__api` rewrite, redirects, security headers | Config |

### Web — AI / KEY Assistant

| Path | Responsibility | Layer |
|------|----------------|-------|
| `apps/web/src/contexts/ai-context.tsx` | Per-module context fed to KEY | Context |
| `apps/web/src/components/key/key-agent.tsx` | Floating KEY agent UI | UI |
| `apps/web/src/components/key/chat/key-live-voice.tsx` | LiveKit voice UI | UI |
| `apps/web/src/components/key/chat/voice-conversation.ts` | Voice session state machine | Logic |
| `apps/web/src/lib/api/key-agent.ts` | KEY agent API calls | API client |

### Packages

| Path | Responsibility | Layer |
|------|----------------|-------|
| `packages/db/src/client.ts` | Extended Prisma client: tenant isolation, soft delete, pagination, token encryption | Data access |
| `packages/db/src/index.ts` | Public barrel export | Public API surface |
| `packages/db/prisma/schema.prisma` | Single source of truth (~439 models) | Data schema |
| `packages/api/src/root.ts` | Composes all tRPC sub-routers | API composition root |
| `packages/api/src/trpc.ts` | tRPC init + public/protected/superAdmin procedures | API framework |
| `packages/shared/src/index.ts` | Barrel export for shared domain constants | Shared kernel |
| `packages/shared/src/release-version.ts` | Resolves git/release version for health/telemetry | Shared infra utility |
| `packages/ui/src/index.ts` | Barrel export for UI kit | UI kit root |
| `packages/ui/src/lib/utils.ts` | `cn()` className merger | UI utility |
| `packages/ui/src/styles/tokens.css` | Design tokens and dark theme | UI theme |

### Infrastructure and Operations

| Path | Responsibility | Layer |
|------|----------------|-------|
| `infrastructure/Caddyfile` | Edge reverse proxy and HTTPS routing | Infrastructure |
| `infrastructure/livekit.yaml` | Dev LiveKit server config | Infrastructure |
| `infrastructure/livekit.production.yaml` | Production LiveKit config | Infrastructure |
| `infrastructure/production.env.template` | Production env skeleton | Infrastructure |
| `scripts/launch-dev.sh` | One-command dev bootstrap | Dev tooling |
| `scripts/deploy.sh` | VPS deploy pipeline | Infrastructure |
| `scripts/uptime-monitor.sh` | Self-hosted health probe + alerter | Infrastructure |
| `scripts/architecture/generate-registries.js` | Static analysis → YAML registries | Architecture tooling |

## Generated Registries

The following machine-readable registries already exist under `architecture/` and should be treated as read-only inputs unless explicitly regenerated:

- `architecture/module-registry.yaml` — 109 server modules, registration status.
- `architecture/route-registry.yaml` — 224 `/app/**` routes, 67 in nav, 157 orphaned.
- `architecture/event-registry.yaml` — 276 events, 135 flowing, 111 published-only, 30 listened-only.
- `architecture/capability-registry.yaml` — 196 `FLOW_TOOLS` capabilities by family/risk.
- `architecture/data-ownership.yaml` — model ownership approximation.

For a fresh machine-readable inventory of every file, see `architecture/inventory.json` (produced by `inventory.py`).
