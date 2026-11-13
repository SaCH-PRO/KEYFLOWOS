# J18 — Target Convergence and Migration Map

Status: VALUE-ENGINEERED TARGET SYNTHESIS / ENTERING L6 TARGET-CONVERGENCE
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Primary journey: J18 Failure → Recovery
Primary kernels: K11 Recovery/Reliability, K8 Evidence/Outcome, K9 Integration/External Reality
Secondary kernels: K10 Financial Truth, K7 Temporal/Workflow, K3 Governance, K6 State Transition

> No production implementation is authorized. This document defines the converging target, migration waves, value-engineering decisions and remaining L6 blockers.

---

## 1. Convergence verdict

J18 now supports the following architecture decisions:

```text
ONE SHARED RECOVERY SEMANTIC CONTRACT        = YES
ONE SHARED FAILURE-CERTAINTY TAXONOMY        = YES
ONE SHARED RECOVERY-ACTION TAXONOMY          = YES
ONE CROSS-DOMAIN OPERATOR/RECOVERY PROJECTION = YES, extend KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE              = NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER                = NOT JUSTIFIED YET
ONE UNIVERSAL RecoveryOccurrence TABLE       = NOT JUSTIFIED YET
ONE GENERIC UNDO/COMPENSATION SEMANTIC        = NO
PROVIDER-NATIVE REVERSAL WHERE AVAILABLE     = YES
PER-EFFECT/PER-DESTINATION RECOVERY OUTCOME   = YES
K10 FINANCIAL TRUTH AS FIRST-CLASS KERNEL     = YES
```

The target is semantic convergence over existing fabrics before physical convergence.

---

## 2. Target recovery model

### Failure certainty

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED_CONFIRMED
EXPIRED
CANCELLED
SUPERSEDED
```

### Recovery actions

```text
RETRY
RECONCILE
CANCEL
VOID
REVERSAL
COMPENSATION
MITIGATION_ONLY
```

### Recovery outcome

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

### Identity

```text
WorkOccurrenceId
EffectId
AttemptId
WorkerClaimId
ExecutionClaimId
ProviderOperationId
ProviderIdempotencyToken
OutcomeEvidenceId
RecoveryEffectId
RecoveryAttemptId
RecoveryOutcomeEvidenceId
```

---

## 3. Target recovery flow

```text
failure / timeout / crash / correction
→ locate WorkOccurrence + Effect
→ determine strongest original outcome
→ classify certainty
→ if external effect may exist and is unknown:
     OUTCOME_UNKNOWN → RECONCILE
→ if provider success confirmed but local consequences incomplete:
     CONSEQUENCE_INCOMPLETE → REPAIR CONSEQUENCES, DO NOT RE-SEND
→ verify work/recovery remains live
     cancellation / supersession / expiry / current source state
→ evaluate recovery authority / Clearance
→ choose recovery action

RETRY
  → same EffectId
  → new AttemptId

REVERSAL / COMPENSATION
  → new RecoveryEffectId
  → own Clearance / outcome

→ preserve original OutcomeEvidence
→ preserve RecoveryOutcomeEvidence
→ converge domain/provider/financial consequences
→ terminalize truthfully
```

---

## 4. Current → target fabric mapping

| Current fabric | Preserve | Correct / add | Do not infer |
|---|---|---|---|
| BullMQ AiPlan jobs | job identity, attempts, backoff, locks/stalled recovery | map attempt failure to logical RETRYING; align dispatcher idempotency terminality | BullMQ failure = logical final failure |
| ActionDispatcher | central effect seam, execution log, governance hook | atomic effect claim; failed-attempt vs final outcome; post-provider consequence phase | failed execution log = forever-consumed effect key |
| OutboundDelivery | stable delivery ID, Sending claim, DeliveryEvent, retry/operator UI | OUTCOME_UNKNOWN; provider idempotency; split provider-call errors from local consequence errors; reconciliation | local post-provider DB failure = provider failure |
| TransactionalEmail queue | queued durable row | atomic drain claim; stable effect/dedupe identity through send; provider reconciliation | DRAINED/FAILED without effect lineage |
| ScheduledAgentJob | durable job/checkpoint identity | typed retry/dead-letter/unhandled state; execution claim; child effect lineage | unknown handler = completed |
| WebhookEvent | provider occurrence identity | processing lifecycle + repair/replay ownership | first-seen = processed successfully |
| SagaExecution/SagaStep | durable step/recovery history | typed compensation outcome; preserve recovery outcome; per-effect RecoveryEffectId | handler returned = compensation confirmed |
| KeyCortex plan | plan/step identity/dependencies | resumable child state; preserve completed children; explicit retry/resume policy | parent execute-again = safe resume |
| Payment / finance | provider IDs, Payment rows, posting/reconciliation seams | K10 consequence completeness; provider-success/local-failure state; actual retry owner | PENDING = provider retry; REFUNDED row = financial convergence |
| SocialPost | publication results/provider IDs | distinguish local delete from provider delete; per-destination reversal outcome | deletedAt = external deletion |

---

## 5. Recovery state dimensions — do not compress

Target systems should avoid one overloaded `status` when multiple truths exist.

Minimum conceptual dimensions:

```yaml
work_state: RETRYING | AWAITING_EXTERNAL | SUCCEEDED | FAILED_FINAL | ...
original_outcome: succeeded | failed_confirmed | unknown | awaiting_external
consequence_state: complete | incomplete | reconciling
recovery_action: retry | reconcile | reverse | compensate | ...
recovery_state: requested | attempted | succeeded | failed | unavailable | mitigation_only
```

Current models may project these dimensions differently. L6 must map exact fields before schema decisions.

---

## 6. Recovery authority target

From J15/J6 reinjection:

```text
RECONCILE
→ read/reconciliation authority

