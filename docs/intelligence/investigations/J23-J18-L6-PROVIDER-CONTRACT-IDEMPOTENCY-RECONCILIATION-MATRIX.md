# J23 + J18 — Provider Contract / Idempotency / Reconciliation Matrix

Status: ACTIVE L6 PROVIDER-CONTRACT CONVERGENCE / PRIMARY-DOC RESEARCH
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Research refresh: 2026-09-04
Primary journeys: J23 Temporal Flow, J18 Failure/Recovery, J14 External Ingress
Primary kernels: K9 External Reality, K11 Recovery, K8 Evidence, K10 Financial Truth

> Adopt provider properties, not provider products. Where primary documentation was not surfaced/verified in this pass, the capability is explicitly marked UNCONFIRMED rather than inferred from memory. No production implementation is authorized.

---

## 1. Provider-contract questions

For each external effect KeyFlow needs to know:

```text
Can we bind a stable client EffectId to the provider request?
What provider operation ID comes back?
What does synchronous success actually prove?
Can we retrieve authoritative state later?
Which lifecycle callbacks/webhooks exist?
What is the point of no return?
When is retry safe?
Can the completed effect be cancelled/reversed/deleted?
How long does provider-side idempotency persist?
What correlation survives a crash after provider success?
```

---

## 2. Summary matrix

| Provider / effect | Client idempotency | Provider operation identity | Lifecycle / lookup | Safe retry rule | Reversal/cancel | Current KeyFlow gap | Target property |
|---|---|---|---|---|---|---|---|
| Stripe POST operations incl refunds | YES — `Idempotency-Key`, all POSTs; keys may be pruned after >=24h | Stripe object/refund/payment IDs | Refund events; API object retrieval | reuse SAME key + same parameters after connection uncertainty | refund completed payments; cancel pre-success PaymentIntent; deactivate Payment Link | current raw `stripeRequest()` does not send idempotency key | RecoveryEffectId → Stripe Idempotency-Key; retain Stripe object ID; webhook/lookup reconciliation |
| PayPal capture/refund POSTs where endpoint supports header | YES — `PayPal-Request-Id`; refund example up to 45 days | order/capture/refund IDs | REST resource lookup + webhooks | retry same request ID after network timeout/500 while provider retains it | refund captured payment; other cancellation varies by resource | current refund/direct capture paths do not send request ID; F158 lineage loss | bind EffectId/RecoveryEffectId to PayPal request ID + preserve order/capture/refund lineage |
| Twilio SMS/WhatsApp Message create | no general client idempotency mechanism confirmed in reviewed Messaging docs | Message SID | StatusCallback + GET Message by SID; queued/sent/delivered/undelivered/read where supported | after SID known, reconcile by SID; if create result ambiguous before SID, do not assume safe replay | scheduled messages can be canceled before SendAt | current WhatsApp path stores SID as coarse SENT, does not configure/use callback lifecycle in inspected path | SID is ProviderOperationId; reconcile lifecycle; OUTCOME_UNKNOWN when create outcome ambiguous |
| Meta WhatsApp Cloud direct send | primary lifecycle docs not surfaced in this web pass; current API response gives message ID in KeyFlow path | returned WhatsApp message ID (`messages[0].id`) in current implementation | provider webhook lifecycle expected by architecture history but CURRENT PRIMARY DOC VERIFICATION PENDING | do not freeze retry policy until primary contract verified; current transport ambiguity = OUTCOME_UNKNOWN | provider-specific; not verified in this pass | direct send persists coarse SENT/FAILED; no observed status reconciliation | keep message ID; add verified lifecycle adapter after primary contract evidence; no blind retry |
| Google Calendar event insert | provider allows client-specified event `id`; duplicate ID returns 409; docs explicitly say this can prevent duplicate creation after backend success | Calendar event ID | GET/update/watch; DELETE by event ID | deterministic/client event ID + GET/update after ambiguous create; don't create another ID | DELETE event supported | current event creation/recovery should be checked for deterministic client ID use | stable EffectId-derived Calendar event ID where valid; 409/get = reconciliation, not duplicate creation |
| Gmail `users.messages.send` | no client idempotency header confirmed in reviewed official send/reference docs | response returns Gmail Message object/id on success | mailbox GET/list by message ID after known response; no delivery lifecycle in Gmail send API equivalent to ESP DLR confirmed here | if send response ID known, preserve it; timeout before response remains ambiguous unless separate message correlation/reconciliation is proven | deleting sender mailbox message is NOT recipient unsend | current EmailAdapter classifies timeout/5xx as transient and may retry without provider idempotency | treat ambiguous send as OUTCOME_UNKNOWN unless stronger sent-mail correlation is implemented; Message ID is evidence after success |
| Resend email send | YES — `Idempotency-Key`, POST /emails and /emails/batch, 24h | Resend email ID | webhooks: sent, delivered, bounced, delayed, failed, etc.; webhook event `svix-id` is at-least-once dedupe key | same idempotency key within 24h; same payload required | scheduled email cancellation exists; sent email no generic unsend | current SystemEmailService does not pass idempotency key; adapter uses generic transient retry | OutboundDelivery EffectId → Resend key; persist email ID; consume signed/idempotent lifecycle events |
| WiPay Payments API | payment-request client idempotency token not confirmed in current Payments API docs reviewed; stable `transaction_id` returned/used | transaction_id | signed server-to-server lifecycle webhooks incl payment.error, success, refunds, chargebacks, fraud; stable webhook id across retries | browser redirect is immediate result only; webhook event is long-lived lifecycle truth; ambiguous error requires reconciliation | current WAPI docs expose refund request; Payments lifecycle includes refund requested/refunded/rejected | current KeyFlow callback-centric path omits provider webhook lifecycle and generic refund support | transaction_id + signed webhook occurrence ID + pass-through local lineage; lifecycle event drives K10 reconciliation |
| Social publishers (Facebook/Instagram/LinkedIn/X/TikTok) | provider-specific; not normalized/verified in this pass | current KeyFlow `publishResults` provider IDs where returned | provider-specific | per destination; generic retry unsafe after ambiguous publish | provider-specific delete/unpublish; current KeyFlow does none | local SocialPost delete only; F160 | one provider artifact/effect per destination; reversal capability/outcome per destination; no generic “deleted” claim |

