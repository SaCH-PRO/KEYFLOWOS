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
- Findings: `F001–F214` — `08*`; allocator 04B.
- Contradictions: `C001–C164` — `09*`; allocator 04B.
- Recommendations: `KF-REC-001–KF-REC-053` — `10*`; allocator 04B.

Latest roots:
```text
F185–F196 / C135–C146 — J7 Financial Truth
F197–F205 / C147–C155 — J3/J4 commercial-to-cash
F206/C156 — duplicate paid-Invoice descendant ownership for one storefront order
F207/C157 — operational order CONFIRMED emits paid semantics while payment state can remain unpaid
F208/C158 — checkout/routing/shipment/correction compete for ownership of one tracked-stock effect
F209/C159 — aggregate fulfillment_routed can be emitted while required route state is FAILED
F210/C160 — Shopify variant lookup identity differs from persisted Product identity
F211/C161 — partial fulfilment route set can block recovery because any existing route is treated as complete
F212/C162 — Shopify order/customer sync writers disagree on Contact identity resolution
F213/C163 — Shopify order enters native MarketplaceOrder without native relational item descendants
F214/C164 — strategy-specific PurchaseOrder/PreOrder can commit before FulfillmentRoute, so route-based retry can duplicate the same fulfilment obligation
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

# 4. High-value distinctions

```text
CustomerLifecycleState != RelationshipHealthState != DealState/DealStage != tags/segments
Commercial evidence != lifecycle transition until policy says so
Pipeline/expected != committed != invoiced != collected != net-realized value
Service complete != financially complete
OrderFulfilmentState != PaymentCompletionEvidence
One order occurrence != permission for multiple paid-Invoice descendants
Free-form notes != canonical commercial-effect identity
Inventory reservation != inventory consumption != release/restoration
Route row created != required route outcome satisfied
Normal routeOrder return != aggregate fulfilment success
Any existing child effect != complete required descendant set
FulfillmentRoute absence != absence of an already-committed strategy business effect
Merchant SKU != immutable provider external identity
Mutable customer email != immutable provider customer identity
Provider metadata line items != native operational OrderItem descendants
External provider paid/refunded label != local Payment/ledger convergence
Plan-step/process idempotency != semantic effect idempotency
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
| CustomerLifecycleState | KF-REC-053 target vocabulary; exact enum not frozen |
| RelationshipHealthState | KF-REC-053; orthogonal to lifecycle |
| CommercialObligationLineage | KF-REC-053; origin/descendant lineage |
| CommercialValueStage | KF-REC-053; stage-explicit value |
| ServiceFinancialDisposition | KF-REC-053 correction/cancellation semantics |
| EventToActionContractAdapter | KF-REC-053 typed/versioned event→tool composition |
| Order-item inventory allocation lineage | J10 F208/C158 target pressure; exact representation not frozen |
| Aggregate fulfilment outcome | J10 F209/C159; derived from required route outcomes |
| Provider external-entity identity | J10 F210/F212 K9 pressure; structural and business-scoped |
| RequiredRouteSet / ObservedRouteSet | J10 F211/C161 recovery vocabulary; working semantics |
| Operational external-order materialization | J10 F213/C163; explicit choice between native effectful aggregate and summary/evidence projection |
| StrategyEffectIdentity | J10 F214/C164; stable semantic identity spanning route + strategy-specific descendants |

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

---

# 7. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F214
Contradiction range:     through C164
Recommendation range:    through KF-REC-053
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
```

J3/J4 are provisionally converged and target-aligned through KF-REC-053. J10 Commerce/Fulfilment is the active microscopic frontier.

Current J10 homes:
- `journeys/KF-JOURNEY-010-COMMERCE-FULFILMENT.md`
- F206/C156 — `08AK` / `09AK`
- F207/C157 — `08AL` / `09AL`
- F208–F209/C158–C159 — `08AM` / `09AM`
- F210/C160 — `08AN` / `09AN`
- F211/C161 — `08AO` / `09AO`
- F212/C162 — `08AP` / `09AP`
- F213/C163 — `08AQ` / `09AQ`
- F214/C164 — `08AR` / `09AR`

The earlier K9/external-reality recommendation corpus has now been searched. It does not fully own stable provider entity identity, operational provider-order materialization, inventory-effect lineage, required fulfilment-set semantics, or strategy-effect identity. J10 is therefore under a final standards/frontier pressure test for a distinct narrow Commerce & Fulfilment target contract. Do not allocate new refund/provider/lifecycle/recovery roots where mature KF-REC-047/048/052/053 and existing findings already own the defect.

No production implementation is authorized by this taxonomy artifact.
