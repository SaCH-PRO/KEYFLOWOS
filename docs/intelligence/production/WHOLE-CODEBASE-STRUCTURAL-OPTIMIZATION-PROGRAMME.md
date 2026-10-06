# KEYFLOWOS Whole-Codebase Structural Optimization Programme

Status: PRODUCTION-ALIGNMENT / IMPLEMENTATION PROGRAMME CANDIDATE
Checkpoint: KFCI-2026-10-06-01
Date: 2026-10-06
Scope: entire KEYFLOWOS codebase + KEY runtime + development organism

## 1. Mandate

Any structure/function/storage optimization law that survives the KEYFLOWOS R&D process must not remain isolated research.

It must be:

1. applied RETROACTIVELY to existing code and architecture;
2. applied ACTIVELY to in-flight implementation;
3. applied PROACTIVELY to all new work before code is added;
4. re-audited when later evidence changes the law.

This programme operationalizes that requirement without permitting a one-shot mass refactor or bypassing packet authority/proof.

## 2. Core rule

RESEARCH FINDING
-> evidence class
-> repo pressure test
-> architecture promotion
-> codebase-wide impact scan
-> owner-specific findings
-> bounded implementation packets
-> exact-head proof
-> merge/checkpoint
-> backward re-audit
-> continuous enforcement

A finding is not considered integrated merely because one module adopts it.

## 3. Three application modes

### RETROACTIVE

Apply admitted laws to the current repository.

For each law:
- scan whole codebase for relevant manifestations;
- classify each location:
  - CONFORMING
  - PARTIAL
  - CONTRADICTED
  - DUPLICATE_OWNER
  - STRUCTURAL_DEBT
  - NOT_APPLICABLE
  - NEEDS_TRACE;
- rank by product value, safety, change frequency, latency, blast radius and proof weakness;
- derive bounded correction/refactor packets;
- preserve behavior unless the finding explicitly identifies incorrect behavior;
- backward re-audit previously accepted components when the new law changes their interpretation.

### ACTIVE

Every open/in-flight packet must be checked against newly promoted laws before admission.

Examples:
- does the packet create a duplicate semantic owner?
- can a deterministic invariant replace probabilistic interpretation?
- does state/storage shape match its access pattern?
- does the change increase dependency cycles or cross-domain fan-out?
- does context compression preserve authority/provenance/conflict?
- does a new interface hide mechanism while preserving truth/failure semantics?

If a newly promoted law materially affects an active packet, stop/rebind/review rather than silently grandfathering it.

### PROACTIVE

Every new packet must prove structural fitness before broad implementation.

Required pre-code questions:
1. What function is required?
2. What invariants must never break?
3. Who is the canonical semantic owner?
4. What is canonical state vs projection/cache/index?
5. What topology is required: callers, dependencies, events, authority, evidence?
6. What can be deterministic?
7. What information must remain uncertain?
8. What storage/index shape matches retrieval/update patterns?
9. Which invalid states can be made unrepresentable?
10. What duplication is useful assurance vs harmful ownership duplication?
11. What is the expected change blast radius?
12. What proof class is required?

## 4. Whole-codebase structural audit dimensions

The programme must maintain evidence for:

### Ownership
- one canonical semantic owner per concern;
- duplicate truth/state owners;
- cross-domain writers;
- hidden authority owners.

### Dependency topology
- import edges;
- bidirectional dependencies;
- forwardRef/circularity;
- dependency fan-in/fan-out;
- cross-domain reachability.

### Execution topology
- hop count;
- repeated transformations;
- model calls;
- authority checks;
- network/provider hops;
- failure/retry/compensation boundaries.

### Data/storage topology
- canonical tables;
- projections/caches/vector/graph/index layers;
- indexes vs access paths;
- hot scans/N+1;
- temporal/version/provenance structure;
- tenant locality and ownership.

### Information structure
- duplicated DTO/schema transformations;
- provenance loss;
- context expansion/compression;
- addressability;
- rebuildability of projections.

### Change topology
- churn;
- temporal coupling;
- co-change clusters;
- ownership concentration;
- change blast radius.

### Constraint structure
- type/schema/state-machine invariants;
- uniqueness/idempotency;
- impossible-state prevention;
- late validation that should move earlier.

### Assurance structure
- exact deterministic proof;
- integration-state proof;
- external-effect proof;
- semantic evaluation;
- mutation/negative-control sensitivity.

