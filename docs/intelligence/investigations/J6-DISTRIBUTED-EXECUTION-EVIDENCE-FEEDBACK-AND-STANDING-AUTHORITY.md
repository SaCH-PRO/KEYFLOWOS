# J6 — Distributed Execution, Evidence, Feedback & Standing Authority

Status: ACTIVE FORENSICS / CONVERGENCE INPUT

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

This investigation continues J6 Proactive KEY / Autonomy and deliberately cross-references J15, J2, J25, J3, J7, J18 and J23 rather than treating Autopilot as an isolated module.

Affected kernels:

- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K9 Integration & External Reality
- K10 Financial Truth
- K11 Recovery & Reliability

---

# 1. Closed-loop model used in this slice

Every proactive loop is evaluated as:

```text
SENSOR
→ SIGNAL
→ INTERPRETER
→ CONTROLLER
→ AUTHORITY / POLICY BOUNDARY
→ ACTUATOR
→ ENVIRONMENT
→ OUTCOME SENSOR
→ EVIDENCE STORE
→ LEARNING / FEEDBACK
→ POLICY-CHANGE BOUNDARY
```

Failure classes include:

```text
NO ACTUATOR
DUPLICATE ACTUATOR
FALSE SUCCESS SENSOR
DELAYED / UNKNOWN OUTCOME
UNBOUND AUTHORITY
UNSCOPED FEEDBACK
REINFORCING AUTHORITY FEEDBACK
PROCESS-LOCAL EXECUTION OWNERSHIP
CONTRACT-INCOMPATIBLE EVENT
```

This projection complements journey/kernel dossiers; it does not create a new journey or kernel.

---

# 2. DelegationLoop child-effect classification

The five canonical loops are materially different effect classes.

## payment_recovery

```text
observe overdue invoice
→ raw Invoice SENT -> OVERDUE mutation
→ emit invoice.overdue
→ create/resume AutopilotTask
→ sometimes call TransactionalEmailService
→ task / run / execution-log / memory records
```

## lead_reactivation

```text
observe stale lead
→ raw Contact.lifecycleStage -> STALE mutation
→ create AutopilotTask
→ timeline/event
```

No direct re-engagement send was found in the inspected loop body.

## post_purchase

Observed loop body creates thank-you, review-request and cross-sell tasks from paid-invoice windows. No direct external send was found in this loop body.

## booking_prep

Observed loop body creates preparation and follow-up tasks from booking windows. No direct external send was found in this loop body.

## weekly_hygiene

Observed loop body creates review/recommendation tasks and may summarize patterns. No direct provider effect was found in the inspected body.

Therefore:

```text
TASK/RECOMMENDATION FABRIC
!=
DOMAIN MUTATION FABRIC
!=
EXTERNAL EFFECT FABRIC
```

A loop-level risk/control label currently spans heterogeneous child-effect classes.

---

# F097 — DelegationLoop scheduled occurrences have no durable execution claim

**Status:** VERIFIED CODE-LEVEL / DISTRIBUTED-RELIABILITY FINDING

`processDueLoops()` performs:

```text
find DelegationLoop
where enabled = true
and nextRunAt <= now

for each row:
  executeLoop(row)
```

`executeLoop()` then unconditionally creates a `DelegationLoopRun(status='running')`.

`nextRunAt` is advanced only after the run reaches the completion path.

No atomic occurrence claim / lease / expected-schedule compare-and-set was found before child effects begin.

`DelegationLoopRun` is a history record, not a proven exclusive claim primitive.

### Failure mode

With two application instances:

```text
instance A reads due loop L
instance B reads due loop L
        ↓
A creates Run-A
B creates Run-B
        ↓
both can execute the same occurrence
```

### Target law

> A scheduled business-agency occurrence must acquire durable execution ownership before producing child effects.

The occurrence identity should be stable, for example from:

```text
loopId + scheduledFor/version
```

or an equivalent durable schedule occurrence key.

The system should define an explicit overlap policy such as FORBID / ALLOW / REPLACE where relevant instead of inheriting process timing accidentally.

---

# F098 — proactive child-task dedupe is predominantly read-before-create

**Status:** VERIFIED CODE-PATTERN / CONCURRENCY FINDING

Payment recovery, lead reactivation, post-purchase and booking-prep inspect for an existing task before creating one.

Representative shape:

```text
findFirst(existing semantic task)
if existing: continue
create AutopilotTask
```

That is useful duplicate suppression during serial sweeps, but it is not by itself an atomic uniqueness boundary under concurrent workers.

No effect-specific atomic task-claim boundary was observed in this slice.

### Target implication

Intent/work-item identity should be explicitly modeled where duplicate intent is invalid, e.g.:

```text
business
+ capability/effect type
+ entity
+ milestone/window/version
```

Use a durable uniqueness/claim property where semantics require one active intent. Do not rely on `findFirst -> create` as execution ownership.

---

# F099 — TransactionalEmail dedupe is advisory read-before-send, not atomic effect ownership

**Status:** VERIFIED CODE-LEVEL / EXTERNAL-EFFECT FINDING

When `dedupeKey` is supplied, `TransactionalEmailService.send()`:

1. searches `CustomerNotificationLog` for an existing matching business/messageId with a sent/queued/drained-like status;
2. if absent, calls Gmail;
3. writes a notification log only after provider acceptance.

The inspected `CustomerNotificationLog.messageId` is not an observed unique execution boundary.

Therefore two workers can both pass the pre-send absence check before either records success.

### Important distinction

```text
application dedupe lookup
!=
atomic ExecutionClaim
!=
provider idempotency
```

### Target law

External communications require a durable effect identity and atomic claim before calling the provider. Provider-specific idempotency may strengthen this but must not be assumed when the provider API lacks it.

---

# F100 — queued notification draining has no per-row claim and does not preserve original dedupe identity into resend

**Status:** VERIFIED CODE-LEVEL / RECOVERY FINDING

`TransactionalEmailService.drainQueue()`:

```text
findMany QUEUED rows
→ iterate
→ call send(...)
→ if SENT, update original row to DRAINED
```

No atomic `QUEUED -> CLAIMED/SENDING` expected-state transition or lease was observed before provider send.

In addition, the resend call does not pass the queued row's original `messageId` as `dedupeKey`.

### Multi-instance failure mode

Two server instances can fetch the same queued row before either marks it drained and independently invoke `send()`.

### Target law

Queue recovery requires durable ownership:

```text
QUEUED
→ atomic CLAIMED/SENDING
→ provider attempt
→ PROVIDER_ACCEPTED | FAILED | OUTCOME_UNKNOWN
→ reconciliation / retry
```

The original effect identity must survive retries and drain cycles.

---

# F101 — payment recovery marks execution from eligibility instead of actual send result

**Status:** VERIFIED CODE-LEVEL / EVIDENCE-INTEGRITY FINDING

Payment recovery calls `TransactionalEmailService.send()` but does not inspect its return status.

`send()` can return:

```text
SENT
QUEUED
FAILED
```

without throwing in all failure/deferral cases.

The loop nevertheless marks the task:

```text
status = AUTO_EXECUTED
executedAt = now
executedBy = AI
```

and emits `autopilot.task.auto_executed`.

Its run result also derives:

```text
autoExecuted = !needsApproval && contact has email
```

which can remain true when `contactWindow()` deferred the send.

### Strengthens, but does not duplicate, F090/F091

F090 is the route that claims sent/executed while calling no provider at all.

F101 is different: a provider-capable path exists, but the caller collapses eligibility, queueing/failure and provider acceptance into execution success.

### Target evidence ladder

```text
ELIGIBLE_TO_EXECUTE
≠ CLAIMED_FOR_EXECUTION
≠ EXECUTION_ATTEMPTED
≠ PROVIDER_ACCEPTED
≠ DELIVERED
≠ BUSINESS_OUTCOME
```

---

# F102 — DelegationLoop bypasses the canonical Invoice state owner and publishes an incompatible canonical event

**Status:** VERIFIED CODE-LEVEL / CROSS-JOURNEY STATE + INTEGRATION FINDING

The repository already has a dedicated `InvoiceOverdueScheduler` that routes overdue detection through:

```text
InvoiceWorkflowService.transition(invoiceId, 'OVERDUE')
```

`InvoiceWorkflowService` explicitly declares itself the single owner of invoice status transitions and provides:

- allowed-transition validation;
- transaction semantics around financially relevant transitions;
- canonical lifecycle-event emission;
- a canonical `InvoiceStatusPayload` event shape containing the hydrated `invoice` object.

