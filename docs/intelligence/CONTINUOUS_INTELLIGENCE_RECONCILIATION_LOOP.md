# KEY Continuous Intelligence & Reconciliation Loop

**Status:** architecture proposal / project continuation
**Scope:** KEYFLOWOS + KEY development intelligence
**Authority:** documentation only; this file does not authorize runtime, production, merge, provider, or schema changes.

## Purpose

KEYFLOWOS must not treat research, historical discussion, external repositories, pull requests, commits, reviews, issue comments, architecture maps, or experiments as isolated artifacts. Valuable evidence must enter one continuous lifecycle that can be re-used while the system is being built.

The loop exists to make KEYFLOWOS progressively better at learning from:
- internal history and historical conversations;
- current repository state, open/closed PRs, commits, issues, review threads and comments;
- R&D reports, papers, books, standards and scientific analogies;
- external repositories and prior-art implementations;
- runtime evidence, incidents, tests, regressions and observed outcomes.

The loop is **not** permission to copy external code blindly or to promote historical conversation into architecture truth.

## Core lifecycle

```text
DISCOVER
  -> ACQUIRE
  -> MINE
  -> NORMALIZE + PROVENANCE
  -> RECONCILE
  -> CONVERGE
  -> TARGETED R&D
  -> IMPACT MAP
  -> IMPLEMENTATION CANDIDATES
  -> TEST / PROVE / REVIEW
  -> MERGE WHEN AUTHORIZED
  -> OBSERVE
  -> LEARN
  -> repeat
```

### 1. Discover / Acquire

Sources may be internal or external. Every source receives durable provenance:
- source identity and type;
- URL/repository/file/thread identifier;
- commit/version/date where applicable;
- license where relevant;
- retrieval date;
- confidence and trust classification;
- ingestion method.

### 2. Mine

Extract bounded findings rather than storing only raw text. Candidate finding classes include:
- design pattern;
- algorithm;
- architecture primitive;
- workflow;
- failure mode;
- negative control;
- testing strategy;
- domain model;
- safety invariant;
- concurrency pattern;
- human-factor lesson;
- reusable implementation idea;
- explicit rejected approach.

### 3. Normalize and preserve provenance

A finding must remain traceable to its source. External evidence never becomes authoritative merely because it was ingested.

Minimum normalized record:

```yaml
finding_id:
source_id:
source_revision:
summary:
category:
evidence:
confidence:
license:
affected_domains: []
candidate_owners: []
status: MINED
```

### 4. Reconcile

Compare each finding against current KEYFLOWOS truth and active work:
- source code;
- canonical architecture;
- Living System Atlas;
- Context Genome / memory owners;
- current and historical PRs;
- commits;
- issue and review comments;
- tests and controls;
- project-thread harvests;
- current plans and active packets.

Disposition vocabulary:

```text
CURRENT
ABSORBED
SUPERSEDED
IMPLEMENTED
DUPLICATE
CONTRADICTS
IMPROVEMENT
MISSING_CAPABILITY
REJECTED
DEFERRED
ORPHANED
NEEDS_RESEARCH
```

Reconciliation is bidirectional: new evidence can cause old assumptions, plans, code, documentation or accepted findings to be re-audited.

### 5. Converge

Compatible findings are synthesized into one candidate system model. Convergence must avoid creating duplicate owners, registries, memory systems or runtimes. Existing canonical owners win unless evidence shows they must change.

### 6. Targeted R&D

Unresolved questions may fan out in parallel:
- comparable open-source implementations;
- primary documentation;
- formal methods;
- distributed/reliable systems analogies;
- security research;
- scientific or operational parallels;
- experiments/prototypes.

Research feeds back into reconciliation rather than ending as a standalone report.

### 7. Impact map

Every accepted finding must be mapped to its likely KEYFLOWOS surface:
- capability;
- mission/journey;
- service/module;
- datastore;
- connector;
- invariant;
- test/control;
- UI;
- Atlas node;
- Context Genome fact;
- operational policy.

### 8. Operationalize

