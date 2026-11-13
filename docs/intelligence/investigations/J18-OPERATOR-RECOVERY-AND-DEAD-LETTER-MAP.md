# J18 — Operator Recovery / Dead-Letter / Repair Map

Status: ACTIVE FORENSIC SYNTHESIS / KF-REC-048 INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Primary journey: J18 Failure → Recovery
Primary kernels: K11 Recovery/Reliability, K8 Evidence/Outcome
Secondary kernels: K7 Temporal/Event/Workflow, K9 Integration/External Reality, K10 Financial Truth, K3 Governance

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

Where does failed or uncertain KeyFlow work go today, what can an operator actually do with it, and which current “failed” states are genuine recoverable dead-letter states versus terminal evidence, ambiguous external state, or merely status labels?

Target distinction:

```text
FAILED BUCKET
!= DEAD LETTER
!= RECOVERY QUEUE
!= OUTCOME_UNKNOWN
!= OPERATOR ACTIONABLE ITEM
```

---

## 2. Fabric map

| Fabric | Failure sink / visibility | Recovery owner today | Operator surface | Identity preserved? | Main defect / target |
|---|---|---|---|---|---|
| BullMQ AiPlan jobs | BullMQ failed job / attempts / QueueEvents + AiPlanStep/AiExecutionLog | BullMQ worker + application executor | no dedicated KeyFlow repair endpoint observed in this pass | queue jobId yes; effect terminality conflicts with failed AiExecutionLog | F150: failed effect tombstone can defeat queue retry |
| AI Graph Action Queue | merged approvals, plans and execution logs | diagnostic only | `GET actions/businesses/:businessId/queue` | log/plan IDs visible | failed items displayed, but no certainty-aware retry/reconcile action |
| KeyCortex Plan | AiPlan/AiPlanStep + Saga | caller can POST plan execute again | live `POST /api/v1/cortex/plans/:planId/execute` | plan/step IDs retained, but re-execute starts new saga | F157: parent re-execution can replay completed steps |
| KeyCortex replanIfNeeded | appends `recover_<action>` steps | no live caller observed outside tests | none observed | same plan ID, new steps | weak/dormant; no `recover_*` implementations found in search |
| OutboundDelivery | `Failed`, `RetryPending`, DeliveryEvent history | DeliveryQueueService | authenticated per-delivery retry + retry-all-failed | stable OutboundDelivery.id / attempt events | strongest current operator seam; must gate retry on external certainty |
| ScheduledAgentJob | `FAILED` row | none generic observed | none generic observed | job ID exists | terminal row behaves like implicit dead-letter with no generic repair owner; F122/F123 |
| TransactionalEmail CustomerNotificationLog | QUEUED / DRAINED / send logs | drain loop | no certainty-aware dead-letter UI observed | queued row ID exists but effect dedupe lost on replay | F144 crash/concurrent drain duplication |
| Payment retry | FAILED -> PENDING row | no provider recovery owner observed | authenticated Commerce retry endpoint | payment row ID only | F156: status repair presented as retry without executable effect occurrence |
| Stripe/PayPal refund | provider refund + Payment/webhook evidence | provider callback + payment service | refund action exists; repair mostly webhook-driven | provider refund ID strong | F155 consequence repair can be suppressed by existing refund row |
| WebhookEvent ingress | first-seen occurrence record only | provider redelivery, but duplicate is ignored | no failed-occurrence repair surface observed | providerEventId strong | F127: occurrence claim survives while processing failure has no resumable lifecycle |
| SagaExecution/SagaStep | failed/compensation statuses + step evidence | SagaService during planner execution | no direct operator repair controller observed in this pass | saga/step IDs strong | F152/F154 evidence semantics; durable evidence is useful but not a recovery queue |
| UndoService | process-local recentActions | request-serving process | undo UX where exposed | ephemeral action ID | F151: not durable/deploy-safe |

---

## 3. Dead-letter classes

Current fabrics should not be forced into one physical DLQ because their semantics differ.

### A. Transport-native failed job

Example: BullMQ.

```text
job attempts exhausted
→ BullMQ failed set
```

Useful properties:

- job identity retained while configured retention permits;
- failure reason/stack available;
- native retry operation exists;
- queue locks/stalled recovery already exist.

But KeyFlow still needs application truth:

```text
Is logical work still live?
Did business effect possibly happen?
Is retry safe/current/authorized?
```

### B. Domain failed occurrence with explicit operator retry

Example: OutboundDelivery.

```text
Delivery = Failed
→ operator retry endpoint
→ same durable delivery identity requeued
```

This is close to a useful domain dead-letter seam, but `Failed` must be split/qualified by confirmed failure vs `OUTCOME_UNKNOWN` before retry is always safe.

### C. Terminal row without recovery owner

Example: ScheduledAgentJob `FAILED`.

This is an **implicit dead-letter** only in the weakest sense: failed work remains visible in storage, but no generic retry/repair consumer or operator endpoint was observed.

Target: explicit source-owned recovery policy + projection action, not necessarily a new global table.

### D. Occurrence identity without failed processing state

Example: WebhookEvent.

