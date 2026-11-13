# KeyFlowOS Recommendation Register — Business Knowledge Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-048

Implementation baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production code: READ-ONLY

---

## KF-REC-049 — Establish a provenance- and revision-aware Business Knowledge Contract for Genome evolution and learning

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary kernel:** K4 Business Knowledge
**Supporting kernels:** K2 Human Authority, K3 KEY Authority/Governance, K5 Capability/Readiness, K6 State Transition, K7 Temporal/Event/Workflow, K8 Evidence/Outcome, K9 External Reality, K11 Recovery/Reliability

KeyFlowOS already contains the primitives of a living business-intelligence system, but current mutation, consumption and learning paths do not yet share one epistemic contract.

### A. Knowledge evolves by revision, not field overwrite alone

```text
KnowledgeSubject
→ KnowledgeRevision R1
→ evidence / verification tied to R1
→ proposed material change
→ KnowledgeRevision R2
```

A materially new value does not inherit verification, freshness or provenance from R1 unless an explicit rule proves those properties remain valid.

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

These may map to several existing structures; they must not be compressed into one status when their semantics differ.

### C. Bind material knowledge change to a base revision

```text
KnowledgeChangeIntent
+ base revision / old-value fingerprint / material preconditions
+ supporting EvidenceIds
+ proposer identity
+ expected impact
→ current-state revalidation
→ APPLY | CONFLICT | REBASE/REVIEW | REJECT
```

Last-write-wins is insufficient for autonomy-relevant business knowledge.

### D. Separate editing, verification and autonomy-impact authority

```text
CAN_EDIT_LOW_RISK_PROFILE_KNOWLEDGE
CAN_ASSERT_OR_PROPOSE_KNOWLEDGE
CAN_VERIFY_KNOWLEDGE
CAN_APPROVE_MATERIAL_KNOWLEDGE_CHANGE
```

These are capability/resource/risk aware and compose with K2/K3/J15. Do not create a second Genome-specific authority engine.

### E. Make knowledge mutation and decision evidence crash-consistent

A governed revision must not be applied while its proposal/approval evidence permanently remains unapplied or ambiguous. Use atomic persistence or an explicit recoverable application lifecycle.

### F. Resolve Blueprint / GenomeFact ownership explicitly

Classify each overlapping concept as:

```text
AUTHORITATIVE IN BLUEPRINT
AUTHORITATIVE IN GENOME FACT KERNEL
DERIVED / MATERIALIZED PROJECTION
COMPATIBILITY / LEGACY VIEW
DOMAIN-OWNED FACT REFERENCED BY GENOME
```

For projections expose source revision, materialized revision, freshness, last successful sync, conflict/incomplete state and repair mechanism.

The target is semantic single ownership, not necessarily one physical table.

### G. Evidence and verification are revision-specific

```text
Evidence
→ supports / contradicts KnowledgeRevision
→ verification decision by identified principal
→ verification time + scope
```

Old verification remains historical evidence for the old revision after a material value change.

### H. Introduce LearningEligibility as a derived gate

Before an outcome changes future confidence, recommendation ranking or adaptive policy:

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

Control decisions, execution outcomes and business outcomes remain distinct.

### I. Learning may propose policy; it cannot grant authority

```text
LEARNING / MODEL CONFIDENCE CHANGE
→ may alter prioritization / recommendations / candidate policy
→ must NOT silently increase capability, risk tier, spend ceiling,
  resource scope, delegation duration or approval rights
```

Any material authority/policy expansion follows K3 governance.

### J. Establish consumer-specific epistemic contracts

F175/F176 prove that storage-level knowledge currently flows into two materially different consumers without sufficient epistemic qualification.

Target:

```text
CANONICAL KnowledgeRevision + Evidence state
        ↓
consumer-specific epistemic predicate
        ↓
eligible representation for that consumer
```

Do **not** create separate truth stores per consumer. Derive eligibility from the same knowledge/evidence state.

#### J1. Deterministic readiness / control contract

For facts that satisfy module/capability readiness:

```text
KnowledgeSubject / requirement
+ accepted verification classes
+ minimum evidence/confidence
+ freshness/expiry rule
+ dispute/conflict rule
+ risk-if-wrong sensitivity
+ provenance/source constraints where material
→ SATISFIED | DEGRADED | BLOCKING
```