Accepted findings become bounded implementation candidates, specs, tickets or research packets. Research is not complete merely because a document exists.

Preferred lifecycle:

```text
DISCOVERED
-> MINED
-> VALIDATED
-> RECONCILED
-> ADOPTED | REJECTED | SUPERSEDED | DEFERRED
-> IMPLEMENTED
-> PROVEN
-> MONITORED
```

### 9. Test / prove / review

Implementation candidates must preserve KEYFLOWOS assurance rules:
- no fake green;
- exact-head evidence where required;
- negative/mutation controls for substantive invariants;
- independent review at important boundaries;
- fail closed on uncertainty;
- no silent scope expansion.

### 10. Observe and learn

Runtime/test/development outcomes re-enter the loop as evidence. Failures are first-class learning inputs.

## Relationship to existing work

This loop is a unifying layer over existing owners rather than a new truth system.

- **Historical Intelligence Reconciliation / PR #163**: provides historical thread/export harvesting and disposition evidence.
- **Living System Atlas**: provides the cross-layer map used for impact analysis and provenance.
- **Context Genome / memory**: preserves durable project/business context once reconciled.
- **KnowledgeIngestionService**: existing ingestion-side owner for external knowledge; currently dormant and must be wired/evolved rather than replaced by a duplicate ingestion service.
- **Control/proof plane**: governs implementation authority and evidence; research does not bypass it.
- **KEY self-model**: can later expose what KEY knows, what it does not know and where evidence is stale.

## Automatic behavior target

The eventual system should be event-driven, not an indiscriminate web crawler.

Typical triggers:
- a new architecture or implementation task;
- an unresolved contradiction;
- a failed test or incident;
- a newly submitted external source;
- a new project-thread harvest;
- a material upstream version/change;
- periodic stale-evidence or orphaned-work review.

A trigger should:
1. search internal knowledge first;
2. identify uncertainty/gaps;
3. mine relevant external prior art when useful;
4. reconcile findings with current project truth;
5. fan out bounded research if contradictions remain;
6. produce impact-linked implementation candidates;
7. return outcomes to Atlas/Genome/memory after review.

## Self-development objective

This loop is one component of KEY's eventual ability to participate in building KEYFLOWOS.

The target is not uncontrolled recursive self-modification. It is:

```text
observe problem
-> form bounded goal
-> research prior art
-> reconcile with system
-> propose change
-> test / simulate
-> obtain required clearance
-> implement
-> prove
-> deploy when authorized
-> measure
-> learn
```

## Initial implementation tranches

### R0 — project contract
- this architecture contract;
- source registry format;
- first mined source record.

### R1 — ingestion convergence
- connect/reuse the existing `KnowledgeIngestionService`;
- support repository/document/thread source records;
- preserve immutable provenance;
- avoid a second knowledge store.

### R2 — reconciliation engine
- compare mined findings to code, Atlas, PR/issue history and historical-thread corpus;
- produce explicit dispositions and contradiction records.

### R3 — impact graph and candidate generation
- link accepted findings to owners, journeys, capabilities, invariants and tests;
- generate bounded implementation/research candidates.

### R4 — continuous triggers
- event-driven ingestion/reconciliation on relevant project events;
- periodic stale/orphaned/contradiction review.

### R5 — KEY participation
- expose the loop as governed KEY capabilities;
- allow KEY to identify knowledge gaps, request/perform bounded research, propose changes and evaluate outcomes.

## Invariants

1. External or historical evidence is never automatic architecture authority.
2. Provenance must survive every transformation.
3. No duplicate semantic owner is created when a canonical owner already exists.
4. Research must converge back into the project or receive an explicit disposition.
5. Reconciliation can reopen earlier assumptions when new evidence materially changes the picture.
6. Parallelism is allowed only across independent research/work fronts with explicit dependency edges.
7. Implementation authority remains outside the intelligence loop.
8. Accepted external ideas must be reimplemented/adapted under KEYFLOWOS constraints rather than blindly imported.
9. Licensing and security implications must be recorded before code reuse.
10. A report without disposition, owner or impact mapping is incomplete intelligence.
