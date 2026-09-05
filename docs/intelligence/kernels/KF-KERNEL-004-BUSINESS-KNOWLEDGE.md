# KF-KERNEL-004 — Business Knowledge

Status: ACTIVE KERNEL — INITIAL TARGET SYNTHESIS FROM J16

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production implementation: READ-ONLY

## 1. Kernel thesis

K4 owns the semantics by which assertions about a business become durable, provenance-bound, revisable knowledge that KEY may safely use for reasoning, readiness, recommendations and governed action.

It is the epistemic kernel of KeyFlowOS.

K4 does **not** own:

- human or KEY authority itself — K2/K3;
- raw outcome/evidence truth — K8;
- temporal execution/work lifecycle — K7;
- provider/external reality — K9;
- state-transition legality — K6;
- recovery semantics — K11.

It consumes those kernels to answer:

> What does KeyFlowOS currently believe about this business, why, with what certainty, based on which exact revision/evidence, and may that belief safely influence future behavior?

## 2. Why K4 is now active

J16 forensic reconstruction exposed a non-trivial knowledge system already present in the repository:

```text
BusinessBlueprint
GenomeFact
GenomeEvidence
GenomeSignal
GenomeEvolutionProposal
GenomeModuleReadiness
GenomeRecommendation
GenomeExperiment
GenomeMemoryEvent
cross-domain Genome snapshots
TemporalFlow-derived signals
```

These are not merely profile/storage concerns. Their outputs affect `GenomeAutonomyGateService` and `AutonomyOrchestratorService`; therefore knowledge integrity can change the set of actions KEY believes are safe or ready.

## 3. Current truth topology

Observed write topology:

```text
Human / onboarding / Genesis / evolution proposal
        ↓
BusinessBlueprint
        ↓ async / best effort
KeyGenomeBackfillService
        ↓
GenomeFact
```

and independently:

```text
Temporal / inbox / executive / domain observation
        ↓
GenomeSignal
        ↓ review / accept / merge
GenomeFact
```

No symmetric GenomeFact → Blueprint convergence was observed in the initial trace.

Current architecture therefore contains a compatibility/ownership ambiguity that K4 must resolve semantically before physical migration is designed.

## 4. Core epistemic distinctions

K4 must preserve:

```text
OBSERVATION
!= ASSERTION
!= INFERENCE
!= ACCEPTANCE
!= VERIFICATION
!= CANONICAL KNOWLEDGE
!= PROJECTION
!= RECOMMENDATION
!= BUSINESS OUTCOME
!= CAUSAL LEARNING
```

Likewise:

```text
KNOWLEDGE EDIT AUTHORITY
!= KNOWLEDGE VERIFICATION AUTHORITY
!= AUTHORITY TO ALTER AUTONOMY-RELEVANT KNOWLEDGE/POLICY
```

## 5. Candidate semantic primitives

These are semantic roles, not mandates for new universal tables.

### KnowledgeSubject
The exact business concept/coordinate being described.

### KnowledgeRevision
One material value/state of that subject with immutable provenance identity.

### KnowledgeEvidence
K8 evidence supporting, contradicting or contextualizing a revision.

### KnowledgeAssertion
A human/system/provider statement that may or may not become accepted knowledge.

### KnowledgeInference
A derived belief with explicit method/source/confidence, never silently equivalent to verification.

### KnowledgeChangeIntent
A proposed change bound to an observed base revision/material preconditions.

### KnowledgeVerification
A decision by an appropriately authorized principal about one exact revision/value.

### KnowledgeConflict
Two or more incompatible live assertions/revisions whose relationship is not safely resolvable by last-write-wins.

### MaterializationState
Evidence describing whether compatibility/projection surfaces have caught up with the authoritative revision.

### LearningEligibility
A derived predicate stating whether an outcome/evidence chain is sufficiently certain, attributable and relevant to adjust future knowledge/recommendation priors.

## 6. Initial K4 invariants

### K4-I1 — Verification non-transfer

```text
VALUE / MATERIAL PROVENANCE CHANGE
→ NEW KNOWLEDGE REVISION
→ PRIOR VERIFICATION DOES NOT TRANSFER AUTOMATICALLY
```

### K4-I2 — Exact provenance
Every action-influencing knowledge revision can explain source, source identity, evidence, observation time, revision time and verification state.

### K4-I3 — Conflict over silent overwrite
When two materially incompatible claims cannot be safely ordered by domain semantics, represent contradiction/supersession explicitly rather than silently treating the newest writer as truth.

### K4-I4 — One authoritative revision owner per concept
Multiple read/materialization surfaces may exist, but ownership and convergence direction must be explicit.

### K4-I5 — Materialization honesty
A compatibility projection may be stale/incomplete, but the system must be able to know that and repair it.

### K4-I6 — Freshness is epistemic
Updating a row for technical reasons must not falsely make the underlying knowledge fresh. Freshness follows the knowledge/evidence revision, not arbitrary persistence time.

### K4-I7 — Current authority governs material knowledge mutation
Historical approval, business membership, model confidence or previous autonomy cannot create present knowledge-change authority.

### K4-I8 — Learning cannot grant authority
Learning may affect ranking, proposals, confidence or recommended policy. It may not silently expand capability, risk tier, spending limit, delegation scope or governance rights.

### K4-I9 — Outcome certainty gates learning
An ambiguous/recovered/provider-incomplete execution outcome cannot be used as clean causal success/failure evidence.

