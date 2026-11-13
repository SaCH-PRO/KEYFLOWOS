# KF-JOURNEY-023 — Temporal Flow / Long-Running Workflow

Status: ACTIVE FORENSICS / CROSS-KERNEL TARGET REFINEMENT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary kernels: K7 Temporal/Event/Workflow, K11 Recovery/Reliability
Secondary kernels: K3 KEY Authority/Governance, K5 Capability Fabric, K6 State Transition, K8 Evidence/Outcome, K9 Integration/External Reality
Primary adjacent journeys: J2 KEY Request → Governed Action, J6 Proactive KEY, J14 External Event Ingress, J15 Approval/Governance, J18 Failure/Recovery

> This dossier separates CURRENT REALITY from TARGET KEYFLOWOS. No production implementation is authorized by this document.

---

## A. Definition

J23 is the lifecycle of business work whose meaning survives beyond one synchronous request or worker process: delayed work, scheduled work, recurring work, multi-step plans, approval waits, dependency waits, retries, provider waits, suspended work and resumable workflows.

The central question is:

> **What is the identity and state of work while nothing is actively executing it?**

J23 does not imply that every workflow must run in one engine. It defines the semantic contract that existing execution seams must satisfy.

---

## B. Product Intent

KEYFLOWOS should be able to say, truthfully and durably:

- what work is intended;
- why it exists;
- when it becomes eligible;
- whether it is waiting for time, a human, a dependency or an external system;
- whether a worker currently owns it;
- whether an attempt failed but will retry;
- whether it is terminal;
- what happened in the real business;
- what can safely resume after a process/server crash.

The user-facing goal is simple: **work must not happen early, vanish while waiting, duplicate because of replicas, or be marked finished while future work is still pending.**

---

## C. Actors

- schedule/workflow definition owner;
- event/consequence producer;
- eligibility scheduler/poller;
- durable work occurrence;
- worker/queue claimant;
- human approver/control actor;
- ActionDispatcher/domain executor;
- external provider;
- recovery/reconciliation process;
- operator / observability tooling;
- KEY as planner/reasoner/initiator where applicable.

---

## D. Entry Surfaces — Current Reality

Representative live temporal/execution surfaces inspected:

- `FlowRunnerService` FlowRun / FlowRunStep;
- `AiPlan` / `AiPlanStep` + `PlanExecutorService`;
- BullMQ `QueueService` plan-step and cron queues;
- `ScheduledAgentJob` producers/consumers;
- `DelegationLoop` / `DelegationLoopRun`;
- scheduled WhatsApp messages;
- scheduled EmailCampaign sends;
- `SagaExecution` / `SagaStep`;
- `TemporalFlowEvent` temporal observation/read-model services;
- process-local `safeInterval()` and Nest `@Cron` scheduling.

Current `TemporalModule` and `TemporalFlowModule` are not a Temporal.io workflow runtime. Repository search found no `@temporalio` runtime dependency.

---

## E. State Machine

### Core semantic distinctions

```text
WORK DEFINITION
!= SCHEDULED/DUE OCCURRENCE
!= WORKFLOW INSTANCE
!= WORKFLOW STEP
!= WORKER CLAIM
!= EFFECT CLAIM
!= BUSINESS OUTCOME
```

### Target durable-work lifecycle

```text
INTENT / DEFINITION
        ↓
OCCURRENCE_CREATED
        ↓
SCHEDULED
        ↓
ELIGIBLE
        ↓
CLAIMED
        ↓
RUNNING
   ├─→ WAITING_TIME
   ├─→ AWAITING_CONTROL
   ├─→ AWAITING_DEPENDENCY
   ├─→ AWAITING_EXTERNAL
   ├─→ RETRYABLE_FAILED
   ├─→ OUTCOME_UNKNOWN
   ├─→ CANCELLED
   ├─→ SUPERSEDED
   └─→ SUCCEEDED | FAILED_FINAL
```

