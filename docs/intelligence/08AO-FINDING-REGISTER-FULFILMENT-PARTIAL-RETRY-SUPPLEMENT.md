# KeyFlowOS Finding Register — Fulfilment Partial-Retry Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F211 — fulfilment routing uses “any existing route” as an idempotency guard, so a partially-created route set can make retry skip required order items permanently

**Status:** VERIFIED REACHABLE RECOVERY / DESCENDANT-COMPLETENESS FINDING

`FulfillmentRoutingService.routeOrder()` is not one transaction across all order items. It loops over items and creates descendants strategy-by-strategy:

```text
for each order item:
  LOCAL_STOCK → FulfillmentRoute / reservation
  DROPSHIP    → PurchaseOrder + FulfillmentRoute
  PREORDER    → PreOrder + FulfillmentRoute
  HYBRID      → one of the above
  MANUAL      → FulfillmentRoute
  SERVICE     → FulfillmentRoute
```

A later item can throw after earlier item routes/descendants have already committed.

On retry, the first guard is effectively:

```text
existingRoutes = order.fulfillmentRoutes
if existingRoutes.length > 0:
  optionally advance order status
  return existingRoutes
```

It does not prove that every required `MarketplaceOrderItem` has a route, nor that every strategy-specific required descendant exists.

Reachable fault sequence:

```text
Order O has items I1, I2, I3
→ route I1 succeeds and persists R1
→ route I2 throws before R2 exists
→ listener emits routing_failed
→ retry routeOrder(O)
→ existingRoutes.length = 1
→ early return [R1]
→ I2 and I3 remain without required routes
```

The retry therefore converts a partial prior attempt into an apparent idempotent no-op.

### Distinct root

F209/C159 concerns an explicitly persisted FAILED route being reported as aggregate routed success.

F211/C161 concerns **missing required route descendants after partial failure**, where recovery cannot reconstruct the missing set because existence of any prior route is treated as completion.

This is a concrete J10 specialization of KF-REC-048/K11 recovery law:

```text
idempotency must converge required semantic effects
!= skip because any attempt artifact exists
```

### Target law

```text
RequiredRouteSet(order)
= one declared fulfilment obligation per required order item / split

retry/reconcile:
  compare RequiredRouteSet against ObservedRouteSet
  create/repair only missing or failed semantic effects
  never treat a non-empty partial set as complete
```

Strategy-specific descendants such as PurchaseOrder or PreOrder must share the same semantic effect identity so retries do not duplicate them while filling missing routes.

### Proof pressure

Future proof must inject failure after route 1 of N and demonstrate:

1. retry discovers missing order-item routes;
2. already-satisfied route effects are not duplicated;
3. missing PurchaseOrder/PreOrder/manual/service descendants are created exactly once;
4. aggregate fulfilment completion remains false until every required route reaches an acceptable state;
5. operator/recovery surfaces retain unresolved item identities across retries/restarts.

Affected kernels: K11, K8, K7, K6.
Affected journeys: J10, J18, J23, J17.

No production implementation is authorized by this supplement.
