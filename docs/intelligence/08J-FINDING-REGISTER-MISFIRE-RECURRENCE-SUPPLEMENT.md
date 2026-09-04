# KeyFlowOS Finding Register — Recurrence Semantics Supplement

Status: CANONICAL CONTINUATION OF `08I-FINDING-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical sequence continues after F148.

Identifier correction: the draft F148 in this file duplicated canonical F145 (`08H-FINDING-REGISTER-MISSED-SCHEDULE-SUPPLEMENT.md`). It is removed from the current canonical content rather than creating duplicate semantic roots. Git history preserves the superseded draft.

---

## F149 — DelegationLoop silently coalesces missed recurrences and shifts future cadence to actual processing time

**Status:** VERIFIED CODE-LEVEL / RECURRENCE-SEMANTIC FINDING

`DelegationLoopService.processDueLoops()` selects enabled loops with `nextRunAt <= now`.

After one execution it computes:

```text
nextRunAt = Date.now() + intervalMin
```

It does not advance from the prior scheduled occurrence time and does not materialize/count each missed recurrence.

Therefore, if the scheduler is unavailable for several intervals:

```text
old nextRunAt
→ multiple logical schedule points pass
→ service returns
→ one run occurs
→ missed intervals effectively collapse into that one run
→ future phase shifts to recovery time + interval
```

This is not inherently the wrong product policy. It is currently implicit and non-auditable: the system cannot distinguish deliberate `COALESCE` from accidental missed work, nor preserve the intended recurrence phase.

Target: WorkDefinition explicitly declares `COALESCE` where appropriate, preserves `originalScheduledAt`, and derives future schedule phase from definition semantics rather than implicitly anchoring to worker recovery time.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F150 — RecurringInvoice preserves schedule phase but lacks a distributed occurrence claim, allowing duplicate invoices for one due recurrence

**Status:** VERIFIED CODE-PATTERN / FINANCIAL-CONCURRENCY FINDING

`RecurringInvoiceService.processRecurringInvoices()`:

```text
private process-local running flag
→ findMany ACTIVE where nextRunDate <= now
→ create Invoice
→ transition Invoice to SENT
→ calculate nextRunDate from the PREVIOUS nextRunDate
→ update recurring schedule
```

Positive property: `calculateNextRunDate()` advances from the prior scheduled date, so recurrence phase is preserved instead of drifting to actual processing time.

However the `running` flag protects only one service instance. No atomic due-occurrence claim was observed before invoice creation.

The Invoice model stores `recurringInvoiceId` but has no observed uniqueness constraint that includes the scheduled recurrence timestamp/occurrence identity.

Two replicas can therefore both read the same due recurring invoice before either advances `nextRunDate`, and each can create/send an invoice for the same logical scheduled occurrence.

Additionally, if multiple periods were missed, the service advances by one period per successful hourly pass, creating an implicit historical catch-up backlog. Whether this is desired billing policy is not explicitly represented.

Target distinction:

```text
recurrence phase
!= misfire/catch-up policy
!= occurrence uniqueness
!= execution ownership
```

Financial recurrence should have a stable scheduled occurrence identity and atomic claim before invoice creation, with explicit catch-up/coalescing policy.

Affected kernels: K7, K8, K10, K11.
Affected journeys: J7, J10, J18, J23.

---

# Canonical misfire root reused

F145 already establishes that representative schedulers implement implicit lateness/catch-up semantics without an explicit business misfire policy. This file narrows only the distinct recurrence-specific consequences above.

Positive seams:

- Transactional email queue has an explicit 48-hour expiry policy, even though its claim/idempotency semantics remain defective under F144.
- WhatsApp scheduled dispatch has an atomic `SCHEDULED → SENDING` claim.
- RecurringInvoice advances next schedule from the prior scheduled date, preserving recurrence phase.
- Kubernetes CronJob is a useful reference model for explicit missed-start deadline, concurrency and original schedule identity; it is not a target runtime requirement.

---

# Pool law

```text
SCHEDULE
→ original scheduled occurrence identity
→ explicit late-start / misfire policy
→ explicit concurrency policy
→ atomic occurrence claim
→ current eligibility
→ exact effect claim
→ outcome
→ next schedule derived from declared recurrence semantics
```

No production implementation is authorized by this supplement.
