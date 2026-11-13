# Research Kernel — Knowing, Gravity, and Negative Space

Status: ACTIVE R&D / LIVE-REPOSITORY PRESSURE TEST PASS 1
Authority: RESEARCH ONLY
Date: 2026-10-06
Programme: KEYFLOWOS autonomous R&D / convergence
Related kernels:
- EPISTEMIC-KERNEL-RND
- STRUCTURE-FUNCTION-STORAGE-OPTIMIZATION-KERNEL-RND
Related live rerun:
- docs/intelligence/handoff/SPEED-DETERMINIZATION-SFS-LIVE-RERUN-2026-10-06.md

## 1. Why a third dimension is required

The existing R&D work has largely converged around two broad dimensions:

1. TIME / SPEED
   - latency;
   - throughput;
   - retries;
   - sequence;
   - temporal coupling;
   - determinization;
   - minimum-sufficient cognition;
   - time-to-correct-completion.

2. SPACE / STRUCTURE / FUNCTION / STORAGE
   - modules;
   - ownership;
   - topology;
   - state placement;
   - data representation;
   - dependency shape;
   - execution paths;
   - storage/access locality.

A third dimension is required:

3. KNOWING / EPISTEMICS
   - what the system observes;
   - what it claims;
   - what it infers;
   - what it treats as fact;
   - what evidence supports the claim;
   - which authority is allowed to declare truth;
   - when that truth is valid;
   - how uncertainty, dispute and staleness are represented;
   - how absence itself is interpreted.

A system can be fast and structurally elegant while still being wrong.

Therefore:

> SPEED answers how quickly the system can move.
> STRUCTURE answers where and how the system exists and acts.
> KNOWING answers what the system is justified in believing, deciding and relying on.

These dimensions interact but must not collapse into one score.

## 2. Core epistemic law

KEYFLOWOS should never ask only:

"What data do I have?"

It must also ask:

- What kind of thing is this?
- Who or what produced it?
- What authority boundary applies?
- What evidence chain supports it?
- What uncertainty remains?
- What could make it false?
- When was it true?
- Is it current, stale, disputed or superseded?
- Is absence itself meaningful?
- What action is justified by this epistemic state?

Candidate law:

> KNOWLEDGE = CONTENT + PROVENANCE + AUTHORITY + TIME + STATUS + UNCERTAINTY + CONTRADICTION MODEL.

No single confidence number can safely replace those dimensions.

## 3. Current repository pressure test

Existing research already shows distinct knowledge-bearing forms:

- Genome facts;
- Genome evidence;
- KeyCortex Evidence;
- BusinessEvent;
- CognitiveEvent;
- CognitionMemory;
- TemporalFlowMemory;
- AiExecutionLog;
- CortexActionLog;
- ToolOutcomeScore;
- learning outputs;
- architecture findings / contradictions / recommendations;
- repository / PR / CI state;
- issue #80 execution authority;
- generated architecture maps;
- derived programme-state projection.

The repository already demonstrates why "memory" and "truth" cannot be synonyms.

Surviving laws from Epistemic Trace 001:

- INTEGRITY != TRUTH.
- CONFIDENCE != AUTHORITY.
- RETRIEVAL RELEVANCE != EPISTEMIC STRENGTH.
- USER ACCEPTANCE != CORRECTNESS.
- EXECUTION SUCCESS != BUSINESS OUTCOME.
- MEMORY != FACT.
- AI INFERENCE != CANONICAL STATE.
- LEARNED LESSON != VERIFIED RULE.
- DERIVED PROJECTION != SOURCE OF TRUTH.
- A FACT IS TRUE ONLY AT A DECLARED AUTHORITY BOUNDARY AND TIME.

The current live control-plane state is itself an example:
a checked-in projection can be internally well-formed yet stale relative to newer authority and repository truth.

## 4. Gravity

"Gravity" is useful only if made operational.

Definition:

> GRAVITY is a force that makes change, reasoning, traffic, state or authority disproportionately accumulate around a part of the system.

Gravity is not automatically bad.
Some gravity is necessary because canonical owners should attract related work.

### 4.1 Gravity classes

#### Semantic gravity
A concept attracts multiple features because it is the canonical meaning owner.

Examples:
- capability identity;
- tenant identity;
- invoice truth;
- Business Genome fact semantics.

Healthy when:
- one clear owner exists;
- consumers depend on a small contract;
- downstream duplication is limited.

