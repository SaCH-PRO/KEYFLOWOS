# KeyFlowOS Finding Register — Cancellation / Supersession Supplement

Status: CANONICAL CONTINUATION OF `08F-FINDING-REGISTER-TEMPORAL-WORK-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F140.

---

## F141 — Post-purchase future work survives order cancellation/refund and executes from stale delivery-era payload

**Status:** VERIFIED CODE-LEVEL / TEMPORAL-INVALIDATION FINDING

`CommerceIntegrationService.handleOrderDelivered()` schedules `ScheduledAgentJob` rows for:

- `post_purchase_review_request`;
- `post_purchase_reorder_prompt`.

The stored payload snapshots order/customer data and can later drive customer email + CRM work.

`handleOrderCancelled()` and `handleOrderRefunded()` do not invalidate these pending jobs.

Both observed processors for these job types — `CrossModuleAgentService.processScheduledJobs()` and `CommerceIntegrationService.processPostPurchaseJobs()` — execute from the stored job payload and do not re-read current `MarketplaceOrder` state before effect.

Verified possible chain:

```text
ORDER DELIVERED
→ future review/reorder work scheduled
→ ORDER CANCELLED or REFUNDED
→ scheduled work remains PENDING
→ later worker uses stale delivery-era payload
→ review request / reorder prompt can still be produced
```

A favorable contrasting seam exists for quote follow-up: quote conversion marks pending follow-up jobs `CANCELLED`, and quote execution re-reads current quote status before effect.

Target law:

> Material delayed work must be invalidatable by relevant source-state changes and must revalidate current eligibility before the effect boundary.

Affected kernels: K6, K7, K8, K9, K11.
Affected journeys: J6, J10, J18, J23.

---

## F142 — EmailCampaign cancellation can race a claimed send and report cancellation while delivery continues

**Status:** VERIFIED CODE-LEVEL / CONCURRENCY FINDING

`EmailMarketingService.sendCampaign()` has a favorable atomic sender claim:

```text
updateMany
where status in [DRAFT,SCHEDULED]
→ SENDING
```

But `cancelSchedule()` first reads a `SCHEDULED` row and then performs a later unconditional update by campaign/business ID to `DRAFT`, without requiring the row to still be `SCHEDULED`.

Possible interleaving:

```text
cancelSchedule reads SCHEDULED
→ sendCampaign wins SCHEDULED → SENDING
→ cancelSchedule overwrites SENDING → DRAFT and returns success
→ sender continues already-claimed send path
→ campaign may later become SENT
```

Thus current persisted/user-visible cancellation can disagree with execution ownership.

Target law:

> Cancellation and execution claims must compete through expected-state transitions against the same state boundary; only one transition wins.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J9, J18, J23.

---

## F143 — ScheduledAgentJob can be marked COMPLETED while the real customer effect remains queued in a descendant notification queue

**Status:** VERIFIED CROSS-LAYER / OUTCOME-TRUTH FINDING

`TransactionalEmailService.send()` returns `QUEUED` when Gmail is unavailable and persists a `CustomerNotificationLog(status='QUEUED')`.

The post-purchase scheduled-job callers await this method but do not branch on the returned status. They then mark the originating `ScheduledAgentJob` `COMPLETED`.

Therefore current state can be:

```text
ScheduledAgentJob = COMPLETED
CustomerNotificationLog = QUEUED
external email = NOT YET SENT
```

The queued notification can be delivered later by `drainQueue()`.

Durable handoff to another queue is valid architecture; falsely collapsing handoff into effect completion is not.

Target law:

```text
COORDINATION/HANDOFF COMPLETE
!=
EXTERNAL EFFECT COMPLETE
```

and descendant work must retain causal/invalidation lineage from the originating occurrence.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J9, J10, J18, J23.

---

## F144 — Transactional email queue drain lacks atomic ownership and drops the original dedupe identity during replay

**Status:** VERIFIED CODE-LEVEL / DISTRIBUTED-RELIABILITY FINDING

`TransactionalEmailService.drainQueue()`:

```text
findMany status=QUEUED
→ no claim/CAS
→ call send(...)
→ does NOT pass entry.messageId as dedupeKey
→ on success mark original queued row DRAINED
```

`CustomerNotificationLog.messageId` has no observed uniqueness constraint in the Prisma model.

Two failure modes follow:

1. concurrent service instances can select and send the same queued row;
2. provider send can succeed and the process can crash before the original row becomes `DRAINED`; the next drain then selects it again without the original dedupe key, allowing duplicate delivery.

Target:

```text
QUEUED
→ atomic drain claim
→ effect identity preserved
→ provider effect
→ outcome/receipt
→ DRAINED/SENT terminalization
```

The queue's original semantic idempotency/effect identity must survive handoff and retry.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J10, J18, J23.

---

# Strengthened existing finding

## F123 — strengthened

F123 already established that due `ScheduledAgentJob` execution lacks atomic ownership.

The cancellation trace additionally proves the consequence for invalidation:

```text
worker reads PENDING into memory
→ invalidator writes CANCELLED
→ worker can still effect stale in-memory job
→ late unconditional COMPLETED write can overwrite cancellation
```

Do not create another finding for the same root ownership defect.

---

# Positive seams to preserve

- quote conversion explicitly cancels pending quote-followup ScheduledAgentJobs;
- quote follow-up revalidates current quote status before effect;
- EmailCampaign send path has a useful expected-state `SCHEDULED/DRAFT → SENDING` claim;
- TransactionalEmailService centralizes tenant-scoped `Contact.doNotContact` checking when contactId is supplied.

These should be generalized rather than replaced wholesale.

---

# Pool law

```text
SOURCE REALITY CHANGES
→ invalidate/supersede future work
→ cancellation competes atomically with execution ownership
→ current eligibility revalidated before effect
→ causal descendants receive invalidation
→ point-of-no-return decides cancel vs reconcile/compensate
→ history preserved
```

No production implementation is authorized by this supplement.
