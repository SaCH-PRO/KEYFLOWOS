# J23 — Cancellation, Supersession & Descendant Invalidation

Status: VERIFIED FORENSIC PASS / TARGET CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary journey: J23 Temporal Flow / Long-Running Workflow
Primary kernels: K7 Temporal/Event/Workflow, K11 Recovery/Reliability
Secondary kernels: K8 Evidence/Outcome, K9 Integration/External Reality, K3 Governance
Adjacent journeys: J6 Proactive KEY, J10 Commerce/Fulfilment, J14 External Event Ingress, J15 Approval/Governance, J18 Failure/Recovery

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

Can work that was valid when scheduled be reliably stopped, superseded or revalidated before a later effect when the underlying business reality changes?

Representative invalidators:

```text
order cancelled/refunded
quote converted
invoice paid
booking cancelled/rescheduled
customer opts out
human authority revoked
standing delegation disabled
KEY autonomy narrowed
approval expires/revokes
workflow definition changes
plan superseded
business pauses
```

The target is not deletion of history. The target is **future-effect invalidation with preserved evidence**.

---

## 2. Current Reality — Strong Positive Seam: Quote Follow-up

`CrossModuleAgentService.handleQuoteSent()` creates semantic `ScheduledAgentJob` rows for quote follow-up checkpoints.

`handleQuoteConverted()` explicitly invalidates still-pending quote follow-up jobs:

```text
ScheduledAgentJob
where businessId + quoteId + jobType=quote_followup + status=PENDING
→ status=CANCELLED
```

`executeQuoteFollowUpJob()` also re-reads current Quote state immediately before creating tasks/email:

```text
quote = find quote by business + quoteId
if !quote OR status CONVERTED/ACCEPTED
  → skip effect
```

This is an important existing seam:

```text
source-state invalidation
+
execution-time source-state revalidation
```

It should be generalized where business semantics require it.

### Limitation

The generic `processScheduledJobs()` consumer first reads due `PENDING` rows into memory, performs the effect, and only afterward writes `COMPLETED`. It has no atomic work claim and does not re-read the job status before effect.

Therefore quote cancellation is not a fully linearizable cancellation boundary; a job selected before the `PENDING → CANCELLED` write can still proceed. Quote state revalidation may save the quote-followup effect specifically, but the scheduler cancellation state itself is still raceable.

This strengthens existing F123 rather than creating a duplicate root finding.

---

## 3. Current Reality — Post-Purchase Work Survives Order Cancellation / Refund

`CommerceIntegrationService.handleOrderDelivered()` schedules two `ScheduledAgentJob` occurrences:

```text
post_purchase_review_request
  checkpoint=review_request
  scheduled ~3 days later

post_purchase_reorder_prompt
  checkpoint=reorder_prompt
  scheduled ~30 days later
```

The stored payload snapshots customer/order details including email/name/order number/products.

### Order cancellation

`handleOrderCancelled()` logs CRM history and creates a cancellation notification.

No mutation of the associated `ScheduledAgentJob` review/reorder rows was observed.

### Order refund

`handleOrderRefunded()` records CRM/refund expense/notification effects.

No mutation of associated review/reorder `ScheduledAgentJob` rows was observed.

### Execution paths

Two current processors can consume these jobs:

1. `CrossModuleAgentService.processScheduledJobs()`;
2. `CommerceIntegrationService.processPostPurchaseJobs(businessId)`.

Both post-purchase execution paths operate from the stored job payload and do not re-read the current `MarketplaceOrder` state before sending the review/reorder email or creating the CRM task.

Verified possible chain:

```text
ORDER DELIVERED
→ review/reorder future work scheduled
→ ORDER CANCELLED or REFUNDED
→ scheduled work remains PENDING
→ due worker uses stale delivery-era payload
→ review request / reorder prompt can still be produced
```

This is F141.

---

## 4. Current Reality — ScheduledAgentJob Cancellation Is Not Dominance-Safe

Model shape:

```text
ScheduledAgentJob
  jobType
  entityId
  checkpoint
  status default PENDING
  payload
  scheduledFor
  executedAt
  UNIQUE(businessId, entityId, checkpoint)
```

No claim owner, claim token, lease/version or expected-state completion field is present.

Generic consumption pattern:

```text
findMany(status=PENDING, scheduledFor<=now)
→ hold row in process memory
→ external/domain effect
→ update id => COMPLETED
```

Thus an invalidator can race a selected worker:

```text
T1 worker reads PENDING job J
T2 cancellation writes J=CANCELLED
T1 executes in-memory J
T1 update(id=J) => COMPLETED
```

The late completion write has no `where status=<claimed-state>` precondition and can overwrite cancellation.

This is a concrete strengthening of F123:

> Scheduled-intent uniqueness is not execution ownership, and cancellation also requires an ownership/linearization boundary.

---

## 5. Current Reality — EmailCampaign Cancellation Can Race a Claimed Send

`EmailMarketingService.sendCampaign()` has a favorable atomic sender claim:

