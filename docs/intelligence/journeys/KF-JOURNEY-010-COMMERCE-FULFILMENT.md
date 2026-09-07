# KF-JOURNEY-010 — Commerce / Fulfilment

Status: **ACTIVE MICROSCOPIC FORENSICS / INITIAL NATIVE-STOREFRONT TRANCHE**
Date activated: 2026-09-06
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J10 models how KeyFlowOS turns a product/customer checkout or imported commerce occurrence into a coherent order, payment, invoice, inventory, fulfilment, correction/refund, customer relationship and downstream automation lifecycle.

It asks:

> For one economic order occurrence, which state owns order/fulfilment truth, which evidence proves payment, which descendants represent the commercial obligation, which inventory/fulfilment consequences are required, and how do retries, imports, corrections and events converge without duplicate economic effects?

Primary kernels:

```text
K6  State Transition
K7  Temporal / Event / Workflow
K8  Evidence & Outcome
K9  Integration / External Reality
K10 Financial Truth
K11 Recovery & Reliability
K4  Business Knowledge
```

Primary adjacent journeys:

```text
J3  Lead → Customer → Cash
J4  Booking → Service → Payment
J7  Financial Truth
J14 Webhook / External Event Ingress
J17 Command Center → Priority → Action
J18 Failure → Recovery
J23 Temporal Flow / Long-Running Workflow
```

---

## B. Product intent

Target product behavior:

```text
catalog/listing + customer intent
→ order occurrence
→ payment/external money evidence
→ one commercial obligation lineage
→ invoice/payment/accounting descendants
→ inventory reservation/decrement or explicit non-tracked policy
→ fulfilment routing + shipment/delivery evidence
→ correction/cancel/refund/return disposition
→ customer/value/operator/automation projections
```

A user should be able to ask:

- Was this order actually paid, and by what evidence?
- Which invoice/payment/ledger entries belong to it?
- Did the sale decrement the correct stock, or was the item intentionally untracked/backordered?
- Has fulfilment been routed, shipped and delivered?
- If refunded/cancelled/returned, which financial and inventory consequences actually happened?
- Is this Shopify/imported state external evidence or already converged KeyFlow financial truth?
- Can replaying an event or sync create duplicate products, invoices or other economic descendants?

---

## C. Native storefront entry and order creation

`SiteController.publicCheckout()` is a public, rate-limited storefront endpoint. It resolves the storefront/business, sanitizes customer data, then calls `StoreOrderService.createOrder()`.

Native order creation:

```text
validate products + quantities
→ calculate subtotal / promo / shipping / tax / total
→ MarketplaceOrder PENDING
→ paymentStatus CASH? PENDING : UNPAID
→ MarketplaceOrderItems
→ optional promo usage increment
→ emit store_order.created
→ best-effort CRM/contact + storefront event backstitch
→ optionally initiate external payment
```

The order row is therefore an operational/commercial occurrence before it becomes financial truth.

---

## D. Strong native checkout completion seam

`StoreOrderService.completeCheckout()` contains an important architecture asset.

After contact resolution and inventory-mode preparation, one database transaction performs:

```text
Invoice create DRAFT
→ InvoiceWorkflow DRAFT→SENT→PAID
→ Payment SUCCESSFUL
→ RevenuePostingService / ledger posting
→ tracked inventory decrement + StockMovement
→ RevenueAttribution ORDER
→ MarketplaceOrder paymentStatus=PAID + status=CONFIRMED
→ COMMIT
```

Invoice events are buffered and emitted only after commit. Then best-effort timeline/inventory-risk side effects run and `store_order.paid` is emitted.

Positive seam to preserve:

```text
financial document + payment + ledger + tracked stock + attribution + paid-order state
share one commit boundary
```

This is stronger than many surrounding modules and must not be flattened during target redesign.

---

## E. Initial canonical finding — duplicate paid Invoice descendant

### F206 / C156

The same successful `completeCheckout()` path emits `store_order.paid` after already creating its paid Invoice.

Mounted `CommerceIntegrationService.handleOrderPaid()` calls `createRevenueRecord()`.

Its duplicate check searches Invoice notes for:

```text
order:{order.id}
```

but the transactionally-created invoice notes are only:

```text
Storefront order {order.orderNumber}
```

The listener therefore does not identify the existing descendant and can create:

```text
Invoice A: INV-{orderNumber}, PAID, Payment+ledger-backed
Invoice B: INV-ORD-{orderNumber}, PAID, created by paid-event listener
```

for one StoreOrder/economic sale.