---

# 3. Stripe

## 3.1 Primary provider properties

Stripe's API reference states:

- idempotency keys are designed for safely retrying requests without performing the same operation twice;
- all POST requests accept idempotency keys;
- the first status code/body is retained for a key, including `500` responses;
- keys may be removed after they are at least 24 hours old;
- reusing a retained key with different parameters errors;
- execution results are stored only after endpoint execution begins.

Primary reference:

`https://docs.stripe.com/api/idempotent_requests`

## 3.2 Refund lifecycle

Stripe documents refund lifecycle events including:

```text
refund.created
refund.updated
refund.failed
charge.refunded
```

and recommends listening at minimum for `refund.created`.

Primary reference:

`https://docs.stripe.com/refunds`

## 3.3 Cancellation / reversal

- a succeeded PaymentIntent cannot simply be canceled; money must be refunded where appropriate;
- active Payment Links can be deactivated with `active=false`;
- Payment Link metadata propagates to checkout sessions.

References:

- `https://docs.stripe.com/refunds`
- `https://docs.stripe.com/api/payment-link`

## 3.4 Current KeyFlow delta

Current `StripeConnector.stripeRequest()` performs raw fetches and does not expose/send an `Idempotency-Key`, including `POST /refunds`.

Current target:

```text
KeyFlow EffectId / RecoveryEffectId
→ Stripe Idempotency-Key
→ same parameters across safe retry
→ Stripe object/refund ID
→ webhook/status evidence
→ K10 consequence convergence
```

Provider retention is only a bounded replay window; KeyFlow retains its own durable effect identity beyond it.

---

# 4. PayPal

## 4.1 Primary provider properties

PayPal documents `PayPal-Request-Id` as an optional idempotency header for supporting REST POST operations.

It explicitly says:

- use a unique user-generated ID;
- repeated calls with the same ID do not create/complete the action more than once;
- retry calls that fail with network timeout or HTTP 500;
- the refund example can be retried with the same request ID for up to 45 days.

Primary reference:

`https://developer.paypal.com/api/rest/requests/`

## 4.2 Current KeyFlow delta

Current `PayPalConnector.refundCharge()` calls the refund endpoint without `PayPal-Request-Id`.

Current direct `capturePaypalOrder()` uses the PayPal SDK capture call without an observed deterministic request-ID parameter in the inspected call.

