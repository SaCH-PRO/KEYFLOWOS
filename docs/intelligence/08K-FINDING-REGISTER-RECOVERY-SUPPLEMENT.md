# KeyFlowOS Finding Register — Recovery Supplement

Status: CANONICAL CONTINUATION OF `08J-FINDING-REGISTER-EXTERNAL-OUTCOME-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`

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

## F152 — Saga compensation success is inferred from a non-throwing handler, allowing no-op or non-reversing recovery to be recorded as `compensated`

**Status:** VERIFIED CODE-LEVEL / OUTCOME-EVIDENCE FINDING

`KeyCortexSagaService.compensate()` marks a step `compensated` whenever `KeyCortexCompensationService.compensate()` returns without throwing.

`KeyCortexCompensationService.compensate()` likewise reports `{ compensated: true }` when the registered handler returns normally.

Several compensation handlers can return early when required identifiers or optional services are unavailable. More importantly, outbound-message compensation maps a send to `communications.recall_message`, whose handler marks local message/timeline state but cannot retract a provider-delivered external message.

Therefore current durable state can compress materially different realities:

```text
compensation handler invoked
→ no exception
→ SagaStep.status = compensated

possible reality:
  actual inverse domain effect happened
OR handler no-op because effect identifier missing
OR local annotation happened while external effect remains
```

Target law:

```text
COMPENSATION REQUESTED
!= COMPENSATION ATTEMPTED
!= COMPENSATION EFFECT CONFIRMED
```

Irreversible external effects may be mitigated, annotated or followed by a compensating action; they must not be represented as if the original effect were undone.

Affected kernels: K6, K8, K9, K11.
Affected journeys: J2, J18, J23.

---

## F153 — KeyCortex planner persists a legitimate approval wait but can terminalize its parent plan/saga as `failed` from stale in-memory step state

**Status:** VERIFIED CODE-LEVEL / CONTROL-WAIT RECOVERY FINDING

`KeyCortexExecutorService.execute()` deliberately returns a non-success result carrying `approvalStatus` when control is required.

`KeyCortexPlannerService.executePlan()` recognizes that condition, updates the current `AiPlanStep` to `waiting_approval`, and stops further execution.

However the plan's final status is computed from the `plan.steps` array that was loaded before execution:

```text
stopped
→ plan.steps.some(step.status === 'waiting_approval')
→ otherwise failed
```

The database update does not mutate that preloaded step object. Therefore a newly-created approval wait is not visible to this final-status calculation and the plan falls through to `failed`; the enclosing saga is then failed too.

Verified chain:

```text
control required
→ executor returns approval pending
→ DB AiPlanStep = waiting_approval
→ stale loaded plan.steps retains prior status
→ AiPlan = failed
→ SagaExecution = failed
```

This is distinct from the earlier DelegationLoop false-completion defect: here a valid control wait is compressed into failure.

Target law:

> `AWAITING_CONTROL` is a resumable logical-work state. Parent workflow state must derive from durable current child state, not a stale pre-execution snapshot.

Affected kernels: K3, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

## F154 — Planner finalization overwrites saga compensation outcome with generic `failed`, erasing whether recovery succeeded, failed or was unavailable

**Status:** VERIFIED CODE-LEVEL / RECOVERY-EVIDENCE LOSS FINDING

On a failed plan step, `KeyCortexPlannerService.executePlan()` calls `saga.compensate(saga.id)`.

`KeyCortexSagaService.compensate()` computes and persists one of:

```text
compensated
compensation_failed
compensation_unavailable
```

After the plan loop, the planner derives final plan status `failed` and then calls `saga.failSaga(saga.id)`, which overwrites the same `SagaExecution.status` with plain `failed`.

Therefore:

```text
step failure
→ compensation attempt
→ SagaExecution = compensated | compensation_failed | compensation_unavailable
→ planner finalization
→ SagaExecution = failed
```

Step-level compensation records may remain, but the saga-level recovery classification is lost.

Target law:

> Failure and recovery outcome are orthogonal dimensions. Finalization must preserve whether compensation/reversal was attempted and what its confirmed result was.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J18, J23.

---

# Reused / strengthened findings — do not duplicate

## F149 — strengthened by OutboundDelivery retry tracing

`OutboundDelivery` is a stronger local seam than ad-hoc sends: stable delivery identity, expected-state `Sending` claim, retry count/backoff, provider IDs/result snapshots and durable `DeliveryEvent` attempts are present.

But its adapter contract still reduces failures to `success` / `isTransient`; no first-class `OUTCOME_UNKNOWN` or provider effect/idempotency identity is required. Transient network errors can therefore schedule another provider call even when the previous request may already have crossed the external point of no return.

Manual `retry` and `retryAllFailed` also requeue the same durable delivery identity without first distinguishing confirmed failure from ambiguous external outcome.

This reinforces F149 / KF-REC-037; do not create a duplicate external-uncertainty finding.

## F144 — revalidated

`TransactionalEmailService.drainQueue()` still selects `QUEUED` rows without an atomic drain claim and calls `send()` without preserving the queued row's original `messageId` as `dedupeKey`. F144 remains the canonical root.

## F122 / F123 — revalidated and producer breadth strengthened

`ScheduledAgentJob` still has no atomic generic execution claim in `CrossModuleAgentService.processScheduledJobs()`. Generic execution failure becomes `FAILED` with no generic retry/dead-letter consumer observed in this pass.

Multiple live producers also create job types outside the three types handled by `executeScheduledJob()`, including `lead_magnet_enroll`, `review_solicitation`, and `abandoned_cart_recovery`; the generic consumer logs an unknown type and then returns normally, allowing the caller to mark it `COMPLETED`. This strengthens the existing routing/false-completion root rather than creating another finding.

---

# Positive recovery seams to preserve

- BullMQ stable job identity, delayed work, retry/backoff, worker locks and stalled recovery;
- ActionDispatcher as the central effect seam to strengthen rather than replace;
- OutboundDelivery stable durable identity, expected-state claim, attempt events, backoff and operator retry UI;
- SagaExecution/SagaStep durable step history and compensation metadata where correctly wired;
- quote follow-up cancellation + current-source-state revalidation;
- typed delivery/event histories as inputs to a future operator recovery projection.

---

# Pool law

```text
EFFECT IDENTITY
!= TERMINAL SUCCESS MARKER

FAILED ATTEMPT EVIDENCE
!= RETRY EXHAUSTION

UNDO ELIGIBILITY
must match the durability/scalability of the user-visible promise

COMPENSATION ATTEMPT
!= CONFIRMED INVERSE EFFECT

CONTROL WAIT
!= FAILURE

FAILURE OUTCOME
and
RECOVERY OUTCOME
must both remain durable
```

No production implementation is authorized by this supplement.
