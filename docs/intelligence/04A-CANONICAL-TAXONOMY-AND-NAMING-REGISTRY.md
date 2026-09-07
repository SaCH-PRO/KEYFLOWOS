# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-06

Purpose: prevent semantic duplication, alias drift, repeated indexing, inconsistent naming and multiple canonical entries for the same KeyFlowOS concept.

Numeric allocation for findings, contradictions and recommendations is governed by `04B-CANONICAL-ID-ALLOCATION-LEDGER.md`.

---

# 1. Prime law

```text
ONE SEMANTIC CONCEPT
→ ONE CANONICAL ID
→ ONE CANONICAL NAME
→ ONE CANONICAL OWNER / HOME REGISTER
→ ZERO DUPLICATE CANONICAL ENTRIES
→ MANY ALIASES / REFERENCES PERMITTED
```

Aliases are references, not new concepts.

---

# 2. Mandatory pre-create gate

Before creating any journey, kernel, concept, finding, contradiction, recommendation, decision, proof namespace or execution packet:

```text
LOAD 04-CONCEPT-REGISTRY + 04A + 04B
→ SEARCH exact term + synonyms + implementation names + target names
→ CLASSIFY:
   SAME CONCEPT
   SPECIALIZATION
   RELATED BUT DISTINCT
   IMPLEMENTATION ALIAS
   HISTORICAL/DEPRECATED NAME
   GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE FIRST
→ allocate only if genuinely distinct and stable
```

If new:

```text
allocate next globally unused ID from 04B
→ define it in exactly one canonical home
→ update 04B + CURRENT + ROLLOVER
```

---

# 3. Canonical namespaces

## Journeys

```text
J1 ... J25
```

Identity source: `03-ANALYSIS-MAP.md`.
Detailed dossiers: `docs/intelligence/journeys/`.

Journey number is identity. New wording does not create a second journey for the same end-to-end business/user transition.

Examples:

```text
J16 — Business Genome Evolution
J17 — Command Center → Priority → Action
J19 — Privacy / Deletion / Exit
J7  — Financial Truth
```

## Kernels

```text
K1 ... K12
```

Identity source: `12-KERNEL-PROGRAMME.md`.
Detailed dossiers: `docs/intelligence/kernels/`.

`Business Knowledge Kernel`, `Knowledge Kernel`, and Genome-knowledge architecture refer to K4 unless a narrower implementation seam is explicitly intended.

`Financial Truth` refers to K10 at kernel level and J7 at journey level; the journey and kernel are related but not interchangeable identifiers.

## Concepts

```text
KF-CONCEPT-###
```

Canonical home: `04-CONCEPT-REGISTRY.md`.

Current range:
```text
KF-CONCEPT-001–KF-CONCEPT-042
```

Use only for stable reusable semantic concepts, not implementation class names or temporary investigative phrases.

## Findings

```text
F###
```

Canonical home: `08*` registers; allocation owner: 04B.

Current range:
```text
F001–F189
```

Latest pooled roots:
```text
F175 epistemic readiness eligibility
F176 prompt/current-truth eligibility
F177 causal learning attribution
F178 correction/withdrawal influence lineage
F179–F184 Command Center / operator-attention roots
F185 live cash ownership
F186 multi-currency valuation
F187 payroll financial outcome
F188 PayPal capture financial consequence completeness
F189 canonical financial source identity / CreditNote reversal reachability
```

## Contradictions

```text
C###
```

Canonical home: `09*` registers; allocation owner: 04B.

Current range:
```text
C001–C139
```

Latest pooled roots:
```text
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135 live cash projection vs ledger-derived truth
C136 heterogeneous currency addition vs valuation truth
C137 PayrollRun PAID vs proved disbursement/accounting consequence
C138 provider/payment/invoice success vs payment accounting consequence completion
C139 canonical Invoice posting lineage vs mismatched CreditNote lookup discriminator
```

## Recommendations

```text
KF-REC-###
```

Canonical home: `10*` continuations; allocation owner: 04B.

Current range:
```text
KF-REC-001–KF-REC-052
```

Current major targets:
```text
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition controls
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
```

## Decisions

```text
KF-DEC-###
```

Canonical home: `05-DECISION-REGISTER.md`.
Recommendations remain provisional until explicitly accepted as decisions.

## Execution packets

```text
KF-EXEC-<DOMAIN>-###
```

Canonical home: `docs/intelligence/execution/`.
Execution identity is implementation scope, not concept identity.

## Proof obligations

Preferred bounded form:
```text
PF-<SCOPE>-###
```

Proof IDs remain local to a declared scope until deliberately promoted.

---

# 4. Canonical naming dimensions

Reusable architecture terms should specify where applicable:

```text
IDENTITY      what semantic thing is this?
LAYER         product | journey | kernel | semantic primitive | implementation | projection
OWNER         which kernel/domain owns truth?
STATUS        canonical | working | candidate | implementation seam | deprecated
SCOPE         global | journey | domain | provider | bounded packet
TEMPORALITY   definition | occurrence | revision | attempt | snapshot | projection
AUTHORITY     authoritative | derived | advisory | compatibility
```