DelegationLoop payment recovery instead performs:

```text
prisma.invoice.update({ status: 'OVERDUE' })
```

and independently emits `invoice.overdue` with a narrower private payload containing fields such as `invoiceId`, `invoiceNumber` and `daysPastDue`, but not the canonical `invoice` object.

Canonical consumers of `invoice.overdue` include Flow, activity, webhook and automation listeners that dereference `payload.invoice`.

### Two violations

1. **State ownership:** proactive code bypasses K6's canonical transition owner.
2. **Event contract:** the same canonical event name is emitted with incompatible schemas.

### Target laws

> Proactive systems request domain transitions through the canonical domain transition owner; they do not create parallel lifecycle semantics.

> A canonical event name is a contract. Producers may not reuse it with incompatible private payload shapes.

---

# F103 — loop-local human approvals can expand a business-wide autonomy ceiling

**Status:** VERIFIED CURRENT-BEHAVIOR / FEEDBACK-CONTROL FINDING

`adaptGovernanceFromHistory(businessId, loopType)` correctly no longer counts `AUTO_EXECUTED` as human approval.

Current test source explicitly pins that sufficient genuine `COMPLETED` approvals can promote `maxAutoTier` from 1 to 2.

No test was executed in this investigation; this is **TEST SOURCE + IMPLEMENTATION FACT**, not a claimed test result.

The feedback input is scoped to one `loopType`, but the mutation is:

```text
AiOversight AutonomySettings.maxAutoTier
```

which is a business-wide setting.

`AiOversightService.evaluate(businessId, arbitraryTool)` uses the same global `maxAutoTier` and can auto-approve any tool whose tier is inside that ceiling, subject to other active restrictions.

Therefore:

```text
approval history for capability family A
→ raises global maxAutoTier
→ can reduce friction for unrelated capability family B
```

### Feedback classification

This is a **reinforcing cross-capability authority feedback loop**.

The previous self-witness defect was partly repaired by excluding AI auto-executions, but the remaining controller still converts behavioral evidence into standing authority without an independent human policy-change transition.

### Target law

```text
observed approvals/outcomes
→ trust/confidence signal
→ policy-change recommendation
!=
authority mutation
```

Automatic tightening/restriction may be intentionally permitted. Expansion of standing authority should cross an independently authorized, explainable control-plane transition and remain capability/bounds specific.

---

# F104 — Cortex can create a scheduled custom DelegationLoop that completes successfully without an actuator

**Status:** VERIFIED CODE-LEVEL / FALSE-FEEDBACK FINDING

`AutopilotAdapterService.createLoop()` creates:

```text
loopType = custom_<timestamp>
```

and may set it active with a future `nextRunAt`.

The Cortex Autopilot capability registry exposes `create_loop` and marks it `requiresApproval: false`.

`DelegationLoopService.executeLoop()` recognizes only:

- payment_recovery
- lead_reactivation
- post_purchase
- booking_prep
- weekly_hygiene

There is no custom-loop execution case or fail-closed default in the switch.

After the empty switch path, the service still:

- marks `DelegationLoopRun.status = completed`;
- advances `lastRunAt` / `nextRunAt`;
- updates run statistics;
- emits `delegation_loop.completed`;
- writes execution log `success: true`;
- invokes feedback adaptation.

### Closed-loop failure

```text
CONFIGURATION EXISTS
→ SCHEDULER FIRES
→ NO ACTUATOR
→ SUCCESS SENSOR FIRES
→ SUCCESS EVIDENCE PERSISTS
→ FEEDBACK LAYER CONSUMES HISTORY
```

### Target law

A recurring delegation must have a validated executable contract before it can be enabled.

Unknown/custom loop semantics must either:

- compile into registered CapabilityContracts / child actions; or
- fail closed as NOT_EXECUTABLE / INVALID_CONFIGURATION.

They must never reach a `completed/success` state solely because no switch case threw.

---

# F105 — standing-delegation UX does not faithfully communicate the authority/effects being granted

**Status:** VERIFIED UX / ACCESSIBILITY / AUTHORITY FINDING

Two live web surfaces were traced.

## `/app/automations` Autopilot loops

The UI describes loops as:

> pre-built automation cycles that scan, match, and create tasks

But current payment recovery can mutate Invoice state and directly invoke customer email; lead reactivation mutates Contact lifecycle state.

