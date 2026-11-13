# KF-EXEC-CONNECTOR-001 — Connector Grant-Generation Fencing

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: B  
Primary kernels: K9/K11  
Primary journeys: J13/J18  
Dependencies: K12-001,INGRESS-001  
Forensic evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`

## Objective
Bind provider effects/callbacks to current connector grant generation and preserve revoke/reconnect lineage.

## Existing seams to revalidate on current main
- connector status/credential services
- adapter registry
- callback registrations
- provider account/destination bindings

## Locked invariants
- current grant generation required
- revoked grant cannot admit new effect
- late callback remains evidence not permission
- reconnect creates new generation

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
- revoke vs send race
- callback from old generation
- reconnect
- credential refresh
- cleanup dependency failure

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
- provider-wide SDK upgrades
- deleting historical connector rows

## Readiness state
No additional architecture invention is required before current-main characterization. Implementation still requires explicit authorization.
