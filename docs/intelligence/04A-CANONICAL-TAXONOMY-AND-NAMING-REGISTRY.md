# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-07

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
- Findings: `F001–F220` — `08*`; allocator 04B.
- Contradictions: `C001–C170` — `09*`; allocator 04B.
- Recommendations: `KF-REC-001–KF-REC-055` — `10*`; allocator 04B.

Latest J11 roots:
```text
F215/C165 — ContractVersion is not a complete reconstructable authoritative Contract revision history
F216/C166 — uncertain AI contract extraction can be promoted into authoritative Contract/renewal truth without epistemic/governance promotion evidence
F217/C167 — supplied Contract lifecycle status can falsely discharge renewal work; ACTIVE is simultaneously eligible to raise that work
F218/C168 — Contract retention semantics do not constrain hard deletion, which cascades Contract-owned evidence/history
```

Latest J12 roots:
```text
F219/C169 — transient document assertions can be admitted as successful payment evidence without an explicit consumer-specific evidence-admission decision
F220/C170 — a materially new external document revision can be suppressed as the prior ingestion occurrence when stable external object identity is used as the dedupe identity
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
KF-REC-054 Commerce & Fulfilment Contract
KF-REC-055 Contract Integrity & Renewal Contract
```

---

# 4. High-value distinctions

```text
CustomerLifecycleState != RelationshipHealthState != DealState/DealStage != tags/segments
Commercial evidence != lifecycle transition until policy says so
Pipeline/expected != committed != invoiced != collected != net-realized value
Service complete != financially complete
OrderOperationalState != PaymentCompletionEvidence != AggregateFulfilmentOutcome
Inventory reservation != inventory consumption != release/restoration
Route row created != required route outcome satisfied
Any existing child effect != complete required descendant set
Merchant SKU != immutable provider external identity
Mutable customer email != immutable provider customer identity
Plan-step/process idempotency != semantic effect idempotency
Document extraction assertion != authoritative Contract truth
Document extraction assertion != qualifying PaymentCompletionEvidence != Payment SUCCESSFUL / Invoice paid truth
Document identity != document revision != parsed representation != extraction/assertion occurrence != verified evidence
EvidenceAdmissionDecision != extraction confidence alone != downstream domain state
ExternalObjectId != ExternalSourceRevisionId != IngestionOccurrenceId != ExtractionOccurrenceId
Same external object != same semantic occurrence when the object has materially changed
Same source revision replay != genuinely new source revision
Contract current projection != ContractRevision evidence/history
Contract definition/source identity != renewal WorkOccurrence identity
ContractLifecycleState != RenewalDecisionOccurrence != RenewalDecisionEvidence != RenewalObligationDisposition
DTO contains status != status transition != evidence that a renewal decision occurred
Derived alert fact != durable operator disposition
Future renewal visibility != actionable renewal obligation
Contract deletion != obligation settlement/cancellation by implication
RetentionPolicy != decorative metadata when exposed as domain retention state
ARCHIVE / RETIRE / SUPERSEDE != HARD DELETE
```

---

# 5. High-value aliases / active target vocabulary

| Term | Canonical reference / rule |
|---|---|
| Business Knowledge Kernel / Knowledge Kernel | K4 |
| Business Genome | KF-CONCEPT-003 |
| Business Graph | KF-CONCEPT-007 |
| Clearance | KF-CONCEPT-026 |
| Execution Claim | KF-CONCEPT-028 |
| Temporal Work Projection | KF-REC-047 |
| Operator Attention & Priority Contract | KF-REC-051 |
| Financial Truth & Valuation Contract | KF-REC-052 |
| Commercial Relationship & Obligation Contract | KF-REC-053 |
| Commerce & Fulfilment Contract | KF-REC-054 |
| Contract Integrity & Renewal Contract | KF-REC-055 |
| EvidenceAdmissionDecision | F219/J12 provisional target vocabulary: consumer-specific decision that an exact assertion/evidence revision is admissible for a material downstream claim; generic epistemic mechanics delegate to KF-REC-049 and financial claim strength to KF-REC-052; no concept ID allocated |
| SourceRevisionOccurrence / IngestionOccurrence | F220/J12 provisional target vocabulary: a materially distinct revision/occurrence of a stable external source object; reuse J14/KF-REC-035 occurrence semantics and KF-REC-049 revision provenance; no concept ID allocated |
| ExternalObjectId | Stable provider/source object identity; does not by itself prove revision or occurrence identity |
| ContractRevision | KF-REC-055 authoritative agreement-state revision lineage; generic provenance mechanics delegate to KF-REC-049 |
| ContractAssertion / extraction evidence | KF-REC-055 domain promotion input; generic epistemics delegate to KF-REC-049 |
| Renewal WorkOccurrence | KF-REC-055 domain binding to J23/KF-REC-047 occurrence mechanics; one cycle != Contract definition identity |
| RenewalDecision | KF-REC-055; requires occurrence-specific qualifying evidence, not lifecycle-status presence |
| RetentionDeletionDecision | KF-REC-055; contract-specific archive/destruction eligibility/evidence; legal duration not globally frozen |
| ContractAlert | J11 local contextual derived projection; not a second canonical obligation spine |
| Contract renewal operator disposition | J11 specialization of J17/KF-REC-051; recomputation must preserve disposition |
| CustomerLifecycleState | KF-REC-053 target vocabulary; exact enum not frozen |
| RelationshipHealthState | KF-REC-053; orthogonal to lifecycle |
| CommercialObligationLineage | KF-REC-053; origin/descendant lineage |
| CommercialValueStage | KF-REC-053; stage-explicit value |
| ServiceFinancialDisposition | KF-REC-053 correction/cancellation semantics |
| EventToActionContractAdapter | KF-REC-053 typed/versioned event→tool composition |
| OrderOperationalState | KF-REC-054; operational commerce progression only |
| InventoryAllocationLineage | KF-REC-054; one semantic order-item inventory effect lineage |
| AggregateFulfilmentOutcome | KF-REC-054; derived from required fulfilment effects |
| ExternalEntityIdentity | KF-REC-054 for provider commerce resources; business-scoped provider-stable identity |
| RequiredFulfilmentSet | KF-REC-054; required semantic effects per order item/split/revision |
| OperationalOrderMaterialization | KF-REC-054; operational vs summary/evidence-only provider-order representation |
| StrategyEffectIdentity | KF-REC-054; stable semantic identity spanning route + strategy-specific descendants |
| CommerceEffectIdentity | KF-REC-054 boundary identity for order-derived operational/commercial effects |

