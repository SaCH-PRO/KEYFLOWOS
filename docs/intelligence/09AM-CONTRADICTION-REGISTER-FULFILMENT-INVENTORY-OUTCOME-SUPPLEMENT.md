# KeyFlowOS Contradiction Register — Fulfilment Inventory / Outcome Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C158 — checkout stock consumption contradicts fulfilment stock reservation for the same order units

For a tracked storefront item, native paid checkout decrements `InventoryStock.quantity` and records a sale movement. The post-payment fulfilment path then re-reads the decremented stock and attempts to reserve the same ordered quantity by increasing `InventoryStock.reserved`.

Thus two independently-owned inventory transitions act on one order item without a shared allocation lineage:

```text
checkout: quantity -= Q
routing:  reserved += Q
```

A last-unit sale can therefore commit payment successfully and immediately appear unfulfillable because the route sees stock after the checkout decrement.

Target resolution:

```text
one inventory-allocation state machine
+ one semantic allocation identity per order item
→ reservation / commitment / consumption / release / restoration compose exactly once
```

Affected finding: F208.
Affected journeys: J10, J18.
Affected kernels: K6, K8, K11.

---

## C159 — persisted failed item routing contradicts the aggregate store_order.fulfillment_routed success event

A fulfilment strategy can persist and return `FulfillmentRoute.status=FAILED` without throwing. `StoreOrderRoutingListener` treats the normal return from `routeOrder()` as success and emits `store_order.fulfillment_routed`; it emits `store_order.routing_failed` only on exceptions.

Therefore:

```text
required route state = FAILED
while
aggregate event vocabulary = fulfillment_routed
```

and downstream CRM/contact semantics label the occurrence “Order routed to fulfillment.”

Target resolution:

```text
aggregate fulfilment outcome must be derived from required route outcomes,
not from whether the routing function returned normally
```

Partial/failed routing must carry the unresolved route identities and recovery consequence explicitly.

Affected finding: F209.
Affected journeys: J10, J18, J17, J23.
Affected kernels: K8, K11, K7, K6.

No production implementation is authorized by this contradiction supplement.
