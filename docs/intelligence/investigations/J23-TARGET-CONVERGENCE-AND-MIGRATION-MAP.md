# J23 — Target Convergence / Migration Map

Status: VALUE-ENGINEERED TARGET / ENTERING TARGET CONVERGENCE
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Evidence head revalidated separately: audit-only advancement does not change inspected implementation semantics.
Last synthesis: 2026-09-03
Primary journey: J23 Temporal Flow / Long-Running Workflow
Primary kernels: K7 Temporal/Event/Workflow, K11 Recovery/Reliability
Secondary kernels: K3 Governance, K5 Capability, K6 State Transition, K8 Evidence/Outcome, K9 External Reality

> This document compiles the J23 evidence into a minimum target architecture. It does not authorize production implementation.

---

## 1. Convergence Verdict

J23 no longer has an undefined architectural root problem.

The shared root is:

> **KeyFlowOS has several legitimate temporal/execution fabrics, but they do not yet share one durable semantic contract for work identity, waiting, claims, retry, invalidation, lateness, definition versioning and external outcome.**

The target is therefore **semantic convergence before physical unification**.

Current maturity recommendation:

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
```

Not L6 yet because exact migration/persistence mappings and proof ratchets remain to be finalized.

---

## 2. Minimum Durable-Work Contract

Every material long-lived work implementation must be able to answer the following, even when the answers live in different existing tables during migration.

```yaml
identity:
  work_type: ...
  definition_id: ...
  definition_version: ...
  occurrence_id: ...
  parent_occurrence_id: ...
  source_event_occurrence_id: ...
  action_fingerprint: ...

time:
  scheduled_for: ...
  eligible_at: ...
  actual_started_at: ...
  actual_terminal_at: ...
  lateness_policy: ...

logical_state:
  state: SCHEDULED|ELIGIBLE|WAITING_TIME|AWAITING_CONTROL|AWAITING_DEPENDENCY|CLAIMED|RUNNING|RETRYING|AWAITING_EXTERNAL|OUTCOME_UNKNOWN|SUCCEEDED|FAILED_FINAL|CANCELLED|SUPERSEDED|EXPIRED
  waiting_on: ...
  terminal_reason: ...

ownership:
  worker_claim_id: ...
  claimant: ...
  lease_until: ...
  attempt_id: ...
  attempt_number: ...

execution:
  clearance_ref: ...
  execution_claim_ref: ...
  provider_operation_ref: ...

invalidation:
  cancellation_ref: ...
  superseded_by: ...
  source_state_version: ...
  policy_or_authority_version: ...

outcome:
  outcome_evidence_ref: ...
  reconciliation_state: ...
```

This is a semantic contract, **not a requirement for one universal row**.

---

## 3. Canonical State Meaning

### Logical work

```text
SCHEDULED
  occurrence exists but time/condition has not made it eligible

ELIGIBLE
  occurrence may be claimed if still valid

WAITING_TIME
  durable time wait

AWAITING_CONTROL
  waiting for ControlEvidence/Clearance

AWAITING_DEPENDENCY
  waiting for another logical occurrence/step

CLAIMED
  coordination/worker ownership acquired; effect not necessarily owned

RUNNING
  current attempt actively coordinating/deriving effect

RETRYING
  prior attempt failed; logical work remains alive

AWAITING_EXTERNAL
  local request/hand-off happened; external terminal truth not yet known

OUTCOME_UNKNOWN
  effect existence/outcome cannot safely be proven either way

SUCCEEDED
  work-specific terminal success evidence satisfied

FAILED_FINAL
  non-retryable/exhausted confirmed failure

CANCELLED
  future execution right removed before effect point of no return

SUPERSEDED
  replaced by newer definition/action/occurrence

EXPIRED
  lateness/validity window ended without execution
