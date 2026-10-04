# KEY Cognitive Architecture - Implementation Crosswalk 001

Status: PROVISIONAL IMPLEMENTATION MAPPING / DOCS ONLY  
Companion: KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md  
Live implementation reference: main@110532883411007787f62de35e0a951aa1c16cfa

## 1. Purpose

Map the provisional seven-kernel KEY cognitive architecture onto current implementation evidence without creating new production abstractions.

Classification vocabulary:
- RETAIN_CANONICAL_CANDIDATE
- RETAIN_SPECIALIZATION
- IMPLEMENTATION_MECHANISM
- COMPATIBILITY_PROJECTION
- DUPLICATED_CONVERGE
- HISTORICAL
- DORMANT_OR_UNPROVEN
- DEFECT_BLOCKER
- GENUINELY_MISSING

No service earns canonical status merely because it exists or is registered.

## 2. K1 - Self / Constitution / Authority

Question: Who is KEY, what matters, what may it do, and under whose authority?

### Strong existing candidates
- key-autonomy/autonomy-orchestrator.service.ts - RETAIN_CANONICAL_CANDIDATE for action authorization/admission input.
- key-autonomy/autonomy-level.service.ts - RETAIN_SPECIALIZATION for business autonomy policy.
- key-autonomy/authority-grant-rule.service.ts - RETAIN_SPECIALIZATION.
- key-autonomy/constitution-values.service.ts - RETAIN_SPECIALIZATION.
- key-autonomy/key-autonomy-safety.service.ts - RETAIN_SPECIALIZATION for runtime ceilings/kill-switch/budgets.
- key-autonomy/safety-shell.service.ts - RETAIN_SPECIALIZATION.
- business-genome/constitution-version.service.ts - RETAIN_SPECIALIZATION as business-scoped constitution, not KEY identity.
- ai/role-engine.service.ts - not identity; move conceptually to K5 specialization.
- key-cortex/key-cortex-personality.service.ts - IMPLEMENTATION_MECHANISM for voice/personality, not constitutional identity.

### Gaps
- GENUINELY_MISSING: explicit platform-level KEY identity contract distinct from tenant/business Genome.
- GENUINELY_MISSING: canonical goal/value hierarchy that separates KEY invariants, user goals, business goals, packet/task goals and temporary specialist objectives.
- GENUINELY_MISSING: one explicit self-model surface for capabilities, current permissions, resource state and bounded uncertainty.

### Convergence rule
Business Constitution and Blueprint/Genome describe a business. They must not become KEY's own identity.

## 3. K2 - Reality / Epistemic Integrity

Question: What is happening, what supports it, and is that knowledge eligible to influence a decision?

