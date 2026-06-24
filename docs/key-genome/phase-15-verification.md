# Phase 15 — Operations / Delivery Genome Verification

## Objective
Add the Operations / Delivery genome to the Key Genome: operational-process registry, delivery-capability registry, computed operations snapshot, and a UI panel for SOP coverage, capacity risk, quality risk, and delivery readiness.

## What was delivered

### Database
- `GenomeOperationalProcess` — recurring process registry with SOP, failure/rework/handoff metrics, maturity/risk scoring.
- `GenomeDeliveryCapability` — delivery capacity, utilization, backlog, lead time, quality/reliability scores.
- `GenomeOperationsSnapshot` — computed operational health summary with SOP coverage, capacity/quality/SOP/overall risk, and readiness score.
- `Business` relations and indexes added.
- Schema generated and pushed to PostgreSQL.

### Backend
- `GenomeOperationalProcessService` — CRUD + scoring.
- `GenomeDeliveryCapabilityService` — CRUD + scoring.
- `OperationsGenomeService` — snapshot computation, signals, recommendations, memory events, department readiness recomputation.
- `KeyGenomeController` — `operations/*` routes for processes, capabilities, snapshots, signals, and recommendations.
- `KeyGenomeModule` — services registered and exported.
- Unit tests for all three services and the controller.

### Frontend
- Extended `apps/web/src/lib/api/business-genome.ts` with operations types and API helpers.
- Added `KeyGenomeOperationsPanel` with snapshot display, process/capability lists, add/delete forms, and recompute/signals/recommendations actions.
- Wired the `Operations` tab into `BusinessGenomeTab`.

## Verification results

| Check | Command | Result |
|---|---|---|
| Server build | `pnpm --filter server build` | ✅ pass |
| Server unit tests | `pnpm --filter server test src/modules/business-genome/key-genome/operations-genome.service.spec.ts ...` | ✅ 51 tests pass |
| Server CI | `pnpm --filter server test:ci` | ✅ 111 files, 945 tests pass; smoke tests pass |
| Web typecheck / build | `pnpm --filter web build` | ✅ pass |
| Lint on new files | `pnpm exec eslint <new files>` | ✅ no new errors |

## Notes
- Web global lint still reports 226 pre-existing issues unrelated to Phase 15; this was not a blocker.
- Operations signals reuse existing `GenomeSignalType` values (`MISSING_FACT`, `RISK_PATTERN`, `OPERATIONS_PATTERN`).
- Department recomputes: `COO_OPERATIONS` always; `PRODUCT_SERVICE`, `CUSTOMER_SUCCESS`, `RISK`, and `CEO_STRATEGY` when critical delivery risk exists.

## Branch
`feat/key-genome-phase-15-operations`
