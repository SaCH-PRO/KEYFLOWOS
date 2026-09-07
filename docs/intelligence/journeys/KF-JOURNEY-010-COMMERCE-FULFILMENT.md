# KF-JOURNEY-010 — Commerce / Fulfilment

Status: **ACTIVE MICROSCOPIC FORENSICS / NATIVE CHECKOUT + FULFILMENT TRANCHE THROUGH F209/C159**
Last updated: 2026-09-06
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J10 models how KeyFlowOS turns a product/customer checkout or imported commerce occurrence into a coherent order, payment, invoice, inventory, fulfilment, correction/refund, customer relationship and downstream automation lifecycle.

It asks:

> For one economic order occurrence, which state owns order/fulfilment truth, which evidence proves payment, which descendants represent the commercial obligation, which inventory/fulfilment consequences are required, and how do retries, imports, corrections and events converge without duplicate economic effects?

Primary kernels: K6, K7, K8, K9, K10, K11, K4.

Primary adjacent journeys: J3, J4, J7, J14, J17, J18, J23.

---

## B. Product intent

Target product behavior:

```text
catalog/listing + customer intent
→ order occurrence
→ payment/external money evidence
→ one commercial obligation lineage
→ invoice/payment/accounting descendants
→ one inventory allocation lineage
→ fulfilment routing + shipment/delivery evidence
→ correction/cancel/refund/return disposition
→ customer/value/operator/automation projections
```

Questions the target must answer explainably:

- Was this order actually paid, and by what evidence?
- Which Invoice/Payment/ledger entries belong to it?
- Which inventory units were reserved, consumed, released or restored?
- Has every required fulfilment route succeeded?
- If routing partially failed, what unresolved work owns recovery?
- If refunded/cancelled/returned, which financial and inventory consequences actually happened?
- Is Shopify/imported state external evidence or already converged KeyFlow truth?
- Can replaying an event or sync create duplicate products, invoices or other economic descendants?

---

## C. Native storefront entry

`SiteController.publicCheckout()` resolves the storefront/business, sanitizes customer data, calls `StoreOrderService.createOrder()`, and can initiate an external payment for non-CASH/non-MANUAL methods.

Native order creation produces an operational/commercial occurrence before financial truth:

```text
validate products + quantities
→ calculate subtotal / promo / shipping / tax / total
→ MarketplaceOrder status=PENDING
→ paymentStatus=PENDING for CASH, otherwise UNPAID
→ items / optional promo usage
→ store_order.created
→ best-effort CRM/timeline backstitch
→ optional provider payment initiation
```

---

## D. Positive architecture seam — native paid checkout transaction

`StoreOrderService.completeCheckout()` is a strong seam to preserve.

One transaction performs:

```text
Invoice DRAFT
→ InvoiceWorkflow DRAFT→SENT→PAID
→ Payment SUCCESSFUL
→ RevenuePostingService / ledger posting
→ tracked InventoryStock quantity decrement + StockMovement(sale)
→ RevenueAttribution ORDER
→ MarketplaceOrder paymentStatus=PAID + status=CONFIRMED
→ COMMIT
```

Invoice events are buffered until after commit; only then do timeline/risk/event fan-out effects run.

This transaction boundary should survive target refactoring even where downstream semantics change.

---

## E. F206 / C156 — duplicate paid-Invoice descendant ownership

The successful checkout transaction already creates paid Invoice A:

```text
invoiceNumber = INV-{orderNumber}
notes = Storefront order {orderNumber}
```

After commit it emits `store_order.paid`.

Mounted `CommerceIntegrationService.handleOrderPaid()` calls `createRevenueRecord()`, whose dedupe check searches Invoice notes for `order:{order.id}`. Invoice A does not satisfy that predicate, so a second PAID Invoice B can be created:

```text
invoiceNumber = INV-ORD-{orderNumber}
notes include order:{order.id}
```

Canonical homes: `08AK` / `09AK`.

Target law:

```text
one commercial order obligation
→ one semantic Invoice effect identity
→ every producer/retry/listener converges on the same descendant
```

Free-form notes are not a canonical effect identity.

---

## F. F207 / C157 — order confirmation conflates fulfilment and payment semantics

The authenticated Store UI exposes:

```text
pending → confirmed → processing → shipped → delivered
```

The order-status endpoint calls `StoreOrderService.updateOrderStatus()`.

For `CONFIRMED`, it updates only `MarketplaceOrder.status` but maps the state to event:

```text
CONFIRMED → store_order.paid
```

No payment-state validation or write is required by that method.

Reachable state:

```text
status = CONFIRMED
paymentStatus = PENDING or UNPAID
store_order.paid emitted
→ paid-event consumers can create PAID invoice semantics / route fulfilment
```

Canonical homes: `08AL` / `09AL`.

Target law:

```text
OrderFulfilmentState != PaymentCompletionEvidence
```

If cash/manual confirmation is intended to record payment, it needs an explicit payment-recording capability and financial evidence.

