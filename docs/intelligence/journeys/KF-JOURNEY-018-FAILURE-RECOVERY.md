# KF-JOURNEY-018 — Failure → Recovery

Status: ACTIVE FORENSICS / MICROSCOPIC RECOVERY PASS ADVANCED
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Last evidence pass: 2026-09-03 local / 2026-09-04 UTC
Primary kernels: K11 Recovery/Reliability, K7 Temporal/Event/Workflow
Secondary kernels: K8 Evidence/Outcome, K9 Integration/External Reality, K6 State Transition, K3 Governance
Primary adjacent journeys: J2 Governed Action, J6 Proactive KEY, J14 External Event Ingress, J15 Governance, J23 Temporal Flow

> J18 asks how KEYFLOWOS restores truthful, valid business work after failure. It is not a generic infrastructure uptime checklist. No production implementation is authorized.

---

## A. Definition

J18 covers failure after business intent exists:

- scheduler/poller failure;
- worker crash/stall;
- queue attempt failure;
- retry/backoff;
- dependency failure;
- partial domain mutation;
- provider timeout/uncertain outcome;
- provider-declared failure;
- local persistence failure after possible effect;
- dead-letter / operator intervention;
- cancellation/supersession during recovery;
- compensation/reversal/undo;
- state/evidence repair.

Central question:

> **After something fails, what truthful state remains, who owns recovery, and is the original work still valid to execute?**

---

## B. Recovery Taxonomy

J23 establishes the minimum classes J18 must preserve:

```text
RETRYABLE_ATTEMPT_FAILURE
  current attempt failed; logical work remains alive

FAILED_FINAL_CONFIRMED
  failure is definitive/non-retryable or retry budget exhausted

AWAITING_EXTERNAL
  provider accepted/request initiated; later lifecycle evidence expected

OUTCOME_UNKNOWN
  external effect may exist; do not blind-retry

EXPIRED
  work missed its validity/lateness window

CANCELLED
  future execution right removed

SUPERSEDED
  replaced by newer work/definition/action

SUCCEEDED
  required terminal OutcomeEvidence exists
```

Do not collapse these into one `FAILED` flag.

Recovery adds a second orthogonal axis for already-attempted effects:

```text
RECOVERY_NOT_REQUIRED
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Execution outcome and recovery outcome must not compete for one status field.

---

## C. Recovery Algorithm

```text
failure / crash / timeout
→ identify logical WorkOccurrence + exact EffectId
→ establish current ownership state
→ classify certainty
→ did effect possibly cross point of no return?
   yes + uncertain → OUTCOME_UNKNOWN → reconcile first
→ is work still live?
   check cancellation/supersession/expiry
→ is original action still valid?
   check definition/action version + source state + authority/policy/clearance