Stored descriptions for post-purchase and booking-prep say they send messages even though their inspected loop bodies create tasks rather than directly send.

Thus current copy does not reliably tell the user what an enabled standing delegation can actually do.

The enable/disable control is also a custom visual `<button>` without an observed programmatic switch state/name such as `aria-pressed` / `role=switch` + `aria-checked` or an equivalent accessible label/state.

## Talk to KEY — Autopilot mode

The review step shows:

- interpretation;
- recommendation/confidence;
- loop type;
- raw proposed config.

The CTA says `Build it`.

But `handleBuild()` calls `keyBuildDelegation(... enabled: true)`, so the build step **enables the recurring delegation immediately**.

The later `Execute Now` control is only for an immediate manual run.

`keyTalkDelegation(... autoExecute:false)` similarly skips the immediate run but still builds/enables the standing loop on the server.

Therefore the user's intuitive split:

```text
BUILD
then maybe
EXECUTE
```

is not the actual authority split. `Build` already grants future recurring execution authority.

### Target UX law

Standing authority must be explicit and accessible at the moment it is granted:

```text
WHAT KEY WILL WATCH
WHAT KEY MAY DO
WHO/WHAT IT MAY AFFECT
WHEN IT MAY ACT
WHEN IT MUST ASK
BUDGET / CONTACT / RISK BOUNDS
HOW TO PAUSE / REVOKE
```

The UX should remain concise and low-friction, but the important effect semantics must be programmatically and humanly understandable.

---

# F106 — canonical invoice-overdue scheduling also lacks occurrence/state claim sufficient to prevent duplicate lifecycle events

**Status:** VERIFIED CODE-LEVEL / CROSS-JOURNEY RELIABILITY FINDING

J6 backward re-audit found that the canonical `InvoiceOverdueScheduler` is itself process-local `setInterval` work.

Each instance can read the same SENT invoice candidate.

`InvoiceWorkflowService.transition()`:

```text
load current invoice status
assert legal transition
update invoice by id
emit canonical event
```

No expected-state compare-and-set was observed on the final update.

Two workers can therefore both read `SENT` before either commits and subsequently produce duplicate `invoice.overdue` lifecycle events.

The Flow listener's customer overdue-notification path does not supply an explicit dedupe key in the inspected handler.

### Importance

This means the correct target is not:

> fix Autopilot's scheduler race

It is:

> establish shared K6/K7/K11 occurrence ownership, transition CAS/idempotency and effect identity for scheduled business-state transitions.

This finding affects J3, J6, J7, J18 and J23.

---

# 3. Standards and proven-model cross-reference

Research refreshed: 2026-09-03.

These are property references, not mandated technology choices.

## Kubernetes CronJob

Primary documentation:
`https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/`

Relevant properties:

- explicit concurrency policy: Allow / Forbid / Replace;
- explicit suspension semantics;
- scheduled-occurrence timestamp;
- job implementations should remain idempotent because scheduling can still produce edge cases.

Transferability: **ADOPT PROPERTY**.

KeyFlow should explicitly model overlap and missed-occurrence semantics instead of inheriting them from multiple `setInterval` processes.

## PostgreSQL locking / SKIP LOCKED

Primary documentation family:
`https://www.postgresql.org/docs/current/sql-select.html`

Relevant property:

`SKIP LOCKED` is documented as useful for avoiding lock contention where multiple consumers access a queue-like table.

Transferability: **POSSIBLE SMALL-SEAM IMPLEMENTATION**, not an automatic design decision.

A transactional Postgres claim may be sufficient for some KeyFlow schedules before adopting a dedicated workflow engine.

## BullMQ

Primary docs:

- `https://docs.bullmq.io/guide/jobs/deduplication`
- `https://docs.bullmq.io/guide/job-schedulers/`

Relevant properties:

- stable deduplication identity;
- Simple Mode retains dedup while work remains unresolved;
- `keepLastIfActive` provides no parallel active work for a dedup identity;
- recurring scheduler identity is upserted rather than duplicated.

Transferability: **ADAPT WHERE EXISTING BULLMQ IS ALREADY A STRONG SEAM**.

Queue dedupe still does not replace exact domain ExecutionClaim or provider-effect idempotency.

## Temporal

Primary docs:
`https://docs.temporal.io/`

Relevant property:

durable workflow state resumes through process/network/infrastructure failure rather than binding logical progress to one app process.

Transferability: **REFERENCE ARCHITECTURE / DEFER TECHNOLOGY DECISION**.

KeyFlow should import the property of durable logical workflow ownership before deciding whether Temporal is justified.

## AsyncAPI

Primary docs:

- `https://www.asyncapi.com/docs/concepts/asyncapi-document`
- `https://www.asyncapi.com/docs/concepts/asyncapi-document/define-payload`

Relevant properties:

- event/message API is a communication contract between senders and receivers;
- payload schemas define required structure and machine-readable validation.

Transferability: **ADOPT CONTRACT PROPERTY**.

KeyFlow can first create typed/versioned canonical event schemas; AsyncAPI generation/validation can follow if it improves tooling.

## OWASP AI Agent Security

Primary guidance:
`https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html`

Relevant properties:

- least privilege per tool;
- human-in-the-loop for high-impact action;
- separate decision from execution;
- bind approval to exact action and parameters;
- short-lived/replay-resistant authorization artifacts;
- idempotency for high-impact actions;
- independent policy enforcement rather than model self-authorization;
- bounded cost/retry/tool chains.

Transferability: **ADOPT / ADAPT**.

## WCAG 2.x Name, Role, Value

Primary W3C guidance:
`https://www.w3.org/WAI/WCAG21/Understanding/name-role-value`

Relevant property:

custom UI controls need programmatically determinable name, role, state/value and change notification for assistive technologies.

Transferability: **ADOPT FLOOR**.

The Autopilot enable toggle is authority-bearing and should be at least as accessible as an ordinary switch.

---

# 4. Converging target model

## 4.1 Standing Delegation Contract

Candidate target primitive/projection:

```text
StandingDelegation
  id
  businessId
  capabilityFamily / permittedChildCapabilities
  configuredBy / delegatedBy
  authorityTrace
  resource/entity bounds
  parameter/value bounds
  temporal schedule/window
  contact/channel constraints
  autonomy/control bounds
  budget/exposure bounds
  policyVersion
  authorityVersion
  startsAt / expiresAt
  pausedAt / revokedAt
  version/fingerprint
```

This need not immediately become one database table. It is the semantic contract that existing seams must satisfy.

Enabling/reconfiguring it is a control-plane authority transition.

## 4.2 ScheduleOccurrence

```text
StandingDelegation
→ ScheduleOccurrence(scheduledFor, version)
→ atomic OccurrenceClaim
→ observation / matching
→ exact child ActionEnvelope(s)
→ Clearance / bounded parent coverage
→ ExecutionClaim
→ effect
```

## 4.3 Effect evidence

```text
INTENT
→ CLAIMED
→ ATTEMPTED
→ PROVIDER_ACCEPTED
→ DELIVERED | FAILED | OUTCOME_UNKNOWN
→ RECONCILED_OUTCOME
→ BUSINESS_CONSEQUENCE
```

Not every provider exposes delivery. The evidence graph must represent the strongest state actually proven, not invent certainty.

## 4.4 Feedback boundary

```text
real human decisions
+ reconciled real outcomes
+ confidence/provenance
        ↓
LEARNING SIGNAL
        ↓
recommend tighter/looser policy
        ↓
AUTHORIZED POLICY TRANSITION
        ↓
new standing delegation/policy version
```

Learning does not directly write standing authority.

---

# 5. Dynamic graph projections added by this slice

## Authority graph

```text
Human Principal
→ grantability
→ StandingDelegation
→ bounded child capabilities
→ KEY execution lineage
```

## Temporal graph

```text
schedule definition
→ occurrence
→ claim
→ started
→ completed/failed/unknown
→ next occurrence
```

## State graph

```text
Invoice SENT
→ canonical transition owner
→ OVERDUE
→ canonical event contract
```

No parallel raw mutation path.

## Evidence graph

```text
ActionEnvelope
→ ExecutionClaim
→ provider request
→ provider acceptance id
→ delivery/reconciliation evidence
→ task/outcome projection
```

## Feedback graph

```text
outcomes/human decisions
→ confidence/trust signal
→ recommendation
→ separately authorized policy transition
```

## Failure contour

```text
scheduler duplicate
→ duplicate child intent
→ duplicate provider effect
→ duplicate customer contact
→ false evidence
→ contaminated learning
→ future behavior changes
```

