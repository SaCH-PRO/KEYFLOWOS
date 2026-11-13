# KF-JOURNEY-016 — Business Genome Evolution

Status: ACTIVE MICROSCOPIC RECONSTRUCTION — INITIAL FORENSIC TRANCHE

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production implementation: READ-ONLY

## A. Definition

This journey asks how KeyFlowOS learns that the business has changed and how that new knowledge is allowed to alter future reasoning, readiness, recommendations and autonomous behavior.

The journey is not merely “edit the business profile.” It spans:

```text
observation / assertion / external outcome
→ evidence
→ inference / signal
→ review / acceptance / rejection
→ knowledge mutation
→ verification / confidence / freshness
→ derived readiness / risk / recommendations
→ autonomy / governed-action inputs
→ later execution outcomes
→ learning feedback
→ next knowledge revision
```

The core risk is epistemic: the system must know **what it knows, why it believes it, who was entitled to change it, which revision was changed, and whether later outcomes actually confirmed the learning**.

## B. Product intent

Business Genome is intended to become living business intelligence rather than static onboarding data. Repository evidence already contains:

- BusinessBlueprint DNA and integrity;
- GenomeFact / GenomeEvidence;
- GenomeSignal;
- GenomeModuleReadiness;
- GenomeRecommendation / GenomeExperiment;
- GenomeMemoryEvent / outcome learning;
- cross-domain Genome snapshots;
- Genome autonomy/readiness gating;
- TemporalFlow-derived evolution candidates.

That creates a powerful feedback architecture, but also means Genome mutation can affect what KEY believes and whether future actions appear ready/safe.

## C. Primary actors and principals

Current observed actors/sources include:

- authenticated business members;
- business owner / SUPER_ADMIN through generic guards;
- KEY-generated or system-generated signals;
- TemporalFlow events;
- inbox/conversation extraction;
- executive-mode findings;
- Blueprint/onboarding/genesis writes;
- domain snapshots and external-event-derived observations.

Current mutation paths do not consistently persist the identity/authority of the reviewer, accepter or merger.

## D. Entry surfaces observed

### Blueprint / DNA

`BlueprintController`

- `PATCH /blueprint/businesses/:businessId`
- `PATCH /blueprint/businesses/:businessId/genome/dna/:section`
- inference endpoints from onboarding/events

Class guards are `AuthGuard + BusinessGuard`; DNA patch adds `GenomeGateGuard`, which tests Three-Pillar completeness, not effective authority.

### Genome evolution proposal

`GenomeEvolutionController`

- create/list/edit/reject proposals;
- generate from TemporalFlow;
- approve evolution proposal.

Approve/generate add `GenomeGateGuard`; `BusinessGuard` allows owner or any membership.

### Key Genome signals

`KeyGenomeController`

- review / accept / reject / merge GenomeSignal;
- recommendation and experiment lifecycle;
- outcome/memory/governance surfaces.

Class guards are `AuthGuard + BusinessGuard` in the inspected controller surface.

## E. Current state machines

### Evolution proposal

```text
PENDING
  → EDITED
  → APPROVED
  → REJECTED
```

Observed weakness: proposal status is not the atomic owner of application state. `approve()` mutates Blueprint first and records APPROVED second.

### Genome signal

```text
NEW
→ REVIEWED
→ ACCEPTED → MERGED
         ↘ REJECTED
```

Observed weakness: ACCEPTED/MERGED do not carry durable decision-principal provenance in the inspected service API, and MERGED can overwrite an existing fact without binding a new verification state.

### GenomeFact epistemic state

Observed verification vocabulary includes:

```text
USER_VERIFIED
INFERRED
UNVERIFIED_IMPORTED
STALE
DISPUTED
```

But material value/source updates and verification-state updates are not currently inseparable. `upsertFact()` overwrites value/source while preserving prior verification status unless the caller explicitly supplies another status.

## F. Current causal graph

