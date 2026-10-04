# KEY Cognitive Architecture - Archaeology & Convergence Pass 001

Status: **PROVISIONAL RESEARCH / NO PRODUCTION IMPLEMENTATION AUTHORIZED**

Repository: SaCH-PRO/KEYFLOWOS  
Live main observed: 110532883411007787f62de35e0a951aa1c16cfa  
Canonical intelligence branch observed: docs/keyflow-intelligence-foundation@b4e5bb54a80a1c7f1ef147981f4f973fe56e9b97

Purpose: reconcile historical KEY architecture, current implementation reality, canonical intelligence, and the emerging KEY cognitive/computational model before creating further abstractions.

## 0. Context Integrity Check

- Active research phase: KEY cognitive/computational architecture archaeology and convergence.
- Live implementation reference: main@110532883411007787f62de35e0a951aa1c16cfa.
- Canonical intelligence reference: docs/keyflow-intelligence-foundation@b4e5bb54a80a1c7f1ef147981f4f973fe56e9b97.
- Contradiction: the intelligence branch operational handoff still reflects a materially older main and ACTION-era checkpoint. It remains historical continuity, but it is not current implementation truth.
- Production mutation authorized: **NO**.
- This tranche: read-only archaeology plus durable documentation only.
- Context integrity: **PASS FOR BOUNDED ARCHAEOLOGY; FAIL FOR CLAIMING THE OLD HANDOFF IS CURRENT LIVE STATE**.

## 1. Research question

Before adding more cognitive modules, determine:

1. What KEY concepts already exist in plans, audits, code, and canonical intelligence?
2. Which are the same concept under different names?
3. Which are genuine specializations or implementation mechanisms?
4. Which are parallel or duplicative architectures?
5. Which are historical and superseded?
6. Which new primitives are actually missing?
7. What is the smallest coherent cognitive architecture that preserves valuable existing work?

Governing rule: **convergence, not abstraction proliferation**.

## 2. KEY corpus reviewed in this pass

This pass intentionally prioritized KEY-specific architecture rather than unrelated Markdown. Major sources included:

- docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md
- docs/KEY_GENOME_ROADMAP.md
- docs/KEY_CAPACITY_MAP.md
- KEY_10_ROADMAP_v2.md
- docs/development/KEY_10_ROADMAP_v2.md
- docs/development/KEY_10_10_ROADMAP.md
- docs/development/KEY_ROLE_IMPLEMENTATION_PLANS.md
- docs/audits/KEY_* architecture/capability audits
- docs/KEYFLOWOS_AUTOMATION_BOT_FLOW_AGENT_MASTER_PLAN.md
- docs/KEYFLOWOS_WORLD_PLUGGED_OS_MASTER_PLAN.md
- docs/KEYFLOWOS_10_OUT_OF_10_CONSTRUCTION_MANUAL.md
- docs/KEYFLOWOS_APP_SPEC.md
- docs/KEY_COMPLETION_STATUS_2026-07-23.md
- docs/neuro-atlas-code-mapping.md
- docs/system-map/03-key-cortex.md
- docs/system-map/06-business-genome.md
- docs/key-cortex-hardening-notes.md
- high-value docs/key-genome plans and verification artifacts
- docs/development/KEYFLOWOS_AUTONOMOUS_AGENT_ROLES.md
- docs/development/AGENT_CONTROL_PLANE.md
- canonical intelligence concept, taxonomy, allocation, decision, open-question and knowledge-learning supplements.

Current code was also sampled directly across key-cortex, ai, key-autonomy, Business Genome, Temporal Flow, tool/capability registries, role/specialization, planning, learning, and agent infrastructure.

This is a deep **KEY-targeted** archaeology pass, not a claim that every unrelated Markdown file in the repository was semantically reviewed.

## 3. Historical KEY architecture is already substantial

The old Mind / Soul / Evolution programme already contains most of the functional requirements now being rediscovered.

### Mind

Historically covered perception, reasoning, planning/action, unified memory, uncertainty and metacognition.

### Soul

Historically covered identity, values, governance/constitution, autonomy, trust and voice.

### Evolution

Historically covered evaluation, feedback, knowledge ingestion, memory consolidation, value learning and self-assessment.

