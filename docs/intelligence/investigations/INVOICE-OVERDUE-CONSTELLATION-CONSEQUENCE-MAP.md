# Invoice Overdue — Constellation Consequence Map

Status: ACTIVE CROSS-JOURNEY CONVERGENCE / REPRESENTATIVE EVENT TRACE

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

Purpose: trace one business fact—an invoice becomes overdue—through every material current consumer to distinguish healthy event fan-out from duplicate ownership of business consequences.

Affected journeys:

- J3 Lead → Customer → Cash
- J5 Conversation → Business Action
- J6 Proactive KEY / Autonomy
- J7 Financial Truth
- J13 Connector Lifecycle
- J14 External Event Ingress/Egress semantics
- J15 Governance
- J18 Failure / Recovery
- J23 Temporal Flow

Affected kernels:

- K3 Governance
- K5 Capability
- K6 State Transition
- K7 Temporal/Event/Workflow
- K8 Evidence/Outcome
- K9 Integration/External Reality
- K10 Financial Truth
- K11 Recovery/Reliability

---

# 1. Canonical occurrence source

Preferred current domain seam:

```text
InvoiceOverdueScheduler
→ InvoiceWorkflowService.transition(invoiceId,'OVERDUE')
→ canonical invoice.overdue InvoiceStatusPayload
```

`InvoiceWorkflowService` declares itself the single owner of invoice lifecycle transitions.

Known exception already captured in F102:

```text
DelegationLoop payment_recovery
→ raw invoice.update(status='OVERDUE')
→ incompatible invoice.overdue payload
```

---

# 2. Consumer classification

## A. FlowListener

Class: **PROJECTION + CUSTOMER CONTACT**

On canonical `invoice.overdue`:

- creates an in-app business notification;
- automatically calls TransactionalEmailService to send an `invoice_overdue` customer email.

The inspected call does not supply an explicit dedupe key.

Therefore every repeated canonical handler invocation is eligible to create another notification and another email attempt.

## B. ActivityEventListener / AI listeners / other read models

Class: **PROJECTION / OBSERVATION**

These are legitimate event fan-out consumers when they remain idempotent or tolerate repeated observation.

No architectural requirement exists for "one listener". The target is one owner per business consequence, not one consumer per event.

## C. WebhookDispatcherService

Class: **EXTERNAL EVENT DELIVERY**

On `invoice.overdue` it forwards the canonical invoice/status to every active subscribed business webhook.

Current outbound payload:

```text
event
timestamp
businessId
data
```

No stable KeyFlow event-occurrence ID or delivery ID is included in the body/headers.

Retries reuse the same local body/timestamp inside one dispatch attempt cycle, but a repeated internal event invocation constructs a fresh timestamp and is indistinguishable from a distinct occurrence to an external consumer.

Delivery logs are process-memory (`deliveryLogs[]`), not durable integration evidence.

## D. AutomationExecutorService — built-in consequence

Class: **PROJECTION + TASK CREATION + CONTACT MUTATION**

Every canonical `invoice.overdue` handler invocation:

- logs activity;
- creates a `Collect overdue invoice` ContactTask for next day;
- reads contact tags and adds `overdue`.

`CrmTimelineService.addTask()` creates a new ContactTask with no observed semantic event/effect dedupe key.

The tag write is naturally closer to idempotent because it uses a Set, while task creation is not.

## E. AutomationExecutorService — business-configured playbooks

Class: **CONFIGURABLE BUSINESS ACTION**

Every matching enabled playbook may independently execute:

- create task;
- add tag;
- update contact status;
- send email;
- queue WhatsApp;
- queue campaign;
- log event.

These are legitimate user-authored automations in principle. They require stable source-event/flow-run identity so replay of one occurrence does not duplicate effects.

## F. AutomationFlow / FlowRunner

Class: **CONFIGURABLE WORKFLOW / BUSINESS ACTION**

AutomationExecutor invokes active visual flows whose trigger matches `invoice.overdue`.

`FlowRunnerService` already supports:

- `sourceEventId` on FlowRun;
- `idempotencyKey` lookup before creating a run.

However AutomationExecutor currently passes:

```text
sourceEventId: context.sourceEventId ?? null
idempotencyKey: `${triggerEvent}::${flow.id}::${Date.now()}`
```

The `invoice.overdue` context supplied by the handler has no sourceEventId.

Therefore every event handler invocation deliberately gets a distinct idempotency key and cannot use FlowRunner's existing dedupe seam.

This is an existing seam to strengthen, not a reason to replace FlowRunner.

## G. JourneyOrchestrator hard-coded template

Class: **AI/WORKFLOW PLAN CREATION**

