# R&D-03 — Layer-3 Orchestration Convergence Audit

Status: RESEARCH CONVERGENCE RECORD  
Date: 2026-10-05  
Repository evidence baseline for this tranche: `main@6fdffc26c7c7748d5c09900535c97c197864ab54`  
Scope: research/architecture only; no production mutation authorized by this record.

## Research set

Completed Layer-3 subjects:
- R&D-03A LangChain
- R&D-03B LangGraph
- R&D-03C LlamaIndex
- R&D-03D CrewAI
- R&D-03E AutoGen
- R&D-03F Pydantic AI
- R&D-03G Microsoft Agent Framework

The convergence rule is not to adopt a framework stack. Extract properties, classify them against existing KEYFLOWOS architecture, and converge onto the smallest coherent native TypeScript architecture.

## Repository reality sampled before convergence

At `main@6fdffc26...`:

- `apps/server/src/modules/ai/ai-output-contracts.ts` defines TypeScript interfaces and a separate handwritten `validateOutputContract` switch. This duplicates contract semantics and can drift.
- `ModelGatewayService` accepts an `expectedContract` and records contract validation, but provider structured-output capability is not represented as a first-class tested capability profile.
- `FLOW_TOOLS` is already the canonical tool declaration surface and carries parameter schema, output schema, risk tier/family, changed entities, follow-on suggestions and manual-equivalent route.
- `IntentParserService` duplicates an `AVAILABLE_TOOLS` list, demonstrating a concrete parallel-registry risk.
- `AiExecutionLogService` records action/tool/module/risk/mode/actor/rationale/input/output/success/duration/plan IDs/role/idempotency key, but it is not yet a complete cognitive trace contract.
- `AiOversightService` + approval services provide governance and approval routing.
- `PlanExecutorService` persists plan/step execution state, uses BullMQ, retries and idempotency keys, and can suspend steps in `awaiting_approval`; this is adjacent to but not yet a canonical durable cognitive interrupt abstraction.
- `CognitiveEventBusService` persists normalized cognitive events with provenance/confidence.
- `UnifiedMemoryRetrievalService` types already distinguish durable memory fragments from runtime consumers, supporting separation between memory, context projection and model window.

## Convergence verdict

Do not adopt Pydantic AI, Microsoft Agent Framework, LangGraph or another agent/workflow runtime as a second orchestration substrate.

KEY should converge onto native TypeScript contracts that compose with existing KEYFLOWOS owners for authority, memory, temporal work, external effects, evidence and recovery.

## Canonical Layer-3 primitive candidates

### 1. CognitiveRunContext
Typed per-run context. Minimum dimensions:
- tenant/business
- actor/user
- effective authority reference/provenance
- trace/correlation identity
- parent/child cognitive occurrence
- deadline/time budget
- token/cost budget
- retry budget
- allowed capability projection
- model/provider constraints

This is context, not memory, and not business truth.

### 2. ExecutableCognitiveContract
One executable schema is the source for:
- runtime validation
- inferred TypeScript type
- provider JSON schema
- tests
- documentation/introspection

Preferred implementation seam: Zod.

Immediate target: replace interface + handwritten-validator duality in `ai-output-contracts.ts`.

### 3. ProviderCapabilityProfile
Tested facts about a model/provider path, including:
- native structured outputs
- tool calling
- parallel tool calling
- schema limitations
- streaming compatibility
- context limits
- retryable error classes
- provider idempotency/replay properties where relevant

Provider marketing claims must not silently become runtime truth.

### 4. StructuredOutputStrategyResolver
Given contract + provider capability profile, select:
1. provider-native schema
2. tool/function schema
3. constrained/adapter path
4. explicitly lower-trust fallback

Fallback must preserve a visible trust downgrade.

### 5. CapabilityView
Per-run derived projection from canonical `FLOW_TOOLS`, filtered by:
- tenant
- actor
- authority
- role
- risk/autonomy
- provider/model capability
- runtime readiness
- task scope
- budget

Invariant: no second tool registry.

Concrete current contradiction: `IntentParserService.AVAILABLE_TOOLS` is a duplicate list and should eventually be replaced by a derived view.

### 6. CognitiveOccurrence
Stable identity for one bounded cognitive unit of work.

Must distinguish:
- business-effect identity
- cognitive occurrence identity
- model attempt identity
- provider request identity
- queue/workflow attempt identity

Attempt IDs must never substitute for effect identity.

### 7. DurableCognitiveInterrupt
A cognitive occurrence may suspend on:
- human approval
- missing information
- external result
- delegated child result
- future condition/time

Persist exact suspended-call identity + contract + checkpoint + authority/effect context and resume that occurrence.

Current `awaiting_approval` plan-step behavior is evidence of an adjacent seam, not proof that the generic primitive already exists.

### 8. CognitiveEffectBoundary
Required chain:
tool arguments
-> executable schema validation
-> semantic/business validation
-> authority/admission
-> idempotency/effect identity
-> execution
-> evidence/confirmation
-> reconciliation

