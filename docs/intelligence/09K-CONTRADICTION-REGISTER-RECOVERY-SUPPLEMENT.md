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

Target resolution: idempotency/effect identity must distinguish successful terminal consumption, retryable failed attempt and final failure.

---

## C101 — user-visible undo/recovery window vs process-local non-replicated eligibility state

**Status:** VERIFIED ACTIVE CONTRADICTION

UndoService exposes a five-minute undo window but stores eligibility only in process memory.

Target resolution: where undo/compensation is a real product promise, eligibility/provenance/state must match the required process/replica durability.

---

## C102 — durable `compensated` claim vs handler semantics that may perform no inverse effect

**Status:** VERIFIED ACTIVE CONTRADICTION

Saga compensation treats a non-throwing handler as successful compensation, while handlers may no-op or perform mitigation-only work.

```text
saga truth: compensated
external/domain truth: inverse effect may be absent or impossible
```

Target resolution: typed recovery evidence must distinguish requested, attempted, confirmed, unavailable, mitigated and failed.

---

## C103 — durable approval wait vs parent planner/saga terminalization as failure

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
child truth: waiting for valid control
parent truth: failed
```

Target resolution: `AWAITING_CONTROL` must be a resumable parent/child workflow state derived from durable current state.

---

## C104 — compensation outcome persisted by SagaService vs planner finalization overwriting it with generic failure

**Status:** VERIFIED ACTIVE CONTRADICTION

```text
recovery truth: compensated | compensation_failed | compensation_unavailable
final saga truth: failed
```

Target resolution: original execution outcome and recovery outcome remain orthogonal durable dimensions.

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

Target resolution: external effect dedupe must still allow idempotent completion of missing local consequences.

---

## C106 — operator-visible payment “retry” vs absence of executable provider recovery work

**Status:** VERIFIED ACTIVE CONTRADICTION

The Commerce API exposes a payment retry action and changes a `FAILED` Payment to `PENDING`, but the inspected mutation does not initiate a provider operation or create durable recovery work, and no generic consumer for that newly-pending row was observed in this pass.

```text
operator/API truth: retry initiated
local row truth: PENDING
execution truth: no observed provider retry owner
```

Target resolution: recovery verbs and states must identify the actual recovery occurrence/owner. If an action only repairs bookkeeping state, it must be named/evidenced as such rather than represented as executable retry.

Affected kernels: K7, K8, K9, K10, K11.
Affected journeys: commerce/payment journeys, J18, J23.

---

## C107 — plan-level re-execution vs step-level confirmed-success preservation

**Status:** VERIFIED ACTIVE CONTRADICTION

The live KeyCortex plan execute endpoint can run a stored plan again. `executePlan()` resets the plan to `running`, starts a new saga and executes all stored steps without filtering already-completed steps.

```text
step truth: previously succeeded
recovery intent: continue/repair unresolved plan
planner behavior: execute successful step again
```

Target resolution: recovery/resume must preserve per-step terminal truth and continue the same logical occurrence. Confirmed-success steps may only execute again under an explicit new-effect policy, not as an accidental consequence of parent re-execution.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

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
```

No production implementation is authorized by this supplement.