F158 shows why this matters: capture can succeed, local persistence can fail, and local fallback evidence can lose provider order/capture lineage.

Target:

```text
EffectId
→ PayPal-Request-Id when supported by operation
→ OrderId / CaptureId / RefundId
→ provider lookup/webhook
→ local consequence repair
```

---

# 5. Twilio SMS / WhatsApp

## 5.1 Provider lifecycle

Twilio's current Programmable Messaging docs establish:

- Message create response provides the initial resource status;
- a Message is identified by a stable `MessageSid`;
- status callbacks are sent after initial creation as status changes;
- common transitions include `queued`, `sent`/`failed`, `delivered`/`undelivered`;
- WhatsApp supports read receipts (`read` / `EventType=READ`);
- scheduled messages can be canceled before `SendAt`;
- status can also be polled by Message SID.

Primary references:

- `https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks`
- `https://www.twilio.com/docs/messaging/guides/track-outbound-message-status`
- `https://www.twilio.com/docs/usage/webhooks/messaging-webhooks`
- `https://www.twilio.com/docs/messaging/guides/outbound-message-logging`

Twilio recommends persistent message records and polling by SID if terminal delivery status is missing for an extended period.

## 5.2 Idempotency classification

No general client request-idempotency header for Message creation was confirmed in the official Messaging pages reviewed in this pass.

Therefore do NOT claim retries of an ambiguous Message-create request are provider-deduplicated.

Target rule:

```text
Message SID known
→ provider operation exists
→ reconcile by callback/GET

request timeout before SID and external creation uncertain
→ OUTCOME_UNKNOWN
→ no blind duplicate send
```

## 5.3 Current KeyFlow delta

`WhatsAppService.sendViaTwilio()`:

- POSTs to Twilio Messages;
- receives SID;
- returns `success=true`;
- `deliverRow()` persists local `SENT` + `wamid=SID`.

The inspected request does not supply `StatusCallback`, and no direct WhatsApp status reconciliation consumer was found in the relevant pass.

So KeyFlow currently converts provider resource creation/acceptance into coarse `SENT`, leaving Twilio's delivery/read/undelivered lifecycle unused.

This strengthens F148/F149/KF-REC-037 rather than creating another root.

---

# 6. Meta WhatsApp Cloud direct send

## 6.1 Current KeyFlow evidence

Current `WhatsAppService.sendViaMeta()`:

```text
POST graph.facebook.com/<phoneNumberId>/messages
→ successful HTTP response
→ messages[0].id captured
→ local row SENT + wamid
```

Transport errors and provider-declared errors both feed the current coarse failure path identified in F149.

## 6.2 Provider-primary verification status

Direct current Meta developer documentation for the status webhook lifecycle did not surface reliably in the web search available in this research pass.

Therefore this artifact deliberately does **not** freeze detailed Meta lifecycle states from memory.

Accepted target remains provider-neutral:

```text
returned provider message ID
→ provider operation identity
→ AWAITING_EXTERNAL where later lifecycle evidence is material
→ verified provider webhook/status evidence
→ terminal outcome
```

Before an implementation packet for direct Meta WhatsApp, obtain current primary Meta docs for:

- message status webhook payloads;
- terminal/nonterminal statuses;
- provider retry/idempotency semantics;
- message lookup/reconciliation capabilities;
- status event ordering/replay semantics.

---

# 7. Google Calendar

## 7.1 Client-supplied provider identity

Google Calendar's current docs explicitly allow callers to specify an Event `id` at creation time.

Google states this can keep local entities synchronized and can prevent duplicate event creation if the operation failed after succeeding in the Calendar backend.

A duplicate supplied identifier can yield HTTP 409; provider guidance says use update rather than creating a new instance if it is the same resource.

Primary references:

- `https://developers.google.com/workspace/calendar/api/guides/create-events`
- `https://developers.google.com/workspace/calendar/api/v3/reference/events/insert`
- `https://developers.google.com/workspace/calendar/api/guides/errors`

This is a strong provider-native effect identity pattern even though it is not an HTTP idempotency-key header.

Target:

```text
KeyFlow EffectId
→ deterministic Calendar Event ID satisfying provider format
→ insert
→ timeout/409 → GET same Event ID / reconcile
```

## 7.2 Reversal

Google Calendar provides:

```text
DELETE /calendars/{calendarId}/events/{eventId}
```

Primary reference:

`https://developers.google.com/workspace/calendar/api/v3/reference/events/delete`

Current KeyFlow already contains provider-native Calendar delete machinery. Recovery should use it when the original effect was external, not merely flip a local row.

---

# 8. Gmail send

## 8.1 Provider contract verified

Official Gmail docs show:

```text
POST /gmail/v1/users/{userId}/messages/send
→ response body = Message
```

The returned Message contains the Gmail message ID on success.

Primary references:

- `https://developers.google.com/workspace/gmail/api/guides/sending`
- `https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send`

## 8.2 Idempotency/reconciliation classification

The reviewed official Gmail send/reference docs did **not** document a client idempotency key for `messages.send`.

Do not infer one.

A known successful response yields a Gmail Message ID that should be preserved as provider operation evidence.

But a transport timeout before a response is inherently weaker: deleting/trashing a sent message from the sender mailbox is not a recipient unsend, and the standard Gmail send API is not a delivery-status provider like Twilio/Resend.

Current target:

```text
Gmail Message ID known
→ provider send operation known

ambiguous create/send timeout without Message ID
→ OUTCOME_UNKNOWN unless a separately proven sent-mail correlation strategy establishes truth
```

## 8.3 Current KeyFlow delta

Current `EmailAdapter` POSTs raw MIME to Gmail and returns `result.id` on success.

It classifies 5xx/429/network-like failures as transient, which generic OutboundDelivery may retry.

Without a provider idempotency mechanism or proven reconciliation key, blind retry after an ambiguous network error is unsafe.

This strengthens F149.

---

# 9. Resend email

## 9.1 Provider idempotency

Resend currently supports `Idempotency-Key` on:

```text
POST /emails
POST /emails/batch
```

Properties documented:

- optional;
- safe same-request retry;
- keys retained for 24 hours;
- changed payload under same key produces conflict;
- successful repeat returns the same response/email ID.

Primary references:

- `https://resend.com/docs/dashboard/emails/idempotency-keys`
- `https://resend.com/docs/api-reference/emails/send-email`

## 9.2 Provider lifecycle

Resend exposes webhook event types including:

```text
email.sent
email.delivered
email.delivery_delayed
email.failed
email.bounced
email.opened
email.clicked
email.complained
```

`email.sent` means the API request was successful and Resend will attempt delivery; `email.delivered` means delivered to the recipient mail server.

Webhooks are at-least-once; Resend documents a unique `svix-id` for event dedupe, retry behavior, and out-of-order delivery possibility.

References:

- `https://resend.com/docs/webhooks/event-types`
- `https://resend.com/docs/webhooks/introduction`
- `https://resend.com/docs/webhooks/emails/delivered`

## 9.3 Current KeyFlow delta

Current `SystemEmailService.sendTransactional()` calls:

```text
client.emails.send(payload)
```

without passing Resend's idempotency-key options.

`ResendEmailAdapter` therefore obtains the email ID on success but generic transient failure can cause OutboundDelivery retries without provider-side dedupe.

Target:

```text
OutboundDelivery EffectId
→ Resend Idempotency-Key
→ Resend email ID
→ signed/deduped webhook lifecycle
→ delivery/bounce evidence
```

This is a high-value existing-provider seam and does not require a new email runtime.

---

# 10. WiPay

## 10.1 Current provider lifecycle docs

WiPay's current Payments API documentation now distinguishes:

```text
browser response_url redirect = immediate checkout result
server-to-server webhook event = long-lived payment lifecycle signal
```

Current payment events include:

```text
payment.created
payment.success
payment.failed
payment.error
payment.refund_requested
payment.refunded
payment.refund_rejected
payment.chargeback_pending
payment.chargeback_processed
payment.chargeback_released
payment.fraud_confirmed
```

Importantly:

`payment.error` is defined as an error before a definitive outcome, including gateway timeout-like cases. This directly supports KeyFlow's `OUTCOME_UNKNOWN`/reconciliation distinction rather than collapsing all errors into failed.

Primary references:

- `https://docs.wipayfinancial.com/webhooks`
- `https://docs.wipayfinancial.com/webhooks/payments-api`

## 10.2 Webhook reliability / identity

WiPay currently documents:

- signed HMAC webhook requests;
- stable envelope `id` / `X-WiPay-Webhook-Id` across redelivery attempts;
- non-2xx/timeout retry with backoff;
- handlers should acknowledge after durable acceptance;
- event ID should be treated as idempotency key;
- timestamp replay protection.

