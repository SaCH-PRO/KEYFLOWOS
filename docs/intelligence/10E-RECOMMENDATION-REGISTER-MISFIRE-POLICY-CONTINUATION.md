# KeyFlowOS Recommendation Register — Misfire Policy Continuation

Status: CANONICAL CONTINUATION OF `10D-RECOMMENDATION-REGISTER-WORKFLOW-DEFINITION-CONTROL-CONTINUATION.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical recommendation sequence continues after KF-REC-046.

---

## KF-REC-047 — Make late-start, recurrence phase and concurrency policy explicit WorkDefinition semantics

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K11 Recovery/Reliability

Time-based business work must explicitly define what a missed schedule means rather than inheriting accidental scheduler behavior.

Recommended semantic fields/properties:

```yaml
schedule_policy:
  schedule_expression: ...
  timezone: ...
  original_scheduled_at: ...        # occurrence property
  latest_start_at: ...              # occurrence property when applicable
  catchup_window: ...               # definition policy
  misfire_policy: CATCH_UP|COALESCE|SKIP|EXPIRE|MANUAL_REVIEW
  concurrency_policy: ALLOW|FORBID|REPLACE_OR_SUPERSEDE
  preserve_schedule_phase: true|false
```

These properties are semantic; existing domain models can implement them without a universal scheduler table during migration.

### Required distinctions

```text
RECURRENCE PHASE
!= MISFIRE POLICY

SCHEDULED_AT
!= LATEST_USEFUL_START

ONE MISSED OCCURRENCE
!= AUTOMATICALLY ONE LATE EXECUTION

CONCURRENCY POLICY
!= EXECUTION IDEMPOTENCY
```

### Examples

- customer reminder: expire/skip if too late to be useful;
- owner digest: coalesce missed periods into one current digest;
- financial recurrence: preserve contractual phase, but catch-up policy may require one-per-period, aggregate, or manual review;
- housekeeping observation: coalesce may be appropriate;
- high-risk autonomous effect: late start may require current re-control rather than blind catch-up.

### Reference properties

Kubernetes CronJob demonstrates useful independent controls for delayed-start deadline, concurrency behavior, suspension and original scheduled timestamp. Adopt the semantic separation, not the platform.

Temporal/Camunda-class engines remain optional and should not be introduced solely to implement these semantics.

Affected journeys: J4, J6, J7, J9, J10, J11, J18, J23.

---

# Proof before execution packet

- outage across multiple schedule points produces the declared number of logical occurrences;
- expired work never executes merely because a worker returned late;
- coalesced work records what was coalesced;
- recurrence phase does not drift unless definition explicitly permits it;
- concurrency behavior is deterministic under multiple workers;
- financial scheduled occurrences have one durable occurrence identity before side effect;
- operator can see original schedule time, lateness and misfire disposition.

No production implementation is authorized by this continuation.
