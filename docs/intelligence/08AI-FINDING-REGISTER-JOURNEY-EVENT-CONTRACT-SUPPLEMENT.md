# KeyFlowOS Finding Register — Journey Event Contract Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J4 Booking → Service → Payment; J3 customer lifecycle consequence
Implementation baseline: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

## F204 — Runtime post-booking journey consumes a payload/tool contract incompatible with the canonical `booking.completed` event

Classification: CURRENT IMPLEMENTATION DEFECT / CROSS-MODULE EVENT-TO-ACTION CONTRACT
Primary journey: J4
Secondary impact: J3
Primary kernels: K6 State Transition, K7 Temporal/Event/Workflow, K8 Evidence/Outcome, K11 Recovery, K3 Governance

### Reachability is live

`BookingsService.updateBookingStatus(..., COMPLETED)` emits:

```text
booking.completed
payload = {
  booking: updated Booking,
  contact: updated.contact,
  businessId
}
```

The canonical `BookingCompletedPayload` type confirms that shape:

```text
booking: Booking
contact?: Partial<Contact>
businessId: string
```

`AgentTriggerService` installs an `EventEmitter2.onAny` handler for every non-`plan.*` event and calls `JourneyOrchestratorService.handleEvent(eventName, payload)`.

`JOURNEY_TEMPLATES` defines a live `post-booking` journey triggered by `booking.completed`.

`JourneyOrchestratorService` creates an AiPlan/AiPlanStep chain and auto-approves the plan when the highest tool tier is <=2. Its first step is `commerce_create_invoice`, which is registered at risk tier 2.

`plan.approved` is consumed by `PlanExecutorService`, which enqueues the first step to BullMQ. `QueueService` consumes the step and routes it through `ActionDispatcherService` → `FlowOrchestratorService.executeToolDirectly()`.

Therefore this is not dormant template text; it is a mounted runtime path.

### Payload contract mismatch

The `post-booking` template expects flat properties that the emitted event does not provide:

```text
payload.contactId
payload.serviceName
payload.amount
payload.bookingId
payload.contactName
```

The actual event provides those values, where available, nested under `payload.booking` / `payload.contact`.

The first step maps:

```text
contactId = payload.contactId              → undefined
items[0].description = payload.serviceName ?? 'Service'
items[0].amount = payload.amount ?? 0
```

But `FlowOrchestratorService`'s `commerce_create_invoice` tool ignores `item.amount` and maps only:

```text
item.description
item.quantity
item.unitPrice
```

so `quantity` and `unitPrice` are undefined.

`CommerceService.createInvoice()` calculates subtotal by multiplying `item.quantity * item.unitPrice` before persistence. The journey therefore does not provide the contract needed to create the intended booking invoice.

### Consequence chain

The first journey step is a dependency for later steps. The same template intends to:

- set `Contact.status = CLIENT`;
- create a delayed follow-up task;
- request a review under condition.

Because the first invoice step is malformed, the intended post-booking customer-lifecycle/follow-up chain can fail before those descendants become eligible.

This strengthens F197: the apparent automated `CLIENT` promotion in `journey-templates.ts` is not evidence of a working customer-lifecycle convergence path.

### Important narrowing of candidate duplicate-invoice hypothesis

There are indeed two invoice-generation intentions triggered by booking completion:

```text
BookingsService.autoGenerateInvoiceForCompletedBooking()
+
post-booking journey → commerce_create_invoice
```

However current evidence does **not** prove two valid invoices are created. The AI path is contract-incompatible before a valid invoice effect is established. Do not record a duplicate-invoice finding unless later runtime/source evidence proves a valid second receivable can be produced.

### Idempotency note

The AI plan step uses idempotency identity:

```text
plan:<planId>:step:<stepId>
```

This protects replay of that plan step, not semantic uniqueness of `booking → required invoice`. If the payload contract is repaired later, commercial-obligation idempotency must still be solved rather than relying on plan identity.

### Target pressure

Event-driven journey templates need compile/testable typed adapters from canonical event payloads into canonical tool inputs:

```text
canonical domain event
→ versioned event contract
→ explicit adapter / mapping
→ validated tool input
→ semantic effect identity
→ governed execution
→ outcome evidence
```

A template's apparent intent is not a load-bearing lifecycle contract until event and tool schemas compose mechanically.

No production implementation is authorized by this supplement.