### Body

Historically covered domain modules, connectors, tools and real-world execution surfaces.

The correct move is not to replace Mind/Soul/Evolution with a new vocabulary. It is to refine those historical responsibilities into explicit canonical primitives and map the implementation onto them.

## 4. The current implementation contains multiple overlapping brains

The strongest current implementation finding is that KEY Cortex is not one coherent reasoning runtime.

docs/system-map/03-key-cortex.md identifies a main query pipeline, a separate consciousness pipeline, proactive cron/watchers, multiple tool/connector paths, two event buses, multiple memory surfaces and multiple planning/agent surfaces.

The consciousness path separately orchestrates emotion, reasoning, reflection, intuition, metacognition, creativity, ethics and temporal reasoning. The main pipeline separately owns safety, session, routing, genome context, memory, autonomy, prompting, tool use, outcomes and learning.

**Classification: PARALLEL IMPLEMENTATION / ARCHITECTURAL DUPLICATION.**

Target direction:

> one KEY cognitive runtime with selectable depth, methods and computational substrates - not a normal brain plus a separate consciousness brain.

Consciousness may remain a product/deep-deliberation mode if useful. It should not remain a sovereign parallel cognitive architecture merely because it exists.

## 5. One KEY, not many sovereign agents

Product invariant:

> KEY is one persistent cognitive entity. It may specialize, compile workflows, delegate bounded workers, or temporarily distribute execution as a swarm. Multiplicity is an execution strategy, not an identity model.

Current precursors include RoleEngineService, KeyCortexExpertiseLensService, AdaptiveRouterService, CognitiveTriageService, ModelGatewayService, KeyAgentConfigService, AgentBusService and workflow/Flow Studio surfaces.

These should converge into a **Specialization / Cognitive Composition capability**, not multiply into independent identities.

Target invariant:

    KEY_IDENTITY_CARDINALITY = 1

A temporary specialist or worker inherits bounded context, task, tools, authority and lifetime. It does not own a separate canonical self, autobiographical memory, goal hierarchy or constitutional authority.

## 6. Business Genome is not KEY's entire mind

Canonical intelligence defines Business Genome as living, evidence-aware business understanding.

That remains valuable, but the cognitive model must distinguish:

    KEY SELF != BUSINESS GENOME

A Business Genome is best understood as a domain/world-model scope for a business:
- facts/assertions/evidence;
- confidence;
- readiness;
- risks/gaps;
- recommendations;
- outcomes;
- constitution/policy projection.

KEY's persistent identity and cognition must be capable of operating across businesses/domains and cannot be identical to any one tenant's Genome.

Likewise, the Business Constitution is business-scoped governance. KEY itself also needs platform-level constitutional invariants, authority boundaries and identity continuity.

## 7. Epistemic integrity is already a proven missing primitive

Canonical intelligence findings F175/F176 establish that a stored fact can be stale, disputed or weak yet still appear in readiness or prompt context; storage does not imply eligibility for a particular decision; weak context must not silently authorize material mutation.

This strongly supports a first-class **Reality / Epistemic Integrity** primitive.

Target law:

    OBSERVATION
    != ASSERTION
    != EVIDENCE
    != ACCEPTED FACT
    != CONTEXTUAL BELIEF
    != AUTHORITY
    != PERMISSION TO ACT

And:

    STORED KNOWLEDGE
    != KNOWLEDGE ELIGIBLE FOR THIS CONSUMER / DECISION

This is a generalization of already-proven implementation failures, not abstraction for its own sake.

## 8. Memory work should generalize Genome, not duplicate it

Existing memory surfaces include KeyCortexMemory, AiMemory/embeddings, SemanticMemory, TemporalFlowMemory, CognitionMemory, GenomeMemoryEvent, conversation/session histories and external durable artifacts.

The Context Genome direction should be treated as a unifying substrate for memory/evidence/lineage across scopes, while Business Genome remains a business-specific projection/resolution layer.

Target pattern:

    CONTEXT / EVIDENCE SUBSTRATE
        |
        +-- KEY autobiographical memory
        +-- business/domain Genome projection
        +-- project/programme memory
        +-- episodic memory
        +-- semantic knowledge
        +-- procedural/skill memory
        +-- temporal history

