# J23 + J18 — Exact Current → Target Field / Status Mapping

Status: ACTIVE L6 P0 MAPPING / MIGRATION INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Parent convergence artifact: `J23-J18-L6-UNIFIED-CONVERGENCE-MATRIX.md`

> This document maps current persisted fields and observed writers/readers onto the unified temporal/recovery dimensions. It is deliberately conservative: ambiguous historical state maps to evidence lookup or UNKNOWN rather than invented certainty. No production implementation is authorized.

---

## 1. Mapping classes

```text
AUTO_MAP
  current field/value is semantically strong enough to derive target dimension

CONDITIONAL_MAP
  current value maps only with companion fields/evidence

EVIDENCE_LOOKUP
  provider/domain/attempt evidence must be inspected

UNKNOWN_IF_HISTORICAL
  historical row lacks enough evidence to classify safely

SOURCE_ONLY
  retain as raw source evidence; do not promote directly into target truth
```

Universal migration rule:

> **Never invent certainty.**

---

# 2. AiPlan / AiPlanStep + BullMQ

## 2.1 Current schema

### AiPlan

Persisted fields verified in Prisma include:

```text
id
businessId
userId
status                String default "draft"
objective
rawInput
urgency                default "normal"
scope[]
modules[]
maxRiskTier             default 1
role
journeyInstanceId
goalId
steps[]
startedAt?
completedAt?
createdAt
updatedAt
```

### AiPlanStep

Persisted fields include:

```text
id
planId
order                   default 0
status                  String default "pending"
toolName?
module?
action
description?
riskTier                default 1
requiresApproval        default false
role?
journeyStepIndex?
dependsOn[]
inputPayload?
outputResult?
expectedBenefit?
errorMessage?
durationMs?
scheduledAt?
startedAt?
completedAt?
createdAt
```

BullMQ `ai-plan-steps` is external transport state, not represented as dedicated fields on AiPlanStep.

Queue job identity:

```text
jobId = plan-step idempotencyKey
idempotencyKey = `plan:${planId}:step:${stepId}` in PlanExecutor path
attempts = retryCount + 1
backoff = exponential 2000ms
worker concurrency = 5
stalledInterval = 30s
maxStalledCount = 2
```

## 2.2 Observed status dialects

### AI Planner / PlanExecutor dialect

AiPlan:

```text
draft
approved
executing
completed
partial
failed
```

AiPlanStep:

```text
pending
executing
awaiting_approval
completed
failed
skipped
```

Important transport compression:

`PlanExecutorService` writes `AiPlanStep.status='executing'` immediately after successful **enqueue**, before the BullMQ worker actually executes the tool.

Therefore:

```text
AiPlanStep.executing
!= reliably RUNNING
```

It can mean “durably queued/enqueued”.

### KeyCortex planner dialect on the same tables

AiPlan:

```text
draft
running
waiting_approval
completed
failed
```

AiPlanStep:

```text
pending
running
waiting_approval
completed
failed
skipped
```

This parallel dialect is another manifestation of F140 logical/transport state compression; do not create a duplicate root finding.

## 2.3 Current readers / semantic consumers

- `PlanExecutorService` polls AiPlan where status in `approved|executing`.
- It skips AiPlanStep values `completed|failed|skipped|executing|awaiting_approval` during enqueue.
- It treats dependencies as satisfied only when dependency step is `completed`.
- It computes parent final status from children using `completed|failed|skipped|awaiting_approval`, then parent `completed|partial|failed`.
- `QueueService` independently writes step `completed|failed|awaiting_approval` and parent `completed`.
- KeyCortex Planner independently writes `running|waiting_approval|completed|failed`.
- diagnostics/action queue surfaces inspect plan status for user/operator display.

## 2.4 Current → target status mapping

### AiPlan parent

