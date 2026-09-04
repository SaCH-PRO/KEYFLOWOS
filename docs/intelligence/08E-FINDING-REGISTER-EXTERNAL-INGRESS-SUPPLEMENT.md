# KeyFlowOS Finding Register — External Ingress Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after `08D-FINDING-REGISTER-BOOKING-TEMPORAL-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F126.

---

## F127 — first-seen provider-event dedupe can suppress recovery after downstream processing failure

**Status:** VERIFIED CODE-LEVEL / INGRESS-RECOVERY FINDING

`InvoiceWorkflowService.assertNewProviderEvent()` atomically creates a `WebhookEvent` keyed by `(provider, providerEventId)` and payment handlers call it before provider-specific domain processing.

That is a strong occurrence-identity seam, but `WebhookEvent` currently records only that the event was seen. It has no processing lifecycle such as CLAIMED / PROCESSING / APPLIED / RETRYABLE_FAILED.

Failure topology:

```text
verified event
→ WebhookEvent first-seen insert succeeds
→ payment/domain processing fails
→ provider redelivers same occurrence
→ unique constraint reports duplicate
→ retry is acknowledged/ignored
```

A transient application failure can therefore become permanent event loss.

Target law:

```text
OCCURRENCE CLAIM
!= PROCESSING SUCCESS
```

A claimed occurrence that has not reached a terminal applied/ignored state remains safely resumable.

Affected kernels: K7, K9, K11.
Affected journeys: J7, J13, J14, J18, J23.

---

## F128 — RISC performs security consequences before an atomic durable occurrence claim

**Status:** VERIFIED CODE-LEVEL / SECURITY-EVENT CONCURRENCY FINDING

`RiscService.receiveEvent()` verifies the signed JWT, performs a read for existing `jti`, resolves the subject and executes the security consequence before persisting the `RiscEvent` row.

The final persistence failure is intentionally swallowed because the security action already occurred.

Two concurrent deliveries can therefore both pass the absence check and execute the same security consequence. A persistence failure after the effect also removes the durable replay/evidence boundary for that occurrence.

This is the inverse ordering defect to F127: action-before-claim and claim-before-action are both incomplete without a durable PROCESSING lifecycle.

Affected kernels: K1, K7, K8, K9, K11.
Affected journeys: J14, J18, J19, J25.

---

## F129 — Meta webhook body authentication does not by itself bind a separately supplied business route identity

**Status:** VERIFIED CODE-LEVEL / TENANT-BINDING FINDING

The shared Meta WhatsApp/social ingress paths can resolve business ownership from provider-owned destination/page identity. Legacy scoped paths accept a `:businessId` URL parameter while validating a Meta signature over the request body.

The inspected scoped WhatsApp path does not independently prove that the payload's `phone_number_id` belongs to the route business before using that business context.

Provider-neutral distinction:

```text
AUTHENTICATED_PROVIDER_REQUEST
!= TENANT_BOUND_OCCURRENCE
```

The defect is not “tenant IDs in URLs.” Twilio is a counterexample because its validation signs the full request URL/parameters. The invariant is that tenant identity must be cryptographically bound or independently resolved from authenticated provider routing/account evidence.

Affected kernels: K1, K7, K9.
Affected journeys: J5, J13, J14, J18.

---

## F130 — generic inbound email/SMS can trust a declared business ID over independently resolvable destination ownership

**Status:** VERIFIED CODE-LEVEL / TENANT-ROUTING FINDING

The generic inbound communications service resolves business roughly as:

```text
body.businessId ?? resolveBusinessByDestination(to)
```

When the caller supplies `businessId`, the independently derivable destination/account routing evidence is not used as a consistency check.

Even an authenticated envelope should fail closed when its declared tenant conflicts with provider-owned destination identity.

Affected kernels: K1, K9.
Affected journeys: J5, J13, J14, J18.

---

## F131 — WhatsApp replay ownership can occur after consequence-producing branches

**Status:** VERIFIED CROSS-COMPONENT / REPLAY-BOUNDARY FINDING

The repository contains strong downstream message identity seams:

- `KeyInboxMessage` has `@@unique([businessId, channel, externalMessageId])`;
- `KeyInboxService.addMessage()` converts unique conflicts into the existing message;
- `MessageIntake` also has external-message uniqueness.

However current WhatsApp ingress can perform sender/contact resolution, staff-chat routing and emit message-intake work before the KeyInbox uniqueness boundary dominates every branch. Staff routing does not carry the provider external message ID into a durable pre-response occurrence claim.

Therefore downstream inbox dedupe does not prove that all upstream business/AI consequences are replay-safe.

Target law:

> The occurrence uniqueness/claim boundary must dominate every consequence-producing branch for which duplicate execution matters.

This finding deliberately narrows earlier suspicion: Meta social message persistence itself is backed by a real DB uniqueness boundary and conflict recovery.

Affected kernels: K5, K7, K9, K11.
Affected journeys: J2, J5, J6, J14, J18.

---

## F132 — two live Stripe ingress routes implement divergent financial evidence semantics

**Status:** VERIFIED CODE-LEVEL / PARALLEL-SOURCE-OF-TRUTH FINDING

Both `WebhooksModule` and `PaymentsModule` are mounted in the root application.

Current primary route:

```text
/payments/stripe/webhook
→ signature verification
→ provider occurrence dedupe
→ Payment row
→ ledger posting
→ invoice reconciliation
→ connector events
```

