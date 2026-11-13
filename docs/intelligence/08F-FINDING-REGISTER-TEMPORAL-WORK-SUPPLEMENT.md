# KeyFlowOS Finding Register — Temporal Work Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after `08E-FINDING-REGISTER-EXTERNAL-INGRESS-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F136.

---

## F137 — FlowRunner completes long delay nodes immediately instead of durably suspending the flow

**Status:** VERIFIED CODE-LEVEL / TEMPORAL-CORRECTNESS FINDING

`FlowRunnerService` handles delay nodes by actually sleeping only for short waits. For delays greater than 30 seconds it records output such as:

```text
{ delayed: true, ms: <declared delay>, persisted: true }
```

but then calls `completeStep(...)` and returns success immediately. Graph traversal therefore continues to downstream nodes and the overall FlowRun can complete even though the declared temporal dependency has not elapsed.

This is not merely a missing queue optimization. It is a semantic contradiction:

```text
DECLARED FUTURE WAIT
→ STEP COMPLETED NOW
→ DOWNSTREAM WORK ELIGIBLE NOW
```

Target law:

> A wait remains a durable non-terminal workflow state until its wake condition occurs.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F138 — DelegationLoop approval-required occurrences are finalized as completed instead of suspended

**Status:** VERIFIED CODE-LEVEL / CONTROL-WAIT FINDING

For a due DelegationLoop occurrence, `executeLoop()` creates a `DelegationLoopRun(status='running')`. When governance requires formal/admin approval, the service creates an approval item but then still finalizes the run as completed and advances `nextRunAt`.

The approval item is therefore not represented as a suspended continuation of the same scheduled occurrence.

Current semantics collapse:

```text
WORK OCCURRENCE
WAITING FOR HUMAN CONTROL
```

into:

```text
COMPLETED RUN
+ separate pending approval artifact
```

This can make recurrence/history/evidence say the due occurrence finished when its governed business action remains unresolved.

Target law:

> `AWAITING_CONTROL` is a first-class resumable temporal state on the same logical occurrence.

Affected kernels: K3, K7, K8, K11.
Affected journeys: J6, J15, J18, J23.

---

## F139 — BullMQ retryable plan-step failure is persisted as terminal AiPlanStep failure

**Status:** VERIFIED CROSS-LAYER / RETRY-SEMANTIC FINDING

`QueueService.processPlanStep()` uses BullMQ automatic retries (`attempts` + exponential backoff). On any caught execution error it first writes:

```text
AiPlanStep.status = 'failed'
```

and then rethrows to BullMQ.

BullMQ interprets the throw as a failed **attempt** and may schedule another retry when attempts remain. Elsewhere, PlanExecutor interprets `AiPlanStep.status='failed'` as terminal workflow state for dependency skipping and plan finalization.

Thus the same work can simultaneously be:

```text
BullMQ: RETRY PENDING
AiPlan: TERMINALLY FAILED
```

Target law:

> Failed attempt and failed logical step are distinct states. A logical step becomes terminal only after retry policy is exhausted or an explicitly non-retryable failure occurs.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## F140 — AI plan persistence compresses transport/workflow states and can make dependency/finalization decisions from transient queue state

**Status:** VERIFIED ARCHITECTURAL / CROSS-LAYER FINDING

Current AI-plan coordination uses a small AiPlanStep status vocabulary (`pending`, `executing`, `awaiting_approval`, `completed`, `failed`, `skipped`) while BullMQ independently has waiting/delayed/active/stalled/retry/completed/failed semantics.

Examples:

- PlanExecutor marks a step `executing` immediately after queue submission, before proving an active worker owns it;
- QueueService can mark a step `failed` while BullMQ still plans a retry;
- PlanExecutor uses failed/completed step state to unblock/skip dependencies and finalize the plan.

The root defect is not that BullMQ has more statuses. It is that queue-attempt state and logical workflow-step state are not consistently separated.

Target normalization:

```text
logical step state
  SCHEDULED / ELIGIBLE / AWAITING_CONTROL / AWAITING_DEPENDENCY / RUNNING / RETRYING / TERMINAL

worker/transport state
  waiting / delayed / active / stalled / attempt-failed / completed
```

Transport state informs coordination but does not redefine logical truth.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

# Reused findings — do not duplicate

J23 also materially relies on existing canonical findings including:

- F097 DelegationLoop scheduled occurrences have no durable execution claim;
- F112 JourneyTemplate delayMinutes is not executable temporal behavior;
- F122 shared ScheduledAgentJob table has competing consumers;
- F123 ScheduledAgentJob execution lacks atomic ownership;
- F063 approval resolution + plan release nontransactional;
- F078 plan child set mutable after plan approval.

These remain active and are referenced rather than renumbered.

---

# Positive seams preserved

Strong current properties that should be strengthened rather than replaced:

- BullMQ worker locking, retries, delayed jobs and stalled recovery;
- WhatsApp scheduled-message CAS claim (`SCHEDULED -> SENDING`);
- EmailCampaign CAS claim (`DRAFT|SCHEDULED -> SENDING`);
- FlowRun stable idempotency-key seam;
- ScheduledAgentJob semantic checkpoint uniqueness;
- SagaExecution/SagaStep evidence + compensation semantics, though runtime reachability is not broad enough to make it the canonical workflow engine today.

---

# Pool law

```text
WORK DEFINITION
→ LOGICAL OCCURRENCE
→ WAIT / ELIGIBILITY
→ WORKER CLAIM
→ ATTEMPT(S)
→ EXACT-ACTION EXECUTION CLAIM
→ EFFECT
→ OUTCOME
```

And:

```text
WAITING != COMPLETED
ATTEMPT_FAILED != STEP_FAILED
QUEUED != RUNNING
WORKFLOW_COMPLETED != BUSINESS_OUTCOME_SUCCEEDED
```

No production implementation is authorized by this supplement.
