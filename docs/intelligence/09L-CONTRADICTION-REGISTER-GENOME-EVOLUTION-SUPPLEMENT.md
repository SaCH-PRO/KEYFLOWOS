# KeyFlowOS Contradiction Register — Genome Evolution Supplement

Status: CANONICAL CONTINUATION AFTER C110

Implementation baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production code: READ-ONLY

---

## C111 — persisted `USER_VERIFIED` label vs replacement value/source that was not user-verified

**Status:** VERIFIED ACTIVE CONTRADICTION

`GenomeFactService.upsertFact()` can replace a fact's value and source while retaining the prior verification status when the caller does not explicitly provide a new one.

`GenomeSignalService.mergeSignal()` uses that path without specifying `verificationStatus`.

```text
historical truth: value X was USER_VERIFIED
current row value: Y from GENOME_SIGNAL
current row label: USER_VERIFIED
```

The row therefore claims stronger epistemic provenance than the replacement value earned.

Target resolution: verification binds to an exact knowledge revision/value and cannot transfer implicitly to a superseding value.

---

## C112 — Genome “governance/approval” semantics vs access/completeness-based mutation authorization

**Status:** VERIFIED ACTIVE CONTRADICTION

The product exposes Genome proposal approval, signal acceptance/merge, Genome governance queues and DNA mutation, but the inspected HTTP surfaces principally enforce business access (`BusinessGuard`) and sometimes Genome completeness (`GenomeGateGuard`).

```text
semantic claim: governed / approved business knowledge evolution
runtime authorization: owner OR member + optional Three-Pillar completeness
```

Target resolution: distinguish low-risk knowledge editing from verification and autonomy-relevant material knowledge mutation, and bind material transitions to current effective authority without making all profile editing heavyweight.

---

## C113 — BusinessBlueprint business truth vs GenomeFact business truth

**Status:** VERIFIED ACTIVE CONTRADICTION

Blueprint writes asynchronously backfill facts, while accepted Genome signals can merge directly into GenomeFact without an observed reverse materialization to Blueprint.

```text
Blueprint concept value = X
GenomeFact concept value = Y
both surfaces = legitimate-looking Genome/business knowledge
```

A failed async backfill can also leave Blueprint ahead of the fact kernel.

Target resolution: one authoritative revision owner per concept plus explicit compatibility/materialized projections with convergence state and repair.

---

## C114 — non-approved/actionable proposal state vs business knowledge already changed after partial approval commit

**Status:** VERIFIED ACTIVE CONTRADICTION

Genome evolution approval mutates Blueprint before recording the proposal as APPROVED.

A failure after the Blueprint write but before the proposal update can yield:

```text
business knowledge: proposed patch applied
proposal truth: still PENDING/EDITED
approval evidence: absent/incomplete
```

Target resolution: crash-consistent knowledge mutation + decision/application evidence, with idempotent recovery semantics.

---

## C115 — proposal evidence/base state vs materially newer current Genome at approval time

**Status:** VERIFIED ACTIVE CONTRADICTION

A proposal may be generated from source events and an earlier business state, but approval does not bind to or validate an expected Genome/Blueprint revision.

```text
proposal means: change X based on state R1
current business state: R2
approval behavior: apply X to R2 without explicit conflict/rebase
```

Target resolution: knowledge change intent binds to the material base revision/preconditions it was evaluated against; stale proposals conflict/re-evaluate rather than blindly overwrite.

---

## C116 — learning-memory success/failure label vs actual business-outcome truth

**Status:** VERIFIED ACTIVE CONTRADICTION

Genome learning records can classify internal control/process events as outcomes:

```text
GenomeAutonomyGate ALLOW → SUCCESS
GenomeAutonomyGate BLOCK → FAILURE
GenomeSignal MERGED       → SUCCESS / "verified insight"
```

Yet these transitions do not establish downstream business success/failure or causal validity of the learned proposition.

Target resolution: preserve orthogonal process, control, execution, business-outcome and causal-learning evidence dimensions. Only evidence satisfying an explicit learning-eligibility contract may alter future confidence/policy/recommendation priors.

---

# Pool law

```text
VERIFICATION LABEL must agree with EXACT CURRENT KNOWLEDGE REVISION
GOVERNANCE VERB must agree with REAL DECISION AUTHORITY
CO-EXISTING KNOWLEDGE REPRESENTATIONS must expose AUTHORITATIVE OWNERSHIP + MATERIALIZATION STATE
APPLIED KNOWLEDGE MUTATION must agree with DURABLE DECISION EVIDENCE
CHANGE INTENT must agree with CURRENT SOURCE REVISION
LEARNING OUTCOME must not overstate PROCESS / CONTROL EVIDENCE
```

No production implementation is authorized by this supplement.
