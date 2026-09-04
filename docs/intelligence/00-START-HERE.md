# KeyFlowOS Intelligence — START HERE

This directory is the durable source of truth for architectural and product intelligence developed across ChatGPT, Claude Code, Kimi/Gemini Code, repository analysis, source documents and human review.

## Prime directive

Conversations are working memory. This repository is durable memory.

No materially important conclusion about KeyFlowOS is preserved until written into the appropriate canonical intelligence artifact.

## Governing analysis rule

**MAP BEFORE MODIFYING.**

The architecture/research session is the command center. Production behavior must not be changed merely because a local problem appears obvious. First determine affected journeys, constellations, kernels, state transitions, authority, capability, evidence, dependencies, contradictions, compatibility surfaces, migration and proof requirements.

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
11. canonical finding register + **all current `08*` supplements**
12. canonical contradiction register + **all current `09*` supplements**
13. canonical recommendation register + **all current `10*` continuations**
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

For continuity-sensitive work, also read the most recent relevant session journal.

Do not continue substantive work until required context is loaded or a missing-file condition is explicitly reported.

## Core operating model

```text
25 JOURNEYS
= vertical end-to-end views

JOURNEY CONSTELLATIONS
= interacting closed-system loops

12 KERNELS
= horizontal shared architecture

KERNEL CONSTELLATIONS
= interacting invariant clusters

GLOBAL INVARIANTS + FINDINGS + RESEARCH
= pooled architecture truth

TARGET STATE + MIGRATION + PROOF + GRAPH
= computable digital twin
```

Journeys are not independent checklists. Kernels are not abstract replacements for journey evidence. Constellations are first-class analytical/export entities.

## Active analytical mesh

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
        ↕
KF-JOURNEY-015 — Approval / Governance Lifecycle
        ↕
KF-JOURNEY-006 — Proactive KEY / Autonomy
        ↕
KF-JOURNEY-014 — Webhook / External Event Ingress
        ↕
KF-JOURNEY-023 — Temporal Flow / Long-Running Workflow
        ↕
KF-JOURNEY-018 — Failure → Recovery
```

Current frontier:

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
J18 = ACTIVE MICROSCOPIC RECOVERY PASS ADVANCED
```

Production implementation remains unauthorized.

## Canonical kernel programme

1. Tenant Genesis & Identity
2. Human Authority & Organization
3. KEY Authority & Governance
4. Business Knowledge
5. Capability Fabric
6. State Transition
7. Temporal / Event / Workflow
8. Evidence & Outcome
9. Integration & External Reality
10. Financial Truth
11. Recovery & Reliability
12. Engineering Control Plane

Current active cluster:

```text
K3 Governance
→ K5 Capability
→ K6 State Transition
→ K7 Temporal / Workflow
→ K11 Recovery / Reliability
→ K8 Evidence / Outcome
→ K9 Integration / External Reality
→ K10 Financial Truth where recovery is monetary
```

Shared semantic defects should normally be recorded once and referenced by affected journeys rather than duplicated.

## Current architectural thesis

> **KeyFlowOS is a governed business-state transition system.**

```text
External reality
→ observation / signal
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
→ atomic ExecutionClaim / EffectId
→ canonical ActionDispatcher
→ domain/provider execution
→ AWAITING_EXTERNAL / OUTCOME_UNKNOWN where needed
→ OutcomeEvidence / reconciliation
→ terminal original outcome
→ retry or distinct RecoveryEffectId for reversal/compensation
→ RecoveryOutcomeEvidence
→ Business Graph / Genome evolution
```

## Current canonical ranges

```text
Findings:        F155
Contradictions:  C105
Recommendations: KF-REC-047
```

Current `08A` through `08K`, `09A` through `09K`, and `10A` through `10F` are canonical continuations, not optional notes.

Do not silently ignore supplements because an older monolithic register stops earlier.

## J23 convergence decision

