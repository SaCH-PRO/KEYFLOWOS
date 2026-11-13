# J23 + J18 — Live-Row Migration Compatibility Map

Status: ACTIVE L6 MIGRATION SYNTHESIS / PRODUCTION CODE READ-ONLY
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Depends on:

- `J23-J18-L6-UNIFIED-CONVERGENCE-MATRIX.md`
- `J23-J18-L6-EXACT-FIELD-STATUS-MAPPING.md`

> This document defines how existing live rows can coexist with the target semantic contract. It does not authorize migrations or production implementation.

---

## 1. Migration prime directive

```text
DO NOT REWRITE RAW STATUS FIRST.
```

Current code contains exact string readers/writers with materially different semantics. A destructive enum/status rewrite before consumer migration would break production behavior and would still not resolve ambiguity.

Target migration pattern:

```text
CURRENT SOURCE ROW
+ companion source fields
+ provider/domain evidence
+ source-specific semantic adapter
→ normalized temporal/recovery dimensions
→ derivative projection
```

Only after readers/writers converge should physical status cleanup be reconsidered.

---

## 2. Historical certainty policy

Every row classification must be one of:

```text
PROVEN
DERIVABLE
AMBIGUOUS
UNRECOVERABLE_UNKNOWN
```

### PROVEN

Direct evidence proves the target state.

Examples:

- ScheduledAgentJob PENDING with future scheduledFor proves not-yet-due local work;
- WebhookEvent proves provider occurrence was seen/claimed;
- FinancialTransaction POSTED proves the accounting transaction exists;
- SocialPost deletedAt proves local row was soft-deleted.

### DERIVABLE

Current status + companion evidence allows target derivation.

Examples:

- OutboundDelivery Published + provider operation ID/result snapshot;
- Payment REFUNDED + matching reversal transaction + reconciled invoice;
- SocialPost POSTED + publishResults per destination.

### AMBIGUOUS

Multiple target realities fit the same current value.

Examples:

- AiPlanStep executing;
- AiPlanStep failed;
- OutboundDelivery Sending/Failed/RetryPending;
- ScheduledAgentJob COMPLETED/FAILED;
- Payment FAILED/PENDING;
- SocialPost POSTED aggregate without sufficient per-provider evidence.

### UNRECOVERABLE_UNKNOWN

Evidence required to distinguish outcomes no longer exists.

Target handling:

```text
preserve raw source truth
→ project UNKNOWN / historical ambiguity
→ do not fabricate success/failure
→ require manual/provider reconciliation only if current business value justifies it
```

---

## 3. Compatibility phases

### M0 — Characterization only

- inventory exact statuses/fields/writers/readers;
- no schema/production behavior change;
- create fixtures/tests for current behavior.

Current programme is here analytically.

### M1 — Semantic adapters / read projection

Introduce source-specific mapping logic conceptually:

```text
AiPlanTemporalAdapter
OutboundDeliveryTemporalAdapter
ScheduledAgentJobTemporalAdapter
WebhookIngressAdapter
FinancialTruthAdapter
SocialPublicationAdapter
```

Names are illustrative, not authorization to create new classes.

Adapters emit normalized dimensions but do not own source truth.

### M2 — Add missing identity/evidence at write boundaries

Additive, bounded improvements where migration/proof justifies:

- EffectId / attempt linkage;
- provider idempotency token;
- provider operation ID;
- outcome certainty/evidence linkage;
- recovery effect linkage;
- consequence-incomplete evidence;
- definition/version binding;
- cancellation/supersession/lateness fields where source currently lacks them.

Keep legacy statuses unchanged during compatibility window.

### M3 — Dual-read / semantic-reader migration

Move product/operator/KEY consumers from raw status interpretation toward semantic adapters/projection.

Legacy executors can still consume old status values until their bounded packet migrates them.

### M4 — Historical backfill / classification

For each live row:

```text
AUTO-MAP if proven
ELSE evidence lookup if bounded/cost-effective
ELSE target UNKNOWN while preserving source value
```

No guessed terminality.

### M5 — Writer convergence

Once semantic readers are stable, migrate writers to produce consistent lifecycle/evidence semantics while retaining compatibility fields as needed.

### M6 — Optional physical cleanup

Only after consumer proof:

- retire obsolete status dialects;
- consolidate redundant fields;
- tighten enums/constraints;
- reconsider common persistence.

---

# 4. AiPlan / AiPlanStep migration

## 4.1 Legacy readers that must remain compatible initially

Current readers depend on raw strings such as:

```text
AiPlan: approved, executing, completed, failed, partial, draft
AiPlanStep: pending, executing, awaiting_approval, completed, failed, skipped
```

KeyCortex additionally writes/reads:

```text
running
waiting_approval
```

Do not normalize source strings in-place before these readers migrate.

## 4.2 Backfill classification

### AiPlanStep pending

```text
if scheduledAt > migration/evaluation time
→ DERIVABLE WAITING_TIME/SCHEDULED

else if unresolved dependsOn
→ DERIVABLE AWAITING_DEPENDENCY

else
→ ELIGIBLE_CANDIDATE, not CLAIMED
```

Eligibility still requires current authority/source/version/lateness checks at execution time.

### AiPlanStep executing

Historical classification:

```text
BullMQ job active/failed/completed evidence available
→ derive transport attempt state

no transport evidence + outputResult/completedAt absent
→ AMBIGUOUS / possibly enqueued, stalled, lost
```

Do not map automatically to RUNNING.

### AiPlanStep awaiting_approval / waiting_approval

Auto-normalize only in projection:

```text
→ AWAITING_CONTROL
```

Keep source dialect string intact while legacy readers exist.

### AiPlanStep completed

```text
local/domain effect whose output proves terminal effect
→ DERIVABLE SUCCEEDED

external effect / queue handoff
→ inspect provider/child OutcomeEvidence
```

Preserve terminal child state during parent resume.

### AiPlanStep failed

Evidence resolution order:

```text
1 BullMQ attempts remaining / historical job state
2 AiExecutionLog result + idempotency key
3 provider/domain operation evidence
4 cancellation/supersession/version/source state
```

Then map to:

```text
RETRYING
FAILED_FINAL
OUTCOME_UNKNOWN
CANCELLED
SUPERSEDED
```

If evidence unavailable → UNKNOWN.

## 4.3 Parent plan migration

Do not treat AiPlan parent as one atomic work occurrence when child effects differ.

Projection can expose:

```text
parent aggregate status
+ child normalized work/effect states
```

`partial` remains a useful parent aggregate, not a target child state.

---

# 5. ActionDispatcher / AiExecutionLog migration

## 5.1 Preserve current log as immutable/history evidence

Do not rewrite old `success` Boolean.

Add/derive normalized interpretation alongside it.

## 5.2 Historical success=true

Classifier requires tool family:

```text
pure local/domain transaction with returned committed entity
→ probable/proven local effect success

external provider call
→ provider acceptance/effect classification from tool/provider evidence

queue/handoff tool
→ handoff success only, not business outcome
```

## 5.3 Historical success=false

Never auto-final.

Check:

```text
queue attempts / retry budget
error class
provider operation evidence
idempotency key history
source work state
```

If failure occurred after possible provider PONR and no reconciliation evidence → OUTCOME_UNKNOWN.

## 5.4 Idempotency compatibility

Old idempotency keys must remain queryable during migration.

But new semantic logic must not interpret an old failed log as successful consumption of the effect identity.

Compatibility decision:

```text
success=true + matching request fingerprint
→ duplicate effect prevention candidate

success=false
→ attempt history, not automatic terminal effect tombstone
```

Old rows lacking request fingerprint remain weaker evidence.

---

# 6. OutboundDelivery / DeliveryEvent migration

## 6.1 Preserve raw statuses

Scheduler currently depends on:

```text
Queued|Scheduled
RetryPending
Sending
```

Do not rewrite them until worker migration.

## 6.2 Backfill algorithm

### Queued / Scheduled

```text
no sentAt/external ID/events implying attempt
→ NOT_ATTEMPTED
→ SCHEDULED/ELIGIBLE based on scheduledAt
```

### Sending

Evidence order:

```text
DeliveryEvent attempt/success/failure
resultSnapshot
externalPostId/externalUrl
provider API/status lookup where available
```

Possible mappings:

```text
no provider attempt evidence → abandoned claim / retry candidate after ownership policy
possible provider effect → OUTCOME_UNKNOWN
provider success evidence → SUCCEEDED_CONFIRMED + consequence incomplete if source row did not advance
```

### RetryPending

Do not retain automatic retry authority solely from raw status.

Migration classifier must first prove prior attempt did not create an uncertain/confirmed provider effect.

### Failed

```text
provider-declared non-effect/rejection
→ FAILED_FINAL or retryable according policy

transport timeout/ambiguous
→ OUTCOME_UNKNOWN

F159 post-provider local failure
→ SUCCEEDED_CONFIRMED + CONSEQUENCE_INCOMPLETE
```