A wait state suspends the same logical occurrence. It is not completion and it is not a failed worker attempt.

A retryable failed attempt does not make the workflow step terminal.

---

## F. Frontend Path

Current temporal states surface indirectly through campaign status, AI plan status, scheduled jobs, approvals, inbox/messages, automation history and operational dashboards.

Target product semantics should distinguish at minimum:

```text
Scheduled
Waiting until <time>
Waiting for approval/confirmation
Waiting for dependency
Queued
Running
Retrying
Needs attention
Outcome uncertain
Completed
Cancelled/Superseded
```

Do not display `completed` merely because the current process has no more synchronous code to execute.

---

## G. API Path

No universal public workflow API is required.

The target is a shared internal contract that domain-specific APIs can project into. Candidate internal work envelope:

```yaml
work_occurrence_id: stable-id
work_type: ...
business_id: ...
definition_id: ...
definition_version: ...
source_event_occurrence_id: ...
parent_work_occurrence_id: ...
child_action_fingerprint: ...
state: SCHEDULED|ELIGIBLE|CLAIMED|RUNNING|WAITING_TIME|AWAITING_CONTROL|AWAITING_DEPENDENCY|AWAITING_EXTERNAL|RETRYABLE_FAILED|FAILED_FINAL|OUTCOME_UNKNOWN|SUCCEEDED|CANCELLED|SUPERSEDED
eligible_at: ...
waiting_on: ...
claim:
  claimant: ...
  claimed_at: ...
  lease_until: ...
attempt: ...
retry_policy: ...
control_ref: ...
outcome_ref: ...
causal_refs: []
```

This is a **semantic envelope**, not yet an accepted new database table.

---

## H. Backend Chain

Target causal chain:

```text
Business/Event/Standing Intent
→ Work Definition
→ stable Work Occurrence
→ eligibility
→ occurrence/work claim
→ exact child ActionEnvelope
→ current authority/readiness/policy
→ Control Requirement / Clearance
→ K11 ExecutionClaim
→ ActionDispatcher / domain / provider
→ OutcomeEvidence
→ occurrence terminalization or next wait/retry
```

For a durable wait:

```text
RUNNING
→ WAITING_TIME / AWAITING_CONTROL / AWAITING_EXTERNAL
→ durable wake-up signal/time/event
→ ELIGIBLE
→ new execution attempt on SAME work occurrence
```

---

## I. Data Mutation Ledger

Representative current durable records:

- `FlowRun` / `FlowRunStep`;
- `AiPlan` / `AiPlanStep`;
- BullMQ Redis job state;
- `ScheduledAgentJob`;
- `DelegationLoop` / `DelegationLoopRun`;
- `WhatsAppMessage` schedule/send state;
- `EmailCampaign` schedule/send state;
- `SagaExecution` / `SagaStep`;
- approval/proposal records;
- execution logs / timeline / domain rows.

No single current record owns the complete temporal truth across these regimes.

---

## J. Tenant / Identity

Every durable work occurrence and worker claim must be tenant-bound.

Background execution has no authenticated HTTP tenant context by default; workers/schedulers must carry and re-establish business scope explicitly.

Work identity must not be based only on `Date.now()` or process-local timer identity where cross-replica replay/concurrency matters.

---

## K. Events / Coordination

### Required identity layers

```text
DefinitionId
  = what standing/workflow rule exists

OccurrenceId
  = this logical due/event-triggered instance

WorkflowInstanceId
  = coordinating process instance when applicable

StepId
  = durable logical step

WorkerClaimId
  = current processing ownership

ExecutionClaimId
  = ownership of exact side effect after clearance

AttemptId
  = one try

OutcomeId
  = durable real-world/domain result evidence
```

These identities may map onto existing model IDs; they must not be semantically collapsed.

---

## L. KEY / AI

AI plans are one temporal-work regime, not the definition of temporal work.