```

### Separate attempt/transport concepts

```text
waiting/delayed
queued
active
stalled
attempt_failed
transport_completed
```

These inform K7/K11 but do not redefine logical business-work truth.

---

## 4. Existing Fabric Mapping

### FlowRun / FlowRunStep

Keep:
- graph/run identity;
- idempotency-key seam;
- node traversal semantics.

Strengthen:
- long delay becomes durable WAITING_TIME rather than completed node;
- run cannot terminalize while a durable wait/child is unresolved;
- explicit cancellation/supersession;
- wake-up mechanism survives restart.

Do **not** replace Flow graph authoring simply to gain durable waits.

### AiPlan / AiPlanStep + BullMQ

Keep:
- plan/step identity;
- dependency graph;
- BullMQ delayed jobs, worker locks, retry/backoff/stalled recovery.

Strengthen:
- separate logical step state from BullMQ attempt state;
- queue submission != `executing`;
- failed attempt with retries left => RETRYING, not terminal failed;
- AWAITING_CONTROL is suspension, not queue failure;
- cancellation withdraws/makes queued transport harmless;
- definition/action fingerprint binding across mutation/approval;
- terminal state CAS prevents late queue bookkeeping regression.

### ScheduledAgentJob

Keep:
- `(businessId, entityId, checkpoint)` semantic occurrence uniqueness;
- lightweight DB scheduling for simple domain work.

Strengthen:
- explicit job-type owner/router;
- atomic PENDING -> CLAIMED expected-state transition/lease;
- cancellation competes with claim;
- source-state eligibility revalidation;
- lateness/misfire policy;
- descendant handoff lineage;
- unknown type fails closed;
- no `COMPLETED` while descendant external effect remains merely queued unless status means `HANDED_OFF` explicitly.

### DelegationLoop / DelegationLoopRun

Keep:
- standing recurrence/delegation definition;
- recurrence history/statistics.

Strengthen:
- definition occurrence identity;
- atomic due-occurrence claim;
- AWAITING_CONTROL rather than completed run when human control is unresolved;
- pause/kill/disable propagation;
- exact child ActionEnvelope/ExecutionClaim;
- recurrence/misfire/coalescing semantics;
- policy/authority version revalidation.

### WhatsAppMessage scheduled path

Keep:
- `SCHEDULED -> SENDING` CAS;
- provider message ID (`wamid`) seam;
- channel-specific model/UI.

Strengthen:
- cancellation CAS competing with send claim;
- scheduled lateness/expiry policy;
- source/contact policy revalidation;
- provider accepted/sent/delivered/undelivered/read evidence where relevant;
- OUTCOME_UNKNOWN for ambiguous transport state;
- reconciliation by provider ID/status callback/query.

### EmailCampaign

Keep:
- campaign authoring/audience model;
- sender CAS;
- current segmentation/delivery machinery.

Strengthen:
- cancellation expected-state CAS;
- scheduled action/definition version/fingerprint;
- explicit policy for edits after scheduling;
- lateness policy;
- handoff/outcome semantics by recipient where needed.

### OutboundDelivery / DeliveryEvent

Promote as a **strong existing external-effect seam**, not necessarily the universal temporal store.

Keep:
- durable per-delivery identity;
- CAS-like claim to `Sending`;
- retry/backoff state;
- adapter abstraction;
- external IDs/URLs/result snapshots;
- DeliveryEvent attempt evidence.

Strengthen:
- distinguish provider acceptance/publication from later delivery/settlement where channel semantics require it;
- OUTCOME_UNKNOWN + reconciliation;
- preserve exact action/effect identity from upstream occurrence;
- cancellation and provider point-of-no-return semantics;
- avoid pretending one generic `Published` state has identical evidence strength across social/email/message channels.

### CustomerNotificationLog queue

Keep only if it remains a legitimate notification queue/evidence log.

Strengthen:
- atomic drain claim;
- original dedupe/effect identity survives drain;
- causal parent/invalidation lineage;
- QUEUED handoff != upstream business completion;
- cancellation/supersession before effect;
- provider outcome evidence.

### SagaExecution / SagaStep

Keep as a source of compensation/evidence semantics where reachable.

Do not promote it to universal workflow engine solely because it has step/compensation concepts; production reachability remains insufficient for that conclusion.

---

## 5. No New Universal WorkOccurrence Table Yet

### Decision

```text
SHARED SEMANTIC CONTRACT = YES
SHARED CROSS-DOMAIN READ MODEL = YES
UNIVERSAL NEW SOURCE-OF-TRUTH TABLE = NOT YET JUSTIFIED
UNIVERSAL NEW WORKFLOW RUNTIME = NOT YET JUSTIFIED
```

### Why

Current domain models already carry meaningful identities and business-specific state. Replacing them immediately would create:

- duplicate migration truth;
- synchronization risk;
- large compatibility burden;
- another executor/authority seam before existing ones converge.

The first implementation wave should strengthen existing models and establish adapters/mappings to one semantic contract.

### Trigger to reconsider a common persisted WorkOccurrence

Re-evaluate physical unification only when several of these become true:

1. three or more independent fabrics repeatedly implement the same claim/lease/cancel/wait/version fields with high defect cost;
2. cross-domain parent/child cancellation requires atomic graph queries that existing references cannot support safely;
3. operator/recovery tooling cannot reliably reconstruct current work from domain sources;
4. cross-fabric handoff/resume requires a stable occurrence identity that no existing record can own;
5. migration shows a common row materially removes, rather than adds, dual-write state;
6. characterization/proof demonstrates a common primitive can coexist with domain ownership without becoming a mega-table.

Until then, a WorkOccurrence is a **contract/interface and graph identity**, not a new database mandate.

---

## 6. No New Workflow Engine Yet

Preserve KF-REC-041.

Evaluate Temporal/Camunda-class runtime only when KeyFlow repeatedly needs engine-grade behavior that is more expensive/risky to maintain than adoption, such as:

- large numbers of workflows waiting weeks/months across deployments;
- frequent durable human + timer + event joins;
- dynamic fan-out/fan-in with durable correlation;
- large workflow-definition version migration burden;
- compensation trees across many independent side effects;
- operational replay/repair that current Postgres/BullMQ primitives cannot make safe;
- custom workflow state code becoming a dominant reliability burden.

Technology follows semantic need; it does not define the architecture.

---

## 7. Temporal Work Projection — Operator / Accessibility Layer

The user should not need to understand BullMQ, leases, CAS or provider callbacks.

Create/evolve a **read model/projection**, not another source of truth, that normalizes current domain work into simple product states.

Candidate product projection:

```text
Scheduled
Waiting until <time>
Waiting for approval
Waiting for dependency
Queued
Running
Retrying
Cancelling
Cancelled
Superseded
Expired
Waiting on provider
Outcome uncertain / needs verification
Completed
Failed / needs attention
```

Each projected item can expose on demand:

```text
what will happen
why it exists
source/trigger
scheduled/actual time
what it is waiting on
who/what currently owns it
last attempt/error
remaining retry policy
approval/control state
cancellation availability / too-late boundary
provider/external outcome state
causal parent/children
```

This projection supports:

- Command Center / J17;
- proactive KEY explanations;
- operator recovery in J18;
- accessible cancellation;
- observability without leaking internal implementation vocabulary.

It can initially be assembled from domain sources or materialized incrementally if query cost demands it.

---

## 8. Major Work-Family Policy Matrix

These are target defaults/hypotheses to validate with each journey; they are not hard-coded universal rules.

| Work family | Likely wait/misfire policy | Required revalidation | Cancellation point |
|---|---|---|---|
| booking reminder | EXPIRE after appointment relevance window | booking active/time/contact policy | before send claim |
| invoice overdue reminder | bounded CATCH_UP while invoice remains overdue | invoice/payment/contact policy | before send claim |
| review solicitation | bounded CATCH_UP | qualifying transaction/service still valid + contact policy | before send claim |
| abandoned cart sequence | COALESCE / bounded cadence | checkout still incomplete + recipient policy | before each effect |
| scheduled social post | CATCH_UP_UNTIL or EXPIRE by content policy | content/connection/policy version | before publish claim |
| email campaign | CATCH_UP_UNTIL + explicit edit/version semantics | campaign version/audience/contact policy | before sender claim |
| DelegationLoop | recurrence-specific COALESCE/CATCH_UP | standing authority/autonomy/current business state | before child ExecutionClaim |
| AI plan step | resume same occurrence; retry policy explicit | exact capability + authority/policy + dependencies | before ExecutionClaim |
| payment/provider operation | provider-specific | amount/state/authority/provider truth | often only before provider point-of-no-return |
| owner digest/intelligence | LATEST_WINS / COALESCE | current graph/signals | before notification |

This matrix must be refined, not blindly applied.

---

## 9. Closed-System Graph

```text
Definition(version)
      │
      ▼
