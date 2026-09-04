# J23 — External Outcome Uncertainty / Provider Reconciliation

Status: VERIFIED FORENSIC PASS / TARGET CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary kernels: K9 Integration/External Reality, K11 Recovery/Reliability
Secondary kernels: K7 Temporal/Event/Workflow, K8 Evidence/Outcome
Primary journeys: J23 Temporal Flow / Long-Running Workflow, J18 Failure / Recovery
Adjacent journeys: J5 Conversation / Business Action, J9 Marketing, J14 External Event Ingress

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

What durable state should KeyFlowOS hold after it initiates an external effect but before external reality is authoritatively known?

Required distinction:

```text
REQUEST ATTEMPTED
!= PROVIDER ACCEPTED
!= PROVIDER SENT/PUBLISHED
!= RECIPIENT DELIVERED
!= BUSINESS OUTCOME CONFIRMED
```

And when a network/process failure occurs:

```text
LOCAL ERROR
!= PROOF EXTERNAL EFFECT DID NOT HAPPEN
```

---

## 2. WhatsApp Current Reality

### Scheduling / claim

The scheduled-message path has a strong local concurrency seam:

```text
WhatsAppMessage SCHEDULED
→ expected-state updateMany
→ SENDING
```

Only the claimant continues.

### Provider dispatch

Twilio path:

```text
POST Messages API
→ if non-2xx: success=false
→ if 2xx: parse SID
→ success=true
```

Meta path:

```text
POST Cloud API /messages
→ if non-2xx: success=false
→ if 2xx: parse messages[0].id
→ success=true
```

`deliverRow()` maps the boolean result directly:

```text
success=true  → WhatsAppMessage.status=SENT, sentAt=now, wamid=<provider id>
success=false → WhatsAppMessage.status=FAILED
```

Schema comment exposes the local vocabulary:

```text
RECEIVED | SENT | SCHEDULED | SENDING | FAILED
```

No DELIVERED / UNDELIVERED / READ / OUTCOME_UNKNOWN state is present on this model.

---

## 3. Provider Acceptance Is Not Final Delivery

Current Twilio primary documentation distinguishes outbound message lifecycle states including:

```text
queued
sending
sent
failed
delivered
undelivered
accepted/scheduled where applicable
read for supporting channels such as WhatsApp
```

For a direct Message create request without Messaging Service, initial successful creation is `queued`; with a Messaging Service it can initially be `accepted` or `scheduled`.

Twilio sends later status callbacks as state changes, including delivery/undelivered and WhatsApp read events.

Current KeyFlow Twilio send code ignores the response `status` field and treats HTTP success as local `SENT`.

Current baseline WhatsApp webhook shape/parser is oriented to inbound `messages[]`; no consumer was observed that binds provider status callbacks to the stored outbound `wamid` and advances the local delivery lifecycle.

Therefore the durable row currently terminalizes provider/API acceptance into a coarse `SENT` state without an observed later delivery-reconciliation loop.

This is F148.

This does **not** mean the provider did not send the message. It means KeyFlow's local state cannot distinguish provider acceptance/sent/delivered/read/undelivered from the inspected path.

---

## 4. Ambiguous Transport Failure Is Collapsed Into Definite FAILED

`dispatchToProvider()` catches exceptions around the provider request and returns:

```text
{ success: false, error }
```

`deliverRow()` then writes `FAILED`.

The same binary failure result is also used for provider-declared HTTP rejection.

Those failure classes are not equivalent:

```text
HTTP/provider rejection before acceptance
→ strong evidence effect was not accepted

network timeout / connection loss / response loss
→ depending on timing, provider may or may not have accepted the request
```

The current API does not expose a distinct ambiguity classification, provider request/operation identity when the response is unavailable, or `OUTCOME_UNKNOWN` state.

Thus external effect uncertainty is collapsed into terminal local failure.

This is F149.

Target implication: retry policy for an ambiguous external effect must not blindly assume no prior effect occurred. Reconcile by provider operation/idempotency identity or authoritative status where available.

---

## 5. OutboundDelivery — Stronger Existing Seam, Same External-Truth Boundary

`DeliveryQueueService` is a favorable existing execution seam:

```text
Queued/Scheduled/RetryPending
→ atomic status claim
→ Sending
→ adapter.publish()
→ DeliveryEvent attempt evidence
→ Published | RetryPending | Failed
```

It preserves:

- per-delivery durable identity;
- provider external IDs/URLs where adapters return them;
- attempt number;
- retry state;
- result/error snapshots;
- content aggregation.

This is substantially stronger than ad-hoc direct sends.

However current generic success handling is:

```text
adapter result.success
→ OutboundDelivery.status=Published
→ delivery.completed
```

