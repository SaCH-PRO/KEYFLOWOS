# KF-KERNEL-007 — Temporal / Event / Workflow

Status: ACTIVE / INITIAL CONVERGENCE / NOT FROZEN

Implementation evidence baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

## A. Definition / Scope

K7 owns the semantics that allow business behavior to remain correct across **time, recurrence, asynchronous events, retries, delays and long-running coordination**.

It covers:

- schedules and scheduled occurrences;
- timers / deadlines / expiry;
- event contracts and event causality;
- recurrence and overlap policy;
- workflow coordination state;
- parent/child workflow relationships;
- durable occurrence ownership;
- delayed work and deferred execution;
- resumption after process failure;
- temporal invalidation and version change;
- ordering where business semantics require it.

K7 does **not** own domain lifecycle truth itself; K6 owns valid business-state transitions. K7 coordinates when/why a transition or action becomes eligible to occur.

K7 does **not** own execution-effect uniqueness itself; K11 owns ExecutionClaim/idempotency/recovery. K7 produces a uniquely identified logical occurrence that K11 can claim safely.

---

## B. Product Intent

KEYFLOWOS should be able to say:

```text
what should happen
when it should happen
why this occurrence exists
whether it is already running
whether it is allowed to overlap
what version/policy created it
what happened to the previous occurrence
what is safe to resume/retry
```

Horizontal scaling, process restart or delayed delivery must not change the logical business outcome.

---

## C. Truth Ownership

Core distinctions:

```text
SCHEDULE DEFINITION
!=
SCHEDULED OCCURRENCE

SCHEDULED OCCURRENCE
!=
EXECUTION CLAIM

WORKFLOW COORDINATION STATE
!=
DOMAIN STATE

EVENT DELIVERY
!=
EVENT CONSUMPTION

EVENT NAME
=
CONTRACT IDENTITY, not a log label
```

Candidate temporal truth objects/projections:

- ScheduleDefinition / StandingDelegation schedule;
- ScheduleOccurrence;
- WorkflowInstance / StepInstance where genuinely long-running;
- Timer/Deadline;
- canonical EventEnvelope;
- event consumption claim;
- occurrence version/fingerprint.

These are semantic requirements, not yet mandatory new database tables.

---

## D. Current Implementation Sources

Initial evidence sources include:

- `apps/server/src/modules/autopilot/delegation-loop.service.ts`;
- `apps/server/src/modules/commerce/invoice-overdue.scheduler.ts`;
- `apps/server/src/modules/commerce/invoice-workflow.service.ts`;
- `apps/server/src/modules/notifications/transactional-email.service.ts`;
- `apps/server/src/modules/flow/flow.listener.ts`;
- `apps/server/src/core/event-bus/events.types.ts`;
- PlanExecutor / AiPlan / AiPlanStep coordination;
- BullMQ-backed execution paths;
- recurring finance/commerce schedulers still to inventory through later journeys;
- J14 external-event ingress and J23 long-running workflow, both still requiring full microscopic passes.

Current pattern diversity includes:

- process-local `setInterval` loops;
- database `nextRunAt` rows;
- in-memory daily sweep tracker maps;
- event-emitter handlers;
- BullMQ jobs;
- plan/step status machines;
- provider webhook event dedupe;
- ad hoc queue tables.

---

## E. Inputs

- schedule definition and version;
- standing delegation / workflow definition;
- business timezone;
- current clock/time source;
- triggering event + event identity;
- domain state snapshot/version;
- policy/authority version;
- recurrence/overlap policy;
- parent workflow/plan identity;
- prior occurrence status;
- retry/resume metadata.

---

## F. Outputs / Consumers

- stable ScheduleOccurrence identity;
- eligibility decision;
- occurrence claim candidate;
- exact child ActionEnvelope candidates;
- canonical typed events;
- timer/deadline transitions;
- workflow step activation;
- retry/resume work;
- expiry/invalidation signal;
- causal lineage for K8 evidence and K11 recovery.

---

## G. State / Transition Semantics

### Schedule occurrence

Candidate lifecycle:

```text
SCHEDULED
→ CLAIMABLE
→ CLAIMED
→ STARTED
→ COMPLETED
   | FAILED_RETRYABLE
   | FAILED_FINAL
   | OUTCOME_UNKNOWN
   | CANCELLED
   | SUPERSEDED
```

`CLAIMED/STARTED` execution ownership may be represented by K11 ExecutionClaim, but the temporal occurrence identity must exist independently.

### Recurrence

```text
ScheduleDefinition(version V)
→ Occurrence(t1,V)
→ Occurrence(t2,V)
→ ...
```

A schedule edit/revocation creates explicit version/supersession semantics rather than silently mutating the meaning of already-created work.

### Event handling

```text
source event identity
→ verified ingress / canonical event
→ consumption claim
→ subscriber decision
→ derived action/state transition
→ causal evidence
```

---

## H. Journey Impact Matrix

K7 is now strongly active through:

- J6 Proactive KEY / Autonomy;
- J15 Approval/Governance, especially expiry and plan coordination;
- J18 Failure/Recovery;
- J23 Temporal Flow / Long-Running Workflow.

It also materially affects:

- J3 customer/revenue lifecycle;
- J4 bookings;
- J7 financial truth;
- J10 commerce/fulfilment;
- J11 contracts/renewals;
- J13 connector lifecycle;
- J14 external event ingress;
- J19 deletion/exit;
- J20 subscription/billing;
- J24 engineering safety.

---

## I. Canonical Vocabulary / Contracts

Working vocabulary:

- ScheduleDefinition
- ScheduleOccurrence
- ScheduledFor
- OccurrenceKey
- OccurrenceVersion
- OverlapPolicy
- ForbidOverlap
- AllowOverlap
- ReplacePrevious
- Timer
- Deadline
- Expiry
- WorkflowInstance
- WorkflowStep
- ParentCoverage
- EventEnvelope
- EventType
- EventSchemaVersion
- EventId
- CorrelationId
- CausationId
- ConsumptionClaim
- Superseded
- Resume

Avoid using `job`, `task`, `run`, `event`, and `status` interchangeably without semantic type.

---

## J. Authority / Governance

Time does not create authority.

A scheduled occurrence is executable only if its standing authority / policy remains valid for the exact child action when the action becomes claimable.

Target rule:

```text
schedule created while authorized
!=
permanent authority to execute forever
```

Authority/policy revocation can prevent future occurrence claims and invalidate unconsumed child clearances.

For parent standing delegation:

```text
StandingDelegation(version)
→ bounded ScheduleOccurrence
→ exact child ActionEnvelope
→ current policy/authority freshness
→ Clearance
```

---

## K. Transactions / Concurrency / Idempotency

K7's primary emerging law:

> Logical occurrence identity must be durable before horizontal workers race to execute it.

Required semantics depend on operation:

```text
ONE logical occurrence
→ at most one active claimant when overlap forbidden

same source event
→ at most one business consumption for a single-consumption handler

schedule update
→ deterministic treatment of already-created occurrences
```

Possible implementation techniques may include:

- expected-state compare-and-set;
- unique occurrence key;
- database row locking / queue claims;
- existing BullMQ job/dedup identities;
- durable workflow engine where justified.

Technique follows semantic need; do not make K7 technology-dependent.

---

## L. Failure / Recovery

Must define behavior for:

- duplicate scheduler instances;
- process crash before/after occurrence claim;
- clock/timezone drift;
- daylight-saving/local-time anomalies where applicable;
- missed schedules;
- overlapping long executions;
- schedule changed during execution;
- duplicate event delivery;
- event out-of-order delivery;
- event handler crash after side effect;
- expired approval/delegation before delayed work resumes;
- parent workflow cancelled while child is queued;
- provider outcome unknown while next recurrence becomes due.

K7 hands side-effect ambiguity to K11 rather than silently scheduling another attempt.

---

## M. Security / Privacy

Temporal work must remain tenant-scoped and authority-version aware.

Delayed work must not resurrect:

- revoked membership authority;
- expired delegation;
- deleted/private data;
- superseded action parameters;
- stale approval artifacts.