Do not create another disconnected KEYMemoryV2 beside existing stores.

## 9. Biological services are useful mechanisms, not automatically top-level organs

Current code contains homeostasis, endocrine, salience, immune, cerebellum, circadian, interoception, epigenetics, incentive, awareness and related biology-inspired services.

The neuroscience atlas itself warns that some mappings are stretched analogies.

Reclassification:

| Current biological name | Canonical responsibility |
|---|---|
| Salience | attention / priority signal |
| CognitiveTriage | cognitive effort budgeting |
| Endocrine | slow control-state modulation |
| Interoception | system/body health sensing |
| Homeostasis | viability regulation / deviation detection |
| Immune | anomaly/threat memory and incident escalation |
| Cerebellum | outcome/error-correction learning |
| Circadian | temporal scheduling / maintenance windows |
| Incentive | reward/outcome signal |
| Epigenetics | bounded contextual adaptation |
| Awareness | current-system/context projection |

These may remain implementation modules where useful. They should not force one canonical cognitive kernel per biological metaphor.

## 10. Reasoning faculties are better modeled as methods than sovereign engines

Current code separately represents analytical, creative, critical, strategic, analogical, counterfactual and probabilistic reasoning, plus reflection, intuition, creativity, temporal reasoning, emotion, ethics and metacognition.

Many are better modeled as **selectable cognitive methods/operators** within one cognition runtime.

Exceptions:
- metacognition has distinct state/calibration responsibilities;
- ethics/policy should not be an optional style of reasoning when it represents hard governance;
- temporal/causal semantics need durable data-model support, not only a prompt mode.

## 11. Decision-Convergence belongs in the Executive kernel

The recent convergence research derived:

    OBSERVATION
    -> NORMALIZE EVIDENCE
    -> CLASSIFY
    -> EVALUATE AGAINST DECISION CONTEXT
    -> BLOCK | ADAPT | RECORD
    -> ACT
    -> VERIFY / SEAL

This is not a PR-only mechanism. It is the bridge between continuous learning, judgment, action admission, stopping rules, bounded adaptation and recovery.

**Classification: GENUINELY GENERALIZED CORE PRIMITIVE**, but it belongs inside Executive/Decision rather than becoming another independent brain.

## 12. Specialization is already partially implemented, but fragmented

Current overlapping mechanisms:
- RoleEngine / crew;
- ExpertiseLens;
- AdaptiveRouter;
- CognitiveTriage;
- ModelGateway routing;
- tool/capability registries;
- KeyAgentConfig;
- planners;
- workflow/agent runtime.

Target: one **Cognitive Composition / Specialization Compiler** mapping an objective into:

    problem class
    + required knowledge
    + memory scope
    + expertise/methodology
    + reasoning methods
    + computational method
    + model tier/provider
    + tools/capabilities
    + authority requirements
    + risk/evidence requirements
    + cognitive budget
    + execution topology

It may choose direct response, tool call, deterministic algorithm, solver/search/simulation, workflow, bounded delegated worker, parallel workers or swarm.

Permission remains separate: knowing how to perform something does not authorize doing it.

## 13. Computational architecture should be hybrid

KEY should not equate intelligence with LLM inference.

Canonical computational substrates should include:

1. deterministic code, state machines, transactions and policy;
2. neural/foundation models;
3. symbolic and algorithmic methods;
4. solvers, search, optimization, statistics and simulation;
5. persistent state, memory and graphs;
6. distributed execution.

The Executive kernel should select the appropriate substrate for a problem.

## 14. Candidate canonical KEY cognitive architecture v0.2

This pass converges historical Mind/Soul/Evolution, current code, canonical intelligence and recent research into **seven candidate kernels**.

These are conceptual ownership boundaries, not seven microservices.

### K1 - Self / Constitution / Authority

Question: **Who is KEY, what must it preserve, what matters, and what may it do?**

Owns persistent KEY identity, platform constitutional invariants, human authority/delegation relationship, goal/value hierarchy, business-specific policy context and self-model boundaries.

### K2 - Reality / Epistemic Integrity

Question: **What is happening, and what evidence makes it eligible to influence belief or action?**