```text
TemporalFlowEvent / inbox / executive finding / Blueprint write
        ↓
GenomeEvolutionProposal OR GenomeSignal OR Blueprint direct mutation
        ↓
Blueprint JSON and/or GenomeFact
        ↓
Genome scoring / readiness / cross-domain snapshot
        ↓
GenomeAutonomyGate / KeyActionGenomePolicy / recommendations
        ↓
AutonomyOrchestrator + other control inputs
        ↓
governed action / execution
        ↓
OutcomeLearning / GenomeMemoryEvent
        ↓
future inference / recommendation / knowledge
```

The target must prevent process events from masquerading as business outcomes and prevent inferred values from inheriting verification belonging to older values.

## G. Data mutation ledger — initial tranche

### `GenomeEvolutionService.approve()`

```text
read GenomeEvolutionProposal
→ BlueprintService.updateDnaSection()
→ BlueprintService.calculateGenomeIntegrity()
→ GenomeEvolutionProposal.status = APPROVED
→ TemporalFlow event best effort
```

No transaction observed across Blueprint mutation + proposal decision record.
No expected Genome revision / old-value fingerprint observed.

### `BlueprintService.updateBlueprint()`

```text
read current BusinessBlueprint
→ merge JSON sections
→ compute scores using current GenomeFacts
→ write BusinessBlueprint
→ async/fire-and-forget Blueprint → GenomeFact backfill
→ TemporalFlow event best effort
→ readiness recomputation best effort
→ integrity-change EventEmitter signal
```

Blueprint commit is intentionally allowed to survive fact-sync failure.

### `GenomeSignalService.mergeSignal()`

```text
read ACCEPTED GenomeSignal
→ GenomeFactService.upsertFact()
→ attach GenomeEvidence
→ GenomeSignal.status = MERGED
→ recompute scoring/readiness
→ EventEmitter signal
→ GenomeMemoryEvent learning record
```

No reverse Blueprint materialization observed in this path.

## H. Truth topology — current implementation

At least two legitimate-looking business-knowledge representations exist:

1. `BusinessBlueprint` JSON/DNA;
2. `GenomeFact` rows.

And at least two mutation/evolution pipelines exist:

```text
EvolutionProposal / direct DNA edit
→ BusinessBlueprint
→ async Blueprint backfill
→ GenomeFact
```

versus:

```text
GenomeSignal
→ GenomeFact
```

The second path does not currently demonstrate reverse convergence into Blueprint.

Therefore “Genome” is not yet one physically or semantically unified truth surface.

## I. Authority / governance reconstruction

Three permissions must be separated:

```text
CAN EDIT KNOWLEDGE
!=
CAN VERIFY KNOWLEDGE
!=
CAN CHANGE AUTONOMY-RELEVANT KNOWLEDGE / POLICY
```

Current `BusinessGuard` establishes business access, not capability/effective authority.
Current `GenomeGateGuard` establishes minimum Genome completeness, not decision authority.

Material knowledge mutations that alter risk/readiness/autonomy must eventually bind to current K2/K3 effective authority / Clearance semantics without turning every low-risk profile edit into a heavyweight approval workflow.

## J. Evidence / provenance reconstruction

Target knowledge evidence must preserve at least:

```text
KnowledgeSubject / field identity
revision identity
value
source / source entity
observation time
provenance
verification state
verification principal + time
supporting EvidenceIds
confidence / freshness
risk-if-wrong
supersession/conflict relation
```

Verification must apply to a particular material value/revision, not merely to `(business, section, domain, field)` forever.

## K. Learning-loop reconstruction

`OutcomeLearningService` records process and business events into `GenomeMemoryEvent`.

Observed semantic compression includes:

- signal MERGED → memory outcome `SUCCESS` and lesson describing it as verified insight;
- GenomeAutonomyGate ALLOW → memory outcome `SUCCESS` before downstream business outcome;
- BLOCK → `FAILURE` despite blocking potentially being valid policy/authority behavior;
- failed action → generalized execution/readiness lesson.

Target distinction:

```text
PROCESS DECISION
!= KNOWLEDGE VERIFICATION
!= ACTION EXECUTION OUTCOME
!= BUSINESS OUTCOME
!= CAUSAL LEARNING
```

Learning can consume these as separate features/evidence, but must not collapse them into one success/failure axis.

## L. Positive seams to preserve

