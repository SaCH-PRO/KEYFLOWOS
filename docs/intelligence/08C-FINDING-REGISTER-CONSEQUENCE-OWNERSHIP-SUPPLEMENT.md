# KeyFlowOS Finding Register — Consequence Ownership Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after `08B-FINDING-REGISTER-EVENT-AGENCY-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F115.

---

## F116 — canonical business events lack propagated occurrence identity across material consumers

**Status:** VERIFIED CROSS-COMPONENT / EVENT-CAUSALITY FINDING

The representative `invoice.overdue` path carries canonical domain state but no first-class event occurrence identity through all material EventEmitter consumers.

Downstream systems therefore manufacture unrelated local identities:

- FlowListener has no event identity for automatic notification/email consequence;
- AutomationExecutor manufactures Date.now-based FlowRunner idempotency keys;
- WebhookDispatcher creates a fresh timestamp per internal handler invocation;
- AgentTrigger creates a new plan per handler invocation;
- built-in collection work creates a new ContactTask per invocation.

Target law:

```text
one domain occurrence
→ stable EventOccurrenceId
→ consumer-specific stable ConsumptionId / EffectId
```

Fan-out remains valid; causal identity must survive it.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J3, J6, J7, J14, J18, J23.

---

## F117 — AutomationExecutor defeats FlowRunner's existing event-idempotency seam

**Status:** VERIFIED CODE-LEVEL / EXISTING-SEAM FINDING

`FlowRunnerService` already persists `sourceEventId` and checks a supplied `idempotencyKey` before creating a FlowRun.

`AutomationExecutorService.executeFlows()` supplies no source event identity for canonical invoice events and constructs:

```text
`${triggerEvent}::${flow.id}::${Date.now()}`
```

Every delivery therefore receives a fresh key and can never hit the existing idempotency lookup.

Target: strengthen the existing runner seam with stable `EventOccurrenceId + FlowDefinitionVersion` rather than inventing a parallel workflow subsystem for this problem.

Affected kernels: K7, K9, K11.
Affected journeys: J6, J14, J18, J23.

---

## F118 — built-in invoice-overdue task creation is replay-sensitive

**Status:** VERIFIED CODE-LEVEL / BUSINESS-INTENT DUPLICATION FINDING

AutomationExecutor's built-in canonical `invoice.overdue` handler creates a new `Collect overdue invoice` ContactTask on every invocation.

`CrmTimelineService.addTask()` creates a ContactTask directly with no observed source-event/effect uniqueness identity.

Repeated lifecycle-event handling can therefore duplicate operational work even when later provider effects are independently gated.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J3, J6, J7, J18.

---

## F119 — outbound webhook delivery lacks durable event/delivery identity and durable delivery evidence

**Status:** VERIFIED CODE-LEVEL / EXTERNAL-INTEGRATION FINDING

WebhookDispatcher signs and retries outbound events, but the inspected external contract contains event/timestamp/business/data without a stable KeyFlow event occurrence ID or receiver-visible unique delivery ID.

Its delivery log is process memory, so restart loses recovery/history evidence.

A repeated internal event invocation generates a newly timestamped outbound delivery that an external receiver cannot reliably identify as a replay of the same KeyFlow occurrence.

Proven-model properties:

- CloudEvents uses stable `source + id` occurrence identity;
- GitHub webhooks expose globally unique `X-GitHub-Delivery` delivery identity in addition to event name and signature.

Target distinction:

```text
AUTHENTICITY
!= EVENT IDENTITY
!= DELIVERY IDENTITY
!= ATTEMPT IDENTITY
```

Affected kernels: K7, K8, K9, K11.
Affected journeys: J13, J14, J18.

---

## F120 — one overdue fact has multiple independent business-consequence owners without a shared consequence graph

**Status:** VERIFIED ARCHITECTURAL / CROSS-JOURNEY FINDING

One canonical `invoice.overdue` occurrence can fan out into:

- FlowListener automatic customer overdue email;
- AutomationExecutor built-in collection task + contact tag;
- configured playbooks;
- configured AutomationFlows;
- hard-coded JourneyOrchestrator;
- optional AgentTrigger plan;
- independently scheduled DelegationLoop payment recovery;
- outbound business webhook;
- optional KeyCortexTriggerRule goal/plan;
- observation/read-model consumers.

Many branches are legitimately distinct and some are intentionally configurable. The architectural defect is absence of one causal/business-consequence graph proving owner, precedence/coexistence, cadence, authority and replay identity for every material branch.

Target:

```text
InvoiceOverdue EventOccurrence
├─ projections / audit / analytics
├─ external event subscriptions
└─ BusinessConsequencePolicy
   ├─ collection-work intent
   ├─ customer-reminder cadence
   ├─ configured automation flows
   └─ KEY plan/recommendation policy
```

The target is not one listener. It is one coherent owner per business consequence.

Affected kernels: K3, K5, K6, K7, K8, K9, K10, K11.
Affected journeys: J3, J5, J6, J7, J13, J14, J15, J18, J23.

---

# Pool law

```text
Canonical StateOccurrence
→ EventOccurrenceId
→ legitimate fan-out
→ explicit ConsequenceIntent(s)
→ coexistence / precedence / cadence
→ authority
→ ConsumptionClaim / ExecutionClaim
→ effect
→ OutcomeEvidence
```

No production implementation is authorized by this supplement.
