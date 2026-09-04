# KF-JOURNEY-018 — Failure → Recovery

Status: ACTIVE FORENSICS / MICROSCOPIC RECOVERY PASS ADVANCED
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Last evidence pass: 2026-09-03 local / 2026-09-04 UTC
Primary kernels: K11 Recovery/Reliability, K7 Temporal/Event/Workflow
Secondary kernels: K8 Evidence/Outcome, K9 Integration/External Reality, K10 Financial Truth, K6 State Transition, K3 Governance
Primary adjacent journeys: J2 Governed Action, J6 Proactive KEY, J14 External Event Ingress, J15 Governance, J23 Temporal Flow

> J18 asks how KEYFLOWOS restores truthful, valid business work after failure. It is not a generic infrastructure uptime checklist. No production implementation is authorized.

---

## A. Central question

> **After something fails, what truthful state remains, who owns recovery, is the original work still valid to execute, and what evidence proves the recovery outcome?**

J18 covers:

- scheduler/poller failure;
- worker crash/stall;
- retry/backoff;
- partial domain mutation;
- provider timeout/uncertain outcome;
- provider-declared failure;
- local persistence failure after possible effect;
- dead-letter/operator intervention;
- cancellation/supersession during recovery;
- refund/reversal/compensation/undo;
- state/evidence repair.

---

## B. Recovery taxonomy

Failure-certainty axis:

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
EXPIRED
CANCELLED
SUPERSEDED
SUCCEEDED
```

Recovery-outcome axis:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

These are orthogonal.

```text
ORIGINAL EXECUTION OUTCOME
!=
RECOVERY / REVERSAL / COMPENSATION OUTCOME
```

---

## C. Recovery algorithm

```text
failure / crash / timeout
→ identify WorkOccurrenceId + exact EffectId
→ establish current ownership/attempt state
→ classify certainty
→ did effect possibly cross point of no return?
   yes + uncertain → OUTCOME_UNKNOWN → reconcile first
→ is work still live?
   cancellation / supersession / expiry / lateness
→ is original action still valid?
   definition/action version + source state + authority/policy/clearance
→ retry/resume only if valid
→ preserve same logical/effect identity for retry
→ if reversing/compensating, create distinct RecoveryEffectId
→ preserve original OutcomeEvidence AND RecoveryOutcomeEvidence
→ terminalize truthfully
```

Recovery means restoring truthful business state, not merely making a worker run again.

---

## D. Microscopic recovery fabrics

### AI plan / BullMQ + ActionDispatcher

Strong seams:

- durable Redis queue;
- stable plan-step job identity;
- attempts/backoff;
- worker lock/stalled recovery;
- centralized ActionDispatcher effect seam;
- AiExecutionLog evidence.

F150:

```text
BullMQ attempt 1, key K
→ ActionDispatcher inline retries exhaust
→ failed AiExecutionLog with K
→ BullMQ schedules attempt 2
→ dispatcher idempotency lookup finds failed K
→ stored failure returned
→ no new effect attempt
```

Thus failed attempt evidence is acting as an effect-key tombstone even while the logical retry policy remains live.

Reference comparison with BullMQ reinforces that queue retry/job identity is coordination state, not business-effect terminality.

### OutboundDelivery / DeliveryEvent

Strongest generic outbound recovery seam:

```text
Queued/Scheduled/RetryPending
→ expected-state claim → Sending
→ adapter attempt
→ Published | RetryPending | Failed
→ durable DeliveryEvent
```

Positive:

- stable delivery identity;
- retry count/backoff;
- provider IDs/result snapshots;
- attempt evidence;
- authenticated manual retry/retry-all-failed.

Remaining external-truth defect reuses F149:

- adapter contract reduces failure to `success/isTransient`;
- no first-class `OUTCOME_UNKNOWN`;
- no provider-native effect-idempotency key requirement;
- manual retry can be unsafe if `Failed` actually means “possible external effect”.

### TransactionalEmail / CustomerNotificationLog

F144 revalidated:

```text
QUEUED row selected
→ no atomic drain claim
→ send() without original messageId as dedupeKey
→ provider effect
→ mark original row DRAINED
```

Concurrent drains or crash after provider send can duplicate.

### ScheduledAgentJob

F122/F123 remain canonical.

- generic `FAILED` has no observed generic retry/dead-letter consumer;
- consumer routing recognizes only a subset of live produced job types;
- unknown type can log-and-return and then be marked `COMPLETED`.

### UndoService

F151:

```text
successful action
→ process-local recentActions Map
→ five-minute setTimeout
```

Restart/replica change loses undo eligibility.

```text
UNDO != RETRY != ROLLBACK != REVERSAL != COMPENSATION
```

### SagaExecution / SagaStep

Important positive refinement:

The production `KeyCortexPlannerService.executePlan()` itself creates durable SagaExecution/SagaStep records and stores compensation metadata before effect. This is a real seam to preserve even though the separate generic SagaExecutor remains weakly reached.

Defects:

- F152 — non-throwing compensation handler can be recorded as `compensated` even when no inverse effect occurred or only local mitigation happened;
- F153 — a persisted `waiting_approval` step can lead to parent AiPlan/Saga `failed` because final status reads a stale pre-execution step snapshot;
- F154 — saga compensation result (`compensated|compensation_failed|compensation_unavailable`) is later overwritten by `failSaga()` to generic `failed`.

### Provider-backed refunds / financial reversal

F155:

```text
PaymentsOps.refundCharge()
→ real Stripe/PayPal refund succeeds
→ provider refund ID R returned
→ best-effort local Payment.create(REFUNDED, providerPaymentId=R)
→ NO ledger reversal
→ NO invoice reconciliation

