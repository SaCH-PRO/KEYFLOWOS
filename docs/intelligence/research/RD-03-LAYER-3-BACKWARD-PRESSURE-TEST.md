# R&D-03 — Layer-3 Backward Pressure Test Against Existing KEYFLOWOS Kernels

Status: CONVERGENCE REFINEMENT  
Date: 2026-10-05  
Research parent: `RD-03-LAYER-3-ORCHESTRATION-CONVERGENCE-AUDIT.md`  
Repository evidence sampled: `main@6fdffc26c7c7748d5c09900535c97c197864ab54`  
Production implementation authorized by this record: **NO**

## Purpose

The first Layer-3 convergence pass produced ten candidate cognitive primitives. This backward pass asks a stricter question:

> Which of those are genuinely new AI-layer contracts, which are specializations/projections of existing KEYFLOWOS kernels, and which should collapse into cross-kernel laws instead of becoming new architectural owners?

The goal is to prevent the AI research programme from recreating capabilities already owned by K3/K4/K5/K7/K8/K9/K11/K12.

---

## Existing kernel ownership relevant to Layer 3

### K3 — KEY Authority & Governance
Already owns:
- exact-action governance;
- ControlRequirement;
- ControlEvidence;
- Clearance;
- authority/policy invalidation;
- approval/confirmation semantics.

Therefore Layer 3 must not create an AI-specific authority engine.

### K4 — Business Knowledge
Already owns:
- provenance-bound durable business knowledge;
- revision/freshness/conflict semantics;
- learning eligibility;
- separation of observation/inference/verification/canonical knowledge.

Therefore prompt context and model memory must never become a parallel truth system.

### K5 — Capability Fabric
Already owns:
- canonical business-action identity;
- versioned input/output schemas;
- permission;
- impact/risk;
- execution/idempotency metadata;
- canonical progression from capability -> ActionEnvelope -> execution/outcome.

Current implementation seam `CapabilityContractService` already projects directly from `FLOW_TOOLS`, explicitly preserving FLOW_TOOLS as the single source.

Therefore Layer 3 must not create another tool/action registry.

### K7 — Temporal / Event / Workflow
Already owns:
- logical occurrence identity;
- schedules/recurrence;
- long-running workflow coordination;
- durable occurrence ownership;
- suspension/resumption over time;
- causal lineage;
- delayed work.

Therefore "cognitive durability" must compose with K7 rather than introducing an agent workflow runtime.

### K8 — Evidence & Outcome
Already owns:
- ControlEvidence;
- execution attempts/outcomes;
- provenance;
- OUTCOME_UNKNOWN;
- reconciliation evidence;
- business-consequence evidence.

Therefore cognitive tracing must be an evidence/projection specialization, not a competing audit truth.

### K9 — Integration & External Reality
Already owns:
- provider request/response identity;
- provider capability/reality;
- external-effect semantics;
- provider idempotency;
- OUTCOME_UNKNOWN/reconciliation;
- connector/provider freshness.

Therefore model-provider capability facts and provider-specific structured-output support belong to the same external-reality discipline.

### K11 — Recovery & Reliability
Already owns:
- ExecutionClaim;
- attempt identity;
- idempotency;
- retries;
- leases;
- crash recovery;
- compensation/reconciliation.

Therefore AI/model retry cannot become an independent retry authority.

### K12 — Engineering Control Plane
Already owns:
- exact source/build/test identity;
- proof admission;
- isolated verification;
- negative controls;
- safe-change evidence.

Therefore deterministic fake models/providers and cognitive trace assertions belong to engineering assurance, not runtime truth.

---

# Candidate-by-candidate pressure test

## 1. CognitiveRunContext

### Original candidate
Typed tenant/actor/authority/trace/deadline/budget/capability context passed through one cognitive run.

### Pressure test
No existing kernel owns this exact in-process composition object, but each field already has a semantic owner.

- tenant/actor -> K1/K2
- authority reference -> K3
- capability projection -> K5
- occurrence/deadline -> K7
- evidence/trace lineage -> K8
- provider/model constraints -> K9
- retry envelope -> K11

### Verdict
**KEEP, but demote from independent architectural primitive to an AI-layer value object.**

It must carry references/projections from canonical owners, never copy their truth into a second authority/memory state.

### Refined name
**CognitiveRunEnvelope**

Reason: it contains not only contextual information but bounded identity/budget/execution constraints inherited by child reasoning.

