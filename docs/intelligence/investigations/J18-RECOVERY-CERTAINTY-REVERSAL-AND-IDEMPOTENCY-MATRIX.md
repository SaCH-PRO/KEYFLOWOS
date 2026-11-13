# J18 — Recovery Certainty / Reversal / Idempotency Matrix

Status: ACTIVE FORENSIC SYNTHESIS / TARGET-CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Primary journey: J18 Failure → Recovery
Primary kernels: K11 Recovery/Reliability, K9 Integration/External Reality, K8 Evidence/Outcome
Secondary kernels: K7 Temporal/Workflow, K10 Financial Truth, K3 Governance
Adjacent journeys: J2, J14, J15, J23

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Purpose

J18 needs one recovery vocabulary across heterogeneous fabrics without pretending every effect is reversible or every retry is safe.

This investigation classifies:

```text
failure certainty
→ logical/effect identity
→ external point-of-no-return
→ retry/reconcile/cancel/reverse/compensate option
→ required terminal evidence
```

The target is a shared semantic contract, not one global queue, one compensation table or one workflow runtime.

---

## 2. Recovery action taxonomy

```text
RETRY
  new attempt of the SAME intended effect
  preserves WorkOccurrenceId + EffectId
  increments AttemptId

RECONCILE
  observe authoritative external/domain state
  does not create a fresh business effect merely to discover truth

CANCEL
  prevent work/effect that has not crossed its point of no return

VOID
  domain-native cancellation of an obligation/document before terminal external settlement where domain law permits

REVERSAL
  provider/domain-native inverse transaction of an already-completed effect
  creates a distinct RecoveryEffectId

COMPENSATION
  new business action intended to mitigate/offset an earlier effect
  does not erase the original outcome

MITIGATION_ONLY
  local annotation/follow-up because the original external effect is irreversible
```

---

## 3. Current fabric matrix

| Fabric / effect | Current identity seam | Failure certainty today | Native retry/recovery | Point of no return | Current recovery evidence | Target classification |
|---|---|---|---|---|---|---|
| BullMQ AiPlan step | stable jobId / plan-step idempotency key | queue attempt failure is explicit | automatic attempts/backoff; manual job retry supported by BullMQ | downstream business effect, not queue dequeue | BullMQ job state + AiPlanStep + AiExecutionLog | RETRY only while same effect remains live and failed idempotency record is non-terminal |
| ActionDispatcher | idempotencyKey + AiExecutionLog | success/failure compressed at execution-log layer | process-local inline retry + caller/queue retry | tool/domain/provider call | AiExecutionLog | distinguish retryable attempt, successful effect, confirmed final failure, OUTCOME_UNKNOWN |
| OutboundDelivery | OutboundDelivery.id + DeliveryEvent attempt | `success/isTransient`; ambiguity not first-class | RetryPending/backoff + operator retry | adapter/provider acceptance | DeliveryEvent + provider ID when returned | RECONCILE before retry when prior effect may exist |
| WhatsApp direct send | WhatsAppMessage id + provider SID/wamid after response | rejection and transport ambiguity can collapse to FAILED | scheduler/provider retry paths fragmented | provider acceptance | coarse SENT/FAILED + provider ID when response exists | AWAITING_EXTERNAL / OUTCOME_UNKNOWN + provider lifecycle reconciliation |
| TransactionalEmail queue | queued CustomerNotificationLog row | queue state and provider effect identity can diverge | drain replay | provider accepted send | queued/drained logs; dedupe key not preserved through drain | atomic claim + stable effect identity + reconciliation |
| ScheduledAgentJob | DB job id / checkpoint identity | generic FAILED or false COMPLETED for unknown type | no generic FAILED recovery consumer observed | depends on child effect | ScheduledAgentJob row | typed unhandled/dead-letter/retry state; lineage to child effect |
| KeyCortex Saga | SagaExecution/SagaStep + compensationAction | compensation handler return currently overstates success | reverse-order compensation | original effect-specific | SagaStep status/output/error | recovery outcome separate from original execution outcome |
| Booking create | booking id | domain state known locally | cancellation via BookingStatus.CANCELLED where valid | service appointment completion / external downstream consequences | Booking status + events | CANCEL before effect; later business remediation is compensation, not rollback |
| Invoice create | invoice id | local domain state | VOID through InvoiceWorkflow where transition legal | payment/financial settlement changes semantics | Invoice status + ledger events where workflow path used | VOID only when domain state allows; paid invoices require refund/credit/reversal semantics |
| Provider refund (Stripe/PayPal) | provider refund id after response | request timeout can be ambiguous; success response gives confirmed provider reversal id | provider refund API | provider refund accepted/created | PaymentsOps RefundResult + optional local Payment row | REVERSAL with provider-native idempotency + webhook/status reconciliation |
| Sent message “recall” | local message/delivery id | original effect may be confirmed sent | no true provider unsend in inspected path | provider send/delivery | local cancelled/recall annotation | MITIGATION_ONLY, never “original effect undone” |