| Current | Target | Class | Notes |
|---|---|---|---|
| `draft` | not yet a single execution state; planning/definition state | SOURCE_ONLY | may contain pending planned child occurrences |
| `approved` | children may become `ELIGIBLE` | CONDITIONAL_MAP | approval != Clearance; temporal/source eligibility still required |
| `executing` | parent active | CONDITIONAL_MAP | child states decide actual work; not proof any worker is running |
| `running` | parent active | CONDITIONAL_MAP | KeyCortex dialect |
| `waiting_approval` | parent `AWAITING_CONTROL` | CONDITIONAL_MAP | only if durable children corroborate; F153 shows stale-parent defect |
| `completed` | parent terminal candidate | EVIDENCE_LOOKUP | must prove required child/effect outcomes; workflow completion != business outcome |
| `partial` | composite mixed terminality | SOURCE_ONLY | target projection should expose children, not force one WorkOccurrence terminal state |
| `failed` | failure candidate | EVIDENCE_LOOKUP | may reflect transient attempt/control-wait/recovery defects |

### AiPlanStep

| Current | Target work_state | Class | Companion evidence |
|---|---|---|---|
| `pending` + future scheduledAt | `SCHEDULED/WAITING_TIME` | AUTO_MAP for timing, subject to version/lateness policy | scheduledAt |
| `pending` + unmet dependency | `AWAITING_DEPENDENCY` | CONDITIONAL_MAP | dependsOn current durable child states |
| `pending` + no wait/dependency | `ELIGIBLE` candidate | CONDITIONAL_MAP | authority/source state/claim absent |
| `executing` | `ELIGIBLE/CLAIMED/RUNNING` unknown | UNKNOWN_IF_HISTORICAL | written after enqueue, before actual worker execution |
| `running` | `RUNNING` candidate | CONDITIONAL_MAP | KeyCortex writes before direct executor; crash may leave stale row |
| `awaiting_approval` | `AWAITING_CONTROL` | AUTO_MAP semantically | existing dialect |
| `waiting_approval` | `AWAITING_CONTROL` | AUTO_MAP semantically | KeyCortex dialect |
| `completed` | `SUCCEEDED` candidate | EVIDENCE_LOOKUP | output/effect evidence; external outcome may still be pending |
| `failed` | `RETRYING | FAILED_FINAL | OUTCOME_UNKNOWN` | EVIDENCE_LOOKUP | BullMQ attempts, AiExecutionLog, provider evidence |
| `skipped` | `CANCELLED | SUPERSEDED | FAILED_FINAL dependency consequence` | EVIDENCE_LOOKUP | errorMessage/reason required |

## 2.5 Identity mapping

```text
AiPlan.id          → parent WorkflowInstance / parent occurrence candidate
AiPlanStep.id      → stable child work identity candidate
BullMQ jobId       → transport job identity
plan-step key      → existing EffectId candidate ONLY after request-fingerprint semantics are fixed
BullMQ attempt     → AttemptId conceptually, but attempt evidence is not currently persisted onto AiPlanStep
```

Do not treat BullMQ job ID alone as business EffectId proof.

## 2.6 Live-row compatibility

```text
failed             → evidence lookup
executing          → unknown active-vs-queued-vs-stale
completed          → preserve terminal child; verify outcome class
waiting_approval   → normalize to AWAITING_CONTROL projection
awaiting_approval  → normalize to AWAITING_CONTROL projection
partial            → retain parent aggregate; derive child work rows separately
```

Do not mass-rewrite old status strings before every reader is adapted.

---

# 3. ActionDispatcher / AiExecutionLog

## 3.1 Current schema

AiExecutionLog persisted fields include:

```text
id
businessId
userId?
action
toolName?
module?
riskTier             default 1
mode                 default "assisted"
actor                default "user"
rationale?
inputSummary?
outputSummary?
success              Boolean default true
errorMessage?
durationMs?
planId?
planStepId?
toolResult?
nextStepSuggested?
replanRequired        default false
role?
idempotencyKey?       unique
createdAt
sessionId?
commandId?
correlationId?
```

Important limitation: `success` is one Boolean over potentially many failure/outcome classes.

## 3.2 Dispatcher current execution fields

`DispatchContext` carries:

```text
businessId
toolName
args
idempotencyKey?
planId?
planStepId?
source?
retryCount?
background?
```

Dispatcher:

- uses process-local circuit state;
- performs inline retries with delays 1s/3s by default;
- invokes `FlowOrchestratorService.executeToolDirectly()`;
- logs successful or exhausted-failure execution in AiExecutionLog;
- idempotency lookup searches latest AiExecutionLog by `(businessId, idempotencyKey)` and returns its stored success/failure result.

## 3.3 Current → target mapping

