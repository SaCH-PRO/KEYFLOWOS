# Phase 17B — Cross-Domain Snapshot Service Verification

## Goal

Add the first cross-domain intelligence layer: a `GenomeCrossDomainSnapshot`
model, service, and controller routes that synthesize the four completed Genome
domains into a single snapshot.

## What was implemented

- **Prisma model** `GenomeCrossDomainSnapshot` with fields:
  - `overallHealthScore`, `overallRiskLevel`
  - `domainScores`, `domainRisks`
  - `readinessSummary`, `evidenceSummary`
  - `bottlenecks`, `opportunities`, `recommendedFocus`
- **Migration** `20260625001500_add_genome_cross_domain_snapshot` created and
  applied cleanly on top of the repaired baseline.
- **Types** added to `apps/server/src/modules/business-genome/key-genome/key-genome.types.ts`.
- **Service** `GenomeCrossDomainService` (`genome-cross-domain.service.ts`):
  - `computeCrossDomainSnapshot(businessId, period?)`
  - `getLatestCrossDomainSnapshot(businessId)`
  - `listCrossDomainSnapshots(businessId, filters?)`
  - Aggregates Finance, Customer/Sales/Revenue, Operations/Delivery, and
    Marketing/Growth snapshots.
  - Computes overall health/risk, readiness summary, evidence summary,
    bottlenecks, opportunities, and recommended focus.
  - Writes a memory event on compute.
- **Controller routes** under `/cross-domain`:
  - `GET /business-genome/businesses/:businessId/key-genome/cross-domain/snapshot`
  - `POST /business-genome/businesses/:businessId/key-genome/cross-domain/snapshot/compute`
  - `GET /business-genome/businesses/:businessId/key-genome/cross-domain/snapshots`
- **Module wiring** `GenomeCrossDomainService` registered in `KeyGenomeModule`.
- **Tests** `genome-cross-domain.service.spec.ts` covering compute, aggregation,
  failure fallback, memory event, and read/list methods.

## Verification commands

```bash
# Server build
pnpm --filter server build

# Server tests
pnpm --filter server test:ci

# Prisma migration status
npx prisma migrate status --schema packages/db/prisma/schema.prisma
```

## Results

- `pnpm --filter server build`: pass
- `pnpm --filter server test:ci`: pass
- `prisma migrate status`: database schema up to date

## Not in scope (reserved for 17C–17E)

- Recommendation ranker / opportunity detector
- Autonomy gate
- Command Center bridge
- Large UI panel
- Temporal Flow rewiring