This is materially stronger than KeyFlow's current callback-centric WiPay integration.

## 10.3 Correlation

WiPay documents:

- stable merchant-facing `transaction_id`;
- optional pass-through `data` echoed in transaction response and webhook payloads;
- recommendation to store transaction_id for reconciliation/support.

References:

- `https://docs.wipayfinancial.com/hosted-checkout-flows`
- `https://docs.wipayfinancial.com/pass-through-data`

Target pattern:

```text
KeyFlow financial EffectId / invoice/order ID
→ pass-through data
→ transaction_id
→ signed webhook event id
→ K10 consequence convergence
```

## 10.4 Reversal

Current WiPay WAPI docs expose a refund-request operation for successful normal transactions:

`POST /transactions/{transaction_id}/refund`

and Payments API lifecycle docs include refund requested/refunded/rejected outcomes.

Primary reference:

`https://docs.wipayfinancial.com/wapi/transactions/createRefundRequest`

Current KeyFlow `PaymentsOpsService` still classifies WiPay refunds as unsupported in its generic provider interface, so the architectural gap is now:

> provider capability exists, but KeyFlow's current connector/operations abstraction does not expose/reconcile it.

This strengthens K10/K9 migration requirements; do not claim the provider lacks refund capability.

---

# 11. Social provider publishing

Current KeyFlow publishers:

```text
Facebook
Instagram
LinkedIn
Twitter/X
TikTok
```

The current SocialPublishingService retains per-provider `PublishResult`, but the generic product/service layer has no provider delete/unpublish path (F160).

Provider delete/idempotency/reconciliation contracts were not exhaustively verified across all five providers in this tranche.

Therefore the L6 target must remain provider-specific:

```text
ProviderPublicationCapability
  publish
  lookup/status
  delete/unpublish
  idempotency/retry
  provider operation identity
```

Do not create a generic provider-delete promise until each material provider contract is mapped.

For migration, existing `publishResults` are evidence inputs; top-level SocialPost `POSTED/deletedAt` are not enough.

---

# 12. Cross-provider adopted properties

## P1 — Durable local EffectId outlives provider idempotency retention

Provider-side dedupe windows vary:

```text
Stripe: >=24h before keys may be pruned
Resend: 24h
PayPal: operation-specific; refund example up to 45 days
Calendar event ID: resource identity rather than short request-key window
Twilio/Gmail: no equivalent create-request key confirmed in reviewed docs
```

Therefore KeyFlow cannot outsource durable effect identity to providers.

## P2 — Stable provider operation ID is part of OutcomeEvidence

Examples:

```text
Stripe refund/payment ID
PayPal capture/refund/order ID
Twilio Message SID
Meta WhatsApp message ID
Google Calendar Event ID
Gmail Message ID
Resend email ID
WiPay transaction_id
social provider post ID
```

## P3 — API success has provider-specific meaning

```text
Twilio create → queued/accepted resource, not delivery
Resend email.sent → API accepted/sending, not recipient-mailbox proof
Stripe refund creation → refund resource lifecycle may continue/fail
PayPal capture completed → financial effect confirmed
Calendar insert → event resource exists
Gmail send success → Gmail accepted/sent message resource
```

Never normalize all HTTP 2xx into one business `SUCCEEDED` state.

## P4 — Provider callbacks are evidence streams, not transport noise

Status callback/webhook processing must preserve:

- provider event identity;
- provider operation identity;
- event ordering/time;
- idempotent occurrence handling;
- consequence repair even when effect occurrence was already deduped.

## P5 — Ambiguous request failure requires provider-specific reconciliation strategy

```text
provider native idempotency key available
→ retry same key where contract allows

provider operation ID known
→ lookup/status reconciliation

neither available
→ OUTCOME_UNKNOWN / operator-safe handling
```

## P6 — Reversal is provider-specific and separate from local deletion

A provider may support:

- refund;
- cancel scheduled work;
- deactivate resource;
- delete external artifact;
- no inverse at all.

KeyFlow's Recovery Contract normalizes semantics, not capabilities.

---

# 13. Current KeyFlow priority gaps

### High-confidence direct gaps

