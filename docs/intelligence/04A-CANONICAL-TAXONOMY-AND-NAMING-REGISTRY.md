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
→ CLASSIFY SAME / SPECIALIZATION / RELATED DISTINCT / IMPLEMENTATION ALIAS / HISTORICAL / GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE FIRST
→ allocate only if genuinely distinct and stable
```

---

# 3. Canonical namespaces

- Journeys: `J1 ... J25` — `03-ANALYSIS-MAP.md`.
- Kernels: `K1 ... K12` — `12-KERNEL-PROGRAMME.md`.
- Concepts: `KF-CONCEPT-001–KF-CONCEPT-042` — `04-CONCEPT-REGISTRY.md`.
- Findings: `F001–F205` — `08*`; allocator 04B.
- Contradictions: `C001–C155` — `09*`; allocator 04B.
- Recommendations: `KF-REC-001–KF-REC-053` — `10*`; allocator 04B.
- Decisions: `KF-DEC-###` — `05-DECISION-REGISTER.md`.
- Execution packets: `KF-EXEC-<DOMAIN>-###`.
- Local proof obligations: `PF-<SCOPE>-###`.

Latest roots:
```text
F185–F196 / C135–C146 — J7 Financial Truth
F197/C147 — commercial customer evidence vs Contact lifecycle convergence
F198/C148 — pipeline value + realized revenue vs non-duplicative customer LTV
F199/C149 — completed service vs missing durable receivable consequence
F200/C150 — deposit vs final service receivable settlement lineage
F201/C151 — cancellation/no-show vs financial descendant disposition
F202/C152 — RevenueAttribution pipeline vs realized revenue stage
F203/C153 — canonical CRM statuses vs KeyCortex lead/customer predicates
F204/C154 — booking.completed event vs post-booking template/tool contract
F205/C155 — persisted Contact.status admits incompatible lifecycle/health dialects
```

Current major pooled targets:
```text
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition controls
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
```

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

| Term | Canonical reference / rule |
|---|---|
| Business Knowledge Kernel / Knowledge Kernel | K4 |
| Business Genome | KF-CONCEPT-003 |
| GenomeFact | KF-CONCEPT-004; not automatically canonical truth |
| Resolved / Canonical Fact | KF-CONCEPT-017 |
| Business Blueprint | KF-CONCEPT-002 |
| Business Graph | KF-CONCEPT-007 |
| Clearance | KF-CONCEPT-026 |
| Execution Claim | KF-CONCEPT-028 |
| Temporal Work Projection | KF-REC-047 target; derived, not workflow truth |
| Operator Attention & Priority Contract | KF-REC-051 |
| Financial Truth & Valuation Contract | KF-REC-052 |
| Commercial Relationship & Obligation Contract | KF-REC-053 |
| FinancialConsequenceVector / ValuationEvidence / CanonicalInvoiceBalance | inside KF-REC-052; not standalone concepts yet |
| CustomerLifecycleState | KF-REC-053 target vocabulary; one commercial relationship dimension, exact final enum not frozen |
| RelationshipHealthState | KF-REC-053 target vocabulary; orthogonal to CustomerLifecycleState |
| CommercialObligationLineage | KF-REC-053 target vocabulary binding booking/service/order/deposit/invoice/payment/correction stages |
| CommercialValueStage | KF-REC-053 target vocabulary for expected/committed/invoiced/collected/net-realized/reversed value basis |
| ServiceFinancialDisposition | KF-REC-053 target vocabulary for cancellation/no-show/correction financial outcomes |
| EventToActionContractAdapter | KF-REC-053 target vocabulary for typed/versioned event→tool mapping |

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

Reserved vocabulary is not automatically a KF-CONCEPT allocation.

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
Gross receipts != refunds != net receipts != outstanding balance != accounting revenue
Native currency amount != functional/presentation valuation amount
AccountingPeriod CLOSED != posting prohibition unless enforced at ledger write door
Reconciliation lock != prohibition on new current-period corrective consequence
Commercial customer evidence != Contact lifecycle state until policy converges it
CustomerLifecycleState != RelationshipHealthState != DealState/DealStage != tags/segments
Canonical Contact status != pipelineStage != lifecycleStage != descriptive tag
CLIENT != CUSTOMER alias until an owned adapter maps it
DORMANT / AT_RISK relationship condition != customer lifecycle state
Deal WON != Contact lifecycle transition unless policy says so
Pipeline value != invoiced value != realized revenue != LTV
Service complete != financially complete
Deposit != additive charge unless explicitly modeled as one
Booking CANCELLED / NO_SHOW != financial disposition complete
Canonical event payload != template-local assumed payload
Plan-step idempotency != semantic commercial-obligation idempotency
```

---

# 8. Rename / merge procedure

Never silently rename or reassign a canonical ID.

```text
load 04B
→ choose surviving canonical ID
→ remap or alias historical entry
→ preserve historical evidence
→ never reuse old numeric meaning
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
11. A stale or duplicate canonical range is an intelligence-integrity defect and is repaired before broad analysis continues.
12. Search/reuse is mandatory across ChatGPT, Claude Code and Kimi Code sessions.

---

# 10. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F205
Contradiction range:     through C155
Recommendation range:    through KF-REC-053
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
```

J7 is pooled through KF-REC-052. The current J3/J4 commercial-to-cash tranche is reconstructed through F205/C155, target-synthesized through KF-REC-053, backward re-audited against J17/J18/J23/J7/K4, and ingrained in canonical journey dossiers:

- `journeys/KF-JOURNEY-003-LEAD-CUSTOMER-CASH.md`
- `journeys/KF-JOURNEY-004-BOOKING-SERVICE-PAYMENT.md`

The customer-state ownership matrix is `investigations/J3-CUSTOMER-LIFECYCLE-STATE-OWNERSHIP-MATRIX.md`.

Do not reopen this tranche merely to repeat already-pooled analysis. Reopen only for new evidence, live-data inventory, implementation planning/proof, or pressure from adjacent journeys such as J10/J11.

No production implementation is authorized by this taxonomy artifact.
