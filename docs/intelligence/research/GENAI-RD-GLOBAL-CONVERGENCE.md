# KEYFLOWOS — Global Cross-Layer GenAI R&D Convergence

Status: **GLOBAL CONVERGENCE PASS 1 COMPLETE / RESEARCH ONLY / NO IMPLEMENTATION AUTHORITY**  
Date: 2026-10-06  
Parent durable ledger: GitHub issue #153  
Master continuity: `docs/intelligence/research/GENAI-RD-MASTER-CONTINUATION.md`

## 1. Executive verdict

The 10-layer GenAI research programme does **not** justify ten new runtimes, ten new kernels, or a stack assembled by installing the named products.

The smallest coherent target is a native KEY architecture with **one owner per semantic concern**, surrounded by replaceable adapters, models, evaluators, indexes and observability backends.

The global convergence is:

```
Business / Project Truth + Constitution + Authority
                  |
                  v
        Context Genome / World Model
                  |
                  v
       Cognitive Function Contract
                  |
        Model Strategy / Gateway
                  |
                  v
    Proposal / Plan / Procedure Layer
                  |
                  v
Governed Capability + Connector Fabric
                  |
                  v
      Effect Execution / Recovery
                  |
                  v
        Evidence + Outcome Truth
                  |
                  v
 Assurance / Evaluation / Learning
```

Cross-cutting every boundary:

```
Guardrail & Trust-Boundary Fabric
Observability / exact revision lineage
Privacy / tenant isolation
Human approval / bounded autonomy
```

The core law is:

> **Models create intelligence, not authority. Retrieval creates candidates, not truth. Guardrails constrain behavior, not grant permission. Traces and scores create evidence, not proof. External systems remain replaceable.**

## 2. Canonical ownership model

These are logical ownership planes, not a mandate to create new services.

### A. Truth, identity, constitution and authority

**Existing owners to strengthen**
- canonical business-domain tables/services;
- Business Blueprint / Business Genome;
- BusinessConstitutionVersion;
- AuthorityGrant / autonomy configuration;
- `AutonomyOrchestratorService`;
- project constitution / decision memory from #106;
- control-plane authority / contract compiler from #121.

**Owns**
- what is true/current/authoritative;
- who may act;
- what policies are in force;
- approval and autonomy ceilings;
- supersession/validity.

**Does not own**
- semantic relevance;
- model confidence;
- embeddings;
- guardrail classifier truth;
- observability truth.

### B. Context Genome / memory / world model

**Existing owners to strengthen**
- #106 Context Genome direction;
- #122 Memory Truth Audit;
- `UnifiedMemoryRetrievalService`;
- Business Genome / GenomeFact / GenomeEvidence / GenomeMemoryEvent;
- AiMemory / semantic-memory projection;
- TemporalFlow / CognitionMemory / BusinessEvent sources.

**Owns**
- typed facts, observations, episodes, preferences, decisions, policies, hypotheses and derived-state projections;
- authority class;
- valid time vs recorded time;
- provenance;
- supersession;
- context scope;
- memory retrieval boundary.

**Key rule**
Semantic/vector retrieval is an access/projection layer, never canonical truth.

### C. Cognitive Function Contract & model execution

**Existing owners to strengthen**
- `ModelGatewayService`;
- Layer-7 logical `CognitiveFunctionRevision`;
- `OutputContract`;
- provider strategy/lowering.

**Owns**
- typed cognitive task contract;
- prompt/program revision;
- input/output schema;
- provider/model capability requirements;
- retry/repair strategy;
- uncertainty/evidence requirements.

**Does not own**
- durable workflow state;
- action authority;
- business permissions;
- canonical memory.

### D. Planning / procedure / cognition

**Existing owners to strengthen**
- Cortex reasoning/planning as advisory cognition;
- Flow planner/executor as governed execution substrate;
- #135 ProcedureSpec / procedural morphogenesis.

**Owns**
- decomposition;
- reasoning strategy;
- plans;
- bounded procedures;
- simulation/replanning;
- procedure promotion lifecycle.

