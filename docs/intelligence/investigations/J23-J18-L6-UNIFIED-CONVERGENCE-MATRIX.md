# J23 + J18 — Unified L6 Convergence Matrix

Status: ACTIVE L6 TARGET-CONVERGENCE / MIGRATION + PROOF SYNTHESIS
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Primary journeys: J23 Temporal Flow / Long-Running Workflow, J18 Failure / Recovery
Primary kernels: K7 Temporal/Workflow, K11 Recovery/Reliability, K8 Evidence/Outcome, K9 Integration/External Reality
Secondary kernels: K10 Financial Truth, K3 Governance, K6 State Transition

> Purpose: merge the J23 temporal-work target and J18 recovery target into one migration/proof model. No production implementation is authorized.

---

## 1. Unified target thesis

A long-lived KeyFlow business effect must be modeled across independent dimensions rather than one overloaded status field.

```text
Definition(version)
→ WorkOccurrence
→ temporal eligibility / waits
→ worker claim
→ Attempt
→ current action + authority eligibility
→ Clearance
→ ExecutionClaim / EffectId
→ domain/provider effect
→ original outcome
→ required local/domain consequences
→ recovery decision if needed
→ RecoveryEffect / consequence repair
→ final business truth
```

The target is one semantic algebra over multiple existing persistence/runtime fabrics.

---

## 2. Unified semantic dimensions

### 2.1 Work state — K7

```text
SCHEDULED
ELIGIBLE
WAITING_TIME
AWAITING_CONTROL
AWAITING_DEPENDENCY
CLAIMED
RUNNING
RETRYING
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED
FAILED_FINAL
CANCELLED
SUPERSEDED
EXPIRED
```

### 2.2 Original outcome — K8/K9/K10

```text
NOT_ATTEMPTED
ATTEMPTED
FAILED_BEFORE_EFFECT_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED_CONFIRMED
FAILED_FINAL_CONFIRMED
```

### 2.3 Consequence state

```text
NOT_APPLICABLE
PENDING
COMPLETE
INCOMPLETE
RECONCILING
REPAIR_FAILED
```

`INCOMPLETE` is required when an effect is known to have happened but one or more required local/domain/accounting consequences did not converge.

### 2.4 Failure certainty — J18/K11

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED_CONFIRMED
```

### 2.5 Recovery action

```text
NONE
RETRY
RECONCILE
CANCEL
VOID
REVERSAL
COMPENSATION
MITIGATION_ONLY
```

### 2.6 Recovery state

```text
NONE
AVAILABLE
REQUESTED
ATTEMPTED
SUCCEEDED_CONFIRMED
FAILED
UNAVAILABLE
MITIGATION_ONLY
```

### 2.7 Identity dimensions

```text
DefinitionId
DefinitionVersion
WorkOccurrenceId
Parent/Cause Id
WorkerClaimId
AttemptId
ExecutionClaimId
EffectId
ProviderOperationId
ProviderIdempotencyToken
OutcomeEvidenceId
RecoveryEffectId
RecoveryAttemptId
RecoveryOutcomeEvidenceId
```

### 2.8 Authority dimensions

```text
ControlRequirement
ControlEvidence
ClearanceId
ClearanceFingerprint
ClearanceExpiry / invalidation
RecoveryScope
StandingAutonomyPolicyVersion
Stop/Revocation state
```

---

## 3. Global unified laws

```text
Definition != Occurrence
Occurrence != Attempt
Attempt != Effect
Worker Claim != ExecutionClaim
Waiting != Completed
Attempt Failed != Logical Work Failed Final
Provider Acceptance != Delivery/Settlement/Business Outcome
Provider Success + Local Failure != Provider Failure
Effect Dedupe != Consequence Completeness
Original Outcome != Recovery Outcome
Retry != Reversal != Compensation
Local Delete != External Reversal
Approval != Clearance
Failure / Time != New Authority
Parent Resume != Replay Confirmed Child Success
Scheduled Time != Perpetual Eligibility
Definition ID != Immutable Action Semantics
Cancel Requested != Cancellation Proven
```

---

## 4. Fabric-by-fabric convergence matrix

### 4.1 AiPlan / AiPlanStep + BullMQ

**Current strong seams**

- durable plan/step identity;
- dependency graph;
- BullMQ stable job identity, delayed work, attempts/backoff, locks/stalled recovery;
- plan-step idempotency key.

**Current compressed/misaligned truth**

- BullMQ attempt failure can be written as terminal AiPlanStep failure;
- ActionDispatcher failed-idempotency tombstone defeats later BullMQ retries (F150);
- control wait can become parent failure (F153);
- parent execute-again can replay completed children (F157);
- logical work state, transport state and effect outcome are not independent.

**Target mapping**

```text
AiPlan/AiPlanStep identity
→ WorkOccurrence / child occurrence identity

