# KeyFlowOS Recommendation Register — Business Knowledge Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-048

Implementation baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production code: READ-ONLY

---

## KF-REC-049 — Establish a provenance- and revision-aware Business Knowledge Contract for Genome evolution and learning

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary kernel:** K4 Business Knowledge
**Supporting kernels:** K2 Human Authority, K3 KEY Authority/Governance, K6 State Transition, K7 Temporal/Event/Workflow, K8 Evidence/Outcome, K9 External Reality, K11 Recovery/Reliability

KeyFlowOS already contains the primitives of a living business-intelligence system, but current mutation and learning paths do not yet share one epistemic contract.

### A. Knowledge must evolve by revision, not by field overwrite alone

For any action-influencing concept:

```text
KnowledgeSubject
→ KnowledgeRevision R1
→ evidence / verification tied to R1
→ proposed material change
→ KnowledgeRevision R2
```

A new material value must not inherit verification, freshness or provenance belonging to R1 unless an explicit rule proves those properties still apply.

### B. Preserve the epistemic lifecycle

At minimum distinguish:

```text
OBSERVED
ASSERTED
INFERRED
REVIEWED
ACCEPTED
VERIFIED
DISPUTED
STALE
SUPERSEDED
```

These are not necessarily one enum/table. They are semantic dimensions that existing Blueprint/Genome/Signal/Evidence structures must map into without compression.

### C. Bind material knowledge change to a base revision

A knowledge-changing proposal should carry enough information to determine whether the state it was evaluated against is still current:

```text
KnowledgeChangeIntent
+ base revision / old-value fingerprint / material preconditions
+ supporting EvidenceIds
+ proposer identity
+ expected impact
→ current-state revalidation
→ APPLY | CONFLICT | REBASE/REVIEW | REJECT
```

Last-write-wins is not sufficient for autonomy-relevant business knowledge.

### D. Separate editing, verification and autonomy-impact authority

Target:

```text
CAN_EDIT_LOW_RISK_PROFILE_KNOWLEDGE
CAN_ASSERT_OR_PROPOSE_KNOWLEDGE
CAN_VERIFY_KNOWLEDGE
CAN_APPROVE_MATERIAL_KNOWLEDGE_CHANGE
```

must be capability/resource/risk aware.

Use K2/K3/J15 effective authority and Clearance semantics. Do not create a second Genome-specific authority engine.

### E. Make knowledge mutation and decision evidence crash-consistent

A material governed revision must not be applied while its proposal/approval record permanently remains unapplied or ambiguous.

Depending on existing transaction boundaries, use atomic persistence or an explicit recoverable application lifecycle. Do not infer application solely from an approval verb.

### F. Resolve Blueprint / GenomeFact ownership explicitly

Do not immediately replace either representation.

First classify every overlapping concept as one of:

```text
AUTHORITATIVE IN BLUEPRINT
AUTHORITATIVE IN GENOME FACT KERNEL
DERIVED / MATERIALIZED PROJECTION
COMPATIBILITY / LEGACY VIEW
DOMAIN-OWNED FACT REFERENCED BY GENOME
```

For projections, expose:

```text
source revision
materialized revision
freshness
last successful sync
incomplete / conflicting state
repair mechanism
```

The target is semantic single ownership, not necessarily one universal physical table.

### G. Make evidence and verification revision-specific

Target evidence chain:

```text
Evidence
→ supports / contradicts KnowledgeRevision
→ verification decision by identified principal
→ verification time + scope
```

If the value changes materially, old verification remains historical evidence for the old revision and does not label the replacement as verified.

### H. Introduce Causal Learning Eligibility as a derived gate

Before an outcome changes future confidence, recommendation ranking or adaptive policy, determine whether it is eligible evidence for the claimed lesson.

Conceptually:

```text
OutcomeEvidence certainty
+ exact action/effect lineage
+ consequence completeness
+ temporal attribution
+ domain relevance
+ contradiction state
+ recovery status
→ LearningEligibility
```

Examples:

- `GenomeAutonomyGate = ALLOW` is a control decision, not business success.
- `BLOCK` may be correct governance, not failure.
- failed provider attempt with later recovery is not necessarily evidence that the business strategy was bad.
- provider success with local consequence failure must not teach external-effect failure.

### I. Learning may propose policy; it cannot grant authority

```text
LEARNING / MODEL CONFIDENCE INCREASE
→ may change prioritization / recommendations / candidate policy
→ must NOT silently increase capability, risk tier, spend ceiling, resource scope, delegation duration or approval rights
```

Any material policy/authority change follows K3 governance.

### J. Retrieval and prompting should be provenance-sensitive

When KEY consumes business knowledge, important facts should carry enough metadata to distinguish verified current knowledge from inferred/stale/disputed observations.

High confidence should be explainable from durable provenance/evidence, not merely from a scalar score.

### K. Preserve contradictions instead of prematurely normalizing them

Where two credible sources disagree:

```text
CONTRADICTION DETECTED
→ preserve both provenance chains
→ lower/qualify action relevance as appropriate
→ seek reconciliation / human verification / external truth
→ do not erase uncertainty by last-write-wins
```

This composes with contradiction-aware Temporal Work Projection but remains a K4 knowledge concern.

### L. Privacy / deletion must reach derived knowledge

J19 must later define how source deletion, correction, legal retention and user exit affect:

- KnowledgeEvidence;
- KnowledgeRevision provenance;
- GenomeMemoryEvent;
- semantic/vector representations;
- derived snapshots/recommendations;
- audit evidence that must legally remain.

Do not treat derived learning as exempt from data-governance lineage.

---

## Findings directly addressed

- F161 verification provenance transfer;
- F162 access/completeness substituted for knowledge-change authority;
- F163 asymmetric Blueprint/GenomeFact truth;
- F164 non-atomic proposal application/evidence;
- F165 stale proposal application;
- F166 process/control outcome compression in learning.

## Relationships to existing recommendations

```text
K8 / outcome certainty
        ↓
KF-REC-048 certainty-aware recovery
        ↓
KF-REC-049 provenance/revision-aware knowledge + learning
        ↓
K3/J15 current authority and Clearance
        ↓
J6 autonomous action proposals / execution
```

KF-REC-049 does not make Genome the authority engine and does not make TemporalFlow the knowledge source of truth.

---

# Promotion / convergence requirements

Before KF-REC-049 reaches L6/L7:

- map all GenomeFact consumers;
- map all Blueprint consumers and overlapping concepts;
- map every knowledge write path and its actor/provenance;
- characterize existing data divergence and verification ambiguity;
- define revision identity/current-state preconditions;
- define exact authority classes for edit/assert/verify/material change;
- define projection/materialization compatibility strategy;
- map GenomeMemoryEvent consumers and actual adaptive effects;
- bind J18/K8/K9 outcome certainty into learning eligibility;
- backward re-audit J1/J25/J2/J15/J6/J14/J23/J18;
- include J19 deletion/privacy lineage;
- perform standards/OSS/frontier research before target convergence;
- design concurrency, stale-proposal, crash, conflict and false-learning proof obligations.

No production implementation is authorized by this continuation.
