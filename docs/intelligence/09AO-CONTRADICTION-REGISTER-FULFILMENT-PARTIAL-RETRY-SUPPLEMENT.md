# KeyFlowOS Contradiction Register — Fulfilment Partial-Retry Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C161 — fulfilment retry idempotency contradicts required-route completeness by treating any existing route as completion

`FulfillmentRoutingService.routeOrder()` can persist routes incrementally across order items. If a later strategy throws, prior routes remain committed.

On the next call, however:

```text
existingRoutes.length > 0
→ return existingRoutes
```

without proving that each required order item has a route or required strategy descendant.

Thus:

```text
partial prior effect set
is interpreted as
complete idempotent effect set
```

and missing fulfilment obligations can survive retry permanently.

Target resolution:

```text
idempotency identity = semantic required route/effect identity per order item/split
retry = reconcile required vs observed descendant set
```

not “skip if any child row exists.”

Affected finding: F211.
Affected journeys: J10, J18, J23, J17.
Affected kernels: K11, K8, K7, K6.

No production implementation is authorized by this contradiction supplement.
