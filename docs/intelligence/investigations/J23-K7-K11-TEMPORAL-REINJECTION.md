# J23 → K7/K11 Temporal Reinjection

Status: CANONICAL CROSS-KERNEL REINJECTION / READ-ONLY ARCHITECTURE
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Source journey: `KF-JOURNEY-023-TEMPORAL-FLOW-LONG-RUNNING-WORKFLOW.md`

This supplement is used instead of risky whole-file replacement of the current kernel dossiers. It is authoritative continuation evidence for K7 and K11 until a safe compaction/export pass.

---

## 1. K7 — Temporal / Event / Workflow reinjection

### Refined kernel responsibility

K7 owns the semantics of business work across time:

```text
DEFINITION
→ OCCURRENCE
→ ELIGIBILITY / WAIT
→ WORKFLOW COORDINATION
→ LOGICAL STEP STATE
→ wake/resume/cancel/supersede
```

K7 does **not** own side-effect authorization or final execution ownership:

```text
K3 owns Control/Clearance
K11 owns ExecutionClaim/retry/recovery
K8 owns OutcomeEvidence
K9 owns provider/external reconciliation
```

### Canonical temporal identity ladder

```text
DefinitionId
OccurrenceId
WorkflowInstanceId
StepId
WorkerClaimId
ExecutionClaimId
AttemptId
OutcomeId
```

These may be represented by existing model IDs; the semantic roles must remain distinct.

### Canonical logical-work states

```text
SCHEDULED
ELIGIBLE
CLAIMED
RUNNING
WAITING_TIME
AWAITING_CONTROL
AWAITING_DEPENDENCY
AWAITING_EXTERNAL
RETRYING
SUCCEEDED
FAILED_FINAL
OUTCOME_UNKNOWN
CANCELLED
SUPERSEDED
```

### K7 invariants strengthened by J23

1. Definition identity is not occurrence identity.
2. Replica count cannot multiply one logical occurrence.
3. Waiting is non-terminal.
4. A timer/delay must block downstream dependencies until wake-up.
5. Control waiting is workflow suspension, not execution failure.
6. Dependency waiting is not worker ownership.
7. Retry preserves occurrence/step identity while attempt identity changes.
8. Logical step truth is not queue/worker transport truth.
9. Cancellation/supersession is a temporal state transition, not deletion of history.
10. Process-local schedulers may discover eligibility but do not prove distributed ownership.
11. Long-lived work must survive process/server restart when product semantics promise persistence.
12. Workflow completion must not be used as proof of external/business outcome.

### Current contradictions reinjected

- F137 / C088: FlowRunner long delay is falsely completed.
- F138 / C089: DelegationLoop human-control wait is falsely completed.
- F139 / C090: retryable BullMQ attempt is persisted as terminal logical failure.
- F140 / C091: queue state and logical workflow state are compressed.
- Existing F097/F112/F122/F123 remain active shared K7 evidence.

---

## 2. K11 — Recovery / Reliability reinjection

### Refined K7/K11 boundary

K7 answers:

```text
WHAT logical work exists now?
WHY is it waiting/eligible/terminal?
```

K11 answers:

```text
WHO owns the current processing/execution attempt?
HOW does failure/retry/crash/reconciliation behave safely?
```

### Two ownership layers

J23 strengthens the need to distinguish:

```text
WORKER / COORDINATION CLAIM
= ownership of progressing a durable work occurrence

EXECUTION CLAIM
= ownership of consuming exact-action clearance and performing a material effect
```

They may coincide in simple workers but are not semantically interchangeable.

### Attempt lifecycle

```text
CLAIMED
→ RUNNING
→ ATTEMPT_SUCCEEDED
   | ATTEMPT_FAILED_RETRYABLE
   | ATTEMPT_FAILED_FINAL
   | OUTCOME_UNKNOWN
```

Mapping to logical work:

```text
ATTEMPT_FAILED_RETRYABLE
→ logical work RETRYING / non-terminal

ATTEMPT_FAILED_FINAL
→ logical work may become FAILED_FINAL

OUTCOME_UNKNOWN
→ reconcile before unsafe repeat
```

### K11 invariants strengthened by J23

1. Failed attempt != failed logical work.
2. Queued job != active claimant.
3. Worker lock/lease != exact side-effect ExecutionClaim.
4. Retry increments attempt identity but preserves logical occurrence identity.
5. Stalled/crashed worker can release/recover ownership under explicit semantics.
6. Late worker bookkeeping cannot regress an already-terminal logical state.
7. Retries must honor cancellation/supersession before starting a new effect.
8. External-effect ambiguity is `OUTCOME_UNKNOWN`, not generic failure.
9. Retry/backoff state must be visible to dependency/finalization logic.
10. Provider/dispatcher idempotency remains required where duplicate external effects are possible.

### Existing strong seams to preserve

- BullMQ locks/stalled recovery/retry/backoff;
- WhatsApp scheduled-message CAS claim;
- EmailCampaign CAS claim;
- ActionDispatcher as preferred post-clearance effect seam;
- Saga compensation/evidence concepts where truly reached;
- provider-specific reconciliation/idempotency.

---

## 3. Unified schematic

```text
K7:  Work Definition
          ↓
     Work Occurrence
          ↓
     WAIT / ELIGIBLE
          ↓
K11: Worker Claim
          ↓
     Attempt
          ↓
K3:  Clearance if required
          ↓
K11: ExecutionClaim
          ↓
K5/K6/K9: effect
          ↓
K8: OutcomeEvidence
          ↓
K7: next wait / terminal state
```

Critical rule:

```text
A QUEUE IS AN EXECUTION MECHANISM.
IT IS NOT THE CANONICAL BUSINESS-WORK STATE MODEL.
```

---

## 4. Technology verdict

Current evidence supports semantic convergence using existing PostgreSQL/CAS/BullMQ/domain models before adopting a dedicated durable-workflow platform.

Temporal/Camunda-class runtimes remain research references for properties such as durable waits, signals, retries, incidents and recovery. Adoption is deferred until an explicit complexity/operational threshold is demonstrated.

No production implementation is authorized by this reinjection.