→ retry/resume only if valid
→ preserve same logical/effect identity
→ if reversal/compensation is required, create a distinct recovery effect identity
→ preserve original outcome AND recovery outcome
→ terminalize only from confirmed outcome or explicit expiry/cancel/supersede/final failure
```

Recovery means restoring truthful state, not merely making a worker run again.

---

## D. Live Recovery Fabrics — Microscopic Map

### AI plan / BullMQ

Strong seams:

- durable Redis queue;
- stable jobId from plan-step idempotency key;
- delayed jobs;
- attempts + exponential backoff;
- worker lock/stalled recovery;
- QueueEvents failure observation.

Known/reused defects:

- F139 retryable BullMQ attempt is persisted as terminal AiPlanStep `failed`;
- F140 logical/transport state compression;
- plan dependency/finalization can react to transient failure state.

New J18 defect F150 is now verified end-to-end:

```text
BullMQ attempt 1, key K
→ ActionDispatcher inline attempts exhaust
→ failed AiExecutionLog with K
→ BullMQ schedules attempt 2
→ ActionDispatcher idempotency lookup finds failed K
→ stored failure returned
→ no new effect attempt
```

The outer durable retry policy is therefore defeated by the failed idempotency tombstone.

### ActionDispatcher

Strong seams:

- centralized execution seam;
- governance check;
- idempotency lookup;
- inline retry/backoff;
- circuit breaker;
- execution log;
- events;
- feedback hook;
- undo registration.

Recovery limits:

- inline retry sleeps are process-local/non-durable;
- circuit breaker state is process-local `Map` and resets per process/restart;
- failed idempotency result is treated as reusable terminal evidence, conflicting with outer retries;
- idempotency lookup is not the atomic ExecutionClaim target previously required by K11.

Do not create ActionDispatcherV2; strengthen this seam.

### OutboundDelivery / DeliveryEvent

Strongest current generic outbound recovery seam:

```text
Queued/Scheduled/RetryPending
→ expected-state claim → Sending
→ adapter attempt
→ Published | RetryPending | Failed
→ durable DeliveryEvent per attempt
```

Preserved evidence:

- stable `OutboundDelivery.id`;
- retry count and next retry time;
- result/error snapshots;
- provider external IDs when returned;
- durable attempt events;
- authenticated operator `retry` / `retryAllFailed` surfaces.

External-truth defect remains F149 rather than a new root:

```text
adapter error
→ success=false + isTransient=true
→ RetryPending
```

The adapter contract has no first-class `OUTCOME_UNKNOWN` and does not require a provider/native effect-idempotency key. A timeout can therefore become a retry even when the prior request may have crossed the external point of no return. Manual retry has the same ambiguity because `Failed` is not certainty-typed.

Target operator rule:

> A retry button is safe only after the system can distinguish confirmed non-effect from uncertain possible effect.

### ScheduledAgentJob

Reused roots F122/F123 remain canonical.

Observed consumer:

```text
find PENDING due jobs
→ executeScheduledJob()
→ COMPLETED
catch → FAILED
```

No generic retry/dead-letter consumer for `FAILED` was observed in this pass.

The generic consumer handles only:

- `quote_followup`;
- `post_purchase_review_request`;
- `post_purchase_reorder_prompt`.

Live producers also create job types including:

- `lead_magnet_enroll`;
- `review_solicitation`;
- `abandoned_cart_recovery`.

Unknown types are logged and return normally, so the generic caller can mark them `COMPLETED`. This strengthens F122/F123; do not duplicate.

### TransactionalEmail / CustomerNotificationLog queue

F144 revalidated:

```text
find QUEUED
→ no atomic drain claim
→ call send() WITHOUT original entry.messageId as dedupeKey
→ provider effect
→ original queued row DRAINED
```

Concurrent drains or crash after provider send before `DRAINED` can duplicate the effect.

### safeInterval / ErrorRegistry

Positive infrastructure containment:

- `safeInterval()`/`runGuarded()` catches synchronous/rejected tick failures;
- bounded ErrorRegistry captures local errors;
- optional Sentry forwarding exists when configured.

But:

```text
ERROR CONTAINMENT / OBSERVABILITY
!= DURABLE WORK RECOVERY
```

The ErrorRegistry is process-memory state. Recovery ownership remains domain/work specific.

### UndoService

F151 remains verified:

```text
successful action
→ registerAction()
→ process-local recentActions Map
→ five-minute setTimeout expiry
```

Restart/replica change loses eligibility.

And:

```text
UNDO != ROLLBACK != RETRY != REVERSAL != COMPENSATION
```

### SagaExecution / SagaStep

The previous J23 reachability note required refinement.

The generic `KeyCortexSagaExecutorService` remains weakly reached, but the production `KeyCortexPlannerService.executePlan()` itself now:

```text
plan execution
→ SagaExecution.start()
→ add SagaStep + compensation metadata BEFORE each effect
→ execute command
→ complete/fail step
→ compensate on failure
```

This is a real durable recovery seam worth preserving.

However three J18 defects are now verified:

#### F152 — compensation success can be false

`KeyCortexSagaService.compensate()` marks a step `compensated` whenever the compensation handler does not throw. Some handlers can no-op on missing identifiers/services. Message recall cannot retract a provider-delivered message but can still return without error.

Therefore:

```text
handler returned
!= inverse effect confirmed
```

#### F153 — approval wait can become parent failure

`KeyCortexExecutorService` returns approval-pending as a deliberate control state. Planner writes the current step `waiting_approval`, then calculates plan final status from the stale `plan.steps` snapshot loaded before the update.

Possible durable state:

```text
AiPlanStep = waiting_approval
AiPlan = failed
SagaExecution = failed
```

`AWAITING_CONTROL` is not failure.

#### F154 — compensation result is overwritten

On failure:

```text
saga.compensate()
→ SagaExecution = compensated | compensation_failed | compensation_unavailable
→ planner finalization calls failSaga()
→ SagaExecution = failed
```

Saga-level recovery truth is therefore erased even where step-level evidence survives.

---

## E. Identity Layers

Recovery must preserve:

```text
WorkOccurrenceId
AttemptId
WorkerClaimId
ExecutionClaimId / EffectId
ProviderOperationId
OutcomeEvidenceId
RecoveryEffectId
Compensation/ReversalId
RecoveryOutcomeEvidenceId
```

A new attempt is not a new business effect unless business intent explicitly says so.

A compensation/reversal IS a distinct recovery effect and needs its own authority/evidence.

---

## F. Retry Policy

Before retry:

```text
1. classify previous failure certainty
2. ensure prior effect not already succeeded/unknown externally
3. ensure same occurrence still live
4. check expiry/lateness
5. check cancellation/supersession
6. check definition/action version
7. check current source state
8. check authority/autonomy/clearance freshness where material
9. preserve same EffectId/idempotency identity
10. ensure failed-attempt evidence is not incorrectly terminalizing the effect key
11. then claim next attempt
```

Retry is a transition of an existing logical occurrence, not a fresh action request.

---

## G. Compensation / Reversal

Target distinction:

```text
RETRY
  attempt same intended effect again