Hard-coded `invoice-overdue` JourneyTemplate includes:

- draft payment reminder;
- `send_message_with_approval`;
- collection task;
- slow-payer tag if >30 days.

Important narrowing:

`send_message_with_approval` is Tier 3 in current capability documentation, so the template plan's own maximum tier is above the JourneyOrchestrator auto-approval threshold. The template is not proven to auto-send the customer reminder without further control.

However its canonical event input mapping is currently incompatible with the nested `InvoiceStatusPayload` contract (F111), and JourneyOrchestrator can coexist with other automation fabrics.

## H. persisted AgentTrigger reflex

Class: **AI PLAN CREATION / STANDING EVENT AGENCY**

Default trigger `invoice.overdue` can be user-enabled and independently create another Planner plan.

Its configured max tier does not constrain Planner output (F108), but exact children are re-evaluated by PlanExecutor before queueing.

One event may therefore create both a JourneyOrchestrator plan and AgentTrigger plan (F115).

## I. DelegationLoop payment recovery

Class: **SCHEDULED PROACTIVE DOMAIN MUTATION + CUSTOMER CONTACT**

Independently scans SENT/OVERDUE invoices after configured grace milestones, creates AutopilotTask records, may send payment-reminder email, and in the SENT case can itself mark invoice OVERDUE.

Its reminders may be intentionally later cadence than the canonical immediate-overdue notification. The architectural problem is not that two reminders must never exist; it is that **cadence/effect identity is divided across independent fabrics** without one communication-policy/effect graph proving they are intentional and non-conflicting.

## J. FlowSignal / Cortex observation

Class: **OBSERVATION / SIGNAL**

Observation paths normalize invoice-overdue state into FlowSignals/Cortex perception without direct provider effect in the inspected path.

This separation is healthy and should be preserved:

```text
OBSERVE != ACT
```

## K. KeyCortexTriggerRule

Class: **EVENT → GOAL / OPTIONAL PLAN**

KeyCortexTriggerService can subscribe rule(s) to `invoice.overdue` on KeyCortexEventBus and can create a goal, optionally plan/execute if `goalTemplateId` is present.

Its current cooldown/daily firing state is process-local Map state, so horizontal replicas do not share firing limits.

This is a distinct Cortex event fabric and should be normalized into the same standing-event-policy semantics without discarding the useful normalized Cortex event envelope.

---

# F116 — canonical business events lack propagated occurrence identity across material consumers

**Status:** VERIFIED CROSS-COMPONENT / EVENT-CAUSALITY FINDING

The current canonical `invoice.overdue` EventEmitter payload identifies the domain object/status but does not carry a first-class event occurrence ID/correlation/causation envelope through all consumers.

Material consumers therefore manufacture local identities independently:

- FlowListener has no event ID for its notification/email;
- AutomationExecutor gives FlowRunner a Date.now-based idempotency key;
- WebhookDispatcher generates a fresh timestamp per invocation;
- AgentTrigger creates new plan identity per handler call;
- built-in collection task creates a new task per call.

### Target law

```text
one domain occurrence
→ one stable EventOccurrence identity
→ each material consumer derives its own stable consumption/effect identity
```

The target is not to prohibit fan-out; it is to preserve causality through the fan-out.

---

# F117 — AutomationExecutor defeats FlowRunner's existing event-idempotency seam

**Status:** VERIFIED CODE-LEVEL / EXISTING-SEAM FINDING

`FlowRunnerService` already stores `sourceEventId` and checks a provided `idempotencyKey` before creating a FlowRun.

`AutomationExecutorService.executeFlows()` invokes it with:

```text
sourceEventId = null for current canonical invoice event context
idempotencyKey = event + flowId + Date.now()
```

Thus replay of one event can never collide with the prior key.

### Target implication

Strengthen the existing seam:

```text
EventOccurrenceId + FlowDefinitionVersion
→ stable FlowRun identity/claim
```

instead of adding another workflow engine solely for event dedupe.

---

# F118 — built-in invoice-overdue task creation is replay-sensitive

**Status:** VERIFIED CODE-LEVEL / BUSINESS-INTENT DUPLICATION FINDING

AutomationExecutor's built-in `invoice.overdue` handler unconditionally calls `crm.addTask()` for `Collect overdue invoice`.

`CrmTimelineService.addTask()` creates a new ContactTask with no observed source-event/effect uniqueness key.

Therefore duplicate lifecycle-event handling can create duplicate operational work even if downstream external communications are gated elsewhere.

Target task-intent identity candidate:

```text
sourceEventOccurrence
+ capability/create_collection_task
+ invoiceId/contactId
+ policy/version
```