BullMQ state
→ Attempt transport projection only

AiPlanStep logical status
→ K7 work_state

AiExecutionLog / provider/domain evidence
→ original_outcome / consequence_state
```

**Live-row migration rules**

- existing `failed` rows cannot be blindly mapped to `FAILED_FINAL`; classify whether retry budget existed/exists and whether external effect may have occurred;
- existing `completed` steps remain terminal and are never re-run during resume unless explicitly new effect;
- existing `waiting_approval` maps to `AWAITING_CONTROL`, even if parent row currently says failed;
- migration must preserve dependency identity and old timestamps/error text as evidence.

**L6 blockers**

- exact current plan/step status enum and queue-state mapping;
- exact retry budget source precedence;
- same-effect idempotency repair design;
- explicit resume eligibility/filtering;
- clearance recovery-scope binding to step EffectId.

**Proof**

- transient BullMQ failure → logical `RETRYING`, not final failed;
- retry reaches new attempt with same EffectId;
- completed sibling/ancestor not replayed;
- waiting approval remains resumable;
- revoked authority during backoff prevents next mutation.

---

### 4.2 ActionDispatcher / AiExecutionLog

**Current strong seams**

- centralized effect-dispatch boundary;
- governance hook;
- idempotency key;
- retry/backoff;
- execution logging/events/feedback;
- undo registration.

**Current compressed/misaligned truth**

- failed execution log can act as terminal idempotency result (F150);
- inline retries are process-local;
- process-local circuit breaker;
- execution log is not atomic ExecutionClaim;
- provider/domain effect certainty not first-class;
- failed log does not distinguish retryable attempt, final failure, unknown, provider success with consequence incomplete.

**Target mapping**

```text
ActionDispatcher request
→ exact ActionEnvelope + EffectId

atomic pre-effect boundary
→ ExecutionClaim

AiExecutionLog
→ Attempt/OutcomeEvidence source
not the sole WorkOccurrence truth
```

**Required result classes**

```text
ATTEMPT_FAILED_RETRYABLE
FAILED_FINAL_CONFIRMED
OUTCOME_UNKNOWN
SUCCEEDED_CONFIRMED
SUCCEEDED_CONSEQUENCE_INCOMPLETE
```

**Live-row migration rules**

- existing successful logs may act as duplicate-effect prevention evidence where request/fingerprint matches;
- existing failed logs cannot automatically block retries;
- migration must preserve original idempotency keys but add/derive terminality classification separately.

**Proof**

- concurrent callers → one ExecutionClaim/effect;
- same key + different request hash rejects;
- failed attempt + live retry policy proceeds;
- known success blocks duplicate effect;
- local failure after provider success cannot become provider retry.

---

### 4.3 OutboundDelivery / DeliveryEvent

**Current strong seams**

- durable OutboundDelivery identity;
- expected-state `Sending` claim;
- retry count/backoff/nextRetryAt;
- provider result snapshot/IDs where returned;
- DeliveryEvent per-attempt history;
- manual retry surfaces.

**Current compressed/misaligned truth**

- adapter returns mainly `success/isTransient`;
- ambiguous transport failure lacks `OUTCOME_UNKNOWN`;
- provider idempotency token not universal;
- provider success and subsequent local error share one catch boundary, allowing `RetryPending` after known success (F159);
- aggregate Published/Failed can be weaker than external delivery truth.

**Target mapping**

```text
OutboundDelivery.id
→ WorkOccurrenceId / delivery occurrence

provider action identity
→ EffectId + ProviderOperationId

