# Claude Code Handoff — KF-EXEC-EXTFX-001

## First inspect
1. packet + this package
2. current main SHA
3. delivery-queue.service.ts
4. channel-adapter.interface.ts
5. resend-email-adapter.ts
6. system-email.service.ts
7. OutboundDelivery / DeliveryEvent schema
8. all writers/readers of status, retryCount, externalPostId, resultSnapshot, attemptNumber
9. all consumers of content.published / delivery.completed

## Return before edits
- source drift from `main@ebbe8862...`;
- exact additional consumers/writers found;
- current Resend SDK type signature confirmation;
- exact migration proposal;
- whether existing CAS requires lease field.

## Allowed
Only Resend-backed OutboundDelivery effect-certainty slice plus compile-compatible adapter changes.

## Forbidden
Universal work/attempt/recovery tables, Gmail/Meta/Twilio changes, broad workflow refactor, hiding execution identity in payload.meta.

## Stop if
A material business consequence is discovered behind derivative events or the allowed schema seams cannot satisfy concurrency/crash proof.
