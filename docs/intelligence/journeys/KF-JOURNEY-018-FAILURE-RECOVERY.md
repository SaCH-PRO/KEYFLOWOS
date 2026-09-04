# KF-JOURNEY-018 — Failure → Recovery

Status: ACTIVE FORENSICS / MICROSCOPIC RECOVERY PASS ADVANCED / ENTERING TARGET POOLING
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Last evidence pass: 2026-09-03 local / 2026-09-04 UTC
Primary kernels: K11 Recovery/Reliability, K7 Temporal/Event/Workflow
Secondary kernels: K8 Evidence/Outcome, K9 Integration/External Reality, K10 Financial Truth, K6 State Transition, K3 Governance
Adjacent journeys: J2, J6, J14, J15, J23

> J18 asks how KEYFLOWOS restores truthful, valid business work after failure. No production implementation is authorized.

---

## A. Central question

> **After failure, timeout, crash or correction, what truthful state remains, who owns recovery, is the original work still valid, and what evidence proves the recovery outcome?**

Recovery is not “run the worker again.” It is restoration of truthful business state under current authority and external reality.

---

## B. Shared recovery model

### Failure-certainty axis

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

### Recovery-outcome axis

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

### Recovery-action taxonomy

```text
RETRY
  same WorkOccurrenceId + EffectId
  new AttemptId

RECONCILE
  observe authoritative state; no fresh business effect

CANCEL
  prevent not-yet-effective work

VOID
  domain-native cancellation where legal

REVERSAL
  new inverse RecoveryEffectId

COMPENSATION
  new mitigating RecoveryEffectId

MITIGATION_ONLY
  follow-up/annotation where inverse effect is impossible
```

Core distinction:

```text
ORIGINAL EXECUTION OUTCOME
!= RECOVERY OUTCOME
```

---

## C. Recovery algorithm

```text
failure / crash / timeout / correction
→ identify WorkOccurrenceId + EffectId
→ identify latest AttemptId / ownership
→ classify certainty
→ possible external point-of-no-return?
   yes + unknown → OUTCOME_UNKNOWN → reconcile first
→ verify occurrence still live
   cancellation / supersession / expiry / lateness
→ verify action still current
   definition version / source state / authority / policy / Clearance
→ if RETRY: preserve EffectId, increment AttemptId
→ if REVERSAL/COMPENSATION: create RecoveryEffectId
→ execute under explicit recovery ownership
→ preserve original OutcomeEvidence + RecoveryOutcomeEvidence
→ terminalize truthfully
```

---

## D. Microscopic findings

### F150 — ActionDispatcher failed-idempotency tombstone defeats BullMQ retry

```text
BullMQ attempt 1, key K
→ ActionDispatcher inner retries exhaust
→ failed AiExecutionLog(K)
→ BullMQ schedules later attempt
→ dispatcher sees failed K as idempotent hit
→ stored failure returned
→ no new effect attempt
```

Queue retry policy and effect terminality conflict.

### F151 — UndoService eligibility is process-local

Undo state lives in a process-local map with a five-minute timer. Restart/replica change loses eligibility.

`UNDO != RETRY != REVERSAL != COMPENSATION`.

### F152 — Saga compensation can falsely claim success

A non-throwing compensation handler becomes durable `compensated`, even when the handler no-ops or only mitigates an irreversible external effect.

```text
handler returned
!= inverse effect confirmed
```

### F153 — control wait can become parent failure

Planner writes `AiPlanStep=waiting_approval`, then computes parent status from stale pre-execution step objects and can set AiPlan/Saga to `failed`.

`AWAITING_CONTROL != FAILURE`.

### F154 — recovery outcome overwritten by generic failure

Saga compensation can persist:

```text
compensated | compensation_failed | compensation_unavailable
```

then planner finalization calls `failSaga()` and erases that saga-level recovery classification.

### F155 — provider refund can diverge from ledger/invoice truth

Provider-backed manual refund:

```text
Stripe/PayPal refund succeeds, refund id R
→ PaymentsOps creates Payment REFUNDED with R
→ no ledger reversal
→ no invoice reconciliation
→ later refund webhook sees existing R
→ returns as duplicate
→ stronger repair path suppressed
```

Core law:

```text
EFFECT DEDUPE
!= CONSEQUENCE COMPLETENESS
```

A known effect ID should block a second refund but must not block idempotent repair of missing Payment/ledger/invoice consequences.