Current legacy route:

```text
/webhooks/stripe
→ independent Stripe SDK verification
→ CommerceService.markInvoicePaid()
→ connector event
```

The legacy controller comment says it forwards to the payments module, but the implementation does not. `markInvoicePaid()` may synthesize a local Payment when none exists rather than preserving the actual provider transaction identity.

Thus the same provider occurrence can enter two different financial evidence models depending on configured endpoint URL.

Target compatibility law:

> Legacy ingress URLs may remain temporarily as transport aliases, but must delegate to the same canonical occurrence processor rather than implement parallel business semantics.

Affected kernels: K6, K7, K8, K9, K10, K11.
Affected journeys: J7, J13, J14, J18.

---

## F133 — WiPay callback verification does not match the current documented Payments API response-authentication contract

**Status:** VERIFIED IMPLEMENTATION + CURRENT PRIMARY-DOC COMPARISON

Current KeyFlow callback code computes:

```text
MD5(transaction_id + order_id + total + status)
```

The current WiPay Payments API documentation specifies transaction-response verification based on:

```text
MD5(transaction_id + original_total + api_key)
```

where `api_key` is secret and `original_total` is the original request amount.

The implementation therefore does not match the currently documented provider contract and its shown digest contains no secret material.

This is a standards/current-provider compatibility finding, not a claim about undocumented legacy WiPay deployments. Production account/API-version configuration must be revalidated before remediation.

External evidence family: WiPay Payments API primary documentation, rechecked 2026-09-03.

Affected kernels: K9, K10, K11.
Affected journeys: J7, J13, J14, J18.

---

## F134 — current WiPay integration has no observed server-to-server lifecycle webhook ingestion for later payment corrections

**Status:** VERIFIED SEARCH-SCOPED + CURRENT PRIMARY-DOC COMPARISON

Current repository search found no consumer for WiPay's documented lifecycle webhook headers/events such as stable webhook IDs/signatures or later refund/chargeback/fraud event types.

The inspected KeyFlow integration centers on the checkout/result callback path.

Current WiPay documentation distinguishes the immediate payment flow from signed server-to-server lifecycle webhooks with retries and later payment-state events.

Target law:

```text
CHECKOUT / BROWSER RESULT
!= LONG-LIVED PROVIDER PAYMENT TRUTH
```

Refunds, reversals, chargebacks, fraud decisions and other later provider corrections require lifecycle ingestion or explicit reconciliation.

Affected kernels: K8, K9, K10, K11.
Affected journeys: J7, J13, J14, J18.

---

## F135 — form webhook documentation describes HMAC while implementation performs bearer-secret equality

**Status:** VERIFIED CODE-LEVEL / AUTHENTICATION-CONTRACT FINDING

`FormWebhookController` and `FormPlatformConnector.verifyWebhook()` compare the incoming signature/header value directly with the stored webhook secret. They do not compute a MAC over the request body in the inspected path.

Therefore the implemented mechanism is a shared bearer secret, not payload HMAC authentication.

This may be acceptable for a generic custom webhook compatibility mode, but it must not be represented as equivalent to provider-native message authentication where stronger verification exists.

Affected kernels: K9.
Affected journeys: J9, J13, J14.

---

## F136 — Chatwoot acknowledges 202 before durable acceptance and has no provider-message replay claim before KEY response

**Status:** VERIFIED CODE-LEVEL / DURABLE-HANDOFF FINDING

`ChatwootController` authenticates a shared path secret, then launches `handleWebhook()` fire-and-forget and immediately returns HTTP 202. Errors are swallowed at the controller boundary.

No durable intake/queue/occurrence row is created before acknowledgement. Chatwoot payloads expose message IDs, but the inspected service does not use them as a durable replay boundary before invoking KEY and sending a provider reply.

Failure classes:

```text
process crash after 202
→ provider believes delivery accepted
→ work can disappear

duplicate delivery
→ duplicate KEY reasoning/reply can occur

provider-send failure
→ warning can be logged without durable retry ownership
```

Target law:

> Asynchronous processing is valid, but successful webhook acknowledgement should follow durable acceptance of the occurrence, not merely launch of in-process work.

Affected kernels: K5, K7, K8, K9, K11.
Affected journeys: J2, J5, J6, J14, J18, J23.

---

# Reassessed positive seams

The J14 pass also verified strong properties that should be preserved rather than replaced:

- KeyInbox message persistence has a DB uniqueness boundary and conflict recovery;
- MessageIntake has a stable external-message uniqueness seam;
- Twilio uses provider request validation over the URL/parameters and fails closed unless an explicit local-development escape hatch is enabled;
- LiveKit delegates signature verification to its provider SDK and current webhook effects are small/idempotent enough that a heavyweight ingress workflow is not yet justified;
- payment `WebhookEvent` is a useful occurrence-identity primitive even though its processing lifecycle is incomplete.

---

# Pool law

```text
AUTHENTICATE
→ BIND TENANT
→ IDENTIFY OCCURRENCE
→ DURABLY ACCEPT / CLAIM
→ PROCESS WITH OWNERSHIP
→ APPLY DOMAIN TRANSITION
→ RECORD TERMINAL/RETRYABLE STATE
→ PROPAGATE CAUSAL IDENTITY
→ RECONCILE OUTCOME
```

A unique event ID, signature check or queue alone proves only one part of this chain.

No production implementation is authorized by this supplement.