Current positive seam:

```text
AiPlanStep.scheduledAt
→ future steps are skipped by PlanExecutor until due
→ BullMQ job with stable plan/step identity
→ worker lock/retry/stall mechanics
```

Current weakness: KeyFlow persistence compresses queue/workflow states. A step can be marked `executing` while merely queued, and a failed BullMQ attempt is persisted as terminal `failed` even while BullMQ plans another retry.

Target AI plan semantics must preserve:

```text
SCHEDULED / ELIGIBLE / QUEUED / ACTIVE / RETRYING / AWAITING_CONTROL / TERMINAL
```

without exposing queue implementation details as product vocabulary.

---

## M. Capability Mapping

Time never grants capability authority.

At execution/wake-up time, material child work should still bind an exact capability/action envelope and current governance context.

A standing schedule/delegation may define bounded authorization policy, but it must not silently become perpetual blanket clearance for mutable future actions.

---

## N. Authority / Governance

Core law:

> **Time does not create authority.**

And:

> **Waiting for control is workflow suspension, not execution failure.**

Target:

```text
work occurrence becomes eligible
→ exact child action derived
→ governance/control evaluated
→ if control required: AWAITING_CONTROL
→ ControlEvidence / Clearance
→ same occurrence resumes
→ ExecutionClaim
```

Do not encode `AWAITING_CONTROL` by throwing a queue error.

Do not finalize a scheduled run as completed while its required approval is unresolved.

---

## O. Blueprint / Graph / Genome

Temporal facts should enter the Business Graph distinctly:

- obligation exists;
- due date/time exists;
- work scheduled;
- currently waiting;
- attempt failed/retrying;
- actual business outcome.

KEY must not infer business completion from workflow coordination completion.

Long-lived workflow history can become useful Genome evidence only after provenance and outcome semantics remain truthful.

---

## P. Invariants

1. Time/schedule eligibility does not confer authority.
2. A material recurring action has separate definition and occurrence identity.
3. Replica count must not multiply one logical occurrence.
4. Waiting is not completion.
5. A failed attempt with retries remaining is not a terminal failed workflow step.
6. `queued != active/running`.
7. `workflow completed != business outcome succeeded`.
8. `AWAITING_CONTROL` is a durable resumable state, not a thrown worker failure.
9. A delayed step cannot release downstream dependencies before its delay expires.
10. A durable work occurrence survives process/server restarts.
11. Worker ownership is atomic/leaseable where concurrent workers are possible.
12. ExecutionClaim remains separate from scheduler/workflow claim.
13. Cancellation/supersession prevents future new execution while preserving history.
14. Retry preserves logical work identity and increments attempt identity.
15. External-effect uncertainty is represented as OUTCOME_UNKNOWN before unsafe retry.
16. Unknown/unregistered scheduled work fails closed; it must not be falsely completed.
17. Child dependency progression is based on durable logical step state, not transient worker state.
18. Approval/control resumption continues the same occurrence unless the approved action materially changed.
19. Process-local timers may trigger scans, but cannot be the sole ownership mechanism for material work.
20. One universal runtime is not required; one semantic contract is.

---

## Q. Failure Matrix

| Failure | Current evidence | Target handling |
|---|---|---|
| Long delay treated as done | FlowRunner >30s delay | WAITING_TIME until wake-up |
| Approval needed but run marked complete | DelegationLoop | AWAITING_CONTROL on same occurrence |
| Retry attempt persisted terminal | AiPlanStep + BullMQ | RETRYABLE_FAILED/RETRYING until attempts exhausted |
| Dependency sees transient retry as failure | PlanExecutor | only terminal failure blocks/skips dependent work |
| Multiple replicas execute same due work | DelegationLoop/ScheduledAgentJob patterns | atomic occurrence claim/lease |
| Unknown scheduled job marked complete | CrossModuleAgent/ScheduledAgentJob | fail closed / unhandled-visible |
| Process crashes during wait | FlowRunner long delay has no wake-up state | durable wait survives restart |
| Process crashes during worker effect | BullMQ/K11 | stalled/lease recovery + idempotent/reconciled effect |
| Scheduled external effect partially succeeds | campaign/provider calls | attempt evidence + retry/reconciliation |
| Schedule cancelled while queued | fragmented | cancellation/supersession propagated to future attempts |
| Approval expires/revokes during wait | J15 overlap | re-evaluate clearance before effect |