DeliveryEvent
→ AttemptEvidence / external outcome evidence
```

**Target post-provider flow**

```text
provider success observed
→ original_outcome = SUCCEEDED_CONFIRMED
→ consequence_state = PENDING/INCOMPLETE
→ persist Published/provider identity
→ repair local consequences if needed
→ never resend solely because local persistence failed
```

**Live-row migration rules**

- `Sending` rows at migration/startup require certainty classification, not automatic retry;
- `Failed` rows must distinguish confirmed provider non-effect from ambiguity;
- `Published` remains provider-acceptance/publish evidence, not necessarily recipient delivery/read/business outcome;
- manual retry must be blocked/gated for unknown/known-success states.

**Proof**

- process crash after provider success but before Published write → reconcile/no duplicate;
- timeout with possible effect → OUTCOME_UNKNOWN;
- duplicate operator retry unavailable when unsafe;
- provider lifecycle callback advances strongest outcome without regressing work truth.

---

### 4.4 ScheduledAgentJob

**Current strong seams**

- durable database row;
- checkpoint/job identity;
- due-time selection.

**Current compressed/misaligned truth**

- no generic atomic execution claim in inspected path;
- generic `FAILED` lacks observed generic retry/dead-letter owner;
- unknown job type can false-complete;
- cancellation can lose after selection;
- upstream completion can precede descendant customer effect completion.

**Target mapping**

```text
ScheduledAgentJob.id
→ WorkOccurrenceId where row represents a concrete occurrence

status
→ K7 logical work state, not descendant business outcome
```

**Required additional semantics**

- handler/routing validity;
- WorkerClaim/ExecutionClaim where effecting;
- descendant effect lineage;
- retryability/finality;
- cancellation/supersession/lateness/version;
- unhandled/dead-letter classification.

**Live-row migration rules**

- existing `FAILED` → classify retryability and descendant/external certainty;
- existing `COMPLETED` for unknown/unhandled types cannot be assumed successful business outcome;
- queued descendants remain separate WorkOccurrences/effects.

**Proof**

- two pollers do not duplicate one job effect;
- unknown type fails closed/unhandled, not completed;
- cancel between selection and claim prevents effect;
- retry preserves occurrence/effect identity;
- parent status does not falsely imply child effect completion.

---

### 4.5 WebhookEvent / provider ingress

**Current strong seams**

- provider occurrence/event identity;
- unique first-seen claim in payment paths;
- signature/authentication in stronger provider routes.

**Current compressed/misaligned truth**

- first-seen claim can suppress provider redelivery after downstream processing failure (F127);
- no processing lifecycle such as CLAIMED/APPLIED/RETRYABLE_FAILED;
- authenticity != tenant binding != unique consumption;
- later reconciliation/repair ownership fragmented.

**Target mapping**

```text
Provider EventId
→ IngressOccurrenceId

first-seen
→ occurrence claim only
not processing success
```

**Target ingress lifecycle**

```text
RECEIVED
→ AUTHENTICATED
→ TENANT_BOUND
→ CLAIMED
→ PROCESSING
→ APPLIED
   | RETRYABLE_FAILED
   | FAILED_FINAL
   | IGNORED_VALIDLY