Event identifiers and correlation metadata must not expose secrets unnecessarily.

---

## N. Evidence / Observability

Every important occurrence should answer:

```text
which schedule/event produced me?
which schedule/version?
which business?
what exact scheduled time?
when was I claimed?
by whom/what?
what parent/cause?
which child actions were produced?
what happened?
what will happen next?
```

Minimum evidence candidates:

- occurrenceId/key;
- definitionId/version;
- scheduledFor;
- actualStart/finish;
- correlation/causation IDs;
- claim/worker ID;
- overlap decision;
- child action IDs;
- completion/failure/unknown state;
- next occurrence or supersession.

---

## O. Reachability / Consumers

Current active evidence demonstrates runtime-reachable:

- DelegationLoop 5-minute scheduler;
- InvoiceOverdueScheduler;
- TransactionalEmail queue drainer;
- Flow hourly reminder scheduler;
- Momentum daily sweep invoked from DelegationLoop service scheduler;
- BullMQ/Plan execution paths from earlier convergence work.

Additional scheduler/event surfaces remain to be classified as journeys activate.

---

## P. Duplication / Legacy / Compatibility

Current temporal orchestration is distributed among many local schedulers, BullMQ, database time fields, event listeners and plan/workflow models.

Do not create a `TemporalSystem2` merely because this is fragmented.

Target strategy:

1. classify each mechanism by semantic need;
2. identify strong existing seams;
3. normalize occurrence/event contracts;
4. migrate high-impact work first;
5. retire duplicate scheduling/transition owners after proof.

---

## Q. Invariants

1. Time/schedule eligibility does not itself confer authority.
2. Every material recurring action has stable schedule-definition and occurrence identity.
3. Horizontal replica count must not multiply logical business occurrences.
4. Overlap semantics are explicit where concurrent occurrences are possible.
5. A process-local timer/map is never the only source of distributed execution ownership.
6. Event identity and event payload contract are stable and machine-verifiable.
7. The same canonical event name must not carry incompatible payload schemas.
8. Duplicate event delivery does not imply duplicate business consumption.
9. K7 coordinates domain transitions through K6; it does not become an alternate state owner.
10. Retry/resume preserves exact action identity, authority freshness and causal lineage.
11. Schedule/delegation mutation has explicit version/supersession semantics.
12. Deferred work rechecks relevant contact/policy/authority constraints at the material-effect boundary.
13. Workflow coordination status is not business outcome evidence.
14. `completed` requires completion of the defined executable contract; no-actuator fallthrough cannot succeed.

---

## R. Findings

Primary current findings:

- F039 approved proposal can re-enter approval;
- F052 plan execution re-evaluates governance without portable clearance;
- F056 BullMQ deterministic job ID is transport dedupe, not universal ownership;
- F063 approval resolution and plan release are nontransactional;
- F071 ApprovalRequest grouped transaction lacks observed expected-state CAS;
- F078 plan child set mutable after plan approval;
- F080 reply approval side effect precedes inbound dedupe;
- F095 Autopilot pause/disable has partial reach;
- F097 DelegationLoop scheduled occurrence has no durable claim;
- F098 proactive child-intent dedupe is read-before-create;
- F100 notification drain lacks claim;
- F102 proactive Invoice transition bypass/event contract mismatch;
- F104 custom loop can complete without actuator;
- F106 canonical overdue scheduling can duplicate lifecycle events under concurrency.

---

## S. Contradictions

Primary active contradictions:

- C025 approval state vs exact-action clearance;
- C027 dispatcher aspiration vs direct execution reachability;
- C031 approval resolution vs plan-state atomicity;
- C037 grouped ApprovalRequest vs non-atomic ownership;
- C041 approved plan semantics vs mutable child set;
- C043 authenticated event vs replay-safe consumption;
- C052 schedule record vs execution ownership;
- C054 task execution status vs provider/effect evidence;
- C056 canonical event name vs incompatible producer schema;
- C058 configurable custom loop vs fixed executable vocabulary.

---

## T. Open Questions