- explicit GenomeFact verification statuses;
- first-class GenomeEvidence;
- signal lifecycle rather than silent auto-write;
- readiness separated from raw completeness;
- fact freshness decay;
- risk-if-wrong scoring concept;
- TemporalFlow source lineage IDs;
- GenomeEvolutionProposal as a human-review seam;
- GenomeMemoryEvent as a durable learning evidence surface;
- AutonomyOrchestrator conservative composition across multiple gates;
- Blueprint compatibility layer for current product/UI surfaces.

## M. Initial verified findings

Canonical findings opened by this tranche:

- **F161** — verification provenance can survive replacement of the verified value/source;
- **F162** — Genome mutation authority is currently business access/completeness rather than effective knowledge-change authority, with incomplete decision-principal provenance;
- **F163** — Blueprint and GenomeFact form asymmetric dual truths with non-atomic one-way convergence;
- **F164** — proposal application and approval evidence are not atomic;
- **F165** — evolution proposals are not bound to an observed Genome revision/current-state precondition;
- **F166** — learning memory compresses process/control events into success/failure semantics that are stronger than the underlying evidence.

See `08L-FINDING-REGISTER-GENOME-EVOLUTION-SUPPLEMENT.md`.

## N. Initial contradictions

- **C111** verified label vs unverified replacement value/source;
- **C112** governance/approval language vs access/completeness authorization;
- **C113** Blueprint truth vs GenomeFact truth;
- **C114** proposal still actionable vs patch already applied after partial commit;
- **C115** proposal evidence/baseline vs later current Genome state;
- **C116** process success/failure memory vs actual business/outcome truth.

## O. Initial target direction

J16 does **not** justify a generic knowledge database rewrite yet.

Directionally converge on a semantic Business Knowledge contract:

```text
OBSERVATION / ASSERTION
→ provenance-bound Evidence
→ INFERENCE / SIGNAL
→ KNOWLEDGE CHANGE INTENT
→ authority + exact revision control when material
→ APPLY / REJECT / CONFLICT / SUPERSEDE
→ explicit materialization completeness
→ OUTCOME OBSERVATION
→ learning eligibility
→ future recommendation
```

Blueprint should eventually become either a canonical source for a clearly bounded subset or a compatibility/materialized representation of canonical knowledge. It cannot remain silently co-authoritative with GenomeFact where the same concept can diverge.

## P. Proof gaps

Existing inspected tests establish happy-path service behavior but do not yet prove:

- changing a fact value cannot inherit obsolete USER_VERIFIED state;
- stale Genome proposals cannot overwrite newer human knowledge;
- proposal application + decision evidence survives crash atomically/idempotently;
- a member lacking knowledge-change authority cannot verify/merge material knowledge;
- Blueprint and GenomeFact disagreement is detected/repaired;
- learning distinguishes control decisions from business outcomes;
- confidence/readiness cannot increase from false provenance;
- concurrent signal/proposal writes preserve revision truth.

No runtime tests were executed in this architecture-forensics tranche.

## Q. Cross-journey pressure

J16 immediately feeds back into:

- J1 — founding assertions and initial Business/Genome truth;
- J25 — who may verify/change business knowledge;
- J2 — knowledge used to form ActionEnvelope and policy inputs;
- J15 — exact-action/revision governance for material knowledge mutation;
- J6 — autonomy must not expand from self-authored/incorrect learning;
- J14 — external occurrences are not automatically verified business truth;
- J23 — time, staleness and revision boundaries;
- J18 — failed/recovered attempts must not teach wrong causal lessons.

## R. Active next reconstruction

Next J16 tranche should trace:

1. GenomeFact consumers and prompt/context injection;
2. Blueprint consumers that bypass GenomeFact;
3. domain Genome snapshot → recommendation → action → outcome-learning paths;
4. GenomeMemoryEvent consumers and any confidence/recommendation adaptation;
5. constitution/values versioning relationship to ordinary Genome facts;
6. deletion/privacy implications for learned evidence and derived knowledge;
7. standards/frontier comparison for provenance, temporal knowledge, belief revision and policy-safe adaptive systems.

Then pool J16/K4 backward through J6/J2/J15/J18.