### AiExecutionLog.success = true

Target classification:

```text
original_outcome = SUCCEEDED_CONFIRMED
```

ONLY for effects whose called tool result itself proves the required domain effect.

For external/provider effects:

```text
success=true
→ ATTEMPT RETURNED SUCCESS
→ EVIDENCE_LOOKUP for provider/business outcome
```

It may mean provider accepted, not delivered/settled/business outcome.

Class: `CONDITIONAL_MAP`.

### AiExecutionLog.success = false

Must not auto-map to FAILED_FINAL.

Possible target classes:

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
OUTCOME_UNKNOWN
CONTROL/POLICY DENIAL represented outside effect attempt
```

Class: `EVIDENCE_LOOKUP`.

### idempotencyKey

Preserve as existing identity evidence.

Current schema global uniqueness and dispatcher lookup semantics are not yet the accepted target ExecutionClaim contract.

Mapping:

```text
idempotencyKey
→ candidate EffectId / effect-dedupe key
→ requires request hash/fingerprint + explicit terminality semantics
```

## 3.4 Missing target fields

Not first-class on AiExecutionLog:

```text
AttemptId / attempt number
failure certainty
provider operation ID
provider idempotency token
OUTCOME_UNKNOWN
consequence state
RecoveryEffectId
RecoveryOutcomeEvidence
retry terminality
```

These may be projected/linked rather than all added to AiExecutionLog.

## 3.5 Live-row compatibility

- successful log: preserve; classify exact outcome based on tool family.
- failed log: never use as automatic permanent effect tombstone.
- same idempotency key: retain historical identity but do not assume request equivalence if old logs lack request fingerprint.
- old provider-affecting logs may be `UNKNOWN_IF_HISTORICAL` when provider evidence cannot be reconstructed.

---

# 4. OutboundDelivery / DeliveryEvent

## 4.1 Current schema

OutboundDelivery fields:

```text
id
contentId
variantId?
destinationId
contactId?
recipientEmail?
recipientPhone?
status             default "Queued"
scheduledAt?
sentAt?
externalPostId?
externalUrl?
errorCode?
errorMessage?
retryCount         default 0
maxRetries         default 3
nextRetryAt?
resultSnapshot?
businessId
events[]
createdAt / updatedAt
```

Schema comment lists current statuses:

```text
Queued
Scheduled
Sending
Sent
Published
Failed
RetryPending
Cancelled
```

DeliveryEvent fields:

```text
id
deliveryId
eventType          attempt|success|failure|retry_scheduled|cancelled
statusBefore?
statusAfter?
errorCode?
errorMessage?
resultData?
attemptNumber?
createdAt
```

## 4.2 Current writers

`DeliveryQueueService`:

```text
Queued|Scheduled due
→ CAS-like updateMany(current status) → Sending
→ adapter.publish()
→ Published on success
→ RetryPending on transient failure with budget
→ Failed otherwise
```

Retry scheduler claims `RetryPending` due rows back to `Sending`.

A success event records attempt number + result snapshot.

Known F159 defect: provider success plus later local persistence error falls into the same catch as provider error and can produce RetryPending/Failed.

## 4.3 Current → target mapping

| Current | Target work_state | original_outcome | Class |
|---|---|---|---|
| `Queued` | `SCHEDULED/ELIGIBLE` | NOT_ATTEMPTED | CONDITIONAL_MAP on scheduledAt |
| `Scheduled` | `SCHEDULED/WAITING_TIME` | NOT_ATTEMPTED | AUTO_MAP timing |
| `Sending` | `CLAIMED/RUNNING/AWAITING_EXTERNAL/UNKNOWN` | ATTEMPTED | EVIDENCE_LOOKUP after crash |
| `RetryPending` | `RETRYING` only if safe | RETRYABLE or UNKNOWN | EVIDENCE_LOOKUP |
| `Published` | work effect accepted/published candidate | SUCCEEDED_CONFIRMED at publish layer | CONDITIONAL_MAP; not delivery/read/business outcome |
| `Sent` | channel-specific send accepted candidate | provider/channel evidence required | CONDITIONAL_MAP |
| `Failed` | `FAILED_FINAL` candidate | confirmed/unknown mixed | EVIDENCE_LOOKUP |
| `Cancelled` | `CANCELLED` only before PONR | original outcome may still exist | EVIDENCE_LOOKUP if any attempt occurred |

## 4.4 Target use of existing fields

```text
OutboundDelivery.id     → WorkOccurrenceId candidate
retryCount              → attempt summary, not exact AttemptId history
maxRetries              → current retry budget
nextRetryAt             → RETRYING wake time
scheduledAt             → temporal eligibility
externalPostId          → ProviderOperationId candidate
externalUrl             → provider evidence link
resultSnapshot           → provider/result evidence source
DeliveryEvent.id         → AttemptEvidence identity
DeliveryEvent.attemptNumber → Attempt ordinal
```

## 4.5 Live-row compatibility

`Sending` rows are highest-risk migration set:

```text
no evidence of provider call
→ ELIGIBLE/RETRYABLE after lease policy