---

## R. Idempotency / Transactions / Concurrency

Temporal safety requires at least four separate properties:

```text
OCCURRENCE UNIQUENESS
Which logical scheduled/event-triggered work exists?

WORKER CLAIM
Which worker/process owns coordination of it now?

EXECUTION CLAIM
Who owns the exact side effect after clearance?

EFFECT IDEMPOTENCY / RECONCILIATION
What prevents or resolves duplicate external/domain effects?
```

Current strong local patterns include database compare-and-set claims:

```text
EmailCampaign: DRAFT|SCHEDULED → SENDING
WhatsAppMessage: SCHEDULED → SENDING
```

These are valuable reference seams.

Current BullMQ worker locking/stalled recovery is also a strong transport execution seam, but queue ownership does not replace business/workflow occurrence semantics.

---

## S. Security / Privacy

- tenant scope re-established in background workers;
- scheduled payloads should avoid stale/open-ended authority tokens;
- exact action parameters must be revalidated at execution where material;
- cancellation/revocation must stop future execution where applicable;
- retained workflow payload/evidence follows data minimization/retention rules;
- human-control waits preserve approver provenance and expiration/invalidation.

---

## T. Observability

Target metrics/read models:

```text
work_occurrences{state,type}
oldest_scheduled_age
oldest_eligible_unclaimed_age
oldest_waiting_control_age
oldest_retryable_age
claim_conflict_total
retry_attempts_total
terminal_failures_total
outcome_unknown_total
schedule_miss_total
cancellation_after_queue_total
workflow_to_effect_trace
```

Operator view should show:

```text
why work exists
what it is waiting for
next eligible/wake time
current owner/attempt
last error
remaining retry budget
control status
external effect/outcome status
```

---

## U. Proof / Test

Required proof classes before target convergence:

- a 3-day Flow delay does not execute downstream work early and survives restart;
- concurrent scheduler replicas create/claim one logical due occurrence;
- waiting for approval creates no failed worker attempt and resumes same work after valid control evidence;
- BullMQ retry does not make AiPlan/AiPlanStep terminal before attempts are exhausted;
- dependent steps are not skipped because of a transient retry state;
- crash after worker claim is recoverable;
- crash after possible external effect does not blindly repeat an uncertain effect;
- cancellation/supersession prevents future execution;
- stale/revoked approval does not survive into later execution;
- unknown job type cannot become completed;
- queue and database state cannot regress a terminal step back to running;
- material schedule misses are observable/recoverable under defined policy.

No tests were executed in this forensic pass; these are target proof requirements.

---

## V. Reachability

Verified live/mounted or directly called temporal mechanisms:

- FlowRunner through Automation/Flow execution;
- PlanExecutor initialized in AI module and polling plans;
- BullMQ plan/cron workers initialized by QueueService;
- DelegationLoop process-local poller;
- ScheduledAgentJob consumers;
- campaign scheduler;
- WhatsApp cron scheduler;
- Temporal/TemporalFlow modules;
- Saga services.

`KeyCortexSagaExecutorService` appears weakly reached outside tests in this pass; SagaExecution should therefore be treated as an available persistence/compensation seam, not assumed to be the canonical live workflow engine.

---

## W. Duplication / Legacy / Compatibility

Current temporal semantics are distributed across several status vocabularies:

```text
FlowRun / FlowRunStep
AiPlan / AiPlanStep
BullMQ states
ScheduledAgentJob
DelegationLoopRun
EmailCampaign
WhatsAppMessage
SagaExecution / SagaStep
```

The target is **semantic convergence without immediate physical unification**.

Compatibility approach:

1. define shared state meanings/invariants;
2. map each existing model to them;
3. strengthen the weakest transitions/claims/waits;
4. only then decide if a common WorkOccurrence persistence primitive removes enough duplication to justify migration.

---

## X. Architecture Alignment

Historical KeyFlow architecture favored modular internals with seamless user-facing integration.

J23 preserves that:

- domains own their lifecycle/state;
- K7 owns temporal/workflow semantics;
- K11 owns execution/retry/recovery semantics;
- K3 owns authority/control;
- K8 owns outcome/evidence;
- K9 owns external reality/reconciliation.

The resulting system can feel like one operating system without requiring one monolithic workflow table or runtime.

---

## Y. Contradictions

Active contradiction classes include:

- declared delay vs immediate completion;
- approval wait vs completed scheduled run;
- BullMQ retryable attempt vs terminal AiPlanStep failure;
- queued work vs `executing` workflow status;
- process-local due scan vs distributed ownership;
- shared scheduled-job storage vs explicit worker ownership;
- workflow coordination completion vs actual business outcome;
- exact control state vs queue error semantics.

Canonical contradiction IDs are pooled separately.

---

## Z. Unknowns

- whether all production deployments run a single server instance or may scale horizontally; architecture must not rely on single-instance forever regardless;
- exact current Redis/BullMQ operational monitoring and dead-letter policy;
- which existing flows currently use delay nodes >30 seconds in production;
- exact count/value of DelegationLoop occurrences that enter approval-required branch;
- whether campaign retry should be automatic, operator-driven or policy-specific by channel/effect;
- whether a common persisted WorkOccurrence is eventually justified after existing model convergence;
- exact complexity threshold at which Temporal/Camunda-class durable workflow runtime becomes lower risk than extending existing semantics;
- missed-schedule policy by work type: catch-up, coalesce, skip, expire, or manual review;
- long-term workflow-version migration rules for instances waiting across software deployments.

---

## AA. Findings

This dossier supports the canonical sequence beginning F137. High-confidence new classes:

- FlowRunner long delays are completed instead of suspended;
- DelegationLoop approval-required occurrences are finalized instead of suspended;
- AI plan persistence treats a retryable BullMQ attempt failure as terminal workflow failure.

Existing findings F097, F112, F122, F123 and J15 approval/clearance findings remain directly relevant and should be referenced rather than duplicated.

---

## AB. Canonical Journey Graph

```text
       EVENT / USER / STANDING POLICY
                  │
                  ▼
          ┌──────────────────┐
          │ Work Definition  │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ Work Occurrence  │
          │ stable identity  │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ SCHEDULED        │
          └────────┬─────────┘
                   ▼ time/event/dependency
          ┌──────────────────┐
          │ ELIGIBLE         │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ Work Claim       │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ RUNNING          │
          └───┬────┬────┬────┘
              │    │    │
      WAIT_TIME    │    └─ AWAIT_EXTERNAL
                   │
             AWAIT_CONTROL
              │    │    │
              └────┴────┘
                   ▼ resume same occurrence
          ┌──────────────────┐
          │ Exact Action     │
          │ + Clearance      │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ ExecutionClaim   │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ Domain/Provider  │
          └────────┬─────────┘
                   ▼
          ┌──────────────────┐
          │ OutcomeEvidence  │
          └────────┬─────────┘
                   ▼
          SUCCEEDED / FAILED_FINAL
          / OUTCOME_UNKNOWN
```

Retry loop:

```text
attempt fails + retry budget/policy permits
→ RETRYABLE_FAILED
→ backoff
→ ELIGIBLE
→ new attempt, same WorkOccurrence
```

