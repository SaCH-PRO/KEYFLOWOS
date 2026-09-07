# KeyFlowOS Current Handoff

Last updated: 2026-09-06
Status: CURRENT — J10 COMMERCE/FULFILMENT ACTIVE THROUGH F211/C161

## Programme identity / integrity

```text
repository:            SaCH-PRO/KEYFLOWOS
main head:             4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
code-bearing baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
main delta class:      audit / architecture-journal only
intelligence branch:   docs/keyflow-intelligence-foundation
production code:       READ-ONLY / UNAUTHORIZED
context integrity:     PASS
```

## Canonical ranges

```text
Findings:        F211
Contradictions:  C161
Recommendations: KF-REC-053
Concepts:        KF-CONCEPT-042
```

Load `04-CONCEPT-REGISTRY.md` + `04A` + `04B` before allocating anything new.

## Mature pools

- J16/K4 → KF-REC-049.
- J17 → F179–F184 / C129–C134 / KF-REC-051.
- J23/J18 → mature temporal/recovery proof architecture; runtime proof not executed.
- J7 → F185–F196 / C135–C146 / KF-REC-052.
- J3/J4 → F197–F205 / C147–C155 / KF-REC-053; canonical dossiers and current-tranche backward re-audits complete.

## Active J10 — Commerce / Fulfilment

Dossier: `docs/intelligence/journeys/KF-JOURNEY-010-COMMERCE-FULFILMENT.md`

### Positive seam to preserve

Native `StoreOrderService.completeCheckout()` transactionally couples:

```text
Invoice workflow DRAFT→SENT→PAID
+ Payment SUCCESSFUL
+ ledger posting
+ tracked stock decrement/StockMovement
+ RevenueAttribution ORDER
+ MarketplaceOrder paymentStatus=PAID/status=CONFIRMED
→ commit
→ buffered invoice events
→ store_order.paid
```

### F206/C156 — duplicate paid Invoice descendant

Checkout creates paid Invoice A; mounted `store_order.paid` listener can create paid Invoice B because its notes-based dedupe identity cannot see Invoice A. Target reuses KF-REC-053 semantic effect identity and KF-REC-052 financial truth.

### F207/C157 — CONFIRMED conflates order and payment state

Authenticated order confirmation can emit `store_order.paid` while `paymentStatus` remains PENDING/UNPAID. Routing also maps legacy `CONFIRMED → awaiting_payment`, even though strong native paid checkout itself writes `CONFIRMED`. Target law: `OrderFulfilmentState != PaymentCompletionEvidence`.

### F208/C158 — inventory effect ownership conflict

Native paid checkout decrements on-hand Q; LOCAL_STOCK routing can reserve Q; shipment later decrements Q again and releases reservation. Cancel releases reservation but does not restore the checkout decrement; refund changes order/payment projection without restoring stock in that action.

Target: one order-item inventory allocation lineage/state machine for reserve/commit/consume/release/restore, exact-once and correction-aware.

### F209/C159 — failed route can become aggregate fulfilment success

A `FulfillmentRoute(status=FAILED)` can return normally, causing `store_order.fulfillment_routed`. Thrown `routing_failed` reaches `RevenueActionService`, but persisted FAILED route outcomes bypass that exception-based recovery path. CRM also stores thrown `routing_failed` under success event type `store_order.fulfillment_routed` with `failed:true`.

### F210/C160 — Shopify product repeat-sync external identity breaks

Sync lookup uses `sku=shopify:{variantId}`, while persistence uses `variant.sku` whenever a real SKU exists and only stores Shopify IDs in `executionMeta`. Next sync cannot rediscover the prior Product. Depending on DB constraints it duplicates or fails, but semantic reconciliation is broken either way.

Target: immutable provider external identity → one business-scoped internal Product; merchant SKU remains catalog data.

### F211/C161 — partial route set blocks recovery

`routeOrder()` creates routes incrementally across items, but retry returns immediately when `existingRoutes.length > 0`. A failure after item 1 of N can therefore leave a partial route set; retry skips missing item routes and may advance order state.

Target: reconcile `RequiredRouteSet` vs `ObservedRouteSet` by semantic route/effect identity, not “skip if any child exists.” Reuse KF-REC-048/K11.

## Refund classification

Store-order refund entry surfaces remain classified under mature J7/KF-REC-052 unless a distinct new root emerges. `PaymentsService` contains stronger negative-Payment + ledger-reversal refund primitives; StoreOrder/Marketplace refund actions do not automatically compose those with inventory restoration.

## Exact next action

```text
1. finish J10 external-identity trace for Shopify customers and orders;
2. test changed-email/customer-id reconciliation and order external identity stability;
3. inspect all routing strategies for strategy-specific descendant idempotency (PO/PreOrder/manual/service);
4. trace cancellation/refund/return inventory correction against F208 rather than duplicating it;
5. trace J10 events into CRM/calendar/webhooks/KEY/temporal/operator surfaces for propagation of F207/F209;
6. assess whether F206–F211 still fit KF-REC-047/048/051/052/053 or justify a distinct commerce/fulfilment target recommendation;
7. reuse F001–F211 / C001–C161 / KF-REC-001–053 before new IDs;
8. persist every material tranche; do not modify production code.
```

If this chat disappears, resume **J10 after F211/C161**, starting with Shopify customer/order external identity and strategy-specific fulfilment descendant idempotency.