ambiguous call
→ OUTCOME_UNKNOWN

provider success evidence exists
→ SUCCEEDED_CONFIRMED + consequence incomplete if local state lagged
```

`Failed` and `RetryPending` require the same certainty split before retry is enabled.

`Published` is preserved as external publication acceptance evidence but must not be automatically promoted to recipient/business completion.

---

# 5. ScheduledAgentJob

## 5.1 Current schema

```text
id
businessId
jobType
entityId
checkpoint
status             default "PENDING"
payload?
scheduledFor
executedAt?
createdAt
updatedAt
```

Current observed statuses:

```text
PENDING
COMPLETED
FAILED
CANCELLED
```

## 5.2 Current writer semantics

Generic poller every 60s:

```text
find PENDING where scheduledFor <= now
→ executeScheduledJob(job)
→ COMPLETED + executedAt
catch
→ FAILED
```

No generic expected-state execution claim occurs before `executeScheduledJob()`.

Certain domain transitions explicitly cancel still-PENDING future jobs using updateMany.

Known F122/F123/J23 defects include competing ownership/routing weakness, false completion for unknown type, cancellation race and child handoff truth loss.

## 5.3 Current → target mapping

| Current | Target | Class |
|---|---|---|
| `PENDING` future | `SCHEDULED/WAITING_TIME` | AUTO_MAP timing, then validate lateness/version/source state |
| `PENDING` due | `ELIGIBLE` candidate | CONDITIONAL_MAP; no claim yet |
| `COMPLETED` | execution/handoff completed candidate | EVIDENCE_LOOKUP | unknown handler and child handoff defects prevent auto success |
| `FAILED` | retry/final/unknown | EVIDENCE_LOOKUP | no generic retry certainty field |
| `CANCELLED` | `CANCELLED` | CONDITIONAL_MAP | only if effect had not already crossed PONR |

## 5.4 Identity mapping

```text
ScheduledAgentJob.id → WorkOccurrenceId candidate
(jobType, entityId, checkpoint, business) → current occurrence/checkpoint identity inputs
payload → source/version/effect input evidence, not stable version binding by itself
```

No first-class AttemptId, claim lease, EffectId, RecoveryEffectId or provider operation ID exists on this row.

## 5.5 Live-row compatibility

- old PENDING overdue rows require lateness/misfire/current-source-state policy before eligibility.
- old FAILED rows default to `UNKNOWN_IF_HISTORICAL` for retry safety unless handler/effect evidence proves non-effect/finality.
- old COMPLETED unknown-handler or queue-handoff rows cannot be auto-promoted to business `SUCCEEDED`.

---

# 6. WebhookEvent / provider ingress

## 6.1 Current schema

```text
id
provider
providerEventId
eventType?
businessId?
receivedAt
unique(provider, providerEventId)
```

There is no processing status, claim owner, retry count, appliedAt, error, outcome or downstream consequence field.

Schema commentary explicitly describes it as idempotency/dedup for inbound payment-provider webhooks.

## 6.2 Current writer semantics

`InvoiceWorkflowService.assertNewProviderEvent()`:

```text
providerEventId absent
→ returns true (legacy fallthrough)