→ downstream consequence lineage
```

**Live-row migration rules**

- existing WebhookEvent rows prove seen occurrence, not necessarily applied consequence;
- no retrospective assumption that every historical seen row succeeded;
- new lifecycle can be derived/projection-backed initially where schema migration risk is high.

**Proof**

- processing failure after claim + provider redelivery resumes safely;
- duplicate concurrent delivery has one business consequence;
- effect dedupe allows repair of missing local consequence;
- tenant/auth/event identities remain separate.

---

### 4.6 Payment / Invoice / Ledger — K10

**Current strong seams**

- provider capture/refund IDs;
- Payment rows;
- `createPaymentWithPosting()` / `createRefundWithPosting()` strong transaction seams;
- RevenuePosting reversal;
- InvoiceWorkflow reconciliation;
- provider webhooks.

**Current compressed/misaligned truth**

- manual provider refund can create REFUNDED Payment without ledger/invoice repair and then suppress webhook repair (F155);
- payment “retry” can flip FAILED→PENDING without recovery owner (F156);
- PayPal capture can succeed externally then catch path records FAILED and loses provider lineage (F158);
- provider outcome, Payment, ledger and invoice state are not always consequence-complete.

**Target mapping**

```text
financial EffectId
→ provider capture/refund operation
→ Payment evidence
→ ledger consequence
→ invoice/order reconciliation
```

**Target consequence state**

```text
provider outcome known
+ any required financial consequence missing
→ CONSEQUENCE_INCOMPLETE
→ RECONCILING / REPAIR
→ FINANCIAL_TRUTH_CONVERGED
```

**Live-row migration rules**

- `Payment.status=FAILED` cannot always mean provider failed; F158-class rows require correlation/reconciliation;
- `PENDING` does not prove executable retry;
- `REFUNDED` does not prove ledger/invoice convergence;
- historical provider IDs/references must be preserved for repair;
- no duplicate ledger reversal/payment effect during repair.

**Proof**

- provider capture success + Payment insert failure converges without second capture;
- refund row exists + ledger missing → repair without second refund;
- duplicate webhook repairs missing consequence without double posting;
- partial refunds produce correct remaining balance;
- current financial authority required for reversal/credit.

---

### 4.7 SocialPost / provider publication artifacts

**Current strong seams**

- local SocialPost identity;
- publishResults;
- externalPostId/externalUrl;
- per-platform publisher results.

**Current compressed/misaligned truth**

- local delete soft-deletes row only while external post can remain live (F160);
- one SocialPost may represent multiple provider artifacts;
- local aggregate status cannot represent heterogeneous reversal outcomes.

**Target mapping**

```text
SocialPost publication intent
→ one WorkOccurrence or bounded parent
→ provider-destination EffectId(s)
→ per-destination ProviderOperationId / outcome
```

Deletion/reversal:

```text
local archive/delete
!= provider delete

provider delete per destination
→ RecoveryEffectId per external artifact or bounded recovery group
→ per-destination RecoveryOutcomeEvidence
```

**Live-row migration rules**

- retain external publication evidence even when local row is soft-deleted;
- distinguish historical local-only deletes from confirmed provider deletes;
- do not fabricate provider deletion for existing deleted rows.

**Proof**

- published post local removal does not claim external deletion;
- provider delete where supported records confirmed/failed/unknown per destination;
- unsupported provider reversal becomes RECOVERY_UNAVAILABLE or mitigation, not success.

---

## 5. Unified blocker register

### 5.1 Semantic blockers

- exact representation of `CONSEQUENCE_INCOMPLETE` without overloading work state;
- exact recovery scope semantics in Clearance;
- exact distinction between parent WorkOccurrence and child/provider destination effects;
- exact terminal evidence criteria per work/effect family.

### 5.2 Field/status mapping blockers

- current → target status maps for AiPlan/AiPlanStep;
- AiExecutionLog terminality classification;
- OutboundDelivery Sending/Published/Failed mapping;
- ScheduledAgentJob COMPLETED/FAILED mapping;
- WebhookEvent seen vs applied lifecycle;
- Payment FAILED/PENDING/REFUNDED mapping;
- SocialPost POSTED/FAILED/deletedAt vs provider artifact state.

### 5.3 Migration blockers

- live rows with ambiguous overloaded states;
- old rows lacking EffectId/provider lineage;
- compatibility while old code reads legacy statuses;
- backfill/derivation without inventing certainty;
- preserving provider/accounting/audit evidence while adding projections.

### 5.4 Provider-contract blockers

- provider-native idempotency support/retention per operation;
- lookup/status/reconciliation APIs;
- reversal/delete/cancel capabilities;
- terminal delivery/settlement semantics;
- provider-owned metadata/correlation support.

### 5.5 Authority blockers

- exact persistence/derivation of Clearance recovery scope;
- standing J6 recovery policy/budgets;
- stop/revoke precedence;
- operator recovery permission model;
- fresh control threshold for reversal/compensation/local repair.

### 5.6 Projection blockers

- Temporal Work Projection adapter contract;
- recovery/consequence fields;
- refresh/materialization/rebuild strategy;
- per-destination external outcomes;
- degraded source behavior;
- tenant isolation and sensitive evidence minimization.

### 5.7 Proof blockers

- characterization of current status transitions;
- crash-point injection around provider PONR/local commit;
- concurrency proof for claim/retry/cancel;
- historical/live-row migration fixtures;
- provider sandbox/contract tests where feasible;
- proof of no duplicate effects during repair/resume.

---

## 6. Unified migration sequence

The J23 and J18 waves collapse into one sequence:

```text
U-A CHARACTERIZE
  exact current statuses/fields/transitions/retry budgets/provider contracts

