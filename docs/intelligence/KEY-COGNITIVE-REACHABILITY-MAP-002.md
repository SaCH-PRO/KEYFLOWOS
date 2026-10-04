# KEY Cognitive Reachability Map 002 — Live Entry Paths and Kernel Ownership

Status: **PROVISIONAL FORENSIC MAPPING / DOCS ONLY**  
Live code reference: main@110532883411007787f62de35e0a951aa1c16cfa  
Companions:
- KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md
- KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md
- KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md

Purpose: establish which KEY cognitive components are actually reached by current product entry paths and which are merely registered, optional, secondary, or parallel.

## 1. No-fake-green rule

For this map:

```text
registered != reachable != user-reachable != authoritative != correct != proven
```

A provider being listed in a NestJS module proves only construction/availability.

## 2. Current primary user-facing cognition paths

### Path A — shipped KEY chat

```text
Web
apps/web/src/components/key/chat/use-key-stream.ts
    |
    | POST /ai/businesses/:businessId/flow/chat/stream
    v
AiFlowController
apps/server/src/modules/ai/flow.controller.ts
    |
    v
FlowOrchestratorService.streamChat()
apps/server/src/modules/ai/flow-orchestrator.service.ts
```

This is the ordinary shipped chat path.

Observed responsibilities in this path include:
- authentication and BusinessGuard at the HTTP surface;
- conversation/session continuity;
- crew/role resolution;
- cognitive triage;
- prompt/evidence discipline;
- business graph / AiMemory / semantic memory / unified-memory perception;
- tool selection;
- model invocation;
- tool execution;
- confirmation/approval flow;
- plan execution;
- session persistence;
- optional deliberation escalation.

**Classification:** CURRENT PRIMARY COGNITIVE/AGENCY SPINE CANDIDATE.

It is also a large god-service and must not be canonized in its present form merely because it is the live path.

### Path B — explicit Deep Think / conscious cognition

```text
Web
apps/web/src/components/key/chat/use-key-cognition.ts
    |
    | GET /api/v1/cortex/conscious/stream
    v
KeyCortexController
@Controller('api/v1/cortex')
@UseGuards(AuthGuard, BusinessGuard)
    |
    v
KeyCortexConsciousnessService.processConsciously()
```

The controller also exposes POST /api/v1/cortex/conscious/chat.

The consciousness pipeline executes emotion, mind-state selection, temporal context, interoception, multimodal reasoning, intuition, metacognition, conditional creativity, ethics, synthesis and self-model/logging.

**Classification:** LIVE SECONDARY DEEP-DELIBERATION PATH.

Important limitation already documented in code: the consciousness service itself does not own the canonical executor/tool registry. It reasons and returns proposals; ordinary action execution still belongs elsewhere.

### Path C — legacy/decomposed Cortex query runtime

```text
KeyCortexReasoningService.processQuery()
    |
    v
KeyCortexQueryPipelineService.processQuery()
```

The reasoning service is a thin orchestrator around the decomposed pipeline and optional integration layers.

Current repository search shows the query pipeline is used by KeyCortexReasoningService and tests. The main shipped web chat instead calls the Flow path. Therefore this path is not currently the product's primary ordinary-chat spine.

**Classification:** LIVE SERVER SURFACE / NON-PRIMARY PRODUCT COGNITIVE SPINE; CONVERGENCE REQUIRED.

## 3. Primary architectural contradiction confirmed

KEY currently has at least two materially overlapping cognition runtimes:

```text
A. FlowOrchestratorService
   ordinary chat + tools + execution + memory + role + triage

B. KeyCortexConsciousnessService
   deep cognition + interoception + emotion + reasoning + ethics + metacognition
```

and a third decomposed Cortex query pipeline remains available.

This confirms COG-001 from the implementation crosswalk.

Target direction remains:

> one cognitive runtime with selectable reflex / standard / deliberate / deep configurations, while action authority and effect execution remain explicit.

Do not solve this by deleting a live path before parity/reachability proof.

## 4. K1–K7 current reachability observations

### K1 — Self / Constitution / Authority

**Live on ordinary chat: PARTIAL.**