Unhealthy when:
- the owner becomes a god-service;
- unrelated semantics are absorbed merely for convenience.

#### Data gravity
Large or high-value state makes services, queries and features cluster around one storage substrate.

Healthy when:
- locality matches access patterns;
- ownership is explicit;
- projections are rebuildable.

Unhealthy when:
- every feature reaches directly into the same database tables;
- storage locality becomes semantic ownership by accident.

#### Authority gravity
A boundary attracts decisions because it is the place allowed to grant/deny permission.

Healthy when:
- authority remains narrow and explainable.

Unhealthy when:
- an AI router, orchestration service, UI or cache becomes a de facto permission source.

#### Dependency gravity
Many modules depend on one package/service/module.

Healthy when:
- it is a stable deep abstraction.

Unhealthy when:
- fan-in reflects convenience coupling or hidden global state.

#### Change gravity
A small set of files/modules repeatedly co-change with otherwise independent work.

This is especially important for architecture archaeology:
high temporal coupling can reveal hidden ownership, leaking abstractions or missing boundaries.

#### Cognitive gravity
Agents repeatedly need the same context to understand or modify a region.

Healthy when:
- that region is intrinsically complex.

Unhealthy when:
- context must be reconstructed because truth is fragmented across stale docs, branches, projections and hidden assumptions.

#### Operational gravity
Incidents, retries, failures or observability repeatedly converge on one boundary.

Can indicate:
- a critical choke point;
- a poorly isolated dependency;
- a recovery bottleneck;
- a genuinely central operational substrate.

#### Compatibility gravity
Old APIs, schemas, migrations or compatibility readers keep attracting new work because nothing can retire them.

This is often hidden structural debt.

#### Coordination gravity
Many agents, reviewers or packets must coordinate before a change can land.

High coordination gravity is a direct drag on net verified throughput.

### 4.2 Gravity is measurable

Candidate measures:

- static fan-in / fan-out;
- co-change frequency;
- cross-domain writer count;
- semantic owner count;
- state representation count;
- queue / provider hop concentration;
- incident concentration;
- retry concentration;
- proof blast radius;
- context assembly frequency;
- number of agents/packets touching the same owner;
- number of stale compatibility consumers.

Gravity metrics prioritize investigation.
They do not authorize refactoring automatically.

## 5. Negative space

Definition:

> NEGATIVE SPACE is a meaningful absence in the system model.

The critical mistake is assuming every absence is a defect.

Some absences are bugs.
Some are unknowns.
Some are deliberate safety boundaries.
Some are signs that a concept should not exist.

Therefore negative space must be classified.

## 6. Negative-space taxonomy

### NS1 — Missing required capability
Something necessary for an accepted function does not exist.

Examples:
- no reconciliation path after an unknown provider outcome;
- no writer for a required state transition;
- no index for a proven dominant access path where latency is material;
- no authority check on an effect-capable path.

Disposition:
REAL GAP -> candidate bounded implementation.

### NS2 — Missing evidence / unobserved reality
The system does not know enough to decide.

Examples:
- provider may have accepted a charge but response was lost;
- user intent is ambiguous;
- a data source has not synchronized;
- an external fact has not been verified.

Disposition:
UNKNOWN, not FALSE.
Preserve uncertainty, retrieve/reconcile/ask/escalate.

### NS3 — Missing representation
Reality exists, but the system has no adequate concept to represent it.

Examples:
- no explicit DISPUTED state;
- no distinction between execution success and business outcome;
- no provenance lineage for learned lessons.

Disposition:
semantic-contract candidate; avoid premature new storage.

### NS4 — Missing connection
Two existing owners should interact but currently do not.

Examples:
- evidence exists but is not carried into retrieval;
- outcome exists but never influences learning;
- research finding exists but never reaches packet derivation.

Disposition:
integration / routing gap.

### NS5 — Missing observability
Behavior exists but cannot be reliably inspected.

Examples:
- no correlation from capability -> execution claim -> outcome;
- no visibility into repeated semantic transforms;
- no measure of model calls avoided by determinization.

Disposition:
telemetry gap, not necessarily business-logic gap.

### NS6 — Missing proof
Implementation exists, but the invariant is not demonstrated.

Examples:
- a tenant guard exists with only mocked tests;
- retry/idempotency semantics exist without crash/replay proof;
- a parser passes happy paths but has no mutation control.

