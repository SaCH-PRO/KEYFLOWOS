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
Journey number is identity.

## Kernels

```text
K1 ... K12
```

Identity source: `12-KERNEL-PROGRAMME.md`.

## Concepts

```text
KF-CONCEPT-###
```

Canonical home: `04-CONCEPT-REGISTRY.md`.
Current range: `KF-CONCEPT-001–KF-CONCEPT-042`.

## Findings

```text
F###
```

Canonical home: `08*` registers; allocation owner: 04B.
Current range: `F001–F203`.

Latest roots:
```text
F185–F196 J7 Financial Truth
F197 commercial customer evidence vs Contact lifecycle convergence
F198 pipeline value + realized revenue vs non-duplicative customer LTV
F199 completed service vs missing durable receivable consequence
F200 deposit vs final service receivable settlement lineage
F201 cancellation/no-show vs financial descendant disposition
F202 RevenueAttribution pipeline vs realized revenue stage
F203 canonical CRM statuses vs KeyCortex lowercase/non-canonical predicates
```

## Contradictions

```text
C###
```

Canonical home: `09*` registers; allocation owner: 04B.
Current range: `C001–C153`.

Latest roots:
```text
C135–C146 J7 Financial Truth
C147 customer commercial reality vs Contact.status
C148 pipeline value + realized revenue vs customer LTV
C149 completed service vs missing durable receivable consequence
C150 deposit semantics vs additive final service receivable
C151 booking cancellation/no-show vs unresolved financial descendants
C152 RevenueAttribution as one revenue stage vs heterogeneous value stages
C153 canonical CRM status algebra vs KeyCortex lead/customer aliases
```

## Recommendations

```text
KF-REC-###
```

Canonical home: `10*` continuations; allocation owner: 04B.
Current range: `KF-REC-001–KF-REC-052`.

Current major pooled targets:
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

Execution identity is implementation scope, not concept identity.

## Proof obligations

Preferred bounded form: `PF-<SCOPE>-###`.
Proof IDs remain local to a declared scope until deliberately promoted.

---

# 4. Canonical naming dimensions

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

# 5. High-value aliases / distinctions

| Alias / implementation term | Canonical reference | Rule |
|---|---|---|
| Business Knowledge Kernel | K4 | same kernel |
| Knowledge Kernel | K4 | shorthand |
| Business Genome | KF-CONCEPT-003 | living evidence-aware interpretation |
| GenomeFact | KF-CONCEPT-004 | implementation primitive, not automatically canonical truth |
| Resolved / Canonical Fact | KF-CONCEPT-017 | ontology-resolved current truth |
| Business Blueprint | KF-CONCEPT-002 | declaration/configuration |
| Business Graph | KF-CONCEPT-007 | factual business reality KeyFlow may legitimately treat as true |
| Clearance | KF-CONCEPT-026 | current exact authorization to execute |
| Execution Claim | KF-CONCEPT-028 | exclusive exact-effect pursuit |
| Temporal Work Projection | KF-REC-047 target | derived operator projection, not workflow truth |
| Operator Attention & Priority Contract | KF-REC-051 | derivative attention/priority semantics, not business truth or authority |
| Financial Truth & Valuation Contract | KF-REC-052 | financial truth layers, valuation, corrections and consequence completeness |
| FinancialConsequenceVector | inside KF-REC-052 | candidate vocabulary, not standalone concept |
| ValuationEvidence | inside KF-REC-052 | candidate vocabulary, not standalone concept |
| CanonicalInvoiceBalance | inside KF-REC-052 | reusable financial read semantic, not standalone concept |
| CustomerLifecycle | J3 target vocabulary | working semantic dimension; do not promote until status/lifecycleStage/pipelineStage ownership is resolved |
| CommercialObligationLineage | J3/J4 target vocabulary | working semantic dimension binding service/booking/deposit/invoice/payment/correction stages; not standalone concept yet |
| RevenueAttribution stage | J3/J4 target vocabulary | attribution stage must be explicit; BOOKING pipeline value is not automatically realized revenue |

---

# 6. Reserved J16/K4 vocabulary

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

Status: RESERVED TARGET VOCABULARY — NOT AUTOMATIC KF-CONCEPT IDs.

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
Stored fact != EpistemicEligibility
Correction != descendant convergence
Projection != authoritative truth
Learning != authority
Operational financial state != external money reality != money-movement record != accounting truth != reconciliation truth != valuation truth
Payment row existence != financial consequence completeness
Webhook receipt identity != descendant consequence completion
Gross successful receipts != refunds != net receipts != outstanding balance != accounting revenue
Native currency amount != functional/presentation valuation amount
Financial source string literal != canonical FinancialSourceIdentity
AccountingPeriod CLOSED != posting prohibition unless enforced at ledger write door
Reconciliation lock != prohibition on new current-period corrective consequence
CreditNote VOID != accounting/document descendant convergence complete
Invoice status column != permission for multiple lifecycle owners
Commercial customer evidence != Contact.status until lifecycle convergence policy is declared
Canonical Contact status != pipelineStage != lifecycleStage != descriptive tag
Pipeline value != invoiced value != realized revenue != customer lifetime value
Booking attribution != invoice attribution unless a declared stage/lineage mapping says so
Service complete != financially complete
Required descendant not created != nothing left to do
Deposit != additive charge unless explicitly modeled as one
Booking CANCELLED / NO_SHOW != financial disposition complete
LEAD | PROSPECT | CLIENT | LOST != lead | customer aliases in persistent query predicates
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
Finding range:           through F203
Contradiction range:     through C153
Recommendation range:    through KF-REC-052
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
```

J7 is pooled. J3/J4 commercial-to-cash microscopic reconstruction is active through F203/C153. `CustomerLifecycle` and `CommercialObligationLineage` remain working target vocabulary until broader convergence proves a need for standalone concepts.

No production implementation is authorized by this taxonomy artifact.
