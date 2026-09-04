# KeyFlowOS Contradiction Register — Recurrence Semantics Supplement

Status: CANONICAL CONTINUATION OF `09I-CONTRADICTION-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md`

Canonical sequence continues after C099.

Identifier correction: the draft C099 in this file duplicated canonical C096 (`09H-CONTRADICTION-REGISTER-MISSED-SCHEDULE-SUPPLEMENT.md`). It is removed from current canonical content rather than creating a duplicate semantic root.

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

# Canonical misfire root reused

C096 already establishes time-sensitive business meaning vs implicit scheduler catch-up. This supplement records only the distinct recurrence-phase and financial-occurrence contradictions.

# Pool law

```text
RECURRENCE PHASE
!= WORKER RECOVERY TIME

ONE DUE OCCURRENCE
→ ONE CLAIMED FINANCIAL CONSEQUENCE
```

No production implementation is authorized by this supplement.
