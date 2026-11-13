# J18 — OutboundDelivery Provider Retry Identity / Partial External Operations

Status: VERIFIED FORENSIC PASS / RECOVERY TARGET INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Primary journey: J18 Failure → Recovery
Primary kernels: K11 Recovery/Reliability, K9 Integration/External Reality
Secondary kernels: K7 Temporal/Workflow, K8 Evidence/Outcome
Adjacent journeys: J5, J9, J14, J23

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

When `OutboundDelivery` retries after a transient/ambiguous provider failure, does the next attempt preserve one external business-effect identity, or can it create a second provider effect?

---

## 2. Strong Current Seam — OutboundDelivery

`DeliveryQueueService` has strong internal recovery mechanics:

```text
Queued / Scheduled / RetryPending
→ candidate read
→ expected-state updateMany(status=current) → Sending
→ adapter.publish(...)
→ DeliveryEvent attempt evidence
→ Published | RetryPending | Failed
```

It preserves:

- stable `OutboundDelivery.id`;
- atomic status claim;
- retry count;
- exponential next-retry time;
- durable per-attempt DeliveryEvent;
- provider external ID/result snapshot on success;
- content aggregation.

This is a strong existing seam and should be strengthened, not replaced.

---

## 3. Shared ChannelAdapter Contract Has No External Effect / Idempotency Identity

Current interface:

```ts
publish(connection, destination, payload): Promise<PublishResponse>
```

`PublishPayload` carries content, subject, recipient and free-form `meta`.

There is no first-class contract for:

```text
EffectId / ProviderOperationId
provider idempotency key
attempt identity
prior provider operation checkpoint
outcome-unknown classification
resume token / sub-operation state
```

`PublishResponse` supports:

```text
success
externalPostId
externalUrl
errorCode/errorMessage
isTransient
raw
```

but not `OUTCOME_UNKNOWN` or a provider operation state machine.

The DeliveryQueue passes the same delivery row through retries, but its retry call is simply a fresh `adapter.publish(...)` invocation.

---

## 4. Current Adapter Retry Behavior

### WhatsAppAdapter

Transient classes include timeout, ECONNRESET, rate limit/429, and provider HTTP 5xx.

A retry reissues a fresh POST to Meta WhatsApp `/messages`.

No stable KeyFlow EffectId/provider idempotency key is passed.

### EmailAdapter / Gmail

Transient classes similarly include timeout, ECONNRESET, rate limit/429 and provider HTTP 5xx.

A retry reissues a fresh Gmail `messages/send` request.

No first-class provider effect/idempotency identity is passed by the adapter contract.

### ResendEmailAdapter

Calls:

```text
SystemEmailService.sendTransactional()
→ resend.emails.send({ ...email payload... })
```

No idempotency option is passed.

Current Resend official documentation supports an `Idempotency-Key` / SDK `idempotencyKey` specifically to prevent duplicate sends during server errors, timeouts and retry logic. Resend retains the key for a bounded period (currently documented as 24 hours) and returns the same email ID for the same key + payload.

Therefore at least one current provider exposes a native safety mechanism that KeyFlow's shared adapter abstraction does not currently surface or use.

References:

- https://resend.com/changelog/idempotency-keys
- https://resend.com/blog/engineering-idempotency-keys

---

## 5. F152 — Internal Delivery Identity Does Not Automatically Become Provider Effect Idempotency

Verified chain:

```text
OutboundDelivery D
→ attempt 1
→ adapter publishes external request
→ transient/ambiguous error
→ D = RetryPending
→ later D claimed again
→ adapter.publish() issues fresh provider request
```

The internal `delivery.id` survives, but no shared provider-idempotency/effect identity is supplied to the adapter/provider call.

Thus:

```text
stable internal retry identity
!=
stable external side-effect identity
```

For providers that support native idempotency (verified for Resend), the mechanism is currently unused by this path.

For providers without native idempotency, K9/K11 require provider-specific reconciliation/lookup or local point-of-no-return handling rather than assuming fresh retry is safe.

This is F152.

---

## 6. Instagram Is a Multi-Stage External Operation

`MetaAdapter.publishToInstagram()` performs:

```text
1. POST /{igUserId}/media
   → creation container ID

2. POST /{igUserId}/media_publish
   → published post ID
```

The container ID exists only in local function scope.

If stage 2 fails, the returned adapter failure does not persist the successful stage-1 provider checkpoint onto `OutboundDelivery` before retry.

A DeliveryQueue retry therefore starts at stage 1 again.

Possible chain:

```text
container C1 created
→ publish C1 returns transient error
→ Delivery = RetryPending
→ retry creates container C2
→ publish C2
```

More dangerous ambiguity:

```text
publish C1 succeeds externally
→ response lost / network exception
→ adapter reports transient failure
→ retry creates C2
→ publish C2
→ duplicate external post possible
```

This is not merely missing idempotency. It is missing durable **sub-operation checkpoint/reconciliation** for a multi-stage external saga.

This is F153.

---

## 7. Target ProviderOperation Contract

Do not make every adapter identical; provider capabilities differ.

K9/K11 should require the adapter layer to declare/use applicable recovery properties:

```yaml
provider_operation:
  effect_id: stable KeyFlow effect identity
  attempt_id: current attempt
  provider_idempotency_key: optional/provider-supported
  prior_provider_operation_id: optional
  checkpoint: optional multi-stage state
  point_of_no_return: provider-specific
  retry_classification: SAFE_RETRY | RECONCILE_FIRST | FINAL_FAILURE
  outcome_certainty: CONFIRMED_FAILURE | OUTCOME_UNKNOWN | ACCEPTED | CONFIRMED_SUCCESS
```

Potential adapter capability declarations:

```text
supports_native_idempotency
supports_operation_lookup
supports_status_callback
supports_reversal
supports_resume_from_checkpoint
```

This is a semantic contract; it does not require a new integration platform.

---

## 8. Recovery Algorithm

```text
adapter failure
→ was provider request definitely rejected before effect?
   yes → safe retry if policy permits
→ did request possibly cross provider boundary?
   yes → OUTCOME_UNKNOWN
       → lookup/reconcile by provider/effect identity
       → retry only if non-effect confirmed or native idempotency makes repeat safe
→ multi-stage provider operation?
   yes → persist successful checkpoints
       → resume/reconcile from last safe stage
       → do not blindly restart the whole external saga
```

---

## 9. Reused Recommendations

Do not create a duplicate broad integration recommendation.

Strengthen:

- KF-REC-027 atomic ExecutionClaim;
- KF-REC-037 provider lifecycle reconciliation;
- KF-REC-044 durable causal/effect identity across handoffs.

A future implementation packet should make provider recovery capability explicit at the current adapter seam rather than inventing `ChannelAdapterV2` in parallel.

---

## 10. Proof Requirements

- two Resend retries for the same EffectId use one provider idempotency key and cannot send twice within provider guarantee;
- a provider without native idempotency enters reconciliation-first semantics after ambiguous request failure;
- retry preserves OutboundDelivery/EffectId while incrementing AttemptId;
- a definitive provider 4xx rejection can be retried only if policy says parameters/credentials can change;
- Instagram container creation survives as a durable checkpoint when stage 2 must be retried/reconciled;
- response loss after provider success cannot silently produce duplicate published content;
- provider-specific capability differences are visible to K11 without leaking into normal product UX.

No runtime tests were executed in this pass.
