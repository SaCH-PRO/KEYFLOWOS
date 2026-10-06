# R&D-03 — Layer-3 Cognition Implementation & Proof Design

Status: DESIGN COMPLETE / NO PRODUCTION IMPLEMENTATION AUTHORIZATION  
Date: 2026-10-05  
Repository evidence baseline: `main@6fdffc26c7c7748d5c09900535c97c197864ab54`  
Intelligence parent: `RD-03-LAYER-3-BACKWARD-PRESSURE-TEST.md`

## Purpose

Translate the converged Layer-3 architecture into bounded implementation/proof tranches without creating a second orchestration runtime or new durable AI truth owner.

The target remains five AI-layer constructs:

1. `CognitiveRunEnvelope`
2. `ExecutableCognitiveContract`
3. `ModelExecutionStrategy`
4. `CapabilityView`
5. `CognitiveTraceProjection`

Durable truth remains with K3/K4/K5/K7/K8/K9/K11. K12 owns proof admission.

## Current repository facts that determine sequencing

- `zod@^3.24.0` is already a server dependency.
- `ai-output-contracts.ts` contains TS interfaces plus handwritten validation logic.
- `ModelGatewayService` consumes `expectedContract` and already has contract-validation tests.
- No repository use of `zod-to-json-schema`, `zodToJsonSchema`, or `toJSONSchema` was found on current main.
- `CapabilityContractService` already projects from canonical `FLOW_TOOLS`.
- `IntentParserService.AVAILABLE_TOOLS` is the only discovered duplicate static tool list under the AI module.
- provider retry, ActionDispatcher retry and BullMQ retry are independently configured.
- `ActionDispatcherService` retries generic thrown tool errors without itself knowing whether a remote effect may already exist.
- `KeyIdempotencyService` returns `new` for an existing `pending` key.
- `KeyCortexLifecycleService` already carries correlation/session/command identity but does not normalize all model/provider/queue/effect attempt identities.
- plan execution already has specialized `awaiting_approval` suspension.

## Package ordering

```text
COG-001 Executable Cognitive Contracts
        |
        +-------> COG-002 Capability View
        |
        +-------> COG-003 Run Envelope + Identity Lineage
                          |
                          +-------> COG-004 Retry / Effect Admission
                          |
                          +-------> COG-005 Durable Interrupt Protocol
                                            
K12-COG-006 Deterministic Cognitive Proof Harness supports every tranche.
```

COG-001 is deliberately first because it is bounded, non-provider-effecting, schema-centric and can be characterized with unit tests before autonomy/execution semantics are touched.

---

## COG-001 — Executable Cognitive Contracts

### Semantic migration

```text
interface + handwritten validator
        ↓
one executable schema
        ↓
inferred TypeScript type
+ runtime parse/validation
+ provider-schema projection
+ characterization tests
```

### Hard rule

There must be exactly one semantic definition of a contract.

A generated/provider representation may be cached or adapted, but it may not be hand-maintained as a second source.

### JSON-Schema projection gate

Current Zod is v3 and no existing repository converter was found.

Therefore implementation must **not** fake completion by:
- adding handwritten JSON Schema beside Zod;
- introspecting undocumented Zod internals without a reviewed compatibility contract;
- claiming provider-native structured outputs before a provider-neutral schema projection is proven.

Before COG-001 can be declared fully complete, implementation must choose and prove one supported projection path. A staged migration may land runtime/type unification first, but its status remains PARTIAL until provider-schema derivation is single-source.

### Compatibility obligations

Preserve:
- current `ContractType` names;
- public exported type names used by consumers;
- current valid payload acceptance unless a deliberate tightening is separately approved;
- current invalid payload rejection behavior;
- `coerceToContract` fallback semantics;
- model-gateway contract error signaling.

No provider API call is required for this tranche.

---

## COG-002 — Capability View

### Semantic migration

Remove static AI-local tool vocabulary and derive it from K5's canonical capability surface.

Initial target:
`IntentParserService.AVAILABLE_TOOLS`.

### Required shape

```text
FLOW_TOOLS
 -> CapabilityContractService
 -> derived CapabilityView
 -> intent/planning/model tool exposure
```

Do not move authority into this view. It is a projection, not a grant.

### Proof

- no selected execution path uses a separately maintained tool-name list;
- canonical registry changes become visible without editing intent-parser vocabulary;
- blocked/unready capabilities can be excluded without mutating K5 truth;
- no tool becomes executable merely because it appears in the model view.

---

## COG-003 — CognitiveRunEnvelope + Identity Lineage

### Value object

Carry references to:
- business/tenant;
- actor/user;
- logical occurrence;
- correlation;
- parent occurrence;
- authority/control provenance;
- deadline;
- inherited token/cost/retry/effect budgets;
- capability-view identity/version;
- provider/model constraints.

