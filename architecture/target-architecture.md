# Target Architecture

This document describes the desired direction for the KEYFLOWOS architecture. It is a living template to be refined as the migration progresses.

## Guiding Principles

1. **Domain boundaries over file count.** A module should map to one business capability, not one developer or one JIRA ticket.
2. **Public interfaces are contracts.** Internal refactorings should not break consumers.
3. **Events over direct service calls.** Cross-module workflows should prefer the event bus; direct service imports are for queries and tightly-coupled operations only.
4. **Tenant isolation is non-optional.** Every data path must have an explicit tenant scope.
5. **Compiled packages are first-class.** `@keyflow/shared`, `@keyflow/db`, `@keyflow/api` must remain buildable in isolation.
6. **Small, reversible steps.** No big-bang rewrites.

## Target Module Boundaries

### Server

```
apps/server/src/
├── bootstrap/           # main.ts, app-bootstrap.ts, app.module.ts
├── core/                # auth, config, connectors-framework, event-bus, prisma, redis,
│                        # tenant, object-storage, guards, interceptors, filters
├── domains/             # one bounded context per folder
│   ├── identity/
│   ├── crm/
│   ├── commerce/
│   ├── finance/
│   ├── bookings/
│   ├── communications/
│   ├── projects/
│   ├── marketing/
│   ├── contracts/
│   └── operations/
├── ai-platform/         # model-gateway, tool registry, MCP, code executor
├── key-agent/           # context, reasoning, insight, autonomy, voice dispatch
└── integrations/        # connector implementations, webhook ingress, external SDK wrappers
```

### Web

```
apps/web/src/
├── app/
│   ├── (marketing)/
│   ├── auth/
│   ├── app/
│   │   └── [domain]/    # one route cluster per domain
│   ├── api/             # thin proxy route handlers
│   └── public-pages/
├── components/
│   ├── ui/              # @keyflow/ui wrappers and app-specific composites
│   ├── layout/
│   └── [domain]/        # domain-specific components
├── lib/
│   ├── api/             # domain-specific API wrappers (expand this, retire client.ts)
│   ├── env.ts
│   └── validators/
├── contexts/
└── hooks/
```

### Packages

Keep the package split but tighten responsibilities:

- `@keyflow/shared` — pure domain constants and logic only.
- `@keyflow/db` — schema, generated client, and cross-cutting Prisma extensions.
- `@keyflow/api` — tRPC routers, authorization helpers, and public input/output schemas.
- `@keyflow/ui` — presentational components only; no business logic.

## Desired State for High-Risk Areas

### AI / Cortex Decoupling

- `ai-platform` owns the LLM gateway, tool registry, MCP client, and code executor.
- `key-agent` owns context assembly, reasoning, insight, autonomy, and voice dispatch.
- Domain modules (`crm`, `commerce`, etc.) expose stable read-only APIs to `key-agent` via a context contract, not direct service imports.
- Long-term: replace most `forwardRef` cycles with event-driven commands and query facades.

### Tenant Isolation

- All create/update paths use an explicit tenant-scoped helper or Prisma middleware.
- Background jobs run inside `runWithTenant()` with `businessId` from the job payload.
- CI includes a test that fails if a new `businessId` model is added without tenant isolation coverage.

### Data Model

- Consolidate or clearly mark legacy/experimental models.
- Introduce read models / projections for heavy dashboard queries.
- Keep the Prisma schema as the single source of truth; avoid ad-hoc raw SQL except in migrations.

### Frontend API Layer

- Retire `apps/web/src/lib/client.ts`; all new code uses `src/lib/api/<domain>.ts`.
- Server Components fetch via typed wrappers; Client Components use the same wrappers from event handlers.

## Non-Goals

- Rewriting the framework (NestJS / Next.js / Prisma) is not required.
- Microservices or micro-frontends are out of scope unless business needs change.
- Perfect 100% test coverage is not a target; coverage of public interfaces and critical paths is.

## Success Metrics

- `key-cortex` module file count below 120 within one migration phase.
- Zero new `forwardRef` cycles introduced; existing cycles reduced by 30%.
- All `create`/`upsert` paths for tenant models covered by tenant-scope tests.
- `client.ts` imports reduced to zero in new feature code.
- Orphaned routes below 100.
