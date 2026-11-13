# J6 — Event-Triggered Agency & Journey Orchestration

Status: ACTIVE FORENSICS / CROSS-CONSTELLATION CONVERGENCE INPUT

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

This slice traces:

```text
canonical/domain event
→ AgentTriggerService onAny firehose
→ JourneyOrchestrator hard-coded templates
→ persisted AgentTrigger reflexes
→ Planner
→ AiPlan/AiPlanStep
→ PlanExecutor
→ BullMQ
→ ActionDispatcher
→ Flow/domain/provider effects
→ feedback
```

Affected journeys:

- J2 Governed Action
- J3 Lead → Customer → Cash
- J4 Booking → Service → Payment
- J6 Proactive KEY / Autonomy
- J7 Financial Truth
- J9 Marketing → Lead Generation
- J10 Commerce / Fulfilment
- J14 External Event Ingress
- J15 Approval / Governance
- J16 Business Genome Evolution
- J18 Failure / Recovery
- J23 Temporal Flow / Long-Running Workflow
- J25 Human Authority

Affected kernels:

- K2 Human Authority
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K9 Integration & External Reality
- K11 Recovery & Reliability

---

# 1. Current event-triggered fabrics

## A. AgentTriggerService

Runtime-reachable through `AiModule` and `OnModuleInit`.

Installs `EventEmitter2.onAny()` and examines every non-`plan.*` event with a `businessId`.

For each event it:

1. queries enabled `AgentTrigger` rows for exact `eventPattern == eventName`;
2. calls `JourneyOrchestratorService.handleEvent(eventName,payload)` regardless of whether any AgentTrigger row matched;
3. for each matching trigger, checks condition and daily limit;
4. asks Planner to create an AiPlan;
5. may auto-approve the plan;
6. emits `plan.approved` for immediate PlanExecutor execution.

## B. JourneyOrchestratorService

Hard-coded `JOURNEY_TEMPLATES` are matched directly to event names.

This is separate from AgentTrigger persisted reflex enablement.

JourneyOrchestrator:

1. selects hard-coded template(s) for event;
2. evaluates template step conditions;
3. calls Planner to create an AI-generated plan;
4. creates JourneyInstance;
5. appends deterministic template AiPlanStep rows to the Planner-created plan;
6. auto-approves when the template step maximum tier is <=2;
7. emits `plan.approved`.

## C. PlanExecutor / Queue / Dispatcher

Positive seam:

Once a plan child reaches BullMQ, the worker routes actual tool execution through `ActionDispatcherService`.

This is a strong existing seam to preserve and strengthen.

However queue idempotency is scoped to:

```text
plan:<planId>:step:<stepId>
```

so it only suppresses duplicate enqueue/execution of the **same plan step identity**. It cannot collapse two separately created plans derived from one duplicated source event.

---

# F107 — AgentTrigger has no source-event consumption identity; duplicate event delivery creates independent plans

**Status:** VERIFIED CODE-LEVEL / EVENT-IDEMPOTENCY FINDING

`AgentTriggerService.handleEvent()` receives only event name/payload and directly creates a new plan for each matching delivery.

No durable consumer key such as:

```text
sourceEventId + triggerId
```

or equivalent consumption claim was observed before plan creation.

### Consequence

```text
same logical event delivered twice
→ handleEvent twice
→ Plan-A + Plan-B
→ Step-A ids + Step-B ids
→ distinct BullMQ job/idempotency keys
→ both are independently executable
```

The queue/dispatcher cannot infer these plans represent the same source occurrence because causal event identity has already been lost.

### Target law

> Duplicate delivery of one logical event must not manufacture multiple proactive business intentions where the consumer semantics are single-consumption.

Canonical EventEnvelope should expose stable occurrence identity and each side-effecting consumer should have its own durable consumption identity.

---

# F108 — AgentTrigger configured maxRiskTier is not enforced as a Planner child-action ceiling

**Status:** VERIFIED CODE-LEVEL / PARENT-AUTHORITY FINDING

AgentTrigger passes `trigger.maxRiskTier` into the ParsedIntent supplied to Planner.

`PlannerService.createPlan()` does not use `intent.maxRiskTier` in its planning prompt or as a post-generation constraint. It derives actual step tiers from `governance.getToolTier(toolName)` and computes the real `plan.maxRiskTier` afterward.

AgentTrigger then enters its auto-approval branch based on:

```text
trigger.autoExecute
&& trigger.maxRiskTier <= 2
```

rather than:

```text
plan.maxRiskTier <= authorized trigger ceiling
```

It evaluates synthetic tool identity:

```text
trigger_<eventPattern>
```

which is not the plan child capability and is treated as an unknown/default Tier-2-like tool by the current governance tier resolver.

### Important narrowing

This is **not currently proven to be a direct T3/T4 execution bypass**.

`PlanExecutorService` re-evaluates each concrete child tool before enqueue. Formal/admin controls can therefore stop higher-tier child execution.

The verified defect is:

- trigger ceiling does not constrain plan composition;
- parent plan can be stamped `approved` even when real plan max tier exceeds the trigger's declared ceiling;
- child execution then falls back into another round of governance/approval.

This strengthens J15's laws:

```text
parent approval/standing delegation
must bind the actual child set and bounds
```

---

# F109 — visible AgentTrigger/Reflex opt-in does not govern hard-coded JourneyOrchestrator automation

**Status:** VERIFIED CODE-LEVEL / CONTROL-REACHABILITY FINDING

`AgentTriggerService.handleEvent()` invokes:

```text
journeyOrchestrator.handleEvent(eventName,payload)
```

before:

```text
if (triggers.length === 0) return
```

Therefore a business can have **zero enabled AgentTrigger reflexes** and still enter hard-coded JourneyTemplate orchestration whenever a matching event is emitted.

The current Reflex UI accurately says its listed AgentTriggers start switched off, but switching them all off does not disable the parallel JourneyOrchestrator event reactions.

### Target implication

A user-visible `Autopilot reflexes` control cannot be treated as a universal event-agency control unless all proactive event fabrics consume the same standing-authority semantics.

This strengthens F095's broader rule that stop/enable semantics are currently fabric-specific.

---

# F110 — JourneyOrchestrator combines AI-generated Planner steps with deterministic template steps in one plan

**Status:** VERIFIED CODE-LEVEL / PLAN-COMPOSITION FINDING

`JourneyOrchestrator.executeJourney()` first calls:

```text
planner.createPlan(...)
```

`PlannerService.createPlan()` itself creates an AiPlan **and its generated AiPlanStep rows**.

JourneyOrchestrator then loops through the hard-coded template and creates additional `AiPlanStep` rows on that same plan.

Thus the resulting plan is:

```text
LLM-generated steps
+
hard-coded JourneyTemplate steps
```

rather than a deterministic compilation of the template.

JourneyOrchestrator's later auto-approval decision calculates `maxTier` only from `executableSteps` in the hard-coded template; it does not compute from the complete combined plan after the Planner-created steps have been appended.

### Consequence

The template is not the full approved child set. LLM-generated low-tier actions may coexist in a plan that was auto-approved using only template risk semantics. Higher-risk generated steps are still subject to PlanExecutor re-evaluation, but the parent plan's approval meaning is not coherent.

### Target options

Choose one coherent model per journey:

```text
DETERMINISTIC TEMPLATE
→ compile exact child ActionEnvelopes
```

or:

```text
AI PLANNING
→ generate child set
→ validate exact set/bounds
```

Do not silently combine both sources into one approval envelope.

---

# F111 — JourneyTemplate and default AgentTrigger conditions drift from canonical event payload contracts

**Status:** VERIFIED CODE-LEVEL / EVENT-CONTRACT FINDING

Canonical event types include structures such as:

```text
contact.created
{ businessId, contact }

booking.completed
{ businessId, booking, contact? }

invoice.overdue
{ businessId, status, invoice }

invoice.paid
{ businessId, invoice }
```

JourneyTemplates commonly read flat fields:

```text
payload.contactId
payload.status
payload.bookingId
payload.amount
payload.invoiceId
```

and default AgentTrigger conditions include paths such as:

```text
payload.status
payload.leadScore
```

while `AgentTriggerService.evaluateCondition()` evaluates those paths directly against the event object it receives.

### Verified examples

- canonical `contact.created` places status/ID inside `contact`, not `payload.status` / flat `contactId`;
- canonical `invoice.overdue` places invoice data inside `invoice`, not flat `invoiceId/contactId/amount`.

### Failure modes

Depending on template:

- condition evaluates false and intended journey never starts;
- unconditional step receives undefined entity identifiers/amounts;
- generated AI plan still exists while deterministic mapping is malformed;
- event contract changes silently alter automation behavior.

### Target law

Canonical event types need machine-readable schema/version ownership and adapters must explicitly normalize into the business-agency input model.

Do not address this with more optional chaining alone.

---

# F112 — JourneyTemplate `delayMinutes` is not executed as temporal behavior

**Status:** VERIFIED CODE-LEVEL / TEMPORAL-SEMANTIC FINDING

JourneyTemplate defines `delayMinutes?: number` and uses it for intended delays such as:

- follow up 3 days after booking;
- request review 7 days later.

Current repository search finds no production reader of `delayMinutes` outside the template declaration/values.

JourneyOrchestrator does not translate it to `AiPlanStep.scheduledAt` when creating deterministic template steps.

Therefore the declared temporal contract is not load-bearing.

### Target law

Time is executable semantics:

```text
declared delay/deadline
→ durable scheduled occurrence / scheduledAt
→ revalidated delayed child action
```

Human-facing descriptions must not be the only place where timing exists.

---

# F113 — JourneyTemplate role labels are not an execution authority boundary

**Status:** VERIFIED CODE-LEVEL / AUTHORITY-SEMANTIC FINDING

JourneyTemplate assigns roles such as `finance`, `sales`, `support`, `operations`, `marketing` to steps and JourneyOrchestrator persists the role on `AiPlanStep`.

However:

- JourneyOrchestrator injects `RoleEngineService` but no role-engine call was observed in its execution path;
- PlanExecutor `evaluateStep()` receives businessId + toolName, not the template role;
- BullMQ `PlanStepJob` does not carry role;
- queue-time `evaluateAutoApproval()` is called without role.

Thus template role is descriptive/planning metadata, not proven authority provenance or role-bound control.

### Target implication

If a workflow says an action is performed "as finance" or requires finance authority, that must resolve through K2/K3 Effective Authority / exact principal lineage rather than a string label on the step.

---

# F114 — JourneyInstance lifecycle is not observed to converge with plan completion

**Status:** VERIFIED SEARCH-SCOPED / WORKFLOW-EVIDENCE FINDING

`JourneyOrchestratorService` creates `JourneyInstance(status='running')` and exposes an `updateJourneyStatus()` method.

Current repository search found the JourneyInstance update method only inside JourneyOrchestrator itself and found no consumer wiring plan completion/failure back into JourneyInstance state.

`PlanExecutor` / Queue update AiPlan/AiPlanStep and agent-state-machine state but do not reference `journeyInstanceId` in the inspected code.

### Classification

Search-scoped absence; no runtime execution performed.

### Likely consequence to prove later

JourneyInstance may remain `running` after its plan has completed/failed, making workflow coordination state stale.

### Target law

Workflow projection state must be causally derived from the actual child execution lifecycle or independently reconciled; it must not become a second stale truth source.

---

# F115 — overlapping JourneyTemplates and AgentTriggers can create two plans from one event

**Status:** VERIFIED CODE-LEVEL / DUPLICATE-AGENCY FINDING

The hard-coded JourneyTemplate set and default persisted AgentTrigger set overlap on multiple event names, including examples such as:

- `booking.completed`;
- `contact.created`;
- `quote.accepted`;
- `invoice.overdue`;
- `invoice.paid`;
- `booking.no_show`;
- `quote.stale`.

For every event, AgentTriggerService first invokes JourneyOrchestrator. If an overlapping AgentTrigger is also enabled, it then independently creates a second plan from the trigger.

Therefore one event can produce:

```text
source event E
├─ JourneyOrchestrator → Plan-J
└─ AgentTrigger        → Plan-T
```

The two plans have different IDs/step IDs and therefore different queue/dispatcher idempotency keys.

### Architectural implication

This is not solved by strengthening BullMQ dedupe.

There must be one canonical mapping from event occurrence + standing policy to business-action intent, or explicit coexistence semantics proving the two consumers intentionally produce non-overlapping effects.

---

# 2. Additional authority finding — strengthens F092 rather than creating a duplicate ID

`AgentController` exposes AgentTrigger create/update under only `AuthGuard + BusinessGuard` in the inspected routes.

Caller-controlled fields include:

```text
enabled
autoExecute
maxRiskTier
condition
objective
eventPattern
```

No authenticated-principal grantability derivation was observed on those routes.

This is pooled as additional evidence for F092 / K3 standing-authority control-plane weakness rather than a separate root finding.

---

# 3. Positive seams to preserve

## Default triggers opt-in seeding

`DefaultTriggersService.seedForBusiness()` intentionally seeds default triggers disabled unless explicitly overridden.

This is a good product/security property:

```text
available automation
!= automatically granted authority
```

The issue is that JourneyOrchestrator currently creates a parallel path around that opt-in model.

## PlanExecutor real child re-evaluation

Concrete plan steps are re-evaluated using real `toolName` before queueing, reducing the severity of invalid parent auto-approval for higher-risk children.

This should be preserved while replacing repeated re-approval with coherent bounded parent clearance.

## ActionDispatcher seam