### F156 — payment “retry” has no observed executable recovery owner

Authenticated Commerce API exposes payment retry. `CommerceService.retryPayment()` changes `FAILED -> PENDING` and logs a CRM event, but does not initiate a provider operation or create a durable recovery occurrence. No generic consumer for those newly-PENDING rows was observed in this pass.

```text
PENDING STATUS
!= EXECUTABLE RECOVERY WORK
```

### F157 — plan re-execution can replay completed steps

Live route:

```text
POST /api/v1/cortex/plans/:planId/execute
```

`executePlan()` reloads all stored steps, sets parent `running`, starts a new saga and executes every sorted step without excluding already-completed steps.

Thus a repair/re-execute call can replay confirmed-success effects.

```text
RE-EXECUTE PARENT
!= RESUME UNRESOLVED CHILDREN
```

---

## E. Reused findings strengthened by J18

Do not duplicate:

- F122/F123 — ScheduledAgentJob ownership/routing; FAILED rows lack observed generic recovery owner and unknown job types can false-complete.
- F127 — WebhookEvent first-seen identity can suppress provider redelivery after downstream failure because processing lifecycle is absent.
- F136 — Chatwoot acknowledges before durable acceptance.
- F144 — TransactionalEmail drain lacks atomic claim and loses original effect/dedupe identity.
- F149 — provider rejection and ambiguous transport failure collapse; OutboundDelivery automatic/manual retry needs certainty typing.
- F137–F147 — temporal waits, retries, cancellation, lateness and versioning remain recovery prerequisites.

---

## F. Strong seams to preserve

- BullMQ job identity / attempts / backoff / locks / stalled recovery;
- ActionDispatcher as central effect boundary;
- OutboundDelivery stable identity + DeliveryEvent + operator retry;
- SagaExecution/SagaStep durable step history;
- `CommerceService.markPaymentRefunded()` local refund + ledger reversal transaction;
- provider refund webhook `createRefundWithPosting()` + invoice reconciliation;
- provider operation IDs and lifecycle callbacks;
- quote-followup cancellation/current-state revalidation;
- KF-REC-047 Temporal Work Projection as operator read model.

Do not create `ActionDispatcherV2`, `WorkflowEngine2`, or a universal recovery table from findings alone.

---

## G. Provider/reference properties adopted

Durable comparison:

`docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`

Adopted properties:

- Stripe POST idempotency keys support safe retry after connection failure;
- PayPal `PayPal-Request-Id` provides retry/idempotency semantics for modifying requests, including refunds;
- provider operation/refund IDs are reconciliation evidence;
- BullMQ attempts/backoff/job IDs are queue lifecycle semantics, not business-effect terminality.

Target:

```text
EffectId / RecoveryEffectId
→ provider-native idempotency token where supported
→ SAME token on safe retry
→ provider operation ID captured
→ webhook/status lookup reconciles outcome
```

Provider retention windows do not replace KeyFlow durable effect identity.

---

## H. Operator / dead-letter map

Durable artifact:

`docs/intelligence/investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md`

Current verdict:

```text
ONE RECOVERY SEMANTIC CONTRACT       YES
ONE CROSS-DOMAIN OPERATOR PROJECTION YES, via KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE      NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER        NOT JUSTIFIED YET
```

Current failure sinks differ:

- BullMQ failed jobs: transport-native failed set, native retry machinery;
- OutboundDelivery Failed: strongest domain/operator retry seam;
- ScheduledAgentJob FAILED: terminal row with no observed generic recovery owner;
- WebhookEvent: occurrence identity but no failed-processing lifecycle;
- Saga/AiExecutionLog: durable evidence sinks, not sufficient recovery queues;
- Payment FAILED->PENDING: status mutation without observed provider recovery owner.

Seeing a failure is not the same as owning safe recovery.

---

## I. Recovery authority

Working law for J15/J6 reinjection:

```text
original Clearance
→ exact original EffectId

retry same still-valid EffectId
→ may continue bounded retry authority ONLY if policy explicitly permits

REVERSAL / COMPENSATION / materially changed retry
→ new ActionEnvelope
→ current source state + authority/autonomy/policy
→ fresh Clearance where material
```

Failure/time does not create authority.

---

## J. Canonical recovery recommendation

`KF-REC-048 — Establish a certainty-aware Recovery Contract across existing execution fabrics.`

This recommendation closes the semantic gap between:

