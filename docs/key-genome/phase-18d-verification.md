# Phase 18D Verification — Confidence Adjustment + Ranking Feedback

## Scope

Phase 18D turns historical recommendation outcomes into a learning signal that adjusts future recommendation confidence and ranking.

## Deliverables

- [x] New `GenomeOutcomeLearningService` for learned impact and confidence adjustment.
- [x] `getLearnedImpact` computes a time-decayed weighted average of historical impact scores per domain/action pattern.
- [x] `applyOutcomeToConfidence` adjusts the confidence of active recommendations in the same domain after an observation closes.
- [x] Ranker includes `outcomeLearning` in score calculation and breakdown.
- [x] Rank reason mentions positive/negative outcome history when significant.
- [x] Frontend type updated to include `outcomeLearning` in score breakdown.

## Files changed

### Backend

- `apps/server/src/modules/business-genome/key-genome/genome-outcome-learning.service.ts` (new)
- `apps/server/src/modules/business-genome/key-genome/genome-recommendation-ranker.service.ts`
- `apps/server/src/modules/business-genome/key-genome/genome-recommendation-ranker.service.spec.ts`
- `apps/server/src/modules/business-genome/key-genome/genome-recommendation-outcome.service.ts`
- `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts`
- `apps/server/src/modules/business-genome/key-genome/key-genome.module.ts`

### Frontend

- `apps/web/src/lib/api/business-genome.ts`

## Validation results

| Gate | Command | Result |
|------|---------|--------|
| Server typecheck | `cd apps/server && pnpm tsc --noEmit` | ✅ clean |
| Server unit tests | `cd apps/server && pnpm vitest run` | ✅ 1,185 tests passed |
| Web typecheck | `cd apps/web && pnpm tsc --noEmit` | ✅ clean |
| Web production build | `cd apps/web && pnpm build` | ✅ succeeded |

## Schema impact

- No schema changes.

## Merge readiness

- 18D adds learning logic but no Command Center dashboards (18E).
- All gates green.
