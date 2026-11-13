# KF-EXEC-VOICE-001 — Voice Session Transport Action & Metering Convergence

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: D  
Primary kernels: K1/K3/K5/K8/K9/K11  
Primary journeys: J22  
Dependencies: CONVO-001,ENTITLE-001,ACTION-001  
Forensic evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`

## Objective
Converge Twilio/LiveKit/browser/KeyCortex voice on trusted session binding, exact action governance, evidence and AI metering.

## Existing seams to revalidate on current main
- phone voice
- realtime bridge
- LiveKit
- voice-agent
- TTS/STT

## Locked invariants
- trusted ingress grant
- session occurrence
- exact tool governance
- transcript/tool evidence
- realtime metering
- reconnect recovery

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
- raw stream substitution
- malformed tool
- duplicate tool
- reconnect
- missing transcript
- direct TTS budget

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
- one voice transport
- new voice engine

## Readiness state
No additional architecture invention is required before current-main characterization. Implementation still requires explicit authorization.