---

## AC. Machine-readable record

```yaml
id: KF-JOURNEY-023
type: journey
status: ACTIVE_FORENSICS
title: Temporal Flow / Long-Running Workflow
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_reality:
  workflow_runtime_single_source: false
  temporal_module_is_execution_engine: false
  temporalio_runtime_observed: false
  mechanisms:
    - flow_run
    - ai_plan_bullmq
    - scheduled_agent_job
    - delegation_loop
    - whatsapp_scheduler
    - email_campaign_scheduler
    - saga_execution
    - temporal_flow_projection
strong_existing_seams:
  - bullmq_worker_lock_retry_stall
  - whatsapp_scheduled_cas_claim
  - email_campaign_sending_cas_claim
  - scheduled_agent_job_checkpoint_identity
  - flowrun_idempotency_key
  - saga_step_evidence_compensation
identity_layers:
  - definition_id
  - occurrence_id
  - workflow_instance_id
  - step_id
  - worker_claim_id
  - execution_claim_id
  - attempt_id
  - outcome_id
target_states:
  - SCHEDULED
  - ELIGIBLE
  - CLAIMED
  - RUNNING
  - WAITING_TIME
  - AWAITING_CONTROL
  - AWAITING_DEPENDENCY
  - AWAITING_EXTERNAL
  - RETRYABLE_FAILED
  - FAILED_FINAL
  - OUTCOME_UNKNOWN
  - SUCCEEDED
  - CANCELLED
  - SUPERSEDED
uses_kernels:
  - KF-KERNEL-007
  - KF-KERNEL-011
affects_kernels:
  - KF-KERNEL-003
  - KF-KERNEL-005
  - KF-KERNEL-006
  - KF-KERNEL-008
  - KF-KERNEL-009
affects_journeys:
  - KF-JOURNEY-002
  - KF-JOURNEY-006
  - KF-JOURNEY-014
  - KF-JOURNEY-015
  - KF-JOURNEY-018
invariants:
  - J23-I01-time-does-not-grant-authority
  - J23-I02-definition-not-occurrence
  - J23-I03-replica-count-not-occurrence-count
  - J23-I04-waiting-not-completion
  - J23-I05-retryable-attempt-not-terminal-failure
  - J23-I06-queued-not-active
  - J23-I07-workflow-status-not-business-outcome
  - J23-I08-control-wait-not-worker-failure
  - J23-I09-delay-blocks-downstream
  - J23-I10-work-survives-process-restart
  - J23-I11-atomic-worker-ownership
  - J23-I12-worker-claim-not-execution-claim
  - J23-I13-cancellation-propagates
  - J23-I14-retry-preserves-occurrence
  - J23-I15-outcome-unknown-before-unsafe-retry
proof_required:
  - durable_long_delay
  - concurrent_due_occurrence_claim
  - approval_suspend_resume
  - bullmq_retry_workflow_alignment
  - dependency_transient_failure_isolation
  - crash_recovery
  - external_outcome_unknown
  - cancellation_supersession
  - unknown_job_fail_closed
standards_research:
  - source: https://docs.bullmq.io/guide/architecture
    adopted_property: distinct wait/delayed/active/completed/failed queue states
  - source: https://docs.bullmq.io/guide/jobs/stalled
    adopted_property: active worker lock renewal and stalled recovery
  - source: https://docs.camunda.io/docs/components/modeler/bpmn/timer-events/
    adopted_property: process instance stops at intermediate timer until trigger
  - source: https://docs.camunda.io/docs/8.7/components/concepts/job-workers/
    adopted_property: job completion/failure/retries/incidents are explicit
  - source: https://docs.temporal.io/
    adopted_property: durable execution resumes after process/infrastructure failure
technology_verdict:
  universal_new_workflow_runtime: NOT_JUSTIFIED_YET
  shared_semantic_contract: STRONGLY_SUPPORTED
```