`ROW EXISTS` is never sufficient by itself for a blocking autonomy requirement.

High-impact mutation should fail closed when the epistemic predicate is not satisfied.

#### J2. Model / prompt context contract

Prompt retrieval may include uncertain information, but it must preserve its epistemic role:

```text
VERIFIED CURRENT     → usable as current working knowledge
CONTEXTUAL / INFERRED → advisory, not authoritative
STALE                → historical/context; revalidate before reliance
DISPUTED             → present conflict explicitly
EXPIRED              → historical only unless refreshed
```

The model may reason *about* uncertainty; it must not receive uncertain data formatted as unqualified current truth.

#### J3. Recommendation / analytics contract

Recommendations and analytics should record which knowledge revision/evidence state produced them so later revision changes can mark them stale, superseded or needing recomputation.

#### J4. Learning-input contract

Only LearningEligibility-qualified outcomes may change durable adaptive confidence/policy. Raw process completion or a high-ranked memory fragment is not causal proof.

### K. Memory retrieval must preserve enough epistemic semantics

`GenomeMemoryEvent` is an active reasoning source through UnifiedMemoryRetrieval/Cortex prompts and currently receives a high retrieval source weight.

Therefore retrieval projections must retain enough metadata for the model to distinguish:

```text
process/control event
execution outcome
business outcome
causal lesson
certainty / recovery state
```

Ranking should not erase the semantic type of the evidence it ranks.

This strengthens F166; it does not create a separate memory-truth architecture.

### L. Preserve contradictions instead of prematurely normalizing them

```text
CONTRADICTION DETECTED
→ preserve both provenance chains
→ lower/qualify action relevance as appropriate
→ seek reconciliation / human verification / external truth
→ do not erase uncertainty by last-write-wins
```

### M. Privacy / deletion reaches derived knowledge

J19 must define how source deletion, correction, legal retention and user exit affect:

- KnowledgeEvidence;
- KnowledgeRevision provenance;
- GenomeMemoryEvent;
- semantic/vector representations;
- derived snapshots/recommendations;
- audit evidence that must legally remain.

Derived learning is not exempt from data-governance lineage.

---

## Findings directly addressed

- F161 verification provenance transfer;
- F162 access/completeness substituted for knowledge-change authority;
- F163 asymmetric Blueprint/GenomeFact truth;
- F164 non-atomic proposal application/evidence;
- F165 stale proposal application;
- F166 process/control outcome compression in learning + memory-retrieval amplification;
- F175 epistemically weak facts can satisfy automation readiness;
- F176 stale/disputed/expired/weak facts can enter KEY working-knowledge prompts.

## Contradictions directly addressed

- C111–C116 initial J16/K4 contradictions;
- C125 weak fact vs automation-ready state;
- C126 weak/stale/disputed fact vs active prompt working knowledge.

## Relationships

```text
K8/K9/K11 outcome certainty
        ↓
KF-REC-048 recovery / external certainty
        ↓
KF-REC-049 knowledge revision + consumer eligibility + learning
        ↓
K3/J15 current authority / Clearance
        ↓
J6 autonomous proposal / execution
```

KF-REC-049 does not make Genome the authority engine, TemporalFlow the knowledge source of truth, or each consumer a separate truth owner.

---

# Promotion / convergence requirements

Before KF-REC-049 reaches L6/L7:

- map all GenomeFact consumers;
- map all Blueprint/Constitution consumers and overlapping concepts;
- map every knowledge write path and actor/provenance;
- characterize divergence and verification ambiguity;
- define revision identity/current-state preconditions;
- define authority classes for edit/assert/verify/material change;
- define projection/materialization compatibility strategy;
- define epistemic predicates for deterministic control, prompts, recommendations and learning;
- map GenomeMemoryEvent consumers and actual adaptive effects;
- bind J18/K8/K9 outcome certainty into LearningEligibility;
- backward re-audit J1/J25/J2/J15/J6/J14/J23/J18;
- include J19 deletion/privacy lineage;
- perform standards/OSS/frontier research before target convergence;
- design concurrency, stale-proposal, crash, conflict, false-readiness, false-prompt-truth and false-learning proof obligations.

No production implementation is authorized by this continuation.