## 5. Priority formula

Do not refactor alphabetically or by aesthetic preference.

Candidate priority should be a derived score from:

PRODUCT_MATERIALITY
x SAFETY_RISK
x CHANGE_FREQUENCY
x STRUCTURAL_COUPLING
x LATENCY_OR_COST
x PROOF_WEAKNESS
x REUSE_LEVERAGE

with explicit modifiers for:
- active incidents;
- security/authority/payment/deletion paths;
- broad tenant impact;
- current write-set collisions;
- migration/rollback difficulty.

The score prioritizes investigation, not automatic mutation.

## 6. Required tooling

Reuse current architecture/forensics tooling and extend only where gaps are proven.

Existing substrate:
- architecture/inventory.json;
- architecture/dependencies.json;
- architecture/architecture.json;
- module/route/event/capability/data-ownership registries;
- system maps;
- Context Compiler prototype;
- state reducer;
- proof admission + negative controls.

Near-term additions already supported by R&D:
- behavioral Git-history / temporal-coupling projection;
- deterministic context compiler promotion;
- proof-class metadata;
- semantic-latency/determinization telemetry.

Do not create a second architecture database or universal mega-graph.

## 7. Enforcement points

### Pre-packet
MAP BEFORE MODIFYING.
Resolve current main, owner, architecture maps, active PR collisions and relevant laws.

### Packet derivation
Every packet records:
- function;
- invariants;
- owner;
- state/projection distinction;
- write set;
- topology impact;
- storage/index impact;
- deterministic opportunities;
- proof class;
- rollback.

### PR review
Review must explicitly check:
- owner duplication;
- dependency direction;
- semantic transformation count;
- storage/access mismatch;
- invalid-state prevention;
- authority/evidence preservation;
- new uncertainty introduced by the change.

### Admission
No fake green.
Deterministic failures cannot be overridden by semantic evaluation.
Architecture metadata must be regenerated where the packet changes mapped structure.

### Post-merge
- update maps/registries;
- compare predicted vs actual blast radius;
- record latency/cost/proof deltas where relevant;
- schedule backward re-audit if the change establishes a new reusable law.

## 8. Immediate application order

### A. Critical path
Complete/admit/checkpoint PR #155 first.

### B. Codebase-wide structural baseline
Refresh/generate:
- dependency map;
- architecture graph;
- module/event/capability/data-ownership registries;
- current execution paths;
- current open-PR/write-set topology.

### C. First five microscopic audits
1. KEY Cortex topology and functional ownership.
2. Business Genome fact/evidence/signal/memory structure.
3. Context Genome / UnifiedMemoryRetrieval representation lineage.
4. Flow/Capability/Action topology across one additional capability family.
5. Prisma access-pattern/index-locality audit for a high-volume domain.

### D. Derive first correction packets
Only after the traces identify exact owners/write sets/proof obligations.

### E. Make structural checks part of normal packet generation
Once the first cycle is proven useful, add the required structural questions to the agent-control/context bundle so all future Claude/ChatGPT/Kimi work inherits them.

## 9. Non-negotiable anti-patterns

Do not:
- mass-refactor the repository in one PR;
- rename/reorganize folders without behavioral evidence;
- infer that fewer files/classes always means simpler structure;
- collapse useful assurance redundancy;
- create a graph/vector database just because graph structure is useful;
- use Fibonacci/fractal/sacred-geometry patterns as implementation authority;
- let architecture scoring automatically rewrite code;
- treat generated maps as semantic truth;
- create a second memory, workflow, authority or capability runtime.

## 10. Completion criterion

This programme is not complete when a document exists.

It reaches integrated state when:

- the current codebase has a structural conformance inventory;
- high-materiality contradictions are corrected through admitted packets;
- new packets are structurally checked before implementation;
- architecture/storage/topology maps update with code;
- behavioral history and runtime evidence feed prioritization;
- KEY can consume the same structural intelligence for development/operation without treating it as authority;
- future R&D laws automatically trigger backward impact analysis.

## 11. Production decision

ADOPT AS CROSS-CODEBASE IMPLEMENTATION POLICY CANDIDATE.

This document does not authorize an unbounded refactor or production deployment.

It establishes that promoted R&D laws are codebase-wide obligations: retroactive, active and proactive, implemented through exact-owner bounded packets and no-fake-green admission.