The Flow path has governance/tool-risk/confirmation machinery and can invoke existing oversight/autonomy surfaces. Business-scoped roles and governance are reachable.

However:
- KEY platform identity is still not represented by one canonical self contract;
- role/persona is not identity;
- Business Genome/Constitution remains domain-scoped;
- authorization is spread across AI oversight, autonomy, approvals and tool-specific paths.

**Current state:** PARTIAL LIVE / FRAGMENTED AUTHORITY.

### K2 — Reality / Epistemic Integrity

**Live on ordinary chat: PARTIAL-STRONG.**

The shipped Flow path now appends evidence discipline and builds a perception section using unified memory retrieval. Cognitive triage can consume interoception, endocrine, immune, salience, epigenetic and incentive standing context.

Deep Think additionally senses body state before reasoning.

Still missing as one canonical live layer:
- normalized observation/assertion/evidence/fact distinction across all inputs;
- consumer-specific knowledge eligibility generalized beyond Genome/document paths;
- one receptor/event ingress contract across connectors, memory and live environment.

**Current state:** LIVE BUT SEMANTIC OWNERSHIP FRAGMENTED.

### K3 — Memory / World Model / Time

**Live on ordinary chat: YES, but plural.**

Flow uses:
- AiMemory;
- SemanticMemory;
- BusinessGraph;
- Genome facts;
- UnifiedMemoryRetrieval perception join;
- session/conversation history.

Deep Think uses temporal context and Genome/context services.

The M0 memory programme exists because writer/store/lineage semantics remain plural and incompletely unified.

**Current state:** USER-REACHABLE / MULTIPLE AUTHORITIES / M0 AUDIT REQUIRED.

### K4 — Cognition

**Live: YES, through more than one route.**

Ordinary chat:
- model reasoning through Flow;
- evidence discipline;
- role/crew framing;
- cognitive triage;
- optional deliberation escalation.

Deep Think:
- explicit multi-method cognition including reasoning, temporal, emotion, intuition, metacognition, creativity and ethics.

Legacy Cortex query pipeline:
- additional reasoning/prompt/tool-loop path.

**Current state:** STRONGLY LIVE / DUPLICATED RUNTIME.

### K5 — Executive / Judgment / Specialization

**Live on ordinary chat: PARTIAL-STRONG.**

Reachable mechanisms include:
- RoleEngineService crew resolution;
- CognitiveTriageService effort tier;
- tool filtering/selection;
- ModelGateway;
- planner/plan execution;
- deliberation escalation;
- risk/governance checks.

But these are not one explicit specialization compiler.

Current decisions are split across:
```text
role/crew
triage
tool selection
model routing
planning
autonomy/governance
deep-think escalation
```

**Current state:** LIVE / FRAGMENTED SPECIALIZATION AND EXECUTIVE CONTROL.

### K6 — Agency / Execution / Coordination

**Live on ordinary chat: STRONG.**

Flow is currently the strongest user-facing action path:
- hundreds of registered provider-neutral tools;
- tool selection;
- direct execution;
- confirmation-required path;
- plan execution;
- external/domain service access.

Cortex also has executor, connector, organ registry, saga and approval surfaces, creating overlap.

Deep Think itself does not own canonical hands and must rejoin an execution surface.

**Current state:** STRONGLY LIVE / DUPLICATED TOOL AND EXECUTION STACKS.

### K7 — Adaptation / Viability / Learning

**Live: MIXED.**

Reachable standing-state mechanisms:
- endocrine context;
- interoception;
- immune/salience/incentive/epigenetic context through triage;
- learning/outcome surfaces in Cortex and Genome;
- eval/self-assessment services are registered.

Some mechanisms remain in-memory, partial, scheduler-dependent or under-proven. Their effect on ordinary user-facing cognition is uneven.

**Current state:** PARTIAL LIVE / REACHABILITY AND DURABILITY NEED PROOF.

## 5. Important live-path findings

### F-COG-R002-01 — The product spine is Flow, not Cortex QueryPipeline

The main web hook sends ordinary chat to:
`/ai/businesses/:businessId/flow/chat/stream`.

