# KeyFlowOS Finding Register — Fulfilment Inventory / Outcome Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F208 — native paid checkout, fulfilment reservation and shipment consumption compete for ownership of the same tracked-stock effect

**Status:** VERIFIED REACHABLE INVENTORY-EFFECT OWNERSHIP FINDING

The native successful storefront path in `StoreOrderService.completeCheckout()` performs tracked inventory consumption inside the paid-checkout transaction:

```text
InventoryStock.quantity := quantity - orderedQuantity
StockMovement(type='sale', quantityChange=-orderedQuantity)
```

After commit it emits `store_order.paid`.

`StoreOrderRoutingListener` consumes that event and calls `FulfillmentRoutingService.routeOrder()`.

For `LOCAL_STOCK`, `routeLocalStock()` then treats the same order item as still needing an inventory reservation:

```text
available = stock.quantity - stock.reserved
if available >= orderedQuantity:
  stock.reserved := stock.reserved + orderedQuantity
  FulfillmentRoute.status = RESERVED
else:
  FulfillmentRoute.status = FAILED
```

Thus the same economic units are represented twice immediately after payment:

```text
paid checkout:      on-hand quantity decreases by Q
fulfilment routing: reserved quantity increases by Q
```

Example:

```text
before sale: quantity=1 reserved=0
checkout Q=1: quantity=0 reserved=0
routing: available=0-0=0 < 1
→ route FAILED
```

The sale can therefore commit successfully while its immediate fulfilment route reports insufficient stock because checkout already consumed the units routing expects to reserve.

The later shipment path confirms that ownership conflict extends beyond reservation. `MarketplaceService.fulfillOrder(..., 'ship')` finds LOCAL_STOCK routes in `RESERVED`, calls `decrementInventoryOnShip()`, and only then advances the route to `SHIPPED`.

`decrementInventoryOnShip()` performs:

```text
quantity := max(0, quantity - Q)
reserved := max(0, reserved - Q)
```

So where routing did succeed, the same native paid storefront order can follow:

```text
checkout: quantity -= Q
routing:  reserved += Q
shipping: quantity -= Q; reserved -= Q
```

This applies two on-hand decrements to one sale lifecycle.

Correction paths also expose the same missing ownership law:

- `cancel` releases reservation and marks routes cancelled, but does not restore the paid-checkout on-hand decrement;
- `refund` changes order/payment projection to REFUNDED but does not restore tracked stock in that action;
- Store Orders refund handling therefore cannot infer the inventory correction merely from the order status label.

### Distinct root

This is not merely a low-stock notification defect or a generic recovery failure. It is conflicting ownership of the inventory effect for one order occurrence:

```text
checkout/payment boundary owns sale decrement
fulfilment-routing boundary owns reservation
shipment boundary owns another consumption decrement
cancel/refund boundaries do not share one restoration lineage
```

without one stock-allocation state machine defining reservation, commitment, consumption, release and restoration.

### Target law

```text
ONE ORDER ITEM INVENTORY OBLIGATION
→ one allocation lineage/effect identity
→ reserve / commit / consume / release / restore according to one policy
→ every transition is exact-once and correction-aware
→ the same quantity is never consumed twice
```

Potential target sequences include, depending on policy:

```text
reserve at order/commit → convert reservation to shipped/sold decrement
```

or

```text
decrement at paid sale → fulfilment references already-consumed allocation without reserving/decrementing again
```

The architecture finding does not choose business inventory policy yet; it requires one owner and one coherent transition algebra.

### Proof pressure

Future proof must include:

1. last-unit successful sale remains fulfilment-eligible when policy allows it;
2. one paid order cannot independently decrement at checkout and again at ship;
3. one paid order cannot both consume and reserve the same units as unrelated effects;
4. retries/re-routing cannot increase `reserved` repeatedly;
5. ship retry cannot decrement on-hand repeatedly if route-status persistence fails after the stock mutation;
6. cancellation/refund/return releases/restores exactly the inventory effect actually applied;
7. backorder/untracked/virtual modes remain explicit and do not inherit tracked-stock invariants accidentally.

Affected kernels: K6, K8, K11.
Affected journeys: J10, J18, J7.

---

## F209 — fulfilment routing emits aggregate success even when one or more item routes are persisted FAILED

**Status:** VERIFIED REACHABLE OUTCOME-COMPLETENESS FINDING

`FulfillmentRoutingService.routeLocalStock()` handles insufficient tracked inventory by creating and returning a normal `FulfillmentRoute` with:

```text
status = FAILED
notes = Insufficient stock...
```

It does not throw.

`routeOrder()` collects the returned route and returns the route list. The caller `StoreOrderRoutingListener.onStoreOrderPaid()` interprets successful function return as aggregate routing success and emits:

```text
store_order.fulfillment_routed
```

It emits `store_order.routing_failed` only when `routeOrder()` throws an exception.

Therefore:

```text
per-item FulfillmentRoute = FAILED
while
aggregate event = store_order.fulfillment_routed
```

The shared contact-event label renders that aggregate event as **“Order routed to fulfillment.”**

The emitted payload includes strategies and routeCount but not route status/failure completeness, so downstream consumers cannot infer the failed item from the aggregate event alone.

The inverse exception path also has an evidence-label problem: `CrmRevenueEventListener.onRoutingFailed()` persists the thrown `store_order.routing_failed` occurrence under contact-event type `store_order.fulfillment_routed` with `{ failed: true }`. Thus even the explicit failure event is stored under the success event identity in CRM history.

A separate `RevenueActionService` subscriber does create an operator-action seam for thrown `routing_failed` exceptions. That is important positive evidence. However persisted business-outcome failures such as `FulfillmentRoute.status=FAILED` do not throw and therefore bypass that recovery trigger entirely.

### Distinct root

F209 is separate from F208. F208 can cause a route failure, but any strategy that returns a persisted FAILED route without throwing can trigger the F209 false-success semantics.

This is also a specialization of mature K8/K11 laws:

```text
process returned != required outcome satisfied
```

but the distinct J10 root is the **aggregate fulfilment contract itself classifying partial/failed route sets as `fulfillment_routed`.**

### Target law

```text
aggregate fulfilment outcome
= function(per-route required outcomes)
```

Candidate target semantics:

```text
FULFILMENT_ROUTED_COMPLETE
FULFILMENT_ROUTED_PARTIAL
FULFILMENT_BLOCKED / FAILED
```

or equivalent typed outcome evidence. Exact enum is not frozen.

A route creation attempt is not sufficient evidence that fulfilment routing succeeded.

### Proof pressure

1. any required route in FAILED state prevents an unqualified aggregate-success event;
2. partial success carries failed-route identities and required recovery work;
3. routing failure becomes durable/recoverable/projectable under K11/K7 where fulfilment remains required;
4. CRM/operator/AI consumers cannot receive “routed” evidence when required routes failed;
5. thrown and persisted failure representations converge on the same semantic recovery surface without changing failure into a success event type;
6. retries converge on the same route/effect identities.

Affected kernels: K8, K11, K7, K6.
Affected journeys: J10, J18, J17, J23.

No production implementation is authorized by this supplement.
