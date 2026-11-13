# KF-EXEC-EXTFX-001 Failure Matrix

| Failure point | Provider effect possible? | Required semantic state | Retry rule |
|---|---:|---|---|
| snapshot binding DB failure | no | NOT_ATTEMPTED | safe after repair |
| attempt allocation DB failure | no | NOT_ATTEMPTED | safe |
| provider rejects before effect | no/confirmed | FAILED_CONFIRMED | policy retry allowed |
| timeout/connection lost after request | yes | OUTCOME_UNKNOWN | same key+payload only inside 24h |
| provider returns success, success persistence fails | yes/confirmed response seen | must preserve uncertainty locally; reconcile, never classify confirmed failure | no blind new effect |
| provider success persisted, DeliveryEvent fails | yes, confirmed | SUCCEEDED_CONFIRMED + INCOMPLETE | consequence repair only |
| campaign-contact update fails | yes, confirmed | SUCCEEDED_CONFIRMED + INCOMPLETE | consequence repair only |
| content aggregate update fails | yes, confirmed | SUCCEEDED_CONFIRMED + INCOMPLETE | consequence repair only |
| derivative EventEmitter consumer throws | yes, confirmed | canonical provider truth unchanged | notification best-effort unless new evidence changes scope |
| process dies with ATTEMPT_IN_FLIGHT | unknown | stale/unknown reconciliation | no blind resend |
| unknown older than 24h | unknown | OUTCOME_UNKNOWN | operator/reconciliation, no resend |