later provider refund webhook R
→ sees Payment(providerPaymentId=R)
→ returns as duplicate
→ stronger createRefundWithPosting + invoice reconciliation path suppressed
```

Possible durable truth split:

```text
provider = refunded
Payment row = REFUNDED
ledger = original posting still present
invoice = still paid/unreconciled
```

Positive seam:

`CommerceService.markPaymentRefunded()` couples local refund status with ledger reversal transactionally and then reconciles the invoice. Provider webhook paths also contain a stronger `createRefundWithPosting()` seam.

Target is convergence onto those stronger existing financial-truth patterns, not another refund subsystem.

---

## E. Recovery action taxonomy

```text
RETRY
  same intended EffectId, new AttemptId

RECONCILE
  observe authoritative external/domain state

CANCEL
  prevent not-yet-effective work

VOID
  domain-native cancellation of an obligation/document where legal

REVERSAL
  provider/domain-native inverse transaction of a completed effect
  new RecoveryEffectId

COMPENSATION
  new action intended to mitigate/offset prior effect
  new RecoveryEffectId

MITIGATION_ONLY
  local annotation/follow-up where original effect is irreversible
```

Examples:

```text
booking before service occurs → CANCEL
unpaid invoice created in error → VOID if state machine permits
captured payment → REFUND / financial REVERSAL
sent external message → usually MITIGATION_ONLY, not unsend
```

---

## F. Provider-native idempotency research

Durable investigation:

`docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`

Adopted properties:

### Stripe

Stripe supports idempotency keys on POST requests to allow safe retry after connection errors without performing the operation twice.

Current KeyFlow `StripeConnector.stripeRequest()` does not expose/send an `Idempotency-Key`, including `POST /refunds`.

### PayPal

PayPal recommends `PayPal-Request-Id` on POST/PUT operations and explicitly supports retrying timeout/500 cases with the same request ID, including refund scenarios.

Current KeyFlow PayPal refund request does not send `PayPal-Request-Id`.

Target property:

```text
stable KeyFlow EffectId / RecoveryEffectId
→ provider-native idempotency token where supported
→ SAME token across safe retry
→ provider operation/refund ID captured when known
→ callback/status lookup reconciles final external state
```

This strengthens F149 / KF-REC-037; no duplicate external-uncertainty finding is required.

Provider token retention is not KeyFlow durable truth; KeyFlow retains its own stable effect identity independently.

---

## G. Consequence-aware idempotency

J18 now requires a distinction not previously explicit enough:

```text
EFFECT DEDUPE
!=
CONSEQUENCE COMPLETENESS
```

Example:

A provider refund ID R should prevent another refund effect R2 from being created accidentally.

But R must not block repair of missing consequences:

```text
refund occurrence R exists
→ ensure Payment evidence
→ ensure ledger reversal
→ ensure invoice/balance reconciliation
→ ensure OutcomeEvidence links them
```

Therefore recovery/idempotency asks two separate questions:

1. Has the external/business effect already occurred?
2. Have all required local consequences of that same effect converged?

This law also applies to ingress events, provider callbacks and workflow descendants.

---

## H. Identity layers

Recovery must preserve:

```text
WorkOccurrenceId
AttemptId
WorkerClaimId
ExecutionClaimId / EffectId
ProviderOperationId
ProviderIdempotencyToken
OutcomeEvidenceId
RecoveryEffectId
RecoveryAttemptId
RecoveryOutcomeEvidenceId
```

A retry is not a new business effect.

A reversal/compensation is a distinct effect and needs separate authority/evidence.

---

## I. Recovery authority

Candidate law for J15/J6 reinjection:

```text
original Clearance
→ exact original EffectId

retry same still-valid EffectId
→ may inherit bounded retry authority ONLY if policy explicitly permits