Owns perception/receptors, observation normalization, evidence/provenance, confidence/uncertainty, contradictions, source authority, consumer-specific knowledge eligibility and salience inputs.

### K3 - Memory / World Model / Time

Question: **What does KEY know about the world and its own experience across time?**

Owns episodic/semantic/procedural memory, working context, entities/relations, temporal history, causal representations, supersession/revision lineage and consolidation/retrieval.

### K4 - Cognition

Question: **What follows, what could be true, what could happen, and what solutions exist?**

Owns reasoning, inquiry/hypotheses, search, simulation, counterfactuals, forecasting, creativity, decomposition and metareasoning methods.

### K5 - Executive / Judgment / Specialization

Question: **What should KEY do, how hard should it think, and what cognitive configuration should it use?**

Owns attention/resource budgeting, goal arbitration, Decision-Convergence, planning, problem-type recognition, computational-method selection, specialization composition, model/tool/topology selection and action-admission coordination.

### K6 - Agency / Execution / Coordination

Question: **How does KEY change the world safely and verifiably?**

Owns canonical capability/tool invocation, workflows, long-running execution, delegated workers, parallelism/swarm topology, idempotency, saga/compensation, effect/outcome reconciliation and communication with humans/agents/systems.

### K7 - Adaptation / Viability / Learning

Question: **Did it work, is KEY healthy, and how should future behavior change?**

Owns monitoring/homeostasis, anomalies/incidents, recovery, outcome learning, calibration, memory consolidation, skill/procedure promotion, eval/TEVV and bounded strategy/model adaptation.

Cross-cutting governance remains an envelope over all seven and cannot be bypassed because a lower layer proposes an action.

## 15. Historical-to-canonical convergence map

| Historical/current concept | Proposed canonical placement | Classification |
|---|---|---|
| Mind | K2+K3+K4+K5 | historical umbrella |
| Soul | K1 + governance | historical umbrella |
| Evolution | K7 | historical umbrella |
| Body/organs/connectors | K2 receptors + K6 effectors | implementation/body layer |
| Business Genome | K3 domain world-model projection + K2 evidence semantics | specialization, retain |
| Business Constitution | K1 business-scoped policy context | specialization, retain |
| KEY Cortex | spans K2-K7 | implementation container, too broad to be conceptual owner |
| Consciousness pipeline | K4/K5 deep-deliberation mode | parallel implementation; converge |
| Query pipeline | K2-K6 turn runtime | retain/strengthen as candidate spine |
| Temporal Flow | K3 temporal substrate + K5/K6 obligation runtime | retain; do not duplicate |
| Adaptive Router | K5 specialization/resource selection | precursor |
| Cognitive Triage | K5 cognitive budget control | precursor |
| Expertise Lens | K5 specialization | precursor |
| Role Engine / Crew | K5 specialization; K6 bounded collaboration | precursor; one KEY invariant |
| Model Gateway | computational substrate router | retain |
| Flow Tool Registry | K6 canonical capability surface | retain/strengthen |
| Cortex capability/tool registries | K6 projections/compatibility | converge |
| AutonomyOrchestrator | K1 authority/policy + K5 admission | retain/strengthen |
| Decision-Convergence Kernel | K5 | generalized core primitive |
| UnifiedMemoryRetrieval/Writer | K3 | retain/strengthen |
| Genome Evidence/Facts/Signals | K2/K3 | retain and generalize carefully |
| Reflection/Intuition/Creativity | K4 methods | reclassify |
| Metacognition | K4/K7 self-evaluation | retain semantics; prove reachability/calibration |
| Ethics | K1 governance + K5 constraints | not optional reasoning style |
| Salience | K2/K5 attention signal | reclassify |
| Endocrine | K5/K7 modulation | implementation mechanism |
| Homeostasis | K7 viability | retain mechanism |
| Immune | K7 defense/incident memory | retain mechanism |
| Cerebellum | K7 error correction | retain mechanism |
| AgentBus | K6 distributed execution transport | retain if needed; not identity |
| KeyAgentConfig / BotAgent | K5/K6 specialization/execution config | reinterpret |
| Flow Studio | K5 plan compilation + K6 workflow runtime | retain product surface |
| EvalHarness | K7 TEVV | retain/operationalize |
| KnowledgeIngestion | K2/K3 ingestion pipeline | retain but epistemically gate |
| Outcome learning | K7 | retain/strengthen |

