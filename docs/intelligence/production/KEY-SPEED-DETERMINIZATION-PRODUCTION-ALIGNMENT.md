# KEYFLOWOS / KEY Speed & Determinization — Production Alignment Contract

Status: ARCHITECTURE-PROMOTION CANDIDATE / PRODUCTION-ALIGNMENT COMPLETE / IMPLEMENTATION NOT RELEASED
Checkpoint: KFCI-2026-10-06-01
Date: 2026-10-06
Scope: KEYFLOWOS platform + KEY cognition/runtime

## 1. Objective

Move the converged speed/latency/throughput research into the production architecture without creating a second cognition runtime, workflow engine, rules engine, memory system, capability registry or authority plane.

Primary production law:

> Resolve the maximum safe portion of every operation through deterministic state, computation, policy and retrieval before probabilistic cognition. Preserve residual uncertainty explicitly. Route only that residual uncertainty to the minimum sufficient cognitive tier. Re-enter deterministic validation, authority, effect and evidence boundaries before consequential execution.

This contract aligns the research with current production owners.

## 2. Production ownership map

| Concern | Existing owner | Production alignment |
|---|---|---|
| request effort routing | CognitiveTriageService + FlowOrchestrator | extend existing triage; no second router |
| context selection | Context Genome / UnifiedMemoryRetrieval / Context Compiler candidate | deterministic smallest-sufficient context projection |
| capability identity | CapabilityContractService / FLOW_TOOLS | remain deterministic source for capability semantics |
| authority | AutonomyOrchestrator + action boundary | no cognition tier may grant permission |
| execution | Flow | all effects continue through Flow / adopted action boundary |
| effect identity / retry | ActionEnvelope / fingerprint / ExecutionClaim / idempotency | preserve exact identity |
| outcome truth | Evidence / Outcome | model confidence never substitutes for outcome evidence |
| proof | Assurance / proof-admission / negative controls | exact invariants use exact tests; semantic evaluation cannot override deterministic failure |
| learning | existing governed learning / procedure work | verified episodes may propose optimized procedures; never self-promote |
| programme control | issue #80 + admitted control plane | packet release/admission remains unchanged |

## 3. Production architecture

### 3.1 Canonical operation pipeline

INPUT / EVENT
  -> SIGNAL ADMISSION
  -> PIN authoritative state
  -> DETERMINISTIC DECOMPOSITION
     - exact facts
     - exact calculations
     - exact policy/state predicates
     - retrievable authoritative facts
  -> RESIDUAL UNCERTAINTY
  -> MINIMUM SUFFICIENT COGNITION
     - none
     - reflex
     - standard
     - deliberate
     - escalate
  -> DETERMINISTIC POST-VALIDATION
  -> CAPABILITY CONTRACT
  -> AUTHORITY / GUARDRAILS
  -> FLOW EFFECT EXECUTION
  -> EVIDENCE / OUTCOME
  -> ASSURANCE
  -> GOVERNED LEARNING / PROCEDURE CANDIDATE

### 3.2 Hard production invariants

DTR-PROD-I01 — no new cognition tier may widen execution authority.

DTR-PROD-I02 — deterministic state/policy failure cannot be overridden by model output or semantic evaluator.

DTR-PROD-I03 — UNKNOWN / stale / conflicting evidence must remain explicit and may force escalation; it may not be coerced into an exact value.

DTR-PROD-I04 — no model call is made for an operation whose required output is fully and safely resolved by existing deterministic owners.

DTR-PROD-I05 — every consequential model output re-enters schema/invariant checks and existing capability/authority/effect boundaries.

DTR-PROD-I06 — reflex/routine paths are shortcuts through the same canonical execution substrate, never bypasses around Flow/authority/evidence.

DTR-PROD-I07 — repeated successful episodes may only create procedure/optimization candidates after verified outcome evidence; episode != procedure != permission.

DTR-PROD-I08 — transport optimization may not collapse provenance, valid time, recorded time, authority class, tenant identity or evidence lineage.

DTR-PROD-I09 — optimization failure degrades to the existing safe path; it does not invent a faster unsafe fallback.

DTR-PROD-I10 — speed metrics are optimization evidence, not correctness proof.

## 4. Production rollout tranches

### P0 — active safety closure