**Hard boundary**
Per ADR-0001, Cortex may propose/deliberate; Flow is the canonical execution substrate.

### E. Governed Capability, Connector & Delegation Fabric

**Existing owners to strengthen**
- `FLOW_TOOLS`;
- `CapabilityContractService`;
- Flow orchestrator;
- AI oversight/autonomy;
- core connector registry;
- MCP/A2A/computer-use adapters;
- connected-account/credential infrastructure.

**Owns**
- canonical capability identity;
- schemas;
- risk/effect class;
- authority gate;
- account binding;
- idempotency/dependency semantics;
- connector lifecycle;
- execution receipts.

**Adapters**
- MCP = protocol adapter;
- function calling = model proposal interface;
- A2A = external-agent delegation adapter;
- computer use = last-mile actuator;
- Composio/Arcade = reference mechanisms, not canonical runtimes.

### F. Effect safety, recovery and outcome

**Existing owners to strengthen**
- domain services;
- `SafetyShellService`;
- action audit;
- saga/compensation infrastructure;
- Evidence services;
- BusinessEvent / provider receipts / downstream state.

**Owns**
- actual side effects;
- durable idempotency;
- pre/postconditions;
- compensation;
- reconciliation;
- actual business outcome.

**Hard rule**
Tool/model claims of success cannot override observed external/business state.

### G. Evidence-Linked Evaluation & Observability

**Existing owners to strengthen**
- #130 Assurance Fabric;
- #151 harness/eval convergence;
- proof-admission / proof-mutation;
- Evidence/Outcome;
- current Langfuse shim as replaceable exporter.

**Canonical interoperability direction**
```
KEY correlation / execution identity
 -> OpenTelemetry
 -> OpenInference + KEY semantic attributes
 -> replaceable backends
```

**Logical evaluation artifacts**
- EvalDatasetRevision;
- EvaluatorRevision;
- ExperimentRun;
- EvaluationRuleRevision.

**Hard rule**
Trace != outcome. Score != proof. Judge != authority.

### H. Guardrail & Trust-Boundary Fabric

**Existing owners to strengthen**
- KeyCortex safety/quality checks;
- output/schema validation;
- autonomy/business authority;
- SafetyShell;
- centralized redaction;
- future native GuardrailPolicyRevision.

**Distinct concerns**
- instruction integrity;
- harmful-content safety;
- privacy/DLP;
- structural validation;
- business authority/effect safety.

**Hard rule**
Retrieved/tool/web/A2A/computer-use content is data by default, not authority-granting instruction.

### I. Learning, adaptation and model sovereignty

**Existing owners to strengthen**
- outcome learning;
- value learning;
- memory consolidation;
- #135 procedure promotion;
- Layer-6 model artifact lifecycle;
- #137 cognitive independence.

**Owns**
- eligibility to learn;
- versioned procedure/model candidates;
- experiments;
- shadow/canary promotion;
- rollback/retirement.

**Hard rule**
Observed success does not self-authorize learning/promotion. KEY identity is not stored in model weights.

## 3. Layer 1–10 mapping to the canonical owners

| Source layer | Surviving mechanism | Canonical KEY owner | Disposition |
|---|---|---|---|
| 1 Foundation Models | capability-based model selection, multimodal/reasoning/tool capabilities | ModelGateway + CognitiveFunction | models are replaceable competence providers |
| 2 Serving & Inference | routing, fallback, local/cloud, quantization, latency/cost/health | ModelGateway / deployment layer | adapters/runtimes are replaceable |
| 3 Orchestration | stateful graphs, retries, durable flow, agent decomposition | Flow + ProcedureSpec + Cortex advisory cognition | no second workflow/agent runtime |
| 4 Embeddings/Rerankers | RepresentationSpec, hybrid retrieval, reranking | Context Genome retrieval | projections/candidate relevance only |
| 5 Vector DBs | ANN/filter/hybrid index substrate | Postgres/pgvector baseline + replaceable index adapter | no new vector DB until benchmark proves need |
| 6 Fine-tuning | governed competence compilation, adapters/model artifacts | Learning/adaptation lifecycle | optional, after simpler mechanisms fail |
| 7 Prompt/Output | typed cognitive functions, native structured output, repair provenance | CognitiveFunctionRevision + ModelGateway | no second prompt runtime |
| 8 Tools/Protocols | capability contracts, MCP/A2A/computer-use adapters | FLOW_TOOLS / Capability Fabric | external protocols are adapters |
| 9 Eval/Observability | OTel/OpenInference, datasets/evaluators/experiments | Assurance + Evidence/Outcome | optional workbenches/backends |
| 10 Guardrails | staged rails, classifier/privacy/injection defenses | native GuardrailPolicy + authority/effect systems | detectors constrain; never authorize |

