# KeyFlowOS Recommendation Register — Commerce & Fulfilment Continuation

Status: CANONICAL RECOMMENDATION REGISTER CONTINUATION
Last updated: 2026-09-07
Production implementation: NOT AUTHORIZED

## KF-REC-054 — Establish a Commerce & Fulfilment Contract

Status: RECOMMENDED / TARGET-SYNTHESIS INPUT
Primary journey: J10 Commerce / Fulfilment
Primary kernels: K6 State Transition, K8 Evidence & Outcome, K9 External Reality, K11 Recovery
Critical adjacent kernels: K7 Temporal/Event/Workflow, K10 Financial Truth, K4 Business Knowledge, K3 Governance
Canonical evidence: F206–F214 / C156–C164
Pressure test: `investigations/J10-COMMERCE-FULFILMENT-STANDARDS-FRONTIER-PRESSURE-TEST.md`

---

# 1. Recommendation

Establish one semantic contract governing how KeyFlow represents and reconciles:

```text
commerce occurrence identity
+ operational order state
+ provider commerce-entity identity
+ operational external-order materialization
+ order-item inventory allocation lineage
+ required fulfilment obligations
+ strategy-specific fulfilment effect identity
+ per-effect and aggregate fulfilment outcomes
+ correction/cancel/return operational consequences
```

without creating a universal order table, warehouse runtime, provider-sync engine or financial subsystem.

For every material commerce occurrence, KeyFlow should be able to answer:

1. Which internal order represents this economic/provider occurrence?
2. Which payment evidence exists, separately from operational order state?
3. Which structural order-item obligations exist?
4. Which provider identities map to the internal Product/Contact/order entities?
5. What inventory effect is required for each order-item quantity, and what has already happened?
6. Which fulfilment routes/effects are required, observed, failed, missing, waived or complete?
7. Which PurchaseOrder/PreOrder/route descendants belong to the same semantic strategy effect?
8. Can retry repair missing/orphan descendants without duplicating supplier, inventory or fulfilment effects?
9. Is an imported order operationally materialized or only evidence/summary data?
10. Is aggregate fulfilment success actually supported by all required child outcomes?

---

# 2. Boundary with existing contracts

## 2.1 KF-REC-053 owns commercial obligation lineage

KF-REC-054 consumes/extends the operational realization of a commercial obligation but does not redefine customer lifecycle, deposits, commercial value stages or invoice lineage.

```text
commercial obligation truth
→ KF-REC-053
→ operational commerce/fulfilment requirements
→ KF-REC-054
```

F206 is shared boundary pressure: the order must expose a stable semantic effect identity so every invoice producer converges on the same KF-REC-053/KF-REC-052 descendant.

## 2.2 KF-REC-052 owns financial truth

Payment success, Invoice state, ledger posting, refunds, credits and valuation remain KF-REC-052.

KF-REC-054 requires only:

```text
operational order state != financial/payment truth
```

It must never infer payment solely from `CONFIRMED`, `FULFILLED`, provider labels or route state.

## 2.3 KF-REC-048 owns recovery mechanics

KF-REC-054 defines the required semantic effect set and identities. KF-REC-048 owns certainty-aware retry, reconciliation, compensation and escalation.

```text
KF-REC-054: what effect should exist?
KF-REC-048: how do we safely converge/recover it?
```

## 2.4 KF-REC-035–037 own ingress occurrence lifecycle

Ingress adapters may establish provider occurrence identity and replay-safe intake. KF-REC-054 owns provider-independent commerce entity reconciliation and the operational materialization required after accepted ingress.

## 2.5 KF-REC-051 owns attention ranking

Missing/failed fulfilment effects may become operator work, but ranking and attention semantics remain KF-REC-051.

---

# 3. Target contract

## 3.1 OrderOperationalState

Order operational state is an independent dimension.

```text
OrderOperationalState
!= PaymentState
!= InvoiceState
!= AccountingState
!= AggregateFulfilmentOutcome
```

