# KeyFlowOS Finding Register — Fulfilment Strategy-Descendant Idempotency Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F214 — DROPSHIP/PREORDER routing can orphan an effectful strategy descendant before its FulfillmentRoute exists, so retry can create the same supplier/preorder obligation again

**Status:** VERIFIED REACHABLE STRATEGY-EFFECT / IDEMPOTENCY FINDING

`FulfillmentRoutingService.routeOrder()` uses persisted `FulfillmentRoute` rows as its primary retry/idempotency signal.

For effectful strategies, however, the route is not the first persisted descendant.

Observed DROPSHIP sequence:

```text
routeDropship(order, item, product)
→ create PurchaseOrder
→ create FulfillmentRoute(purchaseOrderId = created PurchaseOrder)
```

Observed PREORDER sequence:

```text
routePreorder(order, item, product)
→ create PreOrder
→ create FulfillmentRoute(preOrderId = created PreOrder)
```

Those strategy methods do not wrap the auxiliary descendant and its route in one shared transaction, and the retry entrance does not reconcile pre-existing PurchaseOrder/PreOrder descendants before deciding whether the strategy effect has already happened.

Reachable fault sequence:

```text
Order O / Item I requires DROPSHIP
→ PurchaseOrder PO1 commits
→ process fails before FulfillmentRoute R1 commits
→ retry routeOrder(O)
→ existing FulfillmentRoutes for I remain absent
→ routeDropship(I) runs again
→ PurchaseOrder PO2 can be created for the same semantic supplier obligation
```

The PREORDER path has the same shape with `PreOrder`.

`HYBRID` inherits this risk whenever it selects the DROPSHIP branch. `MANUAL` and `SERVICE` do not create the same auxiliary supplier/preorder descendant in the inspected strategy path and therefore are not evidence for this exact failure mode.

### Distinct root

F211/C161 concerns a **non-empty but incomplete FulfillmentRoute set** causing retry to skip missing item work.

F214/C164 concerns an earlier interruption boundary:

```text
strategy side effect exists
+ route used as retry guard does not yet exist
→ retry interprets route absence as effect absence
→ duplicate auxiliary obligation can be created
```

This is not merely an attempt-row duplication problem. PurchaseOrder and PreOrder are business-effect descendants that can drive supplier/customer obligations.

### Target law

```text
StrategyEffectIdentity
= stable semantic identity for the required fulfilment effect
  (business + order + order item/split + strategy + relevant revision)

execute/retry:
  reconcile StrategyEffectIdentity
  against route + strategy-specific descendants
  create missing descendants exactly once
  repair/link orphan descendants when safe
  never infer “effect absent” solely from FulfillmentRoute absence
```

Acceptable implementation mechanisms can include one atomic transaction where boundaries permit it, or an idempotent/reconciling effect owner with durable semantic uniqueness. The architecture law is exact-once convergence of the business obligation, not a requirement for one particular persistence mechanism.

### Consequence pressure

Without that law, retry can produce:

- duplicate supplier purchase obligations;
- duplicate preorder obligations;
- orphan PurchaseOrder/PreOrder rows disconnected from the route graph;
- misleading route/recovery state because the business side effect and the retry guard disagree;
- downstream financial, inventory, supplier and operator consequences that cannot be safely inferred from route existence alone.

### Proof pressure

Future proof must inject failure between auxiliary-descendant creation and route creation for every effectful strategy and demonstrate:

1. retry does not create a second semantic PurchaseOrder/PreOrder obligation;
2. an orphan but valid descendant can be rediscovered/reconciled to the required route;
3. ambiguous descendants are surfaced for recovery rather than guessed away;
4. HYBRID preserves the selected branch/effect identity across retry;
5. aggregate fulfilment state remains incomplete until the required route/effect relation is coherent;
6. restart/replay preserves the same semantic strategy-effect identity.

Affected kernels: K11, K8, K9, K7, K6.
Affected journeys: J10, J18, J23, J7 where supplier/preorder descendants gain financial consequences.

No production implementation is authorized by this supplement.
