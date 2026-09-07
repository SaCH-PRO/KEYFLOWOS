# J17 Dual-Projection Invoice-Overdue Trace — 2026-09-06

Status: EVIDENCE PACKET — CANDIDATE F181/C131 REJECTED FOR CANONICALIZATION

Journey: `J17 — Command Center → Priority → Action`

Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`

Production implementation: READ-ONLY / NOT AUTHORIZED.

## Question

Does one same overdue-invoice condition currently materialize into both:

1. the persistent `CommandItem` queue; and
2. the synthesized `BusinessCommandCenter` Temporal urgent/risk projection,

such that user disposition on one can drift from the other?

Candidate root before trace:

```text
SAME BUSINESS CONDITION
→ MULTIPLE COMMAND-CENTER PROJECTIONS
→ DISPOSITION ON ONE DOES NOT CONVERGE THE OTHER
```

This candidate would only justify a new F/C identifier if the same-condition overlap is load-bearing in the current runtime.

## Verdict

`NOT PROVEN / REJECT FOR CANONICALIZATION AT CURRENT IMPLEMENTATION HEAD`

The overdue invoice is definitely represented in more than one operational fabric, but the exact bridge required to make it load-bearing in both Command Center priority surfaces was not found.

Observed current fabrics are:

```text
Invoice status truth
→ CommandGeneratorService
→ persistent CommandItem

Invoice overdue watcher
→ KeyCortex event bus
→ FlowSignalBridgeService
→ durable FlowSignal

TemporalFlowService
→ durable TemporalFlowEvent
→ analyze()
→ synthesized temporal urgent/risk items
```

The missing link is:

```text
invoice.overdue / proactive.invoice_overdue
→ TemporalFlowEvent(source='APP', type='invoice.overdue')
```

No production listener/materializer establishing that bridge was found in the repository search performed for this trace.

Therefore the stronger claim that one invoice condition is currently load-bearing in both J17 Command Center priority universes is not established.

## Evidence

### 1. Persistent CommandItem path is proven

`CommandGeneratorService.seedFromOverdueInvoices()` scans canonical `Invoice.status = 'OVERDUE'` rows and creates durable CommandItems with:

```text
sourceModule = finance
sourceType = invoice
sourceId = invoice.id
actionType = COLLECT_RECEIVABLE
priority = 90
urgency = 90
impactScore = 85
executableByKey = true
executionTool = finance.queueInvoiceReminders
```

This side is load-bearing for the persistent Command Queue.

### 2. Canonical invoice overdue transition/event is proven

`InvoiceOverdueScheduler` scans `SENT` invoices whose due date has passed and calls:

```text
InvoiceWorkflowService.transition(invoiceId, 'OVERDUE')
```

The workflow persists the status transition and emits `invoice.overdue` after the write.

### 3. EventEmitter listeners do not materialize TemporalFlowEvent

Repository search for explicit `@OnEvent('invoice.overdue')` listeners found consumers in:

- AI listener;
- Flow notification listener;
- activity-event listener;
- webhook dispatcher;
- automation executor.

No `TemporalFlowService.emit(...)` materializer for that event was found.

The Temporal Flow module registers its own KEY Inbox listener, but no general APP-domain event bridge was observed.

### 4. Proactive watcher creates FlowSignal, not TemporalFlowEvent

`InvoiceOverdueWatcherService` independently scans overdue invoices and publishes:

```text
source = proactive_watcher
type = proactive.invoice_overdue
```

`FlowSignalBridgeService` normalizes that event to `invoice.overdue` and persists it as a `FlowSignal` routed into financial/temporal/people flows.

This proves a second durable representation of the condition, but it is not the `TemporalFlowEvent` store consumed by `TemporalFlowService.analyze()`.

### 5. Temporal analyzer requires APP TemporalFlowEvent for its specific overdue synthesis

`TemporalFlowService.analyze()` constructs the overdue-invoice urgent/risk synthesis from events satisfying:

```text
e.source === 'APP'
&& e.type === 'invoice.overdue'
&& e.status !== 'RESOLVED'
```

Repository search did not find a load-bearing producer that turns either the canonical `invoice.overdue` EventEmitter event or the proactive watcher FlowSignal into that required APP TemporalFlowEvent.

## Interpretation

The current architecture has at least three partially parallel operational/observational fabrics:

```text
CommandItem
FlowSignal
TemporalFlowEvent
```

They should not be assumed to be synchronized merely because they carry related event names or semantic conditions.

This is useful whole-system pressure, but it is not enough to allocate the previously contemplated F181/C131 root for same-condition Command Center disposition drift.

## Canonical action

```text
DO NOT ALLOCATE F181/C131 FOR THIS HYPOTHESIS.
```

Retain existing roots:

- `F179/C129` — Command Center degraded source completeness can masquerade as healthy zero;
- `F180/C130` — persistent CommandItem can terminalize itself as EXECUTED without source/effect truth;
- prior temporal/event/projection findings where applicable.

If future implementation evidence proves an APP-domain event materializer into TemporalFlowEvent, reopen this hypothesis and trace disposition convergence before allocating any new identifier.

## Architectural pressure preserved

The absence of the bridge does not mean the architecture is already coherent. It means the current problem is better stated as:

```text
MULTIPLE PARTIALLY PARALLEL OPERATIONAL FABRICS
WITH DIFFERENT PRODUCERS / STORES / CONSUMERS
!= PROVEN SINGLE OPERATOR-STATE PROJECTION
```

That pressure should inform J17 synthesis and later target architecture, but a new canonical F/C root is premature until a concrete load-bearing contradiction is proven.

## Next J17 trace

Move to the ranking/priority contract itself:

```text
persistent CommandItem:
priority + urgency + impactScore + dueAt + riskTier + disposition

vs

BusinessCommandCenterItem:
priority class + static type weight + createdAt recency
```

Trace whether urgency, deadline/lateness, impact/value, confidence, authority/actionability, recovery state, freshness/supersession and user disposition are represented consistently enough for the Command Center to explain why one item outranks another.