```text
KF-REC-038 Durable WorkOccurrence
→ KF-REC-040 logical != attempt state
→ KF-REC-048 recovery/retry/reversal/compensation
→ KF-REC-037 provider reconciliation
→ KF-REC-047 operator/Temporal Work Projection
```

It explicitly rejects premature universal DLQ/recovery-engine convergence.

---

## K. J18 invariants

1. Attempt failure does not imply logical-work failure.
2. Retry preserves WorkOccurrenceId + EffectId and increments AttemptId.
3. Failed idempotency evidence must not defeat a live retry policy.
4. Successful effect evidence prevents duplicate effect.
5. Ambiguous external outcome is reconciled before retry.
6. Recovery checks cancellation/supersession/expiry/lateness/version/source state.
7. Material recovery revalidates authority/Clearance.
8. Recovery required by product semantics survives process restart/replicas.
9. Error containment is not durable recovery.
10. Undo is not reversal/compensation.
11. Reversal/compensation has its own RecoveryEffectId and OutcomeEvidence.
12. Control wait is not failure.
13. Compensation handler return is not proof of inverse effect.
14. Irreversible effect may be mitigation-only.
15. Original and recovery outcomes remain independently durable.
16. Parent state derives from durable current child state.
17. Provider-native idempotency binds to stable KeyFlow effect identity where available.
18. Effect dedupe does not suppress missing consequence repair.
19. Financial reversal converges Payment + ledger + invoice truth.
20. Operator retry requires actual recovery ownership and certainty.
21. Parent re-execution preserves confirmed-success child terminality.
22. No universal DLQ/runtime is justified until semantic convergence proves physical value.

---

## L. Canonical ranges from this pass

New findings:

```text
F150 F151 F152 F153 F154 F155 F156 F157
```

New contradictions:

```text
C100 C101 C102 C103 C104 C105 C106 C107
```

New recommendation:

```text
KF-REC-048
```

Canonical artifacts:

- `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
- `10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md`
- `investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
- `investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md`

---

## M. Proof requirements

- live BullMQ retry can reach a new ActionDispatcher attempt without failed-tombstone short circuit;
- successful effect evidence still blocks duplicate effect;
- ambiguous provider outcome cannot be blindly/operator retried;
- Stripe/PayPal retry uses one provider-native idempotency identity;
- provider-confirmed refund converges Payment/ledger/invoice after partial local failure;
- provider redelivery repairs missing local consequences without duplicating external effect;
- AWAITING_CONTROL remains resumable parent/child state;
- compensation result survives parent finalization;
- no-op/mitigation-only compensation cannot become confirmed inverse effect;
- `retryPayment`-class command cannot claim retry unless executable recovery work exists;
- plan resume cannot replay completed steps;
- recovery actions record current authority and fresh Clearance where required;
- KF-REC-047 can project actionable failed/unknown work without becoming source of truth.

No runtime tests were executed in this forensic pass.

---

## N. Immediate next work

Completed:

```text
[done] ActionDispatcher/BullMQ retry algebra
[done] OutboundDelivery retry/operator seam
[done] ScheduledAgentJob failure/routing trace
[done] TransactionalEmail crash-recovery trace
[done] Saga/compensation first pass
[done] reversal/refund/cancel taxonomy first pass
[done] provider idempotency standards comparison
[done] financial refund convergence trace
[done] operator recovery surface trace
[done] dead-letter-by-fabric classification
[done] initial recovery target pooling → KF-REC-048
```

Next:

```text
1. trace provider-effect-succeeded / local-persistence-failed crash windows beyond refunds
2. complete remaining material provider reversal/cancel matrix
3. harden the recovery authority model by back-auditing J15/J6
4. reinject KF-REC-048 into K11/K9/K8/K10
5. feed J18 recovery laws back into J23 L6 field/status/migration/proof mapping
6. decide whether J18 is mature enough to enter L5 value-engineering / target convergence
```

---

## O. Machine-readable record

```yaml
id: KF-JOURNEY-018
status: ACTIVE_FORENSICS_ENTERING_TARGET_POOLING
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_audit_head: 5ec358e9b792817eda1e37fd80a0574eb7905a8a
new_findings: [F150,F151,F152,F153,F154,F155,F156,F157]
new_contradictions: [C100,C101,C102,C103,C104,C105,C106,C107]
new_recommendations: [KF-REC-048]
recovery_matrix: docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md
operator_map: docs/intelligence/investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md
implementation_authorized: false
```
