# Goal System Writer Census (`RR-GOAL-WRITER-CENSUS`)

- **Decisions:** D-261, D-262, D-235
- **Baseline:** post-M79 `main` (`2db5e0879`, 2026-11-27)
- **Enforcement:** `apps/server/src/modules/ai/goal-writer-census.spec.ts`
- **Status:** Read-only first slice. No schema or runtime behaviour change. `/app/goals` is hidden in v1 (`NAV-B-HIDE-2`).

## Why two goal models coexist

1. **`AiGoal`** (`packages/db/prisma/schema.prisma`, table `ai_goals`): strategic/tactical goals owned by KEY Cortex (`title`, `description`, `status`, `priority`, `targetDate`, `parentGoalId`, linked to `AiPlan[]`). Carries no `sourceType`, `principal`, `createdBy`, or `updatedBy` column.
2. **`BusinessGoal`** (`packages/db/prisma/schema.prisma`, table `business_goals`): numeric KPI/category goals (`revenue`, `leads`, `retention`, `efficiency`, `custom`, `targetValue`, `currentValue`, `actions` JSON, linked to `Project[]` and `ProjectPlan[]`). Carries no `sourceType`, `principal`, `createdBy`, or `updatedBy` column.

## Writer Registry (Shrink-Only / Exact-Match Ratchet)

Every non-test file under `apps/server/src` that writes `AiGoal` (`aiGoal.*` or raw SQL on `ai_goals`) or `BusinessGoal` (`businessGoal.*` or raw SQL on `business_goals`) MUST appear in the table below. Adding an unlisted writer or leaving a retired writer in this table fails CI.

| File | Model | Operations | Trigger sources | Recorded principal |
| --- | --- | --- | --- | --- |
| `apps/server/src/modules/ai/goal-tracker.service.ts` | BusinessGoal | `create`, `updateMany`, `deleteMany` | User HTTP routes in `AiController` (`POST/PUT/DELETE /ai/businesses/:businessId/goals`, `POST .../progress`, `GET .../actions` which persists suggested actions JSON) | none (model has no principal/provenance column) |
| `apps/server/src/modules/key-cortex/key-cortex-planner.service.ts` | AiGoal | `create`, `delete` | User HTTP routes in `KeyCortexGoalsController` (`POST /cortex/goals`, `DELETE /cortex/goals/:id`); KEY Flow tools (`goals_create`, `goals_delete` via `FlowOrchestratorService`); KEY Cortex query pipeline (`KeyCortexQueryPipelineService`); KEY Cortex trigger automation (`KeyCortexTriggerService`) | none (model has no principal/provenance column) |

## Planned Later Slices (Not in This Packet)

1. Read-only goal provenance projection (`sourceType`, `principal`, correlation id from `AiPlan` / `KeyCommand` / `KeyActionProposal` lineage).
2. Owner decision between consolidating onto one goal model vs. maintaining a documented two-owner boundary.