Occurrence ──────── supersedes/cancels ──────┐
      │                                      │
      ├─ scheduled/late policy               │
      ├─ waits on time/control/dependency    │
      └─ source-state eligibility            │
      │                                      │
      ▼                                      │
WorkerClaim                                  │
      │                                      │
      ▼                                      │
Attempt                                      │
      │                                      │
      ▼                                      │
ActionEnvelope + Clearance                   │
      │                                      │
      ▼                                      │
ExecutionClaim  ← point of no return varies  │
      │                                      │
      ▼                                      │
External/Domain Effect                       │
      │                                      │
      ├─ descendant work ----------------────┘ invalidation where not yet effective
      │
      ▼
AWAITING_EXTERNAL / OUTCOME_UNKNOWN
      │
      ▼
OutcomeEvidence / Reconciliation
      │
      ├─ Business Graph
      ├─ Genome learning
      └─ future Definition/Policy recommendation
```

Feedback must not self-grant authority; J6/J15 laws remain intact.

---

## 10. Migration Order

### Wave A — semantic characterization / proof harness

- map each current status to logical vs transport state;
- write characterization tests for delays, retries, cancellation races, queue handoffs, late schedules and provider ambiguity;
- identify source-state preconditions by capability/work type.

### Wave B — strengthen local ownership boundaries

- ScheduledAgentJob claim/CAS;
- CustomerNotificationLog drain claim/dedupe preservation;
- EmailCampaign cancellation CAS;
- FlowRunner durable long wait;
- AiPlan retry-state separation.

### Wave C — cancellation/version/lateness

- explicit cancel/supersede/expire semantics;
- execution-time eligibility checks;
- definition/action version binding;
- misfire policy metadata/config where needed.

### Wave D — external outcome/reconciliation

- preserve provider operation IDs;
- distinguish accepted/sent/published/delivered/settled where relevant;
- OUTCOME_UNKNOWN handling;
- status callback/query reconciliation using KF-REC-037.

### Wave E — cross-domain temporal projection

- normalize existing sources into operator/KEY read model;
- expose causal lineage, waits, cancellation and recovery state.

### Wave F — physical convergence decision

Only after Waves A–E, measure whether common WorkOccurrence persistence or a durable workflow engine actually reduces complexity.

---

## 11. Proof Ratchets

J23 cannot reach execution-ready status until proof design covers at least:

1. restart-safe multi-day wait;
2. horizontal-replica occurrence uniqueness and worker ownership;
3. retryable attempt does not terminalize logical step;
4. approval wait resumes same occurrence;
5. cancellation vs claim has one linearization winner;
6. causal descendant cancellation works before effect;
7. stale source state prevents future effect;
8. lateness follows work-specific policy;
9. definition mutation has explicit migration/supersession semantics;
10. ambiguous provider effect enters OUTCOME_UNKNOWN and reconciles safely;
11. queue-to-queue handoff preserves effect identity;
12. terminal state cannot regress due to late bookkeeping;
13. operator projection matches source-of-truth states;
14. KEY learning consumes confirmed OutcomeEvidence, not coordination status.

No runtime tests were executed during this synthesis.

---

## 12. J23 Remaining Unknowns Before L6

The architecture root is converged. Remaining L6 blockers are bounded:

- exact field/status mapping per affected current model;
- exact migration compatibility for live rows;
- which work types need configurable vs fixed lateness policies;
- definition-edit behavior for each product family;
- provider-specific terminal evidence and reconciliation mechanisms;
- exact integration with J15 Clearance expiry/invalidation;
- exact integration with J6 global stop/pause/delegation invalidation;
- operator projection persistence/query strategy;
- characterization/proof plan sufficient to emit bounded KF-EXEC packets.

---

## 13. Machine-readable Target

```yaml
id: KF-J23-TARGET-CONVERGENCE
journey: KF-JOURNEY-023
maturity: L5_VALUE_ENGINEERED_ENTERING_L6
architecture_decision:
  shared_semantic_contract: ACCEPTED_DIRECTION
  shared_operator_projection: STRONGLY_SUPPORTED
  universal_work_occurrence_table: NOT_JUSTIFIED_YET
  universal_workflow_runtime: NOT_JUSTIFIED_YET