---

## 4. F150 — Queue retry identity vs effect retry identity

BullMQ reference behavior deliberately supports automatic attempts/backoff and programmatic retry of failed jobs. Custom job IDs provide queue-level dedupe while the job remains represented in the queue.

Adopted property:

> Queue retry ownership and queue job identity are transport/coordination semantics. They do not decide whether the downstream business EffectId is terminal or retryable.

Current KeyFlow contradiction:

```text
BullMQ says attempt may retry
→ ActionDispatcher failed AiExecutionLog with same key
→ dispatcher treats key as already resolved failure
→ no new effect attempt
```

Therefore the execution-idempotency record needs an outcome/terminality model compatible with the logical retry policy.

Reference properties adopted from BullMQ:

- retry is an explicit job-state transition;
- attempts/backoff belong to the job lifecycle;
- job ID uniqueness is queue-scoped deduplication, not business-effect proof;
- application-level idempotency remains necessary for external/domain effects.

No BullMQ replacement is justified.

---

## 5. Provider-native idempotency — adopted property

### Stripe

Stripe documents idempotency keys for POST requests so a client can safely retry after connection errors without creating the same operation twice. API v1 preserves the first result for the key for its retention period.

KeyFlow current Stripe helper `stripeRequest()` does not accept/send an `Idempotency-Key`, including `POST /refunds`.

### PayPal

PayPal recommends `PayPal-Request-Id` for POST/PUT calls and explicitly documents retrying failed/timeout requests with the same ID. Its refund example is a directly relevant case.

KeyFlow current PayPal refund fetch does not send `PayPal-Request-Id`.

### Adopted KeyFlow property

```text
EffectId / RecoveryEffectId
→ deterministic provider idempotency token where provider contract supports it
→ same token reused across safe retry
→ provider operation/refund ID captured when known
→ webhook/status lookup reconciles final external state
```

This strengthens F149 / KF-REC-037 rather than creating a duplicate finding.

Provider idempotency retention windows are provider contracts, not permanent KeyFlow truth. KeyFlow must retain its own stable EffectId independently.

---

## 6. F155 — Financial reversal convergence defect

Current provider-backed manual refund path:

```text
PaymentsOps.refundCharge()
→ Stripe/PayPal refund API
→ provider refund succeeds and returns refund ID R
→ best-effort Payment.create(status=REFUNDED, providerPaymentId=R)
→ return success to caller
```

Missing from that path:

```text
RevenuePostingService.onPaymentRefunded()
InvoiceWorkflowService.reconcileFromPayments()
```

Normal provider webhook refund processing contains those stronger consequences through `createRefundWithPosting()` + invoice reconciliation.

But both Stripe and PayPal refund webhook handlers first do:

```text
find Payment(providerPaymentId=R)
→ if existing: return
```

Therefore when PaymentsOps successfully creates row R, the later webhook suppresses its own ledger/invoice repair.

Truth split:

```text
provider refund = confirmed
Payment row = REFUNDED
ledger = may still show original economic posting
invoice = may remain paid/unreconciled
```

This is F155 / C105.

Positive existing seam:

`CommerceService.markPaymentRefunded()` transactionally changes local payment state and invokes `RevenuePostingService.onPaymentRefunded()`, then reconciles the invoice. Provider webhook paths similarly have a stronger `createRefundWithPosting()` seam.

Target direction is convergence onto the stronger existing financial-truth pattern, not another refund subsystem.

---

## 7. Consequence-aware idempotency

A core J18 refinement:

```text
EFFECT DEDUPE
!= CONSEQUENCE COMPLETENESS
```

A provider refund ID proves that the external reversal occurrence already exists. It should suppress creation of another external refund.

It must **not** suppress idempotent completion of missing local consequences:

```text
refund occurrence exists
→ ensure Payment evidence exists
→ ensure ledger reversal exists
→ ensure invoice/balance reconciliation exists
→ ensure OutcomeEvidence links all consequences
```

Thus idempotency needs two questions:

1. **Has the business/external effect already occurred?**
2. **Have all required local consequences of that effect converged?**

The same law applies to ingress events, delivery callbacks and workflow descendants.

---

## 8. Reversal authority

Recovery is not automatically authorized merely because the original action was authorized.

Candidate law:

```text
original Clearance
→ original exact effect

retry of same still-valid EffectId
→ may inherit bounded retry authority if policy explicitly permits

new REVERSAL / COMPENSATION effect
→ new ActionEnvelope
→ current source state + authority/policy
→ fresh Clearance when material
```

Examples:

- retrying a network call with the same provider idempotency token may be continuation of the same effect;
- refunding money is a new financial effect and may need fresh control;
- cancelling a not-yet-effective booking may be domain cancellation;
- sending an apology after an irreversible message is a new compensating communication.

This must be reinjected into J15/J6 after the recovery matrix stabilizes.

---

## 9. Operator recovery model

Operator surfaces should expose certainty, not just a red status.

Minimum projection:

```yaml
work_occurrence_id: ...
effect_id: ...
current_work_state: ...
last_attempt_id: ...
failure_class: retryable|final_confirmed|outcome_unknown|awaiting_external|expired|cancelled|superseded
provider_operation_id: ...
provider_idempotency_key_present: true|false
external_point_of_no_return: before|possible|confirmed
recovery_action:
  retry_safe: true|false|unknown
  reconcile_available: true|false
  cancel_available: true|false
  reversal_available: true|false
  compensation_available: true|false
recovery_state: ...
original_outcome_evidence: ...
recovery_outcome_evidence: ...
```

Temporal Work Projection (KF-REC-047) remains the natural cross-domain read model; domain records remain authoritative sources.

---

## 10. Current conclusions

Accepted working conclusions for pooling:

1. Recovery needs **failure certainty** and **recovery outcome** as separate axes.
2. Retry preserves the same logical occurrence/effect; reversal/compensation creates a new recovery effect.
3. Provider-native idempotency tokens should be bound to stable KeyFlow EffectId where supported.
4. Provider response IDs and later webhooks/status APIs are reconciliation evidence, not transport detail.
5. Dedupe must not suppress incomplete local consequences of an already-known external effect.
6. Financial reversal requires payment + ledger + invoice truth to converge.
7. Domain cancellation, true reversal and mitigation-only annotation must not share one semantic `compensated` outcome.
8. Recovery actions may require fresh governance depending on whether they continue the same effect or create a new one.
9. BullMQ is a coordination/retry fabric worth preserving; its job state must not be mistaken for business-effect terminality.
10. No universal dead-letter table or workflow engine is justified yet.

---

## 11. Proof requirements

- network failure during a Stripe/PayPal refund can be retried using one provider-native idempotency identity without double refund;
- a provider-confirmed refund converges payment row, ledger reversal and invoice balance even if one local consequence initially fails;
- replayed refund webhook does not create another refund and does repair missing local consequences;
- a retryable BullMQ attempt can reach a new ActionDispatcher attempt without a failed idempotency tombstone blocking it;
- successful effect evidence still blocks duplicate external effect;
- operator manual retry is unavailable or guarded when external outcome is unknown;
- booking cancellation does not claim completed service was undone;
- message recall remains mitigation-only when provider unsend is impossible;
- reversal/compensation records preserve original effect outcome and new recovery outcome separately;
- fresh governance is required where recovery creates a materially new effect.

No runtime tests were executed in this forensic pass.

---

## 12. External references / adopted properties

Primary references used in this pass:

- Stripe API — Idempotent requests: `https://docs.stripe.com/api/idempotent_requests`
- Stripe — Refund and cancel payments / refund events: `https://docs.stripe.com/refunds`
- PayPal REST API — API requests / `PayPal-Request-Id`: `https://developer.paypal.com/api/rest/requests/`
- BullMQ — Retrying failing jobs: `https://docs.bullmq.io/guide/retrying-failing-jobs`
- BullMQ — Retrying jobs: `https://docs.bullmq.io/guide/jobs/retrying-job`
- BullMQ — Job IDs: `https://docs.bullmq.io/guide/jobs/job-ids`

Adopt properties, not products.
