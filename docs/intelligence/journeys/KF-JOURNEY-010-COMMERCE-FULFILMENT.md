# KF-JOURNEY-010 — Commerce / Fulfilment

Status: **ACTIVE MICROSCOPIC FORENSICS / THROUGH F214/C164 / TARGET SYNTHESIS READY**
Last updated: 2026-09-07
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J10 models how KeyFlowOS turns a native or imported commerce occurrence into coherent order, payment, invoice, inventory, fulfilment, correction/refund, customer and downstream automation state.

Core question:

> For one economic order occurrence, what proves payment, which descendants represent the commercial obligation, which inventory/fulfilment effects are required, how are provider identities reconciled, and how do retries/corrections converge without duplicate or missing economic effects?

Primary kernels: K6, K7, K8, K9, K10, K11, K4.
Adjacent journeys: J3, J4, J7, J14, J17, J18, J23.

---

## B. Target product chain

```text
catalog/listing + customer intent
→ order occurrence
→ payment/external money evidence
→ commercial obligation lineage
→ Invoice/Payment/accounting descendants
→ inventory allocation lineage
→ required fulfilment route set
→ strategy-specific fulfilment effects
→ shipment/delivery outcomes
→ correction/cancel/refund/return convergence
→ customer/value/operator/automation projections
```

External imports additionally require:

```text
provider external identity
→ one internal aggregate identity
→ explicit operational materialization OR summary/evidence-only projection
```

---

## C. Positive native seam to preserve

`StoreOrderService.completeCheckout()` transactionally couples:

```text
Invoice DRAFT → SENT → PAID
+ Payment SUCCESSFUL
+ ledger posting
+ tracked InventoryStock decrement + sale StockMovement
+ RevenueAttribution ORDER
+ MarketplaceOrder paymentStatus=PAID/status=CONFIRMED
→ COMMIT
```

Invoice events are buffered until after commit. This is an architectural asset and should survive target refactoring.

---

## D. F206/C156 — duplicate paid-Invoice descendant ownership

Checkout already creates paid Invoice A, then emits `store_order.paid`.
Mounted `CommerceIntegrationService` can create paid Invoice B because its dedupe searches `notes contains order:{order.id}`, while Invoice A notes contain only `Storefront order {orderNumber}`.

Target law:

```text
one commercial order obligation
→ one semantic Invoice effect identity
→ every producer/retry/listener converges on the same descendant
```

Owner pressure: KF-REC-053 + KF-REC-052.

---

## E. F207/C157 — order confirmation conflates fulfilment and payment semantics

Authenticated UI exposes `pending → confirmed`; `updateOrderStatus(CONFIRMED)` changes only order status yet emits `store_order.paid`, even while paymentStatus can remain PENDING/UNPAID.

Routing separately maps legacy `CONFIRMED → awaiting_payment`, while strong native paid checkout itself writes `CONFIRMED`.

Target law:

```text
OrderFulfilmentState != PaymentCompletionEvidence
```

Cash/manual payment requires an explicit payment-recording capability if it is meant to establish payment truth.

---

## F. F208/C158 — inventory allocation/effect ownership conflict

For tracked stock, one native order can currently follow:

```text
checkout: quantity -= Q
routing:  reserved += Q
shipping: quantity -= Q; reserved -= Q
```

Cancel releases reservation without restoring the prior checkout decrement; refund changes order/payment projection without restoring tracked stock in that action.

Last-unit example:

```text
before: quantity=1,reserved=0
checkout: quantity=0
routing: available=0
→ FAILED route
```

Target law:

```text
one OrderItem inventory obligation
→ one allocation/effect identity
→ reserve / commit / consume / release / restore exactly once
→ correction-aware history
```

Exact business policy is not frozen; ownership/algebra must be singular.

---

## G. F209/C159 — aggregate fulfilment outcome can contradict route outcomes

A strategy may persist `FulfillmentRoute.status=FAILED` and return normally. `StoreOrderRoutingListener` then emits `store_order.fulfillment_routed`; `routing_failed` is emitted only when an exception is thrown.

Thrown failures reach `RevenueActionService`, but persisted FAILED route outcomes bypass that exception-based recovery trigger. CRM also stores the thrown failure under contact-event type `store_order.fulfillment_routed` with `failed:true`.

Target law:

```text
aggregate fulfilment outcome
= function(required per-route outcomes)
!= normal process return
```

Failed/partial required outcomes remain explicit recoverable work.

---

## H. F210/C160 — Shopify Product external identity does not survive repeat sync

`syncProducts()` looks up by synthetic SKU `shopify:{variantId}`, but when Shopify supplies a real SKU it persists that real SKU and only stores `shopifyVariantId` inside `executionMeta`.