Canonical home:
- `08AK-FINDING-REGISTER-STOREFRONT-PAID-INVOICE-DUPLICATION-SUPPLEMENT.md`
- `09AK-CONTRADICTION-REGISTER-STOREFRONT-PAID-INVOICE-DUPLICATION-SUPPLEMENT.md`

Target direction: one commercial order obligation/effect identity must converge every invoice creator/retry/listener on the same descendant under KF-REC-053.

---

## F. Order status and payment status are separate axes — but current event semantics require scrutiny

`StoreOrderService.updateOrderStatus()` persists arbitrary status strings and maps:

```text
CONFIRMED → store_order.paid
SHIPPED   → store_order.shipped
DELIVERED → store_order.delivered
CANCELLED → store_order.cancelled
```

The authenticated storefront UI exposes a normal status progression:

```text
pending → confirmed → processing → shipped → delivered
```

and calls the status endpoint to mark the next state.

Thus `CONFIRMED` is both an operational order/fulfilment label and an event alias for payment completion. This is an active trace target because a manually confirmed unpaid/cash order may trigger paid-event consumers.

No new ID allocated yet: first classify against F187/F193/F194/F196 and KF-REC-052 before deciding whether this is a distinct J10 semantic root.

---

## G. Refund/correction path — current evidence

`StoreOrderService.refundOrder()` currently:

```text
read business-scoped order
→ reject already REFUNDED status
→ MarketplaceOrder.status = REFUNDED
→ MarketplaceOrder.paymentStatus = REFUNDED
→ emit store_order.refunded { refundAmount: order.total }
```

Inside that method no provider refund, negative Payment, invoice reconciliation, ledger reversal or inventory restoration is performed.

`CommerceIntegrationService.handleOrderRefunded()` logs CRM history, can create an Expense representing the refund amount, and creates a notification.

Classification remains under existing J7/KF-REC-052 pressure until the full refund/provider/inventory consumer graph is traced. Do not allocate a new refund root by reflex.

---

## H. Shopify / external-commerce adapter — initial evidence

`ShopifyService.syncOrders()` imports external order state into `MarketplaceOrder`:

```text
Shopify financial_status
→ MarketplaceOrder.paymentStatus
paid → PAID
pending → UNPAID
refunded → REFUNDED
partially_paid → PARTIAL
```

This is external/provider commercial evidence, not automatically local Payment/ledger truth. Reuse J7/K9/K10 boundaries.

`syncOrders()` also creates Contact rows with `status='CUSTOMER'`, and `syncCustomers()` updates existing Contact rows to `CUSTOMER` or `LEAD`; this directly reuses F205/C155 and KF-REC-053's provider-adapter/lifecycle-state requirements.

A product-sync identity concern is under investigation: lookup uses synthetic `shopify:{variantId}` as SKU while persistence prefers a provider-supplied real SKU. Confirm DB/catalog uniqueness and repeat-sync behavior before allocating any new identity.

---

## I. Fulfilment routing / events — initial evidence

`StoreOrderRoutingListener` listens asynchronously to `store_order.paid` and calls `FulfillmentRoutingService.routeOrder()`, described as idempotent when routes already exist. It then emits `store_order.fulfillment_routed`; on failure it emits `store_order.routing_failed`.

This is a useful J7/J18/J23 contrast:

```text
paid order commit
→ async required fulfilment consequence
→ explicit routed/failure event
```

Further trace is required to determine whether routing failure becomes durable unresolved work/operator attention or only an event/log signal.

---

## J. Customer relationship effects

Native and marketplace listeners create/find Contacts, add tags such as `customer`, `store-order`, `paid`, log contact events and link contact identity through order metadata.

These are commercial evidence inputs. They do not supersede J3's canonical law:

```text
commercial/order evidence
!= CustomerLifecycleState transition
until the KF-REC-053 lifecycle policy evaluates it
```

Shopify direct `CUSTOMER` persistence is already F205 evidence.

---

## K. Financial truth alignment

J10 delegates:

```text
provider payment/capture/refund reality
Payment identity
Invoice financial state
ledger/accounting consequences
reconciliation
valuation / FX
```

to J7/KF-REC-052.

Order `status` or `paymentStatus` is a commerce projection and must not silently pretend to be those deeper truth layers.

---

## L. Commercial obligation alignment

J10 is the first adjacent journey stress-testing KF-REC-053 after J3/J4 synthesis.

Working mapping:

