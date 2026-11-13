# KeyFlowOS Contradiction Register — Missed Schedule Supplement

Status: CANONICAL CONTINUATION OF `09G-CONTRADICTION-REGISTER-CANCELLATION-SUPERSESSION-SUPPLEMENT.md`

Canonical sequence continues after C095.

---

## C096 — time-sensitive business meaning vs implicit unbounded scheduler catch-up

**Status:** VERIFIED SYSTEMIC CONTRADICTION

Representative current schedulers treat any pending/scheduled row with `scheduledAt/scheduledFor <= now` as executable, regardless of how late it is.

But the business meaning of delayed work can change with lateness:

```text
some work remains useful late
some should coalesce
some is superseded by a newer occurrence
some expires
some should be skipped
some requires manual exception handling
```

Thus current transport eligibility can remain true after business eligibility has expired or changed.

Target resolution:

```text
scheduled time
+ lateness
+ work-specific misfire policy
+ current-state revalidation
→ explicit execution decision
```

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

# Pool law

```text
OVERDUE != STILL VALID
DELAYED != FAILED
MISSED != AUTOMATICALLY CATCH_UP
```

No production implementation is authorized by this supplement.
