# KeyFlowOS Contradiction Register — Misfire / Recurrence Supplement

Status: CANONICAL CONTINUATION OF `09I-CONTRADICTION-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md`

Canonical sequence continues after C098.

---

## C099 — scheduled business intent vs scheduler-specific accidental late-start semantics

**Status:** VERIFIED SYSTEMIC CONTRADICTION

Material KeyFlow schedulers do not share an explicit WorkDefinition-level missed-start contract.

Some overdue work catches up without a lateness bound, TransactionalEmail explicitly expires queued work after 48 hours, and DelegationLoop silently coalesces missed intervals.

Thus the business meaning of "run at/after this time" depends on which subsystem owns the work rather than an explicit policy.

Target resolution: each scheduled WorkDefinition declares late-start/misfire semantics such as `CATCH_UP`, `COALESCE`, `SKIP`, `EXPIRE`, or `MANUAL_REVIEW`, plus a catch-up window/latest useful start where relevant.

Affected kernels: K5, K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

## C100 — recurring schedule phase vs actual worker recovery time

**Status:** VERIFIED ACTIVE CONTRADICTION

DelegationLoop's next recurrence is anchored to `Date.now() + interval` after a late run rather than to the declared prior schedule phase.

A worker outage therefore changes future recurrence timing even though the WorkDefinition interval itself did not change.

Target resolution: recurrence phase is an explicit temporal property. Coalescing missed runs may be valid, but it must not accidentally redefine the schedule unless drift is the declared policy.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## C101 — one recurring-invoice schedule occurrence vs multiple replica-created financial effects

**Status:** VERIFIED DISTRIBUTED-CONCURRENCY CONTRADICTION

RecurringInvoice preserves old schedule phase, but due selection and invoice creation have no observed distributed occurrence claim. A process-local `running` flag cannot serialize multiple application instances.

Thus one logical `nextRunDate` occurrence can be observed by two replicas and produce two invoices before either advances the schedule.

Target resolution: one stable financial recurrence occurrence identity atomically owns invoice generation; retry preserves the same occurrence identity.

Affected kernels: K7, K8, K10, K11.
Affected journeys: J7, J10, J18, J23.

---

# Pool law

```text
SCHEDULED TIME
!= LATEST USEFUL START

MISSED OCCURRENCE
!= AUTOMATICALLY CATCH UP
!= AUTOMATICALLY SKIP

RECURRENCE PHASE
!= WORKER RECOVERY TIME

ONE DUE OCCURRENCE
→ ONE CLAIMED FINANCIAL CONSEQUENCE
```

No production implementation is authorized by this supplement.
