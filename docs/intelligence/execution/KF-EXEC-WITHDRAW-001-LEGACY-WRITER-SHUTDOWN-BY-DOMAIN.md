# KF-EXEC-WITHDRAW-001 — Legacy Writer Shutdown by Domain

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: E  
Primary kernels: K12/K11  
Primary journeys: all migrated  
Dependencies: all prior domain packets  
Forensic evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`

## Objective
Turn off superseded writers only after writer inventory, compare and proof; preserve historical reads/effects.

## Existing seams to revalidate on current main
- all migrated domains

## Locked invariants
- late writer detection zero
- new owner exclusive
- historical history intact
- disable reversible

## Required no-edit characterization
- enumerate current writers, readers, workers and consumers;
- compare current main to the forensic baseline and report source drift;
- inspect deployed constraints/data only in an authorized safe environment;
- identify bypass paths and existing tests;
- return characterization evidence before mutation.

## Migration / cutover
1. add compatible representation/adapters first;
2. backfill only deterministic facts; classify ambiguity explicitly;
3. shadow/compare only where side-effect free;
4. migrate one bounded owner/writer family at a time;
5. prove new owner before disabling legacy writer;
6. detect late writers/stale workers;
7. retire compatibility only in Wave E.

## Acceptance proof
- late writer
- rollback
- dual-write drift
- stale worker

Proof receipts must name source/build, environment, exact cases, skips/errors, isolation, raw report, cleanup and evaluator. Mock-only evidence cannot satisfy DB/concurrency/provider claims.

## Negative controls
Include wrong-tenant/current-authority and replay/stale-state controls applicable to this packet. An unexpected negative-control pass invalidates the proof.

## Rollback floor
Preserve revocations, effect/provider receipts, financial/history lineage, occurrence/effect identities, migration markers and privacy obligations. Code rollback is not external-effect rollback.

## Agent contract
**Claude Code:** bounded implementation + exact diff/migrations/tests/results; stop on contradiction.  
**Kimi Code:** adversarial writers/readers/concurrency/migration/proof scan.  
**ChatGPT:** canonical packet authority, evidence admission and contradiction resolution.

## Non-goals
- reader retirement

## Readiness state
No additional architecture invention is required before current-main characterization. Implementation still requires explicit authorization.
