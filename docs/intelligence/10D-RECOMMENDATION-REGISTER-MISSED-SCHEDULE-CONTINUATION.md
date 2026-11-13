# KeyFlowOS Recommendation Register — Missed Schedule Continuation

Status: CANONICAL CONTINUATION OF `10C-RECOMMENDATION-REGISTER-CANCELLATION-SUPERSESSION-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-044.

---

## KF-REC-045 — Define per-work missed-schedule and lateness policy

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K11 Recovery/Reliability

Do not infer that all overdue work should execute whenever a worker eventually sees it.

Every durable work definition whose business meaning can change with time should define an appropriate misfire/lateness policy, conceptually including:

```text
CATCH_UP
CATCH_UP_UNTIL(deadline)
COALESCE
LATEST_WINS
SKIP
EXPIRE
MANUAL_REVIEW
```

These are semantic policy classes, not necessarily a universal database enum.

Required inputs may include:

```text
original scheduled timestamp
actual eligibility/evaluation timestamp
maximum permitted lateness
recurrence/cadence semantics
current business-state preconditions
superseding occurrence/definition
risk/control requirements when late
```

Target decision:

```text
SCHEDULED FOR T
→ now = T + lateness
→ evaluate work-specific misfire policy
→ revalidate current state
→ EXECUTE | COALESCE | SUPERSEDE | SKIP | EXPIRE | MANUAL_REVIEW
```

For recurring work, explicitly define whether multiple missed occurrences remain distinct or collapse into fewer current occurrences.

Preserve both original scheduled time and actual execution/terminalization time as evidence.

Reference properties adapted from established systems:

- Kubernetes CronJob `startingDeadlineSeconds` makes late-start eligibility explicit;
- BullMQ documents delayed execution as not guaranteed at the exact requested time.

Affected journeys: J4, J6, J9, J10, J18, J23 and any future time-sensitive obligation/workflow.

---

# Promotion rule

Before implementation:

- classify major scheduled work types by product semantics;
- define safe defaults only where domain semantics genuinely align;
- preserve compatibility with existing scheduler records;
- design outage/backlog/clock-skew tests;
- expose expired/skipped/coalesced states operationally;
- ensure horizontal scaling does not alter misfire decisions.

No production implementation is authorized by this continuation.