## 4. Global source-of-truth hierarchy

When two layers disagree, the ordering is:

1. **Canonical business/domain state and valid authority**
2. **Evidence of actual external effect / outcome**
3. **Versioned policy / constitution / approved procedure**
4. **Context Genome facts/decisions with provenance and temporal validity**
5. **Deterministic derived state**
6. **Retrieved candidates / semantic projections**
7. **Model outputs / recommendations / plans**
8. **Evaluator / guardrail classifier findings**
9. **Observability projections / dashboards**

Lower layers may surface contradictions but may not silently overwrite higher authority.

## 5. Current repository reality

### Credible/live owners already present

- `ModelGatewayService` is a live multi-provider routing seam.
- `FLOW_TOOLS` is the canonical tool registry per ADR-0001.
- `CapabilityContractService` projects FLOW_TOOLS into a platform capability contract.
- `AutonomyOrchestratorService` exists and is wired broadly.
- `UnifiedMemoryRetrievalService` is live on cognition/perception paths.
- `SafetyShellService.check()` is wired before KeyAction execution.
- centralized `deepRedact()` exists for structured secret-bearing fields.
- BusinessEvent, action audit, Evidence services and domain outcomes provide real evidence seams.
- development proof-admission and mutation controls already provide stronger no-fake-green semantics than most generic eval frameworks.

### Partial / semantically incomplete

- ModelGateway has provider routing but structured-output capability lowering is incomplete.
- direct model/provider calls still exist outside the gateway in parts of the codebase.
- Context Genome is an accepted architecture direction but not yet the unified persistence/truth contract.
- unified memory retrieval still blends heterogeneous sources with heuristic ranking and failure-to-empty behavior.
- capability contract exists, but version/effect/dependency/idempotency semantics are not yet rich enough for general safe parallel execution.
- connectors have overlapping core ConnectorRegistry and newer KeyConnector stacks.
- Langfuse provides only shallow model-call telemetry and uses a legacy ingestion path.
- EvalHarness exists but several suites measure weaker proxies than their names claim.
- KeyCortex safety checks exist but are not a complete multi-surface guardrail system.
- SafetyShell has real pre-check wiring but process-local idempotency and incomplete compensation.

### Declared/non-enforced or no-fake-green gaps

- `GatewayRequest.responseFormat` is declared but recovered provider dispatch does not yet make it a trustworthy native structured-output guarantee.
- current `memory-retrieval-precision` does not measure actual retrieval precision.
- current output-quality warnings are not a strong release safety barrier.
- telemetry architecture declares OpenTelemetry direction but runtime OTel/OpenInference is not recovered.
- some architecture documents describe stronger convergence than live code currently proves.

### Genuinely missing primitives

- canonical ContextFact/Decision/Policy temporal-authority contract across scopes;
- implemented CognitiveFunctionRevision lifecycle;
- exact model/index/prompt/capability/evaluator artifact lineage;
- OTel/OpenInference execution telemetry;
- GuardrailPolicyRevision / DetectorRevision lifecycle;
- safe-projection admission for retrieved/tool/MCP/web/A2A content;
- content-aware PII/secret detection across arbitrary free text;
- durable distributed idempotency for protected effects;
- mature real compensation for protected workflows;
- immutable EvalDatasetRevision/EvaluatorRevision/ExperimentRun lifecycle;
- governed threat-memory/attack-signature lifecycle;
- model adaptation artifact/promotion runtime.