providerEventId present
→ WebhookEvent.create()
→ true on insert
→ false on unique P2002
```

Callers short-circuit duplicate events as already processed.

This is F127's core mismatch:

```text
SEEN / CLAIMED
!=
APPLIED SUCCESSFULLY
```

## 6.3 Target mapping

Existing row auto-maps only to:

```text
IngressOccurrence observed/claimed = YES
received_at = receivedAt
provider occurrence identity = provider + providerEventId
```

It does **not** auto-map to:

```text
PROCESSING
APPLIED
FAILED_FINAL
SUCCEEDED
```

Historical target processing state = `UNKNOWN_IF_HISTORICAL` unless downstream provider/payment/domain evidence proves the consequence.

## 6.4 Target lifecycle overlay

```text
RECEIVED
AUTHENTICATED
TENANT_BOUND
CLAIMED
PROCESSING
APPLIED
RETRYABLE_FAILED
FAILED_FINAL
IGNORED_VALIDLY
```

These can initially be a derived/adjacent processing lifecycle rather than destructive rewrite of `WebhookEvent`.

## 6.5 Live-row compatibility

All existing WebhookEvent rows remain durable occurrence evidence.

Do not mass-mark historical rows APPLIED.

Where high-value financial/provider evidence exists, targeted reconciliation can infer stronger state; otherwise retain `seen=true, processing_outcome=unknown` in migration/projection.

---

# 7. Payment / Invoice / FinancialTransaction / Ledger — K10

## 7.1 Payment schema

```text
id
amount
currency
status             String
provider
method?
providerPaymentId  unique
reference?
notes?
recordedBy?
processor fee fields
invoiceId
businessId
createdAt
...
```

Code-level payment balance semantics recognize:

```text
SUCCESSFUL
PENDING
FAILED
REFUNDED
```

`InvoiceWorkflow.computeBalance()`:

```text
SUCCESSFUL → contributes paid amount
REFUNDED  → contributes refunded amount
PENDING/FAILED → ignored for balance
```

## 7.2 Invoice status

Prisma enum currently includes:

```text
DRAFT
SENT
PAID
VOID
OVERDUE
FAILED
PENDING
PARTIALLY_PAID
FULLY_CREDITED
PARTIALLY_CREDITED
PARTIAL
```

Invoice status is business/receivable state, not provider attempt state.

## 7.3 FinancialTransaction / Ledger

FinancialTransaction includes:

```text
id
businessId
type        INCOME|EXPENSE|TRANSFER|REFUND|TAX|ADJUSTMENT|REVERSAL|OPENING_BALANCE
status      default POSTED; DRAFT|POSTED|VOID|REVERSED
date
description?
amount
currency
sourceType?
sourceId?
externalRef?     business-scoped unique idempotency key
reversalOfId?    unique link to original transaction
entries[]
```

LedgerEntry is append-only double-entry evidence linked to FinancialTransaction.

## 7.4 Current → target financial mapping

### Payment `SUCCESSFUL`

```text
provider/domain payment evidence exists
```

Class: `CONDITIONAL_MAP` to original outcome success.

Must verify:

- provider identity where external;
- ledger consequence exists where required;
- invoice/order reconciliation complete.

Target may be:

```text
original_outcome = SUCCEEDED_CONFIRMED
consequence_state = COMPLETE | INCOMPLETE
```

### Payment `REFUNDED`

Not enough to infer financial convergence (F155).

```text
original/recovery effect evidence = refund row exists
consequence_state = EVIDENCE_LOOKUP
```

Need ledger reversal + invoice/order reconciliation.

### Payment `FAILED`

Do not auto-map provider failure.

F158 proves a provider-confirmed PayPal capture can lead to local FAILED evidence.

Class: `EVIDENCE_LOOKUP`, potentially `OUTCOME_UNKNOWN` or provider success/consequence incomplete.

### Payment `PENDING`

Does not imply executable recovery work (F156).

Class: `SOURCE_ONLY` until linked to an actual provider/order/checkout/retry occurrence.

### Invoice status

Invoice state maps to business financial consequence, not attempt state.

- `PAID` is valid only insofar as Payment/ledger truth supports it.
- `VOID` is domain void state, not refund.
- credited/partial states are balance/credit consequences.
- `FAILED/PENDING` are especially ambiguous and must not be reused as provider retry status.

### FinancialTransaction

```text
externalRef → strong consequence-idempotency identity
reversalOfId → strong reversal lineage
POSTED → ledger consequence persisted
REVERSED → original transaction reversal relationship/evidence
```

This is one of the strongest current K10 repair seams.

## 7.5 Target K10 state

```text
provider financial outcome known
+ Payment evidence
+ FinancialTransaction/Ledger consequence
+ Invoice/Order reconciliation
→ FINANCIAL_TRUTH_CONVERGED
```

Missing any required component:

```text
CONSEQUENCE_INCOMPLETE
→ RECONCILING
```

Never repeat the provider effect just to repair a missing ledger/invoice consequence.

## 7.6 Live-row compatibility

Priority migration evidence checks:

```text
Payment FAILED
→ provider lookup/reference/webhook evidence

