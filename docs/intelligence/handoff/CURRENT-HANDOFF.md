# KeyFlowOS Current Handoff

Last updated: 2026-09-03 local / 2026-09-04 UTC

## Load first

Read in order:

1. `docs/intelligence/00-START-HERE.md`
2. `docs/intelligence/07-CURRENT-STATE.md`
3. `docs/intelligence/handoff/CURRENT-STATE.yaml`
4. `docs/intelligence/journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
5. `docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
6. `docs/intelligence/08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
7. `docs/intelligence/09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
8. active J23/K7/K8/K9/K10/K11 materials referenced by current state.

Also keep loaded:

- `docs/intelligence/journeys/KF-JOURNEY-023-TEMPORAL-FLOW-LONG-RUNNING-WORKFLOW.md`
- `docs/intelligence/investigations/J23-TARGET-CONVERGENCE-AND-MIGRATION-MAP.md`
- `docs/intelligence/investigations/J23-EXTERNAL-OUTCOME-UNCERTAINTY-AND-RECONCILIATION.md`
- `docs/intelligence/kernels/KF-KERNEL-007-TEMPORAL-EVENT-WORKFLOW.md`
- `docs/intelligence/kernels/KF-KERNEL-008-EVIDENCE-OUTCOME.md`
- `docs/intelligence/kernels/KF-KERNEL-009-INTEGRATION-EXTERNAL-REALITY.md`
- `docs/intelligence/kernels/KF-KERNEL-010-FINANCIAL-TRUTH.md` if instantiated/current
- `docs/intelligence/kernels/KF-KERNEL-011-RECOVERY-RELIABILITY.md`
- all canonical `08*`, `09*`, `10*` continuations.

## Context integrity

`PASS`

Implementation evidence:

```text
main head:           5ec358e9b792817eda1e37fd80a0574eb7905a8a
code-bearing base:   d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
head change class:   audit-only
```

Revalidate if `main` gains code-bearing changes.

Production implementation remains unauthorized.

## Current analytical position

```text
J23 Temporal Flow / Long-Running Workflow
  = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
        ↓ pressure/reinjection
J18 Failure → Recovery
  = ACTIVE FORENSICS / MICROSCOPIC PASS ADVANCED
```

## Canonical ranges

```text
Findings:        F155
Contradictions:  C105
Recommendations: KF-REC-047
```

Latest J18 sequence:

```text
F150 failed ActionDispatcher idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local/non-replicated
F152 saga compensation can falsely report `compensated`
F153 KeyCortex approval wait can become parent plan/saga failure
F154 planner overwrites saga compensation outcome with generic failed
F155 provider-backed refund can bypass ledger/invoice reconciliation and suppress webhook repair

C100 retry policy vs idempotency terminality
C101 recovery promise vs recovery-state durability
C102 compensated claim vs confirmed inverse effect
C103 child control wait vs parent workflow failure
C104 recovery outcome vs generic failed overwrite
C105 confirmed provider refund vs split Payment/ledger/invoice truth
```

No new recovery recommendation is accepted yet. Pool/value-engineer J18 first.

## Recovery model now established

Failure certainty:

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
EXPIRED
CANCELLED
SUPERSEDED
SUCCEEDED
```

Recovery outcome:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Recovery action:

```text
RETRY      = same EffectId, new AttemptId
RECONCILE  = observe truth, no fresh business effect
CANCEL     = prevent not-yet-effective work
VOID       = domain-native cancellation where legal
REVERSAL   = new inverse RecoveryEffectId
COMPENSATE = new mitigating RecoveryEffectId
MITIGATION = annotation/follow-up where inverse effect impossible
```

Core laws:

```text
original execution outcome != recovery outcome
effect dedupe != consequence completeness
provider timeout != confirmed non-effect
control wait != failure
compensation handler return != confirmed inverse effect
financial reversal must converge Payment + ledger + invoice truth
```

## Current strong seams

Preserve/strengthen:

- BullMQ stable job identity / attempts / backoff / locks / stalled recovery;
- ActionDispatcher central effect boundary;
- OutboundDelivery + DeliveryEvent;
- SagaExecution + SagaStep durable evidence;
- `CommerceService.markPaymentRefunded()` local refund + ledger reversal transaction;
- provider refund webhook `createRefundWithPosting()` + invoice reconciliation;
- quote-followup cancellation + current source-state revalidation;
- K9 provider reconciliation;
- Temporal Work Projection as future operator/recovery read model.

## Current defects / refinements

### ActionDispatcher + BullMQ — F150

```text
BullMQ retry remains live
→ failed AiExecutionLog with stable key K
→ next BullMQ attempt reuses K
→ ActionDispatcher returns stored failure
→ no new effect attempt
```

Queue retry state does not own business-effect terminality.

### OutboundDelivery / provider ambiguity — strengthen F149

`success/isTransient` is insufficient when request may have crossed external point of no return. Manual retry is unsafe without certainty typing.

### Saga — F152/F153/F154

```text
handler returned != inverse effect confirmed
AWAITING_CONTROL != FAILED
recovery result must not be overwritten by original failure
```

### Financial reversal — F155

Provider-backed manual refund:

```text
Stripe/PayPal refund succeeds → refund id R
→ PaymentsOps creates local REFUNDED Payment R
→ no ledger reversal / no invoice reconcile
→ provider webhook R sees existing Payment
→ returns as duplicate
→ repair suppressed
```

This is not a generic “refunds broken” finding: `CommerceService.markPaymentRefunded()` and provider webhook paths already contain stronger financial-truth seams.

## External reference properties adopted

### Stripe

- POST idempotency keys permit safe retry after connection errors;
- refund events provide lifecycle/reconciliation evidence.

### PayPal

- `PayPal-Request-Id` is recommended for modifying POST/PUT requests and can safely bind retries, including refund operations.

### BullMQ

- attempts/backoff and manual job retry are transport/job lifecycle semantics;
- custom job ID is queue-scoped dedupe, not proof of business-effect terminality.

Current KeyFlow Stripe/PayPal refund connectors do not send the provider-native idempotency headers observed in these reference contracts.

Adopt properties, not products.

## Exact next actions

Remain read-only for production code.

1. Trace operator diagnostics/repair endpoints across AI plans, ScheduledAgentJob, ingress and sagas.
2. Classify dead-letter semantics by work family; do not assume one global DLQ.
3. Trace representative **provider effect succeeded / local persistence failed** windows beyond refunds.
4. Complete provider/domain cancel/reversal matrix for remaining material integrations.
5. Define exact recovery authority: when retry may continue prior bounded authority vs when reversal/compensation needs a fresh ActionEnvelope + Clearance.
6. Pool J18 into K11/K9/K8/K10 target laws and decide whether a new recommendation ID is justified.
7. Backward re-audit J15/J6 for recovery-created effects.
8. Reinject J18 into J23 and finish remaining L6 migration/proof blockers.

## J23 decisions still in force

```text
shared durable-work semantic contract     YES
shared Temporal Work Projection           YES
universal WorkOccurrence table            NOT JUSTIFIED YET
universal workflow runtime                NOT JUSTIFIED YET
```

## Do not

- modify production code;
- create parallel v2 sources of truth;
- install Temporal/Camunda from findings alone;
- treat queue/transport state as logical-work truth;
- treat provider acceptance as delivery/settlement;
- blindly retry OUTCOME_UNKNOWN;
- treat non-throwing compensation as confirmed reversal;
- treat AWAITING_CONTROL as failure;
- erase recovery outcome with original failure;
- let effect dedupe suppress missing consequence repair;
- claim tests/runtime proof unless executed.