Therefore architectural work that exists only in KeyCortexQueryPipelineService does not automatically affect the shipped product.

Consequence:
- every proposed cognitive invariant must identify whether it is enforced on Flow, Deep Think, both, or neither.

### F-COG-R002-02 — Deep Think is now genuinely user-reachable

The web hook `use-key-cognition.ts` calls `/api/v1/cortex/conscious/stream`, and the Cortex controller calls `processConsciously()`.

Therefore Consciousness is no longer dormant.

But:
- it remains a separate runtime;
- it lacks canonical action execution ownership.

### F-COG-R002-03 — Triage is closer to Executive than Cognition

CognitiveTriageService does not itself reason with a model. It grades effort, task context and resource posture before inference.

It consumes:
- AdaptiveRouter dimensions;
- endocrine state;
- interoception;
- immune;
- epigenetics;
- incentive;
- salience.

**Canonical placement:** K5 Executive, consuming K2/K7 signals.

### F-COG-R002-04 — Biological mechanisms are entering the live path as standing state

The ordinary Flow path now consumes standing context assembled from multiple "body" systems rather than leaving them purely behind the conscious route.

This supports the earlier reclassification:
- biological names are mechanisms/signals;
- canonical ownership remains K2/K5/K7.

### F-COG-R002-05 — Memory convergence must follow the shipped Flow path

UnifiedMemoryRetrieval is now on the Flow perception path, but AiMemory, SemanticMemory, BusinessGraph, Genome and conversation/session state also participate.

Memory convergence cannot be declared complete by unifying only Cortex readers.

### F-COG-R002-06 — Specialization is already real but not compiled

The shipped path already makes multiple specialization decisions:
- crew/roles;
- effort tier;
- tool menu;
- model route;
- planning;
- optional deep deliberation.

This proves the specialization compiler is not speculative; it would unify existing decisions already made independently.

## 6. Candidate one-runtime convergence shape

Do not merge code yet. Target behavior:

```text
USER / EVENT / WORKFLOW
        |
        v
K2 REALITY / OBSERVATION
        |
        v
K5 EXECUTIVE TRIAGE
  classify objective
  risk
  uncertainty
  complexity
  resource state
  action requirement
        |
        +-- REFLEX
        +-- STANDARD
        +-- DELIBERATE
        +-- DEEP
        |
        v
K4 COGNITION METHODS
  selected reasoning operators only
        |
        v
K5 DECISION CONVERGENCE / PLAN
        |
        v
K6 AGENCY
  tool/workflow/delegation/swarm
        |
        v
OUTCOME / EXTERNAL EVIDENCE
        |
        v
K7 ADAPTATION
```

Deep Think becomes one configuration of this runtime, not another sovereign mind.

## 7. Safe migration principle

The likely migration spine is the shipped Flow path because it is already the ordinary user-facing chat/action runtime.

However, that is a **hypothesis**, not yet a final decision.

Before choosing the canonical runtime spine:
1. enumerate all Flow responsibilities;
2. enumerate all QueryPipeline responsibilities;
3. enumerate all Consciousness responsibilities;
4. map overlapping capabilities and unique capabilities;
5. define parity tests;
6. move one responsibility at a time;
7. leave compatibility adapters until live client proof passes;
8. retire duplicate path only after route and behavioral proof.

## 8. Next reachability tranche

COG-MAP-003 should map:
- all action/executor paths;
- all planners;
- all tool/capability registries;
- all event buses;
- all memory writers/readers;
- all learning/outcome loops;
- all scheduled/background cognition;
- WebSocket/SSE and autonomous event entry points.

For every component record:
- entry point;
- direct callers;
- store reads/writes;
- external effects;
- user reachability;
- authority boundary;
- K1–K7 owner;
- classification: canonical candidate / specialization / adapter / duplicate / dormant / broken / unknown.

## 9. Current conclusion

The central cognitive convergence problem is no longer abstract.

The live code demonstrates:

> KEY already has a user-facing action-capable Flow brain, a user-facing Deep Think brain, and a decomposed Cortex query brain. The next architecture must make these modes of one KEY runtime while preserving the stronger execution, memory, evidence and cognition capabilities from each.