1. Stripe current raw connector does not send provider idempotency keys for POST/refund.
2. PayPal current refund/direct capture paths do not use observed PayPal request IDs.
3. Resend SystemEmailService does not use provider-supported idempotency key.
4. Twilio WhatsApp captures SID but current row stops at coarse SENT/FAILED and does not use provider lifecycle callbacks in inspected path.
5. Gmail adapter transient retry lacks provider create-request idempotency; ambiguous send needs OUTCOME_UNKNOWN/reconciliation policy.
6. WiPay current integration omits the provider's modern signed lifecycle webhook model and refund capability.
7. Social delete does not execute provider reversal and per-provider delete capabilities remain unmapped.
8. Direct Meta WhatsApp provider lifecycle contract still needs current primary-doc verification before implementation design is frozen.

### Positive seams to reuse

1. Stripe checkout already carries invoice/business lineage in provider metadata/client reference.
2. Google Calendar provider supports client-defined event IDs specifically useful for crash-safe duplicate prevention.
3. Twilio SID + callback/GET lifecycle gives a strong reconciliation seam.
4. Resend combines request idempotency + provider email ID + signed/at-least-once webhook lifecycle.
5. WiPay now exposes stable transaction ID, pass-through correlation, signed stable-id webhooks and later financial lifecycle.
6. Existing OutboundDelivery/DeliveryEvent can house normalized attempts/provider IDs if adapters expose these properties coherently.

---

# 14. Provider capability states for target adapters

Avoid booleans that overclaim provider support. Target capability metadata should represent:

```yaml
request_idempotency:
  support: supported|unsupported_confirmed|unconfirmed|not_applicable
  mechanism: header|client_resource_id|provider_specific
  retention: ...

reconciliation:
  operation_lookup: supported|unconfirmed|none
  lifecycle_callback: supported|unconfirmed|none
  callback_event_identity: ...

reversal:
  type: cancel|delete|refund|deactivate|none|unconfirmed
  terminality_constraints: ...
```

This prevents “provider not researched yet” from becoming `false` and silently disabling future architecture.

---

# 15. L6 implications

This provider matrix closes the conceptual provider-contract blocker enough to proceed with target representation.

Remaining provider-specific implementation packet prerequisites:

1. verify direct Meta WhatsApp primary lifecycle docs;
2. map social publisher reversal/lookup capabilities provider by provider for whichever providers enter the first execution scope;
3. verify exact Gmail ambiguity-reconciliation approach if Gmail outbound retry is in first scope;
4. verify exact WiPay deployed API family/version/account configuration before replacing legacy callback behavior;
5. bind all provider research to characterization tests/sandbox proof rather than documentation alone.

The target semantic architecture does not depend on those remaining details.

---

# 16. Primary external references

Stripe:

- `https://docs.stripe.com/api/idempotent_requests`
- `https://docs.stripe.com/refunds`
- `https://docs.stripe.com/api/payment-link`

PayPal:

- `https://developer.paypal.com/api/rest/requests/`

Twilio:

- `https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks`
- `https://www.twilio.com/docs/messaging/guides/track-outbound-message-status`
- `https://www.twilio.com/docs/usage/webhooks/messaging-webhooks`
- `https://www.twilio.com/docs/messaging/guides/outbound-message-logging`

Google Calendar:

- `https://developers.google.com/workspace/calendar/api/guides/create-events`
- `https://developers.google.com/workspace/calendar/api/v3/reference/events/insert`
- `https://developers.google.com/workspace/calendar/api/v3/reference/events/delete`
- `https://developers.google.com/workspace/calendar/api/guides/errors`

Gmail:

- `https://developers.google.com/workspace/gmail/api/guides/sending`
- `https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send`

Resend:

- `https://resend.com/docs/dashboard/emails/idempotency-keys`
- `https://resend.com/docs/api-reference/emails/send-email`
- `https://resend.com/docs/webhooks/event-types`
- `https://resend.com/docs/webhooks/introduction`

WiPay:

- `https://docs.wipayfinancial.com/payments-api`
- `https://docs.wipayfinancial.com/webhooks`
- `https://docs.wipayfinancial.com/webhooks/payments-api`
- `https://docs.wipayfinancial.com/hosted-checkout-flows`
- `https://docs.wipayfinancial.com/pass-through-data`
- `https://docs.wipayfinancial.com/wapi/transactions/createRefundRequest`

No runtime provider/sandbox tests were executed in this research pass.