---

## 2. ExecutableCognitiveContract

### Original candidate
Single schema drives TypeScript type, provider JSON schema, runtime validation and tests.

### Repository evidence
`ai-output-contracts.ts` currently duplicates semantics:
- TypeScript interfaces;
- handwritten `validateOutputContract` switch.

`ModelGatewayService` consumes `expectedContract`, but the schema source is not executable/single-source.

### Pressure test
K5 owns **business capability** contracts, not model-output shapes. These concepts are related but semantically distinct:

```text
CapabilityContract
= what business action exists and what it accepts/returns

ExecutableCognitiveContract
= what structured cognition/model output is accepted as a typed internal object
```

Conflating them would make model reasoning schemas appear to be executable business authority.

### Verdict
**KEEP as a genuine AI-layer contract.**

Preferred seam: Zod-first schema registry local to AI/cognition, with no independent authority/execution semantics.

---

## 3. ProviderCapabilityProfile

### Original candidate
Tested facts about model/provider support for structured outputs, tool calling, schema limitations, streaming, retryable failures, etc.

### Pressure test
This is not a new truth domain. K9 already owns external provider reality, freshness, provider contract/version and strongest-known evidence.

### Verdict
**MERGE semantic ownership into K9.**

Layer 3 may define a model-provider specialization/view, but provider capability facts must be K9-style external reality with provenance/freshness.

### Refined form
**ModelProviderCapabilityProjection** — a typed K9 projection consumed by the model gateway.

No second provider registry.

---

## 4. StructuredOutputStrategyResolver

### Original candidate
Select provider-native schema, tool schema, constrained decoder/adapter or lower-trust fallback.

### Pressure test
This is behavior, not truth. It consumes:
- ExecutableCognitiveContract;
- K9 ModelProviderCapabilityProjection;
- run constraints from CognitiveRunEnvelope.

### Verdict
**KEEP as a strategy service, not a primitive truth owner.**

It must emit an explicit trust/assurance level so fallback is visible.

---

## 5. CapabilityView

### Original candidate
Per-run tool projection from FLOW_TOOLS filtered by authority, risk, provider readiness, role and budget.

### Repository evidence
`CapabilityContractService` already projects canonical `FLOW_TOOLS`.

`IntentParserService` currently carries a duplicated `AVAILABLE_TOOLS` list, proving a live anti-pattern.

### Pressure test
K5 already owns capability identity. K3 owns permission/clearance. K9 owns readiness/provider availability. K11 owns effect/retry limitations.

### Verdict
**DO NOT create a new registry or durable primitive.**

Keep only a **derived function/projection**:

```text
CapabilityView(runEnvelope)
=
project(
  K5 capabilities
  constrained by K3 authority/governance
  + K9 readiness/provider constraints
  + K11 safety/retry/effect constraints
  + local task scope
)
```

Current duplicate tool lists should migrate toward this projection.

---

## 6. CognitiveOccurrence

### Original candidate
Stable identity for one bounded cognitive unit of work, distinct from model/provider/queue attempts and business effect identity.

### Repository evidence
`KeyCortexLifecycleService` already threads:
- `correlationId`
- `sessionId`
- `commandId`

through command/execution/audit records.

K7 already requires durable logical occurrence identity independent of execution claim.

### Pressure test
A new `CognitiveOccurrence` table/object risks duplicating K7 and the existing command/plan/step identities.

### Verdict
**MERGE into K7 occurrence semantics; retain a cognitive occurrence ROLE, not necessarily a new persisted object.**

A cognitive unit should bind to the most specific existing stable logical occurrence:
- command/turn occurrence;
- plan-step occurrence;
- temporal workflow occurrence;
- delegated child occurrence.

Attempt IDs remain separate.

---

## 7. DurableCognitiveInterrupt

### Original candidate
Persist exact suspended cognitive call and later resume it after approval/external wait/missing information/delegated child result.

### Repository evidence
`PlanExecutorService` already places steps into `awaiting_approval` and K7 owns long-running suspension/resumption.

K3 already owns approval/control semantics.

K11 owns execution claims/attempts.

### Pressure test
This is a **cross-kernel protocol**, not a new durability owner.

### Verdict
**COLLAPSE into a Durable Interrupt Protocol over K7 + K3 + K11.**

Required law:

```text
logical occurrence (K7)
+ exact pending action/control identity (K3/K5)
+ no active unsafe execution claim (K11)
-> suspend
-> durable external/human result
-> revalidate current authority/version/readiness
-> resume exact logical occurrence
```

Approval satisfaction does not itself authorize stale execution after resumption.

---

## 8. CognitiveEffectBoundary

### Original candidate
Schema -> semantic validation -> authority -> execution -> evidence/reconciliation.

### Pressure test
Every semantic owner already exists.

```text
ExecutableCognitiveContract
-> K5 CapabilityContract / ActionEnvelope
-> K3 control + Clearance
-> K11 ExecutionClaim
-> K9 provider/domain external effect
-> K8 Outcome/Evidence
-> K4 eligible learning
```

### Verdict
**COLLAPSE into a cross-kernel composition law.**

This is a critical law, but not another service or database.

### Canonical correction law
A model correction retry is permitted only before an unsafe effect may have occurred.

After possible external effect:
```text
do not "ask the model to try again"
-> K11/K9/K8 reconciliation/recovery
```

---

## 9. RetryBudgetGraph

### Original candidate
Compose model/provider/network/queue/workflow retry domains under one ancestor budget.

### Repository evidence
Current runtime has independent retry behavior:
- model gateway provider retries;
- ActionDispatcher retries;
- BullMQ/plan retries;
- provider-specific retries.

K11 already owns retry semantics, while K7 owns occurrence progression and K9 provider ambiguity.

### Pressure test
The architecture needs the property, but not another retry subsystem.

### Verdict
**MERGE ownership into K11 as a Retry Budget Policy, carried in CognitiveRunEnvelope where cognition participates.**

Required invariants:
1. nested retry domains consume a common ancestor allowance;
2. child delegation cannot reset retry allowance;
3. OUTCOME_UNKNOWN blocks unsafe automatic effect retry;
4. transport retries do not imply permission to create a new business effect;
5. correction retry and external-effect retry are separate domains.

---

## 10. CognitiveTrace

### Original candidate
Semantic trace asserting provider/model, evidence, capability view, authority decisions, interrupts, effects, retries and outcome.

### Repository evidence
Current pieces include:
- `KeyCortexLifecycleService` correlation/session/command identity;
- `AiExecutionLogService`;
- Cortex action/audit logs;
- Langfuse model telemetry;
- K8 evidence/outcome structures.

### Pressure test
Persisting another "cognitive trace truth" would duplicate K8 and existing logs.

### Verdict
**KEEP only as a derived trace projection/schema over canonical evidence and execution records.**

A trace projection may be queryable/testable, but critical facts remain owned by K3/K7/K8/K9/K11.

---

# Supporting facilities pressure test

## Deterministic Cognitive Test Double
**OWNER: K12 Engineering Control Plane.**

Required properties:
- fake/scripted provider is default in full cognitive-loop tests;
- accidental network/provider use fails closed;
- can script malformed -> corrected output;
- can script tool calls and provider failures;
- can assert retry/interrupt paths.

Not runtime business truth.

## Cognitive Trace Assertions
**OWNER: K12 assurance, asserting K8/K3/K7/K9/K11 evidence.**

Tests must be able to prove the path, not just final prose.

---

# Further convergence: ten candidates reduce to five AI-layer constructs

The backward pass shows that the original ten should not survive as ten equal architectural primitives.

## A. CognitiveRunEnvelope
Ephemeral typed value object carrying:
- stable logical occurrence reference;
- actor/tenant references;
- authority provenance reference;
- inherited budget envelope;
- deadlines;
- allowed capability projection;
- provider/model constraints;
- trace/correlation reference.

## B. ExecutableCognitiveContract
Zod-first executable schema for structured cognitive output.

## C. ModelExecutionStrategy
Composes:
- K9 model-provider capability projection;
- contract requirements;
- provider/model selection;
- structured-output strategy;
- explicit assurance/trust level.

This collapses `ProviderCapabilityProfile + StructuredOutputStrategyResolver` into one AI gateway concern while leaving provider facts owned by K9.

## D. CapabilityView
Ephemeral derivation from K5/K3/K9/K11. No persistence, no registry duplication.

## E. CognitiveTraceProjection
Read/proof projection across canonical evidence. No independent truth ownership.

These five are the only Layer-3 constructs that should appear as distinct AI-layer APIs/types.

---

# Cross-kernel Layer-3 protocols

The following remain important but should be specified as laws/protocols, not new runtime owners:

## P1 — Durable Interrupt Protocol
K7 occurrence + K3 control + K11 claim/revalidation.

## P2 — Cognitive Effect Admission Protocol
Executable cognitive contract -> K5 -> K3 -> K11 -> K9 -> K8.

## P3 — Retry/Budget Inheritance Protocol
K11 retry policy + run-envelope inheritance + K7 occurrence identity.

## P4 — Learning Eligibility Protocol
K8/K9/K11 outcome certainty -> K4 learning eligibility; model self-confidence is insufficient.

---

# Concrete repository contradictions exposed by the pressure test

## COG-L3-01 — Duplicate tool vocabulary
`IntentParserService.AVAILABLE_TOOLS` duplicates the canonical FLOW_TOOLS/CapabilityContract surface.

Target: derive candidate/action tool vocabulary from K5 capability projection.

## COG-L3-02 — Cognitive contracts have dual sources
`ai-output-contracts.ts` has interfaces and separate handwritten validators.

Target: one executable schema source.

## COG-L3-03 — Retry domains are independent
Model gateway, ActionDispatcher, BullMQ/plan and provider paths can each retry without one visible ancestor retry budget.

Target: K11-owned retry budget composition.

## COG-L3-04 — ActionDispatcher retries after generic exceptions
`ActionDispatcherService` retries tool execution after caught exceptions without itself knowing whether the underlying external effect is definitely absent, completed or OUTCOME_UNKNOWN.

Target: effect-class-aware retry admission through K11/K9 semantics; do not assume generic exception == safe retry.

## COG-L3-05 — Idempotency pending is not exclusive ownership
`KeyIdempotencyService.check()` currently returns `new` for an existing `pending` key ("last-writer-wins"), which K11 already identifies as insufficient execution claim behavior.

Target: atomic claim/IN_PROGRESS semantics.

## COG-L3-06 — Cognitive lifecycle identity is useful but not occurrence-complete
`KeyCortexLifecycleService` threads correlation/session/command identities, but model attempt/provider request/queue attempt/effect identity are not one normalized lineage contract.

Target: retain existing IDs and link them through K7/K8/K9/K11 rather than invent one overloaded ID.

## COG-L3-07 — Approval suspension is specialized, not generic
Plan steps support `awaiting_approval`, but no generic exact-call interrupt/resume contract is proven across cognitive paths.

Target: K7/K3/K11 Durable Interrupt Protocol.

## COG-L3-08 — Cognitive trace truth is fragmented
Execution logs, Cortex action logs, audit events, CognitiveEvent and Langfuse each cover slices.

Target: K8-backed CognitiveTraceProjection, not a new log-of-record.

---

# Revised Layer-3 target

```text
                    KEY cognitive layer
                           |
          +----------------+----------------+
          |                |                |
 CognitiveRunEnvelope  Executable       ModelExecution
                      CognitiveContract   Strategy
          |                |                |
          +-------- CapabilityView --------+
                           |
                      proposal/reasoning
                           |
                 CROSS-KERNEL EFFECT LAW
                           |
               K5 Capability / ActionEnvelope
                           |
                    K3 Governance
                           |
                    K11 Claim/Retry
                           |
                 K9 External Reality
                           |
                    K8 Evidence
                           |
                 K4 Eligible Learning

K7 owns durable occurrence/time/interrupt progression throughout.
K12 owns proof/test admission.
```

---

# Updated convergence verdict

## Architectural concept convergence
**STRONGLY CONVERGED, SUBJECT TO ONE FINAL REACHABILITY/PROOF DESIGN PASS.**

The external framework studies no longer justify ten peer primitives or a second orchestration runtime.

## New AI-specific durable truth owners
**NONE proposed.**

The AI layer adds executable contracts/value objects/derived projections and delegates durable business truth to existing kernels.

## New runtime
**REJECTED.**

No LangGraph/Pydantic AI/Microsoft Agent Framework/AutoGen runtime should be introduced as a parallel durability/orchestration authority.

## Immediate next pass
Design the bounded implementation/proof sequence for:
1. Zod-first executable cognitive contracts;
2. K5-derived CapabilityView replacing duplicate tool lists;
3. K11 retry-budget/effect-aware retry characterization;
4. occurrence/attempt/effect lineage mapping;
5. generic durable interrupt characterization;
6. deterministic cognitive-loop test double + trace assertions under K12.

No production code change is authorized by this research record.