REVERSAL / COMPENSATION / materially changed retry
→ new ActionEnvelope
→ current source state + authority/autonomy/policy
→ fresh Clearance where material
```

Time/failure does not create recovery authority.

---

## J. Operator recovery

Observed positive seam:

- OutboundDelivery event history;
- authenticated manual retry;
- retry-all-failed.

But target operator surfaces must be certainty-aware:

```text
what WorkOccurrence / EffectId?
what failed?
what is strongest known external outcome?
is retry safe?
is reconciliation available?
has work expired/cancelled/superseded?
is reversal available?
is compensation only mitigation?
what authority is required?
what evidence proves recovery outcome?
```

Temporal Work Projection (KF-REC-047) remains the natural cross-domain read model; domain records remain sources of truth.

No universal dead-letter table is accepted yet.

---

## K. J18 invariants

1. attempt failure does not imply logical-work failure;
2. retry preserves WorkOccurrenceId + EffectId and increments AttemptId;
3. failed idempotency evidence must not defeat a live retry policy;
4. successful effect evidence must prevent duplicate external effect;
5. ambiguous external outcome is reconciled before unsafe retry;
6. cancellation/supersession/expiry/version/source-state are checked before recovery executes;
7. material recovery revalidates authority/autonomy/Clearance;
8. durable recovery survives process restart where business semantics require it;
9. horizontal replicas do not multiply effects/retries;
10. error containment is not durable recovery;
11. undo is not reversal/compensation;
12. compensation/reversal has its own EffectId and OutcomeEvidence;
13. control wait is not failure;
14. compensation-handler return is not proof of inverse effect;
15. irreversible effects cannot be represented as undone by local annotation;
16. original outcome and recovery outcome remain independently durable;
17. parent workflow state derives from durable current child state;
18. provider-native idempotency should bind to stable KeyFlow effect identity where available;
19. effect dedupe must not suppress completion of missing local consequences;
20. confirmed financial reversal converges payment + ledger + invoice truth.

---

## L. Findings / contradictions

New J18 findings:

- F150 — failed ActionDispatcher idempotency record defeats later BullMQ retry.
- F151 — UndoService eligibility is process-local/non-replicated.
- F152 — Saga compensation can falsely report `compensated`.
- F153 — KeyCortex approval wait can terminalize parent plan/saga as failure.
- F154 — planner overwrites saga compensation outcome with generic `failed`.
- F155 — provider-backed manual refund can succeed externally while bypassing ledger reversal/invoice reconciliation and then suppress webhook repair.

New contradictions:

- C100 — queue retry vs failed idempotency terminality.
- C101 — recovery promise vs recovery-state durability.
- C102 — `compensated` claim vs confirmed inverse effect.
- C103 — child control wait vs parent workflow failure.
- C104 — recovery outcome vs generic failure overwrite.
- C105 — confirmed provider refund vs split Payment/ledger/invoice truth.

Canonical supplements:

- `docs/intelligence/08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `docs/intelligence/09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`

Reused, do not duplicate:

- F050/F051 execution/idempotency ownership;
- F097 proactive scheduled occurrence claim;
- F122/F123 ScheduledAgentJob ownership/routing;
- F127 failed ingress recovery suppression;
- F136 non-durable Chatwoot acceptance;
- F137–F149 J23 temporal/cancellation/lateness/version/external-outcome findings.

---

## M. Proof requirements

- BullMQ live retry reaches a genuinely new ActionDispatcher attempt without a failed tombstone blocking it;
- successful effect evidence still prevents duplicate effect;
- ambiguous provider outcome cannot be manually/blindly retried;
- Stripe/PayPal refund retry reuses one provider-native idempotency identity;
- provider-confirmed refund converges Payment, ledger and invoice even if one local consequence initially fails;
- replayed refund webhook repairs missing local consequences without duplicating provider reversal;
- waiting approval remains resumable parent/child workflow state;
- compensation result remains durable after plan finalization;
- compensation cannot be confirmed from a no-op/mitigation-only handler;
- reversal/compensation uses fresh governance where it creates a new material effect.

No runtime tests were executed in this forensic pass.

---

## N. Immediate next work

Completed:

```text
[done] ActionDispatcher + BullMQ retry/idempotency algebra
[done] OutboundDelivery adapter failure / operator retry seam
[done] ScheduledAgentJob FAILED/routing trace
[done] CustomerNotificationLog crash-recovery revalidation
[done] Saga reachability + compensation first pass
[done] provider/domain reversal taxonomy first pass
[done] Stripe/PayPal/BullMQ reference comparison for retry/idempotency
[done] financial refund convergence trace
```

Next:

```text
1. trace operator diagnostics/repair surfaces across AI plans, ScheduledAgentJob, ingress and sagas
2. classify dead-letter semantics by work family
3. trace representative post-provider/pre-local-persistence crash windows beyond refunds
4. complete provider reversal/cancel matrix for remaining material integrations
5. define exact recovery authority / fresh Clearance policy
6. pool J18 findings into K11/K9/K8 target laws/recommendations
7. backward re-audit J15/J6 for recovery-created effects
8. reinject J18 into J23 and finish remaining L6 migration/proof blockers
```

---

## O. Machine-readable record

```yaml
id: KF-JOURNEY-018
status: ACTIVE_FORENSICS_MICROSCOPIC_PASS_ADVANCED
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_audit_head: 5ec358e9b792817eda1e37fd80a0574eb7905a8a
primary_kernels: [KF-KERNEL-011, KF-KERNEL-007]
affected_kernels: [KF-KERNEL-003, KF-KERNEL-006, KF-KERNEL-008, KF-KERNEL-009, KF-KERNEL-010]
new_findings: [F150,F151,F152,F153,F154,F155]
new_contradictions: [C100,C101,C102,C103,C104,C105]
recovery_matrix: docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md
implementation_authorized: false
```
