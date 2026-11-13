# KeyFlowOS Finding Register — Event Agency Supplement

Status: CANONICAL CONTINUATION OF `08-FINDING-REGISTER.md` + `08A-FINDING-REGISTER-CURRENT-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F106.

---

## F107 — AgentTrigger has no source-event consumption identity; duplicate delivery creates independent plans

**Status:** VERIFIED CODE-LEVEL / EVENT-IDEMPOTENCY FINDING

`AgentTriggerService.handleEvent()` creates a new plan for every matching event delivery. No durable consumption key such as `sourceEventId + triggerId` was observed before plan creation.

Duplicate source deliveries therefore create different plan IDs and step IDs. BullMQ/ActionDispatcher idempotency keys are plan-step scoped (`plan:<planId>:step:<stepId>`), so they cannot collapse two plans created from one source event occurrence.

Target: canonical event occurrence identity plus consumer-specific durable consumption claim where semantics require single consumption.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J6, J14, J18, J23.

---

## F108 — AgentTrigger configured maxRiskTier does not constrain Planner output

**Status:** VERIFIED CODE-LEVEL / PARENT-AUTHORITY FINDING

AgentTrigger passes `trigger.maxRiskTier` into ParsedIntent, but `PlannerService.createPlan()` does not use `intent.maxRiskTier` in the planning prompt or as a post-generation ceiling. Planner derives real step tiers and plan maximum afterward.

AgentTrigger's auto-approval branch checks the configured trigger ceiling, not the resulting `plan.maxRiskTier`, and evaluates synthetic identity `trigger_<eventPattern>` rather than the actual child capabilities.

**Narrowing:** PlanExecutor re-evaluates each real child tool before queueing, so this is not proven to be a direct T3/T4 execution bypass. It is an invalid/misleading parent approval and repeated-governance defect.

Affected kernels: K3, K5, K7.
Affected journeys: J2, J6, J15, J23.

---

## F109 — visible AgentTrigger/Reflex opt-in does not govern hard-coded JourneyOrchestrator automation

**Status:** VERIFIED CODE-LEVEL / CONTROL-REACHABILITY FINDING

`AgentTriggerService.handleEvent()` invokes `JourneyOrchestratorService.handleEvent()` before returning when no enabled AgentTrigger rows match.

Therefore a business with zero enabled visible Reflexes can still enter hard-coded JourneyTemplate orchestration for matching events.

This strengthens F095: current stop/enable semantics are fabric-specific rather than a unified standing-authority model.

Affected kernels: K3, K7.
Affected journeys: J6, J15, J25.

---

## F110 — JourneyOrchestrator combines Planner-generated steps with deterministic template steps in one plan

**Status:** VERIFIED CODE-LEVEL / PLAN-COMPOSITION FINDING

JourneyOrchestrator first calls `PlannerService.createPlan()`, which creates an AiPlan and AI-generated AiPlanStep rows. It then appends hard-coded JourneyTemplate AiPlanStep rows to that same plan.

The resulting plan is therefore:

```text
LLM-generated steps
+
deterministic template steps
```

JourneyOrchestrator's auto-approval decision computes maximum risk from the hard-coded template subset, not from the complete combined plan.

Higher-risk invented steps can still be stopped by child re-evaluation, but low-tier invented steps may coexist in an auto-approved plan whose supposed child set came from a deterministic template.

Target: either compile a deterministic template into exact child actions, or generate an AI plan and validate its complete child set. Do not silently combine both under one approval envelope.

Affected kernels: K3, K5, K7, K8.
Affected journeys: J6, J15, J23.

---

## F111 — JourneyTemplate and default AgentTrigger assumptions drift from canonical event payload contracts

**Status:** VERIFIED CODE-LEVEL / EVENT-CONTRACT FINDING

Canonical events include shapes such as:

```text
contact.created    -> { businessId, contact }
booking.completed  -> { businessId, booking, contact? }
invoice.overdue    -> { businessId, status, invoice }
invoice.paid       -> { businessId, invoice }
```

JourneyTemplates commonly read flat `contactId`, `bookingId`, `amount`, `invoiceId`, `status`, etc. Default AgentTrigger conditions include paths such as `payload.status` and `payload.leadScore`, while the condition resolver evaluates against the received event object.

Verified consequences include conditions that cannot match canonical `contact.created` shape and unconditional JourneyTemplate mappings that can receive undefined entity data for canonical invoice/booking events.

Target: typed/versioned EventEnvelope contract plus explicit normalization adapter into agency inputs.

Affected kernels: K5, K7, K8, K9.
Affected journeys: J3, J4, J6, J7, J14, J18.

---

## F112 — JourneyTemplate delayMinutes is not executable temporal behavior

**Status:** VERIFIED CODE-LEVEL / TEMPORAL FINDING

JourneyTemplate declares `delayMinutes` and uses it for intended multi-day follow-ups/review requests. Repository search found no production reader outside the template definitions; JourneyOrchestrator does not translate it into `AiPlanStep.scheduledAt`.

Thus "3 days later" or "7 days later" exists as template metadata/descriptive intent, not as a durable schedule constraint.

Target: temporal declarations compile into durable scheduled occurrence/step semantics and are revalidated at execution time.

Affected kernels: K7, K11.
Affected journeys: J4, J6, J23.

---

## F113 — JourneyTemplate role labels do not form an execution authority boundary

**Status:** VERIFIED CODE-LEVEL / AUTHORITY-SEMANTIC FINDING

JourneyTemplate persists roles such as finance/sales/support/operations on AiPlanStep, but:

- JourneyOrchestrator does not use its injected RoleEngine in the execution path;
- PlanExecutor child evaluation receives businessId/toolName without template role;
- PlanStepJob does not carry role;
- queue-time governance is invoked without role.

Therefore the role string is descriptive metadata, not authority provenance.

Target: role/position requirements resolve through K2/K3 Effective Authority and principal lineage, not labels.

Affected kernels: K2, K3, K5.
Affected journeys: J6, J15, J25.

---

## F114 — JourneyInstance lifecycle has no observed convergence path from plan completion

**Status:** VERIFIED SEARCH-SCOPED / WORKFLOW-EVIDENCE FINDING

JourneyOrchestrator creates `JourneyInstance(status='running')` and defines `updateJourneyStatus()`. Repository search found no external consumer of that update method and no PlanExecutor/Queue reference that reconciles AiPlan completion/failure into JourneyInstance.

No runtime execution was performed; classify as search-scoped absence.

Likely risk: JourneyInstance remains stale/running after child plan completion/failure.

Target: workflow projection state must derive/reconcile from actual child execution lifecycle rather than become a second truth source.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F115 — overlapping JourneyTemplates and AgentTriggers can create two plans from one event

**Status:** VERIFIED CODE-LEVEL / DUPLICATE-AGENCY FINDING

Hard-coded JourneyTemplates and default AgentTriggers overlap on multiple events including `booking.completed`, `contact.created`, `quote.accepted`, `invoice.overdue`, `invoice.paid`, `booking.no_show`, and `quote.stale`.

For one event AgentTriggerService first invokes JourneyOrchestrator; if the corresponding AgentTrigger reflex is enabled, it then independently creates a second plan.

```text
source event E
├─ JourneyOrchestrator -> Plan-J
└─ AgentTrigger        -> Plan-T
```

The plans have different identities and therefore different queue/dispatcher idempotency keys.

Target: one canonical event-occurrence-to-action-intent mapping, or explicit coexistence proof showing consumer outputs are deliberately non-overlapping.

Affected kernels: K3, K5, K7, K8, K9, K11.
Affected journeys: J3, J4, J6, J7, J14, J18, J23.

---

## Strengthening evidence for F092

`AgentController` AgentTrigger create/update routes are protected only by `AuthGuard + BusinessGuard` in the inspected code. Caller-controlled fields include `enabled`, `autoExecute`, `maxRiskTier`, `condition`, `objective`, and `eventPattern`. No authenticated-principal grantability resolution was observed.

This is additional standing-authority control-plane evidence for F092 rather than a separate root finding.

---

# Research linkage

CloudEvents primary specification establishes `(source,id)` as the identity of a distinct event occurrence and explicitly permits a duplicate retransmission to retain the same identity so consumers can recognize it.

Property adoption for KeyFlow:

```text
Canonical EventEnvelope
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

This does not require adopting CloudEvents wire format immediately.

General at-least-once event-processing guidance likewise treats duplicate delivery as normal and requires idempotent consumers for state mutation / external effects.

---

# Pool law

The event-agency cluster now strengthens:

```text
Canonical EventOccurrence
→ ConsumerClaim / StandingEventPolicy
→ one normalized ActionIntent or bounded Plan
→ validate exact child set
→ child ActionEnvelopes
→ current governance
→ ExecutionClaims
→ effects
→ OutcomeEvidence
→ bounded feedback
```

No production implementation is authorized by this supplement.
