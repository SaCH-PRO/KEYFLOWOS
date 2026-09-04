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

# Pool law

```text
RETRY POLICY
must agree with
IDEMPOTENCY TERMINALITY

PRODUCT RECOVERY PROMISE
must agree with
RECOVERY STATE DURABILITY
```

No production implementation is authorized by this supplement.
