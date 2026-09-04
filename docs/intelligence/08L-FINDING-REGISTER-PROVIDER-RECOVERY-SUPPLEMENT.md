# KeyFlowOS Finding Register — Provider Recovery Supplement

Status: CANONICAL CONTINUATION OF `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F151.

---

## F152 — OutboundDelivery preserves internal delivery identity across retries but the shared adapter contract does not preserve provider-effect idempotency identity

**Status:** VERIFIED CROSS-LAYER / EXTERNAL-RECOVERY FINDING

`DeliveryQueueService` preserves one durable `OutboundDelivery` row, retry count, attempt evidence and expected-state claim across retry.

However `ChannelAdapter.publish(connection, destination, payload)` has no first-class EffectId/provider-idempotency field. Retry simply calls `publish()` again.

Current WhatsApp, Gmail and Resend adapters therefore issue a fresh provider request on a retryable/transient attempt. At least one current provider — Resend — officially supports native idempotency keys for exactly this timeout/retry duplicate-prevention case, but the current KeyFlow Resend path does not pass one.

Thus:

```text
stable internal DeliveryId
!= stable external provider effect identity
```

Target: provider capability contracts map one stable KeyFlow EffectId to provider-native idempotency where available; otherwise ambiguous requests use reconciliation-first semantics rather than blind fresh retry.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J14, J18, J23.

---

## F153 — Instagram outbound publishing is a multi-stage external operation without durable sub-operation checkpoint recovery

**Status:** VERIFIED CODE-LEVEL / PARTIAL-EXTERNAL-OPERATION FINDING

`MetaAdapter.publishToInstagram()` performs:

```text
POST /media → creation container ID
POST /media_publish → published post ID
```

The successful container ID is held only in local function scope. If publication fails or becomes ambiguous after container creation, DeliveryQueue marks the whole delivery retryable/failed without persisting the stage-1 checkpoint.

A retry therefore starts from container creation again.

If media publication succeeded externally but the response was lost, a retry can create and publish a new container, risking duplicate external content.

Target law:

> Multi-stage provider operations persist provider checkpoints and resume/reconcile from the last safe stage; they are not blindly restarted as one opaque request.

Affected kernels: K8, K9, K11.
Affected journeys: J9, J14, J18, J23.

---

# Reference property

Resend official documentation supports `Idempotency-Key` / SDK `idempotencyKey` for duplicate-safe retries and explicitly cites server errors, timeouts and retry logic as intended uses.

This provider capability strengthens the existing-seam strategy: evolve the current adapter/provider-operation contract rather than building a parallel delivery stack.

---

# Pool law

```text
INTERNAL DELIVERY IDENTITY
must map to
EXTERNAL EFFECT IDENTITY
where retry can cross provider boundaries

MULTI-STAGE PROVIDER EFFECT
requires durable checkpoint/reconciliation semantics
```

No production implementation is authorized by this supplement.