BullMQ PlanStep execution routes through ActionDispatcher.

This remains the preferred post-clearance seam to strengthen for atomic ExecutionClaim, exact effect identity and feedback/evidence normalization.

---

# 4. External research cross-reference

Research refreshed: 2026-09-03.

## CloudEvents specification

Primary spec:
`https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md`

Relevant property:

```text
source + id
```

uniquely identifies one distinct event occurrence; re-delivery of a duplicate may reuse the same ID and consumers may treat identical source+id as duplicates.

Transferability: **ADOPT PROPERTY**, not necessarily full protocol.

Candidate KeyFlow EventEnvelope:

```text
eventId
source
type
schemaVersion
businessId
subject/entity refs
occurredAt
correlationId
causationId
payload
```

## At-least-once consumer guidance

Modern event-driven architecture guidance treats duplicate delivery as normal and requires idempotent consumers / tracked consumption for side-effecting projections.

Transferability: **ADOPT**.

KeyFlow must not assume in-process EventEmitter delivery is the final production event semantics if the same business events can also arrive through retries/webhooks/queues or be emitted twice by racing transition producers.

---

# 5. Closed-loop graph for event-triggered agency

Current:

```text
DOMAIN EVENT
   │
   ├─ hard-coded JourneyTemplate
   │      ↓
   │   Planner-generated steps
   │      +
   │   deterministic template steps
   │      ↓
   │   auto-approval from template subset
   │
   └─ enabled AgentTrigger
          ↓
       Planner
          ↓
       auto-approval from trigger wrapper/config

both
→ PlanExecutor
→ per-child governance
→ BullMQ
→ ActionDispatcher
→ Flow/domain effect
→ feedback
```

Target:

```text
Canonical EventEnvelope(event occurrence identity)
→ durable consumer claim / policy match
→ exact StandingEventPolicy / StandingDelegation
→ ONE normalized ActionIntent / bounded Plan
→ validate child set against standing bounds
→ exact child ActionEnvelopes
→ current governance
→ ExecutionClaims
→ effects
→ OutcomeEvidence
→ bounded feedback
```

---

# 6. New contradiction candidates

## C061 — Reflex opt-in vs always-evaluated JourneyTemplates

Visible AgentTriggers are opt-in, but parallel hard-coded JourneyTemplates react independently of that switch.

## C062 — configured trigger risk ceiling vs generated plan risk

`maxRiskTier` is presented/stored as a trigger constraint but does not constrain Planner output.

## C063 — deterministic JourneyTemplate vs AI-invented plan steps

A single JourneyInstance combines a deterministic workflow definition with separately generated Planner steps.

## C064 — canonical event contract vs flat JourneyTemplate input assumptions

Typed domain events are nested canonical objects while templates/default conditions read incompatible flat paths.

## C065 — declared temporal delay vs immediate executable step

JourneyTemplate says days later; execution model does not consume `delayMinutes`.

## C066 — declared business role vs unenforced execution principal

Step role exists in template/persistence but does not reach governance/execution as authority.

## C067 — JourneyInstance running state vs independently completed AiPlan

JourneyInstance lifecycle has no observed completion reconciliation from plan state.

## C068 — one event occurrence vs two independent proactive plans

Overlapping JourneyTemplate + AgentTrigger consumers can each create a plan for one event.

---

# 7. Kernel laws strengthened

## K3 — Governance

Standing event automation must be authorized against the actual child capability set/bounds, not a synthetic trigger label.

## K5 — Capability

Planner output must resolve to registered exact capabilities and remain inside the authorized parent envelope.

## K7 — Temporal/Event/Workflow

```text
event occurrence identity
→ consumer identity
→ one intended workflow/action graph
```

Temporal fields such as delay are executable semantics.

## K8 — Evidence

Journey/plan/workflow status must reconcile with actual execution and not fork into stale projections.

## K9 — Integration

Canonical event schemas are contracts; consumers normalize from those contracts rather than assume ad hoc payload layouts.

## K11 — Reliability

Per-plan idempotency cannot compensate for duplicate plan creation from one source event.

---

# 8. Immediate next trace

1. classify all JourneyTemplate trigger events by real emitter reachability;
2. identify which template tools are live, aliases, legacy or missing from canonical capability registry;
3. trace one high-value overlapping event (`invoice.overdue` or `booking.completed`) end-to-end through both automation fabrics;
4. inspect external-effect reconciliation for the resulting send actions;
5. instantiate K9 once current producer/consumer/provider seams are sufficiently mapped;
6. feed event identity/standing-event-policy laws into J14 and J23 when opened microscopically.

No production implementation is authorized.
