# KeyFlowOS Finding Register — Misfire / Recurrence Supplement

Status: CANONICAL CONTINUATION OF `08I-FINDING-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical sequence continues after F147.

---

## F148 — Multiple material schedulers apply implicit, heterogeneous missed-start policy rather than an explicit business misfire contract

**Status:** VERIFIED CROSS-SYSTEM / TEMPORAL-POLICY FINDING

Current schedulers encode materially different overdue behavior in implementation:

```text
ScheduledAgentJob
  due when scheduledFor <= now
  no observed latest-start/catch-up bound
  → overdue occurrence runs whenever a poller eventually sees it

EmailCampaign
  SCHEDULED + scheduledAt <= now
  no observed latest-start/catch-up bound
  → overdue campaign attempts to send whenever scheduler resumes

WhatsAppMessage
  SCHEDULED + scheduledAt <= now
  favorable SCHEDULED→SENDING claim
  no observed latest-start/catch-up bound
  → overdue customer message attempts to send whenever cron resumes

CustomerNotificationLog queue
  explicit queue max age = 48h
  → older QUEUED rows become EXPIRED

DelegationLoop
  due when nextRunAt <= now
  runs once
  then nextRunAt = actual processing time + interval
  → missed intervals are silently coalesced
```

These may all be legitimate policies for different business work, but they are not expressed as explicit per-definition semantics. The policy is an implementation accident of each scheduler.

This matters because a customer message, owner digest, financial obligation, housekeeping sweep, and recurring business action should not necessarily share one late-start rule.

Target law:

> Every time-based WorkDefinition declares what a missed occurrence means, including a latest useful start/catch-up window and whether missed occurrences are caught up, coalesced, skipped, expired or escalated for review.

Reference property: Kubernetes CronJob exposes `startingDeadlineSeconds`, `concurrencyPolicy`, suspension semantics and the originally scheduled timestamp rather than leaving these as hidden controller behavior.

Affected kernels: K5, K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

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
→ all missed intervals effectively collapse into that one run
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

# Positive seams preserved

- Transactional email queue has an explicit 48-hour expiry policy, even though its claim/idempotency semantics remain defective under F144.
- WhatsApp scheduled dispatch has an atomic `SCHEDULED → SENDING` claim.
- RecurringInvoice advances next schedule from the prior scheduled date, preserving recurrence phase.
- Kubernetes CronJob is a useful reference model for explicit missed-start deadline, concurrency and schedule identity; it is not a target runtime requirement.

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
