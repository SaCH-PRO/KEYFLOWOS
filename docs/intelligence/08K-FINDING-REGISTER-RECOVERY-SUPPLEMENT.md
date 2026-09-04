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

Thus the outer durable retry policy is effectively defeated by a failed idempotency tombstone.

Target law: failed attempt evidence must not masquerade as terminal consumption of a live effect identity.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## F151 — UndoService compensation eligibility is process-local and disappears across restart or another replica

**Status:** VERIFIED CODE-LEVEL / RECOVERY-DURABILITY FINDING

`UndoService.registerAction()` stores undoable actions in an in-memory `Map` and removes them with a five-minute process-local `setTimeout`.

Restart/replica change can therefore lose promised undo eligibility. The semantic issue is broader: `UNDO != RETRY != ROLLBACK != REVERSAL != COMPENSATION`.

Target law: recovery/compensation rights that matter across process boundaries require durable effect-specific evidence.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## F152 — Saga compensation success is inferred from a non-throwing handler, allowing no-op or non-reversing recovery to be recorded as `compensated`

**Status:** VERIFIED CODE-LEVEL / OUTCOME-EVIDENCE FINDING

`KeyCortexSagaService.compensate()` marks a step `compensated` whenever `KeyCortexCompensationService.compensate()` returns without throwing.

Several handlers can return early when required identifiers/services are unavailable. Outbound-message compensation can only annotate/mitigate a sent message, not retract the provider effect.

```text
COMPENSATION REQUESTED
!= COMPENSATION ATTEMPTED
!= COMPENSATION EFFECT CONFIRMED
```

Affected kernels: K6, K8, K9, K11.
Affected journeys: J2, J18, J23.

---

## F153 — KeyCortex planner persists a legitimate approval wait but can terminalize its parent plan/saga as `failed` from stale in-memory step state

**Status:** VERIFIED CODE-LEVEL / CONTROL-WAIT RECOVERY FINDING

`KeyCortexPlannerService.executePlan()` updates the current `AiPlanStep` to `waiting_approval`, then derives final parent status from the `plan.steps` array loaded before execution. The durable update is therefore invisible to that snapshot.

Possible result:

```text
AiPlanStep = waiting_approval
AiPlan = failed
SagaExecution = failed
```

Target law: `AWAITING_CONTROL` is resumable logical work, not failure.

Affected kernels: K3, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

## F154 — Planner finalization overwrites saga compensation outcome with generic `failed`, erasing whether recovery succeeded, failed or was unavailable

**Status:** VERIFIED CODE-LEVEL / RECOVERY-EVIDENCE LOSS FINDING

`KeyCortexSagaService.compensate()` can persist `compensated`, `compensation_failed` or `compensation_unavailable`. The planner later calls `failSaga()` and overwrites the saga header with plain `failed`.

Target law: original execution outcome and recovery outcome are orthogonal durable dimensions.

Affected kernels: K6, K8, K11.
Affected journeys: J2, J18, J23.

---

## F155 — Provider-backed manual refunds can succeed externally while permanently bypassing local ledger reversal and invoice reconciliation

**Status:** VERIFIED CROSS-LAYER / FINANCIAL-RECOVERY FINDING

`PaymentsOpsService.refundCharge()` performs a real Stripe/PayPal refund and best-effort creates a negative `Payment` with the provider refund ID, but does not invoke the ledger-reversal or invoice-reconciliation seams.

The later provider refund webhook has those stronger consequences, but first returns when that provider refund ID already exists. Thus the manual row can suppress its own repair path.

```text
provider = refunded
Payment = REFUNDED
ledger = original posting may remain
invoice = may remain paid/unreconciled
```

Target law: effect dedupe must suppress duplicate external effect, not missing consequences of the same known effect.

Affected kernels: K8, K9, K10, K11.
Affected journeys: commerce/payment journeys, J14, J18, J23.

---

## F156 — Commerce “retry failed payment” changes local status to `PENDING` without an observed provider retry or recovery owner

**Status:** VERIFIED CODE-LEVEL + SEARCH-SCOPED RECOVERY-SURFACE FINDING

The authenticated Commerce API exposes:

```text
POST businesses/:businessId/payments/:paymentId/retry
```

`CommerceService.retryPayment()` verifies that the current row is `FAILED`, then only:

```text
Payment.status = PENDING
→ optional CRM timeline event: invoice.payment_retry_initiated
→ return updated row
```

