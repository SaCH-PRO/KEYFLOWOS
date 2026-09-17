# KF-EXEC-PRIVACY-001 — Privacy Derived-State Deletion & Retention

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: D  
Primary kernels: K4/K8/K9  
Primary journeys: J19  
Dependencies: KNOWLEDGE-002  
Forensic evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`

## Objective
Implement source-disposition propagation across derived knowledge, vectors/files/provider copies while retaining lawful audit/financial evidence.

## Existing seams to revalidate on current main
- privacy/delete services
- knowledge
- vector/file stores
- connector/provider copies
- audit/ledger exclusions

## Locked invariants
- deletion policy classified
- derived copies located
- active use stopped
- provider cleanup tracked
- retained audit basis explicit

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
- partial provider cleanup
- stale vector
- recommendation after deletion
- financial retention
- retry cleanup

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
- erase legally required ledger/audit

## Readiness state
No additional architecture invention is required before current-main characterization. Implementation still requires explicit authorization.
