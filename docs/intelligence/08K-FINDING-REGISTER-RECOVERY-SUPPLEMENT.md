# KeyFlowOS Finding Register — Recovery Supplement

Status: CANONICAL CONTINUATION OF `08J-FINDING-REGISTER-EXTERNAL-OUTCOME-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F149.

---

## F150 — Failed ActionDispatcher idempotency evidence defeats subsequent BullMQ retries for the same plan-step effect

**Status:** VERIFIED CROSS-LAYER / RECOVERY-SEMANTICS FINDING

AI plan-step queue jobs are configured with BullMQ attempts/backoff and reuse a stable plan-step idempotency key.

`ActionDispatcher.dispatch()` also performs inline retries. After its retry budget is exhausted it writes a failed `AiExecutionLog` containing the same idempotency key.

On the next BullMQ attempt, `ActionDispatcher.findIdempotentExecution()` finds that failed log and returns the stored failure immediately.

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

The authenticated Commerce API exposes a payment retry action. `CommerceService.retryPayment()` verifies `FAILED`, then only changes `Payment.status = PENDING`, optionally logs a CRM event, and returns the row.

No provider charge/capture/payment-link operation is invoked by this method. Repository search in this pass found no generic worker/consumer that treats that newly-pending row as executable provider work.

Target law:

> A recovery command must either create/claim executable recovery work or state explicitly that it is only a bookkeeping/status repair.

Affected kernels: K7, K8, K9, K10, K11.
Affected journeys: commerce/payment journeys, J18, J23.

---

## F157 — Re-executing a stored KeyCortex plan can replay already-completed steps instead of resuming only unresolved work

**Status:** VERIFIED CROSS-LAYER / OPERATOR-RECOVERY FINDING

The live HTTP surface exposes `POST /api/v1/cortex/plans/:planId/execute`.

`KeyCortexPlannerService.executePlan(planId)` loads all stored steps, resets the parent plan to `running`, starts a new saga, and loops through all steps. It does not exclude steps already persisted as `completed`.

Therefore parent re-execution can replay confirmed-success effects.

Target law:

> Resume/retry continues the same logical WorkOccurrence and preserves confirmed-success descendants unless an explicit new-effect policy says otherwise.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

## F158 — Confirmed PayPal capture can be reclassified as local `FAILED` after persistence failure, while the fallback failure row loses the lineage needed for webhook repair

**Status:** VERIFIED CROSS-LAYER / POST-PROVIDER-PERSISTENCE CRASH-WINDOW FINDING

`PaymentsService.capturePaypalOrder(orderId, invoiceId)` calls PayPal capture inside one broad `try` block.

When PayPal returns `COMPLETED`, the method derives `captureId` and then attempts local `Payment.create()`.

If that local persistence throws **after PayPal has already confirmed the capture**, the broad `catch` logs `PayPal capture failed`, creates a synthetic local row:

```text
providerPaymentId = paypal_fail_<orderId>_<timestamp>
status = FAILED
invoiceId = local invoice
```

and throws `Failed to capture PayPal order`.

This compresses:

```text
provider truth: CAPTURE COMPLETED, captureId C
local consequence: persistence failed
```

into:

```text
local recovery truth: payment FAILED
```

The later `PAYMENT.CAPTURE.COMPLETED` webhook can only repair if `processPaypalCaptureCompleted()` can link the provider capture back to local business state.

For capture events PayPal does not reliably echo the original purchase-unit custom ID, so KeyFlow's fallback resolver searches an existing Payment by the related PayPal order ID in `providerPaymentId` or `reference`.

The synthetic failure row preserves neither:

```text
providerPaymentId = synthetic paypal_fail_* value
reference = null
```

Thus the recovery row created by the catch can fail to provide the very order/capture lineage required by webhook repair. The provider capture may remain complete while KeyFlow persists only a failed local payment and later logs that the capture webhook could not be linked.

Target law:

> After provider success is confirmed, downstream local persistence failure must be represented as **confirmed external success with incomplete local consequences**, not as provider failure. Provider operation/order/capture lineage must survive the crash window so reconciliation can complete the missing consequences.

Affected kernels: K8, K9, K10, K11.
Affected journeys: payment/commerce journeys, J14, J18, J23.

---

## F159 — OutboundDelivery can observe provider success, then reinterpret a local persistence failure as adapter failure and schedule a duplicate external attempt

**Status:** VERIFIED CROSS-LAYER / POST-PROVIDER-PERSISTENCE CRASH-WINDOW FINDING

`DeliveryQueueService.executeDelivery()` wraps both the provider call and all subsequent local persistence/evidence work in the same `try/catch`.

Success path:

```text
adapter.publish(...)
→ result.success = true
→ outboundDelivery.update(status=Published, provider IDs/result)
→ DeliveryEvent(success)
→ emit local events / update contact/content state
```

If `adapter.publish()` has already returned success but a later local operation throws — for example `outboundDelivery.update(Published)` or `recordEvent()` — execution falls into the catch intended for adapter errors:

```text
catch(err)
→ adapter.normalizeError(err)
→ if transient: status = RetryPending
→ else: status = Failed
```

A local database/evidence failure can therefore become:

```text
provider truth: effect accepted/published successfully
local truth: RetryPending | Failed
```

and the retry scheduler can call the provider again for the same delivery.

This is distinct from F149's ambiguous transport failure: here provider success was already observed before local persistence failed.

Target law:

> Once provider success is observed, local persistence failure transitions to **provider-success / consequence-incomplete reconciliation**, never back into an execution-failure branch that may repeat the external effect. Provider call errors and post-provider local errors require separate exception boundaries.

Affected kernels: K8, K9, K11.
Affected journeys: outbound communication/content journeys, J14, J18, J23.

---

# Reused / strengthened findings — do not duplicate

## F149 — strengthened by OutboundDelivery retry tracing

`OutboundDelivery` preserves stable delivery identity, expected-state `Sending` claim, retry/backoff and durable `DeliveryEvent` attempts. But `success/isTransient` lacks first-class `OUTCOME_UNKNOWN`, so manual/automatic retry remains unsafe where prior external effect may exist.

F159 now separately covers the stronger case where provider success is already observed before a local persistence failure is misclassified as adapter failure.

## F144 — revalidated

`TransactionalEmailService.drainQueue()` still lacks an atomic drain claim and drops the queued row's original dedupe/effect identity when replaying `send()`.

## F122 / F123 — revalidated and producer breadth strengthened

`ScheduledAgentJob` still lacks a generic atomic execution claim/recovery owner, and live producer job-type breadth exceeds the generic consumer's routing set. Unknown work can be falsely completed.

## F127 — operator-recovery implication strengthened

`WebhookEvent` first-seen identity remains a useful ingress occurrence seam, but no processing lifecycle/repair surface was observed that lets a failed-after-claim event resume safely.

F158 composes dangerously with F127: even when a provider capture webhook exists, a failed first processing attempt can become unrecoverable if the occurrence was already claimed.

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
PROVIDER SUCCESS + LOCAL PERSISTENCE FAILURE != PROVIDER FAILURE
POST-PROVIDER LOCAL ERROR != SAFE PERMISSION TO REPEAT EXTERNAL EFFECT
```

No production implementation is authorized by this supplement.
