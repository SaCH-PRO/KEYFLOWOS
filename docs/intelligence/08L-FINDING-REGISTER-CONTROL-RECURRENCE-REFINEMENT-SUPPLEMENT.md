# KeyFlowOS Finding Register — Control / Recurrence Refinement Supplement

Status: CANONICAL CONTINUATION OF `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a` (audit-only advance over code-bearing `d7c5b86c...`)

Canonical sequence continues after F151.

This supplement is the reconciled output of a concurrent-analysis collision. Draft artifacts that reused F145–F151 are non-canonical. Only the non-duplicate evidence below is promoted.

---

## F152 — Cross-Module workflow enable/disable control is not load-bearing for observed CommerceIntegration execution paths

**Status:** VERIFIED CROSS-SURFACE / CONTROL-PLANE FINDING

The shipped Cross-Module Intelligence UI states that disabling a workflow stops it from running while preserving configuration.

`WORKFLOW_DEFINITIONS` exposes commerce workflow concepts including:

```text
store_order_crm_sync
store_order_revenue
store_order_refund_expense
post_purchase_review_request
post_purchase_reorder_prompt
inventory_low_alert
inventory_out_alert
purchase_order_expense
preorder_delay_notice
```

Observed execution for these concepts is implemented in `CommerceIntegrationService` event handlers / scheduled-job creation paths.

No `CrossModuleWorkflow.enabled` / `isWorkflowEnabled()` check was observed in that service.

For delayed post-purchase jobs, later `ScheduledAgentJob` consumption likewise does not establish that the originating CrossModuleWorkflow remains enabled before effect.

This strengthens canonical F146. F146 says pending-occurrence behavior after workflow mutation/disable is implicit. F152 is narrower and stronger: for these observed commerce-backed paths, the advertised workflow enable/disable control is not load-bearing at occurrence creation/execution at all.

Target law:

> A user-visible workflow control that claims to stop a workflow must dominate every material path that the product presents as belonging to that workflow.

Do not fix this by scattering ad-hoc booleans; strengthen the existing definition/control seam into the authoritative policy source.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

## F153 — Post-purchase workflow timing configuration is persisted but bypassed by the live CommerceIntegration scheduler

**Status:** VERIFIED PRODUCT-CONTRACT / TEMPORAL-CONFIGURATION FINDING

Cross-Module workflow definitions expose configurable timing:

```text
post_purchase_review_request.reviewDelayDays  default 3
post_purchase_reorder_prompt.reorderDelayDays default 30
```

The UI persists user changes in `CrossModuleWorkflow.config`.

`CommerceIntegrationService.handleOrderDelivered()` does not load those configuration values. Its scheduling helpers use fixed delays:

```text
reviewDelayMs  = 3 days
reorderDelayMs = 30 days
```

Therefore the visible/persisted workflow configuration is not the runtime source of truth for the observed scheduler.

This is distinct from F146's versioning problem: even before asking which version applies to waiting work, the current configured value is not consumed by this execution path.

Target law:

> Configuration presented as controlling runtime behavior must be consumed by the authoritative WorkDefinition path that creates the occurrence.

Affected kernels: K5, K7, K8.
Affected journeys: J10, J23.

---

## F154 — DelegationLoop silently coalesces missed recurrences and shifts future cadence to actual recovery time

**Status:** VERIFIED CODE-LEVEL / RECURRENCE-SEMANTIC FINDING

`DelegationLoopService.processDueLoops()` selects enabled loops with `nextRunAt <= now`.

After one execution it computes the next run from actual processing time:

```text
nextRunAt = Date.now() + intervalMin
```

It does not advance from the previous scheduled occurrence time and does not record/count each missed schedule point.

If the process is unavailable across multiple intervals:

```text
multiple logical schedule points pass
→ one late run occurs
→ missed intervals silently collapse
→ next recurrence anchors to recovery time + interval
```

Canonical F145 already establishes the system-level need for explicit missed-schedule policy. F154 records the distinct DelegationLoop implementation consequence: implicit `COALESCE` plus schedule-phase drift.

Target: if coalescing is intended, declare it; preserve original scheduled occurrence/phase and do not let worker recovery time silently redefine the schedule.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F155 — RecurringInvoice lacks a distributed due-occurrence claim and can duplicate one financial recurrence across replicas

**Status:** VERIFIED CODE-PATTERN / FINANCIAL-CONCURRENCY FINDING

`RecurringInvoiceService.processRecurringInvoices()` uses a process-local `running` flag, then:

```text
find ACTIVE recurring rows where nextRunDate <= now
→ create Invoice
→ transition invoice to SENT
→ advance nextRunDate from previous scheduled date
```

Positive property: recurrence phase is preserved because the next date is calculated from the previous scheduled date rather than worker recovery time.

However the `running` flag serializes only one process. No atomic due-occurrence claim was observed before invoice creation.

Invoice stores `recurringInvoiceId`, but no observed unique key includes the logical scheduled occurrence timestamp/version.

Therefore two application replicas can both select the same due recurring row and each create/send an invoice before either advances `nextRunDate`.

If multiple periods were missed, the service also advances one period per successful hourly pass, implicitly catching up historical occurrences. Whether that is desired billing policy is not represented explicitly.

Target distinctions:

```text
recurrence phase
!= missed-run policy
!= occurrence uniqueness
!= execution ownership
```

A financial recurrence needs stable occurrence identity plus an atomic claim before invoice generation.

Affected kernels: K7, K8, K10, K11.
Affected journeys: J7, J10, J18, J23.

---

# Reused canonical findings — do not duplicate

- F145 — representative schedulers lack explicit lateness/misfire semantics;
- F146 — waiting work lacks explicit workflow-definition version/migration policy;
- F149 — ambiguous transport outcome vs confirmed failure;
- F150 — failed idempotency evidence defeats BullMQ retry;
- F151 — undo eligibility is process-local.

The Gmail ambiguous-send retry trace strengthens F149 but is not assigned a new finding ID.

---

# Pool law

```text
DECLARED CONTROL PLANE
→ MUST BE LOAD-BEARING

CONFIGURED VALUE
→ MUST BE RUNTIME DEFINITION INPUT

RECURRENCE PHASE
!= WORKER RECOVERY TIME

ONE FINANCIAL DUE OCCURRENCE
→ ONE ATOMIC OCCURRENCE CLAIM
→ ONE EFFECT IDENTITY
```

No production implementation is authorized by this supplement.