CANCEL
  prevent not-yet-effective work

REVERSAL
  provider/domain native inverse transaction of a completed effect

COMPENSATION
  new business action intended to mitigate/offset prior effect

UNDO UX
  convenience surface mapping to cancellation, reversal, compensation or annotation
```

Recovery evidence must distinguish:

```text
requested
attempted
confirmed inverse effect
failed inverse effect
unavailable
mitigation-only
```

Compensation is never proof the original action never happened.

---

## H. Dead Letter / Operator Recovery

Observed positive operator seam:

- outbound delivery list/event history;
- authenticated manual retry per failed delivery;
- retry-all-failed for one content item.

But operator retry currently lacks certainty typing: `Failed` can include a provider ambiguity root strengthened by F149.

Target operator recovery must answer:

```text
what failed?
which WorkOccurrence / EffectId?
what is the strongest known external outcome?
is retry safe?
has retry budget expired?
is work still relevant/authorized?
was compensation attempted?
what did compensation actually do?
what can the operator do:
  retry
  cancel
  reconcile
  compensate/reverse
  mark resolved with evidence
```

`Temporal Work Projection` (KF-REC-047) is the natural read-model consumer while domain/work records remain sources of truth.

No universal dead-letter table is accepted yet.

---

## I. J18 Invariants

1. attempt failure does not imply logical-work failure;
2. a retry preserves logical occurrence and effect identity;
3. failed idempotency evidence must not defeat an explicitly retryable logical effect;
4. successful idempotency evidence must prevent duplicate effect;
5. ambiguous external outcome is reconciled before unsafe retry;
6. cancellation/supersession/expiry is checked before recovery executes work;
7. recovery revalidates material action/governance/source-state freshness;
8. durable work recovery survives process restart where business semantics require it;
9. horizontal replica count does not multiply retries/effects;
10. error containment is not durable recovery;
11. undo is not synonymous with rollback/reversal/compensation;
12. compensation/reversal has its own authority and OutcomeEvidence;
13. operator recovery never converts uncertainty into false success/failure;
14. terminal states cannot regress from late worker bookkeeping;
15. retry budget/backoff are observable and tied to logical work;
16. a control wait is resumable work, not failure;
17. compensation-handler return is not proof of inverse effect;
18. irreversible external effects cannot be represented as undone by local annotation;
19. execution outcome and recovery outcome remain independently durable;
20. parent workflow state derives from durable current child state, not stale snapshots.

---

## J. Findings

New J18 findings:

- F150 — failed ActionDispatcher execution log becomes an idempotency hit that defeats subsequent BullMQ retries for the same plan-step key.
- F151 — UndoService compensation/undo eligibility is process-local, time-based memory and is lost across restart/other replicas.
- F152 — Saga compensation can be recorded as successful from a non-throwing no-op or non-reversing handler.
- F153 — KeyCortex planner can persist a step `waiting_approval` while terminalizing its parent plan/saga as `failed` from stale in-memory state.
- F154 — planner finalization overwrites saga compensation outcome with generic `failed`.

Reused, do not duplicate:

- F050/F051 execution/idempotency ownership weaknesses;
- F097 proactive scheduled occurrence claim weakness;
- F122/F123 ScheduledAgentJob ownership/routing;
- F127 ingress failed-after-first-seen recovery suppression;
- F136 non-durable Chatwoot acceptance;
- F137–F149 J23 temporal/cancellation/lateness/version/external-outcome findings.

Canonical supplement: `docs/intelligence/08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`.

---

## K. Contradictions

- C100 — durable BullMQ retry vs failed idempotency record preventing a new effect attempt.
- C101 — user-facing undo eligibility vs process-local/non-replicated compensation registry.
- C102 — durable `compensated` claim vs handler semantics that may perform no inverse effect.
- C103 — durable child approval wait vs parent planner/saga terminalized as failure.
- C104 — compensation outcome persisted by SagaService vs planner overwriting it with generic failure.

Canonical supplement: `docs/intelligence/09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`.

---

## L. Open Questions

1. Which failure classes in each current executor are retryable vs final?
2. Which domains have provider-native reversal/refund/cancel APIs and what constitutes terminal reversal evidence?
3. Which current retries preserve provider/native idempotency keys?
4. Where are dead-letter/repair surfaces exposed to operators beyond OutboundDelivery?
5. What happens when local persistence fails after provider acceptance in each integration?
6. Which circuit breakers/health gates must be distributed vs intentionally local?
7. Which compensation operations require new human control vs inherit bounded recovery authority?
8. How should retry budget interact with plan/autonomy/spend limits?
9. Which work can self-heal automatically and which requires manual review after repeated failure?
10. What historical evidence is required to reconstruct recovery after data/service restoration?
11. Which saga compensation handlers can prove a real inverse effect versus only local mitigation?
12. What exact signal resumes a KeyCortex plan after approval, preserving the same occurrence/action identity?
13. Should recovery outcome be modeled as typed evidence/projection instead of additional overloaded status values?

---

## M. Immediate Microscopic Next Work

Completed in this pass:

```text
[done] ActionDispatcher idempotency + BullMQ retry algebra
[done] OutboundDelivery adapter failure classes / operator retry seam
[done] ScheduledAgentJob generic FAILED/routing trace
[done] CustomerNotificationLog queue crash-recovery revalidation
[done] SagaExecution reachability + compensation correctness first pass
```

Next:

```text
1. trace provider/domain reversal, refund and cancellation semantics
2. trace operator diagnostics/repair endpoints across AI plans, ScheduledAgentJob, ingress and sagas
3. classify dead-letter semantics by work family
4. build per-fabric retry/recovery certainty matrix
5. trace crash windows after provider effect but before local persistence for representative providers
6. define recovery authority/control requirements
7. pool J18 findings into target recovery laws/recommendations only after comparison
8. reinject J18 into J23/K11/K9/K8/J15/J6
9. finish J23 L6 blockers using the stronger recovery model
```

---

## N. Machine-readable Record

```yaml
id: KF-JOURNEY-018
type: journey
status: ACTIVE_FORENSICS_MICROSCOPIC_PASS_ADVANCED
admitted_from:
  - KF-JOURNEY-023
  - KF-KERNEL-011
  - KF-KERNEL-009
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_audit_head: 5ec358e9b792817eda1e37fd80a0574eb7905a8a
primary_kernels:
  - KF-KERNEL-011
  - KF-KERNEL-007
affected_kernels:
  - KF-KERNEL-003
  - KF-KERNEL-006
  - KF-KERNEL-008
  - KF-KERNEL-009
new_findings:
  - F150
  - F151
  - F152
  - F153
  - F154
new_contradictions:
  - C100
  - C101
  - C102
  - C103
  - C104
recovery_classes:
  - RETRYABLE_ATTEMPT_FAILURE
  - FAILED_FINAL_CONFIRMED
  - AWAITING_EXTERNAL
  - OUTCOME_UNKNOWN
  - EXPIRED
  - CANCELLED
  - SUPERSEDED
  - SUCCEEDED
recovery_outcome_axis:
  - RECOVERY_AVAILABLE
  - RECOVERY_REQUESTED
  - RECOVERY_ATTEMPTED
  - RECOVERY_SUCCEEDED_CONFIRMED
  - RECOVERY_FAILED
  - RECOVERY_UNAVAILABLE
  - MITIGATION_ONLY
implementation_authorized: false
```