Disposition:
assurance gap.

### NS7 — Missing owner
The concept exists in multiple places but no canonical semantic owner is established.

Disposition:
convergence gap.
Do not create yet another owner.

### NS8 — Missing freshness
Knowledge exists but no mechanism declares when it becomes stale, disputed, expired or superseded.

Disposition:
epistemic/temporal gap.

### NS9 — Missing consumer
State is written but nothing meaningful reads it.

This can reveal:
- dead state;
- incomplete feature;
- abandoned migration;
- misleading "implemented" capability.

Disposition:
trace before deciding.
Could be true negative space or unfinished work.

### NS10 — Missing producer
A field/table/projection is read but no live writer produces trustworthy current values.

Disposition:
critical truth gap until proven otherwise.

### NS11 — Missing failure path
Happy path exists, but cancellation, retry, compensation, unknown outcome or repair is absent.

Disposition:
real operational gap.

### NS12 — Missing contradiction handling
Multiple sources can disagree, but there is no explicit dispute/reconciliation model.

Disposition:
epistemic gap.

## 7. True negative space

Definition:

> TRUE NEGATIVE SPACE is an absence that is correct, intentional and beneficial because adding the missing thing would duplicate ownership, increase ambiguity, weaken safety or create unnecessary complexity.

Examples relevant to KEYFLOWOS:

- no second authority plane;
- no second memory truth;
- no second workflow runtime merely because workflows are useful;
- no generic "truth database" when domain owners already define facts;
- no model call when deterministic computation fully resolves the operation;
- no automatic implementation authority for R&D findings;
- no production effect when authority/evidence is missing;
- no universal event wake-up for irrelevant signals;
- no duplicate canonical connector registry;
- no permanent compatibility layer after all consumers are retired;
- no inferred value where evidence is genuinely absent;
- no forced relationship where two concepts are legitimately independent.

True negative space is a design achievement, not technical debt.

## 8. False negative space

Definition:

> FALSE NEGATIVE SPACE is an absence that appears harmless or intentional but actually hides an unmet invariant, unreachable capability, stale implementation or missing evidence.

Common causes:

- a feature is described in docs but has no reachable writer;
- a table exists but no live producer fills required fields;
- a "green" test suite never exercises the path;
- a queue/listener is registered but never receives the event;
- an AI tool is discoverable but cannot pass authority/execution;
- a projection looks complete but its source is stale;
- a capability exists in one channel but silently disappears in another;
- an error path is swallowed and treated as success.

This is a core target for autonomous R&D reflexes.

## 9. Unknown negative space

Some absence cannot yet be classified.

Definition:

> UNKNOWN NEGATIVE SPACE is an observed absence whose correct disposition cannot be established from current evidence.

Required response:
- do not fill automatically;
- do not call it intentional;
- create a bounded trace;
- identify evidence required to classify it.

This prevents architecture from manufacturing certainty.

## 10. Dangerous negative space

A special class deserves elevated priority:

> DANGEROUS NEGATIVE SPACE is an absence at a safety, authority, money, deletion, tenant, privacy, external-effect or recovery boundary.

Examples:
- missing authorization;
- missing idempotency;
- missing tenant predicate;
- missing unknown-outcome reconciliation;
- missing audit evidence for destructive action;
- missing rollback/compensation where effect may partially commit.

Disposition:
high-priority investigation; implementation still requires authority.

## 11. Positive space / negative space pair

Every important system map should represent both:

POSITIVE SPACE:
- what exists;
- who owns it;
- how it executes;
- how it stores;
- how it proves.

NEGATIVE SPACE:
- what is absent;
- whether that absence is required, intentional, unknown or dangerous.

A map that only shows nodes and edges is epistemically incomplete.

## 12. Knowing × Gravity × Negative Space

The three concepts interact.

A useful forensic question matrix:

### High gravity + strong knowing
Central owner with strong truth/proof semantics.
Likely legitimate core infrastructure.
Protect and simplify its interface.

### High gravity + weak knowing
Danger zone.
Many things depend on something whose truth/authority semantics are unclear.
High-priority trace.

### Low gravity + weak knowing
May be peripheral debt, dead code or an experimental edge.
Investigate proportionately.

### Apparent negative space + strong evidence it should remain absent
TRUE NEGATIVE SPACE.
Protect the absence.

