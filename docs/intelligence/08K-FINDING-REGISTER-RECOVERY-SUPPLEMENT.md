# KeyFlowOS Finding Register — Recovery Supplement

Status: CANONICAL CONTINUATION OF `08J-FINDING-REGISTER-EXTERNAL-OUTCOME-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F149.

---

## F150 — Failed ActionDispatcher idempotency evidence defeats subsequent BullMQ retries for the same plan-step effect

**Status:** VERIFIED CROSS-LAYER / RECOVERY-SEMANTICS FINDING

AI plan-step queue jobs are configured with BullMQ attempts/backoff and reuse a stable plan-step idempotency key.

`ActionDispatcher.dispatch()` also performs inline retries. After its retry budget is exhausted it writes a failed `AiExecutionLog` containing the same idempotency key.

On the next BullMQ attempt, `ActionDispatcher.findIdempotentExecution()` finds that failed log and returns the stored failure immediately:

```text
BullMQ attempt 1
→ ActionDispatcher inner attempts exhaust
→ AiExecutionLog(success=false, idempotencyKey=K)
→ throw to BullMQ
→ BullMQ schedules attempt 2 with K
→ ActionDispatcher sees existing K
→ returns previous failure
→ no new business-effect attempt occurs
```

Thus:

```text
BullMQ policy: RETRYABLE
ActionDispatcher idempotency policy: FAILURE ALREADY RESOLVED
```

The outer durable retry policy is effectively defeated by a failed idempotency tombstone.

Target law:

> Stable effect identity must survive retries, but failed attempt evidence must not masquerade as terminal successful consumption of the effect identity when retry policy says the logical work remains alive.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## F151 — UndoService compensation eligibility is process-local and disappears across restart or another replica

**Status:** VERIFIED CODE-LEVEL / RECOVERY-DURABILITY FINDING

`UndoService.registerAction()` stores undoable actions in an in-memory `Map` and removes them with a five-minute process-local `setTimeout`.

No durable undo record is written for eligibility/provenance before the action is exposed as undoable.

Consequences:

- process restart loses all currently undoable actions;
- horizontally scaled replicas do not share undo eligibility;
- a request routed to another replica may not see the undo action;
- the five-minute recovery window is not durable business state.

Undo is also effect-specific: sent messages cannot be unsent and return `noted_for_review`; completed/confirmed bookings may not be undoable.

Target law:

```text
UNDO UX
!= ROLLBACK
!= RETRY
!= COMPENSATION
```

Where recovery/compensation eligibility is a promised business capability, its identity, window, state and evidence must survive the infrastructure topology required by that promise.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

# Reused recovery findings — do not duplicate

J18 also relies directly on F050/F051, F097, F122/F123, F127, F136 and F137–F149.

---

# Pool law

```text
EFFECT IDENTITY
!= TERMINAL SUCCESS MARKER

FAILED ATTEMPT EVIDENCE
!= RETRY EXHAUSTION

UNDO ELIGIBILITY
must match the durability/scalability of the user-visible promise
```

No production implementation is authorized by this supplement.