### Published / Sent

Preserve as source provider-layer success.

Do not automatically infer delivery/read/settlement/business outcome.

## 6.3 DeliveryEvent compatibility

DeliveryEvent attemptNumber/resultData becomes valuable historical attempt evidence.

Do not rewrite old events; link/interpret them in semantic projection.

---

# 7. ScheduledAgentJob migration

## 7.1 Preserve poller vocabulary

Poller requires raw `PENDING`.

Cancellation paths use raw `CANCELLED`; terminal paths use `COMPLETED|FAILED`.

## 7.2 Backfill

### PENDING

```text
future scheduledFor
→ SCHEDULED

due/overdue
→ evaluate lateness/misfire + source state + cancel/supersede + handler validity
→ ELIGIBLE | EXPIRED | CANCELLED | SUPERSEDED | needs review
```

Do not assume every overdue job remains valid.

### COMPLETED

Evidence required:

- was jobType handled?
- was the effect local or a downstream handoff?
- is descendant/customer effect terminal?

If unknown job type under historical false-completion path → not proven success.

### FAILED

Handler/effect-specific evidence decides retryability/finality/unknown.

No generic requeue from migration.

### CANCELLED

If row never attempted → strong cancellation evidence.

If external/descendant effect may already have occurred → preserve cancellation of future work separately from original outcome.

## 7.3 Missing identity

Do not synthesize stable EffectId from payload hash alone without proving old semantic equivalence.

Use existing row ID/checkpoint/source identity as historical lineage, with `legacy_effect_identity_unknown` where necessary.

---

# 8. WebhookEvent migration

## 8.1 Existing rows

Every row proves:

```text
provider occurrence ID was claimed/seen
```

Nothing more universally.

Migration projection:

```yaml
seen: true
processing_outcome: unknown|derived_applied|derived_failed
source_event_id: WebhookEvent.id
```

## 8.2 Selective financial reconstruction

For high-value payment/refund events:

```text
providerEventId/eventType
+ provider payment/refund IDs
+ Payment rows
+ FinancialTransaction externalRef
+ invoice balance
```

may derive APPLIED/CONSEQUENCE_INCOMPLETE.

Do not perform broad historical provider API scans unless business value/compliance justifies cost and rate-limit exposure.

## 8.3 New processing lifecycle compatibility

If an additive processing state is introduced later, legacy rows should default to something equivalent to:

```text
LEGACY_SEEN_OUTCOME_UNKNOWN
```

rather than APPLIED.

---

# 9. Payment / Finance migration

## 9.1 Preserve accounting history

Never rewrite ledger history to make projection look clean.

Migration fixes missing consequences with new idempotent repair/reversal evidence where accounting semantics require it.

## 9.2 Payment classifier

### SUCCESSFUL

Check:

```text
provider identity / manual evidence
matching financial posting where required
invoice/order reconciliation
```

Then:

```text
original_outcome = SUCCEEDED_CONFIRMED
consequence_state = COMPLETE | INCOMPLETE
```

### REFUNDED

Check:

```text
provider refund ID / local refund type
FinancialTransaction REVERSAL or equivalent posting
invoice/order balance after refund
```

Then classify recovery outcome and consequence completeness independently.

### FAILED

Provider lookup/event evidence first for external methods.

Never mass-map to final provider failure because F158 proves the opposite can occur.

### PENDING

Classify as:

```text
awaiting provider/customer action
manual receivable pending
local bookkeeping retry flag
or unknown legacy
```

based on provider/method/reference/related workflow.

No generic execution semantics.

## 9.3 Invoice classifier

Invoice statuses stay domain truth but must be consistency-checked against balance consequences.

Migration does not automatically change an invoice status solely from a target projection. Reconciliation service remains domain owner.

## 9.4 FinancialTransaction repair identity

`(businessId, externalRef)` is a strong current idempotency seam for missing posting repair.

`reversalOfId` is strong reversal lineage.

Use these rather than creating parallel ledger recovery identities.

---

# 10. SocialPost migration

## 10.1 DRAFT/SCHEDULED

Preserve current source values while semantic projection derives scheduled work.

## 10.2 POSTED

Parse `publishResults` into per-provider artifacts.

Classification:

```text
result.success=true + provider ID
→ provider effect success proven at publication layer

result.success=false + explicit provider rejection
→ failure evidence

transport-like error without provider lookup
→ outcome may remain unknown
```

Top-level externalPostId/externalUrl represents only first success and cannot be used as the entire multi-provider effect set.