```text
updateMany
where status in [DRAFT,SCHEDULED]
→ status=SENDING
```

Only the winner proceeds.

However `cancelSchedule()` is read-then-write:

```text
findFirst(status=SCHEDULED)
→ later update by id/business only
→ status=DRAFT, scheduledAt=null
→ return cancellation success
```

The update does not require the row still be `SCHEDULED`.

Verified race:

```text
T1 cancelSchedule reads SCHEDULED
T2 sendCampaign CAS wins SCHEDULED → SENDING
T1 cancelSchedule overwrites SENDING → DRAFT
T1 returns successful cancellation
T2 continues the already-claimed send path
T2 may deliver and later write SENT
```

Thus cancellation can appear successful after the sender has crossed the execution ownership boundary.

This is F142.

Target improvement should preserve the strong sender CAS and make cancellation compete with it atomically:

```text
cancel:
  SCHEDULED → CANCELLED/DRAFT only if still SCHEDULED

send:
  SCHEDULED → SENDING only if still SCHEDULED

exactly one transition wins
```

If `SENDING` already won, the UI/API must not promise guaranteed cancellation.

---

## 6. Current Reality — A Completed Scheduled Job Can Still Have a Pending Customer Effect

`TransactionalEmailService.send()` behaves differently when Gmail is not connected:

```text
create CustomerNotificationLog(status=QUEUED, templateData=..., messageId=dedupeKey)
→ return { status: QUEUED }
```

Both post-purchase scheduled-job callers await this method but do not inspect its returned status.

They then write:

```text
ScheduledAgentJob.status = COMPLETED
executedAt = now
```

Therefore:

```text
ScheduledAgentJob = COMPLETED
while
CustomerNotificationLog = QUEUED
and
external email effect has not occurred
```

`TransactionalEmailService.drainQueue()` may deliver the email later when Gmail becomes connected.

This is F143.

The problem is not that one component queues another. Durable handoff is legitimate. The defect is loss of semantic lineage:

```text
UPSTREAM COORDINATION COMPLETED
!=
DOWNSTREAM EFFECT COMPLETED
```

Cancellation/supersession of the originating business work is not propagated into the descendant queued notification.

---

## 7. Current Reality — Transactional Email Drain Is Not Atomically Owned and Loses Original Dedupe Identity

`drainQueue()`:

```text
findMany CustomerNotificationLog(status=QUEUED)
→ no claim/CAS
→ for each entry call send(...)
→ original dedupeKey/messageId is NOT passed to send()
→ on send success mark original row DRAINED
```

The schema has indexes on business/time/type/status but no observed uniqueness constraint on `messageId`.

### Concurrent drain risk

Multiple service instances can read the same QUEUED row before either changes its state and both may send it.

### Crash-window replay risk

```text
queued row Q selected
→ provider send succeeds
→ send() writes separate SENT log
→ process crashes before Q → DRAINED
→ next drain selects Q again
→ original dedupe identity is not passed
→ provider send can repeat
```

This is F144.

This is not solved by the original `send()` dedupe lookup because drain does not pass the queued row's `messageId` back as `dedupeKey`.

---

## 8. Contact Suppression — Favorable but Not Full Source-State Revalidation

`TransactionalEmailService.send()` centralizes a favorable tenant-scoped `Contact.doNotContact` check when `contactId` is present.

Therefore this pass does **not** conclude that every delayed post-purchase email ignores contact opt-out.

However:

- the check is conditional on having `contactId`;
- it does not revalidate the originating order state;
- queued notification descendants do not carry an explicit originating WorkOccurrence/cancellation reference;
- review/reorder work can therefore remain stale even when contact suppression is handled correctly.

Consent/marketing-opt-in policy remains a separate J21/J9/J10 communication-policy question and should not be silently collapsed into J23.

---

## 9. Target Cancellation / Supersession Contract

### Core law

```text
CANCELLATION INTENT
!=
DELETION
```

Cancellation is a governed state transition over future effect rights.

### Target state logic

```text
                     cancel/supersede
                           │
                           ▼
SCHEDULED / WAITING / ELIGIBLE
  ── expected-state CAS ──→ CANCELLED / SUPERSEDED
                           │
                           └→ no new worker/effect claim permitted

WORKER_CLAIMED but no ExecutionClaim
  → cancellation request becomes visible
  → final current-state revalidation
  → ExecutionClaim denied if invalidated
  → terminal CANCELLED/SUPERSEDED

ExecutionClaim already acquired / provider call underway
  → do NOT promise guaranteed cancellation
  → CANCEL_REQUESTED / TOO_LATE / OUTCOME_UNKNOWN as appropriate
  → reconcile provider/domain reality
  → compensate only where safe and semantically valid
```

`CANCEL_REQUESTED` is a command/intermediate condition, not proof the effect was prevented.

### Causal descendant propagation

An originating occurrence may create descendant durable work:

```text
ScheduledAgentJob O
→ CustomerNotificationLog Q
→ provider request P
```

Target lineage:

```text
O occurrenceId
  └─ Q parentOccurrenceId / actionFingerprint / invalidationRef
       └─ P ExecutionClaim / OutcomeEvidence
```

A cancellation/supersession of O must be able to prevent all not-yet-effective descendants whose semantics are invalidated.

Do not rely on recursively deleting evidence.

---

## 10. Execution-Time Eligibility Revalidation

A long delay makes captured assumptions stale by definition.

Before a material future effect, derive a current eligibility decision from authoritative state.

Candidate contract:

```yaml
eligibility:
  occurrence_id: ...
  action_fingerprint: ...
  source_entity_refs: []
  source_state_version: ...
  authority_version: ...
  policy_version: ...
  control_ref: ...
  consent/contact_policy_ref: ...
  evaluated_at: ...
  verdict: ELIGIBLE|CANCELLED|SUPERSEDED|REQUIRES_RECONTROL|OUTCOME_UNKNOWN
  reason: ...
```

The exact fields vary by capability; do not force irrelevant metadata into every action.

Examples:

```text
review request:
  order still qualifies for post-purchase review
  + contact/channel policy permits outreach

invoice reminder:
  invoice still unpaid/overdue

booking reminder:
  booking still active and time still relevant

autonomous KEY effect:
  current human/standing authority + KEY autonomy still permits exact action
```

---

## 11. Point-of-No-Return Semantics

External reference properties reinforce the target:

- BullMQ official documentation states locked/active jobs cannot simply be removed, while waiting/delayed work can be removed/drained.
- Camunda exposes cancellation as an explicit running-process operation and distinguishes it from deletion of finished process history.

Adopted property:

> **Cancellation must have an explicit linearization/point-of-no-return boundary.**

Do not tell a user "cancelled" if the system has already committed to an effect that cannot reliably be recalled.

Product projection can remain simple:

```text
Cancelled
Cancelling…
Too late to cancel — sending/processing
Needs verification
Reversed/compensated
```

Internal semantics stay richer than UI wording.

References:

- https://docs.bullmq.io/guide/jobs/removing-job
- https://docs.bullmq.io/guide/queues/removing-jobs
- https://docs.camunda.io/docs/next/apis-tools/orchestration-cluster-api-rest/specifications/cancel-process-instance/
- https://docs.camunda.io/docs/next/components/concepts/process-instance-deletion/

---

## 12. Findings / Contradictions Produced

New findings:

- F141 post-purchase future work survives order cancellation/refund and executes from stale payload;
- F142 EmailCampaign cancellation can race/overwrite a claimed SENDING state and return success while send continues;
- F143 ScheduledAgentJob can be COMPLETED while descendant customer notification remains QUEUED;
- F144 TransactionalEmail queue drain lacks atomic ownership and drops original dedupe identity during drain replay.

Strengthened existing finding:

- F123 ScheduledAgentJob execution lacks atomic ownership; now additionally proven to make cancellation non-dominant after due-row selection.

New contradictions:

- C092 current cancelled/refunded business state vs still-executable stale future outreach;
- C093 reported cancellation vs already-claimed campaign send;
- C094 upstream work completion vs downstream effect still queued;
- C095 retryable queued notification vs lost original dedupe/effect identity.

---

## 13. Target Recommendations Produced

- KF-REC-042 first-class cancellation/supersession + causal descendant invalidation;
- KF-REC-043 execution-time eligibility revalidation for material delayed work;
- KF-REC-044 durable causal handoff: descendant queues inherit occurrence/action/invalidation/effect identity and upstream state distinguishes handoff from effect completion.

Existing KF-REC-027 atomic ExecutionClaim and KF-REC-040 logical-vs-attempt state separation remain directly applicable; do not create duplicate recommendations for atomic ownership.

---

## 14. Open Questions

1. Product semantics when a user disables a workflow definition: cancel all pending occurrences, allow already-created occurrences, or policy-dependent?
2. Which scheduled work classes are cancellable vs immutable obligations?
3. What is the correct compensation model after external effects that cannot be recalled?
4. Should post-purchase review remain valid after partial refund but not full refund? This is domain policy, not assumed here.
5. Which provider sends support cancellation after request acceptance, if any?
6. Which existing rows can carry parent occurrence/invalidation lineage without a common WorkOccurrence table?
7. How should workflow definition/version supersession affect waiting occurrences?

---

## 15. Proof Requirements

Before execution-readiness:

- cancellation and worker claim racing the same scheduled row have exactly one winner;
- a selected-but-not-effected job cannot ignore a winning cancellation;
- order cancellation/full-refund prevents policy-defined post-purchase outreach;
- execution-time revalidation blocks stale source-state effects even when explicit invalidation event was missed;
- cancelling a scheduled campaign cannot return success if sender claim already won;
- queued notification handoff remains linked to originating occurrence;
- crash after provider success but before local queue finalization cannot duplicate delivery;
- multiple queue-drain replicas cannot send the same queued notification;
- cancellation never deletes historical evidence;
- effects past the point of no return enter explicit reconciliation/compensation semantics rather than false `CANCELLED`.

No tests were executed in this forensic pass.
