# KeyFlowOS Intelligence — START HERE

This directory is the durable source of truth for architectural and product intelligence developed across ChatGPT, Claude Code, Kimi/Gemini Code, repository analysis, source documents and human review.

## Prime directive

Conversations are working memory. This repository is durable memory.

No materially important conclusion about KeyFlowOS is preserved until written into the appropriate canonical intelligence artifact.

## Governing analysis rule

**MAP BEFORE MODIFYING.**

Production behavior must not be changed merely because a local problem appears obvious. First determine affected journeys, constellations, kernels, state transitions, authority, capability, evidence, dependencies, contradictions, compatibility surfaces, migration and proof requirements.

## Required load order

1. `AGENTS.md`
2. `docs/intelligence/AGENT-CONTINUITY.md`
3. `docs/intelligence/00-START-HERE.md`
4. `docs/intelligence/01-MASTER-CONTEXT.md`
5. `docs/intelligence/02-SYSTEM-MODEL.md`
6. `docs/intelligence/03-ANALYSIS-MAP.md`
7. `docs/intelligence/04-CONCEPT-REGISTRY.md`
8. `docs/intelligence/05-DECISION-REGISTER.md`
9. `docs/intelligence/06-OPEN-QUESTIONS.md`
10. `docs/intelligence/07-CURRENT-STATE.md`
11. canonical finding register + all current `08*` supplements
12. canonical contradiction register + all current `09*` supplements
13. canonical recommendation register + all current `10*` continuations
14. `docs/intelligence/11-RECURSIVE-ASSURANCE-PROGRAMME.md`
15. `docs/intelligence/12-KERNEL-PROGRAMME.md`
16. `docs/intelligence/13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`
17. `docs/intelligence/14-STANDARDS-RESEARCH-INNOVATION-METHOD.md`
18. `docs/intelligence/15-EXPORTABLE-DIGITAL-TWIN-SPEC.md`
19. `docs/intelligence/16-KEYFLOWOS-ARCHITECT-AGENT-CONTRACT.md`
20. `docs/intelligence/16-SYSTEM-DYNAMICS-QUALITY-DIMENSIONS.md`
21. `docs/intelligence/handoff/CURRENT-HANDOFF.md`
22. `docs/intelligence/handoff/CURRENT-STATE.yaml`
23. active journey/kernel/investigation files referenced by current state.

Do not continue substantive work until required context is loaded or a missing-file condition is explicitly reported.

## Core operating model

```text
25 JOURNEYS
+ JOURNEY CONSTELLATIONS
+ 12 KERNELS
+ KERNEL CONSTELLATIONS
+ GLOBAL INVARIANTS / FINDINGS / RESEARCH
+ TARGET STATE / MIGRATION / PROOF / GRAPH
= COMPUTABLE KEYFLOWOS DIGITAL TWIN
```

## Active analytical mesh

```text
J1 Business Birth
↕ J25 Human Authority
↕ J2 Governed Action
↕ J15 Approval / Governance
↕ J6 Proactive KEY / Autonomy
↕ J14 External Event Ingress
↕ J23 Temporal Flow / Long-Running Workflow
↕ J18 Failure / Recovery
```