The exact final enum is not frozen. Observed values such as `PENDING`, `CONFIRMED`, `PAID`, `PROCESSING`, `FULFILLED`, `CANCELLED`, `REFUNDED` must first be classified by dimension rather than copied into one catch-all algebra.

Events derive from canonical transitions/evidence:

```text
payment proven → paid event
order accepted/confirmed → operational event
fulfilment complete → fulfilment event
```

An operational confirmation cannot manufacture financial truth.

## 3.2 ExternalEntityIdentity

Provider commerce resources require stable business-scoped identity:

```yaml
business_id: ...
provider: SHOPIFY|...
entity_type: PRODUCT|VARIANT|CUSTOMER|ORDER|ORDER_LINE|FULFILMENT|...
external_id: provider-stable identifier
internal_ref: ...
first_seen_at: ...
last_seen_at: ...
source_revision_or_cursor: ...
```

This is a semantic envelope, not an approved universal table.

Required law:

```text
(business, provider, entityType, externalId)
→ at most one active internal identity mapping
```

Mutable SKU, email, title, name, phone and provider status labels are reconciled attributes, not identity keys.

## 3.3 OperationalOrderMaterialization

An imported provider order must have an explicit representation mode.

### OPERATIONAL

If the order may enter native inventory/fulfilment/COGS/effectful flows:

- native/internal structural order items exist;
- provider order-line identities map to those items;
- Product mapping is resolved or explicitly unresolved/blocking;
- quantities/prices/currency/provenance are structurally available;
- required effect derivation can operate without parsing opaque provider metadata.

### SUMMARY_OR_EVIDENCE_ONLY

If structural materialization is incomplete:

- provider payload remains evidence/provenance;
- the aggregate is technically excluded from native effectful fulfilment/inventory flows;
- later promotion to OPERATIONAL is an explicit reconciliation/materialization transition.

Opaque JSON is not operational completeness.

## 3.4 InventoryAllocationLineage

One order-item quantity has one semantic inventory effect lineage.

Working state pressure:

```text
AVAILABLE
→ RESERVED / COMMITTED
→ CONSUMED
→ optionally RELEASED / RESTORED / RETURNED / ADJUSTED
```

Exact product-policy algebra remains to be finalized.

Required properties:
- order/order-item/split identity;
- product/variant/inventory location identity;
- quantity/unit;
- semantic effect identity;
- before/after state or movement provenance;
- correction/reversal linkage;
- idempotency/retry identity.

The same sold quantity must not be independently decremented at checkout and shipment while also being reserved as though still available.

## 3.5 RequiredFulfilmentSet

Fulfilment completion is defined from required semantic obligations, not process return shape.

Working form:

```yaml
order_id: ...
revision: ...
required_effects:
  - effect_id: ...
    order_item_ref: ...
    split_ref: ...
    strategy: LOCAL_STOCK|DROPSHIP|PREORDER|HYBRID|MANUAL|SERVICE|...
    quantity: ...
    state: REQUIRED|ROUTING|SATISFIED|FAILED|WAIVED|CANCELLED|OUTCOME_UNKNOWN
    observed_refs: []
```

Aggregate outcome:

```text
AggregateFulfilmentOutcome
= deterministic policy over RequiredFulfilmentSet outcomes
!= “routeOrder returned normally”
!= “at least one route exists”
```

## 3.6 StrategyEffectIdentity

Effectful strategies require a stable identity independent of any one persistence row.

```text
StrategyEffectIdentity
= business + order + order item/split + strategy + relevant revision
```

PurchaseOrder, PreOrder, FulfillmentRoute, supplier request or other descendants produced for that requirement must bind to the same identity.

Retry/reconciliation must be able to distinguish:

```text
nothing attempted
partial descendants
orphan auxiliary descendant
failed route
complete semantic effect
ambiguous external outcome
```