RETRY same EffectId
→ may inherit explicitly bounded retry scope from current Clearance
→ still revalidate authority/policy/source state where material

CANCEL / STOP
→ explicit stop right; may be broader than execute authority

VOID
→ current domain mutation authority

REVERSAL / COMPENSATION
→ new RecoveryEffectId
→ new ActionEnvelope
→ current proportional authority/control
→ fresh Clearance where material
```

Standing J6 autonomy must include an explicit recovery policy/budget. Failure never widens autonomy.

---

## 7. External/provider target

Adopted properties:

```text
stable KeyFlow EffectId
→ provider-native idempotency token where supported
→ provider operation ID captured
→ callback/status lookup reconciliation
```

Provider success is a one-way semantic boundary for that attempt:

```text
PROVIDER SUCCESS OBSERVED
→ external execution no longer retryable as if it failed
→ only consequence repair / downstream reconciliation remains
```

Stripe checkout metadata is a positive pattern: bind local business lineage into provider-owned metadata before PONR where available.

---

## 8. Financial recovery target — K10

```text
provider payment/refund outcome
+ Payment evidence
+ ledger posting/reversal
+ invoice/order reconciliation
= FINANCIAL_TRUTH_CONVERGED
```

If one consequence fails:

```text
known financial effect
→ CONSEQUENCE_INCOMPLETE
→ idempotent repair
→ do not repeat provider effect
```

---

## 9. Operator target — extend KF-REC-047

Cross-domain operator projection should explain:

```yaml
work_occurrence_id: ...
effect_id: ...
work_state: ...
original_outcome: ...
consequence_state: ...
failure_class: ...
provider_operation_id: ...
retry_safe: true|false|unknown
reconcile_available: true|false
cancel_available: true|false
reversal_available: true|false
compensation_available: true|false
recovery_authority_state: cleared|requires_control|denied
recovery_state: ...
```

The projection remains derivative. Domain/provider records remain sources of truth.

---

## 10. Value-engineering decisions

### Why not one universal DLQ?

Current failed-work stores have materially different semantics:

- BullMQ failed set = transport retry machinery;
- OutboundDelivery = domain delivery work + operator retry;
- WebhookEvent = ingress occurrence, not work queue;
- Saga/AiExecutionLog = evidence/history;
- ScheduledAgentJob = domain scheduler row;
- Payment = financial evidence, not executable queue.

Flattening them now would erase semantics and create a new source of truth.

### Why not one recovery worker?

Recovery actions need domain/provider-specific behavior and authority:

- resend/reconcile provider communication;
- replay ingress consequence;
- refund/financial repair;
- void/cancel domain object;
- provider delete;
- compensation message.

One worker would become a mega-dispatcher before effect contracts converge.

### Why one Recovery Contract?

Because every fabric must answer the same safety questions:

```text
what effect?
what attempt?
what is known externally?
is retry safe?
is work still valid?
is recovery authorized?
what evidence proves recovery?
```

---

## 11. Migration waves

### Wave A — Characterize / prove current recovery semantics

- exact current status/field mapping per fabric;
- characterization tests for retries, waits, failures, provider success/local failure;
- operator surface inventory.

### Wave B — Identity and attempt/outcome separation

- preserve stable EffectId through retries;
- distinguish AttemptId from EffectId;
- correct failed-idempotency tombstones;
- preserve child terminality on resume.

### Wave C — External uncertainty and post-provider consequence phase

- OUTCOME_UNKNOWN;
- provider-native idempotency where supported;
- provider operation lineage;
- split provider call exception boundary from local consequence boundary;
- consequence repair instead of duplicate send.

### Wave D — Recovery authority / stop semantics

- Clearance recovery scope;
- J6 recovery budgets;
- current eligibility revalidation;
- pause/kill/revoke domination;
- fresh control for reversals/compensations.

### Wave E — Financial consequence convergence

- K10 mappings;
- manual/provider refund convergence;
- consequence-aware webhook dedupe;
- payment retry ownership;
- provider success/local failure recovery.

### Wave F — Operator projection

- extend Temporal Work Projection with certainty/recovery fields;
- per-destination external recovery status;
- safe actions: retry/reconcile/cancel/reverse/compensate.

### Wave G — Physical convergence reassessment

Only after A–F:

- reassess whether a shared RecoveryOccurrence persistence model adds value;
- reassess whether any shared dead-letter store/worker is justified;
- keep domain sources authoritative unless evidence proves consolidation benefit.

---

## 12. Remaining L6 blockers

J18 is conceptually/value-engineered enough to enter target convergence, but not execution-ready.

Remaining blockers:

1. exact field/status mapping for all major recovery fabrics;
2. exact current retry budgets/backoff/expiry per work family;
3. exact provider-idempotency/reconciliation support by material provider;
4. live-row migration strategy for overloaded `FAILED/PENDING/SENT/PUBLISHED` states;
5. exact schema/projection representation of `CONSEQUENCE_INCOMPLETE`;
6. exact J15 Clearance recovery-scope representation;
7. exact J6 recovery-policy/budget representation;
8. per-provider reversal/delete/cancel support mapping for remaining material integrations;
9. operator permission/action model;
10. Temporal Work Projection recovery-query/materialization mapping;
11. characterization test inventory and concurrency/crash proof plan;
12. compatibility treatment for legacy ingress/provider paths;
13. bounded KF-EXEC packet boundaries.

---

## 13. Proof plan

Required proof families:

### Retry identity

- retry same EffectId, new AttemptId;
- failed attempt does not terminalize live work;
- success blocks duplicate effect.

### Post-provider crash

- provider success + local DB failure → consequence repair, no provider resend;
- provider operation lineage survives restart.

### Unknown outcome

- timeout after possible effect → OUTCOME_UNKNOWN;
- reconciliation before retry.

### Resume

- completed child not replayed;
- waiting child resumes same occurrence.

### Recovery authority

- retry blocked after revocation;
- bounded retry continues without unnecessary new approval;
- reversal/compensation gets fresh control when required.

### Financial

- provider refund/capture + partial local failure converges Payment/ledger/invoice;
- dedupe repairs consequence without duplicate money movement.

### Reversal

- local delete does not claim provider deletion;
- provider-native reversal records per-destination RecoveryOutcomeEvidence.

### Operator

- unsafe retry unavailable for OUTCOME_UNKNOWN;
- projection exposes strongest known truth and allowed actions.

No runtime tests were executed during this architecture pass.

---

## 14. J18 maturity verdict

J18 has completed enough of:

```text
MAP
→ MICROSCOPIC TRACE
→ CROSS-FABRIC RECONCILIATION
→ STANDARDS/PROVIDER RESEARCH
→ POOL
→ VALUE ENGINEERING
```

to move to:

> **L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE**

It is **not** execution-ready. L6 blockers above must converge with J23 before bounded KF-EXEC packets are generated.

---

## 15. Machine-readable record

```yaml
id: KF-JOURNEY-018
target_status: L5_VALUE_ENGINEERED_ENTERING_L6
architecture_decision:
  shared_recovery_semantic_contract: YES
  shared_failure_certainty_taxonomy: YES
  shared_recovery_action_taxonomy: YES
  shared_operator_projection: YES
  universal_dead_letter_table: NOT_JUSTIFIED_YET
  universal_recovery_worker: NOT_JUSTIFIED_YET
  universal_recovery_occurrence_table: NOT_JUSTIFIED_YET
  generic_undo_semantic: NO
  provider_native_reversal_where_available: YES
  per_destination_recovery_outcome: YES
  financial_truth_kernel: KF-KERNEL-010
migration_waves:
  - characterize_and_proof
  - identity_attempt_outcome_separation
  - external_uncertainty_and_post_provider_consequence
  - recovery_authority_and_stop
  - financial_consequence_convergence
  - operator_projection
  - physical_convergence_reassessment
implementation_authorized: false
```
