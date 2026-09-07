# KeyFlowOS Contradiction Register — Order Confirmation / Paid Event Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C157 — order fulfilment confirmation contradicts the separate payment-state/evidence model by publishing store_order.paid

Current native order state exposes separate concepts:

```text
MarketplaceOrder.status
MarketplaceOrder.paymentStatus
```

Yet `StoreOrderService.updateOrderStatus(CONFIRMED)` changes only `status` and publishes `store_order.paid` even when `paymentStatus` remains PENDING or UNPAID.

Thus:

```text
operational order progression says CONFIRMED
while
payment projection says unpaid/pending
while
canonical event vocabulary says paid
```

and mounted listeners may create PAID financial descendants or start post-payment fulfilment.

Target resolution:

```text
OrderFulfilmentState
and
PaymentState / PaymentEvidence
remain separate axes;

store_order.paid is emitted only by a transition that proves payment under KF-REC-052,
with KF-REC-053 owning the order obligation/effect semantics.
```

A cash/manual “confirm payment” action, if desired, must be explicit rather than overloaded onto generic order confirmation.

Affected finding: F207.
Affected journeys: J10, J7, J3, J17.
Affected kernels: K6, K7, K8, K10.

No production implementation is authorized by this contradiction supplement.
