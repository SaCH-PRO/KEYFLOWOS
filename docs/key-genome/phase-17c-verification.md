# Phase 17C — Recommendation Ranking + Opportunity Detection

**Status:** Implemented and verified  
**Branch:** `feat/key-genome-phase-17c-recommendation-ranking`  
**Scope:** Recommendation ranking, risk-weighted next actions, and cross-domain opportunity detection. No autonomy gate or Command Center bridge (17D/17E).

---

## What was delivered

### New services

- `GenomeRecommendationRankerService`
  - `rankRecommendations(businessId, options)` — scores existing recommendations against the latest cross-domain snapshot.
  - `generateAndRankRecommendations(businessId, options)` — generates fresh recommendations, then ranks them.
  - Ranking factors: expected gain, confidence, readiness, financial viability, cross-domain synergy, risk penalty, effort penalty.
  - Outputs `rankedRecommendations`, `nextSafeActions`, and `blockedActions`.
  - Logs `CROSS_DOMAIN_RECOMMENDATIONS_RANKED` memory events.

- `GenomeOpportunityDetectorService`
  - `detectOpportunities(businessId, options)` — surfaces cross-domain opportunities by combining the latest snapshot with active recommendations.
  - Detects growth opportunities (e.g., scale paid acquisition, reinvest cash, automate delivery, increase channel investment, launch high-LTV campaign).
  - Detects risk-mitigation opportunities when finance or operations are HIGH/CRITICAL.
  - Logs `CROSS_DOMAIN_OPPORTUNITIES_DETECTED` memory events.

### Types extended

- Phase 17C types added to `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts`:
  - `GenomeRankedRecommendation`
  - `GenomeRecommendationRankingOptions` / `GenomeRecommendationRankingResult`
  - `GenomeRecommendationRankScoreBreakdown`
  - `GenomeCrossDomainOpportunityCandidate`
  - `GenomeOpportunityDetectionOptions` / `GenomeOpportunityDetectionResult`
  - `CROSS_DOMAIN_GENOME` memory source and cross-domain memory event types.

### Controller routes (under `/business-genome/businesses/:businessId/key-genome/cross-domain`)

- `GET /recommendations/ranked`
- `POST /recommendations/ranked/generate`
- `GET /opportunities`
- `POST /opportunities/detect`

### Module wiring

- Both services registered in `KeyGenomeModule` providers and exports.

### Tests

- `genome-recommendation-ranker.service.spec.ts` — 5 tests
- `genome-opportunity-detector.service.spec.ts` — 6 tests
- `key-genome.controller.spec.ts` — extended with 4 new route tests

---

## Verification commands

| Check | Command | Result |
| --- | --- | --- |
| Server build | `pnpm --filter server build` | ✅ Pass |
| Server unit tests | `pnpm --filter server test:unit` | ✅ 117 files, 1012 tests |
| Server smoke tests | `pnpm --filter server test:smoke` | ✅ 5 files, 13 tests |
| Full server suite | `pnpm --filter server test:ci` | ✅ 1012 unit + 13 smoke |
| Web typecheck | `cd apps/web && npx tsc --noEmit` | ✅ Pass |
| Prisma migrate status | `npx prisma migrate status --schema packages/db/prisma/schema.prisma` | ✅ Schema up to date |

---

## Out of scope (handled in 17D/17E)

- `GenomeAutonomyGateService`
- `CommandCenterKeyGenomeBridgeService`
- Command Center snapshot changes
- UI components