An additional implementation clue reinforces F207: `FulfillmentRoutingService` normalizes legacy `CONFIRMED` to `awaiting_payment`, while `completeCheckout()` itself sets genuinely paid orders to `CONFIRMED`; therefore the same label is already interpreted differently by adjacent paths.

---

## G. F208 / C158 — checkout and fulfilment double-apply one tracked-stock effect

Native paid checkout decrements tracked on-hand quantity:

```text
quantity := quantity - Q
StockMovement sale := -Q
```

Post-payment routing then calls `routeLocalStock()` which computes:

```text
available = quantity - reserved
```

and, if available, increments:

```text
reserved := reserved + Q
```

for the same order item.

Thus the same units can be economically consumed twice in the availability model:

```text
checkout: quantity -= Q
routing:  reserved += Q
```

Last-unit example:

```text
before: quantity=1, reserved=0
checkout Q=1: quantity=0
routing: available=0 < 1
→ FulfillmentRoute FAILED
```

Canonical homes: `08AM` / `09AM`.

Target law:

```text
one OrderItem inventory obligation
→ one allocation identity
→ reserve / commit / consume / release / restore transitions compose exactly once
```

The architecture does not yet freeze whether reservation or decrement happens first; it requires one owner/state machine.

---

## H. F209 / C159 — failed required routes can still produce aggregate fulfillment_routed

For insufficient tracked stock, `routeLocalStock()` persists:

```text
FulfillmentRoute.status = FAILED
```

but returns the route normally.

`routeOrder()` therefore returns normally, and `StoreOrderRoutingListener` emits:

```text
store_order.fulfillment_routed
```

It emits `store_order.routing_failed` only if `routeOrder()` throws.

Downstream shared contact semantics label `store_order.fulfillment_routed` as “Order routed to fulfillment.”

Therefore:

```text
required per-item route = FAILED
while
aggregate event = fulfillment_routed
```

Canonical homes: `08AM` / `09AM`.

Target law:

```text
aggregate fulfilment outcome
= function(required route outcomes)
!= whether routing code returned normally
```

Partial/failed route sets must retain failed-route identities and durable recovery work.

---

## I. Refund / correction path — current classification

`StoreOrderService.refundOrder()` currently:

```text
MarketplaceOrder.status = REFUNDED
MarketplaceOrder.paymentStatus = REFUNDED
→ store_order.refunded
```

That entry surface itself does not invoke provider refund, negative Payment, Invoice reconciliation, ledger reversal or inventory restoration.

`CommerceIntegrationService.handleOrderRefunded()` can create CRM history, a refund Expense and notification.

However `PaymentsService` already contains stronger refund primitives that create negative Payment evidence and reverse original ledger posting transactionally. Therefore the current Store Order refund surface is classified under mature J7/KF-REC-052 entry-surface convergence/bypass pressure unless a distinct new semantic root is proven.

---

## J. Shopify / external-commerce adapter — active investigation

`ShopifyService.syncOrders()` maps external financial state into `MarketplaceOrder.paymentStatus`:

```text
paid → PAID
pending → UNPAID
refunded → REFUNDED
partially_paid → PARTIAL
```

This is provider evidence, not automatically local Payment/ledger truth; reuse J7/K9/K10/KF-REC-052.

Shopify order/customer sync also writes Contact `CUSTOMER|LEAD`; that reuses F205/C155 and KF-REC-053 provider-lifecycle adapter pressure.

Next identity question:

```text
syncProducts lookup key = sku: shopify:{variantId}
persisted sku = provider real SKU when present, otherwise synthetic key
```

Need inspect actual Product schema constraints and CatalogService create/update behavior to prove repeat-sync outcome before allocating another finding.

---

## K. Fulfilment routing — next trace

`StoreOrderRoutingListener` asynchronously consumes `store_order.paid` and calls `FulfillmentRoutingService.routeOrder()`.

Current route strategies:

```text
LOCAL_STOCK
DROPSHIP
PREORDER
HYBRID
MANUAL
SERVICE
```

The next microscopic tranche must determine:

- per-strategy effect identity/idempotency;
- whether existing route rows prevent duplicate supplier/PurchaseOrder/task effects;
- required-route completeness rules;
- whether `routing_failed` and FAILED route rows become durable recovery/temporal/operator work;
- cancellation/refund/return release/restoration behavior;
- whether partial route success is represented truthfully.

---

## L. Customer relationship alignment

Native/marketplace consumers find/create Contacts, attach tags and log order events. Those are commercial evidence inputs only.

```text
order/payment evidence
!= CustomerLifecycleState transition
until KF-REC-053 policy evaluates it
```

Direct Shopify `CUSTOMER` persistence remains F205 pressure.

---

## M. Financial truth alignment

J10 delegates provider money reality, Payment identity, Invoice financial state, accounting/ledger consequences, reconciliation and valuation to J7/KF-REC-052.

`MarketplaceOrder.status` and `paymentStatus` are commerce projections, not deeper financial truth.

---

## N. Commercial obligation alignment

J10 materially strengthens KF-REC-053 beyond service bookings:

```text
StoreOrder / external order occurrence
→ CommercialObligationLineage
→ one semantic receivable/Invoice effect
→ Payment/accounting descendants
→ inventory allocation obligation
→ fulfilment expected consequences
→ correction/cancel/refund/return disposition
→ stage-explicit customer/revenue projections
```

F206 proves product orders also require semantic descendant idempotency.
F208/F209 show that `ExpectedConsequence` and outcome completeness also need to cover inventory/fulfilment descendants.

No new recommendation is justified yet; current evidence still composes with KF-REC-052/053/048/047/051.

---

## O. Canonical J10 invariants — current tranche

1. Order/fulfilment state is not payment/accounting truth.
2. One economic order obligation has one semantic Invoice-descendant identity unless explicit policy requires more.
3. Event replay/listener fan-out cannot duplicate commercial descendants.
4. Free-form notes are not canonical effect identity.
5. Native checkout transactionality is an asset to preserve.
6. Post-commit paid events must describe proven committed payment state.
7. One order-item inventory quantity is allocated/consumed/released/restored exactly once under one state machine.
8. A route row existing is not proof its required outcome succeeded.
9. Aggregate fulfilment outcome is derived from required route outcomes.
10. Failed/partial required fulfilment remains durable unresolved work until recovered/waived/cancelled.
11. External Shopify/payment states remain external evidence until adapted into local truth layers.
12. Provider customer labels require lifecycle adapters.
13. Refund labels do not prove provider/payment/ledger/inventory reversal.
14. Corrections preserve historical evidence while converging current descendants.
15. Retry identity must bind semantic inventory/fulfilment effects, not only process attempts.

---

## P. Proof pressure

Future proofs must include:

- one native successful checkout → one paid Invoice lineage;
- replayed `store_order.paid` → no duplicate Invoice;
- generic order confirmation cannot manufacture payment truth;
- last-unit paid sale remains fulfilment-consistent under declared policy;
- rerouting cannot reserve/decrement the same units repeatedly;
- any failed required route prevents unqualified aggregate success;
- partial routing carries failed route identities and recovery ownership;
- imported Shopify PAID remains distinguishable from local reconciled financial truth;
- repeated Shopify sync converges on stable external product/order/customer identities;
- refund/cancel/return restores/releases exactly the financial/inventory effects actually applied.

Runtime proof has not been executed by this analytical programme.

---

## Q. Reachability

Native storefront paths are mounted through SiteModule/controllers.
MarketplaceModule is imported by root AppModule and its event listeners self-activate, including `CommerceIntegrationService` and `StoreOrderRoutingListener`.

Feature-flagged marketplace UI does not make these listeners dormant once the module is mounted.

---

## R. Existing roots reused before new IDs

```text
F187/C137 financial state stronger than proven effect
F193/C143 ledger-writer bypass
F194/C144 gross vs net payment projection
F196/C146 parallel Invoice state machine
F202/C152 commercial value-stage mixing
F205/C155 provider/customer lifecycle dialect drift
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
KF-REC-048 Recovery Contract
KF-REC-047 Temporal Work Projection
KF-REC-051 Operator Attention & Priority Contract
```

Current distinct J10 roots:

```text
F206/C156 duplicate paid-Invoice descendant ownership
F207/C157 order CONFIRMED → paid-event semantic conflation
F208/C158 checkout stock decrement + fulfilment reservation double effect
F209/C159 failed route + aggregate fulfillment_routed false success
```

---

## S. Exact next microscopic trace

```text
1. finish all FulfillmentRoutingService strategy paths;
2. trace existing-route idempotency and downstream PO/task/shipment effects;
3. trace consumers of fulfillment_routed and routing_failed;
4. classify durable recovery/operator projection for FAILED required routes;
5. inspect Product schema SKU constraints and CatalogService create/update;
6. prove Shopify product repeat-sync identity with real provider SKU;
7. trace Shopify order/customer identity/correction semantics;
8. trace cancel/refund/return inventory release/restoration;
9. classify every candidate against F001–F209/C001–C159 before allocation;
10. pressure-test KF-REC-053 across product-order obligations before any new recommendation.
```

---

## T. Machine-readable record

```yaml
journey: KF-JOURNEY-010
name: Commerce / Fulfilment
status: ACTIVE_MICROSCOPIC_FORENSICS_THROUGH_F209_C159
implementation_baseline: 4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
production_implementation_authorized: false
primary_kernels: [K6,K7,K8,K9,K10,K11,K4]
adjacent_journeys: [J3,J4,J7,J14,J17,J18,J23]
new_findings: [F206,F207,F208,F209]
new_contradictions: [C156,C157,C158,C159]
reused_findings: [F187,F193,F194,F196,F202,F205]
reused_recommendations: [KF-REC-052,KF-REC-053,KF-REC-048,KF-REC-047,KF-REC-051]
current_trace: fulfilment_recovery_completeness_then_shopify_external_identity
runtime_proof: NOT_EXECUTED
reopenable: true
```

No production implementation is authorized by this dossier.