No baseline consumer was found in this pass that later advances an already-`Published` OutboundDelivery from provider delivery/undelivered/bounce/read lifecycle evidence.

Because social publication and message/email delivery have different external semantics, the target should not force one universal `DELIVERED` meaning onto every channel. Instead, adapters should expose channel-appropriate external-outcome stages normalized into K8/K9 evidence.

This strengthens the conclusion that `OutboundDelivery` is a promising existing seam to evolve rather than replace.

---

## 6. Target External-Effect Lifecycle

Conceptual lifecycle:

```text
ExecutionClaim
→ PROVIDER_REQUESTING
→ PROVIDER_ACCEPTED          [when proven]
→ AWAITING_EXTERNAL          [where later outcome matters]
   ├─ SUCCEEDED_CONFIRMED / DELIVERED / SETTLED
   ├─ FAILED_CONFIRMED / UNDELIVERED / REJECTED
   ├─ READ / ACKNOWLEDGED     [channel-specific optional evidence]
   └─ OUTCOME_UNKNOWN
→ reconciliation / correction
→ durable OutcomeEvidence
```

Not every effect needs every stage.

Examples:

```text
social API create that returns final published post ID
  may legitimately terminalize at PUBLISHED if provider contract says creation is the business effect

message send API
  may need ACCEPTED/SENT plus later DELIVERED/UNDELIVERED when delivery truth matters

payment/refund
  may need provider accepted/pending then settled/reversed/failed
```

The CapabilityContract / provider adapter should define what constitutes sufficient terminal evidence for that effect.

---

## 7. OUTCOME_UNKNOWN

`OUTCOME_UNKNOWN` is required when the system cannot safely prove either success or failure.

It is not a generic error bucket.

Typical entry:

```text
ExecutionClaim owns exact effect
→ provider request initiated
→ local process receives ambiguous timeout/disconnect/crash
→ effect existence cannot be disproven
→ OUTCOME_UNKNOWN
→ reconcile by provider idempotency key / operation lookup / webhook / status API
→ resolve to confirmed success or confirmed failure
```

Unsafe behavior to avoid:

```text
ambiguous failure
→ mark FAILED
→ retry as fresh unrelated effect
→ duplicate external consequence
```

---

## 8. Reference Properties

### Twilio

Primary documentation distinguishes initial provider acceptance/queueing from later `sent`, `delivered`, `undelivered`, and WhatsApp `read` states, and supports StatusCallback updates / fetching the Message resource by SID.

References:

- https://www.twilio.com/docs/messaging/api/message-resource
- https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks

Adopted properties:

- provider operation identity survives after request;
- provider acceptance is distinct from delivery;
- later provider lifecycle evidence should reconcile local truth;
- channel-specific terminal evidence is legitimate.

### Existing KF-REC-037

This pass **strengthens**, rather than replaces, KF-REC-037:

> Treat provider lifecycle reconciliation as a first-class external-truth loop.

J23 adds the temporal states `AWAITING_EXTERNAL` and `OUTCOME_UNKNOWN` between execution and OutcomeEvidence.

---

## 9. Findings / Contradictions

New findings:

- F148 — WhatsApp HTTP/API acceptance is persisted as coarse `SENT` with no observed outbound delivery/read reconciliation consumer at the baseline.
- F149 — provider rejection and ambiguous transport failure collapse into the same terminal `FAILED` state; no `OUTCOME_UNKNOWN` classification is observed.

New contradictions:

- C098 — provider-accepted/queued request vs local terminal `SENT` delivery semantics.
- C099 — ambiguous external effect existence vs definite local `FAILED` semantics.

No new recommendation ID is required. Reuse/strengthen:

- KF-REC-037 provider lifecycle reconciliation;
- KF-REC-040 logical state vs attempt state;
- KF-REC-044 causal/effect identity across durable handoffs.

---

## 10. Proof Requirements

- provider/API acceptance cannot be mistaken for stronger delivery evidence where the capability requires delivery truth;
- later provider status updates reconcile the same effect identity, not create new unrelated work;
- a provider-declared rejection becomes confirmed failure;
- a transport timeout after request initiation can enter OUTCOME_UNKNOWN;
- OUTCOME_UNKNOWN cannot be blindly retried as a fresh effect;
- authoritative provider lookup/callback can resolve OUTCOME_UNKNOWN;
- retry preserves the same effect/idempotency identity when provider semantics support it;
- operator can distinguish sending, provider-accepted, delivered/settled, failed-confirmed and outcome-unknown without requiring channel-specific jargon in normal UX;
- current strong CAS/attempt-event seams remain intact.

No runtime tests were executed in this forensic pass.