U-B IDENTITY + OWNERSHIP
  WorkOccurrence / Effect / Attempt / Claim lineage
  preserve strong existing IDs first

U-C LOGICAL STATE SEPARATION
  waiting/retrying/control/dependency vs transport attempt

U-D TEMPORAL VALIDITY
  cancellation/supersession/lateness/version/current-state eligibility

U-E EXTERNAL OUTCOME
  provider idempotency, AWAITING_EXTERNAL, OUTCOME_UNKNOWN, reconciliation

U-F POST-EFFECT CONSEQUENCE CONVERGENCE
  provider success + consequence incomplete; K10 financial convergence

U-G RECOVERY AUTHORITY
  Clearance recovery scope, J6 budgets, stop/revoke, reversal/compensation control

U-H OPERATOR PROJECTION
  KF-REC-047 temporal + recovery projection

U-I PROOF + LIVE MIGRATION
  characterization, migration fixtures, crash/concurrency proof

U-J PHYSICAL CONVERGENCE REASSESSMENT
  only now decide whether shared WorkOccurrence/RecoveryOccurrence/DLQ/runtime storage is justified
```

No engine/table decision should jump ahead of U-J.

---

## 7. Live-row migration principles

1. **Never invent certainty during migration.**
   - ambiguous historical `FAILED` → unknown/needs-classification rather than confirmed failed if effect may have crossed PONR.
2. **Preserve original raw status/evidence.**
   - target projections should retain source status + source row identity.
3. **Projection before rewrite where practical.**
   - derive target dimensions from existing rows before destructive enum/schema migration.
4. **Backfill identity conservatively.**
   - provider IDs, job IDs, plan-step keys may seed identity; do not synthesize equivalence without evidence.
5. **Terminal successful child remains terminal.**
   - parent migration/resume cannot reset successful children.
6. **Effect existence and consequence completeness are separate.**
   - existing provider/refund IDs can prove effect even if accounting/domain consequences are incomplete.
7. **Legacy readers need compatibility windows.**
   - adapters should translate new semantic projection to legacy status expectations until consumers are migrated/proven.
8. **Soft-deleted local rows may retain critical external evidence.**
   - recovery/audit evidence cannot disappear merely because normal UX hides the object.

---

## 8. Unified operator projection candidate

Derivative projection only:

```yaml
work_occurrence_id: ...
source_type: ...
source_id: ...
definition_id: ...
definition_version: ...
work_state: ...
waiting_reason: ...
scheduled_at: ...
eligible_at: ...
expires_at: ...
lateness_policy: ...
current_attempt_id: ...
effect_id: ...
original_outcome: ...
failure_certainty: ...
consequence_state: ...
provider_operation_id: ...
provider_state: ...
recovery_action: ...
recovery_state: ...
recovery_effect_id: ...
retry_safe: true|false|unknown
reconcile_available: true|false
cancel_available: true|false
reversal_available: true|false
compensation_available: true|false
clearance_state: ...
recovery_clearance_state: ...
causal_parent_id: ...
child_effects: ...
last_error: ...
last_evidence_at: ...
```

Projection must show simple user language while operator drill-down exposes evidence and certainty.

---

## 9. Unified proof matrix

| Proof family | Required scenario | Safety property |
|---|---|---|
| Attempt retry | transient attempt fails, retries remain | logical work remains RETRYING; same EffectId |
| Claim race | two workers/callers | one execution owner/effect |
| Cancel race | cancel vs claim | explicit linearization; no late unauthorized effect |
| Wait/resume | approval/dependency/time wait | same occurrence resumes; no false completion/failure |
| Parent resume | one completed child, one failed/waiting | completed child never replayed |
| Definition change | waiting occurrence + edited definition | explicit bind/migrate/supersede policy |
| Lateness | scheduler wakes late | per-work misfire/lateness policy, no perpetual authority |
| Provider timeout | request may have crossed PONR | OUTCOME_UNKNOWN; reconcile before retry |
| Provider known success + DB failure | effect confirmed, local write fails | no provider re-send; consequence repair |
| Ingress failure | event claim succeeds, processing fails | safe resumed consumption, not permanent dedupe loss |
| Financial consequence repair | refund/capture known, ledger/invoice missing | converge without duplicate money movement |
| Recovery authority | retry wakes after authority revoked | effect denied/cancelled; queue wake ≠ authority |
| Reversal control | successful action later reversed | new RecoveryEffectId + current Clearance |
| Local/provider delete | local object hidden | no claim provider deleted unless confirmed |
| Operator action | unsafe/unknown effect | retry hidden/blocked; reconcile offered |
| Migration | historical ambiguous rows | no invented success/failure certainty |

---

## 10. Convergence gates before KF-EXEC generation

No implementation packet until all of these are true for its bounded scope:

```text
G1 current source-of-truth rows and consumers mapped
G2 target semantic dimensions fixed
G3 identity/effect ownership fixed
G4 migration/backfill/compatibility path defined
G5 authority/control behavior fixed
G6 provider contract/reconciliation behavior fixed where external
G7 projection/observability behavior fixed
G8 concurrency/crash/rollback proof designed
G9 legacy consumer impact bounded
G10 no parallel source of truth introduced
```

A future `KF-EXEC-*` packet should change the smallest coherent seam that satisfies an accepted invariant and includes its migration + proof.

---

## 11. Unified next blockers in priority order

### P0 — exact current→target field/status maps

Produce concrete mapping tables for the seven major fabrics in this document.

### P1 — live-row migration compatibility

For each overloaded historical status, define:

```text
auto-map
needs evidence lookup
map to unknown/needs review
leave legacy-only until consumed
```

### P2 — provider contract matrix

Per material provider/effect:

```text
idempotency token support
operation ID
status lookup
webhook/lifecycle evidence
point of no return
safe retry condition
reversal/cancel capability
```

### P3 — authority representation

Define exact J15 Clearance recovery-scope and J6 recovery-policy fields/relationships without freezing persistence prematurely.

### P4 — Temporal Work Projection materialization

Choose adapter/query/materialized strategy and freshness/rebuild semantics.

### P5 — characterization/proof inventory

Map existing tests and required new proofs without claiming execution.

---

## 12. Current maturity verdict

The J23/J18 constellation is now conceptually converged enough that remaining work is predominantly:

```text
exact mapping
migration compatibility
provider contract detail
authority representation
projection strategy
proof design
```

not discovery of the fundamental target model.

Therefore both remain:

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6
J18 = L5 VALUE-ENGINEERED / ENTERING L6
```

Execution remains blocked until L6 converges by bounded scope.

---

## 13. Machine-readable summary

```yaml
id: J23-J18-L6-UNIFIED-CONVERGENCE
status: ACTIVE_L6_CONVERGENCE
implementation_authorized: false
journeys:
  KF-JOURNEY-023: L5_VALUE_ENGINEERED_ENTERING_L6
  KF-JOURNEY-018: L5_VALUE_ENGINEERED_ENTERING_L6
primary_dimensions:
  - work_state
  - original_outcome
  - consequence_state
  - failure_certainty
  - recovery_action
  - recovery_state
  - identity
  - authority
fabrics:
  - AiPlan_AiPlanStep_BullMQ
  - ActionDispatcher_AiExecutionLog
  - OutboundDelivery_DeliveryEvent
  - ScheduledAgentJob
  - WebhookEvent
  - Payment_Invoice_Ledger
  - SocialPost_provider_artifacts
migration_sequence:
  - characterize
  - identity_ownership
  - logical_state_separation
  - temporal_validity
  - external_outcome
  - post_effect_consequence_convergence
  - recovery_authority
  - operator_projection
  - proof_live_migration
  - physical_convergence_reassessment
next_priority: exact_current_target_field_status_maps
```
