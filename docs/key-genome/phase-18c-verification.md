# Phase 18C Verification — Before/After Metric Snapshots

## Scope

Phase 18C captures a pre-recommendation cross-domain snapshot when an outcome is recorded, and later computes a post-snapshot after an observation window to produce a normalized impact score.

## Deliverables

- [x] `capturePreSnapshot` records pre-decision health/readiness/confidence/risk from the latest cross-domain snapshot.
- [x] `closeObservationWindow` recomputes the cross-domain snapshot, fills post-metrics, and calculates impact score.
- [x] `POST /outcomes/:outcomeId/close-observation` endpoint.
- [x] Frontend API wrapper and "Close observation window" button on applied recommendations.
- [x] Recommendations panel displays pre/post health/readiness/confidence and impact percentage.

## Files changed

### Backend

- `apps/server/src/modules/business-genome/key-genome/genome-recommendation-outcome.service.ts`
- `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts`
- `apps/server/src/modules/business-genome/key-genome/key-genome.controller.ts`
- `apps/server/src/modules/business-genome/key-genome/key-genome.controller.spec.ts`

### Frontend

- `apps/web/src/lib/api/business-genome.ts`
- `apps/web/src/app/app/profile/components/business-genome/key-genome-recommendations-panel.tsx`

## Validation results

| Gate | Command | Result |
|------|---------|--------|
| Server typecheck | `cd apps/server && pnpm tsc --noEmit` | ✅ clean |
| Server unit tests | `cd apps/server && pnpm vitest run` | ✅ 1,185 tests passed |
| Web typecheck | `cd apps/web && pnpm tsc --noEmit` | ✅ clean |
| Web production build | `cd apps/web && pnpm build` | ✅ succeeded |
| Web lint | `pnpm --filter web lint` | ✅ 0 errors |

## Schema impact

- No new schema changes. Uses existing `GenomeRecommendationOutcome` table from 18A.

## Merge readiness

- 18C is focused on metric snapshots only.
- Confidence adjustment and ranking feedback (18D) and Command Center outcome dashboards (18E) are not included.