Dependency:
- finish/admit/checkpoint KF-EXEC-AUTH-FAIL-CLOSED-001 (PR #155).

No speed optimization packet that touches the same semantic path is released before this settles.

### P1 — Determinization observability baseline

Goal:
measure current semantic latency before changing behavior.

Instrument, using existing observability owners where possible:
- model_calls_per_operation;
- deterministic_fields_resolved;
- residual_uncertainty_count/rate;
- context_tokens_or_bytes;
- retrieval_count;
- semantic_transform_count;
- agent/service handoffs;
- authority lookups;
- p50/p95 total semantic latency;
- model latency vs non-model latency;
- correction/retry/reversal rate.

Rules:
- telemetry only;
- no new truth owner;
- no production decision depends on these metrics;
- tenant/privacy rules preserved.

Release mode:
SHADOW / OBSERVE ONLY.

### P2 — Deterministic decomposition contract

Candidate packet:
KF-COG-DETERMINIZATION-CONTRACT-001

Goal:
introduce a small contract/protocol, not a service, that lets existing cognition entry points declare:
- exact/computed fields;
- retrieved authoritative fields;
- deterministic predicates;
- unresolved fields;
- uncertainty reasons.

Preferred seam:
existing Cognitive Function / Flow request preparation.

Do not:
- add a universal rules engine;
- move domain calculations into Cortex;
- duplicate domain truth;
- add another workflow runtime.

Proof:
- deterministic-only fixture causes zero model calls;
- mixed fixture invokes cognition only for unresolved fields;
- stale/conflicting fixture remains unresolved;
- model cannot overwrite exact computed fields;
- mutation removing the exact-field protection fails named tests.

Initial release:
SHADOW projection beside existing behavior.

### P3 — Context Compiler live promotion

Existing candidate:
KF-META-CONTEXT-COMPILER-LIVE-001

Goal:
compile smallest sufficient context from explicit canonical sources with revision/authority/freshness metadata.

Production rules:
- read-only projection;
- missing required authority => DEGRADED/INVALID;
- no LLM-resolved canonical conflicts;
- explicit exclusions;
- worker/runtime remains bound to underlying authority artifacts.

Rollout:
1. shadow bundle generation;
2. compare against current context;
3. prove no critical context loss;
4. opt-in on bounded low-risk paths;
5. expand only after outcome/latency evidence.

### P4 — Risk-aware minimum-sufficient cognition

Existing candidate:
KF-COG-ROUTING-HONESTY-001

Extend CognitiveTriageService rather than create a new router.

Inputs may include deterministic flags from already-owned metadata:
- effect-capable request;
- destructive/money/permission-sensitive action;
- pending confirmation/approval;
- unresolved authority;
- contradictory/missing critical evidence;
- irreversibility/materiality;
- multi-step plan complexity.

Rule:
simple language never implies low semantic risk.

Rollout:
shadow verdict -> compare -> low-risk bounded activation -> wider activation.

### P5 — Signal admission / inhibitory propagation

Candidate packet:
KF-COG-SIGNAL-ADMISSION-001

Generalized disposition vocabulary:
- DROP
- STORE_ONLY
- STATE_UPDATE
- REFLEX
- COGNITIVE
- ESCALATE

This must reuse existing ingress/event owners and may not become a universal event bus replacement.

First implementation should target one bounded high-volume low-risk event family where unnecessary cognitive wake-ups can be measured.

Proof:
- irrelevant/no-op updates do not wake cognition;
- material state changes still propagate;
- suppressed event is auditable;
- missing classification degrades to existing safe behavior;
- no tenant/event loss.

### P6 — Verified-path compilation ("software myelination")

Candidate packet family only after P1-P5 evidence:
KF-PROC-VERIFIED-PATH-001

Goal:
allow Assurance/governed learning to propose a cheaper procedure for repeatedly verified patterns.

Promotion contract:
EPISODES
 -> verified outcome set
 -> stable pattern candidate
 -> procedure candidate
 -> independent proof
 -> explicit authority/promotion
 -> bounded fast path

Fast path must still perform:
capability identity -> current authority -> effect identity -> execution -> evidence.

Never allow historical success to imply current permission.

### P7 — Production SLOs and optimization loop

Define SLOs per operation class, not one global latency number.

Suggested classes:
- deterministic local operation;
- deterministic network/database operation;
- reflex cognition;
- standard cognition;
- deliberate cognition;
- effectful operation awaiting external provider;
- human-approval-dependent operation.

For each class measure:
- p50 / p95 latency;
- model calls;
- context size;
- handoffs;
- deterministic coverage;
- error/retry rate;
- evidence certainty.

Optimization may reduce work only if correctness/authority/evidence invariants remain unchanged.

## 5. Feature-flag and rollback posture

Every behavior-changing tranche must support:
- OFF: current production behavior;
- SHADOW: compute candidate decision, no behavioral effect;
- BOUNDED_ON: explicit tenant/path allowlist;
- DEFAULT_ON: only after admitted evidence;
- EMERGENCY_OFF: immediate return to prior canonical path.

No feature flag may bypass authority or evidence; it selects optimization behavior only.

Rollback rule:
optimization can always fall back to the canonical slower path.
The canonical slower path cannot fall back to a less safe path merely to preserve latency.

## 6. Production proof matrix

Each packet must classify proof requirements:

EXACT_FORMAL_OR_DETERMINISTIC
- parsing, classification invariants, fingerprints, schema, state transition, authority predicates.

INTEGRATION_STATE
- database state, transactions, concurrency, tenant isolation, cache invalidation.

EXTERNAL_EFFECT
- provider result, retry/reconciliation, UNKNOWN outcome.

SEMANTIC_EVALUATION
- usefulness, explanation quality, natural-language reasoning.

A weaker proof class may never override failure in a stronger applicable class.

## 7. Initial production candidate sequence

1. PR #155 completion/checkpoint.
2. P1 determinization/semantic-latency telemetry baseline.
3. P3 Context Compiler shadow promotion if write-set conflict-free.
4. P2 deterministic decomposition shadow contract.
5. P4 CognitiveTriage risk-aware routing.
6. P5 one bounded signal-admission family.
7. P6 verified-path compilation only after adequate outcome evidence.

The existing time-bounded OTel/Langfuse compatibility work remains part of Assurance/observability sequencing and should be used as the telemetry substrate where coherent.

## 8. Success criteria

Production alignment is successful when:

- low-risk deterministic operations complete without unnecessary model calls;
- consequential operations retain all current authority/evidence guarantees;
- context size decreases without critical-context loss;
- deterministic coverage rises;
- semantic latency falls at p50/p95 for eligible paths;
- model calls per eligible operation fall;
- no increase in authorization errors, tenant violations, duplicate effects, unknown outcomes disguised as success, or correction/reversal rate;
- every optimization can be explained by exact state/evidence;
- every optimization can be disabled without losing core product behavior.

## 9. Current decision

ADOPT AS PRODUCTION ALIGNMENT.

This document does not itself authorize runtime mutation or deployment.

It converts the speed/determinization R&D into a bounded production programme that reuses current owners and supplies rollout, proof, rollback and SLO rules. Individual implementation packets still require exact-current-main characterization and issue #80 authority.
