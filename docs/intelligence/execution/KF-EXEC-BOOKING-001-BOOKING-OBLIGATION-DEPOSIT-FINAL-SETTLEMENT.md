# KF-EXEC-BOOKING-001 — Booking Obligation Deposit & Final Settlement

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: C  
Primary kernels: K6/K10/K11  
Primary journeys: J4/J21  
Dependencies: COMMERCIAL-001  
Forensic evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`

## Objective
Bind booking obligation, deposit invoice/payment, remaining receivable, cancellation/no-show and final settlement into one causal chain.

## Existing seams to revalidate on current main
- booking service
- invoice workflow
- payment
- public booking

## Locked invariants
- booking occurrence stable
- deposit allocated
- remaining obligation explicit
- cancel/no-show policy
- payment settlement sourced from K10

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
- partial deposit
- duplicate callback
- cancel after deposit
- concurrent slot claim dependency
- refund/reversal

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
- booking UI redesign
- payment gateway replacement

## Readiness state
No additional architecture invention is required before current-main characterization. Implementation still requires explicit authorization.