After an external non-idempotent effect may have happened, failure is not a generic model retry. It becomes reconciliation/idempotency/compensation/recovery.

### 9. RetryBudgetGraph
Retries exist in distinct domains:
- model correction
- provider
- network
- tool adapter
- BullMQ/job
- workflow/temporal occurrence
- external reconciliation

They must share an ancestor budget and be reasoned about compositionally because nested retries multiply.

### 10. CognitiveTrace
A trace should assert more than final text:
- run + occurrence identity
- model/provider selected and why
- context/evidence supplied
- capability projection
- tool proposals/calls
- contract validation
- authority decisions
- interrupts/resumptions
- effects/evidence/reconciliation
- budgets consumed
- retries by domain
- terminal outcome

`AiExecutionLogService` and Langfuse are inputs to this target, not yet the full semantic trace.

## Supporting facilities, not new truth owners

### Deterministic Cognitive Test Double
Scriptable fake provider/model capable of:
- deterministic text
- deterministic structured output
- scripted invalid output then correction
- scripted tool calls
- scripted provider failures
- live-provider-call denial by default

Tests should cover the complete model/tool/interrupt/effect loop without network dependence.

### Cognitive Trace Assertions
Tests should assert the execution path, not only final prose.

## Delegation law: Budget Inheritance

A delegated child does not receive a fresh unlimited envelope.

`ChildBudget <= ParentRemainingBudget` across:
- cost
- tokens
- elapsed time/deadline
- retries
- tools/capabilities
- external effects
- authority

## Durability ownership law

One workflow occurrence has exactly one authoritative durability/progression owner.

BullMQ may deliver work. Event buses may signal. External providers may retry. Cognitive checkpoints may describe suspension. But only one owner advances authoritative occurrence state.

Do not introduce a second workflow engine to obtain agent checkpointing.

## Anti-duplication classification

Framework-derived concepts classify as follows:

- structured outputs/type-first models -> SAME / strengthen ExecutableCognitiveContract
- agent context/dependencies -> SAME / strengthen CognitiveRunContext
- provider capability differences -> SPECIALIZATION / ProviderCapabilityProfile
- tool registry/tool definitions -> SAME / project from FLOW_TOOLS
- graph/node execution -> RELATED DISTINCT / temporal/workflow owner remains external to cognitive reasoning
- checkpoint + HITL -> SPECIALIZATION / DurableCognitiveInterrupt
- multi-agent handoff -> SPECIALIZATION / child CognitiveOccurrence + inherited budget/authority
- agent session -> IMPLEMENTATION ALIAS when used as conversational continuity; must not become domain truth
- framework memory -> IMPLEMENTATION ALIAS / delegate to canonical KEY memory architecture
- framework retries -> SPECIALIZATION / RetryBudgetGraph
- tracing/telemetry -> SPECIALIZATION / CognitiveTrace
- evaluation harness -> RELATED DISTINCT supporting assurance facility

No genuinely new external runtime owner was justified.

## Immediate implementation sequence candidate

This is not an implementation authorization by itself.

1. Convert `ai-output-contracts.ts` to Zod-first executable schemas while preserving existing public contract names.
2. Derive TypeScript types and JSON Schema from those schemas.
3. Add contract-schema characterization tests against current valid/invalid fixtures.
4. Introduce `ProviderCapabilityProfile` as data/adapter metadata, not a second provider registry.
5. Add `StructuredOutputStrategyResolver` with explicit fallback trust level.
6. Replace duplicated tool lists such as `IntentParserService.AVAILABLE_TOOLS` with a derived `CapabilityView` over `FLOW_TOOLS`.
7. Define `CognitiveRunContext` and thread it through model/tool calls without conflating it with memory/domain state.
8. Define occurrence/attempt/effect identities and propagate them into execution logs.
9. Lift approval suspension into a generic `DurableCognitiveInterrupt` contract that delegates durability progression to the existing owner.
10. Add deterministic model/provider test doubles and trace assertions before expanding autonomy.

## Proof obligations before Layer-3 implementation convergence

- No duplicate tool registry remains in the selected execution path.
- One schema definition drives TS type + runtime validation + provider schema.
- Invalid model output cannot cross into effect execution.
- Semantic/business validation occurs before authority/effect execution.
- A model correction retry cannot repeat an already-possible external effect.
- Retry budgets compose across model/provider/queue/workflow domains.
- Child delegation cannot increase authority or budget.
- Approval/external-wait resume targets the exact suspended cognitive occurrence.
- One durability owner advances occurrence state.
- Tests can run the full cognitive loop with no live provider calls.
- Trace assertions can prove provider, evidence, tools, authority and effects used.

## Layer-3 convergence status

Architectural concept convergence: PROVISIONALLY CONVERGED.

Implementation convergence: NOT YET.

Reason: the target primitive set is coherent and no researched framework justifies a second runtime, but repository reality still contains duplicate contract/tool representations and fragmented execution/trace semantics that must be characterized and migrated with proof.
