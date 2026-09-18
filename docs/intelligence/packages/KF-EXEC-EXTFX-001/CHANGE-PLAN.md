# KF-EXEC-EXTFX-001 Change Plan

## Step 0 — current-main no-edit characterization
Record exact callers/writers/readers of:
- OutboundDelivery.status/retryCount/externalPostId/resultSnapshot
- DeliveryEvent.attemptNumber
- SystemEmailService.sendTransactional()
- content.published / delivery.completed consumers

## Step 1 — additive schema
Add nullable/default-safe fields only:
- effectFingerprint
- effectSnapshot
- attemptSequence/currentAttemptId
- attemptStartedAt
- providerOutcome
- providerFirstAttemptAt
- consequenceState
- optional attempt lease/ownership marker if required by concurrency proof

Legacy rows remain unknown/nullable.

## Step 2 — pure effect helpers
Add deterministic canonicalization/fingerprint/idempotency-key helpers with unit proof.

## Step 3 — adapter contract
Add optional `ProviderEffectContext` to ChannelAdapter.publish().
Only Resend consumes it initially.

## Step 4 — SystemEmailService
Add optional `idempotencyKey`; pass to Resend as second `emails.send` argument. Existing system-email callers remain unchanged.

## Step 5 — bind effect + allocate attempt
Before provider call:
- bind immutable snapshot once;
- verify future retries reuse it;
- allocate durable attempt id/sequence;
- persist ATTEMPT_IN_FLIGHT.

## Step 6 — provider phase
Persist provider outcome before local consequences:
- success → SUCCEEDED_CONFIRMED + externalPostId + consequence INCOMPLETE;
- conclusive pre-effect failure → FAILED_CONFIRMED;
- ambiguous network/provider uncertainty → OUTCOME_UNKNOWN.

## Step 7 — consequence phase
Idempotently repair:
- DeliveryEvent outcome evidence;
- CampaignContact SENT where owned;
- OutboundContent aggregate;
- derivative EventEmitter events.
Never call provider when providerOutcome is SUCCEEDED_CONFIRMED.

## Step 8 — retry/recovery rules
- safe same-key replay only inside verified 24h Resend window;
- outside window, OUTCOME_UNKNOWN is not blind-resend eligible;
- confirmed provider success is consequence-repair only.

## Step 9 — proof
Run unit, DB integration, concurrency, deterministic provider simulator, full server regression and K12 admission.