core_states:
  - SCHEDULED
  - ELIGIBLE
  - WAITING_TIME
  - AWAITING_CONTROL
  - AWAITING_DEPENDENCY
  - CLAIMED
  - RUNNING
  - RETRYING
  - AWAITING_EXTERNAL
  - OUTCOME_UNKNOWN
  - SUCCEEDED
  - FAILED_FINAL
  - CANCELLED
  - SUPERSEDED
  - EXPIRED
core_identity_layers:
  - definition_id
  - definition_version
  - occurrence_id
  - parent_occurrence_id
  - worker_claim_id
  - attempt_id
  - action_fingerprint
  - clearance_ref
  - execution_claim_ref
  - provider_operation_ref
  - outcome_evidence_ref
existing_seams_to_strengthen:
  - FlowRun
  - AiPlan_AiPlanStep_BullMQ
  - ScheduledAgentJob
  - DelegationLoopRun
  - WhatsAppMessage
  - EmailCampaign
  - OutboundDelivery_DeliveryEvent
  - CustomerNotificationLog
  - SagaExecution
reused_recommendations:
  - KF-REC-023
  - KF-REC-026
  - KF-REC-027
  - KF-REC-037
  - KF-REC-038
  - KF-REC-039
  - KF-REC-040
  - KF-REC-041
  - KF-REC-042
  - KF-REC-043
  - KF-REC-044
  - KF-REC-045
  - KF-REC-046
implementation_authorized: false
```
