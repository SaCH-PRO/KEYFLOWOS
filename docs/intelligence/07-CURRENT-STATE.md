# KeyFlowOS Current State

Last updated: 2026-09-03 local / 2026-09-04 UTC

## Analytical phase

`COMPUTABLE_DIGITAL_TWIN / JOURNEY_KERNEL_CONVERGENCE / J18_RECOVERY_FORENSICS`

## Status

`J23 L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE — J18 ACTIVE MICROSCOPIC RECOVERY PASS ADVANCED`

Production implementation remains blocked.

Context integrity: `PASS`.

## Implementation evidence baseline

Current `main`:

`5ec358e9b792817eda1e37fd80a0574eb7905a8a`

This is an audit-only commit directly on top of code-bearing baseline:

`d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

The inspected implementation paths remain semantically unchanged. Revalidate again if `main` gains code-bearing changes.

## Canonical operating model

```text
25 JOURNEYS
+ 12 KERNELS
+ JOURNEY CONSTELLATIONS
+ KERNEL CONSTELLATIONS
+ GLOBAL INVARIANTS
+ FINDINGS / CONTRADICTIONS / OPEN QUESTIONS
+ STANDARDS / OSS / WORKING-MODEL RESEARCH
+ TARGET STATE / MIGRATION / PROOF
+ DEPENDENCY / IMPACT GRAPH
= COMPUTABLE KEYFLOWOS DIGITAL TWIN
```

Prime thesis:

> KeyFlowOS is a governed business-state transition system.

Current causal model:

```text
External reality
→ observation/signal
→ Business Graph
→ Genome interpretation
→ KEY reasoning
→ CapabilityContract
→ ActionEnvelope
→ Effective Human Authority + KEY autonomy/delegation + readiness + policy
→ ControlRequirement
→ typed ControlEvidence
→ exact-action Clearance
→ durable WorkOccurrence / temporal eligibility where needed
→ worker/coordination claim
→ atomic ExecutionClaim
→ ActionDispatcher
→ domain/provider effect
→ AWAITING_EXTERNAL / OUTCOME_UNKNOWN where needed
→ OutcomeEvidence / reconciliation
→ terminal execution outcome
→ optional recovery/reversal/compensation effect
→ RecoveryOutcomeEvidence
→ Business Graph / Genome evolution
```

## Active constellation

```text
J1 Business Birth
  ↕
J25 Human Authority
  ↕
J2 Governed Action
  ↕
J15 Approval / Governance
  ↕
J6 Proactive KEY / Autonomy
  ↕
J14 External Event Ingress
  ↕
J23 Temporal Flow / Long-Running Workflow
  ↕
J18 Failure / Recovery
```

## Active kernel cluster

```text
K3 Governance
→ K5 Capability
→ K6 State Transition
→ K7 Temporal / Workflow
→ K11 Recovery / Reliability
→ K8 Evidence / Outcome
→ K9 Integration / External Reality
```

Boundary:

```text
K7  = what logical work exists, waits, becomes eligible, expires/cancels/supersedes and terminalizes
K11 = attempt/effect ownership, retry/crash/recovery/compensation semantics
K9  = provider/external reality, point-of-no-return and reconciliation
K8  = what evidence makes execution and recovery claims truthful
```

## Journey state

- J15: `L4 SEMANTICALLY RECONCILED / ENTERING L5`; recovery now adds a fresh question: retry/reverse/compensate may require new Clearance, not inherited stale approval.
- J6: active autonomy/governance stress-test; recovery authority must respect stop/pause/kill, expiry, source-state and current policy.
- J14: provider lifecycle/correction events remain a primary reconciliation input.
- J23: `L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE`.
- J18: `ACTIVE FORENSICS / MICROSCOPIC RECOVERY PASS ADVANCED`.

## Canonical register ranges

```text
Findings:        F154
Contradictions:  C104
Recommendations: KF-REC-047
```

Latest recovery sequence:

```text
F150 failed ActionDispatcher idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local/non-replicated
F152 saga compensation can falsely report `compensated`
F153 KeyCortex approval wait can become parent plan/saga failure
F154 planner overwrites saga compensation outcome with generic failed

