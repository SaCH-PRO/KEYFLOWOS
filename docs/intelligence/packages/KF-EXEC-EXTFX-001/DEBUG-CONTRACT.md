# KF-EXEC-EXTFX-001 Debug Contract

Extends the universal debuggability contract.

## Required correlation fields
- businessId
- deliveryId
- effectId
- effectFingerprint
- attemptId
- attemptNumber
- provider=RESEND
- providerOutcome
- consequenceState
- externalPostId when known
- retryCount
- nextRetryAt
- sourceCodeSha/packageId

## Structured events
```text
delivery.effect.bound
delivery.attempt.allocated
delivery.provider.dispatching
delivery.provider.confirmed
delivery.provider.rejected
delivery.provider.outcome_unknown
delivery.consequence.repair_started
delivery.consequence.repair_completed
delivery.consequence.repair_failed
delivery.retry.scheduled
delivery.retry.blocked_unknown_outside_window
```

## Redaction
Do not log:
- raw API keys;
- full email body/html;
- full recipient email unless existing privacy policy explicitly permits.
Prefer delivery/effect IDs and hashed/redacted recipient diagnostics.

## Core diagnostic question
Given `deliveryId`, determine whether:
1. provider definitely sent;
2. provider definitely rejected;
3. provider outcome is unknown;
4. local consequences are complete;
5. replay is safe now;
6. provider must never be called again.