### Apparent negative space + high materiality + weak evidence
UNKNOWN or DANGEROUS NEGATIVE SPACE.
Trace before implementing.

### Repeated false negative space around one owner
Indicates structural or procedural deficiency:
the system repeatedly fails to represent, connect, observe or prove the same class of thing.

This should trigger an R&D reflex.

## 13. Autonomous R&D reflex implications

The R&D arm should emit a research trigger when it observes:

- repeated unknowns at the same semantic boundary;
- repeated manual context reconstruction;
- repeated false-negative-space discoveries;
- high gravity with unclear owner/authority;
- a promoted law contradicted by a new packet;
- a live capability with missing producer/consumer/proof/failure path;
- duplicate owners forming around an intended true-negative-space boundary;
- a new representation that may turn a projection into authority;
- repeated human intervention for the same research/convergence procedure.

Suggested dispositions:

- IGNORE;
- STORE_ONLY;
- LINK_EXISTING_FINDING;
- TRACE_NEGATIVE_SPACE;
- TRACE_GRAVITY;
- EPISTEMIC_AUDIT;
- CROSS_LENS_RESEARCH;
- BACKWARD_REAUDIT;
- CANDIDATE_PACKET;
- REQUEST_IMPLEMENTATION_AUTHORITY;
- ESCALATE_CONTRADICTION.

The R&D arm may autonomously perform all research / trace / convergence actions above.
It may not autonomously cross REQUEST_IMPLEMENTATION_AUTHORITY into semantic implementation unless existing control authority grants it.

## 14. Candidate system coordinates

For any material concept C, maintain a research coordinate:

C = {
  time: {
    latency,
    sequence,
    freshness,
    retry,
    temporal_coupling
  },
  structure: {
    owner,
    dependencies,
    execution_topology,
    storage,
    representations
  },
  knowing: {
    source,
    provenance,
    authority,
    evidence,
    confidence,
    verification,
    uncertainty,
    status,
    risk_if_wrong
  },
  gravity: {
    semantic,
    data,
    authority,
    dependency,
    change,
    cognitive,
    operational,
    compatibility,
    coordination
  },
  negative_space: {
    observed_absences,
    classification,
    evidence_for_classification
  }
}

This is a research coordinate model, not a proposal for one universal runtime schema.

## 15. First live microscopic audits

1. Epistemic Trace 002
   - Evidence / GenomeFact / GenomeEvidence / BusinessEvent / CognitionMemory / ToolOutcomeScore writers, readers and state transitions.

2. Negative-Space Trace 001
   - choose one high-materiality KEY path;
   - enumerate expected stages;
   - find missing producer, consumer, proof, failure/recovery, authority or outcome semantics;
   - classify every absence as TRUE / FALSE / UNKNOWN / DANGEROUS.

3. Gravity Trace 001
   - measure KEY Cortex / AI / Flow / Autonomy co-change, fan-in/out, cross-owner writes and context reconstruction burden.

4. Retrieval Authority Trace
   - prove whether normalized memory/context retains enough epistemic metadata to prevent retrieval relevance from becoming authority.

5. Learning Promotion Trace
   - prove whether acceptance, execution status and business outcome remain distinct before lessons influence future routing or procedure candidates.

## 16. Candidate laws

KNG-I01 — ABSENCE != FALSE.
KNG-I02 — ABSENCE != DEFECT.
KNG-I03 — TRUE NEGATIVE SPACE MUST BE PROTECTED FROM ACCIDENTAL FILLING.
KNG-I04 — UNKNOWN NEGATIVE SPACE MUST NOT BE AUTO-FILLED.
KNG-I05 — HIGH GRAVITY REQUIRES STRONGER OWNERSHIP, EPISTEMIC AND PROOF CLARITY.
KNG-I06 — PROJECTION COMPLETENESS != REALITY COMPLETENESS.
KNG-I07 — UNOBSERVED != NONEXISTENT.
KNG-I08 — UNREACHABLE IMPLEMENTATION != DELIVERED CAPABILITY.
KNG-I09 — A GREEN TEST OVER EMPTY OR WRONG INPUT IS FALSE POSITIVE SPACE.
KNG-I10 — EVERY MATERIAL ABSENCE REQUIRES A DISPOSITION: INTENTIONAL / MISSING / UNKNOWN / DANGEROUS / NOT_APPLICABLE.
KNG-I11 — REPEATED MANUAL DISCOVERY OF THE SAME ABSENCE SHOULD CREATE AN R&D REFLEX CANDIDATE.
KNG-I12 — A SYSTEM'S MODEL OF WHAT IT DOES NOT KNOW IS PART OF ITS KNOWLEDGE.