Route absence alone is never sufficient proof that an auxiliary strategy business effect has not occurred.

## 3.7 CommerceEffectIdentity

Cross-listener descendants such as invoice creation, inventory mutation and route creation require semantic effect identities derived from the order obligation and effect kind.

Examples:

```text
(order obligation, PAID_INVOICE)
(order item, INVENTORY_CONSUMPTION, revision)
(order item/split, FULFILMENT_ROUTE, revision)
(order item/split, SUPPLIER_PURCHASE, revision)
```

Free-form notes, event attempt IDs and child-row existence are insufficient canonical dedupe identity.

---

# 4. Core invariants

1. Order operational state is not payment/accounting truth.
2. Paid events require proven payment evidence.
3. One commerce obligation has one semantic paid-Invoice effect unless explicit document policy says otherwise.
4. Provider entity identity is independent of mutable SKU/email/name attributes.
5. External entity identity is tenant/business scoped.
6. An operational order has structural order-item obligations.
7. Provider metadata is provenance, not a substitute for native effect-bearing structure.
8. Summary/evidence-only imports cannot silently enter effectful native flows.
9. One order-item quantity has one inventory allocation/effect lineage.
10. Reservation, consumption, release, restoration and return are distinct transitions/effects.
11. Inventory effects are idempotent by semantic identity.
12. Required fulfilment set is explicit and revision-aware.
13. Any existing route is not proof the required route set is complete.
14. A route row is not proof its required effect succeeded.
15. Aggregate fulfilment outcome is derived from required child outcomes.
16. Failed/partial/missing required fulfilment remains unresolved work until recovered, waived or cancelled.
17. Strategy-specific descendants share one StrategyEffectIdentity.
18. Route absence does not imply PurchaseOrder/PreOrder effect absence.
19. Retry reconciles required vs observed semantic effects rather than replaying process steps blindly.
20. Correction/cancel/return converges only effects actually applied and preserves history.
21. Financial consequences delegate to KF-REC-052.
22. Commercial obligation/customer semantics delegate to KF-REC-053.
23. Recovery mechanics delegate to KF-REC-048.
24. Attention ranking delegates to KF-REC-051.
25. Provider ingress occurrence handling delegates to KF-REC-035–037.
26. No universal order/warehouse/provider runtime is required for semantic convergence.

---

# 5. Finding resolution mapping

```text
F206/C156
→ CommerceEffectIdentity for paid-Invoice consequence
→ compose KF-REC-053 + KF-REC-052

F207/C157
→ OrderOperationalState orthogonal to payment evidence

F208/C158
→ InventoryAllocationLineage / exact-once inventory effect ownership

F209/C159
→ RequiredFulfilmentSet + outcome-derived aggregate state

F210/C160
→ ExternalEntityIdentity for provider Product/Variant

F211/C161
→ required-vs-observed reconciliation, not any-child idempotency
→ compose KF-REC-048

F212/C162
→ one provider Customer identity policy across sync entrypoints
→ lifecycle remains KF-REC-053

F213/C163
→ OperationalOrderMaterialization

F214/C164
→ StrategyEffectIdentity independent of route-row existence
→ compose KF-REC-048
```

---

# 6. Migration pressure

## Phase A — inventory current semantics

- enumerate MarketplaceOrder `status` and `paymentStatus` values/writers;
- map every event emitted from order transitions;
- inventory duplicate Invoice descendants per order lineage;
- inventory stock movements/reservations by order item;
- inventory partial/FAILED fulfilment route sets;
- locate orphan PurchaseOrder/PreOrder descendants;
- inventory provider IDs currently stored in metadata/executionMeta/custom fields;
- inventory imported orders without relational items;
- classify external orders as operational vs summary/evidence-only candidates.

## Phase B — semantic adapters/read contracts

Before destructive schema constraints:
- canonical order operational-state adapter;
- stable provider entity identity resolver;
- operational materialization completeness resolver;
- inventory allocation/effect resolver;
- required fulfilment-set resolver;
- strategy-effect resolver.

