# KEY Cortex Integration Layer — Hardening Notes

> Branch: `fix/key-cortex-integration-safety`  
> Based on commit: `dcf9741c` — "KEY Ultimate — Universal Integration Layer v2"

## Status

The v2 integration layer is **architecturally ambitious but not merge-safe** without the work below. This branch applies the immediate safety fixes; the remaining controller/service alignment is tracked as a follow-up.

## What was fixed in this branch

### 1. Build blockers

| Issue | Fix |
|-------|-----|
| `@nestjs/axios` missing | Added to `apps/server/package.json` |
| `uuid` missing | Added to `apps/server/package.json` |
| `PrismaService` imported from non-existent `../prisma/prisma.service` | Corrected to `../../core/prisma/prisma.service` in `key-cortex-executor.service.ts` |
| `ContentModule` / `ActivityModule` do not exist | Added stub services (`stubs/content.stub.ts`, `stubs/activity.stub.ts`) and wired them into `KeyCortexModule` |
| `BusinessGenomeModule` imported from non-existent `../genome/genome.module` | Corrected to `../business-genome/business-genome.module` |
| `model-gateway.service.ts` syntax error | Refactored implicit-return object literal to explicit `return` (reserved-word property parsing issue) |

### 2. Controller / executor safety

| Issue | Fix |
|-------|-----|
| `requireApproval` passed to executor but `ExecuteOptions` only has `skipApproval` | Updated all controller call sites to use `skipApproval: !(dto.requireApproval ?? false)` |
| No route-level auth on Cortex routes | Added `@UseGuards(AuthGuard, BusinessGuard)` to `KeyCortexController` |
| Dangerous actions exposed (`EXECUTE_TOOL`, `QUERY_DATABASE`, `UPDATE_RECORD`) | Added `BLOCKED_ACTIONS` set in `KeyCortexExecutorService`; returns a safe error instead of executing |
| Sandbox SQL allowed `INSERT`/`UPDATE` via `$queryRawUnsafe` | Restricted sandbox SQL to read-only `SELECT` / `WITH` queries |
| Python sandbox runs `python3` without OS/container isolation | Disabled Python execution when `NODE_ENV === 'production'` |
| KEY Cortex executing without Genome governance | Injected `GenomeAutonomyGateService` into `KeyCortexExecutorService`; `execute()` now calls `checkGate()` and respects `BLOCK` / `APPROVE` decisions |

## Remaining blockers before merge

The controller (`key-cortex.controller.ts`) still has TypeScript errors because its method signatures do not match the actual service implementations. The services have methods like:

- `generateCode`, `executeCode`, `explainCode`, `getTemplates`
- `generateFlowFromDescription`, `executeFlow`, `listFlows`, `loadFlow`, `persistFlow`
- `connect`, `disconnect`, `execute`, `registerWebhook`, `getBusinessConnectors`

while the controller calls:

- `generate`, `execute`, `auto`, `listTemplates`, `explain`
- `generate`, `create`, `list`, `get`, `update`, `delete`, `execute`, `toggle`
- `listDefinitions`, `listInstances`, `checkStatus`, `createCustom`, `receiveWebhook`

**Recommended fix:** align the controller to the service APIs or add thin adapter methods. Do not merge until `pnpm build` in `apps/server` passes cleanly.

## Required tests before merge

```text
structured command cannot spoof businessId
generic update_record is rejected unless allowlisted
database query rejects non-read-only SQL
sandbox SQL rejects INSERT/UPDATE
high-impact command calls GenomeAutonomyGateService
approval-required command does not execute immediately
approved command executes exactly once
unauthorized user cannot approve another user's action
```

## Architectural recommendation

KEY Cortex should remain the **interface/routing layer**. KEY Genome (via `GenomeAutonomyGateService`) should remain the **judgment/governance brain**. Avoid creating a parallel approval/policy system inside the executor — the executor should call the gate and respect its decision.

## Do not merge until

1. `cd apps/server && pnpm build` passes with zero errors.
2. `cd apps/server && pnpm test:ci` passes.
3. The required tests above are added and passing.
4. A security review re-checks the sandbox, external connector, and phone/document/evolution surfaces.