## 6. Global dependency graph

The dependency order is not the same as the source-image layer order.

```
0. Critical fail-closed invariants
   |
   +--> authority errors narrow/block
   +--> tenant isolation
   +--> no partial-output effects
   +--> durable action identity for risky effects
   |
1. Stable identity / provenance / revision contracts
   |
2. Context Genome truth + temporal/authority semantics
   |
3. Capability / connector / account contract convergence
   |
4. CognitiveFunction + structured-output contract convergence
   |
5. Context/tool safe-projection guardrails
   |
6. Governed Flow / Procedure execution
   |
7. Effect receipts + Outcome / Evidence verification
   |
8. OTel/OpenInference + exact eval artifact lineage
   |
9. Learning / procedure/model promotion
   |
10. Advanced sovereignty / local-model / adaptation optimization
```

Observability can be added incrementally, but it must not become a prerequisite for basic correctness. Guardrails cross-cut stages 2–7 rather than sitting only at the end.

## 7. Highest-priority live gaps

### P0 — safety/integrity

**G0-01 — autonomy error can widen execution**
Current KeyCortex query path can fall back to all parsed commands when autonomy checking throws. This violates fail-closed authority.

**G0-02 — execution convergence remains safety-critical**
ADR-0001 establishes Flow as the single execution substrate. Any remaining Cortex/direct execution seams must be proven proposal-only or migrated behind Flow governance.

**G0-03 — durable idempotency for protected effects**
Process-local idempotency cannot protect across restart, redelivery or replicas.

**G0-04 — indirect-context admission**
Retrieved documents, web/tool/MCP/A2A/computer-use results need instruction-integrity + privacy + schema admission before model reuse.

**G0-05 — protected output/streaming safety**
Partial or unvalidated output must not trigger effects or leak protected content.

### P1 — time-sensitive / high leverage

**G1-01 — Langfuse compatibility deadline**
Current legacy Langfuse trace ingestion is scheduled to lose Cloud compatibility on 2026-11-16. The narrow correction should be OTel/current-ingestion based, not another vendor-specific architecture.

**G1-02 — Context Genome truth contract**
Memory/project/business continuity requires authority, temporal validity, provenance and supersession to become explicit before higher-order learning is trusted.

**G1-03 — structured-output honesty**
Provider-native schema capability, post-hoc validation and fallback/repair provenance must converge so declared response-format support becomes real.

**G1-04 — evaluator/proof convergence**
Replace vacuous/proxy evals with exact subjects, protected cases, evaluator calibration and mutation tests.

**G1-05 — connector/account convergence**
Resolve ConnectorRegistry/KeyConnector overlap and make connected-account/credential truth one coherent substrate.

### P2 — architectural completion

- OTel/OpenInference runtime tracing;
- hybrid/retrieval benchmark and real precision/recall;
- content-aware privacy/DLP;
- tool effect/dependency metadata;
- ProcedureSpec implementation/promotion;
- production EvaluationRule lifecycle;
- threat memory / canaries;
- multimodal safety;
- provider-blackout/local-model benchmark.

### P3 — optimization / advanced intelligence

- fine-tuning/PEFT adaptation;
- specialized/local model distillation;
- GraphRAG where benchmarks justify it;
- advanced multi-agent delegation;
- learned routing;
- model training/self-improvement after proof gates exist.

## 8. Minimum external-runtime posture

### Native owner / must remain KEY-owned
- business truth;
- Context Genome semantics;
- authority/autonomy;
- capability identity;
- connected-account truth;
- evidence/outcome;
- proof admission;
- guardrail policy/action mapping;
- learning/promotion authority.

### Optional adapter
- MCP;
- A2A;
- provider function calling;
- model providers;
- local inference runtimes;
- specialized safety/PII classifiers;
- computer-use engines.

