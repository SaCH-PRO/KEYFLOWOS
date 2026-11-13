# KeyFlowOS Finding Register — Order Confirmation / Paid Event Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F207 — operational order confirmation emits financial payment-completion semantics while the separate order payment state can remain unpaid

**Status:** VERIFIED REACHABLE ORDER/PAYMENT STATE-ALGEBRA FINDING

`MarketplaceOrder` exposes at least two distinct current-state axes:

```text
status         — order / fulfilment progression
paymentStatus  — payment projection
```

The native storefront creates orders as:

```text
status = PENDING
paymentStatus = PENDING for CASH
             or UNPAID otherwise
```

The authenticated Store Orders UI presents an ordinary order progression:

```text
pending → confirmed → processing → shipped → delivered
```

and the button from a pending order calls the protected order-status endpoint with `CONFIRMED`.

`StoreOrderService.updateOrderStatus()` then performs only:

```text
MarketplaceOrder.status = CONFIRMED
```

It does not update or validate `paymentStatus`.

But its event map declares:

```text
CONFIRMED → store_order.paid
```

Therefore a reachable state is:

```text
MarketplaceOrder.status = CONFIRMED
MarketplaceOrder.paymentStatus = PENDING or UNPAID
while
store_order.paid has been emitted
```

Mounted consumers interpret `store_order.paid` as actual payment/commercial completion. In particular:

- `CommerceIntegrationService.handleOrderPaid()` can create a `PAID` Invoice and paid/customer timeline semantics;
- `StoreOrderRoutingListener` treats the event as the trigger to route fulfilment;
- other registered event consumers can observe the same paid semantic.

This can produce contradictory truth such as:

```text
Order paymentStatus = UNPAID/PENDING
+ store_order.paid occurrence
+ PAID Invoice descendant
+ fulfilment routing started
```

without the `completeCheckout()` Payment + ledger transaction having occurred.

### Why this is distinct from existing roots

This finding reuses:

- F187/C137 — financial state stronger than proven payment effect;
- F193/C143 — financial writer-bypass pressure;
- F196/C146 — competing Invoice state transitions;
- KF-REC-052 — financial-truth layer ownership;
- KF-REC-053 — commercial state/obligation semantics.

Its distinct J10 root is **state-algebra conflation between operational order confirmation and payment completion despite an explicitly separate payment-status axis**. The defect originates before any specific paid-event consumer.

### Target law

```text
OrderFulfilmentState transition
!= PaymentCompletion evidence

store_order.paid
MUST require declared payment evidence / canonical payment transition
NOT merely OrderStatus = CONFIRMED
```

If a business intentionally uses “confirm cash order” to mean “cash received,” that must be an explicit capability/transition that records the required payment evidence and financial consequence; it cannot be inferred from a generic fulfilment-state button.

### Proof pressure

Future proof must demonstrate:

1. every `store_order.paid` publisher proves the declared payment precondition;
2. `CONFIRMED` can be reached without manufacturing payment truth when confirmation is operational only;
3. cash/manual settlement uses an explicit payment-recording capability if it is meant to establish payment;
4. order payment projection, Invoice/Payment/ledger descendants and paid events converge after the canonical payment transition;
5. paid-event consumers cannot convert an unpaid order into downstream financial truth accidentally.

Affected kernels: K6, K8, K10, K7.
Affected journeys: J10, J7, J3, J17.

No production implementation is authorized by this supplement.
