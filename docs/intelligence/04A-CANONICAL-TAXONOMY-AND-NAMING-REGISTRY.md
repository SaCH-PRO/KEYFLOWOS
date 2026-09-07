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
- Findings: `F001–F218` — `08*`; allocator 04B.
- Contradictions: `C001–C168` — `09*`; allocator 04B.
- Recommendations: `KF-REC-001–KF-REC-054` — `10*`; allocator 04B.

Latest roots:
```text
F185–F196 / C135–C146 — J7 Financial Truth
F197–F205 / C147–C155 — J3/J4 commercial-to-cash
F206–F214 / C156–C164 — J10 Commerce/Fulfilment
F215/C165 — ContractVersion is not a complete reconstructable authoritative Contract revision history
F216/C166 — uncertain AI contract extraction can be promoted into authoritative Contract/renewal truth without epistemic/governance promotion evidence
F217/C167 — supplied Contract lifecycle status can falsely discharge renewal work; ACTIVE is simultaneously eligible to raise that work
F218/C168 — Contract retention semantics do not constrain hard deletion, which cascades Contract-owned evidence/history
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
| ContractRevision | J11 target vocabulary under F215/C165; exact persistence shape not frozen |
| ContractAssertion / extraction evidence | J11 specialization of K4/KF-REC-049; not authoritative by default |
| Renewal WorkOccurrence | J11 specialization of J23/KF-REC-047; one cycle != Contract definition identity |
| RenewalDecision | J11 target vocabulary under F217/C167; requires occurrence-specific qualifying evidence |
| Contract retention decision | J11 target vocabulary under F218/C168; enforcement shape not frozen |
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

# 6. Index integrity rules

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

---

# 7. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F218
Contradiction range:     through C168
Recommendation range:    through KF-REC-054
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
Next free:               F219 / C169 / KF-REC-055 — UNALLOCATED
```

J3/J4 are provisionally converged through KF-REC-053. J10 is provisionally converged through KF-REC-054 after pressure test + backward re-audit. J11 is active through F218/C168 with no recommendation yet allocated.

Current J11 homes / reuse decisions:
- `journeys/KF-JOURNEY-011-CONTRACT-OBLIGATION-RENEWAL.md`
- F215–F216 — `08AS`; C165–C166 — `09AS`
- F217 — `08AT`; C167 — `09AT`
- F218 — `08AU`; C168 — `09AU`
- renewal-cycle identity → reuse J23 / KF-REC-047
- ContractAlert disposition resurrection → reuse F182 / KF-REC-051
- local alert temporal advancement → reuse J23 / KF-REC-047
- Contract deletion orphaning renewal work → reuse F182 / KF-REC-051
- renewal-date/notice correction leaving stale work → reuse F182 / KF-REC-051
- clauseAnalysis → derived/advisory projection; value-density review, not authoritative ContractRevision by default

Do not allocate new recurrence/operator-projection/knowledge roots where mature KF-REC-047/049/051 already own the semantic defect. Do not allocate a J11 recommendation until irreducible contract-domain semantics remain after delegation.

No production implementation is authorized by this taxonomy artifact.