Payment REFUNDED
→ matching reversal FinancialTransaction + invoice reconciliation

Payment SUCCESSFUL
→ provider/capture evidence + posting + balance state

Invoice PAID with inconsistent Payment/ledger
→ mark projection inconsistent/reconciliation-needed; do not silently rewrite accounting history
```

---

# 8. SocialPost / provider artifacts

## 8.1 Current schema

```text
id
content
mediaUrls[]
status           default DRAFT; DRAFT|SCHEDULED|POSTED|FAILED
scheduledAt?
postedAt?
failedAt?
channelIds[]
publishResults?
externalPostId?
externalUrl?
lastError?
businessId
deletedAt?        soft-delete field used by service
```

## 8.2 Current writer semantics

Scheduling update:

```text
scheduledAt set → SCHEDULED
scheduledAt cleared → DRAFT
```

Publication:

```text
per-connection publisher calls
→ publishResults[]
→ any success ? POSTED : FAILED
→ first successful provider externalPostId/externalUrl copied to top-level fields
```

Thus aggregate `POSTED` means **at least one** provider succeeded, not all providers.

Deletion:

```text
deletePost()
→ deletedAt = now
→ no provider delete/unpublish call
```

F160.

## 8.3 Current → target mapping

### DRAFT

Planning/definition state, not an effect occurrence.

### SCHEDULED

`SCHEDULED/WAITING_TIME` candidate, conditional on channel/provider definition version and current source eligibility.

### POSTED

Aggregate state only.

Must derive provider-destination child/effect truth from `publishResults`.

```text
POSTED
→ at least one provider outcome success
→ parent may be partial
```

Do not map all destinations to success.

### FAILED

Aggregate all-no-success publication attempt in current publisher path, but external ambiguity still requires per-provider evidence.

### deletedAt != null

Maps only to:

```text
local_record_hidden/deleted = true
```

Never auto-map provider recovery/reversal.

## 8.4 Identity mapping

```text
SocialPost.id → publication parent/intent identity
publishResults[i] provider platform → destination effect evidence
externalPostId top-level → first-success provider artifact only, insufficient for multi-provider recovery
```

Target requires per-destination EffectId / ProviderOperationId / RecoveryOutcomeEvidence.

## 8.5 Live-row compatibility

- historical POSTED with publishResults → reconstruct per-provider outcome where possible;
- historical POSTED without adequate provider IDs → retain aggregate success, destination outcome unknown;
- historical deletedAt → local deletion only; provider reversal unknown unless provider evidence exists;
- historical FAILED → per-provider outcome unknown/failed according to publishResults, do not assume provider non-effect after transport ambiguity.

---

# 9. Cross-fabric exact mapping summary

| Fabric | Strong current identity | Strong temporal field | Overloaded status risk | Strong outcome/evidence seam | Main migration action |
|---|---|---|---|---|---|
| AiPlanStep/BullMQ | step id + queue job idempotency key | scheduledAt + BullMQ delay | VERY HIGH | outputResult + AiExecutionLog | separate logical/transport/effect dimensions |
| ActionDispatcher/AiExecutionLog | idempotencyKey candidate | none durable for retry wait | HIGH | execution log | classify terminality/certainty; add/link claims/attempts |
| OutboundDelivery | delivery id | scheduledAt/nextRetryAt | HIGH | DeliveryEvent + provider IDs/resultSnapshot | split unknown/provider-success/consequence-incomplete |
| ScheduledAgentJob | job id + checkpoint tuple | scheduledFor | VERY HIGH | row + downstream domain records | add claim/retry/finality/lineage projection |
| WebhookEvent | provider+eventId | receivedAt | SEEN/APPLIED compression | provider event identity | processing lifecycle/replay ownership |
| Payment/Finance | providerPaymentId + financial externalRef | transaction/invoice dates | VERY HIGH | Payment + FinancialTransaction/Ledger + provider | K10 consequence convergence |
| SocialPost | post id + publishResults provider refs | scheduledAt | HIGH aggregate/per-destination | publishResults + external IDs | per-destination effect/reversal projection |

---

# 10. Migration classification rules by risky value

```yaml
AiPlanStep.executing:
  class: UNKNOWN_IF_HISTORICAL
  reason: persisted after enqueue, before worker execution