## Phase C — backfill/reconcile

- establish deterministic provider identity mappings;
- link safe duplicate/legacy provider records where policy allows;
- preserve ambiguous mappings for operator resolution;
- materialize operational order items where source evidence is sufficient;
- classify partial fulfilment and orphan strategy descendants;
- reconstruct inventory effect lineage where deterministically possible.

## Phase D — enforce write/effect doors

- provider syncs must resolve external identity before mutation;
- operational imported orders must pass materialization completeness;
- inventory mutations require semantic allocation/effect identity;
- route/strategy descendants require RequiredFulfilmentSet + StrategyEffectIdentity;
- state transition events must be dimension-correct;
- retry must reconcile semantic effects.

## Phase E — consumer cutover

- fulfilment/recovery/operator surfaces;
- inventory/COGS consumers;
- CRM/customer history event projections;
- provider sync/reporting;
- destructive constraints only after parity/reconciliation proof.

---

# 7. Proof architecture

Required future tests include:

### Order/payment separation
- CONFIRMED cannot emit payment-success semantics without payment evidence.
- PAID order projection agrees with KF-REC-052 evidence.

### Commercial descendant identity
- successful checkout plus event fan-out creates exactly one semantic paid Invoice.
- replay/restart/listener retry cannot create another paid Invoice effect.

### Inventory
- last-unit checkout remains routable according to intended policy.
- reserve→ship consumes the sold quantity exactly once.
- cancel releases only applied reservations/commitments.
- refund/return restores stock only under explicit policy and only once.
- repeated mutation/recovery is idempotent.

### Fulfilment completeness
- persisted FAILED child prevents false aggregate success.
- failure after item 1 of N repairs missing items without duplicating satisfied effects.
- aggregate completion remains false until all required effects are acceptable.

### Strategy effects
- failure after PurchaseOrder/PreOrder commit but before route commit does not create a second semantic obligation on retry.
- safe orphan descendants can be relinked; ambiguous effects escalate through KF-REC-048.
- HYBRID preserves selected strategy/effect identity across retry.

### External identity/materialization
- repeat Product sync survives SKU changes.
- customer identity survives email changes regardless sync endpoint order.
- same provider external ID cannot create multiple active internal mappings within one business.
- imported operational orders expose native structural item obligations.
- incomplete imports cannot enter native effectful fulfilment silently.

Runtime proof is not performed by this recommendation.

---

# 8. Observability

For a commerce occurrence, operators/diagnostics should be able to inspect:

```text
order identity + operational state
payment/financial evidence reference
provider entity mappings
materialization completeness
order-item obligations
inventory allocation/effect lineage
required fulfilment effects
observed routes/strategy descendants
aggregate fulfilment outcome
missing/failed/ambiguous effects
recovery/attention references
correction history
```

These views may be derived. They do not authorize one universal storage model.

---

# 9. Explicit non-goals

KF-REC-054 does NOT authorize:
- production implementation;
- replacement of MarketplaceOrder/Product/Inventory/FulfillmentRoute models;
- a universal commerce database table;
- a new ledger/payment/refund system;
- a universal workflow/recovery engine;
- a universal provider connector framework;
- automatic merging of ambiguous provider identities;
- a requirement that every effect use one database transaction;
- AI deciding inventory/fulfilment corrections without policy/evidence/governance.

---

# 10. Relationship to canonical evidence

Primary findings:
```text
F206 F207 F208 F209 F210 F211 F212 F213 F214
```

Primary contradictions:
```text
C156 C157 C158 C159 C160 C161 C162 C163 C164
```

Primary composed recommendations:
```text
KF-REC-035 KF-REC-036 KF-REC-037
KF-REC-048 KF-REC-051 KF-REC-052 KF-REC-053
```

No production implementation is authorized by this recommendation.
