# KeyFlowOS Contradiction Register — Fulfilment Strategy-Descendant Idempotency Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C164 — fulfilment retry identity contradicts strategy-effect identity because route absence can be interpreted as effect absence after PurchaseOrder/PreOrder has already committed

For effectful fulfilment strategies, the business descendant can be persisted before the `FulfillmentRoute` row that `routeOrder()` later relies on as its retry/idempotency signal.

Observed shape:

```text
DROPSHIP: PurchaseOrder → FulfillmentRoute
PREORDER: PreOrder → FulfillmentRoute
```

If execution fails between those writes:

```text
business effect exists
+ route does not exist
```

but retry observes only the route side and may run the strategy again.

Thus:

```text
route absence
is interpreted as
effect absence
```

although the supplier/preorder obligation may already exist.

Target resolution:

```text
idempotency / reconciliation identity
= stable semantic StrategyEffectIdentity per required order-item fulfilment effect

retry:
  reconcile route + strategy-specific descendants against that identity
  repair/link safe orphan descendants
  create only genuinely missing effects
```

F211/C161 remains separate: it concerns a partial but non-empty route set suppressing missing item work. C164 concerns an auxiliary business descendant existing before the route guard itself.

Affected finding: F214.
Affected journeys: J10, J18, J23, J7.
Affected kernels: K11, K8, K9, K7, K6.

No production implementation is authorized by this contradiction supplement.