AiPlanStep.failed:
  class: EVIDENCE_LOOKUP
  reason: attempt failure, policy denial, final failure and external uncertainty can collapse

AiPlanStep.completed:
  class: EVIDENCE_LOOKUP
  reason: logical step completion may precede external/business outcome

OutboundDelivery.Sending:
  class: EVIDENCE_LOOKUP
  reason: claim exists; provider-call certainty depends on crash point

OutboundDelivery.Failed:
  class: EVIDENCE_LOOKUP
  reason: confirmed failure and unknown/known-success-local-failure can collapse

ScheduledAgentJob.COMPLETED:
  class: EVIDENCE_LOOKUP
  reason: unknown handlers/descendant handoffs can false-complete

WebhookEvent.exists:
  class: AUTO_MAP_SEEN_ONLY
  reason: occurrence claimed; processing outcome unknown

Payment.FAILED:
  class: EVIDENCE_LOOKUP
  reason: F158 provider success can coexist

Payment.PENDING:
  class: SOURCE_ONLY
  reason: no proof executable recovery owner

Payment.REFUNDED:
  class: CONDITIONAL_MAP
  reason: refund evidence may exist while ledger/invoice consequence incomplete

SocialPost.POSTED:
  class: CONDITIONAL_MAP_PER_DESTINATION
  reason: any-success aggregate

SocialPost.deletedAt:
  class: AUTO_MAP_LOCAL_DELETE_ONLY
  reason: F160; external reversal not implied
```

---

# 11. Compatibility strategy

Do not start by replacing current status columns.

Near-term safer sequence:

```text
existing rows remain source truth
→ source adapters derive unified semantic dimensions
→ projection exposes normalized state
→ characterization tests lock current behavior
→ writers gain missing effect/attempt/provider/recovery evidence
→ readers migrate to semantic adapters/projection
→ only then consider enum/status cleanup
```

Compatibility adapters should be source-specific, not one heuristic global parser of status strings.

---

# 12. Exact next mapping questions

P0 field mapping is now sufficiently concrete to move into live-row migration, but these exact details still require closure during that tranche:

1. enumerate every current status writer for AiPlan/AiPlanStep and classify which dialect is canonical vs compatibility-only;
2. inventory historical volume/distribution of risky values when a safe data-access environment is available;
3. determine which AiExecutionLog tool families let `success=true` prove local terminal effect vs provider acceptance only;
4. define provider-specific interpretation of OutboundDelivery Published/Sent;
5. classify each ScheduledAgentJob jobType by effect owner/retryability/lateness/version binding;
6. map WebhookEvent downstream consequence evidence per eventType/provider;
7. define financial consequence-completeness checks per Payment provider/type;
8. parse historical SocialPost publishResults shapes per provider/version.

These are migration/proof blockers, not reasons to reopen the unified target model.

---

# 13. P0 verdict

The exact mapping pass confirms:

```text
CURRENT STATUS COLUMNS CANNOT BE SAFELY NORMALIZED BY ENUM RENAME.
```

The dominant migration pattern is:

```text
source status
+ companion fields
+ attempt/provider/domain evidence
→ semantic adapter
→ target dimensions
```

This further supports the prior decision:

```text
SHARED SEMANTIC CONTRACT = YES
PREMATURE SHARED PHYSICAL TABLE/STATUS ENUM = NO
```

Next frontier:

> **LIVE-ROW MIGRATION COMPATIBILITY MAP** — define auto-map/evidence-lookup/unknown/backfill strategy and reader/writer compatibility per risky historical state.

No runtime tests or production data queries were executed in this mapping pass.
