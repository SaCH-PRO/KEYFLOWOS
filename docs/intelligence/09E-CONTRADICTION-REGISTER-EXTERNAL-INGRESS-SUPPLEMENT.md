# KeyFlowOS Contradiction Register — External Ingress Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after `09D-CONTRADICTION-REGISTER-BOOKING-TEMPORAL-SUPPLEMENT.md`

Canonical sequence continues after C079.

---

## C080 — first-seen occurrence identity vs recoverable processing lifecycle

**Status:** VERIFIED ACTIVE CONTRADICTION

Payment `WebhookEvent` correctly establishes unique provider-occurrence identity before side effects, but the row has no lifecycle distinguishing CLAIMED/PROCESSING/APPLIED/RETRYABLE_FAILED. A first-seen event can therefore become non-retryable merely because it was recorded before later processing failed.

Target resolution: preserve the unique occurrence seam while adding explicit resumable processing state/ownership.

Affected kernels: K7, K9, K11.
Affected journeys: J7, J14, J18, J23.

---

## C081 — authenticated provider envelope vs tenant-bound occurrence

**Status:** VERIFIED ACTIVE CONTRADICTION

Several ingress paths correctly authenticate source/provider material, yet tenant routing may come from an independently supplied business ID that is not always proven consistent with provider-owned destination/account evidence.

Target resolution: authentication and tenant binding remain separate gates. Tenant claim must be signed/bound or independently resolved/cross-checked.

Affected kernels: K1, K9.
Affected journeys: J5, J13, J14, J18.

---

## C082 — downstream message dedupe vs pre-consequence replay ownership

**Status:** VERIFIED ACTIVE CONTRADICTION

KeyInbox/MessageIntake contain useful external-message uniqueness, but some WhatsApp branches can perform entity/staff/KEY consequences before those uniqueness boundaries dominate the execution graph.

Target resolution: provider occurrence claim precedes material consequence branches; downstream projection uniqueness remains as defense in depth.

Affected kernels: K5, K7, K9, K11.
Affected journeys: J2, J5, J6, J14, J18.

---

## C083 — canonical Stripe payment processor vs live legacy Stripe business processor

**Status:** VERIFIED ACTIVE CONTRADICTION

The root application mounts both `/payments/stripe/webhook` and `/webhooks/stripe`. The latter is described as deprecated/forwarding but independently verifies and processes Stripe events through `CommerceService.markInvoicePaid()`.

Target resolution: one canonical Stripe occurrence processor; compatibility URL may remain only as a delegating transport alias during migration.

Affected kernels: K6, K8, K9, K10, K11.
Affected journeys: J7, J13, J14, J18.

---

## C084 — immediate checkout/result callback vs long-lived payment-provider truth

**Status:** VERIFIED ARCHITECTURAL CONTRADICTION

Current WiPay path is centered on checkout callback/result processing, while current provider documentation exposes later signed lifecycle events such as refunds/chargebacks and retries.

Target resolution: immediate payment UX/result and authoritative ongoing provider lifecycle are separate evidence layers that reconcile into financial truth.

Affected kernels: K8, K9, K10, K11.
Affected journeys: J7, J13, J14, J18.

---

## C085 — documented HMAC form authentication vs implemented bearer-secret comparison

**Status:** VERIFIED ACTIVE CONTRADICTION

Form webhook comments describe HMAC authentication while the inspected code compares incoming header value directly with a stored secret.

Target resolution: either rename/document the mechanism truthfully as bearer-secret authentication or implement/consume provider-native payload authentication where required. Do not claim HMAC semantics that are not present.

Affected kernel: K9.
Affected journeys: J9, J13, J14.

---

## C086 — fast asynchronous webhook acknowledgement vs durable acceptance

**Status:** VERIFIED ACTIVE CONTRADICTION

Chatwoot intentionally returns 202 quickly to avoid provider timeout, but processing is launched in-process without durable handoff before acknowledgement.

Target resolution:

```text
verify
→ durable occurrence/queue acceptance
→ HTTP success
→ async processing/retry
```

Low latency and durability are not opposing requirements when the handoff is explicit.

Affected kernels: K7, K9, K11.
Affected journeys: J5, J14, J18, J23.

---

## C087 — effect-before-dedupe and dedupe-before-effect are both incomplete processing models

**Status:** VERIFIED CROSS-PROVIDER CONTRADICTION

Representative current regimes sit on opposite sides:

```text
RISC
check absent → effect → persist occurrence

PAYMENTS
persist occurrence → effect
```

The first risks duplicate effects; the second risks suppressing recovery after partial failure.

Target resolution is not choosing one ordering. It is an explicit occurrence state machine with atomic claim, PROCESSING ownership and terminal/retryable states.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J14, J18, J23 plus domains consuming external events.

---

# Pool law

```text
SIGNATURE
≠ TENANT BINDING
≠ OCCURRENCE IDENTITY
≠ PROCESSING CLAIM
≠ SUCCESSFUL APPLICATION
≠ CONSEQUENCE IDEMPOTENCY
≠ OUTCOME TRUTH
```

No production implementation is authorized by this supplement.