### Identity law

Do not collapse:

```text
logical occurrence
model attempt
provider request
queue attempt
ExecutionClaim
EffectId
provider operation
business outcome
```

into one generic ID.

Existing session/command/correlation IDs remain and are linked, not replaced.

---

## COG-004 — Retry / Effect Admission

### Dependency

Must align with K11, K9, ACTION-001 and EXTFX-001.

### Required retry domains

- model correction;
- model-provider transport;
- provider fallback;
- tool adapter;
- ActionDispatcher;
- BullMQ;
- temporal/workflow retry;
- reconciliation.

### Core law

```text
generic thrown error
!= proof that no external effect occurred
```

An unsafe effect may only be retried when K11/K9 evidence says the retry is admissible.

`OUTCOME_UNKNOWN` blocks blind new-effect retry.

Nested retries consume a common ancestor budget.

---

## COG-005 — Durable Interrupt Protocol

This does not create a cognitive workflow engine.

It standardizes the relationship between:
- K7 logical occurrence/checkpoint;
- K3 exact control requirement/evidence;
- K5 capability/action identity;
- K11 claim/revalidation.

### Resume law

On resume, revalidate current:
- occurrence validity/supersession;
- capability/version;
- authority/policy;
- parameters/fingerprint;
- readiness;
- claim/effect state.

A historical approval does not make stale work executable.

---

## K12-COG-006 — Deterministic Cognitive Proof Harness

Owner: K12.

Required fake/scripted model behaviors:
- valid structured output;
- invalid structured output;
- invalid then corrected output;
- deterministic tool proposal;
- provider retryable failure;
- provider non-retryable failure;
- explicit fallback;
- no-network/live-provider denial.

Required trace assertions:
- exact contract selected;
- provider/model/strategy selected and why;
- evidence/context identities used;
- capability projection used;
- authority/control decision;
- tool proposal and actual effect admission;
- retry domains consumed;
- interrupt/resume lineage;
- final outcome/evidence.

This harness is assurance infrastructure, not runtime business truth.

---

# Cross-tranche proof matrix

| ID | Proof obligation | Earliest tranche | Negative control |
|---|---|---|---|
| COG-P01 | one contract source drives runtime validation and TS type | COG-001 | mutate old handwritten expectation; no second validator may remain authoritative |
| COG-P02 | provider schema is derived, not separately maintained | COG-001 | schema field added to contract but absent from provider projection -> fail |
| COG-P03 | current valid/invalid fixture behavior characterized | COG-001 | malformed nested/enum payload |
| COG-P04 | no duplicate tool vocabulary in selected intent path | COG-002 | add canonical tool only; derived view must see it |
| COG-P05 | capability exposure does not grant authority | COG-002 | exposed high-risk tool with insufficient authority remains non-executable |
| COG-P06 | child run cannot expand inherited budget/authority | COG-003 | child requests larger budget/grant -> reject/clamp |
| COG-P07 | identities remain distinct and linked | COG-003 | same effect with multiple attempts must preserve one EffectId, distinct AttemptIds |
| COG-P08 | model correction cannot repeat possible side effect | COG-004 | simulated timeout after possible effect -> reconciliation path, no blind retry |
| COG-P09 | nested retries cannot exceed ancestor allowance | COG-004 | provider + dispatcher + queue retries attempt to multiply budget |
| COG-P10 | pending idempotency/claim cannot admit concurrent execution | COG-004 | simultaneous callers -> one execution claimant |
| COG-P11 | approval resume targets exact suspended occurrence | COG-005 | altered params/version/authority after approval -> re-evaluate/reject |
| COG-P12 | no second durability owner advances same occurrence | COG-005 | queue redelivery + resume race -> one authoritative progression |
| COG-P13 | full cognitive loop can run without provider network | K12-COG-006 | network access attempt -> fail closed |
| COG-P14 | trace assertions prove path, not final prose only | K12-COG-006 | same response text with wrong tool/authority path -> fail |

## Hard stop conditions

Stop implementation/promotion if:
- a new framework runtime is required merely to obtain checkpointing;
- a second tool registry is introduced;
- provider schema requires hand-maintained duplication;
- a generic retry can repeat an uncertain external effect;
- a child agent can reset budget or authority;
- test success depends on a live commercial model/provider;
- a trace cannot distinguish occurrence/attempt/effect identity;
- existing K3/K5/K7/K8/K9/K11 ownership is bypassed.

## Readiness verdict

Layer-3 target architecture: **STRONGLY CONVERGED**.  
Implementation design: **READY FOR BOUNDED PACKETIZATION**.  
Production implementation: **NOT AUTHORIZED BY THIS DOCUMENT**.  
First bounded packet: **KF-EXEC-COGNITION-001 — Executable Cognitive Contracts**.