No provider charge/capture/payment-link operation is invoked by this method. Repository search in this pass found no generic worker/consumer that treats an existing `Payment.status=PENDING` row produced by this method as executable provider work.

Therefore the operator-facing recovery verb can create local state suggesting a retry is pending without establishing:

- an EffectId / new AttemptId;
- a provider operation;
- queue/work owner;
- next eligible time;
- retry budget;
- external outcome certainty;
- terminal recovery evidence.

This is not merely a missing UI label. The API mutation itself encodes a recovery claim without recovery execution ownership.

Target law:

> A recovery command must either create/claim executable recovery work or state explicitly that it is only a bookkeeping/status repair. `PENDING` must not imply an external retry exists when no recovery owner exists.

Affected kernels: K7, K8, K9, K10, K11.
Affected journeys: commerce/payment journeys, J18, J23.

---

## F157 — Re-executing a stored KeyCortex plan can replay already-completed steps instead of resuming only unresolved work

**Status:** VERIFIED CROSS-LAYER / OPERATOR-RECOVERY FINDING

The live HTTP surface exposes:

```text
POST /api/v1/cortex/plans/:planId/execute
```

and repository system mapping records this route as called by the web application.

`KeyCortexPlannerService.executePlan(planId)`:

1. loads the plan with all stored steps;
2. unconditionally sets the parent plan status to `running`;
3. starts a new saga;
4. topologically sorts **all** stored steps;
5. loops through every step and sets it `running` before executing it.

The loop does not exclude steps already persisted as `completed`, nor does the entrypoint require the plan to be in a specifically resumable state.

Therefore a second execute call against a partially failed, waiting, or even already executed plan can create a fresh saga and re-run previously successful business effects.

Recovery topology:

```text
step A succeeded
step B failed
plan retained
operator/user invokes execute again
→ new SagaExecution
→ step A set running again
→ step A business effect may execute again
→ step B then executes
```

Whether a particular repeated effect duplicates externally depends on downstream idempotency, but the workflow layer itself does not preserve “resume unresolved work on the same logical occurrence” semantics.

Target law:

> Resume/retry must continue the same logical WorkOccurrence and must not replay confirmed-success descendants unless the target recovery policy explicitly creates a new effect. Parent re-execution is not a substitute for per-step recovery state.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

# Reused / strengthened findings — do not duplicate

## F149 — strengthened by OutboundDelivery retry tracing

`OutboundDelivery` preserves stable delivery identity, atomic-ish expected-state `Sending` claim, retry/backoff and durable `DeliveryEvent` attempts. But `success/isTransient` lacks first-class `OUTCOME_UNKNOWN`, so manual/automatic retry remains unsafe where prior external effect may exist.

## F144 — revalidated

`TransactionalEmailService.drainQueue()` still lacks an atomic drain claim and drops the queued row's original dedupe/effect identity when replaying `send()`.

## F122 / F123 — revalidated and producer breadth strengthened

`ScheduledAgentJob` still lacks a generic atomic execution claim/recovery owner, and live producer job-type breadth exceeds the generic consumer's routing set. Unknown work can be falsely completed.

## F127 — operator-recovery implication strengthened

`WebhookEvent` first-seen identity remains a useful ingress occurrence seam, but no processing lifecycle/repair surface was observed that lets a failed-after-claim event resume safely.

---

# Positive recovery seams to preserve

- BullMQ stable job identity, delayed work, retry/backoff, locks and stalled recovery;
- ActionDispatcher as central effect seam;
- OutboundDelivery + DeliveryEvent and its explicit operator retry surface;
- SagaExecution/SagaStep durable history;
- `CommerceService.markPaymentRefunded()` + ledger reversal transaction;
- provider refund webhook `createRefundWithPosting()` + invoice reconciliation;
- quote-followup cancellation + source-state revalidation;
- AI action queue as an observability source, while separating it from recovery ownership;
- typed histories as inputs to Temporal Work Projection.

---

# Pool law

```text
EFFECT IDENTITY != TERMINAL SUCCESS MARKER
FAILED ATTEMPT EVIDENCE != RETRY EXHAUSTION
CONTROL WAIT != FAILURE
COMPENSATION ATTEMPT != CONFIRMED INVERSE EFFECT
ORIGINAL OUTCOME != RECOVERY OUTCOME
EFFECT DEDUPE != CONSEQUENCE COMPLETENESS
PENDING STATUS != EXECUTABLE RECOVERY WORK
RE-EXECUTE PARENT != RESUME UNRESOLVED CHILDREN
```

No production implementation is authorized by this supplement.
