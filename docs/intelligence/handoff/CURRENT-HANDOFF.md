# KeyFlowOS Current Handoff

Last updated: 2026-09-03 local / 2026-09-04 UTC

## Load first

Read in order:

1. `docs/intelligence/00-START-HERE.md`
2. `docs/intelligence/07-CURRENT-STATE.md`
3. `docs/intelligence/handoff/CURRENT-STATE.yaml`
4. `docs/intelligence/journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
5. `docs/intelligence/08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
6. `docs/intelligence/09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
7. active J23/K7/K8/K9/K11 materials referenced by current state.

Also keep loaded:

- `docs/intelligence/journeys/KF-JOURNEY-023-TEMPORAL-FLOW-LONG-RUNNING-WORKFLOW.md`
- `docs/intelligence/investigations/J23-TARGET-CONVERGENCE-AND-MIGRATION-MAP.md`
- `docs/intelligence/investigations/J23-EXTERNAL-OUTCOME-UNCERTAINTY-AND-RECONCILIATION.md`
- `docs/intelligence/investigations/J23-BACKWARD-REINJECTION-LATENESS-VERSIONING-EXTERNAL-OUTCOME.md`
- `docs/intelligence/kernels/KF-KERNEL-007-TEMPORAL-EVENT-WORKFLOW.md`
- `docs/intelligence/kernels/KF-KERNEL-008-EVIDENCE-OUTCOME.md`
- `docs/intelligence/kernels/KF-KERNEL-009-INTEGRATION-EXTERNAL-REALITY.md`
- `docs/intelligence/kernels/KF-KERNEL-011-RECOVERY-RELIABILITY.md`
- all canonical `08*`, `09*`, `10*` continuations.

## Context integrity

`PASS`

Implementation evidence:

```text
main head:           5ec358e9b792817eda1e37fd80a0574eb7905a8a
code-bearing base:   d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
head change class:   audit-only
```

Revalidate if `main` gains code-bearing changes.

Production implementation remains unauthorized.

## Current analytical position

```text
J23 Temporal Flow / Long-Running Workflow
  = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
        ↓ pressure/reinjection
J18 Failure → Recovery
  = ACTIVE FORENSICS / MICROSCOPIC PASS ADVANCED
```

Active constellation remains:

```text
J1 Business Birth
↕ J25 Human Authority
↕ J2 Governed Action
↕ J15 Approval / Governance
↕ J6 Proactive KEY / Autonomy
↕ J14 External Event Ingress
↕ J23 Temporal Flow
↕ J18 Failure / Recovery
```

## Canonical ranges

```text
Findings:        F154
Contradictions:  C104
Recommendations: KF-REC-047
```

Do not create a new recovery recommendation merely because a defect exists. Pool and semantically reconcile J18 first. Existing recommendations already cover provider reconciliation, logical-vs-attempt state, causal/effect identity and the Temporal Work Projection.

Latest canonical additions:

```text
F150 failed ActionDispatcher idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local/non-replicated
F152 saga compensation can falsely report `compensated`
F153 KeyCortex approval wait can become parent plan/saga failure
F154 planner overwrites saga compensation outcome with generic failed

C100 retry policy vs idempotency terminality
C101 recovery promise vs recovery-state durability
C102 compensated claim vs confirmed inverse effect
C103 child control wait vs parent workflow failure
C104 recovery outcome vs generic failed overwrite
```

## J18 recovery model now established

Failure certainty axis:

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

Core law:

```text
ORIGINAL EXECUTION OUTCOME
!=
RECOVERY / COMPENSATION OUTCOME
```

Both must remain durable.

## Completed microscopic traces in current J18 pass

### ActionDispatcher + BullMQ

Confirmed F150:

```text
BullMQ attempts remain
→ ActionDispatcher writes failed AiExecutionLog with idempotency key K
→ later BullMQ attempt reuses K
→ dispatcher returns stored failure
→ no new effect attempt
```

Preserve ActionDispatcher as the central seam; do not create `ActionDispatcherV2`.

### OutboundDelivery / DeliveryEvent

Strong positive seam:

- stable delivery identity;
- expected-state `Sending` claim;
- retry count/backoff;
- durable attempt events;
- provider IDs/result snapshots;
- authenticated manual retry and retry-all-failed surfaces.

But `success/isTransient` still lacks `OUTCOME_UNKNOWN` semantics and provider/native idempotency identity. Manual retry is unsafe when `Failed` actually means ambiguous possible external effect. This strengthens F149/KF-REC-037; no duplicate finding.

### ScheduledAgentJob

F122/F123 remain the canonical roots.

Generic consumer handles only three job types while live producers create additional types. Unknown type can log-and-return, then be marked `COMPLETED`. Generic `FAILED` has no observed generic retry/dead-letter consumer.

### CustomerNotificationLog drain

F144 revalidated: no atomic drain claim and original queued dedupe/effect identity is dropped during replay.

### Saga / compensation

Important refinement: the generic `KeyCortexSagaExecutorService` is weakly reached, but the production `KeyCortexPlannerService.executePlan()` itself creates durable SagaExecution/SagaStep records and stores compensation metadata before effect.

That is a real seam to preserve.

But:

```text
handler returned without throw
!= compensation effect confirmed                 [F152]

AiPlanStep = waiting_approval
!= AiPlan/Saga = failed                           [F153]

Saga = compensated/compensation_failed/unavailable
must not be overwritten by Saga = failed         [F154]
```

## Current positive seams

Prefer strengthening:

- BullMQ stable job identity / delays / attempts / locks / stalled recovery;
- ActionDispatcher central effect boundary;
- OutboundDelivery + DeliveryEvent;
- SagaExecution + SagaStep durable history;
- quote-followup cancellation + current-state revalidation;
- K9 provider reconciliation concepts;
- Temporal Work Projection as future operator/recovery read model.

## Exact next actions

Remain read-only for production code.

1. Trace provider/domain **reversal, refund and cancellation** semantics: payments/refunds, invoices, bookings, messages/social and other materially external effects.
2. Trace operator diagnostics/repair endpoints across AI plans, ScheduledAgentJob, ingress occurrences and sagas.
3. Classify dead-letter semantics by work family rather than assuming one global queue.
4. Build a per-fabric recovery matrix:
   `failure certainty → retry identity → external point-of-no-return → operator action → terminal evidence`.
5. Trace representative crash windows after possible provider effect but before local persistence.
6. Determine recovery authority/control requirements: which retry/reconcile/reverse/compensate operations need fresh Clearance.
7. Compare with external standards/OSS recovery models and reinject only adopted properties.
8. Pool J18 into K11/K9/K8/J23; then re-audit J15/J6 where recovery can create a new material action.
9. Only after J18 semantics stabilize, finish the remaining J23 L6 field/status mapping, migration compatibility, projection/materialization and proof plan.

## J23 decisions still in force

```text
shared durable-work semantic contract     YES
shared Temporal Work Projection           YES
universal WorkOccurrence table            NOT JUSTIFIED YET
universal workflow runtime                NOT JUSTIFIED YET
```

Do not install Temporal/Camunda from findings alone.

## Do not

- modify production code;
- create parallel `v2` sources of truth;
- treat transport state as logical-work truth;
- treat provider acceptance as delivery/settlement;
- blindly retry `OUTCOME_UNKNOWN`;
- treat a non-throwing compensation handler as confirmed reversal;
- treat `AWAITING_CONTROL` as failure;
- erase recovery outcome with original execution failure;
- delete legacy without consumer proof;
- claim tests/runtime proof unless actually executed.