### Optional backend / workbench
- LangSmith;
- Langfuse;
- Phoenix;
- W&B Weave;
- managed observability/APM.

### Benchmark-only unless later authorized
- specialized vector DBs;
- DeepEval/Ragas as evaluator engines;
- Llama Guard / Prompt Guard;
- Presidio service;
- NeMo Guardrails runtime;
- Guardrails AI runtime;
- Lakera/Check Point gateway;
- Composio/Arcade.

### Reject as canonical/runtime dependency
- Rebuff runtime (archived);
- second workflow/agent runtime beside Flow;
- second tool registry beside FLOW_TOOLS;
- second canonical memory store;
- external dashboard as policy/authority source;
- vector similarity as truth;
- model/guardrail confidence as proof.

## 9. Cross-cutting programme reconciliation

### Memory / Context Genome
The 10-layer findings strengthen #106/#122 rather than create a new memory system. Embeddings, rerankers and vector DBs are projections. Context compilation consumes authoritative memory; it does not own truth.

### Context Engineering
Context compilation becomes a deterministic/inspectable operation over:
source eligibility -> authority/time -> retrieval -> contradiction -> privacy/instruction integrity -> budget/order/compression -> model-specific formatting.

### Cognition
Cognition is provider-independent semantics expressed through CognitiveFunctionRevision and implemented through replaceable model/deterministic/symbolic strategies.

### Autonomy
Autonomy is not an LLM property. It is a canonical authority verdict over a proposed capability/effect under current context, policy and resource limits.

### Learning
Learning consumes verified outcomes and admitted evidence. It may propose new memory/procedures/model candidates but cannot activate them without evaluation and promotion.

### Procedural Morphogenesis
#135 becomes the bridge from repeated successful episodes to ProcedureSpec, while preserving Episode != Procedure != Permission.

### Perception / multimodal
Perception outputs are evidence candidates that must pass source/privacy/instruction-integrity admission before becoming model context or business fact.

### LLMOps / sovereignty
Local/self-hosted inference, quantization and provider failover are deployment choices under ModelGateway. KEY identity/authority/memory must survive provider changes.

### Development Organism
The development control plane is a homologous implementation of the same architecture:
context -> contract -> authority -> capability -> execution -> proof -> review -> outcome -> learning.
It remains an experimental proving ground, not a shortcut around production authority.

## 10. Anti-duplication decisions

1. **Flow remains the execution substrate.**
2. **FLOW_TOOLS remains the tool/capability source of truth.**
3. **AutonomyOrchestrator remains the canonical action verdict seam.**
4. **UnifiedMemoryRetrieval evolves; do not create a parallel memory service.**
5. **Context Genome generalizes Business Genome/project memory rather than duplicating them.**
6. **ModelGateway remains the provider-routing owner.**
7. **CognitiveFunctionRevision owns semantic task/output contracts; prompt frameworks are adapters/tools.**
8. **Evidence/Outcome and Assurance remain truth/proof owners; observability backends are projections.**
9. **GuardrailPolicy maps detector findings to actions; safety vendors/models do not own policy.**
10. **ProcedureSpec extends Flow/procedural intelligence; do not add another durable workflow runtime.**
11. **Threat memory is separate from business memory.**
12. **Adaptation artifacts are competence; they are not KEY identity or memory.**

## 11. Bounded implementation packet candidates — NOT RELEASED

These are dependency-ordered candidate packets, not authority messages.

### Candidate A — critical authority fail-closed correction
Scope only:
- remove autonomy-error widening;
- explicit blocked/approval/read-only degraded state;
- negative controls proving checker failure cannot increase capability set.

Owner: existing autonomy/Flow governance architecture.

### Candidate B — Langfuse compatibility / telemetry foundation
Scope only:
- introduce canonical execution correlation at the start of model execution;
- OTel-compatible trace foundation;
- optional current Langfuse exporter;
- exporter health;
- preserve metadata-only privacy default.