## 16. Highest-value contradictions exposed

### COG-001 - Two parallel reasoning runtimes
Main query pipeline and consciousness pipeline overlap materially and are reached differently.

Target: one cognitive runtime with selectable depth/methods.

### COG-002 - Multiple capability/tool registries
Current app spec identifies Flow registry as canonical while cortex and AI registries coexist.

Target: one canonical capability contract with bounded projections/adapters.

### COG-003 - Multiple event buses
In-memory cortex bus and global event bus coexist with bridges.

Target: explicit canonical event/observation substrate; local ephemeral buses only as implementation projections.

### COG-004 - Memory is plural without one semantic owner
Retrieval is partially unified, but storage/authority/lineage semantics remain fragmented.

Target: Context Genome / memory substrate plus explicit projections.

### COG-005 - Specialization is spread across role, lens, router, triage, model and agent config
Target: one specialization/composition contract with separate authorization.

### COG-006 - Biological decomposition risks becoming architecture by metaphor
Target: preserve useful mechanisms while assigning semantic ownership to canonical kernels.

### COG-007 - Agent vocabulary can imply identity fragmentation
Target: one KEY identity; workers/crews/swarms are bounded execution forms.

### COG-008 - Business self-model and KEY self-model are conflated in older Soul language
Target: Business Genome is a world/domain model; KEY identity remains separate.

### COG-009 - Current intelligence handoff is stale relative to live main
Target: reconcile before implementation decisions.

## 17. Current implementation liabilities that must not be inherited as architecture

The current system map documents concrete issues that remain evidence, not target design:
- live cross-tenant audit-route defect;
- unsafe code-sandbox boundary;
- unconditional multi-replica cron duplication risk;
- reflection/intuition persistence gaps;
- unreachable/dead route surfaces;
- no-op compensation in specific paths;
- large untested services;
- user-reachability far below registered-service count.

The cognitive programme must obey the existing no-fake-green rule:

**registered != reachable != correct != proven.**

## 18. Proposed convergence candidates

These are not yet canonical decisions:

1. KEY is one persistent identity.
2. Multiplicity is execution topology, not identity.
3. One cognitive runtime should replace parallel normal/conscious brains.
4. Business Genome is a business-world-model projection, not KEY itself.
5. Epistemic eligibility is a first-class boundary.
6. Specialization compiles cognitive configuration, computation and topology.
7. Biological services remain mechanisms, not automatically top-level kernels.
8. Hybrid computation is a core architecture property.
9. Decision-Convergence belongs inside executive control.
10. Learning, control and action authority remain explicitly separated.
11. Wisdom/intelligence are emergent properties, not services named WisdomService or IntelligenceService.
12. No new cognitive abstraction should be added without classification against this map and the canonical concept registry.

## 19. Next research tranche

Before production implementation:

1. complete targeted code ownership/reachability mapping for K1-K7;
2. enumerate duplicate implementations and consumers;
3. build a computational realizability matrix for every kernel;
4. map ModelGateway, solvers, tools and a future KEY-native model substrate;
5. define the specialization/compiler contract;
6. define one cognitive-turn and long-horizon execution state machine;
7. define shared evidence/epistemic contracts for memory, reasoning and action;
8. pressure-test against neuroscience, cognitive architectures, control theory, autonomous systems, distributed systems and institutional design;
9. derive TEVV obligations per kernel;
10. only then compile bounded implementation packets.

## 20. Convergence status

**Archaeology Pass 001: STRONG PROVISIONAL CONVERGENCE.**

KEY already contains a large amount of useful cognitive machinery. The next architecture should therefore be a **convergence/refactoring of existing intelligence**, not a greenfield AI brain v2.

The central target is:

> one persistent KEY identity running one coherent cognitive architecture, able to compose the right memory, knowledge, reasoning methods, computational substrates, tools and temporary execution topology for the problem at hand - with evidence, authority, outcome verification and learning remaining explicit throughout.