```text
first seen recorded
→ processing fails
→ no PROCESSING / RETRYABLE_FAILED state
→ redelivery treated as duplicate
```

This is not a dead-letter state at all. It is a claimed occurrence with lost processing ownership.

Target: processing lifecycle/resume semantics on the existing occurrence seam.

### E. Evidence sink without safe resume operation

Example: SagaExecution/SagaStep and AiExecutionLog.

These can preserve error/recovery evidence but are not themselves sufficient operator recovery queues.

A failed execution log does not imply safe retry. A compensated saga header does not prove inverse effect. Recovery actions must be derived from stronger effect/current-state evidence.

### F. Status mutation masquerading as recovery

Example: Payment `FAILED -> PENDING`.

A status transition with no executable recovery occurrence is neither retry nor dead-letter processing.

Target: separate `bookkeeping repair` from `retry effect` vocabulary.

---

## 4. Operator action contract

KF-REC-048 should be rendered through KF-REC-047 rather than through a new monolithic recovery queue.

For any actionable failed/uncertain item, the projection should compute:

```yaml
identity:
  work_occurrence_id: ...
  effect_id: ...
  attempt_id: ...
  source_type: ...
  source_id: ...
certainty:
  class: RETRYABLE_ATTEMPT_FAILURE|FAILED_FINAL_CONFIRMED|AWAITING_EXTERNAL|OUTCOME_UNKNOWN|EXPIRED|CANCELLED|SUPERSEDED
  external_point_of_no_return: before|possible|confirmed
  provider_operation_id: ...
work_validity:
  cancelled: ...
  superseded: ...
  expired: ...
  definition_version_current: ...
  source_state_current: ...
control:
  retry_authority: ...
  reversal_requires_clearance: ...
  compensation_requires_clearance: ...
actions:
  retry: allowed|blocked|requires_reconcile|requires_clearance
  reconcile: available|unavailable
  cancel: allowed|too_late|not_applicable
  reverse: available|unavailable|requires_clearance
  compensate: available|unavailable|requires_clearance
  bookkeeping_repair: available|unavailable
outcome:
  original_evidence_ref: ...
  recovery_evidence_ref: ...
```

UI language can remain simple while drill-down preserves the forensic distinctions.

---

## 5. Parent-plan recovery

F157 establishes a specific operator law:

```text
PLAN EXECUTE AGAIN
must not mean
REPLAY ALL STEPS
```

Target plan recovery:

```text
load durable current step states
→ preserve completed terminal steps
→ classify failed/waiting/unknown steps
→ revalidate descendants/source/control
→ resume/retry only eligible unresolved steps
→ same logical occurrence where semantics unchanged
→ new RecoveryEffectId only for actual reversal/compensation/new action
```

A new SagaExecution may be useful as a recovery attempt/container, but it must link to the original occurrence/effects and must not imply new business intent for already-completed children.

---

## 6. Payment operator recovery

F156 establishes another operator law:

```text
FAILED -> PENDING
!= provider retry
```

Possible legitimate target actions must be distinguished:

- **reconcile provider state** — did payment actually exist?
- **create a new checkout/payment attempt** — new provider operation under explicit customer/operator intent;
- **mark local evidence corrected** — bookkeeping repair only;
- **retry same provider operation** — only if provider contract/idempotency semantics support it.

The current generic `retryPayment()` mutation does not identify which of these it means.

---

## 7. Recovery observability vs recovery ownership

Existing observability surfaces are useful but must not be mistaken for recovery:

```text
AiExecutionLog / action queue
DeliveryEvent history
SagaStep history
ErrorRegistry
CRM timeline
WebhookEvent first-seen row
```

Target law:

> Seeing a failure is not the same as owning its safe recovery.

Every operator action requires an explicit source/work owner and effect/current-state checks.

---

## 8. No universal DLQ yet

Current verdict:

```text
ONE RECOVERY SEMANTIC CONTRACT      YES — KF-REC-048
ONE CROSS-DOMAIN OPERATOR PROJECTION YES — extend/use KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE      NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER        NOT JUSTIFIED YET
```

Preserve domain-local mechanics that are already strong and normalize their semantics/projection first.

Reassess physical convergence only after migration/operational evidence shows repeated duplication in:

- retry eligibility calculation;
- operator action authorization;
- effect/recovery identity;
- dead-letter retention;
- reconciliation workflows;
- cross-domain observability.

---

## 9. Proof requirements

- failed BullMQ job can be retried only if corresponding logical effect remains retryable/current;
- OutboundDelivery operator retry is blocked or routed to reconciliation for `OUTCOME_UNKNOWN`;
- ScheduledAgentJob failed work is either explicitly terminal or has a source-owned retry/repair path;
- failed WebhookEvent processing can resume the same occurrence after transient failure;
- AI plan resume does not replay completed steps;
- `retryPayment`-class actions cannot claim retry unless executable provider/recovery work exists;
- operator action always records actor/authority/rationale/EffectId/RecoveryEffectId;
- RecoveryOutcomeEvidence survives process restart and later parent finalization;
- Temporal Work Projection can reconstruct actionable failed/uncertain work from domain sources without becoming a new source of truth.

No runtime tests were executed in this forensic pass.