## 10.3 deletedAt

Always preserve as local-record lifecycle only.

For rows that were POSTED before deletion:

```text
provider reversal state = UNKNOWN unless provider-specific deletion evidence exists
```

Do not backfill “deleted externally” from local deletedAt.

---

# 11. Legacy reader / writer compatibility table

| Source | Current critical readers | Compatibility requirement |
|---|---|---|
| AiPlan/AiPlanStep | PlanExecutor, QueueService, KeyCortex Planner, UI/diagnostics | preserve exact raw strings until every execution reader migrated |
| AiExecutionLog | ActionDispatcher idempotency, diagnostics/action queue | preserve log rows/key lookup while changing terminality semantics carefully |
| OutboundDelivery | DeliveryQueue scheduler, content-status aggregator, operator retry APIs | keep Queue/Scheduled/RetryPending/Sending vocabulary during worker migration |
| ScheduledAgentJob | 60s poller + domain cancellation writers | PENDING must remain consumable until claim/worker migration lands |
| WebhookEvent | payment ingress dedupe | unique occurrence claim must remain stable while adding processing lifecycle |
| Payment | invoice balance, payments UI, provider webhook dedupe, finance | status strings cannot be repurposed as recovery states |
| FinancialTransaction | ledger/reporting/reconciliation | immutable/accounting semantics take precedence over migration convenience |
| SocialPost | scheduling UI, publishing service, social feed | DRAFT/SCHEDULED/POSTED/FAILED/deletedAt remain compatibility source during projection migration |

---

# 12. Migration safety invariants

1. raw source evidence is preserved until consumer migration is proven;
2. historical ambiguity maps to UNKNOWN, not guessed terminality;
3. migration never repeats an external effect to discover whether it happened;
4. provider lookup/reconciliation is preferred to unsafe replay;
5. completed child work is never reset merely to normalize parent state;
6. local delete never backfills external reversal;
7. financial repair never edits away accounting evidence;
8. webhook occurrence identity remains stable while processing lifecycle evolves;
9. legacy status readers remain supported during dual-read transition;
10. every backfill is restartable/idempotent and emits classification evidence;
11. tenant isolation applies to every mapping/backfill query;
12. projection failure/degradation cannot overwrite domain source truth.

---

# 13. Backfill decision record shape

For any migration/backfill that materializes classification, retain enough evidence to explain the decision:

```yaml
source_type: AiPlanStep
source_id: ...
source_status: failed
classification_version: ...
classified_at: ...
target_dimensions:
  work_state: OUTCOME_UNKNOWN
  original_outcome: OUTCOME_UNKNOWN
  consequence_state: UNKNOWN
classification_basis:
  - ai_execution_log: ...
  - provider_lookup: unavailable
confidence: high|medium|low
manual_review_required: true|false
```

This may be migration tooling/log evidence rather than a permanent universal table; persistence choice remains L6-specific.

---

# 14. Rollback / reversibility

Because early migration should be projection/additive:

```text
rollback
→ stop using semantic projection/new fields
→ legacy raw rows remain intact
```

Avoid irreversible mass status rewrites in initial waves.

For later writer convergence, every bounded KF-EXEC packet must state:

- legacy reader behavior;
- dual-write window;
- rollback behavior;
- backfill reversibility;
- proof that old consumers no longer depend on retired values.

---

# 15. Data-volume / production-query dependency

This architecture pass did **not** query production row counts/distributions.

Before an execution migration packet, obtain safe operational evidence for:

```text
count by raw status/source
age distribution of nonterminal rows
number of historical ambiguous rows
provider-ID coverage
publishResults coverage
Payment/reference/ledger linkage coverage
WebhookEvent volume/age
```

Those counts affect migration mechanics/cost, not the semantic target.

Do not infer them from source code.

---

# 16. Migration verdict

The live-row strategy is now bounded enough to reject two unsafe approaches:

```text
UNSAFE: mass rename/replace current statuses into one new enum
UNSAFE: create a new universal work/recovery table and blindly backfill terminality
```

Preferred direction:

```text
preserve source rows
→ source-specific semantic adapters
→ additive identity/evidence at future write boundaries
→ derivative Temporal Work Projection
→ conservative historical classification
→ reader migration
→ writer convergence
→ optional physical cleanup only after proof
```

Next frontier:

> **Provider Contract / Idempotency / Reconciliation Matrix**, followed by exact recovery-authority representation and Temporal Work Projection materialization/proof design.

No runtime tests, production migrations or production-data queries were executed in this pass.
