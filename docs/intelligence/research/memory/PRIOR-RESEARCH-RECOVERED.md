# The owner's prior memory research, recovered (KF-MEMORY-RND-001, deliverable 1)

Status: research record, 2026-11-22. Track 2 of owner ruling D-253. No authority: nothing here releases
implementation, and nothing here supersedes any source it quotes.

**What this is.** A faithful, organised record of the memory research the owner (GitHub `SaCH-PRO`) and the agents
working under the owner's direction recorded between 2026-09-09 and 2026-11-22, most of it in GitHub issue comments
that were not in repository files. The owner's instruction: "There are various types of memory explored in
psychology and psychology of AI, AI systems and memory systems, things that allow massive optimisation in token
usage ... I would have rigorously gone through parallels in medicine / CNS / brain / nerves / science" (relayed in the
Track 2 brief, 2026-11-22; not verified against a primary source: #80 comment 7081880780 recording D-253 paraphrases it).

**Conventions.**
- Every claim names its source: `#106 c5981828884 (2026-10-04)` means issue #106, comment id 5981828884, posted that
  date; a file path with line numbers means that file at main `5c17e7b4` (the base of this branch).
- Text in quotation marks is verbatim. Everything else is a summary. **[INFERRED]** marks anything this document infers.
- All #106 comments are authored by the account `SaCH-PRO` (author association OWNER). The comments are written in the
  register of an agent recording the owner's direction ("Clarification from user", "User direction"); they are on the
  owner's account and are treated here as the owner's record.
- Where two earlier statements conflict, both are shown in section 6; none is resolved silently.
- Coverage gap stated plainly: the owner's chats with ChatGPT outside GitHub are not accessible. Section 1 of #106
  comment 5981828884 lists "Mycelium", "Endocrine" and other families as already "in scope" from "ongoing KEY
  memory-design discussion"; the discussion itself is not on GitHub. What survives is the record.

---

## 1. Issue #106, KF-META-PROJECT-MEMORY-001 ("Durable project constitution, decision memory, and continuity")

Opened 2026-09-29 by the owner; open; 13 comments, the last 2026-10-05. Every comment was read in full for this record.

### 1.1 The issue body (2026-09-29) and its "Architecture update" (2026-09-30)

**Purpose:** "Make the user's accumulated KEYFLOWOS guidance, architectural principles, development standards,
decisions, constraints, rationale, and programme context durable across ChatGPT sessions, Claude runs, GitHub
automation, future agents, and KEY itself." Problem statement: "Chat history or model memory must never be the only
source of durable project law."