```text
ONE SHARED DURABLE-WORK SEMANTIC CONTRACT
= YES

ONE CROSS-DOMAIN TEMPORAL WORK PROJECTION
= YES, as derivative read model

ONE UNIVERSAL WorkOccurrence TABLE
= not justified yet

ONE UNIVERSAL WORKFLOW RUNTIME
= not justified yet
```

Do not install Temporal/Camunda merely because J23/J18 found temporal or recovery defects. BullMQ, DB compare-and-set, OutboundDelivery, domain schedulers, ActionDispatcher, Saga evidence, provider IDs and existing reconciliation seams should be strengthened first.

## Active J23 target

Load especially:

- `journeys/KF-JOURNEY-023-TEMPORAL-FLOW-LONG-RUNNING-WORKFLOW.md`
- `investigations/J23-TARGET-CONVERGENCE-AND-MIGRATION-MAP.md`
- `investigations/J23-CANCELLATION-SUPERSESSION-AND-DESCENDANT-INVALIDATION.md`
- `investigations/J23-MISSED-SCHEDULE-AND-LATENESS-POLICY.md`
- `investigations/J23-WORKFLOW-DEFINITION-VERSIONING.md`
- `investigations/J23-EXTERNAL-OUTCOME-UNCERTAINTY-AND-RECONCILIATION.md`
- `investigations/J23-CANCELLATION-BACKWARD-REINJECTION-J6-J14-J15-K8-K9.md`
- `investigations/J23-BACKWARD-REINJECTION-LATENESS-VERSIONING-EXTERNAL-OUTCOME.md`

Target logical lifecycle:

```text
Definition(version)
→ WorkOccurrence
→ SCHEDULED / durable wait
→ lateness/misfire policy
→ cancellation/supersession/expiry
→ ELIGIBLE
→ worker claim
→ attempt
→ current source/authority/policy eligibility
→ ActionEnvelope + Clearance
→ ExecutionClaim
→ effect
→ AWAITING_EXTERNAL / OUTCOME_UNKNOWN where necessary
→ OutcomeEvidence / reconciliation
→ SUCCEEDED | FAILED_FINAL | CANCELLED | SUPERSEDED | EXPIRED
```

Core distinctions:

```text
Definition != Occurrence
Occurrence != Attempt
Waiting != Completed
Queued != Running
Attempt Failed != Logical Step Failed
Worker Claim != ExecutionClaim
Approval != Clearance
Handoff Complete != Effect Complete
Cancel Requested != Cancellation Proven
Overdue != Still Valid
Definition ID != immutable action semantics
Provider Acceptance != Delivery/Settlement
Ambiguous External Outcome != Confirmed Failure
Workflow Completion != Business Outcome
```

## Active J18 target

Load especially:

- `journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
- `investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
- `08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`

Failure-certainty taxonomy:

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

Recovery-outcome taxonomy:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Recovery action taxonomy:

```text
RETRY      same EffectId, new AttemptId
RECONCILE  observe authoritative state
CANCEL     prevent not-yet-effective work
VOID       domain cancellation where legal
REVERSAL   distinct inverse RecoveryEffectId
COMPENSATE distinct mitigating RecoveryEffectId
MITIGATION local follow-up when inverse effect impossible
```

Current recovery laws:

```text
attempt failure != logical-work failure
failed idempotency evidence != retry exhaustion
control wait != failure
provider timeout != confirmed non-effect
undo != retry != reversal != compensation
compensation handler return != confirmed inverse effect
original execution outcome != recovery outcome
effect dedupe != consequence completeness
financial reversal must converge Payment + ledger + invoice truth
```

Latest recovery findings:

```text
F150 ActionDispatcher failed idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local/non-replicated
F152 saga compensation can falsely report compensated
F153 KeyCortex approval wait can become parent plan/saga failure
F154 planner overwrites saga compensation outcome with generic failed
F155 provider-backed refund can bypass ledger/invoice reconciliation and suppress webhook repair
```

No new recovery recommendation is accepted yet. Pool and value-engineer J18 first.

## Adopted external reference properties

