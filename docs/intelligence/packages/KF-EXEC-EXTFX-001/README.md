# KF-EXEC-EXTFX-001 Surgical Package

Level: **L2 — SURGICALLY HARDENED**  
Implementation authorization: **ACTIVE**  
Current-main characterization baseline: `main@ebbe8862fa4b7e6ec968db193620ac53f38cd5ff`

## Mission

Make Resend-backed `OutboundDelivery` safe against duplicate email effects caused by retries, crashes, or local failures after Resend has already accepted the message.

## Bounded outcome

```text
one OutboundDelivery
→ one stable effect identity
→ immutable provider payload
→ durable attempt identity before provider call
→ stable Resend idempotency key
→ monotonic provider outcome
→ separate consequence repair
```

## Current-main facts

- `DeliveryQueueService.executeDelivery()` still wraps provider call plus local consequence work in one broad try/catch.
- attempt number is still allocated after `adapter.publish()`.
- `OutboundDelivery` has no effect fingerprint/snapshot, attempt-start fields, provider-outcome field, or consequence-completeness field.
- `ResendEmailAdapter` does not accept provider-effect context.
- `SystemEmailService.sendTransactional()` does not expose Resend idempotency.
- `content.published` and `delivery.completed` currently route into AI listener observation and are not canonical provider truth.
- Resend official Node API supports `emails.send(payload, { idempotencyKey })`; same key + same payload is deduplicated for 24 hours.

## Implementation slices

1. EXTFX-A — immutable effect snapshot + fingerprint
2. EXTFX-B — durable attempt allocation/ownership before provider call
3. EXTFX-C — Resend idempotency context
4. EXTFX-D — provider outcome persistence
5. EXTFX-E — consequence repair separation
6. EXTFX-F — deterministic failure-injection/concurrency proof
7. EXTFX-G — legacy ambiguity/compatibility

## Hard stop conditions

Stop if implementation discovery shows:
- a material business side effect hidden behind `content.published` / `delivery.completed`;
- current schema requires a universal attempt/workflow table;
- provider request payload cannot be reproduced from a safe immutable snapshot;
- current main has materially changed these seams after this characterization;
- an ambiguous provider result cannot be distinguished from confirmed provider rejection.