Current frontier:

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
J18 = ACTIVE FORENSICS / ENTERING TARGET POOLING
```

Production implementation remains unauthorized.

## Current canonical ranges

```text
Findings:        F157
Contradictions:  C107
Recommendations: KF-REC-048
```

Current `08A` through `08K`, `09A` through `09K`, and `10A` through `10G` are canonical continuations, not optional notes.

## Architectural thesis

> **KeyFlowOS is a governed business-state transition system.**

```text
External reality
→ observation / Business Graph / Genome
→ KEY reasoning
→ CapabilityContract / ActionEnvelope
→ current authority + policy
→ ControlRequirement / ControlEvidence / Clearance
→ durable WorkOccurrence / eligibility
→ worker claim / AttemptId
→ ExecutionClaim / EffectId
→ domain/provider effect
→ AWAITING_EXTERNAL / OUTCOME_UNKNOWN where needed
→ OutcomeEvidence / reconciliation
→ terminal original outcome
→ RETRY same EffectId OR new RecoveryEffectId for reversal/compensation
→ RecoveryOutcomeEvidence
→ Business Graph / Genome evolution
```

## J23 decisions

```text
ONE SHARED DURABLE-WORK SEMANTIC CONTRACT = YES
ONE CROSS-DOMAIN TEMPORAL WORK PROJECTION = YES
ONE UNIVERSAL WorkOccurrence TABLE        = NOT JUSTIFIED YET
ONE UNIVERSAL WORKFLOW RUNTIME             = NOT JUSTIFIED YET
```

Target J23 distinctions remain:

```text
Definition != Occurrence
Occurrence != Attempt
Waiting != Completed
Queued != Running
Attempt Failed != Logical Step Failed
Worker Claim != ExecutionClaim
Approval != Clearance
Cancel Requested != Cancellation Proven
Overdue != Still Valid
Provider Acceptance != Delivery/Settlement
Ambiguous External Outcome != Confirmed Failure
Workflow Completion != Business Outcome
```

## J18 recovery target

Load especially:

- `journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
- `investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
- `investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md`
- `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
- `10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md`

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
RETRY      same EffectId, new AttemptId
RECONCILE  observe authoritative state
CANCEL     prevent not-yet-effective work
VOID       domain cancellation where legal
REVERSAL   new inverse RecoveryEffectId
COMPENSATE new mitigating RecoveryEffectId
MITIGATION follow-up where inverse effect impossible
```

Core laws:

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

Latest J18 findings:

```text
F150 failed ActionDispatcher idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local
F152 saga compensation can falsely report compensated
F153 KeyCortex approval wait can become parent failure
F154 planner overwrites recovery outcome with generic failed
F155 provider refund can bypass ledger/invoice reconciliation and suppress webhook repair
F156 payment retry flips FAILED -> PENDING without observed provider recovery owner
F157 plan execute-again can replay completed steps
```

## KF-REC-048

`Establish a certainty-aware Recovery Contract across existing execution fabrics.`

Relationship:

```text
KF-REC-038 Durable WorkOccurrence
→ KF-REC-040 logical != attempt state
→ KF-REC-048 certainty-aware recovery contract
→ KF-REC-037 provider reconciliation
→ KF-REC-047 Temporal Work Projection / operator visibility
```

Recovery target decision:

```text
ONE RECOVERY SEMANTIC CONTRACT       = YES
ONE CROSS-DOMAIN OPERATOR PROJECTION = YES, via KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE      = NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER        = NOT JUSTIFIED YET
```

## Strong seams

Prefer strengthening rather than replacing:

- BullMQ delayed/attempt/lock/stalled machinery;
- ActionDispatcher central effect boundary;
- OutboundDelivery / DeliveryEvent;
- SagaExecution / SagaStep evidence;
- provider operation IDs + lifecycle callbacks;
- `CommerceService.markPaymentRefunded()` + ledger reversal;
- provider refund `createRefundWithPosting()` + invoice reconciliation;
- quote-followup cancellation + current-state revalidation;
- KF-REC-047 Temporal Work Projection.

## External properties adopted

- Stripe idempotency-key safe retry semantics;
- PayPal `PayPal-Request-Id` retry/idempotency semantics;
- provider operation IDs as reconciliation evidence;
- BullMQ retry/job identity as transport/job lifecycle rather than business-effect finality.

Adopt properties, not products.

## Exact next work

```text
provider-effect-success / local-persistence-failure crash windows beyond refunds
→ remaining provider/domain cancellation + reversal matrix
→ J15/J6 backward re-audit for recovery authority / fresh Clearance
→ KF-REC-048 reinjection into K11/K9/K8/K10
→ J18 → J23 L6 field/status/migration/proof reinjection
→ decide J18 L5 value-engineering readiness
```

## Knowledge discipline

Use evidence classification and preserve:

```text
evidence
→ interpretation
→ architectural implication / recommendation
→ accepted decision
```

Never claim runtime/tests passed unless actually executed.

## Implementation control

```text
mapped
→ cross-referenced
→ semantically reconciled
→ value-engineered
→ target-converged
→ migration understood
→ proof designed
→ execution-ready
```

Only then create bounded `KF-EXEC-*` packets for Claude Code; Kimi/Gemini may adversarially review accepted invariants and resulting diffs.

## Do not

- modify production code without explicit authorization;
- create parallel `v2` sources of truth;
- install Temporal/Camunda from findings alone;
- treat transport state as logical-work truth;
- blindly retry `OUTCOME_UNKNOWN`;
- treat non-throwing compensation as confirmed reversal;
- let effect dedupe suppress missing consequence repair;
- treat a status flip as provider retry;
- replay completed children during parent resume;
- delete legacy without consumer proof;
- claim tests/runtime success unless executed.