- Stripe idempotency keys for safe POST retry after connection failures;
- Stripe refund lifecycle events as reconciliation evidence;
- PayPal `PayPal-Request-Id` for safe retry of modifying requests, including refunds;
- BullMQ retry/job identity as queue lifecycle semantics rather than business-effect truth.

Current Stripe/PayPal refund connectors do not send the provider-native idempotency headers observed in those contracts.

Adopt properties, not products.

## Strong existing seams

Prefer evolving rather than replacing:

- Membership
- CapabilityContractService
- ActionDispatcherService
- AuthorityGrant
- KeyCortexApprovalOrchestrator
- ApprovalRequest
- BullMQ delayed/lock/retry/stall machinery
- FlowRun run/idempotency identity
- ScheduledAgentJob checkpoint identity
- WhatsApp scheduled CAS + provider message ID
- EmailCampaign sender CAS
- OutboundDelivery / DeliveryEvent
- SagaExecution / SagaStep evidence
- `CommerceService.markPaymentRefunded()` + ledger reversal
- provider webhook `createRefundWithPosting()` + invoice reconciliation
- quote-followup cancellation + current-state revalidation
- K9 provider reconciliation semantics

## J23 migration sequence

```text
A characterize statuses + proof harness
B strengthen claim/ownership boundaries
C cancellation/version/lateness
D provider outcome/reconciliation
E Temporal Work Projection
F reassess physical persistence/runtime convergence
```

A shared semantic contract comes before a shared physical table.

## J18 exact next work

```text
operator repair/dead-letter surfaces
→ provider-effect-success/local-persistence-failure crash windows
→ remaining provider/domain cancellation + reversal matrix
→ recovery authority / fresh Clearance requirements
→ pool into K11/K9/K8/K10 target laws
→ backward re-audit J15/J6
→ reinject J18 into J23 L6
```

## Knowledge classification

Use:

- **IMPLEMENTATION FACT / FACT**
- **RUNTIME EVIDENCE**
- **TEST SOURCE**
- **EXECUTED TEST RESULT**
- **GENERATED STATE**
- **MAINTAINED ARCHITECTURE DOC**
- **HISTORICAL / STALE DOC**
- **PRODUCT SOURCE**
- **INFERENCE**
- **WORKING HYPOTHESIS / WORKING DIRECTION**
- **OPEN QUESTION**
- **ACCEPTED DECISION**
- **DEPRECATED / SUPERSEDED**
- **RECOVERY UNCERTAIN**

Never silently promote hypothesis to decision, historical docs to implementation truth, or implementation truth to intended architecture.

## Evidence discipline

```text
evidence
→ interpretation
→ architectural implication / recommendation
→ accepted decision
```

And:

```text
implementation exists
!= test source exists
!= test executed successfully
!= runtime reproduced
!= concurrency invariant proven
!= system invariant proven
```

## Existing-seam / legacy discipline

Prefer strengthening coherent existing machinery before creating parallel `v2` systems.

Do not classify code as dead merely because UI navigation does not expose it. Distinguish mounted, reachable, called, UI-linked, externally callable, orphaned, legacy and compatibility-only.

Legacy residue must be consumer-proven before deletion.

## Implementation control

Do not turn findings directly into coding tasks.

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

Only then use `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md` for bounded `KF-EXEC-*` packets to Claude Code. Kimi/Gemini may adversarially review the same accepted invariant and resulting diff.

## Persistence rule

Material progress must update relevant canonical artifacts and then continuity state.

Chats can expire. KeyFlowOS knowledge should not.

## Do not

- modify production code without explicit authorization;
- create parallel `*2`/`v2` sources of truth;
- freeze target persistence prematurely;
- treat queue/transport state as logical work truth;
- treat scheduled time as perpetual authority/relevance;
- treat provider acceptance as delivery/settlement;
- blindly retry `OUTCOME_UNKNOWN`;
- treat a non-throwing compensation handler as confirmed reversal;
- treat `AWAITING_CONTROL` as failure;
- erase recovery outcome with original execution failure;
- let effect dedupe suppress missing consequence repair;
- delete legacy consumers without reachability proof;
- claim tests/runtime success unless actually executed.
