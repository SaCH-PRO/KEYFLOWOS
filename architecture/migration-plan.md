# Migration Plan

This document tracks the planned migration from the current architecture to the `target-architecture.md` state. It is a living document: append a dated changelog entry after each completed phase.

## Current Baseline (as of 2026-08-09)

- 109 NestJS feature modules; `key-cortex` is the largest at ~248 files.
- Heavy `forwardRef` cycles between AI/Cortex/Autonomy/Commerce/CRM.
- Tenant isolation via Prisma extension; `create`/`upsert`/`aggregate`/`groupBy` not intercepted.
- Web API layer split between new `src/lib/api/*` wrappers and legacy `src/lib/client.ts`.
- 224 `/app/**` routes, 157 orphaned.
- 276 events, 111 published-only, 30 listened-only.

## Phases

### Phase 1 — Map and Stabilize (in progress)

**Goal:** Establish accurate architecture memory and stop further architectural debt.

- [x] Create `codebase-architect` skill package.
- [x] Seed `/architecture/` baseline documents.
- [x] Add deterministic scanners (`inventory.py`, `dependency_scan.py`).
- [x] Append Codebase Architect Policy to `AGENTS.md`.
- [ ] Enforce map-before-modifying in agent runs.
- [ ] Add CI check that runs `inventory.py` and `dependency_scan.py` on PRs and fails on unexpected diffs.

**Verification:**

- `python .agents/skills/codebase-architect/scripts/inventory.py` runs without errors.
- `python .agents/skills/codebase-architect/scripts/dependency_scan.py` runs without errors.
- All `/architecture/*.md` files are present and non-empty.

### Phase 2 — Tenant Isolation Hardening

**Goal:** Remove tenant isolation blind spots.

1. Audit every service that calls `create`, `createMany`, `upsert`, `aggregate`, or `groupBy` on tenant models.
2. Add `businessId` validation helper and migrate the top 20 write paths.
3. Provide `runWithTenant` wrapper for BullMQ workers and cron jobs.
4. Add integration tests that fail if a cross-tenant read/write succeeds.

**Affected files:** `packages/db/src/client.ts`, `apps/server/src/core/tenant/*`, many `*.service.ts` files.

**Verification:**

- New integration test suite for tenant isolation passes.
- `architecture-risks.md` R3 and R4 severity reduced to Low.

### Phase 3 — AI / Cortex Decoupling

**Goal:** Reduce `key-cortex` size and break circular dependencies.

1. Extract `key-context` service that defines a stable read-only context contract.
2. Move LLM gateway and tool registry to a new `ai-platform` domain folder.
3. Replace direct service imports from domain modules into `key-cortex` with event-driven commands.
4. Split `key-cortex` into `key-agent`, `key-reasoning`, `key-insight`.

**Affected files:** `apps/server/src/modules/ai/*`, `apps/server/src/modules/key-cortex/*`, dependent domain modules.

**Verification:**

- `key-cortex` file count below 180.
- Zero new `forwardRef` cycles; existing cycles reduced.
- All AI-affected tests pass.

### Phase 4 — Web API Layer Consolidation

**Goal:** Retire `apps/web/src/lib/client.ts`.

1. Inventory all `client.ts` imports.
2. For each domain, create or expand `src/lib/api/<domain>.ts`.
3. Migrate consumers one domain at a time.
4. Delete `client.ts` once imports reach zero.

**Affected files:** `apps/web/src/lib/client.ts`, `apps/web/src/lib/api/*`, many page/component files.

**Verification:**

- `grep -r "from '@/lib/client'" apps/web/src` returns no results.
- Typecheck and e2e tests pass.

### Phase 5 — Dead Code and Route Cleanup

**Goal:** Reduce noise and maintenance surface.

1. Review 157 orphaned routes; remove or add nav/launcher entries.
2. Audit 111 published-only and 30 listened-only events; remove dead events or add listeners.
3. Remove confirmed dead code (`packages/api/src/context.ts` if unused, stub routers if superseded).

**Affected files:** `apps/web/src/app/app/**/*`, `packages/api/src/routers/*`, `core/event-bus/events.types.ts`.

**Verification:**

- Orphaned routes below 100.
- Event registry count stable or reduced.
- CI build/lint/test pass.

### Phase 6 — Data Model Consolidation

**Goal:** Clarify the Prisma schema.

1. Identify legacy/experimental models.
2. Rename or remove unused models in a migration-safe way.
3. Introduce projections for heavy dashboard queries where needed.

**Affected files:** `packages/db/prisma/schema.prisma`, migrations, query services.

**Verification:**

- `prisma migrate dev` succeeds.
- Integration tests pass.

## Changelog

### 2026-08-09 — Baseline seeded

- Created `codebase-architect` skill package.
- Seeded `/architecture/` with system overview, repository map, dependency map, execution paths, data model, module registry, risks, target architecture, and migration plan.
- Added deterministic `inventory.py` and `dependency_scan.py` scripts.
- Updated `AGENTS.md` with Codebase Architect Policy.