### K4-I10 — Control correctness is not business success
A valid BLOCK can be excellent governance, not a failed business action. An ALLOW can be correct control while the business action later fails.

### K4-I11 — Revision-safe proposal application
A knowledge change intent must be revalidated against the material base/current revision before mutation.

### K4-I12 — Knowledge mutation + governance evidence are crash-consistent
For material governed changes, the applied revision and the durable decision/application evidence cannot permanently disagree.

## 7. K4 relationship to existing kernels

### K2 Human Authority & Organization
Supplies who the human is and organizational role/delegation context.

### K3 KEY Authority & Governance
Supplies current Clearance/control for material knowledge verification/change. K4 must not create a parallel policy engine.

### K6 State Transition
Defines legal transitions for proposal/signal/revision/conflict state machines.

### K7 Temporal / Event / Workflow
Supplies temporal lineage and long-running work. Temporal occurrence alone does not establish knowledge truth.

### K8 Evidence & Outcome
Owns durable evidence/outcome certainty. K4 interprets eligible evidence as support/contradiction for beliefs.

### K9 Integration & External Reality
Supplies provider/external truth and reconciliation. External observation may be high-quality evidence but must retain provider semantics.

### K10 Financial Truth
Financial Genome learning must consume converged financial truth rather than partial provider/local states.

### K11 Recovery & Reliability
Recovery/ambiguity semantics prevent failed attempts or consequence-incomplete work from being mislabeled as clean causal outcomes.

## 8. Target learning loop

```text
External / domain / human observation
        ↓
Evidence with certainty + provenance
        ↓
Assertion / inference
        ↓
conflict + freshness + risk evaluation
        ↓
KnowledgeChangeIntent
        ↓
current authority / verification requirement when material
        ↓
KnowledgeRevision applied / rejected / superseded / disputed
        ↓
explicit projection/materialization convergence
        ↓
reasoning / recommendation / governed action
        ↓
OutcomeEvidence + provider/domain consequence convergence
        ↓
LearningEligibility
        ↓
update confidence / recommendation priors / candidate policy
        ↓
NEVER silent authority expansion
```

## 9. Initial migration direction

Not yet physical-table converged.

Direction:

1. identify concept ownership between Blueprint and GenomeFact;
2. classify Blueprint fields into authoritative-source, compatibility-projection or legacy categories;
3. establish revision/provenance behavior before attempting broad data movement;
4. characterize live divergence and historical verification ambiguity;
5. add detectability/repair before removing any old read surface;
6. preserve existing UI/product behavior during migration;
7. keep Business Graph / Genome / Blueprint distinctions meaningful rather than merging all knowledge into a generic store.

## 10. Innovation pressure

### H1 — Floor
Production-grade knowledge provenance, optimistic concurrency/versioning, auditability, conflict handling, access control, projection repair, temporal validity.

### H2 — Frontier
Temporal knowledge graphs, provenance-aware belief revision, causal inference eligibility, policy-safe adaptive systems, contradiction-aware retrieval and confidence calibration.

### H3 — KeyFlow synthesis
KeyFlow can potentially combine:

```text
Business Graph
+ Genome revisions
+ temporal history
+ current authority
+ K8 outcome evidence
+ K9 external truth
+ K11 recovery certainty
```

to produce a **governed epistemic loop** where KEY not only knows facts, but knows the provenance, contradiction, freshness and causal reliability of what it learns before that learning changes autonomous behavior.

High-value target candidates:

- contradiction-aware knowledge projection;
- provenance-sensitive retrieval/prompting;
- Causal Learning Eligibility as a derived evidence gate;
- revision-aware Genome change proposals;
- confidence that is explainable by evidence lineage rather than opaque model self-assessment.

Do not introduce a new vector DB, graph DB, workflow engine or generic “belief ledger” merely for novelty.

## 11. Current findings / contradictions

Findings: F161–F166.
Contradictions: C111–C116.

Primary dossier:
`journeys/KF-JOURNEY-016-BUSINESS-GENOME-EVOLUTION.md`

## 12. Proof obligations — initial

Future proof design must include at least:

- replacement value cannot inherit obsolete USER_VERIFIED provenance;
- stale proposal conflicts/revalidates rather than overwrites;
- concurrent signal/proposal/human edits preserve revision integrity;
- material knowledge mutation requires correct current authority;
- crash between mutation and governance evidence is recoverable/idempotent;
- Blueprint/GenomeFact divergence is detectable and repairable;
- technical row update cannot falsely refresh knowledge age;
- ambiguous provider/recovery outcome cannot become clean success/failure learning;
- valid governance BLOCK is not learned as business failure;
- learning cannot increase authority envelope;
- tenant boundaries hold across evidence, facts, memory and projections;
- deletion/privacy policy propagates into derived learning/materializations.

No runtime proof has been executed in this tranche.

## 13. Exact next pressure

Deepen J16 through:

1. all GenomeFact consumers and prompt/context injection;
2. Blueprint consumers that bypass facts;
3. GenomeMemoryEvent consumers/adaptation loops;
4. domain snapshot → recommendation → execution → outcome linkage;
5. constitution/values versioning;
6. J19 privacy/deletion implications;
7. external standards/frontier research;
8. backward re-audit J1/J25/J2/J15/J6/J14/J23/J18 using K4 invariants.
