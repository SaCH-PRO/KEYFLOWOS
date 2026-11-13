# KeyFlowOS Contradiction Register — Journey Event Contract Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J4 Booking → Service → Payment

## C154 — Canonical `booking.completed` payload vs post-booking journey/tool input contract

```text
BookingCompletedPayload {
  booking,
  contact?,
  businessId
}

!=

post-booking template expecting {
  contactId,
  serviceName,
  amount,
  bookingId,
  contactName
}

!=

commerce_create_invoice item contract requiring {
  description,
  quantity,
  unitPrice
}
```

The path is runtime-reachable through AgentTriggerService → JourneyOrchestrator → plan.approved → PlanExecutor → BullMQ → ActionDispatcher → FlowOrchestrator, but the contracts do not compose.

The first malformed invoice step can prevent later intended `Contact.status = CLIENT` and follow-up steps from running. This is why the apparent post-booking automation does not falsify F197.

The separate hypothesis that this path creates a second valid booking invoice is **not proven** and is intentionally not canonized.

Finding: F204.

No production implementation is authorized by this supplement.
