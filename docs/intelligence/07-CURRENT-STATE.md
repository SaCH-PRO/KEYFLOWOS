# KeyFlowOS Current State

Last updated: 2026-09-03 local / 2026-09-04 UTC

## Analytical phase

`COMPUTABLE_DIGITAL_TWIN / JOURNEY_KERNEL_CONVERGENCE / J18_RECOVERY_TARGET_POOLING`

## Status

`J23 L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE — J18 ACTIVE FORENSICS / ENTERING TARGET POOLING`

Production implementation remains blocked.

Context integrity: `PASS`.

## Implementation evidence baseline

```text
main head:          5ec358e9b792817eda1e37fd80a0574eb7905a8a
code-bearing base:  d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
head class:         audit-only
```

Revalidate if `main` gains code-bearing changes.

## Prime thesis

> KeyFlowOS is a governed business-state transition system.

Current causal model now extends through recovery:

```text
External reality
→ observation / Business Graph / Genome
→ KEY reasoning
→ CapabilityContract / ActionEnvelope
→ current authority + policy
→ ControlRequirement / ControlEvidence / Clearance
→ WorkOccurrence / eligibility
→ worker claim / AttemptId
→ ExecutionClaim / EffectId
→ domain/provider effect
→ AWAITING_EXTERNAL / OUTCOME_UNKNOWN where needed
→ OutcomeEvidence / reconciliation
→ terminal original outcome
→ RETRY on same EffectId OR new RecoveryEffectId for reversal/compensation
→ RecoveryOutcomeEvidence
→ Business Graph / Genome evolution
```

## Active constellation

```text
J1 ↔ J25 ↔ J2 ↔ J15 ↔ J6 ↔ J14 ↔ J23 ↔ J18
```

Active kernel pressure:

```text
K3 Governance
→ K5 Capability
→ K6 State Transition
→ K7 Temporal / Workflow
→ K11 Recovery / Reliability
→ K8 Evidence / Outcome
→ K9 External Reality
→ K10 Financial Truth where recovery is monetary
```

## Canonical ranges

```text
Findings:        F157
Contradictions:  C107
Recommendations: KF-REC-048
```

Latest J18 findings:

```text
F150 ActionDispatcher failed idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility process-local
F152 Saga compensation can falsely report compensated
F153 KeyCortex approval wait can become parent failure
F154 Planner overwrites saga recovery outcome with generic failed
F155 Provider refund can bypass ledger/invoice reconciliation and suppress webhook repair
F156 Payment retry flips FAILED->PENDING without observed provider recovery owner
F157 Plan execute-again can replay completed steps
```

Latest contradictions: C100–C107.

Latest recommendation:

`KF-REC-048 — Establish a certainty-aware Recovery Contract across existing execution fabrics.`

Canonical artifacts:

- `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
- `10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md`
- `journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
- `investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
- `investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md`

## J18 target decisions

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

Recovery actions:

```text
RETRY      = same EffectId, new AttemptId
RECONCILE  = observe truth, no new business effect
CANCEL     = prevent not-yet-effective work
VOID       = domain cancellation where legal
REVERSAL   = new inverse RecoveryEffectId
COMPENSATE = new mitigating RecoveryEffectId
MITIGATION = follow-up where inverse effect impossible
```

Core recovery laws:

```text
attempt failure != logical-work failure
original outcome != recovery outcome
effect dedupe != consequence completeness
provider timeout != confirmed non-effect
control wait != failure
pending status != executable recovery work
re-execute parent != resume unresolved children
failure/time != recovery authority
```

## Operator / dead-letter verdict

```text
ONE RECOVERY SEMANTIC CONTRACT       YES — KF-REC-048
ONE CROSS-DOMAIN OPERATOR PROJECTION YES — via KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE      NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER        NOT JUSTIFIED YET
```

Different existing failure sinks remain domain/transport-specific during migration.

## Strong seams to preserve

- BullMQ attempts/backoff/locks/stalled recovery;
- ActionDispatcher central effect boundary;
- OutboundDelivery + DeliveryEvent + operator retry;
- SagaExecution + SagaStep durable evidence;
- provider IDs/idempotency/reconciliation;
- `CommerceService.markPaymentRefunded()` + ledger reversal;
- provider refund `createRefundWithPosting()` + invoice reconciliation;
- quote-followup cancellation/current-state revalidation;
- KF-REC-047 Temporal Work Projection.

## External reference properties adopted

- Stripe `Idempotency-Key` safe retry property;
- PayPal `PayPal-Request-Id` safe modifying-request retry property;
- provider operation IDs as reconciliation evidence;
- BullMQ retry/job IDs as queue lifecycle semantics, not business-effect terminal truth.

## J23 decisions remain

```text
SHARED DURABLE-WORK SEMANTIC CONTRACT = YES
SHARED TEMPORAL WORK PROJECTION       = YES
UNIVERSAL WorkOccurrence TABLE        = NOT JUSTIFIED YET
UNIVERSAL WORKFLOW RUNTIME             = NOT JUSTIFIED YET
```

J18 now supplies the recovery semantics that J23 lacked for L6 proof/migration mapping.

## Immediate next work

### P0 — finish J18 pressure and pooling

1. trace provider-effect-succeeded / local-persistence-failed crash windows beyond refunds;
2. complete remaining material provider/domain cancellation/reversal matrix;
3. backward re-audit J15/J6 for recovery authority / fresh Clearance;
4. reinject KF-REC-048 into K11/K9/K8/K10;
5. decide whether J18 is ready to enter L5 value-engineering / target convergence.

### P1 — feed J18 back into J23 L6

6. exact current-model field/status mapping;
7. live-row migration compatibility for retry/failed/unknown/recovery states;
8. provider-specific terminal/reconciliation evidence;
9. exact Clearance integration for retry/reverse/compensate;
10. Temporal Work Projection operator query/materialization strategy;
11. characterization/crash/concurrency proof plan.

## Still unresolved system-wide

- ControlEvidence / Clearance / ExecutionClaim persistence;
- Effective Authority Resolver migration;
- capability vocabulary convergence;
- ActionDispatcher universal post-clearance role;
- canonical EventEnvelope / consequence ownership;
- durable IngressOccurrence lifecycle;
- recovery-effect / recovery-evidence persistence shape;
- financial/provider reconciliation breadth;
- operator recovery authority UX;
- Business Graph / Genome feedback integrity;
- remaining journey/kernel/constellation convergence;
- K12 engineering-control-plane convergence;
- execution compiler / KF-EXEC generation after convergence.

## Do not yet

- modify production code;
- create parallel v2 sources of truth;
- install Temporal/Camunda from findings alone;
- treat transport state as logical-work truth;
- blindly retry OUTCOME_UNKNOWN;
- treat compensation handler return as confirmed reversal;
- let effect dedupe suppress missing consequence repair;
- treat a status flip as a provider retry;
- replay completed children during parent resume;
- claim runtime/tests passed unless executed.
