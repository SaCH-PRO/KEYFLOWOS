# KeyFlowOS Finding Register — Missed Schedule Supplement

Status: CANONICAL CONTINUATION OF `08G-FINDING-REGISTER-CANCELLATION-SUPERSESSION-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F144.

---

## F145 — Representative schedulers implement implicit unbounded catch-up without an observed semantic lateness policy

**Status:** VERIFIED CROSS-DOMAIN / TEMPORAL-SEMANTICS FINDING

Representative baseline schedulers for review solicitation, abandoned-cart recovery, social publishing, email campaigns and generic scheduled-agent work use eligibility of the form:

```text
status = PENDING/SCHEDULED
scheduledFor/scheduledAt <= now
→ execute
```

No explicit maximum lateness, expiry window, coalescing rule, latest-wins rule, or manual-review threshold was observed on these paths.

Consequences differ by domain:

- a review request may still be useful moderately late;
- a booking reminder can become meaningless after the booking window;
- an event/launch social post can become stale or harmful;
- multiple missed abandoned-cart sequence steps may burst instead of preserving intended cadence;
- a financial/regulatory obligation may require exception handling rather than silent catch-up.

Current scheduler mechanics therefore imply `CATCH_UP_FOREVER` where product/business semantics may require `CATCH_UP_UNTIL`, `COALESCE`, `LATEST_WINS`, `SKIP`, `EXPIRE`, or `MANUAL_REVIEW`.

Positive reference properties:

- Kubernetes CronJob exposes `startingDeadlineSeconds` and explicit concurrency/missed-run semantics;
- BullMQ documents delayed time as an eligibility target rather than a guarantee of exact execution time.

Target law:

> Scheduled time is not by itself perpetual permission to execute. Lateness policy and current eligibility are part of durable work semantics.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

# Pool law

```text
ORIGINAL SCHEDULED TIME
+
LATENESS
+
MISFIRE POLICY
+
CURRENT BUSINESS ELIGIBILITY
→ EXECUTE | COALESCE | SUPERSEDE | SKIP | EXPIRE | MANUAL_REVIEW
```

No production implementation is authorized by this supplement.