## 17. Current decision

ADOPT AS ACTIVE RESEARCH KERNEL.

Do not create a universal knowledge graph, truth service or negative-space database from this kernel.

The immediate next step is microscopic tracing and classification against live repository paths, followed by convergence into existing owners.

The autonomous R&D arm should use gravity and negative-space observations as trigger signals, autonomously research and converge them, and request permission before any semantic implementation.


## 18. Live repository + relevant PR cross-reference (verified 2026-10-06)

This kernel is not based only on prior research artifacts. It has been cross-referenced against the active implementation base and the currently relevant PR topology.

### 18.1 Active implementation base

Current `main` at verification:

`ac3a6384417093f198bcc7d672b0dbc295db137c`

That commit is the merge of PR #147:

- **PR #147 — KF-EXEC-ACTION-001**
- state: merged;
- significance: first admitted KEY Capability -> Control -> Clearance -> execution-claim -> outcome-evidence slice for `helpdesk_create_ticket`;
- relevance to this kernel:
  - provides a concrete authority/effect/evidence path;
  - demonstrates that execution attempt, permission and outcome must remain distinct;
  - provides a live substrate for identifying missing authority, evidence, replay and recovery as negative space;
  - creates an observable gravity center around Flow / Capability / Action semantics.

Main also contains merged PR #120:

- **PR #120 — KF-META-STATE-REDUCER-LIVE-001**
- significance:
  - establishes typed issue #80 authority folding over a reviewed checkpoint;
  - distinguishes live authority from a derived projection;
  - directly supports `DERIVED PROJECTION != SOURCE OF TRUTH`;
  - its fail-closed behavior is a concrete example of epistemic correctness under stale/malformed information.

### 18.2 Active safety frontier

**PR #155 — KF-EXEC-AUTH-FAIL-CLOSED-001**
- state: open, draft;
- base: current main `ac3a6384...`;
- semantic head: `8987f6db21a839f90c88e33479768d81cef508e9`;
- control head: `26111633bf8ad3245a9f0abc90c75d1f87e1d564`;
- relevance:
  - directly validates `ABSENCE != PERMISSION`;
  - malformed/missing authority fields must not collapse into an executable allow;
  - exposes dangerous negative space at an authority boundary;
  - reinforces the epistemic rule that incomplete evidence remains incomplete rather than being coerced into a convenient boolean.

No conclusion in this kernel grants merge authority to PR #155.

### 18.3 Active R&D lineage

**PR #154 — durable multi-lens research corpus**
- provides the R&D state machine, evidence classes and anti-loss discipline;
- relevance: supplies the durable research substrate in which this kernel belongs.

**PR #156 — Book x GenAI convergence**
- head observed at verification: `8eb3dee851ac6a9200c8c33f1cefb0f68d9c6d27`;
- provides the Structure / Function / Storage optimization kernel and information-velocity / determinization work;
- relevance:
  - this kernel is the epistemic / absence / gravity complement to that work;
  - it must converge into the same existing owners rather than create a separate architecture.

**PR #157 — whole-system convergence / intelligence continuity**
- this file lives on its head branch;
- head after the present update becomes the new exact checkpoint for this kernel;
- relevance:
  - repairs stale navigation / handoff;
  - reconciles current main, active safety work, research branches and current programme intelligence;
  - is the correct place to record this cross-reference without mutating production semantics.

### 18.4 Memory / Context / Knowing-related PRs

**PR #148 — Memory / Context Genome convergence plan**
- relevance:
  - portable evidence-grounded world model direction;
  - canonical-vs-derived memory semantics;
  - negative-space questions around missing provenance, supersession, conflict and portability;
  - must remain the memory/context owner rather than this kernel creating another truth or memory system.

**PR #127 — memory truth audit**
- relevance:
  - executable/static evidence about current memory stores, writers/readers and authority;
  - should be reused for Epistemic Trace 002 and negative-space classification.

**PR #112 — shared temporal Context Genome substrate**
- relevance:
  - earlier implementation candidate for context/state lineage;
  - useful archaeology input, not automatically current canonical truth.