```text
StoreOrder / external order occurrence
→ CommercialObligationLineage
→ one semantic receivable/invoice effect
→ Payment/accounting descendants
→ fulfilment/inventory expected consequences
→ cancellation/refund/return disposition
→ stage-explicit customer/revenue projections
```

F206 strengthens the need for lineage/effect identity beyond service bookings: the same contract must work for product orders.

---

## M. Initial J10 invariants

1. Order/fulfilment status is not payment/accounting truth.
2. One economic order obligation has one semantic invoice-descendant identity unless explicit policy requires multiple documents.
3. Event replay/listener fan-out must not create duplicate commercial descendants.
4. Free-form notes are not a canonical commercial-effect identity.
5. Native checkout transactionality for Invoice + Payment + ledger + tracked inventory + paid order state is an asset to preserve.
6. Post-commit events must describe committed state.
7. External Shopify/payment states are external evidence until adapted/converged into local truth layers.
8. Provider lifecycle labels require owned adapters before canonical customer-state persistence.
9. Refund labels do not prove provider/payment/ledger reversal.
10. Fulfilment routing failure must not disappear if routing is a required descendant consequence.
11. Inventory tracked/untracked/backorder policy must be explicit and consistently interpreted.
12. Commercial correction must converge financial, inventory and fulfilment descendants without rewriting history.

---

## N. Current proof / failure pressure

Immediate tests the future target must survive:

- successful native checkout produces exactly one paid Invoice lineage;
- replayed `store_order.paid` cannot duplicate that Invoice;
- manual status confirmation cannot manufacture payment truth;
- imported Shopify PAID remains distinguishable from locally reconciled Payment/ledger truth;
- refund/cancel/return disposition converges provider money, Invoice/Payment/ledger and stock restoration as policy requires;
- fulfilment-routing failure becomes recoverable/projectable work if routing is required;
- repeated Shopify sync uses stable external identities for products/orders/customers;
- customer lifecycle adapters prevent provider `CUSTOMER` from bypassing canonical state policy.

Runtime proof has not been executed by this analytical programme.

---

## O. Reachability

Current native storefront order path is live and mounted through `SiteController`/`SiteModule`.

`MarketplaceModule` is imported by root `AppModule`; its listeners self-activate through `@OnEvent`, including `CommerceIntegrationService` and `StoreOrderRoutingListener`.

Marketplace UI may be feature-flagged, but its event listeners remain module providers and therefore relevant to live cross-module event behavior.

---

## P. Existing roots reused before new IDs

```text
F193/C143 ledger-writer bypass
F194/C144 gross vs net payment projection
F196/C146 parallel Invoice state machine
F202/C152 commercial value-stage mixing
F205/C155 provider/customer lifecycle dialect drift
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
KF-REC-048 recovery contract
KF-REC-047 temporal work projection
```

F206/C156 is distinct because it identifies two mounted descendant creators for the same order obligation whose dedupe identities cannot converge.

---

## Q. Exact next microscopic trace

```text
1. trace StoreOrder status/payment-status transition matrix and every writer;
2. prove whether UI/manual CONFIRMED can emit store_order.paid without payment truth;
3. trace refund/cancel/return through provider, Payment, Invoice, ledger, RevenueAttribution and inventory restoration;
4. trace FulfillmentRoutingService state machine, idempotency and routing_failed recovery visibility;
5. trace Shopify product/order/customer sync identities and repeat-sync behavior;
6. trace order events into CRM, calendar, webhook dispatcher, KEY/AI and temporal jobs;
7. classify every candidate against F001–F206/C001–C156 before new allocation;
8. pressure-test KF-REC-053 across product-order obligation lineage before deciding whether any new recommendation is justified.
```

---

## R. Machine-readable record

```yaml
journey: KF-JOURNEY-010
name: Commerce / Fulfilment
status: ACTIVE_MICROSCOPIC_FORENSICS_INITIAL_NATIVE_STOREFRONT_TRANCHE
implementation_baseline: 4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
production_implementation_authorized: false
primary_kernels: [K6,K7,K8,K9,K10,K11,K4]
adjacent_journeys: [J3,J4,J7,J14,J17,J18,J23]
new_findings: [F206]
new_contradictions: [C156]
reused_findings: [F193,F194,F196,F202,F205]
reused_recommendations: [KF-REC-052,KF-REC-053,KF-REC-048,KF-REC-047]
current_trace: native_storefront_order_to_payment_invoice_inventory_fulfilment_then_external_import_and_correction
runtime_proof: NOT_EXECUTED
reopenable: true
```

No production implementation is authorized by this dossier.