Deadline pressure: 2026-11-16 legacy-ingestion removal.

### Candidate C — CognitiveFunction / structured-output honesty
Scope:
- canonical executable schemas for selected high-value contracts;
- provider capability negotiation/lowering;
- independent post-hoc validation;
- repair/fallback provenance;
- no-op `responseFormat` eliminated.

### Candidate D — Context Genome M1 contract
Scope:
- authority/confidence separation;
- valid-time vs recorded-time;
- provenance/supersession;
- typed memory kinds/scopes;
- retrieval failure/status semantics;
- no data-store cutover yet.

Owner: #106/#122.

### Candidate E — Capability/effect contract hardening
Scope:
- capability version/effect/dependency/idempotency/account metadata;
- connector/account convergence;
- MCP/A2A adapters subordinate to same contract;
- no duplicate registry.

### Candidate F — Evaluation/proof foundation
Scope:
- EvalDatasetRevision / EvaluatorRevision / ExperimentRun;
- protected-case manifests;
- fix vacuous retrieval/planning/explanation evals;
- evaluator negative controls;
- CI integration under #130/#151.

### Candidate G — Context/tool trust-boundary admission
Scope:
- untrusted-context classification;
- indirect-injection detector interface;
- privacy transform interface;
- safe model-visible projection;
- tool/MCP result admission.

### Candidate H — durable effect safety
Scope:
- distributed idempotency;
- exact execution receipts;
- real compensation handlers;
- postcondition/outcome verification.

No candidate is released by this document.

## 12. Global proof obligations

The global architecture is not considered implemented until it can prove:

1. model/provider failure never changes business authority;
2. authority uncertainty/error never widens capability;
3. semantic retrieval never silently overrides canonical truth;
4. cross-tenant content never enters retrieval/context/effect paths;
5. model output cannot become state without typed validation;
6. partial streamed output cannot trigger side effects;
7. every consequential action resolves to a capability revision + authority verdict + effect identity;
8. duplicate/replayed protected effects remain idempotent across restart/replicas;
9. external effect claims are verified against provider/domain outcome;
10. traces reconstruct failed attempts and do not fabricate success;
11. required evals missing/skipped/errored cannot produce green admission;
12. semantic evaluators detect declared mutations before being trusted;
13. guardrail/provider outage follows explicit policy and cannot silently bypass protected checks;
14. indirect injection from tool/web/document/MCP/A2A context cannot grant authority;
15. privacy transformations are destination-aware and provenance-preserving;
16. external observability/eval backend can be removed without losing canonical truth;
17. model/provider can be replaced without changing KEY identity or durable memory;
18. learning/procedure/model promotion requires admitted evidence and rollback;
19. Development Organism uses the same no-fake-green/authority principles it is building into KEY;
20. every programme progress/completion claim has an evidence-backed denominator and exact revision.

## 13. Final architectural synthesis

The 2026 GenAI stack research does not tell KEYFLOWOS to become a framework aggregator.

It shows that a durable AI operating system needs a **small set of native semantic contracts** and a **large set of replaceable execution mechanisms**.

The canonical spine is:

```
Constitution / Authority
        |
Context Genome
        |
Cognitive Function
        |
Plan / Procedure
        |
Capability Contract
        |
Authority + Guardrails
        |
Effect Execution
        |
Evidence / Outcome
        |
Assurance / Evaluation
        |
Governed Learning / Promotion
```

Models, embeddings, vector indexes, tool protocols, guardrail classifiers, evaluators and observability products plug into this spine.

They do not become the spine.

## 14. Next legal frontier

Global convergence is complete enough to begin **CONVERGENCE VALIDATION + IMPLEMENTATION PACKET DERIVATION**, still without implementation.

Next work:
1. verify the global map against current main and existing issue owners;
2. identify contradictions/stale architecture claims;
3. map each candidate packet to existing issue/control-plane authority;
4. choose the smallest safe first packet;
5. release implementation only when explicitly authorized through the control plane.