### Existing candidates
- business-genome/key-genome/genome-evidence.service.ts - RETAIN_SPECIALIZATION.
- business-genome/key-genome/genome-signal.service.ts - RETAIN_SPECIALIZATION.
- business-genome/key-genome/genome-fact.service.ts - RETAIN_SPECIALIZATION, subject to stronger assertion/evidence/fact semantics.
- key-cortex/key-cortex-evidence.service.ts - DUPLICATED_CONVERGE with canonical evidence semantics.
- key-cortex/cognitive-event-bus.service.ts - IMPLEMENTATION_MECHANISM / needs event-substrate convergence.
- key-cortex/key-cortex-event-bus.service.ts - DUPLICATED_CONVERGE; in-memory semantics are not durable epistemic truth.
- EventEmitter2 app bus - IMPLEMENTATION_MECHANISM, not source of truth.
- key-cortex/organs/* - RETAIN_SPECIALIZATION as receptor/effect adapter concept.
- key-cortex/watchers/* - RETAIN_SPECIALIZATION as observation producers.
- key-cortex/key-cortex-salience.service.ts - IMPLEMENTATION_MECHANISM producing salience signals.
- key-cortex/cognitive-triage.service.ts - primarily K5, consumes K2 signals.
- key-cortex/key-cortex-interoception.service.ts - RETAIN_SPECIALIZATION as internal/system sensing.
- key-cortex/key-cortex-immune.service.ts - primarily K7 defense response, fed by K2 observations.

### Memory-programme alignment
Issues #123-#125 already define the stronger direction:
- authority != confidence != verification;
- observedAt != recordedAt;
- provenance/evidence required;
- parsed claim != verified fact;
- source identity/version/content hash;
- cross-scope isolation.

### Gaps
- GENUINELY_MISSING: consumer-specific EvidenceAdmissionDecision / KnowledgeEligibility contract generalized beyond documents/Genome.
- GENUINELY_MISSING: normalized observation/assertion/evidence/fact/belief distinction across all KEY sources.
- GENUINELY_MISSING: one durable receptor contract for multimodal/internal/external inputs.

## 4. K3 - Memory / World Model / Time

Question: What does KEY know and remember across time?

### Existing memory stores/readers
- ai/ai-memory.service.ts - RETAIN_SPECIALIZATION pending #122 audit.
- ai/semantic-memory.service.ts - RETAIN_SPECIALIZATION pending #122 audit.
- key-cortex/unified-memory-retrieval.service.ts - RETAIN_CANONICAL_CANDIDATE for retrieval composition.
- key-cortex/unified-memory-writer.service.ts - RETAIN_CANONICAL_CANDIDATE for migration/convergence seam.
- key-cortex/key-cortex-memory.service.ts - DUPLICATED_CONVERGE / legacy risk until audit resolves live authority and durability.
- temporal-flow/temporal-flow-memory.service.ts - RETAIN_SPECIALIZATION as temporal/obligation memory.
- business-genome/key-genome/genome-memory.service.ts - RETAIN_SPECIALIZATION as business-domain memory.
- CognitionMemory / CognitiveEvent / BusinessEvent models - COMPATIBILITY_PROJECTION until semantic ownership is clear.
- key-cortex/memory-consolidation.service.ts - RETAIN_SPECIALIZATION under K7/K3 boundary.
- key-cortex/key-cortex-conversation.service.ts and session service - working/interaction memory, not long-term truth.

### World-model candidates
- Business Genome fact kernel - RETAIN_SPECIALIZATION as business world-model projection.
- ai/business-graph.service.ts - requires detailed causal/reachability audit before canonical status.
- key-cortex/key-bi-engine.service.ts - derived business mental model; not source of truth.
- Context Genome programme (#106, #123-#126) - target unifying substrate, no production cutover yet.

### Temporal candidates
- temporal-flow/* - RETAIN_SPECIALIZATION.
- key-cortex/key-cortex-temporal-reasoning.service.ts - K4 reasoning method consuming K3 temporal state, not owner of time truth.
- key-cortex/key-cortex-circadian.service.ts - K7 scheduling mechanism.

### Gaps
- GENUINELY_MISSING: one canonical memory identity/lineage contract across scopes.
- GENUINELY_MISSING: explicit bitemporal/current-validity semantics across all memory families.
- GENUINELY_MISSING: causal representation distinct from correlation/association.
- GENUINELY_MISSING: formal world-model boundary separating authoritative domain state, derived interpretation and hypothesis.

## 5. K4 - Cognition

Question: What follows, what might be true, what could happen, and what solutions exist?

### Existing reasoning
- key-cortex/key-cortex-reasoning-engine.service.ts - RETAIN_SPECIALIZATION as a reasoning-method library.
- key-cortex/key-cortex-query-pipeline.service.ts - RETAIN_CANONICAL_CANDIDATE as one possible turn-runtime spine, subject to convergence.
- key-cortex/key-cortex-consciousness.service.ts - DUPLICATED_CONVERGE; deep-deliberation path should become a mode of one runtime.
- key-cortex/key-cortex-reflection.service.ts - RETAIN_SPECIALIZATION as reflective method, but persistence defects must be fixed.
- key-cortex/key-cortex-intuition.service.ts - RETAIN_SPECIALIZATION only if measurable and evidence-bounded; current persistence gaps.
- key-cortex/key-cortex-creativity.service.ts - RETAIN_SPECIALIZATION as method.
- key-cortex/key-cortex-emotion.service.ts / mood detection - RETAIN_SPECIALIZATION as social/context signal processing.
- key-cortex/key-cortex-temporal-reasoning.service.ts - RETAIN_SPECIALIZATION as method.
- key-cortex/key-cortex-metacognition.service.ts - RETAIN_SPECIALIZATION at K4/K7 boundary; currently under-tested.
- key-cortex/key-cortex-quality.service.ts - RETAIN_SPECIALIZATION as response-quality verifier.
- ai/model-gateway.service.ts - computational substrate router, not cognition itself.
- ai/strategic-intelligence.service.ts and ai/ai-advisor.service.ts - require detailed anti-duplication mapping before retention.

### Target
One cognitive runtime should select reasoning methods and computational substrates according to the problem rather than maintaining parallel sovereign pipelines.

### Gaps
- GENUINELY_MISSING: problem-type recognition that can compile a task to LLM, graph, solver, statistics, simulation, deterministic code or mixed methods.
- GENUINELY_MISSING: explicit hypothesis lifecycle with support/counterevidence, assumptions and falsification.
- GENUINELY_MISSING: shared simulation/counterfactual interface independent of prose generation.

## 6. K5 - Executive / Judgment / Specialization

Question: What should KEY do, how much cognition is justified, and what configuration should it use?

### Existing candidates
- key-cortex/adaptive-router.service.ts - RETAIN_SPECIALIZATION.
- key-cortex/cognitive-triage.service.ts - RETAIN_SPECIALIZATION for cognitive effort tiering.
- key-cortex/key-cortex-expertise-lens.service.ts - RETAIN_SPECIALIZATION.
- ai/role-engine.service.ts - RETAIN_SPECIALIZATION; roles are cognitive lenses/configurations, not KEY identities.
- ai/key-agent-config.service.ts - COMPATIBILITY_PROJECTION into future specialization contract.
- ai/model-gateway.service.ts - computational/model selection mechanism.
- key-cortex/key-cortex-provider-selection.service.ts - DUPLICATED_CONVERGE with ModelGateway where overlapping.
- key-cortex/key-cortex-planner.service.ts / ai/planner.service.ts / ai/key-planner.service.ts - DUPLICATED_CONVERGE; separate domain planners may survive as specializations but one executive planning contract is needed.
- ai/task-prioritizer.service.ts - RETAIN_SPECIALIZATION.
- business-genome recommendation ranker/opportunity detector - RETAIN_SPECIALIZATION as domain decision support, not global executive authority.
- Decision-Convergence Kernel research - GENUINELY_MISSING as canonical generalized admission/judgment primitive, though pieces exist in autonomy/review workflows.

### Required specialization compiler output
- objective/problem class;
- knowledge/memory scopes;
- reasoning methods;
- computational method;
- model tier/provider;
- tools/capabilities;
- authority/risk/evidence requirements;
- cognitive budget;
- execution topology;
- verification contract.

### One-KEY invariant
Role crew, specialist mode, delegated worker and swarm are temporary execution/cognitive configurations of one KEY.

## 7. K6 - Agency / Execution / Coordination

Question: How does KEY change the world safely and prove what happened?

### Strong existing candidates
- ai/flow-tool-registry.ts - RETAIN_CANONICAL_CANDIDATE for capability identity per current app-spec/ADR direction.
- key-cortex/key-cortex-tool-registry.service.ts - COMPATIBILITY_PROJECTION / convergence target.
- ai/key-tool-registry.service.ts - COMPATIBILITY_PROJECTION / convergence target.
- key-cortex/key-cortex-connector.service.ts + typed adapters - RETAIN_SPECIALIZATION as adapter layer if canonical capability identity is preserved.
- key-cortex/organs/* - RETAIN_SPECIALIZATION as receptor/effect adapter layer.
- key-autonomy/key-action-proposal.service.ts - RETAIN_CANONICAL_CANDIDATE for material action lifecycle.
- key-autonomy/key-action-executor.service.ts / registry - RETAIN_SPECIALIZATION.
- key-cortex/key-cortex-executor.service.ts - DUPLICATED_CONVERGE with canonical execution path.
- key-cortex/key-cortex-approval-orchestrator.service.ts - RETAIN/CONVERGE with action proposal/autonomy semantics.
- key-cortex/key-idempotency.service.ts - RETAIN_SPECIALIZATION.
- key-cortex/key-cortex-saga.service.ts / saga-executor / compensation - RETAIN_SPECIALIZATION; compensation correctness defects must be fixed.
- ai/flow-orchestrator.service.ts - RETAIN_SPECIALIZATION or candidate long-horizon runtime pending overlap mapping.
- ai/plan-executor.service.ts / journey-orchestrator / agent state machine / queue - require execution-runtime convergence.
- ai/agent-bus.service.ts - RETAIN_SPECIALIZATION as distributed-worker transport if needed; not identity.
- key-cortex/key-cortex-flow-studio.service.ts - product workflow surface; should compile onto canonical execution runtime rather than own parallel semantics.

### Gaps
- GENUINELY_MISSING: one explicit execution topology contract: direct, sequential workflow, DAG, parallel workers, specialist panel, hierarchy, swarm.
- GENUINELY_MISSING: deterministic join/reintegration contract for delegated workers back into one KEY.
- GENUINELY_MISSING: universal intended effect -> attempted effect -> provider evidence -> observed external effect -> business outcome reconciliation.

## 8. K7 - Adaptation / Viability / Learning

Question: Did it work, is KEY healthy, and how should future behavior change?

### Existing candidates
- key-cortex/key-cortex-homeostasis.service.ts - RETAIN_SPECIALIZATION.
- key-cortex/key-cortex-interoception.service.ts - K2/K7 sensing.
- key-cortex/key-cortex-immune.service.ts - RETAIN_SPECIALIZATION for anomaly/incident response.
- key-cortex/key-cortex-cerebellum.service.ts - RETAIN_SPECIALIZATION for intended-vs-actual correction.
- key-cortex/key-cortex-learning.service.ts - RETAIN_SPECIALIZATION pending effectiveness audit.
- key-cortex/key-cortex-evolution.service.ts - DORMANT_OR_UNPROVEN in parts; requires caller/reachability proof.
- key-cortex/memory-consolidation.service.ts - RETAIN_SPECIALIZATION.
- key-cortex/value-learning.service.ts - RETAIN_SPECIALIZATION with human-governed promotion.
- key-cortex/self-assessment.service.ts - RETAIN_SPECIALIZATION but current metric semantics require audit.
- key-cortex/eval-harness.service.ts - RETAIN_CANONICAL_CANDIDATE for TEVV seam, but must be operationalized.
- business-genome outcome-learning services - RETAIN_SPECIALIZATION as domain learning.
- ai/feedback-loop.service.ts / pattern-detector.service.ts / agent-health.service.ts / key-monitor.service.ts - require duplication map before canonical status.
- key-cortex/key-cortex-circadian.service.ts - IMPLEMENTATION_MECHANISM for scheduled adaptation/maintenance.

### Hard learning rule
Most learning should first change memory, procedures, policies, routing weights or bounded adapters; foundation-model weight updates require a much higher proof threshold.

## 9. Cross-kernel contradictions requiring convergence packets

1. Main query pipeline vs consciousness pipeline.
2. Flow tool registry vs cortex tool registry vs ai tool registry.
3. Cortex event bus vs app EventEmitter bus.
4. KeyCortexMemory vs AiMemory/SemanticMemory vs GenomeMemory vs TemporalFlowMemory vs CognitionMemory.
5. Cortex planner vs ai planner vs key-planner vs journey/flow planning.
6. RoleEngine vs ExpertiseLens vs AdaptiveRouter vs CognitiveTriage vs KeyAgentConfig.
7. Cortex executor vs autonomy action executor vs flow/plan execution paths.
8. Multiple learning/evolution/outcome loops.
9. Business Genome self-model vs KEY self-model.
10. Product biological metaphors vs canonical semantic ownership.

## 10. Defect constraints

Do not treat current architecture as target where live evidence already shows defects:
- audit route tenant isolation defect;
- unsafe JS/Python sandbox boundary;
- multi-replica cron double-fire risk;
- reflection/intuition persistence loss;
- no-op compensation paths;
- unreachable or dead web/socket surfaces;
- substantial untested critical services.

## 11. Immediate next packets

### COG-MAP-002 - exact ownership/reachability
Trace K1-K7 through real entry points, callers, stores, events, scheduled jobs and external effects.

### COG-COMP-001 - computational realizability
For every K1-K7 responsibility, classify:
- deterministic;
- neural/model;
- symbolic/algorithmic;
- solver/optimization;
- persistent-state/graph;
- distributed;
- human-only authority;
- research frontier.

### COG-SPEC-001 - specialization compiler
Unify role/lens/router/triage/model/tool/topology selection into one typed cognitive-composition contract without changing authority semantics.

### COG-RUNTIME-001 - one cognitive runtime
Design the convergence path from dual main/conscious pipelines to one runtime with reflex/standard/deliberate/deep modes.

### COG-TEVV-001
Define kernel-level behavioral proof so "implemented" means reachable, correct and evidenced.

## 12. Current conclusion

KEY does not need a greenfield second brain.

It needs **convergence of the intelligence it already has** into one persistent identity, one coherent cognitive runtime, one explicit evidence/memory/world-model substrate, one executive specialization/admission layer and one verifiable execution/learning loop.