or an equivalent semantic uniqueness envelope.

---

# F119 — outbound webhook delivery lacks durable event/delivery identity and durable delivery evidence

**Status:** VERIFIED CODE-LEVEL / EXTERNAL-INTEGRATION FINDING

WebhookDispatcher:

- constructs event/timestamp/business/data payload;
- signs body;
- retries inline up to three attempts;
- stores delivery history only in process memory;
- does not expose a stable KeyFlow event occurrence ID / globally unique delivery ID to the receiver in the inspected request contract.

A repeated internal occurrence delivery creates a newly timestamped outbound webhook and cannot be recognized by the receiver as a replay of the same KeyFlow event unless it invents domain-specific dedupe logic.

Process restart also loses delivery log evidence.

### Proven-model comparison

GitHub webhooks provide a globally unique `X-GitHub-Delivery` identifier in addition to event name and signature. CloudEvents defines stable `source + id` occurrence identity.

Target properties:

```text
EventOccurrenceId
DeliveryId
AttemptId
WebhookSubscriptionId
status
attempt count
provider/HTTP result
next retry/reconciled state
```

Receiver-visible delivery identity and durable local delivery evidence should be distinct from signature/authentication.

---

# F120 — one overdue fact currently has multiple independent business-consequence owners without a shared consequence graph

**Status:** VERIFIED ARCHITECTURAL / CROSS-JOURNEY FINDING

A canonical `invoice.overdue` occurrence can legitimately feed many projections. But current material consequence ownership is distributed across:

- FlowListener automatic customer overdue email;
- AutomationExecutor built-in collection task + contact tag;
- user-configured playbooks;
- user-configured visual flows;
- hard-coded JourneyOrchestrator;
- optional AgentTrigger reflex;
- independently scheduled DelegationLoop payment recovery;
- external webhook delivery;
- optional Cortex TriggerRule goal/plan.

Not all are duplicate effects and some are intentionally distinct. The defect is that there is no shared causal/effect graph proving which consequence owns which business intent, cadence, control policy and effect identity.

### Target model

```text
InvoiceOverdue EventOccurrence
├─ projections/read models
├─ external event subscriptions
└─ BusinessConsequencePolicy
    ├─ CollectionTaskIntent
    ├─ CustomerReminderCadence
    ├─ StandingAutomationFlow(s)
    └─ AI/KEY recommendation/plan
```

Each material branch has explicit owner, precedence/coexistence rules, authority and effect identity.

This preserves extensibility while preventing accidental double-action.

---

# 3. Standards / reference properties

Research refreshed 2026-09-03.

## CloudEvents

Primary specification property:

- an event is a record of an occurrence;
- `source + id` is unique per distinct event;
- retransmitted duplicates may retain the same identity so consumers can recognize them.

Adopt the property; wire-format adoption remains optional.

## GitHub webhook delivery model

Primary GitHub webhook documentation exposes:

- event name;
- webhook identifier;
- globally unique `X-GitHub-Delivery` identifier;
- HMAC signature.

Transferability:

```text
AUTHENTICITY != DELIVERY IDENTITY != EVENT IDENTITY
```

KeyFlow outbound webhooks should expose stable receiver-visible identity so subscribers can implement replay-safe consumption.

---

# 4. Converging ownership law

The representative invoice trace suggests a general whole-OS invariant:

> **One canonical business-state occurrence may fan out to many consumers, but every material business consequence must have explicit ownership, causal identity, coexistence/precedence semantics, and replay-safe execution.**

Healthy fan-out:

```text
event
├─ analytics
├─ audit
├─ cache/read-model projection
└─ observability
```

Governed consequence fan-out:

```text
event occurrence
→ policy/standing automation match
→ normalized ActionIntent(s)
→ dedupe/coexistence
→ governance
→ effect claim
→ outcome evidence
```

---

# 5. Adjacent K7 finding reserved for J23

During FlowRunner inspection, delay nodes longer than 30 seconds were observed to record `{ persisted: true }` but immediately continue traversal; no durable delayed resumption is scheduled in that path. This is important K7/J23 evidence but is intentionally **not assigned a finding ID in this invoice-overdue slice** until J23's long-running-workflow trace establishes reachability and intended semantics.

---

# 6. Next implications

This trace is sufficient to activate K9 Integration & External Reality as a formal kernel dossier.

Immediate follow-up:

1. instantiate K9;
2. pool F116-F120 and corresponding contradictions;
3. run a second representative event (`booking.completed`) to test whether consequence fragmentation generalizes;
4. then feed shared event/effect laws back into J6/J14/J18/J23.

No production implementation is authorized.