---

# 5. High-value alias / distinction registry

| Alias / implementation term | Canonical reference | Rule |
|---|---|---|
| Business Knowledge Kernel | K4 | same kernel |
| Knowledge Kernel | K4 | shorthand in KeyFlow architecture context |
| Business Genome | KF-CONCEPT-003 | living evidence-aware interpretation |
| GenomeFact | KF-CONCEPT-004 | current implementation primitive, not automatically canonical truth |
| Resolved / Canonical Fact | KF-CONCEPT-017 | ontology-resolved current truth |
| Business Blueprint | KF-CONCEPT-002 | declaration/configuration, not resolved operational truth |
| Business Graph | KF-CONCEPT-007 | complete factual business reality KeyFlow may legitimately treat as true |
| Clearance | KF-CONCEPT-026 | current exact authorization to execute |
| Execution Claim | KF-CONCEPT-028 | exclusive consumption/effect pursuit, distinct from AttemptOwnership |
| Temporal Work Projection | KF-REC-047 target | derived operator projection, not workflow truth |
| Recovery Control Twin | J23/J18 target-candidate | derived operational lens, not separate source of truth |
| Operator Attention & Priority Contract | KF-REC-051 | governs derivative attention/priority semantics, not business truth or authority |
| Financial Truth & Valuation Contract | KF-REC-052 | governs financial truth layers, valuation and consequence completeness |
| historical workflow-control findings | F167/F168 | remapped by 04B |
| historical recurrence findings | F169/F170 | remapped by 04B |
| historical provider-recovery findings | F171/F172 | remapped by 04B |
| historical scheduled/compensation findings | F173/F174 | remapped by 04B |
| historical workflow-control KF-REC-046 | KF-REC-050 | preserved KF-REC-046 means workflow versioning |

---

# 6. Reserved J16/K4 vocabulary

Use these exact terms until semantic boundaries stabilize:

```text
KnowledgeSubject
KnowledgeRevision
KnowledgeAssertion
KnowledgeInference
KnowledgeChangeIntent
KnowledgeVerification
KnowledgeConflict
MaterializationState
EpistemicEligibility
LearningEligibility
```

Status: **RESERVED TARGET VOCABULARY — NOT YET AUTOMATICALLY KF-CONCEPT IDs**.

Research also uses the following candidate phrases only descriptively; do not canonize without a taxonomy pass:

```text
Governed Epistemic Loop
Epistemic Time Travel
Verified Influence Closure
Adaptive Confidence Budget
CorrectionCompletionEvidence
```

These currently belong inside K4/KF-REC-049, not separate architecture systems.

---

# 7. Commonly confused concepts

```text
Business Blueprint != Business Genome != Business Graph
Observation != Assertion != Evidence
GenomeFact != Resolved Fact
Accepted != Verified
Verification != Clearance
Readiness != Authority
Approval / ControlEvidence != current Clearance
Clearance != Execution Claim
EffectId != AttemptId
WorkOccurrence != EffectId
Original EffectId != RecoveryEffectId
Process success != execution outcome != business outcome != causal learning
OutcomeCertainty != LearningEligibility
Stored fact != EpistemicEligibility for a consumer
Correction != descendant convergence
Projection != authoritative truth
Learning != authority
Operational financial state != external money reality != accounting truth
Payment row existence != financial consequence completeness
Webhook receipt identity != descendant consequence completion
Native currency amount != reporting valuation amount
Financial source string literal != canonical FinancialSourceIdentity
```

---

# 8. Rename / merge procedure

Never silently rename or reassign a canonical ID.

```text
load 04B
→ choose surviving canonical ID
→ remap or alias historical entry
→ preserve historical evidence
→ never reuse old numeric meaning for a different future concept
→ update CURRENT + ROLLOVER
```

---

# 9. Index integrity rules

1. IDs are monotonically allocated and never reused.
2. One canonical ID has one current semantic meaning/home.
3. Supplement filename letters are organizational labels, never allocators.
4. Reappearance across journeys reuses existing IDs.
5. Implementation classes/tables do not automatically receive architecture IDs.
6. Candidate primitives may be reserved by name before permanent concept allocation.
7. `04-CONCEPT-REGISTRY` owns semantic vocabulary.
8. `04B` owns numeric F/C/KF-REC allocation.
9. Journey/Kernel maps own J/K identity.
10. CURRENT/HANDOFF/ROLLOVER carry current ranges/frontier.
11. A duplicate or stale canonical range is an intelligence-integrity defect and is repaired before broad analysis continues.
12. Search/reuse is mandatory across ChatGPT, Claude Code and Kimi Code sessions.

---

# 10. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F189
Contradiction range:     through C139
Recommendation range:    through KF-REC-052
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
```

The historical collision band remains reconciled without deleting evidence. K4 candidate vocabulary remains reserved rather than prematurely promoted. J17 and J7 targets remain recommendations, not new parallel systems.

No production implementation is authorized by this taxonomy artifact.
