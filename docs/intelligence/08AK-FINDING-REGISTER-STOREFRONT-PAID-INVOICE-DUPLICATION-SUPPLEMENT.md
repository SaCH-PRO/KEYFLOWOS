# KeyFlowOS Finding Register — Storefront Paid-Invoice Duplication Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F206 — one successful storefront checkout has two mounted paid-invoice creation owners whose dedupe identities do not compose

**Status:** VERIFIED REACHABLE COMMERCIAL-LINEAGE / DUPLICATE-DESCENDANT FINDING

The canonical storefront checkout path in `StoreOrderService.completeCheckout()` creates a paid invoice transactionally as part of one strong checkout commit:

```text
MarketplaceOrder (pre-payment)
→ Invoice create
   invoiceNumber = INV-{order.orderNumber}
   notes = "Storefront order {order.orderNumber}"
→ InvoiceWorkflow DRAFT → SENT → PAID
→ Payment SUCCESSFUL
→ ledger posting
→ inventory decrement/movement where tracked
→ RevenueAttribution ORDER
→ MarketplaceOrder paymentStatus=PAID, status=CONFIRMED
→ commit
→ emit buffered invoice events
→ emit store_order.paid { order, businessId, invoiceId }
```

This is a strong current-state seam and should be preserved.

However `MarketplaceModule` is mounted in the root application and registers `CommerceIntegrationService` as an event listener. Its `@OnEvent('store_order.paid')` handler calls `createRevenueRecord()`.

`createRevenueRecord()` tries to deduplicate by searching for:

```text
Invoice where
  businessId = order.businessId
  notes contains "order:{order.id}"
```

If none is found, it creates another invoice:

```text
invoiceNumber = INV-ORD-{order.orderNumber}
status = PAID
paidAt = now
notes = "Auto-generated from store order ... order:{order.id}"
```

The transactionally-created checkout invoice does **not** contain `order:{order.id}` in its notes. Its invoice number is also different from the listener-created number. Therefore the listener's duplicate check does not identify the already-created invoice.

A normal successful storefront checkout can consequently produce:

```text
Order O
→ Invoice A = INV-{orderNumber}, PAID, backed by Payment + ledger posting
→ store_order.paid
→ Invoice B = INV-ORD-{orderNumber}, PAID, no Payment/ledger consequence created by createRevenueRecord()
```

The second Invoice is not merely a second representation of an intended multi-document obligation. Both are framed as the paid revenue record for the same order occurrence.

### Why this is distinct from existing roots

This finding reuses but is not identical to:

- F193/C143 — ledger-writer bypass pressure;
- F196/C146 — parallel Invoice state-machine ownership;
- F202/C152 — heterogeneous commercial value-stage attribution;
- KF-REC-052 — financial-truth ownership;
- KF-REC-053 — commercial obligation lineage and semantic effect idempotency.

The distinct J10 root is **duplicate required-descendant ownership for one commercial order occurrence with incompatible dedupe identities**. Even if both Invoice writers individually used the canonical Invoice workflow, the system would still have two invoice-creation owners unless one commercial-effect identity/lineage converges them.

### Target law

```text
ONE COMMERCIAL ORDER OBLIGATION
→ ONE SEMANTIC PAID-INVOICE EFFECT IDENTITY
→ repeated producers / retries / listeners converge on the same descendant
```

Do not repair this only by matching free-form `notes` strings. The target should bind the Invoice descendant to declared commercial lineage/effect identity under KF-REC-053, while financial consequence truth remains delegated to KF-REC-052.

### Reachability

- `SiteController.publicCheckout()` calls `StoreOrderService.createOrder()` and payment completion can route to `completeCheckout()`.
- `StoreOrderService.completeCheckout()` emits `store_order.paid` after commit.
- `MarketplaceModule` registers `CommerceIntegrationService` and is imported by root `AppModule`.
- `CommerceIntegrationService.handleOrderPaid()` is therefore a mounted listener, not an orphaned code path.

### Proof pressure

Future proof must demonstrate:

1. one successful storefront order produces one commercial receivable/invoice lineage unless explicit business policy requires more;
2. replayed `store_order.paid` cannot create another paid invoice for the same semantic obligation;
3. order→invoice linkage is structural, not inferred from notes text;
4. the one accepted Invoice is the same descendant used by Payment, ledger posting, reporting and correction/refund flows;
5. retries and listener re-delivery converge across process boundaries.

Affected kernels: K6, K7, K8, K10, K11.
Affected journeys: J10, J3, J7, J18, J23.

No production implementation is authorized by this supplement.