Each stage needs a containment boundary.

---

# 6. Quality-dimension assessment

## Replicability

Current process-local schedulers/maps can change behavior when process count changes.

Target: deployment replica count must not alter logical business effects.

## Scalability

More workers should increase throughput without multiplying standing-delegation occurrences or external effects.

Target: horizontal scale preserves governance and idempotency semantics.

## Integration

Canonical event schemas and effect identities must remain stable across producers/consumers.

Target: no parallel private payload under a canonical event name; provider state reconciles into normalized outcome evidence.

## Accessibility

Users must be able to understand and revoke standing authority; custom controls need programmatic name/state.

Target: low-friction, plain-language authority summaries plus accessible toggle/decision controls.

---

# 7. Contradiction candidates

## C052 — schedule record vs execution ownership

A due DelegationLoop row represents scheduled work but does not give one process exclusive ownership of the occurrence.

## C053 — dedupe key vs atomic external-effect claim

A `dedupeKey` is presented as duplicate protection while current implementation checks it non-atomically before provider call.

## C054 — task execution status vs provider/effect evidence

`AUTO_EXECUTED` can mean eligible, queued, failed-return, provider-accepted or no-provider-at-all depending on path.

## C055 — canonical Invoice transition owner vs proactive raw mutation

InvoiceWorkflowService declares singular transition ownership while DelegationLoop writes the same lifecycle field directly.

## C056 — canonical event name vs incompatible producer schema

`invoice.overdue` has a typed canonical payload but DelegationLoop publishes the same event name with a different structure.

## C057 — loop-local learning evidence vs business-wide authority mutation

Approval history is scoped to one loop; `maxAutoTier` affects unrelated tools.

## C058 — configurable custom loop vs fixed executable loop vocabulary

Cortex exposes creation of arbitrary recurring loops while DelegationLoop executor only implements five fixed loop types.

## C059 — Build/configure UX vs standing-authority semantics

The UI frames `Build it` as configuration and `Execute Now` as action, while Build already enables future recurring agency.

## C060 — visual toggle vs authority-bearing accessible state

A custom unlabeled visual switch controls standing agency but lacks an observed programmatic name/state contract.

---

# 8. Proof requirements derived from this slice

Future proof, when implementation is authorized, should include:

1. two app instances race the same DelegationLoop occurrence — one claim wins;
2. retry/crash after claim and before completion — lease/recovery semantics are deterministic;
3. duplicate child-intent generation under concurrent workers — one semantic intent survives where required;
4. duplicate payment reminder workers — one provider effect for one effect identity;
5. queued email drained by two workers — one claim/send;
6. provider returns FAILED/QUEUED — task is not marked as proven executed/delivered;
7. provider accepted but local persistence fails — outcome becomes reconcilable/unknown, not blind retry duplication;
8. invoice overdue transition raced by two schedulers — one canonical transition/event consequence;
9. event-schema contract test rejects incompatible `invoice.overdue` producer payload;
10. custom loop without executable contract fails closed;
11. approvals for loop A cannot silently raise authority for unrelated capability B;
12. standing delegation enablement captures authenticated principal and grantability proof;
13. pause/revoke before child claim blocks new effect;
14. accessible switch exposes name + on/off state to assistive technology;
15. UI authority preview accurately lists material child effect classes and control bounds.

No tests were executed in this investigation.

---

# 9. Convergence impact

This slice strengthens the active constellation:

```text
J1 Business Birth
↔ J25 Human Authority
↔ J15 Governance
↔ J2 Governed Action
↔ J6 Proactive KEY
         │
         ├── J3 Customer/Cash
         ├── J7 Financial Truth
         ├── J18 Failure/Recovery
         └── J23 Temporal Workflow
```

Kernel impact:

```text
K2 Authority
   ↓
K3 Governance
   ↓
K5 Capability
   ↓
K7 Occurrence / Workflow
   ↓
K6 Canonical State Transition
   ↓
K8 Evidence
   ↓
K9 External/Event Contract
   ↓
K10 Financial Truth
   ↓
K11 Recovery / Reliability
```

The emerging architecture is not "add more scheduler locks." It is one coherent law:

> **Every autonomous business effect must be traceable from a valid standing authority through a uniquely owned occurrence and exact child action to truthful outcome evidence and bounded feedback.**
