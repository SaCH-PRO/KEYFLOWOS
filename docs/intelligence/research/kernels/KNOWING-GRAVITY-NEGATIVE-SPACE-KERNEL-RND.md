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
