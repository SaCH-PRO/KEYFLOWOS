# KeyFlowOS Finding Register — External Outcome Supplement

Status: CANONICAL CONTINUATION OF `08I-FINDING-REGISTER-WORKFLOW-VERSIONING-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F147.

---

## F148 — WhatsApp provider/API acceptance is persisted as coarse SENT without observed delivery/read reconciliation

**Status:** VERIFIED CODE-LEVEL + SEARCH-SCOPED RECONCILIATION FINDING

Current WhatsApp send paths treat provider HTTP/API success as local message success:

```text
Twilio/Meta API returns successful HTTP response
→ result.success=true
→ WhatsAppMessage.status='SENT'
→ sentAt=now
→ provider message id stored in wamid when returned
```

The Prisma model's documented local status vocabulary is:

```text
RECEIVED | SENT | SCHEDULED | SENDING | FAILED
```

Current Twilio primary documentation distinguishes initial accepted/queued state, sending, sent, delivered, undelivered and WhatsApp read states. Status callbacks provide later lifecycle evidence.

The inspected baseline WhatsApp webhook parser handles inbound message payloads; repository search did not find a consumer that binds outbound status callbacks to `WhatsAppMessage.wamid` and advances delivery/undelivered/read truth.

Therefore KeyFlow can currently prove a successful provider API call/provider message creation but cannot distinguish stronger outbound delivery lifecycle states in this path.

This is not a claim that delivery failed. It is an evidence-strength finding:

```text
PROVIDER/API ACCEPTANCE
!= DELIVERY CONFIRMATION
```

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J14, J18, J23.

---

## F149 — outbound WhatsApp provider rejection and ambiguous transport failure collapse into the same terminal FAILED state

**Status:** VERIFIED ARCHITECTURAL / DISTRIBUTED-OUTCOME FINDING

`dispatchToProvider()` returns `success=false` for both provider-declared unsuccessful responses and caught request exceptions. `deliverRow()` maps either class to:

```text
WhatsAppMessage.status='FAILED'
```

These classes have different external-reality meaning:

- a definitive provider rejection can support confirmed failure;
- a timeout/disconnect/response-loss after request initiation may leave provider acceptance/effect existence uncertain.

No distinct `OUTCOME_UNKNOWN` state or ambiguity classification was observed on the inspected path.

Target law:

> When external effect existence cannot be safely disproven, preserve uncertainty and reconcile before unsafe retry or contradictory business claims.

This strengthens KF-REC-037 provider lifecycle reconciliation and J23's `AWAITING_EXTERNAL / OUTCOME_UNKNOWN` semantics rather than creating a parallel reconciliation system.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J18, J23.

---

# Strong existing seam

`DeliveryQueueService` is a stronger generic outbound seam than direct channel sends:

```text
Queued/Scheduled/RetryPending
→ atomic claim to Sending
→ adapter.publish
→ attempt DeliveryEvent
→ Published | RetryPending | Failed
```

It stores provider external IDs/result snapshots and should be evaluated as a convergence point for external-effect evidence. Current generic adapter success still does not itself prove channel-specific final delivery/settlement; do not replace this seam merely because its outcome vocabulary needs strengthening.

---

# Pool law

```text
REQUEST SUCCESS
!= PROVIDER ACCEPTANCE
!= SENT/PUBLISHED
!= DELIVERED/SETTLED
!= FINAL BUSINESS OUTCOME

LOCAL ERROR
!= PROOF EXTERNAL EFFECT DID NOT OCCUR
```

No production implementation is authorized by this supplement.
