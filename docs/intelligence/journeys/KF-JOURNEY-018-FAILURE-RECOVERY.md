# KF-JOURNEY-018 — Failure → Recovery

Status: ACTIVE FORENSICS / ADMITTED FROM J23-K11-K9 PRESSURE
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
→ terminalize only from confirmed outcome or explicit expiry/cancel/supersede/final failure
```

Recovery means restoring truthful state, not merely making a worker run again.

---

## D. Live Recovery Fabrics — Initial Map

### AI plan / BullMQ

Strong seams:

- durable Redis queue;
- stable jobId from plan-step idempotency key;
- delayed jobs;
- attempts + exponential backoff;
- worker lock/stalled recovery;
- QueueEvents failure observation.

Known defects/reused findings:

- F139 retryable BullMQ attempt is persisted as terminal AiPlanStep `failed`;
- F140 logical/transport state compression;
- approval waits can be encoded as worker failure in one branch;
- plan dependency/finalization can react to transient failure state.

New J18 defect F150:

```text
ActionDispatcher inner retries exhaust
→ failed AiExecutionLog written with idempotency key K
→ BullMQ retries same job K
→ ActionDispatcher idempotency lookup finds failed log K
→ returns stored failure without a new effect attempt
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
- failed idempotency result is treated as a reusable terminal result, conflicting with outer retries;
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

It preserves retry count, next retry time, provider IDs/result snapshots and attempt evidence.

J23/K9 still require external acceptance/delivery/outcome-unknown reconciliation where channel semantics demand it.

### ScheduledAgentJob

Known reused findings:

- F122 competing consumer ownership;
- F123 no atomic execution claim;
- unknown job type can be falsely completed;
- generic failures become `FAILED` with no observed generic retry/dead-letter state in the inspected path;
- cancellation can lose after row selection;
- descendant handoff can remain queued after upstream job says complete.

### TransactionalEmail CustomerNotificationLog queue

Known F144:

- no atomic drain claim;
- original dedupe/effect identity not preserved into drain send;
- crash/concurrent drains can duplicate.

### safeInterval / ErrorRegistry

Positive infrastructure containment:

- `safeInterval()`/`runGuarded()` catches sync/rejected background tick failures rather than allowing them to hit fatal unhandled-rejection process exit;
- failures are recorded in a bounded ErrorRegistry;
- optional Sentry forwarding exists when a client is actually configured.

Important distinction:

```text
ERROR CONTAINMENT / OBSERVABILITY
!= DURABLE RECOVERY
```

The local ErrorRegistry is process-memory state. Work-specific persistence/next-tick recovery remains owned by each scheduler/domain.

### UndoService

New J18 defect F151:

```text
successful action
→ registerAction()
→ process-local recentActions Map
→ 5-minute setTimeout expiry
```

The undo eligibility disappears on restart and is not shared across horizontally scaled replicas.

Also, undo semantics are effect-specific:

- some entities can be reverted/cancelled;
- confirmed/completed bookings cannot be simply undone;
- sent messages cannot be unsent; message undo returns `noted_for_review`.

Therefore:

```text
UNDO != ROLLBACK != RECOVERY != COMPENSATION
```

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
Compensation/ReversalId
```

A new attempt is not a new business effect unless the business intent explicitly says so.

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
10. then claim next attempt
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
  user-facing convenience that may map to cancellation, reversal, compensation or mere annotation
```

These require separate evidence and authority.

Compensation is not proof the original action never happened.

---

## H. Dead Letter / Operator Recovery

Target operator recovery should answer:

```text
what failed?
which occurrence/effect?
what is the strongest known external outcome?
is retry safe?
has retry budget expired?
is work still relevant/authorized?
what can the operator do: retry, cancel, reconcile, compensate, mark resolved?
```

`Temporal Work Projection` (KF-REC-047) is the natural read-model consumer for this, while domain/work records remain sources of truth.

No universal dead-letter table is accepted yet.

---

## I. Initial J18 Invariants

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
11. undo is not synonymous with rollback/compensation;
12. compensation/reversal has its own authority and OutcomeEvidence;
13. operator recovery never converts uncertainty into false success/failure;
14. terminal states cannot regress from late worker bookkeeping;
15. retry budget/backoff are observable and tied to logical work.

---

## J. Initial Findings

New:

- F150 — failed ActionDispatcher execution log becomes an idempotency hit that defeats subsequent BullMQ retries for the same plan-step key.
- F151 — UndoService compensation/undo eligibility is process-local, time-based memory and is lost across restart/other replicas.

Reused, do not duplicate:

- F050/F051 execution/idempotency ownership weaknesses;
- F097 proactive scheduled occurrence claim weakness;
- F122/F123 ScheduledAgentJob ownership/routing;
- F127 ingress failed-after-first-seen recovery suppression;
- F136 non-durable Chatwoot acceptance;
- F137–F149 J23 temporal/cancellation/lateness/version/external-outcome findings.

---

## K. Initial Contradictions

- C100 declared durable BullMQ retry vs failed idempotency record preventing a new effect attempt.
- C101 user-facing undo eligibility vs process-local/non-replicated compensation registry.

---

## L. Open Questions

1. Which failure classes in each current executor are retryable vs final?
2. Which domains have provider-native reversal/refund/cancel APIs?
3. Which current retries preserve provider/native idempotency keys?
4. Where are dead-letter/repair surfaces exposed to operators today?
5. What happens when local persistence fails after provider acceptance in each integration?
6. Which circuit breakers/health gates must be distributed vs intentionally local?
7. Which compensation operations need new human control vs inherit a bounded recovery authority?
8. How should retry budget interact with plan/autonomy/spend limits?
9. Which work can self-heal automatically and which requires manual review after repeated failure?
10. What historical evidence is required to reconstruct recovery after data/service restoration?

---

## M. Immediate Microscopic Next Work

```text
1. trace ActionDispatcher idempotency + retry algebra completely
2. trace OutboundDelivery adapter failure classes and provider idempotency
3. trace ScheduledAgentJob FAILED rows for retry/repair consumers
4. trace CustomerNotificationLog queue crash recovery
5. trace SagaExecution reachability + compensation correctness
6. trace provider-side reversals/refunds/cancellations
7. trace operator diagnostics/repair endpoints
8. classify dead-letter semantics
9. pool mature findings/contradictions
10. reinject J18 into J23/K11/K9/K8/J15/J6
```

---

## N. Machine-readable Record

```yaml
id: KF-JOURNEY-018
type: journey
status: ACTIVE_FORENSICS
admitted_from:
  - KF-JOURNEY-023
  - KF-KERNEL-011
  - KF-KERNEL-009
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
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
new_contradictions:
  - C100
  - C101
recovery_classes:
  - RETRYABLE_ATTEMPT_FAILURE
  - FAILED_FINAL_CONFIRMED
  - AWAITING_EXTERNAL
  - OUTCOME_UNKNOWN
  - EXPIRED
  - CANCELLED
  - SUPERSEDED
  - SUCCEEDED
implementation_authorized: false
```