1. Which current scheduler classes are business-semantic versus infrastructure maintenance?
2. Which can be consolidated onto an existing queue/scheduler seam without changing behavior?
3. What is the minimal durable ScheduleOccurrence representation sufficient for KeyFlow?
4. Which recurrence classes require strict FORBID overlap versus intentionally allowing overlap?
5. What event envelope/schema-version mechanism should become canonical?
6. Which event subscribers require single-consumption semantics versus independently repeatable projections?
7. How should missed schedules/catch-up behave by capability?
8. How should parent plan/standing-delegation cancellation propagate to queued children?
9. Which long-running workflows justify a durable workflow engine instead of DB/queue claims?
10. How do we expose temporal state and pending autonomous authority accessibly to operators?

---

## U. Target-State Candidate

```text
StandingDelegation / WorkflowDefinition
        ↓
ScheduleDefinition(version)
        ↓
ScheduleOccurrence(stable identity)
        ↓
OccurrenceClaim / consumption ownership
        ↓
observation + exact child ActionEnvelope
        ↓
current authority / policy / readiness
        ↓
Clearance
        ↓
K11 ExecutionClaim
        ↓
K6 canonical domain transition / K9 provider effect
        ↓
K8 OutcomeEvidence
        ↓
completion / retry / next occurrence
```

For event-triggered work:

```text
Canonical EventEnvelope
→ schema validation
→ ConsumptionClaim where required
→ derived action / transition
→ causal evidence
```

---

## V. Migration / Compatibility

Do not replace all timers at once.

Candidate migration order:

1. inventory and classify high-impact schedulers;
2. establish canonical occurrence/event vocabulary;
3. characterize current behavior and overlap semantics;
4. add durable claim/CAS around externally visible/high-impact effects;
5. route duplicate domain transition producers through canonical K6 owners;
6. normalize event payload contracts;
7. migrate suitable work to existing BullMQ/DB claim seams;
8. only then evaluate whether a dedicated durable workflow engine materially reduces complexity;
9. preserve compatibility until proof shows duplicate paths can retire.

---

## W. Proof / Test Ratchets

Future proof should include:

- two app replicas race one due occurrence and exactly one wins;
- crashed claimant recovers according to lease/retry policy;
- schedule update/revocation prevents stale occurrence from executing;
- duplicate external event is consumed once where semantics require it;
- event payload schema mismatch fails before consumer side effects;
- two InvoiceOverdueScheduler workers produce one canonical transition consequence;
- no-actuator/custom loop fails closed rather than completing;
- parent cancellation prevents unclaimed child work;
- delayed child rechecks authority/policy/contact constraints;
- deployment replica count does not alter business results.

No tests have been executed as part of this dossier creation.

---

## X. Layered Improvement

L0 — distinguish timers, occurrences, events, coordination states and actual effects.

L1 — explicit recurrence/overlap semantics, durable claims, event-schema discipline and retry safety.

L2 — coherent shared ScheduleOccurrence + EventEnvelope model over existing implementation seams.

L3 — causally linked long-running workflows, versioned standing delegation and cross-instance recovery.

L4 — operators and KEY can explain pending/future work, why it will run, what will stop it and what happened after failure.

L5 — predictive temporal orchestration: KEY can identify bottlenecks, schedule conflicts, delayed feedback and unsafe overlapping commitments while preserving human authority.

---

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-007
name: Temporal / Event / Workflow
status: active-initial-convergence
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
active_journeys:
  - KF-JOURNEY-006
  - KF-JOURNEY-015
  - KF-JOURNEY-018
  - KF-JOURNEY-023
adjacent_kernels:
  - KF-KERNEL-003
  - KF-KERNEL-005
  - KF-KERNEL-006
  - KF-KERNEL-008
  - KF-KERNEL-009
  - KF-KERNEL-011
core_invariants:
  - durable_occurrence_identity
  - explicit_overlap_policy
  - event_contract_integrity
  - duplicate_delivery_not_duplicate_consumption
  - schedule_not_authority
  - coordination_state_not_outcome
implementation_authorized: false
```