Next sync again looks for the synthetic SKU and cannot rediscover the prior Product. Depending on DB constraints, the symptom is duplicate create or create failure; identity reconciliation is broken either way.

Target law:

```text
ExternalEntityIdentity(B, SHOPIFY, VARIANT, externalId)
→ exactly one Product
```

Merchant SKU is mutable/catalog data, not the immutable provider identity.

---

## I. F211/C161 — partial fulfilment route set blocks recovery

`routeOrder()` creates route/strategy descendants incrementally across items. If item 1 succeeds and item 2 throws, item 1 remains committed.

Retry guard:

```text
if existingRoutes.length > 0:
  return existingRoutes
```

so the partial set is interpreted as complete idempotent work and missing item routes can remain absent indefinitely.

Target law:

```text
RequiredRouteSet(order)
vs
ObservedRouteSet(order)
→ reconcile missing/failed semantic effects
```

Any existing child != complete required descendant set. Owner pressure: KF-REC-048/K11 plus J10 domain definition of the required set.

---

## J. F212/C162 — Shopify Contact identity differs by sync entrypoint

`syncCustomers()` resolves Contact by email OR `custom.shopifyCustomerId`.
`syncOrders()` resolves order customer only by email before creating a Contact.

After a Shopify customer changes email, order sync can create Contact C2 even though Contact C1 already carries the same provider customer ID.

Target law:

```text
ExternalEntityIdentity(B, SHOPIFY, CUSTOMER, externalId)
→ exactly one Contact
→ mutable email/name/phone reconciled afterward under explicit conflict policy
```

Lifecycle semantics remain separately governed by F205/KF-REC-053.

---

## K. F213/C163 — Shopify order aggregate lacks native item descendants

`syncOrders()` writes Shopify line items only to `MarketplaceOrder.metadata.lineItems`; it does not create native relational `MarketplaceOrderItem` descendants. Repository search found no runtime materializer, and `shopify.orders_synced` has zero registered listeners.

Native fulfilment/inventory/COGS logic consumes `order.items`.

Thus:

```text
aggregate identity = MarketplaceOrder
native structural item set = empty
provider metadata = line items exist
```

Target architecture must choose explicitly:

```text
A. operational import
   → materialize canonical/internal OrderItem descendants
   → resolve Product or explicit unresolved mapping state

OR

B. summary/evidence projection
   → cannot enter native effectful fulfilment/inventory flows as if complete
```

Raw provider payload remains provenance; opaque JSON is not a substitute for structural operational obligations.

---

## L. F214/C164 — strategy descendant can commit before route identity exists

DROPSHIP and PREORDER persist an effectful business descendant before the `FulfillmentRoute` that `routeOrder()` later uses as its retry/idempotency signal:

```text
DROPSHIP: PurchaseOrder → FulfillmentRoute
PREORDER: PreOrder → FulfillmentRoute
```

Those writes are not one shared atomic unit. A failure after the first write can therefore leave:

```text
strategy business effect exists
+ route does not exist
```

Retry sees route absence and can execute the strategy again, creating another PurchaseOrder/PreOrder for the same semantic obligation. HYBRID inherits the risk when it selects the effectful branch.

Target law:

```text
StrategyEffectIdentity
= business + order + order item/split + strategy + relevant revision

retry/reconcile:
  compare route + strategy-specific descendants against StrategyEffectIdentity
  repair/link safe orphan descendants
  create only genuinely missing effects
```

This is distinct from F211: F211 starts with a non-empty partial route set; F214 starts with an already-committed auxiliary business effect whose route guard is missing.

---

## M. Refund / correction classification

Store-order refund actions currently change order/payment projection and emit events without themselves composing provider refund, negative Payment, Invoice reconciliation, ledger reversal and stock restoration.

`PaymentsService` already contains stronger negative-Payment + ledger-reversal primitives. Therefore current refund pressure remains under mature J7/KF-REC-052 plus F208 inventory correction unless a distinct new root is proven.

---

## N. Canonical J10 invariants — stable microscopic tranche

