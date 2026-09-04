# KeyFlowOS Recommendation Register — Temporal Work Continuation

Status: CANONICAL CONTINUATION OF `10A-RECOMMENDATION-REGISTER-INGRESS-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-037.

---

## KF-REC-038 — Establish a Durable Work Occurrence semantic contract across existing models

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K11 Recovery/Reliability

Define one shared semantic contract for long-lived business work without immediately requiring one universal persistence table or runtime.

Required identities/properties:

```text
DefinitionId
OccurrenceId
Parent/Cause
Scheduled/Eligible time
Logical Work State
Worker Claim/Lease
Attempt identity
Control/wait reason
ExecutionClaim linkage
OutcomeEvidence linkage
Cancellation/Supersession
```

Existing models may implement this contract differently during migration:

- FlowRun / FlowRunStep;
- AiPlan / AiPlanStep;
- ScheduledAgentJob;
- DelegationLoopRun;
- channel-specific scheduled rows;
- SagaExecution where appropriate.

The objective is semantic convergence first. Introduce a shared physical WorkOccurrence model only if subsequent migration analysis proves it materially reduces duplication and failure modes.

Affected journeys: J2, J6, J14, J15, J18, J23 and other long-lived work journeys.

---

## KF-REC-039 — Make waiting a first-class durable workflow state and resume the same occurrence

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K3 Governance, K7 Temporal, K11 Recovery

Long-running work can legitimately wait for different conditions:

```text
WAITING_TIME
AWAITING_CONTROL
AWAITING_DEPENDENCY
AWAITING_EXTERNAL
```

These states must remain non-terminal and durably resumable.

Target pattern:

```text
logical occurrence O
→ RUNNING
→ WAITING_<reason>
→ durable wake condition
→ ELIGIBLE
→ new attempt on O
```

Do not represent waiting by:

- marking the step/run completed;
- sleeping a process for long periods;
- throwing a queue execution failure merely because approval is required;
- creating an unrelated replacement occurrence unless business semantics genuinely changed.

Control evidence/clearance remains governed by J15; this recommendation only ensures temporal suspension/resumption preserves the same bounded work lineage.

Affected journeys: J2, J6, J15, J18, J23.

---

## KF-REC-040 — Separate logical workflow state from worker/transport attempt state

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal, K8 Evidence, K11 Recovery

Do not let BullMQ/cron/process-attempt state directly define whether a logical business step is terminal.

Target distinction:

```text
LOGICAL STEP
SCHEDULED
ELIGIBLE
AWAITING_CONTROL
AWAITING_DEPENDENCY
RUNNING
RETRYING
SUCCEEDED
FAILED_FINAL
CANCELLED
SUPERSEDED
OUTCOME_UNKNOWN

ATTEMPT / TRANSPORT
WAITING
DELAYED
ACTIVE
STALLED
ATTEMPT_FAILED
COMPLETED
```

Rules:

1. `ATTEMPT_FAILED + retries remain` → logical step remains non-terminal (`RETRYING`).
2. only exhausted/non-retryable failure → `FAILED_FINAL`.
3. dependent steps react to logical terminal state, not a transient failed attempt.
4. `queued` does not imply an active worker.
5. a terminal logical state must not be overwritten by late queue/poller bookkeeping.

Preserve BullMQ's existing locking/retry/stall mechanics; correct the mapping around them rather than replacing the queue.

Affected journeys: J2, J6, J18, J23.

---

## KF-REC-041 — Converge temporal runtimes incrementally; adopt a dedicated durable workflow engine only against an explicit complexity threshold

**Status:** PROVISIONAL / VALUE-ENGINEERING TARGET

**Primary kernels:** K7 Temporal, K11 Recovery

Current evidence does not justify replacing all temporal work with a new workflow platform.

Near-term strategy:

```text
shared semantic contract
→ strengthen DB CAS/unique occurrence seams
→ strengthen existing BullMQ delayed/retry/stalled mechanics
→ use explicit durable wait/resume state
→ reuse K11 ExecutionClaim for side-effect ownership
→ use Saga compensation/evidence semantics where genuinely applicable
→ retire duplicate/broken local semantics progressively
```

A Temporal/Camunda-class runtime should be evaluated only when several of these become recurrent and expensive to maintain manually:

- many workflows waiting days/months across deployments;
- frequent human/event/timer joins;
- complex durable fan-out/fan-in;
- workflow-version migration requirements;
- compensation across many independent effects;
- operational replay/repair complexity exceeding existing DB/BullMQ approach;
- large numbers of custom workflow definitions whose correct state transitions duplicate engine behavior.

Reference properties from BullMQ, Temporal and Camunda are a floor for correctness, not a mandate to adopt those products.

Affected journeys: J6, J8, J10, J11, J15, J18, J23 and future complex orchestration paths.

---

# Temporal target schematic

```text
Definition / Event / Standing Intent
              ↓
       Logical Occurrence
              ↓
    time/dependency/control eligibility
              ↓
          Work Claim
              ↓
          Attempt N
              ↓
     ┌────────┼──────────┐
     ↓        ↓          ↓
 WAITING   RETRYING   EXACT ACTION
     │        │          ↓
     └────────┘      Clearance
        resume           ↓
                  ExecutionClaim
                         ↓
                  Domain/Provider
                         ↓
                   OutcomeEvidence
                         ↓
               terminal logical state
```

---

# Promotion rule

These recommendations are architecture targets, not production authorization. Promotion to `KF-EXEC-*` requires baseline revalidation, exact model/status migration mapping, characterization of existing waits/retries, compatibility strategy, concurrency/crash proof, cancellation behavior, workflow-version policy, observability and rollback.
