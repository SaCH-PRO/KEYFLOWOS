# KF-EXEC-EXTFX-001 Proof Matrix

| ID | Proof |
|---|---|
| EXTFX-P01 | delivery id remains stable effect id across attempts |
| EXTFX-P02 | same material payload → same fingerprint |
| EXTFX-P03 | recipient/sender/subject/body material change → different fingerprint |
| EXTFX-P04 | durable attempt evidence exists before provider simulator invocation |
| EXTFX-P05 | two claimers cannot both own same attempt generation |
| EXTFX-P06 | attempts for same effect/fingerprint reuse same Resend key |
| EXTFX-P07 | different effect id produces different key |
| EXTFX-P08 | provider success remains SUCCEEDED_CONFIRMED after injected local failure |
| EXTFX-P09 | post-provider local failure never calls provider on repair |
| EXTFX-P10 | restart repairs INCOMPLETE consequences without resend |
| EXTFX-P11 | ambiguous provider failure becomes OUTCOME_UNKNOWN and same-key replay is bounded to safe window |
| EXTFX-P12 | cross-business lookup/mutation rejected |
| EXTFX-P13 | derivative event failure cannot regress provider truth |
| EXTFX-P14 | legacy ambiguous rows are not auto-labelled failed or resend-safe |
| EXTFX-P15 | Resend adapter passes exact stable idempotency key |
| EXTFX-P16 | SystemEmailService callers without idempotency key remain backward compatible |

Required deterministic provider simulator cases:
- accept + id;
- reject before effect;
- accept but response lost;
- same key+same payload → same provider object;
- same key+different payload → conflict.