1. Order/fulfilment state is not payment/accounting truth.
2. One economic order obligation has one semantic Invoice-descendant identity unless policy explicitly requires multiple documents.
3. Event replay/listener fan-out cannot duplicate commercial descendants.
4. Free-form notes are not canonical effect identity.
5. Native checkout transactionality is an asset to preserve.
6. Paid events describe proven payment state.
7. One order-item inventory quantity is allocated/consumed/released/restored exactly once under one state machine.
8. A route row existing is not proof its required outcome succeeded.
9. Aggregate fulfilment outcome is derived from required route outcomes.
10. A partial child set is not a complete required descendant set.
11. Failed/partial required fulfilment remains durable unresolved work until recovered/waived/cancelled.
12. Merchant SKU and mutable customer email are not immutable provider identity.
13. Every provider entity has one business-scoped reconciliation identity before mutation.
14. Imported provider metadata does not make a structurally incomplete aggregate operationally equivalent to a native one.
15. External payment/order labels remain external evidence until adapted into local truth layers.
16. Provider customer labels require lifecycle adapters.
17. Refund/correction must converge the effects actually applied without rewriting history.
18. Retry identity binds semantic effects, not merely process attempts or existence of any child row.
19. FulfillmentRoute absence is not proof that an effectful strategy descendant is absent.
20. Strategy-specific business effects and route state reconcile through one semantic StrategyEffectIdentity.

---

## O. Recommendation ownership result

The programme-required anti-duplication search is complete.

Existing owners remain authoritative for their dimensions:

```text
KF-REC-035–037 → ingress occurrence/lifecycle/reconciliation boundaries
KF-REC-048     → certainty-aware recovery and consequence completeness
KF-REC-052     → financial truth, money movement, valuation and corrections
KF-REC-053     → commercial relationship/obligation lineage and commercial value stages
```

They do not fully own this J10 domain cluster:

```text
order operational state algebra
inventory allocation/effect lineage
required fulfilment-set definition
strategy-effect identity
provider entity identity for commerce resources
operational external-order materialization
aggregate fulfilment outcome semantics
```

Therefore a distinct, narrow **Commerce & Fulfilment Contract** is justified in principle. It must compose with the mature contracts above and must not become a universal commerce runtime or duplicate financial/recovery ownership.

---

## P. Standards / external-reality pressure

Current external reference semantics support, but do not dictate, the target separation:

- stable provider resource identity is separate from mutable merchant attributes such as SKU;
- external orders expose line items structurally rather than solely as opaque metadata;
- fulfilment work is derived from purchased line-item obligations;
- inventory quantity semantics distinguish availability/commitment/reservation/on-hand concepts rather than repeatedly applying one sold quantity as unrelated decrements.

These references are corroborating pressure only. KeyFlow’s canonical contract remains domain-owned and provider-independent.

---

## Q. Proof pressure

Future proof must include:

- one native successful checkout → one paid Invoice lineage;
- generic confirmation cannot manufacture payment truth;
- reserve/consume/ship/cancel/refund effects compose exactly once;
- failed required route prevents unqualified aggregate success;
- failure after route 1 of N repairs only missing descendants;
- failure after PurchaseOrder/PreOrder creation but before route creation cannot duplicate the semantic strategy effect;
- Shopify Product and Contact identities survive mutable SKU/email changes;
- imported Shopify orders either materialize structural item obligations or are technically excluded from native effectful flows;
- repeated sync converges regardless endpoint order/pagination/retry;
- correction restores/releases precisely the financial/inventory effects actually applied.

Runtime proof has not been executed.

---

## R. Exact next programme step

```text
1. synthesize the narrow J10 Commerce & Fulfilment target contract;
2. pressure-test against KF-REC-048/052/053 and earlier K9 ingress contracts;
3. allocate KF-REC-054 only if the contract remains independently load-bearing;
4. backward re-audit J7, J3/J4, J18, J23, K9 and J17 boundaries;
5. then mark J10 target-aligned and choose the next first-pass journey frontier;
6. reuse F001–F214/C001–C164/KF-REC-001–053 before any further allocation;
7. keep production code untouched.
```

---

## S. Machine-readable record

```yaml
journey: KF-JOURNEY-010
name: Commerce / Fulfilment
status: ACTIVE_MICROSCOPIC_FORENSICS_THROUGH_F214_C164_TARGET_SYNTHESIS_READY
implementation_baseline: 4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
production_implementation_authorized: false
primary_kernels: [K6,K7,K8,K9,K10,K11,K4]
adjacent_journeys: [J3,J4,J7,J14,J17,J18,J23]
new_findings: [F206,F207,F208,F209,F210,F211,F212,F213,F214]
new_contradictions: [C156,C157,C158,C159,C160,C161,C162,C163,C164]
reused_recommendations: [KF-REC-035,KF-REC-036,KF-REC-037,KF-REC-047,KF-REC-048,KF-REC-051,KF-REC-052,KF-REC-053]
new_recommendation_pressure: Commerce_And_Fulfilment_Contract
current_trace: standards_frontier_synthesis
runtime_proof: NOT_EXECUTED
reopenable: true
```

No production implementation is authorized by this dossier.