---

# 6. KF-REC-055 ownership boundary

KF-REC-055 owns only:

```text
ContractRevision authoritative agreement-state lineage
contract-specific assertion promotion into an accepted ContractRevision
RenewalDecision binding to the relevant ContractRevision + renewal occurrence
RetentionDeletionDecision for agreement archival/destructive disposition
```

It delegates:

```text
provenance / epistemic eligibility → KF-REC-049
occurrence / temporal work mechanics→ KF-REC-047
recovery / outcome certainty        → KF-REC-048
operator attention / disposition    → KF-REC-051
financial truth / valuation         → KF-REC-052
commercial obligation discipline    → KF-REC-053
```

Do not let KF-REC-055 become a universal event store, EDMS/CLM suite, second knowledge/provenance engine, second temporal/workflow runtime, second operator queue or jurisdiction-wide legal rules engine.

---

# 7. Index integrity rules

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
13. A domain-specific recurrence, projection-disposition or epistemic manifestation reuses the mature kernel root unless it proves a genuinely distinct semantic owner.
14. A document/extraction assertion must not be treated as qualifying domain evidence merely because it is parseable or carries a confidence score; material promotion requires a consumer-specific admission predicate/decision.
15. Stable external object identity must not be used as the sole occurrence/dedupe identity for a mutable source when materially new revisions must produce new ingestion/evidence consequences.
16. Reprocessing the same source revision and admitting a genuinely new source revision are different idempotency problems.

---

# 8. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F220
Contradiction range:     through C170
Recommendation range:    through KF-REC-055
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
Next free:               F221 / C171 / KF-REC-056 — UNALLOCATED
```

J3/J4 are provisionally converged through KF-REC-053. J10 is provisionally converged through KF-REC-054. J11 is provisionally converged / target-aligned through F218/C168/KF-REC-055. **J12 is ACTIVE microscopic forensics through F220/C170; no J12 recommendation is allocated yet.**

Current J11 homes:
- `journeys/KF-JOURNEY-011-CONTRACT-OBLIGATION-RENEWAL.md`
- F215–F216 — `08AS`; C165–C166 — `09AS`
- F217 — `08AT`; C167 — `09AT`
- F218 — `08AU`; C168 — `09AU`
- KF-REC-055 — `10N`

Current J12 homes:
- `journeys/KF-JOURNEY-012-DOCUMENT-EVIDENCE-LIFECYCLE.md`
- F219 — `08AV`; C169 — `09AV`
- F220 — `08AW`; C170 — `09AW`
- consumer/revision trace — `investigations/J12-DOCUMENT-INTELLIGENCE-CONSUMER-REVISION-LINEAGE-TRACE.md`

J12 reuse decisions now include:
- manual inline edit approved through stale version → F161 / KF-REC-049
- AI tweak partial mutation vs version evidence → check F164 before allocation
- contract extraction promotion → F216/C166 + KF-REC-055
- same payment evidence replay / new random payment identity → KF-REC-048 specialization; no new root
- Drive mutable revision history/provenance → KF-REC-049 pressure
- Drive modified revision suppressed by externalId-only ingestion dedupe → F220/C170, reusing J14/KF-REC-035 occurrence semantics

Next programme action is continued J12 microscopic tracing across Device accepted-state reprocessing, Expense extraction→creation promotion, direct AI upload behavior, generated-document crash semantics, and correction/supersession/deletion lineage. Do not allocate KF-REC-056 merely because F219/F220 exist.

No production implementation is authorized by this taxonomy artifact.
