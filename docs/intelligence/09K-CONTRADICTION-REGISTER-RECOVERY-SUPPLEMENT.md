# KeyFlowOS Contradiction Register — Recovery Supplement

Status: CANONICAL CONTINUATION OF `09J-CONTRADICTION-REGISTER-EXTERNAL-OUTCOME-SUPPLEMENT.md`

Canonical sequence continues after C099.

---

## C100 — declared durable BullMQ retry vs failed idempotency record preventing a new effect attempt

**Status:** VERIFIED ACTIVE CONTRADICTION

BullMQ plan-step jobs are configured to retry after failure, but ActionDispatcher persists the failed idempotency key and later treats that failed record as an idempotent hit.

```text
queue truth: logical job has attempts remaining
execution truth: effect key already returns terminal stored failure
```

---

## C101 — user-visible undo/recovery window vs process-local non-replicated eligibility state

**Status:** VERIFIED ACTIVE CONTRADICTION

UndoService exposes a five-minute undo window but stores eligibility only in process memory.

---

## C102 — durable `compensated` claim vs handler semantics that may perform no inverse effect

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
saga truth: compensated
external/domain truth: inverse effect may be absent or impossible
```

---

## C103 — durable approval wait vs parent planner/saga terminalization as failure

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
child truth: waiting for valid control
parent truth: failed
```

---

## C104 — compensation outcome persisted by SagaService vs planner finalization overwriting it with generic failure

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
recovery truth: compensated | compensation_failed | compensation_unavailable
final saga truth: failed
```

---

## C105 — confirmed provider refund vs local payment/ledger/invoice truth split by manual refund dedupe

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
provider truth: refund confirmed
payment-row truth: REFUNDED
ledger truth: original posting may remain unreversed
invoice truth: may remain paid/unreconciled
webhook repair: suppressed as duplicate
```

---

## C106 — operator-visible payment “retry” vs absence of executable provider recovery work

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
operator/API truth: retry initiated
local row truth: PENDING
execution truth: no observed provider retry owner
```

---

## C107 — plan-level re-execution vs step-level confirmed-success preservation

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
step truth: previously succeeded
recovery intent: continue/repair unresolved plan
planner behavior: execute successful step again
```

---

## C108 — confirmed PayPal capture vs catch-path persistence of local payment failure

**Status:** VERIFIED ACTIVE CONTRADICTION

`capturePaypalOrder()` can receive a provider-confirmed `COMPLETED` capture, then fail while persisting the local Payment row. The broad catch records a synthetic `FAILED` payment and throws a capture failure.

```text
provider truth: capture completed
local consequence truth: persistence failed
catch-path truth: payment failed
```

The synthetic failure row also does not preserve the PayPal order/capture lineage used by the webhook fallback resolver, so later provider evidence may be unable to repair the local contradiction.

Target resolution: once provider success is known, represent the state as confirmed external success with incomplete local consequences and preserve provider lineage for reconciliation.

Affected kernels: K8, K9, K10, K11.
Affected journeys: payment/commerce journeys, J14, J18, J23.

---

## C109 — provider-successful OutboundDelivery vs local retry/failure state after post-provider persistence error

**Status:** VERIFIED ACTIVE CONTRADICTION

`DeliveryQueueService.executeDelivery()` wraps provider publish and later local persistence in the same catch boundary.

If the provider call returns success and a later local database/evidence operation throws, that local error is normalized as an adapter error and can transition the durable delivery to `RetryPending` or `Failed`.

```text
provider truth: published/accepted successfully
local recovery truth: RetryPending | Failed
next scheduler action: provider may be called again
```

Target resolution: separate provider-call failure from post-provider consequence failure. Confirmed provider success must transition to reconciliation/consequence repair, never generic execution retry.

Affected kernels: K8, K9, K11.
Affected journeys: outbound communication/content journeys, J14, J18, J23.

---

# Pool law

```text
RETRY POLICY must agree with IDEMPOTENCY TERMINALITY
PRODUCT RECOVERY PROMISE must agree with RECOVERY STATE DURABILITY
COMPENSATION CLAIM must agree with CONFIRMED RECOVERY EFFECT
CHILD WAIT STATE must agree with PARENT WORKFLOW STATE
EXECUTION FAILURE must not erase RECOVERY OUTCOME
PROVIDER FINANCIAL REVERSAL must converge PAYMENT + LEDGER + INVOICE TRUTH
RETRY VERB must correspond to EXECUTABLE RECOVERY WORK
PARENT RESUME must preserve CONFIRMED CHILD TERMINALITY
CONFIRMED PROVIDER SUCCESS must not regress into PROVIDER FAILURE because a local consequence failed
POST-PROVIDER LOCAL FAILURE must not authorize DUPLICATE EXTERNAL EFFECT
```

No production implementation is authorized by this supplement.