**PR #128 — KEY cognitive architecture archaeology**
- relevance:
  - evidence for cognitive ownership, duplicated concepts and hidden inference paths;
  - useful input for cognitive gravity and epistemic-boundary tracing.

### 18.5 Atlas / structural-understanding PR stack

**PRs #141 -> #146**
- Living System Atlas foundation;
- deterministic materializer;
- canonical intelligence import;
- packet semantic index;
- code links;
- Mission Control / Atlas read model.

Relevance:
- strongest active substrate for observing positive-space topology;
- can be extended conceptually to expose:
  - gravity;
  - missing owners;
  - missing producers/consumers;
  - missing proof;
  - unreachable capabilities;
  - evidence class;
  - true/false/unknown negative space.
- must remain an overlay over repository/intelligence evidence, not become a second truth system.

### 18.6 Assurance / proof / fake-green PRs

**PR #133 — Assurance Fabric**
- relevance:
  - proof-class compilation;
  - direct support for distinguishing missing implementation from missing proof;
  - useful for NS6 / dangerous-negative-space classification.

**PR #114 — proof integrity / fake green**
- relevance:
  - supports `GREEN OVER EMPTY/WRONG INPUT = FALSE POSITIVE SPACE`;
  - provides existing machinery for vacuity / negative-control reasoning.

**PR #152 — PR Unlock Contract**
- relevance:
  - distinguishes planning activity from delivered product capability;
  - helps classify "apparent positive space" that does not actually unlock reachable behavior;
  - useful for detecting false negative / false positive space around programme progress.

### 18.7 Learning / procedure / autonomous-capacity PRs

**PR #134 — learning ingestion reachability**
- relevance:
  - whether knowledge can enter the system through a real reachable path;
  - supports missing-producer / missing-consumer classification.

**PR #136 — procedural morphogenesis**
- relevance:
  - repeated successful episodes -> candidate procedures;
  - must preserve `episode != procedure != permission`;
  - provides the natural downstream owner for recurring R&D procedures after independent promotion.

**PR #139 — KEY native capacity shadow**
- relevance:
  - read-only latent-capacity discovery;
  - candidate signal source for gravity / missing-reachability / negative-space observations;
  - shadow evidence must not be mistaken for production capability.

### 18.8 Agent-control / autonomous R&D enabling PRs

**PR #149 — parallel orchestration plan**
- relevance:
  - coordination gravity;
  - packet/worktree ownership;
  - conflict topology;
  - future parallel R&D execution must reuse this one control plane.

**PR #111 — per-packet dispatch queue**
- relevance:
  - candidate substrate for multiple queued R&D/implementation work items;
  - must not become a second authority system.

**PR #107 — branch-role semantics**
- relevance:
  - distinguishes branch roles / provenance and helps prevent research/projection branches from being interpreted as implementation truth.

**PR #150 — open-PR convergence board**
- relevance:
  - active mechanism for preventing PR accumulation from becoming hidden compatibility / coordination gravity;
  - should eventually consume gravity and negative-space findings as disposition evidence.

### 18.9 External-reality / connector PR

**PR #105 — canonical Connector Fabric architecture**
- relevance:
  - external source/provider/account reality;
  - provider ambiguity and reconciliation are important epistemic boundaries;
  - supports negative-space analysis of unknown external outcomes, missing reconciliation, missing credentials/authority and duplicate connector ownership.

### 18.10 Cross-reference ruling

After cross-referencing current main and the relevant active PR graph, this kernel's core conclusion remains unchanged but is now more strongly grounded:

1. **Do not build a new truth / negative-space / gravity runtime.**
2. Treat "knowing" as an epistemic contract across existing domain owners, Context Genome, Evidence/Outcome, Atlas and Assurance.
3. Treat gravity as a derived forensic property of existing topology, history, runtime and coordination evidence.
4. Treat negative space as an explicit classification layer over expected-vs-observed system behavior.
5. Use Atlas / Context Genome / Assurance / control-plane artifacts as evidence sources, while preserving their authority classes.
6. Route implementation candidates through the existing issue #80 control plane and bounded packet mechanism.
7. Keep research/convergence autonomous where safe, but require existing authority before semantic implementation.
8. Re-resolve main and the relevant PR heads before every microscopic trace, because open PRs are proposals and may move.

This cross-reference therefore supports the proposed autonomous R&D reflex design rather than requiring a new parallel system.
