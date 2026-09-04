# KeyFlowOS Contradiction Register — Recovery Supplement

Status: CANONICAL CONTINUATION OF `09J-CONTRADICTION-REGISTER-EXTERNAL-OUTCOME-SUPPLEMENT.md`

Canonical sequence continues after C099.

---

## C100 — declared durable BullMQ retry vs failed idempotency record preventing a new effect attempt

**Status:** VERIFIED ACTIVE CONTRADICTION

BullMQ plan-step jobs are configured to retry after failure, but ActionDispatcher persists the failed idempotency key and later treats that failed record as an idempotent hit.

Therefore:

```text
queue truth: logical job has attempts remaining
execution truth: effect key already returns terminal stored failure
```

Target resolution: idempotency/effect identity must distinguish successful terminal consumption, retryable failed attempt and final failure.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## C101 — user-visible undo/recovery window vs process-local non-replicated eligibility state

**Status:** VERIFIED ACTIVE CONTRADICTION

UndoService exposes a five-minute undo window but stores eligibility only in process memory.

Thus the product concept is time-bounded durable recovery while the implementation concept is instance-local ephemeral memory.

Target resolution: where undo/compensation is a real product promise, persist the eligibility/provenance/state or explicitly scope the UX promise to what the infrastructure can guarantee.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## C102 — durable `compensated` claim vs handler semantics that may perform no inverse effect

**Status:** VERIFIED ACTIVE CONTRADICTION

Saga compensation currently treats a non-throwing handler as successful compensation.

But handlers may return early when required identifiers/services are unavailable, and message recall may only annotate local state even though the external provider effect is irreversible.

Therefore:

```text
saga truth: compensated
external/domain truth: inverse effect may be absent or impossible
```

Target resolution: compensation needs typed outcome evidence distinguishing requested, attempted, confirmed, unavailable, mitigated and failed states.

Affected kernels: K6, K8, K9, K11.
Affected journeys: J2, J18, J23.

---

## C103 — durable approval wait vs parent planner/saga terminalization as failure

**Status:** VERIFIED ACTIVE CONTRADICTION

KeyCortexPlanner persists the current step as `waiting_approval`, but computes parent final status from a stale pre-execution step snapshot and can therefore mark the enclosing plan and saga `failed`.

Thus:

```text
child truth: waiting for valid control
parent truth: failed
```

Target resolution: `AWAITING_CONTROL` must be a resumable parent/child workflow state derived from durable current state, with an explicit resume path after valid clearance.

Affected kernels: K3, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

## C104 — compensation outcome persisted by SagaService vs planner finalization overwriting it with generic failure

**Status:** VERIFIED ACTIVE CONTRADICTION

SagaService can persist `compensated`, `compensation_failed` or `compensation_unavailable` after recovery processing. The planner then invokes `failSaga()` and replaces that status with `failed`.

Thus:

```text
recovery truth: compensated | compensation_failed | compensation_unavailable
final saga truth: failed
```

Target resolution: original execution outcome and recovery/compensation outcome must remain orthogonal durable dimensions rather than competing for one status field.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J18, J23.

---

# Pool law

```text
RETRY POLICY
must agree with
IDEMPOTENCY TERMINALITY

PRODUCT RECOVERY PROMISE
must agree with
RECOVERY STATE DURABILITY

COMPENSATION CLAIM
must agree with
CONFIRMED RECOVERY EFFECT

CHILD WAIT STATE
must agree with
PARENT WORKFLOW STATE

EXECUTION FAILURE
must not erase
RECOVERY OUTCOME
```

No production implementation is authorized by this supplement.