**Ten required durable layers** (titles verbatim): 1 Project Constitution; 2 Decision Register / ADR layer ("No silent
replacement of prior decisions"); 3 Running Project Context ("A machine-readable context artifact that travels with
every packet/task"); 4 Programme State ("Projection remains derived, never primary authority"); 5 Guidance Intake /
Promotion (guidance classified as "transient instruction; packet-local constraint; project principle; architecture
decision; product requirement; operating rule"; "Every promotion records source and reason"); 6 Agent Read Contract
("Agents must report conflicts between new instructions and durable policy rather than silently choosing"); 7
Continuity / Handoff Contract ("New sessions/workers can resume without relying on hidden conversation state"); 8
Memory Integrity ("Distinguish fact, decision, hypothesis, preference, stale context, and derived state. Superseded
decisions remain queryable with lineage. No memory item can silently gain authority merely by repetition."); 9 KEY
Integration ("KEY should consume project/business context through explicit structured memory, evidence, permissions and
approval boundaries rather than opaque conversation recall"); 10 Verification (deterministic tests: "required context is
loaded; stale context fails closed or is reconciled; superseded decisions are not treated as current; user principles
survive worker/session changes; no packet closes with durable guidance stranded only in chat; provenance and
supersession links remain intact").

**Principles to preserve** (verbatim list): "create intelligence, not authority; human remains final supervisor; fail
closed on uncertainty or unverifiable authority; exact-head evidence for admission; no fake green; no risky silent
execution; durable auditability and rollback; evidence-driven development; continuity across agents and sessions;
structured context travelling with each task; completion/progress/constraints/decisions/next-action tracking; KEY should
inherit the orchestration, memory, review and execution-control architecture being built for KEYFLOWOS development."

**Sequencing (updated 2026-09-30 "by explicit user direction"):** foundation work may proceed in parallel "provided it
remains draft, earns ZERO programme credit, performs no production/provider effects ... Runtime migration, destructive
schema changes, activation, or replacement of existing Business Genome behavior remains gated".

**Architecture update: Context Genome unification (2026-09-30).** "Business Genome, project/programme continuity, and
KEY memory are the same underlying systems problem. Do **not** build a parallel ProjectMemoryService or duplicate memory
database." Direction: "Generalize the existing Business Genome / UnifiedMemoryRetrieval architecture into a reusable
**Context Genome** substrate". Shared primitives (verbatim):
- "ContextScope: BUSINESS | PROJECT | PROGRAMME | AGENT | WORKFLOW | USER;"
- "typed ContextFact / ContextEvidence / ContextSignal / ContextProposal;"
- "ContextDecision with rationale + alternatives + supersession lineage;"
- "ContextPolicyVersion / Constitution versions;"
- "append-only ContextEvent / episode history;"
- "ContextProjection and ContextReadiness;"
- "temporal validity (validFrom/validTo) distinct from knowledge time (recordedAt);"
- "provenance (source type/id/URI/revision/hash, actor, correlation/causation/run IDs);"
- "authority class separate from confidence;"
- "explicit memory kinds: FACT, PREFERENCE, OBSERVATION, EPISODE, DECISION, POLICY, PROCEDURE, HYPOTHESIS,
  DERIVED_STATE, LESSON, CONSTRAINT;"
- "supersedes / supersededBy lineage rather than destructive overwrite;"
- "retrieval that filters by validity, authority and scope before relevance/recency ranking."

Reuse first: "GenomeFact / GenomeEvidence; GenomeSignal lifecycle; GenomeEvolutionProposal approval flow;
GenomeMemoryEvent; BusinessConstitutionVersion; GenomeModuleReadiness / automationAllowed; TemporalFlowEvent; outcome
learning; UnifiedMemoryRetrievalService." KEY integration: "No separate opaque chat-memory system is allowed to become
authoritative. Semantic/vector retrieval is an access layer, not truth." **No third-party runtime:** "Do not onboard
Graphiti, Temporal, DBOS, Restate, Cedar, OPA or other third-party orchestration/memory/policy runtimes in this packet.
Implement the useful patterns natively inside KEYFLOWOS unless later explicitly authorized." Revised exit criteria
include "valid time and recorded/knowledge time are distinct; authority and confidence are separate fields;
project/programme memory is reconstructible from durable events + facts/decisions/policies;
UnifiedMemoryRetrievalService evolves into the common retrieval boundary rather than being replaced".

### 1.2 c5981828884 (2026-10-04): "Memory Architecture Discovery continuity invariant"

**Governing rule (verbatim):** "Every new memory mechanism, biological analogy, computational structure, or
architectural proposal MUST be reconciled against prior memory work. Nothing may silently disappear." Each new idea is
recorded as one of: "RETAINS ... EXTENDS ... REFINES or replaces ... CONFLICTS ... is REJECTED, with explicit
reason/evidence ... remains a RESEARCH CANDIDATE pending benchmark/ablation." "Replacement never means erasure:
superseded concepts remain queryable with rationale and lineage."

**Thirteen discovery families "that must remain in scope"** (headings verbatim, contents summarised with the owner's terms):
1. "Engineered epistemic substrate / Context Genome": provenance, evidence, authority, confidence, verification; valid
   vs recorded time; scope, lineage, supersession, contradiction; "immutable/raw evidence boundary".
2. "Human neural / neurocognitive memory": working memory; hippocampal episodic encoding; pattern separation/completion;
   cortical semantic/schema abstraction; cerebellar error/procedural learning; basal-ganglia action/habit selection;
   replay/consolidation, salience, metacognition, prediction error.
3. "Mycelium / fungal / slime-mould inspired memory": adaptive topology; reinforced useful paths and pruning of poor
   paths; distributed/local learning; rerouting and redundancy; exploration/exploitation; schema/path fusion;
   flow-based resource allocation; "transient activation graph + lateral inhibition".
4. "Graph / hypergraph / relational structures": typed edges, first-class relation objects, hyperedges for multi-way
   episodes, meta-relations; "intra-memory, inter-memory, inter-scope, extra/reality relations"; "semantic, temporal,
   causal, predictive, procedural, epistemic, authority, outcome planes"; spreading activation.
5. "Genome / epigenome / cellular memory": constitutional memory; "epigenetic expression overlays"; "differentiated
   mutation/plasticity rates"; lineage memory; "positional memory and regenerative reconstruction".
6. "Bacterial / viral memory": "CRISPR-like defensive signature memory"; phase variation, bet-hedging; dormant
   trigger-bound memory; "quarantine for untrusted persistent knowledge"; competing hypothesis populations.
7. "Immune memory": "central vs resident/local memory compartments"; affinity maturation; "trained innate priming";
   self/non-self; "tolerance / negative selection"; "independent corroboration before strengthening truth";
   "immune-style pathology/autoimmunity checks".
8. "Haematopoietic / rheumatologic memory": root/stem memory inherited into descendants; "clonal selection and
   clonal-dominance hazards"; local tissue memory; "pathological attractors / runaway self-reinforcement"; resilience
   against "over-defensive or self-attacking loops".
9. "Endocrine / metabolic memory": slow adaptive state; hysteresis; stress/priming; "decay/reset distinct from factual
   forgetting".
10. "Plant / developmental memory": transient priming; "acquisition vs maintenance vs expression vs extinction/reset";
    positional state; regeneration.
11. "Swarm / social-organism / stigmergic memory": shared environmental traces; private vs colony memory; "trail
    reinforcement only after independent reward verification"; multi-agent knowledge promotion.
12. "Ecological / evolutionary memory": environmental legacy; world-state reconstruction; "resilience debt"; population
    diversity; "variation -> evaluation -> selection -> retention"; "schema exaptation / cross-domain reuse".
13. "Multi-scale memory": "molecular -> subcellular -> cellular -> tissue -> organ/system -> organism -> network ->
    population -> ecosystem -> evolutionary -> social/cultural/civilizational"; bottom-up emergence, top-down
    constraint, lateral interaction, cross-scale feedback.

**Working hypothesis "(NOT frozen)":** "**Context Genome Cognitive Architecture** = engineered epistemic core +
multi-carrier, multi-timescale cognitive memory system." Candidate carriers: "constitutional memory; expression/epigenetic
memory; adaptive state memory; episodic memory; semantic/schema memory; associative topology; predictive/causal memory;
procedural/skill memory; defensive memory; priming memory; lineage/positional memory; stigmergic/environmental memory;
meta-memory." "These do NOT imply separate databases/services. Prefer a small coherent infrastructure
(Postgres/pgvector/Redis/raw source systems/background cognition) with multiple logical memory dynamics."

**Non-negotiable integrity rules (verbatim, the core invariant list):**
- "association != truth;"
- "predictive correlation != causation;"
- "confidence != authority;"
- "repetition != verification;"
- "learned procedure != permission;"
- "schema != policy;"
- "hypothesis != fact;"
- "activation strength != epistemic strength;"
- "forgetting should not erase authoritative evidence/audit history;"
- "untrusted/external memory cannot silently gain authority;"
- "independent corroboration strengthens truth; repeated copies of one claim do not;"
- "every abstraction must remain traceable to supporting/counterevidence;"
- "no fake-green memory capability: every mechanism must prove a live causal path."

**Discovery process:** keep production work moving; "build only additive/reversible memory foundations"; maintain
"Accepted Foundations / Promising Candidates / Research Questions"; "use ablation/lesion tests to prove marginal value";
"preserve rejected/superseded ideas with rationale". **Required future artifact:** a "canonical **Memory Architecture
Discovery Ledger / Decision Graph**" that inventories every mechanism with source, problem solved,
overlap/conflict, buildability and cost, evidence level, disposition, lineage, and links to implementation and tests.
**[INFERRED]** No such ledger exists in the repository at `5c17e7b4`; `MEMORY-SCIENCE-PARALLELS.md` and the design's
mechanism table (design section 12) are a first step toward it, not the ledger itself.

### 1.3 c5981894417 (2026-10-04): "higher-order structure beyond hypergraphs"

"There is no fixed "3D" ceiling for KEY memory. Distinguish physical/geometric dimension from relational arity/rank ...
The practical ceiling is computational, not mathematical." Candidate: "**Recursive Multi-Scale Context Complex (RMCC)**
(name provisional)". The canonical primitive is "a typed, versioned **ContextCell**", which "may represent an entity,
relation, episode, hyperrelation, schema, model, context, or higher-order structure, and may be incident on lower-rank
cells". Illustrative ranks: 0 entities/atomic facts/evidence pointers; 1 pairwise relations; 2 multi-way episodes;
3 meta-relations; 4 schemas; 5 models/procedures; 6+ contexts/world-models. "Do NOT hard-code this hierarchy as ontology
law". Candidate mechanisms: combinatorial/cell complexes; multiplex networks; "cellular-sheaf-like consistency mappings
for local -> global context reconciliation and contradiction detection"; tensor networks; recursive relation reification;
populations of alternative complexes.

**Critical buildability rule (verbatim):** "Do NOT materialize the powerset or all possible higher-order relations.
Higher-order memory must be sparse, observed/evidence-backed, and mostly lazy." "Store rich canonical semantics but
compile task-specific projections: Hasse/incidence graph for traversal; vector index for candidate retrieval; causal
DAG/projection for causal queries; activation subcomplex for working memory; tensor projection for numeric learning;
scope-specific materialized views/caches." Limits named: combinatorial explosion, recursive-query explosion, versioning
multiplying topology, "permission/authority checks across higher-order relations", consistency checking, message-passing
cost, explainability, test-state explosion, index amplification. Mitigations include "adaptive active-rank budget per
task", "provenance + authority filtering before higher-order expansion", and "ablation benchmark: higher rank must prove
marginal value or remain dormant". "Context Genome remains the epistemic substrate; RMCC is a candidate higher-order
structural model inside/above it."

### 1.4 c5981955643 (2026-10-04): "Structural Intelligence Atlas extension"

Extends discovery "beyond biological memory mechanisms into **structure itself**", across 13 domains (subatomic
composition; atomic/molecular architecture; virion/capsid; DNA/protein origami; organelles and contact sites;
biomolecular condensates; origami/kirigami; ancient/historical geometry; network-engineering topologies; network
geometry; renormalization; tensor networks/MERA; high-dimensional mathematics). Extracted principles include
"constrained composition", "compartmentalization without isolation", "explicit contact interfaces", "phase-separated
temporary computation", "sparse long-range shortcuts", "task-dependent geometry", "multiscale compression",
"defect/exception preservation", "inverse design". The **Structural Intelligence Atlas** "is not a runtime subsystem by
itself; it is the source catalog mapping structural mechanisms -> computational problem -> RMCC implementation candidate
-> benchmark -> disposition." **Integrity constraints (verbatim):** "no mystical/unsupported "ancient geometry" claims;
extract demonstrable mathematical construction principles only; no claims that hypothetical physical extra dimensions are
real or useful unless a concrete algorithm follows; no forced biological/physical analogy where standard CS is superior;
every candidate must prove marginal value by benchmark/ablation before production adoption; rich canonical semantics
remain separate from runtime projection/topology."

### 1.5 c5982024549 (2026-10-04): "Human Lifelong Second-Brain / Massive-Ingestion scale target"

Target: ingest "massive, continuous, multimodal data streams over very long horizons — potentially an entire human
life" and convert them into "useful lifelong learning, reflection, skill development, decision support, personal growth
and future action. This is not merely archival/lifelogging." The same architecture should serve an individual, a
business, KEY/agents, project continuity, research and other contexts. Transformation ladder (verbatim): "RAW SIGNAL ->
EVENT -> EPISODE -> FACT/OBSERVATION -> MOTIF -> CONCEPT -> SCHEMA -> SKILL/MODEL -> META-LEARNING, while preserving
drill-down provenance to original evidence." "Optimize memory for **future human capability**, not maximum retention."
Scale requirements include append-first raw preservation, "streaming/online causal processing (never use future
information to interpret past decisions during evaluation)", "aggressive but reversible hierarchical compression",
"hot/warm/cold/archive memory tiers", "local working-memory projections rather than full-history loading", content
hashes/dedup, selective reprocessing, "approximate retrieval + exact evidence drill-down", "bounded activation/traversal
budgets".

**Information-preservation rule (verbatim):** "Recent continuous-lifelog research shows over-designed memory structures
and lossy compression can underperform simple retrieval baselines. Therefore: never allow summaries/schemas to replace
raw evidence; abstraction must be reversible by lineage/drill-down; compression must preserve important exceptions,
uncertainty and temporal details; periodically benchmark high-level memory against raw-evidence retrieval." (The study
is not named; see `AI-MEMORY-SYSTEMS-SURVEY.md` section 15.)

**Personal memory safety / sovereignty:** user ownership; consent per source and memory class; encryption;
private-by-default compartments; access audit; quarantine of untrusted content; export; "deletion/forgetting workflows
appropriate to user choice and legal obligations"; "sensitive inferences never silently become durable truth or
operational authority"; "memory must help the human rather than manipulate, replace or define them." New projection:
"**Lifelong Human Context / Life Genome** ... a scoped projection/use case, NOT a separate canonical memory
architecture." Success: "Measure improvement longitudinally rather than storage volume alone."

### 1.6 c5982051462 (2026-10-04): "Adaptive Receptor / Perception Expansion Layer"

End state: "a **continuous perception -> memory -> prediction -> action -> learning organism**". Core loop: WORLD ->
RECEPTORS -> SIGNAL NORMALIZATION -> ENTITY/EVENT/RELATION DETECTION -> CONTEXT GENOME ENCODING -> ASSOCIATION/SCHEMA/
MODEL UPDATE -> PREDICTION/DECISION/ACTION -> OUTCOME -> LEARNING -> RECEPTOR/INGESTION ADAPTATION. "Receptors are not
authoritative by default. They produce observations/evidence with source/provenance/trust metadata." Recurring blind
spots generate "**Receptor Gap** candidates"; a governed nine-step process ends "deploy initially in shadow/read-only
mode; measure information gain ...; retain, refine, or retire." **Distinction (verbatim):** "KEY should continuously
expand **perceptual capability**, not silently expand operational authority. New receptor != new permission. New data !=
verified truth. More information != better action unless relevance, evidence, uncertainty and governance are
respected." Ingestion layers L0 raw signal to L10 action/planning relevance; L6 is "salience/novelty/uncertainty", L7
"memory encoding", L8 "consolidation/schema learning". Intake economics: information gain, uncertainty reduction,
predictive lift, decision improvement, recurrence, coverage of blind spots, provenance quality, latency/cost, privacy
risk, storage cost.

### 1.7 c5982087092 (2026-10-04): "Memory Programme Parallel Rollout Plan v0.1"

Target end state (verbatim): "**Adaptive Perception/Receptor Fabric -> Context Genome -> Recursive Multi-Scale Context
Complex (RMCC) / cognitive memory -> world model -> reasoning/action -> outcome learning -> memory/receptor evolution.**"
**Operating rule:** "Memory work may proceed continuously, but it MUST NOT block unrelated application/product work
unless a demonstrated safety, authority, privacy, data-integrity, or correctness defect requires it." Suggested emphasis
"70-80% application/product throughput; 20-30% memory/cognition track". "No memory/meta packet earns
application-programme credit."

Lanes (names verbatim; deliverables summarised):
- **M0 Discovery + Truth Audit**: Memory Causal Map "source -> writer -> store -> index -> retrieval -> prompt/cognition
  -> action -> outcome -> learning"; classify stores "LIVE / PARTIAL / DORMANT / DUPLICATED / LEGACY / BROKEN /
  CANONICAL"; capture known defects ("user/business scoping ambiguity, dormant Evolution/KnowledgeIngestion paths,
  weak/fake-green eval metrics, simplistic consolidation, dream hypothesis validation gap, recency/ranking anomalies");
  Discovery Ledger and Structural Intelligence Atlas; baseline benchmark. "No production behavior change."
- **M1 Canonical Context Genome Foundation** (rebase PR #112): scope hierarchy, kinds, "authority != confidence !=
  verification", bitemporal time, provenance, supersession, contradiction state, Business Genome adapter. "No
  destructive migrations".
- **M2 Physical Persistence + Compatibility**: additive schema; adapters over "AiMemory, GenomeMemoryEvent,
  TemporalFlowMemory, CognitionMemory, BusinessEvent/CognitiveEvent"; shadow parity; rollback. "Legacy stores remain
  authoritative until parity is proven."
- **M3 Universal Intake + Adaptive Receptor Fabric**: receptor contract; receptor-gap detection; "new receptors enter
  SHADOW/read-only first".
- **M4 Episodic / Associative Core**: episodes, pattern separation, "partial-cue pattern completion", typed association
  graph, "spreading activation + lateral inhibition", "transient activation subcomplex/working memory", mycelial path
  reinforcement. "All associative strength remains distinct from truth/verification."
- **M5 Multi-Relational RMCC / Higher-Order Structure**: incrementally; "Never materialize all possible combinations."
- **M6 Consolidation / Concept / Schema Learning**: replay; motif discovery; "prediction-error-weighted consolidation";
  schema formation; reconsolidation; "exception preservation"; coarse-graining "evidence -> event -> episode -> motif ->
  concept -> schema -> domain model"; drill-down. "Summary/schema never replaces raw evidence."
- **M7 Procedural / Skill / Affinity Learning**: "skill promotion only after repeated verified success"; "controlled
  variant generation / affinity maturation"; "diversity floor to avoid clonal monoculture"; "learned skill != permission".
- **M8 State / Priming / Defensive / Pathology Memory**: hysteresis; priming and reset; "CRISPR-like threat signatures";
  "quarantine for untrusted persistent content"; tolerance; "pathological-memory monitor: runaway reinforcement,
  overgeneralization, self-confirming loops, schema monopoly, autoimmune-style blocking"; resilience-debt metrics.
- **M9 Lineage / Positional / Regenerative / Multi-Agent Memory**: agent inheritance; local vs shared; "regenerative agent
  reconstruction from role + inherited memory + current context"; stigmergic memory "from repository/tasks/documents/world
  state"; "independent corroboration before epistemic strengthening".
- **M10 Lifelong / Massive-Ingestion Scale**: "hot/warm/cool/cold/archive tiers"; object storage; dedup; selective
  reprocessing; synthetic stress tests.
- **M11 Adaptive Structural Intelligence**: "Research-to-benchmark track, never forced into production".
- **M12 Controlled KEY Activation**: ladder "OFF -> SHADOW -> CANARY -> READ_ENABLED -> ADVISORY -> ACTIVE" with separate
  flags for context genome write/read, cognitive intake, associative recall, schema consolidation, procedural learning,
  predictive memory, receptor expansion, cross-domain transfer, autonomous memory-driven action. "Action authority remains
  separately governed."

**Benchmarks / no-fake-green gates** (verbatim list): "continuity fidelity; recall precision/recall completeness; pattern
completion precision; pattern separation false-merge rate; stale/superseded memory leakage; provenance completeness;
cross-scope leakage; contradiction detection; schema predictive lift/calibration; repeated-error reduction;
learned-procedure success; transfer/generalization; counterexample sensitivity; retrieval latency/cost; memory
compression ratio; raw-evidence drill-down success; receptor information gain; autonomy half-life; pathology/overlearning
detection." "A capability cannot be declared implemented because a service exists or a query returns an array. It must
prove a live causal path and measurable value."

**Immediate sequencing** (items 3-9, verbatim): "3. Start/continue M0 immediately because it is non-invasive. 4.
Rebase/reconcile PR #112 after the control-plane head stabilizes; use it as M1 foundation, not as the final architecture. 5.
Bring proof-integrity work (#114 / related gates) to a level sufficient for persistence migration before M2 cutover. 6.
Build M2-M4 in SHADOW mode while application features continue. 7. Use PROJECT/PROGRAMME development memory as the first
serious consumer/proving ground. 8. Only after benchmarked value, progressively activate the same substrate for
KEY/business cognition. 9. Lifelong human/second-brain projection remains a scale target and later product projection, not
a blocker for KEYFLOWOS production." The comment also opens: "The same substrate must support BUSINESS,
PROJECT/PROGRAMME, AGENT, WORKFLOW/TASK, and eventually HUMAN/LIFELONG second-brain projections."

**Completion definition for "memory v1"** (verbatim): "Context Genome is canonical for semantic memory; current legacy
memory APIs are safely adapted/migrated; provenance/authority/time/lineage are first-class; episodic + associative recall
works beyond vector search; replay/consolidation forms traceable concepts/schemas; procedures/lessons measurably reduce
repeat failure; project/programme continuity survives sessions/workers; KEY can explain why a recalled belief/schema
exists; no cross-scope leakage or stale-authority leakage is demonstrated; all critical memory capabilities pass
adversarial and ablation benchmarks; rollout/rollback paths are proven."

### 1.8 c5982128271 (2026-10-04): "pre-freeze research/adaptation gaps"

Twelve tracks (titles verbatim): 1 "Continual learning / stability-plasticity"; 2 "Associative computation beyond graph
traversal" (hyperdimensional computing, sparse distributed memory, modern Hopfield, holographic representations); 3
"Predictive world models / active inference / counterfactual memory" ("KEY should remember not only what happened, but
what was predicted, what alternatives existed, and what likely would have happened under other actions"); 4
"Information theory / compression / minimum-description principles"; 5 "Distributed-systems memory substrate" (event
sourcing, bitemporal databases, Merkle structures, CRDTs, idempotency); 6 "Privacy/security / adversarial memory" (memory
poisoning, sleeper memories, source independence); 7 "Developmental learning / curriculum / critical periods"; 8
"Open-ended learning / quality diversity / novelty search"; 9 "Cognitive architectures / global coordination" (ACT-R,
Soar, Global Workspace/LIDA, blackboards); 10 "Human-learning / cognitive-offloading science" ("the second brain should
improve the human's own learning/agency, not merely make recall external and create learned dependence"); 11 "Social
epistemology / collective memory" ("repeated copies of one claim must not masquerade as independent evidence"); 12
"Mechanistic interpretability / memory observability" ("every important memory-driven decision should be auditable,
debuggable and ablatable"). **Priority:** "Must research before deep/final convergence: 1, 2, 3, 4, 5, 6, 10, 12. Can
continue as parallel advanced tracks: 7, 8, 9, 11." "No new external runtime/vendor is authorized by this research."

How this Track 2 work covers them **[INFERRED, this document's mapping]**: 1 (science parallels D1; design 5.3), 4 (design
section 10 token economics, partially), 5 (design sections 2-3: event sourcing, bitemporality, idempotency), 6 (survey
section 14; design section 8; evaluation section 4), 10 (science parallels C2, partially), 12 (design 6.5 retrieval trace;
evaluation ablations). Tracks 2 and 3 are not covered beyond mention; see `OPEN-QUESTIONS-FOR-OWNER.md`.

### 1.9 c5982170811 (2026-10-04): "KEY Memory Identity Invariant"

"Clarification from user: the memory programme being designed here is **KEY's memory architecture itself**. KEYFLOWOS
development is the first high-value proving ground and consumer of that same memory substrate. Do NOT create a separate
autonomous-development memory architecture that later needs to be merged into KEY." The development system acts as "1. a real
production-scale consumer of KEY memory; 2. a benchmark environment ...; 3. a source of verified experience ...; 4. a
dogfooding environment for the same Context Genome/RMCC/receptor/consolidation/procedural-learning architecture that KEY
will use."

```
KEY MEMORY / CONTEXT GENOME
        |
        +-- PROJECT / PROGRAMME projection
        |      -> used by ChatGPT/Claude/workers while building KEYFLOWOS
        +-- BUSINESS projection
        |      -> used by KEY inside KEYFLOWOS
        +-- AGENT / WORKFLOW / TASK projections
        |      -> used by KEY's runtime and ephemeral/specialist agents
        +-- USER / LIFELONG projection
               -> future second-brain / lifelong-memory use case
```

"Any memory mechanism built for development must be generalized at the substrate level where appropriate rather than
hard-coded as developer-only behavior. Project-specific semantics belong in PROJECT/PROGRAMME schemas/projections, not in
a separate memory engine." **Non-negotiable (verbatim): "One memory architecture, many projections and consumers."**

### 1.10 c5982274201 (2026-10-04): "Memory Architecture Convergence Checkpoint"

"This is **architecture convergence, not permanent design freeze**." **Foundation now treated as stable for
implementation** (the fourteen points, verbatim headings):
1. "One KEY memory architecture, many projections/consumers" (PROJECT/PROGRAMME, BUSINESS, AGENT/WORKFLOW/TASK, USER/LIFELONG)
2. "Context Genome is the governed epistemic substrate" (scope; provenance/evidence; valid vs recorded time; "authority !=
   confidence != verification"; lineage/supersession/contradiction)
3. "Raw/source evidence remains below abstraction and is never replaced by summaries/schemas."
4. "Multi-carrier / multi-timescale memory" ("episodic, semantic, schema, procedural, state/priming, defensive, lineage,
   environmental, meta-memory")
5. "Transient working/activation memory remains separate from durable canonical memory."
6. "Adaptive Perception / Receptor Fabric is the upstream intake model."
7. "Outcome/prediction-error learning + replay/consolidation are the core learning loop."
8. "Association strength is not truth; repetition is not authority; learned procedure is not permission."
9. "Sparse/lazy higher-order structure only; never materialize combinatorial powersets."
10. "Rich canonical semantics may compile into task-specific graph/vector/causal/tensor/activation projections."
11. "Different memory classes have different plasticity and forgetting semantics."
12. "Development of KEYFLOWOS is the first dogfooding/proving-ground projection of KEY memory."
13. "No fake green: implementation requires a proven causal path, scope integrity, rollback and measurable value."
14. "Product/application work continues in parallel; memory/meta work does not block unrelated product work except for
    demonstrated integrity/safety risks."

**Provisional / benchmark-gated:** RMCC/ContextCell algebra; cell/sheaf representations; hyperdimensional projections;
tensor networks; mycelial/Physarum topology optimisation; origami polymorphism; quasicrystal/fractal indexing; open-ended
ontology change; other structural candidates. "They may be adopted only when simpler baselines are insufficient and
ablation proves marginal value." **Execution path:** "M0: #122 / PR #127 — truth audit and proof baseline. M1: #123 —
harden canonical Context Genome contracts. M2: #124 — additive persistence + shadow parity + rollback. M3: #125 —
Adaptive Receptor Fabric in shadow/read-only mode. M4: #126 — episodic/associative recall + bounded activation. M5+ —
..." **Change-control rule:** new research should "refine a queued packet, create a benchmarked extension, or explicitly
supersede a foundation decision with evidence. Do not reopen broad architecture exploration by default."

### 1.11 c5994706532 (2026-10-05): "Procedural Intelligence extension"

"Recurring ideas, directives, research/development loops, review flows and recurring human-agent work should be distilled
into versioned, reusable procedures instead of remaining bespoke chat choreography." "This extends issue #106 / Context
Genome. It does not create a separate developer-only memory or automation stack." **Core rule (verbatim):** "learned
procedure is not permission; repetition is not verification; automation is not authority; ambiguous or high-risk work
fails closed; every run must remain attributable, inspectable and evidence-producing." Reuse "the existing Context
Genome PROCEDURE memory kind ...; the governed KEY tool/capability registry; agent-control exact-head
proof/review/admission; and the existing .agents/skills pattern. Do not add parallel registries." **Promotion ladder
(verbatim):** "Episode -> candidate pattern -> named protocol -> typed skill spec -> executable procedure -> shadow run ->
evaluator proof -> scoped autonomy grant -> versioned improvement." Each procedure defines "purpose, inputs, required
context/freshness, tools/capabilities, authority/approval, risk tier, deterministic vs model-reasoning steps, outputs,
evidence requirements, idempotency/effect identity ..., side-effect boundary, compensation, retry/timeout rules,
contradiction/escalation rules, stop conditions, outcome vocabulary, evaluator, tests/negative controls and lineage."
First families: Context Integrity / Continuity Loader; Directive Compiler; Research / R&D Loop; Map-Before-Modify;
Implementation Packet Runner; Semantic Review + provider-failover; Contradiction Resolver; No-Fake-Green Verifier;
Handoff / RETURN Compiler; Procedure Miner / Skill Distiller. KEY mapping (verbatim): "episodic memory = what happened;
semantic/schema memory = what is known; procedural memory = how recurring work is done; capability/tool registry = what
can be executed; authority/approval = what may be executed; evaluator/outcome learning = whether it worked;
consolidation = proposed improved versions; meta-memory = which procedure is reliable in which context." Maturity: "A
procedure is mature when it is reconstructible without hidden chat context, runnable by ChatGPT/Claude/KEY against the
same contract, ... has revocable scoped autonomy, and never reports failed/partial/unknown work as green."

### 1.12 c5994966639 (2026-10-05): "Canon Event Dissection 001"

A dissection of the PR #120 exact-head episode (late review, 25-commit branch cap, force-with-lease of one control
artifact) as "a dogfood episode for KEY procedural intelligence". Anatomical model: Context, Trigger, Actors, Subject,
Evidence, Authority, Projection, Constraints, Contradiction, Recovery, Outcome, Learning. **Seven planes that must stay
separate:** semantic, control, evidence, authority, execution, outcome, learning; "Most dangerous bugs in this episode
were cross-plane confusions". Sixteen cross-domain syntheses with sources named by the owner's record: options framework
(Sutton, Precup and Singh 1999: initiation set, policy, termination); process mining (van der Aalst); ACT-R productions
and Soar chunking; hierarchical motor chunking (Diedrichsen and Kornysheva); organisational routines (Feldman and
Pentland, ostensive vs performative); Google SRE (toil, postmortems, canarying); WHO checklists and FDA staged
development; cell-cycle checkpoints; immune affinity maturation; Toyota jidoka; Conant and Ashby's Good Regulator
theorem; event sourcing and Lamport; W3C PROV, SLSA, in-toto; NIST zero trust (policy decision vs administration vs
enforcement); MLIR (canonical IR plus passes); formal methods at AWS.

**Candidate law:** "**Subject / attestation separation:** immutable semantic subjects should be referenced by digest from
durable external attestations; recording a new attestation should not require changing the attested subject."

**New design laws (verbatim):** "1. Episode != procedure. 2. Procedure != permission. 3. Spec != performance. 4. Evidence
!= authority. 5. Projection != source of truth. 6. Association/repetition != verification. 7. Subject != attestation. 8.
A contradiction is a valid state, not an exception to hide. 9. Recovery should repair the minimum violated relation, not
weaken the invariant. 10. A procedure must have initiation, policy, termination, evaluator and escalation semantics. 11.
Autonomy must be staged and revocable. 12. Every procedure version retains lineage and real run evidence. 13. No
procedure may require hidden conversational context to execute correctly. 14. The safest autonomous system optimizes away
toil, not human judgment."

Lifecycle: "OBSERVE -> RECORD EPISODES -> MINE RECURRING STRUCTURE -> ABSTRACT INVARIANTS + VARIANTS -> SPECIFY PROCEDURE
CONTRACT -> COMPOSE GOVERNED CAPABILITIES -> SIMULATE / SHADOW -> CONFORMANCE + ADVERSARIAL EVALUATION -> BOUNDED/CANARY
AUTONOMY -> MONITOR OUTCOMES -> POSTMORTEM / PREDICTION ERROR -> PROPOSE VERSION -> RE-EVALUATE -> PROMOTE / REVOKE /
SUPERSEDE". Candidate "Exact-Head Finalization Procedure" with initiation, policy (nine steps), termination "ADMITTED;
CHANGES_REQUIRED; BLOCKED_EXTERNAL; CONTRADICTION; ABORTED/REVOKED". M5+ direction: "define ProcedureSpec v0 as a logical
Context Genome projection, not a new datastore"; "build an offline Procedure Miner over existing Issue #80 + workflow +
Context Genome traces"; three starter procedures "Context Integrity Loader; Exact-Head Finalizer; Contradiction Resolver".

### 1.13 c5995186868 (2026-10-05): "Specialisation / Morphogenesis / Ecological Coordination extension"

"KEY should not be modeled as one monolithic intelligence plus a bag of tools." Mapping (verbatim lines): "Context Genome
= shared epistemic/environmental substrate. Capability registry = genome of what could be expressed. Policies/authority =
regulatory genes / developmental constraints. Procedure/skill = learned expression program. Ephemeral agent =
differentiated cell. ... Defensive memory + trust controls = immune function. Procedure retirement / agent teardown =
apoptosis. ... Resource budgets = metabolic/resource constraints." **Design law:** "**global constraints + local context +
typed communication + feedback + resource limits + lineage + evaluators** ... Order should therefore emerge from
constrained interaction, not from one mega-controller." The Agent Factory "should become a **Differentiation Engine**".
Ten research questions, including "What belongs in cell-local state vs shared Context Genome?" and "How do we prevent
runaway clonal dominance / monoculture?". "It is not permission to implement unbounded self-organizing agents yet".

### 1.14 c5995285097 (2026-10-05): "Scale-Recursive Control / Nested World-Model extension"

"**higher-order observability + bounded governability + modular encapsulation + recursive composition.**" A lower-order
system may become a higher-order unit only when it exposes stable identity, boundaries, state, signals, interfaces,
invariants, budget, health, failure modes, effect/authority boundaries, lineage and a composition contract. **Core design
law (verbatim):** "**A system becomes composable at the next scale only when its internal complexity can be encapsulated
behind a trustworthy contract.**" "The representation must support zoom-in / zoom-out without losing provenance."
"Absolute control is neither required nor desirable. The target is **sufficient governability**". "No implementation
authority is implied by this comment".

---

## 2. Repository files

Extracted from the files at `5c17e7b4`. Most reached main in the 2026-11-12/13 tie-off (D-141), so commit dates are not
authoring dates; each file's own date is used.

### 2.1 `architecture/memory/KEY-MEMORY-CONTEXT-GENOME.md` (created 2026-10-05; status PLANNING; historical note DEFER V1+)

- Decision (l.13-17): "KEYFLOWOS should converge on a **portable, evidence-grounded, local-first memory/world-model
  architecture**." "This is **not** a second memory subsystem ... It is a unifying contract over them."
- Pipeline (l.22-34): "REALITY -> RAW EVIDENCE -> OBSERVATIONS -> IDENTITY RESOLUTION -> CLAIMS / EVENTS / RELATIONSHIPS
  -> WORLD MODEL / CONTEXT GENOME -> MATERIALIZED VIEWS -> CONTEXT COMPILER -> KEY -> PLAN / GOVERN / ACT -> REAL-WORLD
  EFFECT -> NEW EVIDENCE -> RECONCILE / LEARN".
- Cross-reference table (l.43-66), e.g. writer seam "REUSE / EXTEND ... Do not create a parallel generic memory writer";
  retrieval "Evolve into graph/provenance-aware context retrieval rather than replace"; semantic memory "DERIVED INDEX ...
  Treat embeddings as rebuildable acceleration, never canonical memory"; `ConversationGenomeExtractorService` "REUSE /
  EXEMPLAR ... infer -> propose -> verify/merge, not infer -> truth"; `GenomeMemoryService` "Strong substrate for
  episodic-to-procedural learning"; `TemporalFlowMemoryService` "DERIVED PROJECTION ... never treat summary as raw
  evidence"; KnowledgeIngestion "DORMANT / SEED".
- **Hard law (l.109):** "Deleting every embedding/vector cache must not destroy any canonical memory or evidence."
- **Hard rule (l.437):** "AI inference cannot become authoritative domain truth solely because a model emitted it."
- Five planes (l.263-287): reality, evidence, knowledge, cognition, control.
- Canonical vs derived (l.289-330): canonical = source identity/hash, provenance, append-only history, entities, atomic
  claims, status/authority, evidence links, temporal validity, supersession events, processing history;
  domain-authoritative = CRM, invoices/payments, bookings, projects, accepted Genome facts, authority state ("The Context
  Genome must **link to domain authority**, not copy it", l.317); derived = Wiki, INDEX, embeddings, full-text,
  adjacency, prompt/context packages, BusinessGraph, TemporalFlow summaries, dashboards.
- Seven primitives (l.332-410): Source, Observation ("not automatically accepted business truth"), Entity, Claim ("subject
  --predicate--> object/value" with evidence, authority, confidence, status, valid time, recorded time, lineage),
  Relation, Event, Projection.
- Epistemic states (l.412-437): "OBSERVED SUPPORTED ACCEPTED DISPUTED SUPERSEDED RETRACTED UNKNOWN"; "Map rather than
  duplicate existing domain-specific statuses".
- Portable Vault (l.439-482): `Raw/`, `Wiki/`, `INDEX.md`, `PROCESSING-LOG.jsonl`, `.key/` NDJSON; "No design should
  require a specific embedding provider to read the durable Vault."
- Three identities (l.484-498): delivery, source object (content hash), business semantic. "A file rename or duplicate
  import must not manufacture a second source object."
- Ingestion state machine (l.500-534) RECEIVED ... RECONCILED; change classes "NEW CONFIRMATION DUPLICATE CORRECTION
  CONTRADICTION SUPERSESSION RETRACTION RELATION_DISCOVERY".
- Entity resolution ladder (l.536-551); "Never auto-merge ambiguous entities merely because vector similarity is high."
- **Context Compiler (l.553-590):** additions to ranking "graph distance/relevance; authority; claim status; evidence
  coverage; task relevance; contradiction inclusion; privacy/user scope; temporal validity; novelty/redundancy; token
  cost"; pipeline "query/task -> intent + entity extraction -> index routing -> candidate identities -> graph expansion ->
  authoritative claim selection -> contradiction/evidence attachment -> context-budget optimization -> ContextPack ->
  KEY"; "For high-risk decisions, the compiler should require provenance and contradiction context".
- **Consolidation (l.592-614)** "must not: delete raw evidence merely because a newer belief won; silently overwrite
  contradictory claims; rely only on process-local once-per-night state; convert model inference into accepted truth
  without the relevant authority rule."
- Procedural (l.616-629): "episodes -> repeated pattern -> ProcedureCandidate -> evaluation -> approved ProcedureSpec ->
  skill/capability"; "not create a second automation language".
- Development as proving environment (l.631-660): "Do not couple business runtime memory physically to
  development-control storage, but reuse the semantic laws." (See section 6, C-A.)
- **Security / privacy / tenancy laws (l.725-734, verbatim):** "1. Every memory source/claim/event is tenant-scoped or
  explicitly platform-global. 2. Personal episodic memory remains user-scoped where the current retrieval contract already
  requires it. 3. Export must respect deletion, retention, consent and secrets policy. 4. Raw files may contain
  credentials/PHI/PII; portable storage requires encryption-at-rest options and redaction/export policy. 5. No local
  filesystem path is trusted as authorization. 6. A model may read only the ContextPack it is authorized to receive. 7.
  Vault import cannot grant authority merely by containing an authority-looking file. 8. Provider callbacks/events remain
  subject to existing authentication/signature rules."
- Non-goals (l.736-750): do not begin by replacing Postgres with Markdown, replacing Business Genome, IngestionItem or
  BusinessEvent, "creating a universal graph database; adding another vector database; creating a second KEY memory API;
  auto-merging inferred facts".
- Gaps (l.752-770): ten, including "no general claim/contradiction/supersession contract outside Business Genome";
  "graph-aware/evidence-aware context compilation is not yet the canonical retrieval path".
- **Dated correction (l.9, 2026-11-12)**: consolidation's delete is dead code (unique key); the dedupe hash falls back to
  `new Date()`; Atlas/Mission Control are not on main. See section 6, C1-C2.

### 2.2 `docs/development/KF-MEMORY-CONTEXT-GENOME-PLAN-001.md` and `-STATUS.yaml` (2026-10-05)

The deferred reference plan. Objective: "Converge KEYFLOWOS memory, Business Genome, ingestion, evidence, temporal memory,
semantic retrieval and the Living System Atlas into one portable, evidence-grounded Context Genome architecture without
creating a parallel memory system." Phases (the .md says Phase 0-10, the YAML M0-M10; **no per-phase status exists**;
the plan-wide state is DEFER_V1_PLUS on main; on `wave/v1-wave-3d` and `pkt/V1-RULINGS-3E` STATUS.yaml line 3 says
`state: IN_V1_PENDING_DESIGN` under D-254 while its historical note (l.93) still reads `status: DEFER_V1_PLUS`):

| Phase | Title | Exit proof (verbatim, abridged) |
|---|---|---|
| 0 | Memory truth audit | "every known memory store has an owner/classification; every live writer has a reachable call path; every live retrieval consumer is mapped; no unexplained overlapping memory authority remains hidden." |
| 1 | Source / Claim / Identity / Provenance contract | "candidate knowledge cannot silently become accepted truth; every accepted claim can point to evidence or explicit human/domain authority; existing domain authorities are preserved rather than copied." |
| 2 | Portable Vault protocol | "a valid Vault can be read without OpenAI/Anthropic/Kimi-specific state; derived caches can be deleted and regenerated; import cannot grant authority merely from file contents." |
| 3 | Raw source registry + content addressing | "same bytes imported through two channels do not become two source objects; delivery retry is idempotent; rename does not change source identity; removal does not silently erase dependent history." |
| 4 | Observation + claim admission pipeline | "inference and accepted truth are distinguishable in storage and retrieval; correction preserves prior lineage; contradiction never resolves by destructive overwrite alone." |
| 5 | General entity graph | "no duplicate universal identity is created when a canonical domain entity exists; ambiguous identities are not silently merged; entity merge is reversible/auditable where required." |
| 6 | Wiki + Index projections | "deleting Wiki/INDEX and rebuilding yields equivalent projection; Wiki never becomes canonical truth; every important statement links to claim/evidence lineage." |
| 7 | Graph-aware Context Compiler | "KEY can say why a context item was selected; high-risk answer/action context includes required authority/evidence; vector search can be disabled and structured/graph retrieval still works; retrieval remains tenant/user scoped." |
| 8 | Consolidation / replay / procedural memory | "repeated consolidation converges; restart/multi-replica execution does not duplicate effects; historical evidence remains reconstructable; procedural learning reuses existing skill/capability governance." |
| 9 | Local-first sync / portability | "local copy remains intelligible without cloud service; reconnect reconciles deterministically; cloud and local replicas cannot silently diverge into two truths." |
| 10 | Mission Control memory/world-model view | "no second dashboard; no invented progress denominator; UNKNOWN remains explicit; no mutation buttons until authority/action contracts are separately admitted." |

Phase 7's deliverable is explicit: "extend UnifiedMemoryRetrievalService or create a bounded compiler above it, without
adding another store". Order: "Must precede implementation: 1. Phase 0 audit. 2. Phase 1 semantic contract. 3.
anti-duplication review". "Must not precede claim/provenance proof: automatic Wiki truth updates; universal graph
mutation; Mission Control memory controls; procedural auto-promotion." **Hard invariants (plan .md l.290-301, verbatim):**
"1. No parallel memory authority. 2. No vector index as canonical memory. 3. No inference-as-truth. 4. No destructive
contradiction resolution without lineage. 5. No new universal entity when a canonical domain identity exists. 6. No
provider-specific portable format. 7. No second Mission Control. 8. No filesystem contents granting runtime authority. 9.
No fake green or unbounded completion percentage. 10. Every architecture-affecting change updates the Living System
Atlas." Next packets: `KF-MEMORY-TRUTH-AUDIT-001` ("Read-only forensic packet"), `KF-MEMORY-SEMANTIC-CONTRACT-001`,
`KF-MEMORY-PORTABLE-VAULT-001`; "No production implementation packet should be released before the first two packets
converge." The YAML `safety` block sets every production, provider and release authorisation to false.

### 2.3 `docs/neuro-atlas-code-mapping.md` (first committed 2026-09-09; no declared status)

Maps the owner's "45-section "Master Atlas of Neural, Endocrine and Homeostatic Control"" to code. Memory-relevant rows:
hippocampus/memory consolidation -> `key-cortex-memory.service.ts`, `UnifiedMemoryRetrievalService`,
`UnifiedMemoryWriterService`, `TemporalFlowMemory` (rated Strong: "Explicit memory store with recency/decay, semantic
embeddings, and temporal-flow summaries"); neuroplasticity -> `key-cortex-learning.service.ts`, confidence deltas;
neurogenesis -> `KnowledgeIngestionService`, `GenomeEvolutionProposal`; parasympathetic and pineal -> reflection
maintenance/dream crons; acetylcholine (attention) -> awareness and triage, with the note "`KeyCortexAttentionService`
does **not** exist" and the recommendation "Make attention a first-class resource budget in the consciousness pipeline";
blood-brain barrier -> `key-cortex-safe-database.service.ts` and tenant scoping; glia -> context assembly. "some
biological concepts are stretched by design because the codebase is a business OS, not an organism." Top
recommendations include "Close the live-chat memory loop" and "Add a circadian/timezone-aware scheduler". (Both later
overtaken by code; see C3, C6.)

### 2.4 `docs/intelligence/KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md` and `-IMPLEMENTATION-CROSSWALK-001.md` (historical as of 2026-11-12)

Archaeology: "**convergence, not abstraction proliferation**"; "Do not create another disconnected KEYMemoryV2 beside
existing stores" (§8); the law "OBSERVATION != ASSERTION != EVIDENCE != ACCEPTED FACT != CONTEXTUAL BELIEF != AUTHORITY !=
PERMISSION TO ACT" and "STORED KNOWLEDGE != KNOWLEDGE ELIGIBLE FOR THIS CONSUMER / DECISION" (§7); the biological
reclassification table (§9): Salience = "attention / priority signal", CognitiveTriage = "cognitive effort budgeting",
Endocrine = "slow control-state modulation", Immune = "anomaly/threat memory and incident escalation", Cerebellum =
"outcome/error-correction learning", Circadian = "temporal scheduling / maintenance windows", Epigenetics = "bounded
contextual adaptation"; "They should not force one canonical cognitive kernel per biological metaphor" and COG-006
"Biological decomposition risks becoming architecture by metaphor"; "registered != reachable != correct != proven"
(§17). Crosswalk K3: UnifiedMemoryRetrieval and Writer are "RETAIN_CANONICAL_CANDIDATE"; `key-cortex-memory.service.ts`
"DUPLICATED_CONVERGE / legacy risk"; gaps "GENUINELY_MISSING: one canonical memory identity/lineage contract across
scopes ... explicit bitemporal/current-validity semantics across all memory families ... causal representation distinct
from correlation/association ... formal world-model boundary". K7 hard learning rule: "Most learning should first change
memory, procedures, policies, routing weights or bounded adapters; foundation-model weight updates require a much higher
proof threshold."

### 2.5 `docs/intelligence/research/fictional-intelligence-genome/TRANCHE-COGNITIVE-LIFECYCLE-RESILIENCE-001.md` (2026-10-06, RESEARCH_ONLY)

- "**G157 Attention Budget**: Attention is a scarce resource. KEY should allocate cognition across urgent, important,
  uncertain and strategically valuable work rather than process all signals equally."
- "**G160 Memory Consolidation**: Frequently reused, highly connected, high-value or strongly evidenced information may be
  promoted from episodic traces into durable semantic/procedural memory while retaining provenance."
- "**G161 Forgetting as Governance**: Not all information should persist indefinitely. Forgetting/archival can be driven
  by expiry, legal policy, privacy, low value, supersession, irrelevance or storage cost; deletion must preserve required
  audit/lineage semantics where applicable."
- "**G162 Retrieval Decay / Freshness Weighting**: Old information should not disappear merely because it is old, but
  retrieval relevance should account for freshness, domain volatility and supersession."
- Also G158 Compute Budget Routing; G159 Interruption Threshold; "G163 Memory Compression With Loss Accounting:
  Summaries/compressions must record source coverage and known information loss. Compression is a projection, not a
  replacement for authoritative underlying evidence when that evidence must remain available."; G164 Graceful
  Degradation ("memory unavailable -> answer with reduced context and disclose"); G165 health states "READY / DEGRADED /
  UNAVAILABLE / UNVERIFIED / STALE"; G167 Checkpoint / Recovery.
- Anti-genome: "AG64 Every signal receives equal cognitive attention. AG65 Expensive reasoning is used indiscriminately.
  AG66 Background agent constantly interrupts the user. AG67 Memory grows forever without retention policy. AG68
  Compression silently replaces evidence. AG69 Degraded cognition pretends to be healthy. AG71 Restart is mistaken for
  recovery."
- Resource loop: "SIGNALS -> SALIENCE -> PRIORITY -> BUDGET -> REASON/RESEARCH -> OUTCOME -> VALUE/COST EVALUATION ->
  FUTURE BUDGET UPDATE".

### 2.6 `docs/intelligence/research/dossiers/HERMANS-PROGRAMMERS-BRAIN.md` (RESEARCH ONLY)

Source: Felienne Hermans, *The Programmer's Brain* (2021). Failure taxonomy (verbatim): "KNOWLEDGE_ABSENT ...
RETRIEVAL_FAILURE ... CONTEXT_OVERLOAD ... REPRESENTATION_FAILURE ... REASONING_FAILURE"; "Do not route all five to "give
the agent more context."" External representations offload working memory (architecture graph, state table, authority
table, failure-mode table, dependency slice, proof profile). **Anti-overload law:** "MORE CONTEXT != MORE
UNDERSTANDING." and "Context should maximize decision-relevant information per token while preserving authority,
uncertainty and missing-information signals."

### 2.7 `docs/intelligence/research/traces/EPISTEMIC-TRACE-001-EVIDENCE-GENOME-MEMORY-LEARNING.md` (RESEARCH ONLY)

Laws (verbatim; the file says "These are research candidates, not accepted architecture laws"): "1. INTEGRITY != TRUTH.
2. CONFIDENCE != AUTHORITY. 3. RETRIEVAL RELEVANCE != EPISTEMIC STRENGTH. 4. USER ACCEPTANCE != CORRECTNESS. 5. EXECUTION
SUCCESS != BUSINESS OUTCOME. 6. MEMORY != FACT. 7. AI INFERENCE != CANONICAL STATE. 8. LEARNED LESSON != VERIFIED RULE. 9.
DERIVED PROJECTION != SOURCE OF TRUTH. 10. A FACT IS TRUE ONLY AT A DECLARED AUTHORITY BOUNDARY AND TIME." Also "UNIFIED
RETRIEVAL != UNIFIED AUTHORITY": "MemoryFragment should remain a retrieval projection. It must not silently imply that
fragments from different sources have equal epistemic authority." Epistemic dimensions (names from a bulleted list with definitions): CONTENT, SOURCE, PROVENANCE,
INTEGRITY, CONFIDENCE, VERIFICATION, AUTHORITY, FRESHNESS, RISK_IF_WRONG, EXECUTION_STATUS, BUSINESS_OUTCOME,
USER_RESPONSE, MEMORY_RELEVANCE, CANONICAL_STATUS; "These dimensions should not be compressed into one confidence
score."

### 2.8 `docs/intelligence/research/kernels/STRUCTURE-FUNCTION-STORAGE-OPTIMIZATION-KERNEL-RND.md` (2026-10-06)

Storage laws (headings verbatim): "ST-L1 — Storage shape should match retrieval shape"; "ST-L2 — Canonical state and
projections should be separate" ("should remain rebuildable when it is not the canonical truth owner"); "ST-L3 —
Compression must preserve decision-critical distinctions" (authority, provenance, valid/recorded time, conflict,
uncertainty, evidence class, tenant identity: "A shorter context that erases these distinctions is lossy in the wrong
dimension"); "ST-L4 — Addressability matters as much as density" ("semantic addressing by entity, time, source,
authority, task and relationship — not only vector similarity"); "ST-L5 — Temporal structure is part of storage". Also
"FACT != EVIDENCE != SIGNAL != RECOMMENDATION != MEMORY." Evidence ladder: "MATHEMATICAL FACT -> OBSERVED OCCURRENCE ->
CAUSAL MECHANISM -> DEMONSTRATED OPTIMIZATION -> METAPHOR"; "Occurrence is not proof of optimality." Disposition: DEFER
"universal Fibonacci/golden-ratio optimization claims; sacred geometry as engineering evidence".

### 2.9 Context compiler research: `docs/intelligence/research/contracts/CONTEXT-BUNDLE-SCHEMA.yaml` and DEVELOPMENT-SPEED-TRACE-004 to 004E

Schema (authority RESEARCH_ONLY): authority classes "EXECUTION_AUTHORITY, IMPLEMENTATION_TRUTH, CANONICAL_ARCHITECTURE,
DERIVED_PROJECTION, HISTORICAL_EVIDENCE, RESEARCH_ONLY"; freshness "CURRENT, STALE, SUPERSEDED, UNVERIFIABLE"; health
"VALID, DEGRADED, INVALID". **Invariants (verbatim):** "identical input snapshot and generator version MUST yield
semantically identical output; research-only material MUST NOT be promoted to canonical authority by projection;
unresolved source conflicts MUST remain visible; missing required authority MUST make health DEGRADED or INVALID; derived
projections MUST NOT outrank their source authority; excluded sources MUST be auditable; the bundle MUST identify exact
source revisions where available; bundle validity MUST NOT imply implementation correctness or final admission."
Trace 004: question "Can KEYFLOWOS compile the smallest sufficient, freshness-aware context packet ... so agents retrieve
project understanding instead of reconstructing it?"; ranking "authority relevance > contradiction/safety relevance >
live-path relevance > semantic ownership > risk > historical failure density > recency > general background";
"`compileContext(snapshot, task) -> ContextBundle`"; "HIDE MECHANISM, NOT TRUTH"; content-addressed bundle cache with
invalidation triggers; "Primary target: MINIMUM SUFFICIENT CONTEXT FOR CORRECT ACTION. Not minimum tokens." 004E
(execution proof): offline prototype `scripts/agent-control/research/compile-context.mjs`, "tests: 16, passed: 16",
three fixture bundles of 3473, 3317 and 2825 bytes, each emitted twice byte-identically, historical critical-context
checklist "36 / 36"; maturity "PROTOTYPED (NOT INTEGRATED)"; "Claude-worker integration remains NOT AUTHORIZED by this
trace"; limits: "evidence of fixture sufficiency, not universal retrieval or reasoning sufficiency".

### 2.10 `docs/intelligence/AGENT-CONTINUITY.md` (banner "Historical record as of 2026-11-12"; body "CANONICAL OPERATING PROTOCOL")

"Conversation/session memory is temporary. Repository intelligence is durable." "No chat thread, model session,
coding-agent context window, or private scratchpad is allowed to become the only location of a material architectural
conclusion." Cross-thread invariant: "A useful conclusion from one thread must improve the shared virtual model available
to every later thread." "Chat-length risk protocol": "Never trade durable continuity for squeezing one more broad tranche
into a nearly exhausted conversation." Target invariant: "Chats, threads and model sessions may expire. KeyFlowOS
knowledge and forward working flow must not."

### 2.11 The governing rulings (`docs/reconstruction/BUILD-MAP-001.md`)

D-100, D-128, D-226, D-227, D-234 and D-238 are on main; D-253 and D-254 are recorded on `wave/v1-wave-3d` and
`pkt/V1-RULINGS-3E` (line 1260-1261), not yet on main at `16c37675`. Verbatim:
- **D-100**: "A member without revenue read sees no money signals at all: revenue sorts and filters on the contact list are
  ignored, and the payment-health ratio is withheld, as amounts are (D-63, D-90)."
- **D-128**: "The KEY genome's financial metrics, snapshot recompute, signals and recommendations are written by members
  with revenue write; reading them needs revenue read (D-100)."
- **D-226**: "O3, what a memberless turn sees of a proposal: Confirmed: its action, status and risk level only."
- **D-227**: "O4, an unclassified KEY event type: Confirmed: it fails closed."
- **D-233** (related): a finance DNA score is finance, covering "the genome context, prompts, APIs, snapshots, streams,
  recommendations, cached representations and every visible interface element. A reader without revenue read must not be
  able to infer restricted financial performance from a score, grade, ranking, categorical indicator or summary."
- **D-234**: "Sales-derived performance data is finance by default: Sales metrics, transaction-derived signals, sales
  volume and values, conversion metrics derived from restricted commercial data, forecasts, profitability, financial
  opportunities and their recommendations need `revenue:read`. Authorization follows the data's provenance and meaning,
  not only a section name, domain label or currency symbol. ... Where provenance or classification is ambiguous, the row
  fails closed (as D-227 does for an unclassified KEY event type)."
- **D-238**: "... For a viewer without revenue read, a proposal that reveals restricted financial or sales information,
  directly or indirectly, is withheld or safely redacted, and its status and risk level must not become an indirect
  channel. ... Unknown, ambiguous or inadequately classified financial provenance fails closed (D-227, D-234). This applies
  alike to event memory, prompts, API responses, streams and caches."
- **D-253**: "A permanent memory system on two tracks in parallel ...: Track 1 is the AI coding agents' memory layer
  (`docs/development/agent-memory/`, `scripts/agent-memory/`; docs and scripts only); Track 2 is research and design
  (branch `docs/kf-memory-rnd-001`): the owner's research in #106 and #126 recovered into the repo, extended with sourced
  parallels from memory science, the nervous system and medicine and with AI memory systems, one design for the agents
  and for KEY, an evaluation plan. No product code before the owner approves the design."
- **D-254**: "KEY's memory system is built inside v1, in parallel ...: once the owner approves the Track 2 design, its
  product packets join the v1 plan (no longer DEFER_V1_PLUS); each is small, tests-first and safe to merge alone, states
  how its memory reads honour tenancy and revenue scope (D-100, D-128, D-226, D-227, D-234, D-238), names its schema
  changes, and runs any backfill dry-run first and only on owner authority."

Gap noted: none of the memory research files predating these rulings mentions revenue scope; the Genome doc's security
laws cover tenant and user scope only. The design closes this (design section 8.2).

---

## 3. Other issues and pull requests

All bodies and substantive comments below are on the `SaCH-PRO` account. The 2026-11-13 closing comments on #112, #127
and #148 carry a Claude Code footer (written by an agent under the account); the 2026-10 research comments carry no
footer, so who typed them (the owner, or the ChatGPT command centre recording the owner's direction) cannot be
established from the record. Comments that say "User direction" or "Clarification from user" are owner-directed by their
own words. Issues #106, #122, #123, #124, #125, #126 and #153 are all still open at 2026-11-22.

### 3.1 Issue #122, KF-META-MEMORY-TRUTH-AUDIT-001 (M0; opened 2026-10-04; 4 comments)

Purpose: "Execute M0 of the Memory Programme in parallel with application/product delivery. Build a verified causal map of
the current KEYFLOWOS memory system before canonical Context Genome persistence or behavioral cutover." Causal chain:
"**Sources -> intake/writers -> durable stores -> indexes/caches -> retrieval -> prompt/cognition -> action -> outcomes ->
learning/consolidation -> subsequent retrieval.**" Classification vocabulary: "LIVE_CANONICAL, LIVE_ADAPTER, LIVE_PARTIAL,
DORMANT, DUPLICATED, LEGACY, BROKEN, FAKE_GREEN, UNKNOWN_PENDING_PROOF"; "No 'implemented' claim without a demonstrated
live causal path." **Known defects "to verify, not assume" (verbatim):** "user-level persistence/scope gap; Redis user-key
personalization over potentially unscoped DB data; hard recency cutoff hiding old authoritative facts; embedding timestamp
recency distortion; zero-confidence fallback bug; destructive duplicate consolidation lacking lineage; consolidation
promotion overwrite collisions; Evolution methods with no live callers; dormant KnowledgeIngestion; dream hypothesis
validation unimplemented; self-assessment metrics mislabeled as precision/consistency; eval-harness weak checks;
cron/circadian local-time inconsistencies." Completion gate: "M0 is complete only when the current memory system can be
reconstructed from verified repository evidence and every important path is classified with proof."

Comments: c5982171058 (2026-10-04) "M0 audits the current system specifically as the predecessor/evidence base for
**KEY's canonical memory architecture**. The PROJECT/PROGRAMME development-memory path is the first proving-ground
projection of KEY memory, not a separate target architecture." c5982230230 opened PR #127. c5982243130 "Exact-head M0
static proof — PASS" (636 files scanned, 17 components found). **c5982337920 "M0 admission status — correction required":**
"The static workflow ... is green, but M0 is **not complete/admitted**"; review found the harness could "accept incidental
symbol mentions instead of actual declarations; count the audit's own manifest as external evidence; let test-only
callsites satisfy an application-callsite claim; omit real server consumers from both scan roots and workflow trigger coverage"; "no component is promoted to LIVE from this
static slice". **[INFERRED, checked against product code in section 4]:** several of the "known defects" are confirmed at
`5c17e7b4`: the user-level persistence gap (writer drops userId), the hard 90-day window in unified retrieval, embedding
recency distortion (semantic hits without `metadata.createdAt` get recency near 1), and the unreachable conflict resolution.

### 3.2 Issue #123, KF-META-CONTEXT-GENOME-HARDEN-001 (M1; opened 2026-10-04; no comments)

Goal: "Produce the executable M1 foundation for **KEY's canonical memory substrate**, generalized across BUSINESS /
PROJECT / PROGRAMME / AGENT / WORKFLOW / USER." Required: "ContextScope and ContextKind contracts; authority, confidence,
verification as distinct fields/types; valid-time separate from recorded/knowledge-time; provenance/evidence contract;
immutable identity + non-destructive supersession lineage; contradiction/dispute state; explicit scope key sufficient for
tenant/user isolation; compatibility adapter from current Business Genome semantics; no runtime cutover." **Hard
invariants (verbatim):** "repeated observation cannot increase authority; inference cannot become FACT without an explicit
promotion path; supersession never destroys history; inaccessible source memory cannot leak through a derived aggregate;
vector score is never treated as truth/authority; USER scope and BUSINESS/tenant scope must be explicitly representable."
Exit: "Additive contracts compile and pass deterministic tests; no Prisma migration or production behavior change."

### 3.3 Issues #124 and #125 (M2, M3; opened 2026-10-04; no comments)

#124 KF-META-CONTEXT-PERSISTENCE-SHADOW-001: flags `CONTEXT_GENOME_WRITE=OFF|SHADOW|ACTIVE` and
`CONTEXT_GENOME_READ=OFF|SHADOW|ACTIVE`. **Hard invariants (verbatim):** "no destructive migration; no unscoped
user-personalized cache over shared DB rows; original timestamps preserved; confidence=0 remains 0; old authoritative facts
are not discarded solely by age; migration is idempotent; raw/source evidence remains source of truth." #125
KF-META-ADAPTIVE-RECEPTOR-SHADOW-001: "RAW SOURCE -> receptor -> normalized observation -> entity/event/relation candidates
-> salience/uncertainty -> Context Genome shadow write"; **hard invariants (verbatim):** "new receptor != permission;
parsed claim != verified fact; no silent durable sensitive inference; duplicate source events are idempotent; untrusted
content remains quarantinable; shadow first."

### 3.4 Issue #126, KF-META-EPISODIC-ASSOCIATIVE-SHADOW-001 (M4; opened 2026-10-04; no comments)

Named by D-253 with #106 as the research to recover. Goal: "Add KEY's first memory behavior beyond structured/vector top-k
retrieval." **Required structures (verbatim):** "Episode / participant roles / temporal bounds; typed Association with
strength distinct from confidence/verification; support/counterevidence counters and provenance; transient
ActivationContext; bounded spreading activation; inhibition/competition; partial-cue recall; pattern-separation controls."
**Retrieval pipeline (verbatim):** "Hard filter: scope -> permission -> current validity -> supersession ->
authority/verification/risk. Then candidates: lexical/vector/entity/temporal/association. Then bounded activation/rerank.
Return retrieved evidence separately from inferred completion." **Hard invariants (verbatim):** "association never promotes
truth; inferred completion is labeled inference; activation is ephemeral; traversal has max nodes/depth/time/rank;
inaccessible nodes cannot influence accessible aggregates; no unbounded graph expansion." Benchmarks: "partial-cue
completion; false-merge/pattern-separation rate; stale/superseded leakage; cross-scope leakage; latency/cost vs current
retrieval; ablation: current retrieval vs associative layer." Exit: "SHADOW results show measurable value on benchmark
fixtures without scope/authority regressions." Entry gate: "M1 contracts stable". No implementation exists.

The #126 invariant "inaccessible nodes cannot influence accessible aggregates" (with #123's "inaccessible source memory
cannot leak through a derived aggregate") anticipates, for all memory, what D-238 later ruled for proposal-family events
("directly or indirectly") [INFERRED]. D-238 itself is specific to proposals; the design applies the same rule to all
memory as its own reading of D-100 and D-234 (design section 8.2; owner question Q5).

### 3.5 PR #127 (M0 static audit; closed, not adopted, D-141)

Opened 2026-10-04, closed 2026-11-13. Three files (`.github/workflows/memory-truth-audit.yml`,
`scripts/memory-audit/manifest.json`, `scripts/memory-audit/memory-truth-audit.mjs`), none on main. It reported static
evidence as `UNKNOWN_PENDING_PROOF`, never LIVE. Copilot review threads found over-escaped regexes, missing scan roots,
manifest self-matches inflating counts, a bare-symbol fallback hiding missing declarations, and a test-only probe masking a
missing application callsite; the #122 correction comment ("Independent review found ...") lists the same defects
[INFERRED that it adopted these findings]. BUILD-MAP-001 PRS-M36: "#127's memory auditor
cannot report DORMANT".

### 3.6 PR #112 (Context Genome types; closed, not adopted, D-141)

Opened 2026-09-30, closed 2026-11-13; not on main. Its type vocabulary is the owner's most concrete prior schema and is
recorded here so it is not lost:
- `ContextScopeType`: BUSINESS | PROJECT | PROGRAMME | AGENT | WORKFLOW | USER
- `ContextKind`: FACT | PREFERENCE | OBSERVATION | EPISODE | DECISION | POLICY | PROCEDURE | HYPOTHESIS | DERIVED_STATE |
  LESSON | CONSTRAINT
- `ContextAuthorityClass`: USER_DECLARED | USER_VERIFIED | DOCUMENT_VERIFIED | SYSTEM_OBSERVED | AGENT_INFERRED | DERIVED |
  EXTERNAL_UNVERIFIED
- `ContextVerificationStatus`: VERIFIED | INFERRED | UNVERIFIED | STALE | DISPUTED
- `ContextRiskIfWrong`: LOW | MEDIUM | HIGH | CRITICAL
- `ContextTemporalWindow`: `validFrom` / `validTo` ("Real-world validity time"), `recordedAt` ("Knowledge time: when
  KEYFLOWOS recorded this version.")
- `ContextProvenance`: sourceType, sourceId, sourceUri, sourceRevision, sourceContentHash, actorType, actorId,
  correlationId, causationId, runId
- lineage utilities `isContextRecordActiveAt`, `supersedeContextFact`, `assertSingleActiveVersion`.
Defect recorded by BUILD-MAP-001 PRS-M37: the Business Genome adapter set `validFrom` from verification time
(`fact.lastVerifiedAt ?? fact.createdAt`), against the invariant that valid time and recorded time stay separate.

### 3.7 PR #148 (KF-MEMORY-CONTEXT-GENOME-PLAN-001; closed, PORTED PARTS)

Opened 2026-10-05 against the Atlas branch `impl/kf-mission-control-atlas-readmodel-001`, not main. Its three documents
reached main in the tie-off with a dated correction note and status DEFER V1+ (section 2.1 and 2.2). Its body's findings
include "AiMemory is already the canonical structured write path through UnifiedMemoryWriterService.
UnifiedMemoryRetrievalService already normalizes multiple memory stores. Business Genome already provides the strongest
evidence-backed claim admission pattern. TemporalFlowMemory is already an evidence-linked derived-memory pattern." Both
Copilot reviews failed on quota; no review threads.

### 3.8 Issue #153, KF-RD-GENAI-STACK-2026-001 (GenAI R&D ledger; memory sections only)

Opened 2026-10-05, 94 comments to 2026-10-17. "This is **research and architectural memory**, not implementation
authority." Holding finding: "Provider conversation state is ephemeral execution state, never canonical KEY memory."

- **Context and compaction (Layer 1).** R&D-01B (c6005602036): "canonical memory stays durable and provider-independent; a
  Context Compiler constructs a bounded active working set using relevance, recency, authority and task state. Context
  pruning must never mutate truth." LAYER-1 CONVERGENCE (c6006014130): flow "canonical memory/state -> context candidates ->
  relevance/authority/task-state scoring -> cache-affinity layout -> bounded active working set -> provider request";
  **invariant: "context pruning/compaction changes the active working set, never canonical truth."** Part 2
  (c6006031473): "**Do not add a ninth memory store for the new architecture.**"; target "`UnifiedMemoryRetrieval ->
  Context Compiler -> provider-neutral cognitive input`"; invariants include "13. Coding-agent/private memory never becomes
  project truth. 15. Long context does not eliminate retrieval, working memory or provenance."; proof obligations
  "**P-CTX-01 Truth preservation** Context pruning/compaction can never delete or mutate canonical memory/evidence.
  **P-CTX-02 Critical-fact retention** Challenge suite proves required workflow/business facts survive long-context
  compilation." R&D-03A: "summaries are derived context artifacts and must retain provenance/version."
- **LangGraph** (R&D-03B, c6006787358 to c6006824914): "checkpoint != memory: A checkpoint supports resumption of one
  execution occurrence. Memory supports recall across executions/sessions."; "A replay may reconstruct cognition/state, but
  external effects require idempotency/effect identity and must never repeat merely because computation re-runs."; "LangGraph
  Store as canonical KEY memory: **REJECT**"; "**ABSORB the semantics; benchmark the framework.**"
- **CrewAI memory** (R&D-03D): "memory scopes/privacy/consolidation: **ABSORB/BENCHMARK**. CrewAI Memory as canonical KEY
  memory: **REJECT**." Candidate Agent Context Scope classes "CANONICAL_SHARED, TEAM_SHARED, AGENT_PRIVATE_EPHEMERAL,
  AGENT_PRIVATE_DURABLE, RESTRICTED_ROLE, TENANT_PRIVATE"; "private/scratch agent state cannot silently become canonical
  business truth."
- **LlamaIndex** (R&D-03C): "**Absorb the data architecture; do not add a parallel LlamaIndex-owned knowledge plane.**";
  Derivation Fingerprint ("derived knowledge must be reproducible and invalidatable"); Knowledge Tombstone ("deleted/revoked
  knowledge must not remain retrievable through stale embeddings"); "Business Genome is not 'RAG content'"; "Retrieval
  confidence must not become truth confidence"; "Fragment != memory".
- **Embeddings and rerankers** (Layer 4, convergence c6008318382): "vectors never become authoritative facts ...
  **CANONICAL LAW.**"; "`same dimensions != same vector space`"; retrieval and reranking are distinct stages, "Neither is
  truth, authority or confidence"; RepresentationSpec (provider, model, revision, dimensions, chunking strategy, similarity
  contract ...); honest failure vocabulary "MATCHES, NO_MATCH, SOURCE_NOT_ELIGIBLE, INDEX_UNAVAILABLE,
  EMBEDDING_PROVIDER_FAILED, RERANKER_FAILED, INCOMPATIBLE_REPRESENTATION, INDEX_STALE, INDEX_INCOMPLETE,
  TRUNCATED_REPRESENTATION, POLICY_BLOCKED" (R&D-04A gap EMB-GAP-04: "'No relevant memory exists' and 'retrieval
  infrastructure failed' are semantically different states"). Name: "**Governed Representation & Retrieval Fabric**";
  "Context Genome remains truth owner."
- **Vector databases** (Layer 5, c6008343664): "Vector DBs are disposable projection stores"; "No DB-native tenant
  primitive substitutes for KEY authorization"; "Filtered ANN has non-obvious recall effects ... **NEW PROOF OBLIGATION.**";
  "**RETAIN PostgreSQL + pgvector as the architectural baseline until a measured benchmark proves it inadequate.**";
  pgvector use in KEY is "underpowered" (no HNSW/IVFFlat, no hybrid, no representation-generation schema).
- **Other**: "Adapter weights are not memory ... **CANONICAL.**" (Layer 6); Ragas gaps (RAGAS-GAP-04 outage masquerading
  as no-match; -06 "no blocking tenant-leakage retrieval metric"; -08 "hard-coded unified-memory ranking weights lack a
  mature benchmark/admission loop"); Rebuff (c6009953713): "Threat memory should be separated from Context Genome / business
  memory"; "Unvalidated attacker input cannot self-register as a globally trusted attack signature"; "self-hardening via
  automatic vector insertion: **REJECT unless evidence-gated**". Global convergence (c6010080039, file
  `docs/intelligence/research/GENAI-RD-GLOBAL-CONVERGENCE.md` on main): "**Reject as canonical runtime:** ... second
  canonical memory store, ... vector similarity as truth". Context compiler continuity (c6021579475): role "deterministic,
  provenance-bearing development-context projection that compiles explicit task sources and proof requirements without
  becoming a memory source of truth, execution authority, architecture authority or admission authority"; target
  "`MINIMUM SUFFICIENT CONTEXT FOR CORRECT ACTION`".

### 3.9 Not read or not verified

Issue #80 REVIEW `CG-REVIEW-META-MEMORY-TRUTH-AUDIT-CORRECTION-001` (cited by #122); #153 layers other than those listed;
`docs/intelligence/handoff/DURABLE-MEMORY-2026-10-06-SPEED-STRUCTURE-RND-CONVERGENCE.md` (exists on main, not read).

---

## 4. What the product already implements (KEY memory as built, at main `5c17e7b4`)

Read to describe, not to change. Paths under `apps/server/src/modules/`. Line numbers are from that commit.
**[INFERRED]** marks conclusions drawn from reading rather than stated in code.

### 4.1 Stores (Prisma, `packages/db/prisma/schema.prisma`)

| Model | Key fields | Notes |
|---|---|---|
| `AiMemory` | businessId, category, key, value, confidence (default 1.0), source, expiresAt | `@@unique([businessId, category, key])`; **no userId column** |
| `AiMemoryEmbedding` | businessId, content, sourceType (memory, event, conversation, document, temporal_memory), sourceId, `vector(1536)`, metadata | b-tree indexes on businessId and (businessId, sourceType) only; **no ANN index** (no HNSW/IVFFlat in migrations) [INFERRED: each search is a sequential scan per business] |
| `GenomeMemoryEvent` | sourceType, eventType, domain, section, outcome, impactScore, confidenceDelta, evidence/lessons Json | outcome ledger |
| `TemporalFlowMemory` | entityType, entityId, type (summary, pattern, insight, recommendation), content, sourceEventIds[], confidence | derived summaries with source event ids |
| `CognitionMemory` | userId?, functionId, query, recommendation, userResponse, actualOutcome, confidence, lessonsLearned | per-member lessons (D-130) |
| `KeyCortexMemory` | userId?, type, key, value, accessCount, lastAccessedAt | salience awareness feed |
| `CognitiveEvent`, `BusinessEvent`, `AiExecutionLog`, `CortexActionLog` | | read as episodic stores |

### 4.2 Services

- **`key-cortex/unified-memory-retrieval.service.ts`** (LIVE; the one read facade). Eight parallel Prisma reads, each
  `take: 50`, 90-day window; semantic search only when a `query` is given. Rank (l.54-114):
  `rank = 0.45 * relevance + 0.35 * recency + 0.20 * sourceWeight`, with `recency = exp(-age / 30 days)` (the constant is
  named `RECENCY_HALF_LIFE_DAYS = 30` but is used as an e-folding time, so the half-life is about 20.8 days
  [INFERRED from the arithmetic]), recency `*= 0.8` beyond 90 days, rank `*= 1.2` on an entity match (can exceed 1);
  relevance = similarity, else `confidence * 0.5 + 0.5`. Source weights 0.7-0.9 (l.483-508). Default limit 20. Gaps: the
  AiMemory read does **not** filter `expiresAt`, so expired TTL rows are served here (while `AiMemoryService.getAll` and
  semantic search do filter); CognitionMemory is read business-wide and narrowed only by the caller's projection; no
  cross-store dedup. Callers: `KeyCortexPromptContextService.buildMemoryContext`, the cortex chat pipeline, the flow
  orchestrator's perception section, the digest (count only), the eval harness.
- **`key-cortex/unified-memory-writer.service.ts`** (LIVE; the canonical writer seam). Upserts AiMemory; dedup is the
  unique key, so an upsert overwrites. Typed helpers with fixed confidences: preference 1.0, business fact 0.9, lesson
  0.85, document extraction 1.0. `opts.userId` is accepted but **never persisted** (AiMemory has no userId column).
  The would-be consequence (a member's preference written business-wide, overwritten by another member's) has **no live
  caller** at `5c17e7b4`: `storePreference` and `KeyCortexConversationService.addMessage` are not called (fidelity
  review). The `indexSemantic` path has no caller (DORMANT).
- **`key-cortex/memory-consolidation.service.ts`** (LIVE cron, hourly, gated to each business's local resting hours 20:00
  to 07:00 by the circadian service, once per local day via an in-process map). Order: withdrawMemberPromotions -> decay ->
  resolveConflicts -> promote. Decay: CognitionMemory older than 90 days, `confidence = max(0.1, confidence - 0.1)` per
  nightly run, nothing deleted. `resolveConflicts` is unreachable (unique key; its own comment says so). Promotion:
  member-less, accepted, confidence >= 0.9 cognition rows -> AiMemory `learning / learned:<functionId>` (first 500 UTF-16
  units), per D-130 and W11-MEMORY-PROMOTE-SCOPE. Withdrawal removes promoted rows that match a member's row.
- **`key-cortex/key-cortex-circadian.service.ts`** (LIVE helper, no store): local hour from `Business.timezone`;
  `isRestingHours = hour < 7 || hour >= 20`.
- **`key-cortex/key-cortex-cerebellum.service.ts`** (LIVE, every 6 hours): reads 24 hours of AiExecutionLog (up to 400),
  groups failures by normalised `tool::signature`, keeps those occurring at least twice, top 5; writes AiMemory
  `learned_corrections` with `confidence = min(0.5 + 0.1 * occurrences, 0.95)` and `expiresAt = now + 7 days` (the only
  real TTL forgetting) [INFERRED: unified retrieval still serves these after expiry, see above].
- **`key-cortex/key-cortex-salience.service.ts`** (LIVE, hourly; the "amygdala"): over 24 hours vs a 14-day baseline,
  `ratio = recent / baseline` (2 if baseline is 0 and recent > 0), `salience = min(weight * min(ratio / 3, 1) + novelty +
  (ratio >= 1.5 ? 0.15 : 0), 1)` with `novelty = 0.35` when the baseline is 0; floor 0.25; top 5; weights e.g.
  invoice_overdue 0.7, negative_sentiment 0.9, invoice.paid 0.6. Writes KeyCortexMemory concerns (TTL 90 minutes in an
  in-process map) and endocrine levels; `describeForPrompt` renders the top items as facts into every flow-chat system
  prompt via `CognitiveTriageService.standingContext`.
- **`ai/semantic-memory.service.ts`** (LIVE when an OpenAI key is set): OpenAI `text-embedding-3-small`, 1536 dimensions,
  cosine; defaults minSimilarity 0.7, limit 5 (chat uses 0.65); AiMemory copies are inserted only while the source row
  still holds the same value (a CTE with `FOR SHARE`) and served only while unexpired and unchanged; other source types
  insert without dedup. `deleteForSource` deletes without a business filter but has no caller (DORMANT).
- **`ai/ai-memory.service.ts`** (LIVE): the key-value business memory, 24 categories; every write and delete goes through
  helpers that drop stale embedding copies (W1F-MEMORY-COPIES, FU-MEMORY-COPIES-REWRITE); `buildPromptSection` renders
  "USER PREFERENCES & MEMORY" into every flow-chat turn; approval learning adjusts `corrections/rejected_<tool>`;
  `summarizePatterns` writes `patterns` rows with a 7-day TTL.
- **`temporal-flow/temporal-flow-memory.service.ts`** (LIVE; BullMQ compaction every 6 hours): per thread, contact and
  channel summaries; dedup by (business, entityType, entityId, type), updated in place; confidence formulas e.g.
  `min(min(0.5 + n/50, 0.9) + 0.05 * critical + 0.05 * genomeImpact, 0.98)`; embeds when confidence >= 0.7
  [INFERRED: each re-summary above 0.7 inserts another embedding for the same source id, since non-memory copies are not
  deduplicated, so these accumulate]. **`updateMemory(memoryId, patch)` is not scoped by businessId** and is reachable
  through the KEY connector commands `update_memory` / `tag_memory`, which receive a businessId and drop it [INFERRED risk:
  needs a guessed id]. No decay.
- **`business-genome/key-genome/genome-memory.service.ts`** (LIVE): the outcome ledger; dedup for ten event types;
  `findSimilarMemory` is an equality filter, not semantic; all queries tenant-scoped; REST reads filter money events and
  require revenue read for a single money event (`genome-finance-scope.ts`).

### 4.3 Scope: tenancy and revenue

Tenancy: nearly every query filters `businessId`; the two exceptions are `TemporalFlowMemoryService.updateMemory`
(reachable) and `SemanticMemoryService.deleteForSource` (no caller). Role and revenue scope exist in one place:
`readersOwnPromptMemory` (`key-cortex/key-cortex-prompt-context.service.ts` ~l.574), applied by buildMemoryContext, the
cortex chat fragments and the flow perception block: drops other members' personal records and cognition rows, keeps
business and cognitive events only within the reader's module sight (modules inferred from words in the event; revenue
words include invoice, payment, ledger, cash, payroll), requires revenue for genome money events (failing closed), and
reduces proposals for memberless turns (D-226). **Not gated** (the projection returns no modules for these stores):
AiMemory, embeddings, temporal-flow memory, execution and action logs. **[INFERRED] risks against D-100/D-234/D-238**:
`document_extraction` AiMemory rows (any uploaded document's extracted JSON, which can be an invoice or statement) reach
every member's prompt and `GET /ai/memory`; the flow orchestrator's `buildSemanticMemorySection` injects the top five
semantic hits of every source type with no reader or module projection; `GET .../agent/memory/search` returns semantic
hits to any member; salience `describeForPrompt` states counts of overdue invoices, invoices paid and payments received
in every flow-chat prompt with no revenue check (counts, not amounts; whether counts are "money signals" under D-100 and
"indirect" disclosure under D-238 is an owner question). None of these is in `V1-PLAN-RECUT.json` at main `16c37675`
(searched for `document_extraction`, `buildSemanticMemorySection`, `describeForPrompt`, `updateMemory`, `expiresAt`).

### 4.4 What the plan already does about memory (`V1-PLAN-RECUT.json`)

Existing packets touching memory: W11-KEY-CHAT-SESSION-BIND, W11-MEMORY-PROMOTE-SCOPE (member lessons not promoted
business-wide), W11-FLOW-PERCEPTION-SCOPE (reader's own cognition memory only), W1F-MEMORY-COPIES and
FU-MEMORY-COPIES-REWRITE (embedding copies die with their source), FU-KEY-MEMORY-MONEY-SIGHT (genome money events and
memberless proposals in prompts), FU-KEY-CHAT-GENOME-MONEY-SIGHT, FU-KEY-GENOME-READS-RESIDUAL (every remaining genome read
resolves its reader; P0, not done at `wave/v1-wave-3d`), FU-PROPOSAL-REVENUE-SIGHT (P0; edits the prompt-context file),
FU-PROPOSAL-MONEY-TAG, FU-KEY-EVENT-COLUMNS, FU-GENOME-REVENUE-CLASSIFIER, FU-GENOME-SURFACES-REVENUE, KEY-CRONS-FLAGS. The proposal in
`PRODUCT-MEMORY-PACKETS-PROPOSAL.md` builds on these and does not repeat them.

---

## 5. Track 1 as built (the agents' working memory layer)

On `wave/v1-wave-3d` (PR #221), `docs/development/agent-memory/README.md` maps layers: Working = live context (not
authoritative); Episodic = issue #80, git history, PRs (authoritative, append-only); Semantic = plan and rulings
(authoritative), `ORCHESTRATOR-STATE.md` (checkpoint), generated `V1-STATUS.*` (derived); Procedural = briefs and
runbooks ("They restate rulings; the rulings win"); Consolidation = rewrite rules per event; Retrieval =
`scripts/agent-memory/bundle.mjs` and `status.mjs` (derived projections). It cites the owner's research directly ("This
is a projection of the one memory architecture for one consumer (the coding agents), not a second memory engine (#106
comment 5982170811 ...)"). `MEASUREMENT.md` measured characters, not tokens: the first read on resume would fall from
104,312 to 27,375 characters if it replaced the `CLAUDE.md` list (it does not yet; that needs an owner ruling); a packet
bundle has a median of 5,094 characters against 985,615 for the plan and build map it is compiled from; one resume test
by a subagent scored 10 of 10. Comparison with this design: `KEYFLOW-MEMORY-SYSTEM-DESIGN-001.md` section 11.

---

## 6. Conflicts and tensions in the record (shown, not resolved)

| # | Statement A | Statement B | Status |
|---|---|---|---|
| C1 | Genome doc l.214 and §20: consolidation "currently deletes lower-confidence `AiMemory` rows"; STATUS.yaml l.38 the same | Dated correction (Genome l.9; plan l.8; STATUS l.97-102): the delete is dead code because of the unique key | Correction is right about behaviour (code confirms, `memory-consolidation.service.ts` l.215-216); target (no destructive deletion) unchanged |
| C2 | Genome l.158: the dedupe hash "includes `receivedAt`" | Correction: falls back to `new Date()` when `receivedAt` is missing, so such items never dedupe | Compatible; the original was incomplete |
| C3 | Neuro atlas (2026-09-09): unified retrieval "is not wired into the live chat path" | Genome doc (2026-10-05): perception join "proves structured observations reach both live chat paths" | Superseded by time; code at `5c17e7b4` shows the flow orchestrator calls unified retrieval (`ai/flow-orchestrator.service.ts` ~l.1416) |
| C4 | Neuro atlas: KnowledgeIngestion is "neurogenesis", adds facts | Genome doc: `@keyflow:dormant`, zero callers; `ingestUrl` does not fetch | Open; disposition differs again in C7 |
| C5 | Neuro atlas: `key-cortex-memory.service.ts` hippocampus, "Strong" | Crosswalk: "DUPLICATED_CONVERGE / legacy risk"; Genome doc l.78 reports that the service "describes `AiMemory` as the canonical write path" (the service's self-description) | Open (a classification question for the M0 audit) |
| C6 | Neuro atlas: "All cron schedules run in server time" | Genome doc and code: consolidation is gated by business local resting hours | Superseded by code |
| C7 | Genome doc: KnowledgeIngestion is "a **seed to converge or retire**" | Archaeology §15: "retain but epistemically gate"; plan: PR #134 "HOLD FOR M0/M1" | Open |
| C8 | Plan .md hard invariants (e.g. "No fake green or unbounded completion percentage") | STATUS.yaml wording ("no fake-green progress", drops the percentage clause) | Wording drift; the .md is the fuller text |
| C9 | Epistemic trace: the two evidence services are "not automatically duplication" | Crosswalk: `key-cortex-evidence.service.ts` "DUPLICATED_CONVERGE" | Open |
| C10 | AGENT-CONTINUITY banner: "Historical record ... not live state" | Body: "Status: CANONICAL OPERATING PROTOCOL" | The banner is later; principles still cited by Track 1 |
| C11 | Genome doc and plan: "ContextPack" (for KEY and agents) | Speed traces and schema: "ContextBundle" (agents only) | Unreconciled naming; the design uses one name (design section 6 introduction) |
| C12 | Seven status vocabularies (Genome §7, Genome §3.10, GenomeFact, bundle authority/freshness, G165, bundle health, AGENT-CONTINUITY evidence classes) | Genome §7: "Map rather than duplicate existing domain-specific statuses" | Unmapped; design 2.1 proposes the mapping |
| C-A | #106 c5982170811: "One memory architecture, many projections and consumers"; "consumer of that same memory substrate"; "a real production-scale consumer of KEY memory"; "KEY-specific cognition must consume the same governed substrate rather than creating a competing opaque memory stack"; "Do NOT create a separate autonomous-development memory architecture"; c5982087092: "The same substrate must support BUSINESS, PROJECT/PROGRAMME, AGENT, WORKFLOW/TASK ..."; c5994706532: "It does not create a separate developer-only memory or automation stack." | Genome doc l.660: "Do not couple business runtime memory physically to development-control storage, but reuse the semantic laws." | **Open.** The #106 wording ("same memory substrate") can be read as one physical substrate; the Genome doc reads as shared laws with separate storage. Track 1 is a separate physical store (files in git). The design proposes the shared-laws reading [PROP] and asks the owner to choose (open question Q1). |
| C-B | #106 c5982087092: memory work at "20-30%" alongside product, "No memory/meta packet earns application-programme credit" | D-254 (2026-11-22): KEY's memory packets "join the v1 plan" | Later ruling governs for KEY's packets; whether they count toward v1 completion is open question Q6 |
| C-C | #106 c5982087092: start with M0 truth audit; plan: "No production implementation packet should be released before the first two packets converge" | D-254: product packets join v1 "once the owner approves the Track 2 design" | The proposal puts the census (MEM-CENSUS) first in its table and lets the scope-safety fixes run in parallel since they close existing D-100/D-234 exposure; open question Q4 |
| C-E | #126: "Hard filter: scope -> permission -> current validity -> supersession -> authority/verification/risk. Then candidates"; #106 body: filter "before relevance/recency ranking" | Genome doc §12: "candidate identities -> graph expansion -> authoritative claim selection" (authority after expansion) | Tension: the design adopts #126's order (filter first) and #126's "inaccessible nodes cannot influence accessible aggregates" for every expansion step |
| C-F | #123 and #106 rollout: PR #112 is "the starting implementation branch"; #106 checkpoint: "M0: #122 / PR #127" | BUILD-MAP-001 (D-141): #112 and #127 "CLOSED not adopted" | The later ruling governs; #123 and #122 have no comment recording it. The proposal starts M0 fresh and reuses #112's vocabulary as a reference, not as code |
| C-G | #106 rollout: "Completion definition for 'memory v1'" | Product plan: the memory architecture was V1+ (DEFER) until D-254 | "Memory v1" in #106 is not the product v1; D-254 brings KEY's memory packets into v1 without saying which part of "memory v1" that covers (open question Q6) |
| C-H | Genome doc §12 (l.565-575): ranking signals to add include "authority; claim status; evidence coverage" | Design 6.2 [PROP]: authority and verification decide filtering and labelling, not rank | Open; owner question Q14; E-ABL-1 can compare |
| C-I | #106 c5982087092 sequencing: "Use PROJECT/PROGRAMME development memory as the first serious consumer/proving ground"; "Only after benchmarked value, progressively activate the same substrate for KEY/business cognition"; "Build M2-M4 in SHADOW mode" | D-254 (2026-11-22): KEY's memory is built inside v1, in parallel | The later ruling governs KEY's packets; the design keeps SHADOW-first activation for behaviour-changing packets (design 12) and Q1 decides whether the agents ever move onto the product substrate |
| C-D | Rollout plan lanes M0-M12 (#106 c5982087092) | Plan phases 0-10 (`KF-MEMORY-CONTEXT-GENOME-PLAN-001.md`) | Two different numberings, both called "M"; M1 means "Canonical Context Genome Foundation" in one and "source claim identity provenance contract" in the other. The design maps both (design section 12). |
