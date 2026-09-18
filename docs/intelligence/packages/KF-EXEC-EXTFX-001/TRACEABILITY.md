# KF-EXEC-EXTFX-001 Traceability

| Invariant | Current seam | Planned change | Proof | Debug signal |
|---|---|---|---|---|
| I1 one delivery = one effect | OutboundDelivery.id | use id as slice-local effectId | EXTFX-P01 | effectId |
| I2 immutable material effect | mutable content/variant read | persist snapshot + SHA-256 fingerprint | EXTFX-P02/P03 | effectFingerprint |
| I3 attempt before PONR | attemptNumber after publish | allocate attempt seq/id before adapter call | EXTFX-P04 | attemptId, attemptNumber |
| I4 one active owner | status CAS only | CAS + attempt generation/lease marker | EXTFX-P05 | claimOwner/attemptStartedAt |
| I5 stable provider idempotency | none | deterministic Resend key from effectId+fingerprint | EXTFX-P06/P07 | providerIdempotencyKeyHash |
| I6 monotonic provider success | broad catch regresses truth | persist SUCCEEDED_CONFIRMED before consequences | EXTFX-P08 | providerOutcome |
| I7 consequence repair separate | same try/catch | provider phase then repair phase | EXTFX-P09/P10 | consequenceState |
| I8 explicit unknown | generic transient/failure | OUTCOME_UNKNOWN + 24h replay policy | EXTFX-P11 | providerOutcome=OUTCOME_UNKNOWN |
| I9 tenant scope | businessId on delivery | all lookups/mutations remain delivery+business bound | EXTFX-P12 | businessId |
| I10 events not truth | EventEmitter2 | best-effort derivative notification only | EXTFX-P13 | derivativeEvent status |