C100 retry policy vs idempotency terminality
C101 recovery promise vs recovery-state durability
C102 compensated claim vs confirmed inverse effect
C103 child control wait vs parent workflow failure
C104 recovery outcome vs generic failed overwrite
```

Canonical continuations:

- `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`

No new recovery recommendation has been accepted yet. Pool J18 first. Existing KF-REC-037, KF-REC-040, KF-REC-044 and KF-REC-047 remain directly relevant.

## J23 target-convergence verdict

```text
SHARED DURABLE-WORK SEMANTIC CONTRACT     = YES
SHARED CROSS-DOMAIN TEMPORAL PROJECTION   = YES
UNIVERSAL NEW WorkOccurrence TABLE        = NOT JUSTIFIED YET
UNIVERSAL NEW WORKFLOW RUNTIME             = NOT JUSTIFIED YET
```

Target work states remain:

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

## J18 recovery model

Failure-certainty axis:

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

Recovery-outcome axis:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Core recovery laws:

```text
Attempt failure != logical-work failure
Failed idempotency evidence != retry exhaustion
Provider timeout != confirmed non-effect
Control wait != failure
Undo != retry != reversal != compensation
Compensation handler return != confirmed inverse effect
Original execution outcome != recovery outcome
Recovery must revalidate cancellation/supersession/expiry/version/source-state/authority
```

## J18 forensic progress

### Completed microscopic traces

1. **ActionDispatcher + BullMQ retry algebra**
   - F150 confirmed end-to-end.
   - Inner dispatcher retry failure can tombstone the stable idempotency key and neutralize later BullMQ attempts.

2. **OutboundDelivery + adapters + operator retry**
   - strong stable delivery identity, expected-state `Sending` claim, retry/backoff and DeliveryEvent evidence;
   - manual retry/retry-all-failed surfaces exist;
   - `success/isTransient` lacks `OUTCOME_UNKNOWN` and provider-native effect identity requirements;
   - strengthens F149/KF-REC-037 rather than creating a duplicate.

3. **ScheduledAgentJob**
   - F122/F123 revalidated;
   - generic `FAILED` has no observed generic retry/dead-letter consumer;
   - producer job-type breadth exceeds generic consumer routing; unknown work can be falsely completed.

4. **CustomerNotificationLog drain**
   - F144 revalidated: no atomic drain claim and original queued dedupe/effect identity is dropped on replay.

5. **SagaExecution / compensation first pass**
   - production KeyCortex planner itself creates SagaExecution/SagaStep and compensation metadata before effect; this is a real seam to preserve;
   - F152 false compensation success;
   - F153 approval wait -> parent failure;
   - F154 compensation outcome overwritten by `failSaga()`.

### Positive seams to preserve

- BullMQ durable job identity / attempts / backoff / locks / stalled recovery;
- ActionDispatcher central effect boundary;
- OutboundDelivery + DeliveryEvent;
- SagaExecution + SagaStep durable evidence;
- quote-followup cancellation + source-state revalidation;
- K9 provider reconciliation;
- Temporal Work Projection as future operator/recovery read model.

## Immediate next work

### P0 — continue J18 microscopic recovery pass

1. trace provider/domain reversal, refund and cancellation semantics across payments, invoices, bookings, messages/social and other material effects;
2. trace operator diagnostics/repair endpoints across AI plans, ScheduledAgentJob, ingress and sagas;
3. classify dead-letter semantics by work family;
4. build per-fabric recovery matrix: `certainty → effect identity → point-of-no-return → retry/reconcile/reverse action → terminal evidence`;
5. trace representative crash windows after possible provider effect but before local persistence;
6. define recovery authority/control requirements and whether retry/reverse/compensate needs fresh Clearance;
7. compare with external standards/OSS and adopt properties rather than products;
8. pool and reinject J18 into J23/K11/K9/K8/J15/J6.

### P1 — finish J23 L6 blockers after J18 pressure stabilizes

9. exact current-model field/status mapping;
10. live-row migration compatibility;
11. work-family lateness policy validation;
12. definition-edit policy by product family;
13. provider-specific terminal evidence/reconciliation;
14. exact J15 Clearance integration;
15. exact J6 stop/pause integration;
16. Temporal Work Projection query/materialization strategy;
17. characterization/proof plan sufficient for bounded KF-EXEC packets.

## Still unresolved system-wide

- final persistence for ControlEvidence / Clearance / ExecutionClaim;
- Effective Authority Resolver implementation/migration;
- capability/permission vocabulary convergence;
- approval-regime migration;
- ActionDispatcher universal post-clearance boundary;
- canonical EventEnvelope / consequence ownership;
- durable IngressOccurrence implementation;
- provider/financial reconciliation breadth;
- recovery-effect and recovery-evidence persistence shape;
- operator repair/dead-letter UX and authority;
- Business Graph / Genome / readiness feedback integrity;
- remaining journey/kernel/constellation convergence;
- K10/K12 convergence when evidence pressure justifies;
- execution compiler + bounded KF-EXEC packets only after convergence.

## Do not yet

- modify production code;
- freeze persistence schemas prematurely;
- create parallel `*2`/`v2` sources of truth;
- install Temporal/Camunda because temporal/recovery defects exist;
- treat transport state as logical work truth;
- treat provider acceptance as delivery/settlement evidence;
- blindly retry OUTCOME_UNKNOWN;
- treat a non-throwing compensation handler as confirmed reversal;
- treat AWAITING_CONTROL as failure;
- erase recovery outcome with original failure;
- claim runtime/tests passed unless actually executed.
