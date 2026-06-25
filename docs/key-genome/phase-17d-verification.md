# Phase 17D — Genome Autonomy Gate Verification

## Objective
Introduce an autonomy gate that determines whether a ranked genome recommendation is safe to execute automatically, requires human approval, or must be blocked. The gate integrates cross-domain readiness, financial impact, policy constraints, and confidence thresholds into a single `autonomy` verdict that downstream action systems can consume.

## Deliverables

| File | Purpose |
|------|---------|
| `apps/server/src/modules/business-genome/key-genome/genome-autonomy-gate.service.ts` | Core gate service: evaluates a recommendation and returns `autonomy`, `rationale`, `requiredApprovals`, and `nextReviewAt`. |
| `apps/server/src/modules/business-genome/key-genome/genome-autonomy-gate.service.spec.ts` | Unit tests covering auto-approve, approval-required, blocked, unknown recommendation, financial impact, and policy constraint cases. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.controller.ts` | Exposes `POST /key-genome/:businessId/recommendations/:recommendationId/autonomy-gate`. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.controller.spec.ts` | Controller tests updated with a mock `GenomeAutonomyGateService` provider and route coverage. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.module.ts` | Registers `GenomeAutonomyGateService` as a provider. |
| `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts` | Adds `GenomeAutonomyGateInput`, `GenomeAutonomyGateResult`, and `GenomeAutonomyLevel` types. |

## Verification

### Targeted tests
```bash
pnpm --filter server test:unit -- genome-autonomy-gate.service.spec.ts key-genome.controller.spec.ts
```
- `genome-autonomy-gate.service.spec.ts`: 7 tests passed
- `key-genome.controller.spec.ts`: 45 tests passed

### Full server CI
```bash
pnpm --filter server test:ci
```
- Unit tests: 118 files, 1020 tests passed
- Smoke tests: 5 files, 13 tests passed

### Type-check & build
```bash
pnpm --filter server build
```
Server build completed without errors.

## Merge status
Merged into `main` after passing all gates.
