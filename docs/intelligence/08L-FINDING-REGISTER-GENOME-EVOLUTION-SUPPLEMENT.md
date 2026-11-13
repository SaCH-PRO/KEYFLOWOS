# KeyFlowOS Finding Register — Genome Evolution Supplement

Status: CANONICAL CONTINUATION AFTER F160

Implementation baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production code: READ-ONLY

---

## F161 — GenomeFact verification provenance can survive replacement of the verified value/source

**Status:** VERIFIED CODE-LEVEL / EPISTEMIC-INTEGRITY FINDING

`GenomeFactService.upsertFact()` updates value, valueType, source module/type/entity and timestamps. It changes `verificationStatus` only when the caller explicitly supplies one.

`GenomeSignalService.mergeSignal()` calls `upsertFact()` without a verification status.

Therefore an existing fact such as:

```text
value = X
verificationStatus = USER_VERIFIED
source = prior source
```

can be overwritten by an accepted GenomeSignal to:

```text
value = Y
verificationStatus = USER_VERIFIED   // preserved from X
source = GENOME_SIGNAL
```

The verification label can therefore refer historically to an older value while appearing to verify the replacement value.

Target law:

> Verification belongs to an exact knowledge revision/value, not permanently to a field coordinate.

Affected kernels: K4 Business Knowledge, K8 Evidence/Outcome, K3 Governance.
Affected journeys: J1, J2, J6, J15, J16, J23.

---

## F162 — Material Genome mutation authority is currently business access/completeness rather than effective knowledge-change authority

**Status:** VERIFIED CROSS-LAYER / GOVERNANCE FINDING

`BusinessGuard` allows the business owner or any member. `GenomeGateGuard` checks Three-Pillar Genome completeness.

Observed mutation surfaces include:

- whole Blueprint `PATCH` under `AuthGuard + BusinessGuard`;
- DNA-section `PATCH` with the additional `GenomeGateGuard`;
- Genome evolution approval with the additional `GenomeGateGuard`;
- GenomeSignal review/accept/reject/merge under the KeyGenome controller's class-level business-access guards.

These operations can change business knowledge used by readiness/risk/autonomy systems, yet the inspected surfaces do not bind the change to effective role/capability authority or J15 Clearance semantics.

Signal transitions also do not persist a durable reviewing/accepting/merging principal in the inspected service contract.

Target distinction:

```text
BUSINESS ACCESS
!= KNOWLEDGE EDIT AUTHORITY
!= KNOWLEDGE VERIFICATION AUTHORITY
!= AUTHORITY TO CHANGE AUTONOMY-RELEVANT KNOWLEDGE
```

Affected kernels: K2 Human Authority, K3 KEY Authority/Governance, K4 Business Knowledge.
Affected journeys: J1, J2, J6, J15, J16, J25.

---

## F163 — BusinessBlueprint and GenomeFact are asymmetric co-existing business truths with non-atomic one-way convergence

**Status:** VERIFIED CROSS-LAYER / KNOWLEDGE-OWNERSHIP FINDING

Blueprint writes persist first, then asynchronously invoke `KeyGenomeBackfillService.backfill()`. Backfill failure is intentionally logged without failing the Blueprint mutation.

The backfill direction is:

```text
BusinessBlueprint → GenomeFact
```

Separately, `GenomeSignalService.mergeSignal()` writes GenomeFact directly. No reverse GenomeFact → Blueprint materialization was observed in this trace.

Therefore:

```text
Blueprint evolution path → Blueprint → eventually GenomeFact
Signal evolution path    → GenomeFact only
```

The same conceptual business knowledge can diverge across two legitimate-looking representations.

Target law:

> Every knowledge concept must have one authoritative revision owner and explicit materialized/compatibility projections with detectable completeness and repair.

Affected kernels: K4, K7, K8.
Affected journeys: J1, J2, J6, J16, J23.

---

## F164 — Genome evolution proposal application and approval evidence are not atomic

**Status:** VERIFIED CODE-LEVEL / PARTIAL-COMMIT FINDING

`GenomeEvolutionService.approve()` performs:

```text
Blueprint update
→ Genome integrity calculation
→ proposal status APPROVED
→ TemporalFlow decision event best effort
```

No shared transaction was observed across the Blueprint mutation and proposal decision update.

If the Blueprint mutation succeeds and the later proposal update fails, business knowledge has changed while the proposal can remain non-approved/actionable.

Target law:

> A governed knowledge mutation and the durable evidence that authorized/applied that exact mutation must have crash-consistent semantics.

Affected kernels: K3, K4, K6 State Transition, K8.
Affected journeys: J15, J16, J18, J23.

---

## F165 — Genome evolution proposals are not bound to a source Genome revision/current-state precondition

**Status:** VERIFIED CODE-LEVEL / STALE-KNOWLEDGE FINDING

`GenomeEvolutionProposal` stores the proposed patch, reason/evidence/confidence and source event IDs. The inspected `approve()` path does not compare an expected Blueprint/Genome revision, old-value fingerprint or source-state precondition before applying the patch.

A proposal generated from earlier evidence may therefore be approved after intervening human/system edits and applied to a materially different current Genome.

Target law:

```text
KNOWLEDGE CHANGE INTENT
must bind
OBSERVED BASE REVISION / MATERIAL PRECONDITION
```

A stale proposal should be re-evaluated, conflicted or rebased rather than blindly applied.

Affected kernels: K4, K6, K7, K8.
Affected journeys: J15, J16, J23.

---

## F166 — Genome learning memory compresses process/control events into outcome semantics stronger than the underlying evidence

**Status:** VERIFIED CODE-LEVEL / LEARNING-SEMANTICS FINDING

Observed examples:

- a merged GenomeSignal produces a GenomeMemoryEvent with `outcome = SUCCESS` and a lesson that the signal became a "verified insight";
- `GenomeAutonomyGateService` records `ALLOW` as `SUCCESS`, `BLOCK` as `FAILURE`, and approval/uncertain decisions as `MIXED` before the downstream business action outcome exists;
- failed action execution produces generalized negative learning about execution/readiness even though failure causality may belong to provider, authority, transport, stale state or local consequence handling.

This can teach future systems from control/process outcomes rather than actual business outcomes.

Target distinction:

```text
PROCESS TRANSITION
!= CONTROL DECISION
!= EXECUTION OUTCOME
!= BUSINESS OUTCOME
!= CAUSAL LEARNING EVIDENCE
```

Affected kernels: K4, K8, K11 Recovery/Reliability, K3.
Affected journeys: J2, J6, J15, J16, J18, J23.

---

# Pool law

```text
FIELD IDENTITY != KNOWLEDGE REVISION
OLD VERIFICATION != NEW VALUE VERIFICATION
BUSINESS MEMBERSHIP != KNOWLEDGE-CHANGE AUTHORITY
BLUEPRINT WRITE != GENOMEFACT CONVERGENCE
KNOWLEDGE MUTATION != DURABLE APPROVAL EVIDENCE UNLESS CRASH-CONSISTENT
PROPOSAL APPROVAL != SAFE APPLICATION TO A DIFFERENT CURRENT REVISION
PROCESS SUCCESS != BUSINESS SUCCESS
CONTROL BLOCK != BUSINESS FAILURE
LEARNING MAY SUGGEST FUTURE POLICY; LEARNING MUST NOT SILENTLY EXPAND AUTHORITY
```

No production implementation is authorized by this supplement.
