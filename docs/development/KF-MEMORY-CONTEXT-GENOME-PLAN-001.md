# KF-MEMORY-CONTEXT-GENOME-PLAN-001

Status: PLANNING
Health: GREEN
Scope changed: false
Production touched: false

## Objective

Converge KEYFLOWOS memory, Business Genome, ingestion, evidence, temporal memory,
semantic retrieval and the Living System Atlas into one portable, evidence-
grounded Context Genome architecture without creating a parallel memory system.

## Phase 0 — Memory truth audit

Deliverables:
- enumerate every persistent and ephemeral memory store;
- classify each as canonical, domain-authoritative, event/evidence, derived,
  cache/index, historical, dead or duplicative;
- trace all writers and readers;
- identify where memory is silently discarded, overwritten, duplicated or
  promoted without provenance;
- identify all current source/evidence semantics;
- identify user-scoped versus business-scoped versus platform-global memory;
- map each store into Atlas L3/L4/L5/L6/L8.

Exit proof:
- every known memory store has an owner/classification;
- every live writer has a reachable call path;
- every live retrieval consumer is mapped;
- no unexplained overlapping memory authority remains hidden.

## Phase 1 — Source / Claim / Identity / Provenance contract

Deliverables:
- define Source, Observation, Entity, Claim, Relation, Event, Projection;
- define epistemic state transitions;
- define valid-time and recorded-time semantics;
- define supersession/retraction/dispute lineage;
- define source and processing identity;
- map GenomeFact/GenomeEvidence/GenomeSignal, BusinessEvent, TemporalFlowMemory,
  AiMemory and existing entity identities into the contract;
- identify any schema additions only after mapping proves they are necessary.

Exit proof:
- candidate knowledge cannot silently become accepted truth;
- every accepted claim can point to evidence or explicit human/domain authority;
- existing domain authorities are preserved rather than copied.

## Phase 2 — Portable Vault protocol

Deliverables:
- versioned KEY Vault manifest;
- portable NDJSON schemas for sources/entities/claims/relations/events;
- Raw/Wiki/INDEX/PROCESSING-LOG conventions;
- compatibility/version negotiation;
- encryption/export/retention rules;
- deterministic import/export semantics;
- explicit canonical-vs-derived classification.

Exit proof:
- a valid Vault can be read without OpenAI/Anthropic/Kimi-specific state;
- derived caches can be deleted and regenerated;
- import cannot grant authority merely from file contents.

## Phase 3 — Raw source registry + content addressing

Deliverables:
- SHA-256 content identity for content-bearing sources;
- provider-object mapping;
- delivery-id/source-id/semantic-id separation;
- duplicate detection across connector/manual/local imports;
- tombstone/removal semantics;
- append-only processing journal;
- missed-event reconciliation sweep.

Reuse:
- IngestionItem intake and status semantics;
- connector events;
- object storage;
- existing tenant/security controls.

Exit proof:
- same bytes imported through two channels do not become two source objects;
- delivery retry is idempotent;
- rename does not change source identity;
- removal does not silently erase dependent history.

## Phase 4 — Observation + claim admission pipeline

Deliverables:
- parsed/extracted observations linked to sources;
- candidate claims;
- change classifier:
  NEW / CONFIRMATION / DUPLICATE / CORRECTION / CONTRADICTION /
  SUPERSESSION / RETRACTION / RELATION_DISCOVERY;
- authority/admission policy;
- Genome integration for business facts;
- contradiction objects remain explicit.

Reuse:
- ConversationGenomeExtractorService pattern;
- GenomeSignal review lifecycle;
- GenomeEvidence;
- Genome scoring/verification.

Exit proof:
- inference and accepted truth are distinguishable in storage and retrieval;
- correction preserves prior lineage;
- contradiction never resolves by destructive overwrite alone.

## Phase 5 — General entity graph

Deliverables:
- stable entity identity registry/mapping contract;
- deterministic domain-id reuse;
- candidate entity matching;
- merge/split lineage;
- ambiguous matches require review;
- graph relations with evidence/provenance.

Reuse:
- EntityResolutionService for CRM-specific identities;
- ContactExternalMapping;
- domain IDs across CRM/commerce/bookings/projects/etc.

Exit proof:
- no duplicate universal identity is created when a canonical domain entity exists;
- ambiguous identities are not silently merged;
- entity merge is reversible/auditable where required.

## Phase 6 — Wiki + Index projections

Deliverables:
- deterministic Wiki page materializer;
- INDEX materializer;
- backlinks/related nodes;
- current-versus-history representation;
- provenance links;
- incremental update logic;
- full rebuild command.

Exit proof:
- deleting Wiki/INDEX and rebuilding yields equivalent projection;
- Wiki never becomes canonical truth;
- every important statement links to claim/evidence lineage.

## Phase 7 — Graph-aware Context Compiler

Deliverables:
- extend UnifiedMemoryRetrievalService or create a bounded compiler above it,
  without adding another store;
- hybrid routing using semantic, graph, authority, confidence, recency, task
  relevance, temporal validity and token cost;
- contradiction/evidence inclusion policies;
- risk-sensitive provenance requirements;
- ContextPack schema for KEY and development agents;
- explainable retrieval trace.

Exit proof:
- KEY can say why a context item was selected;
- high-risk answer/action context includes required authority/evidence;
- vector search can be disabled and structured/graph retrieval still works;
- retrieval remains tenant/user scoped.

## Phase 8 — Consolidation / replay / procedural memory

Deliverables:
- preserve circadian consolidation;
- durable consolidation checkpoint/idempotency;
- no destructive conflict deletion;
- claim confidence/retrieval-priority update;
- pattern abstraction;
- ProcedureCandidate generation;
- evaluation/admission into existing skill/capability system.

Exit proof:
- repeated consolidation converges;
- restart/multi-replica execution does not duplicate effects;
- historical evidence remains reconstructable;
- procedural learning reuses existing skill/capability governance.

## Phase 9 — Local-first sync / portability

Deliverables:
- local Vault watcher;
- scheduled reconciliation;
- two-way sync contract where safe;
- conflict detection;
- offline-first read behavior;
- import/export integrity verification;
- backup/restore/rebuild workflows.

Exit proof:
- local copy remains intelligible without cloud service;
- reconnect reconciles deterministically;
- cloud and local replicas cannot silently diverge into two truths.

## Phase 10 — Mission Control memory/world-model view

Deliverables:
- read-only projection into existing Mission Control;
- source backlog;
- processing failures;
- unresolved entity candidates;
- candidate/disputed/stale claims;
- provenance coverage;
- projection/index freshness;
- consolidation health;
- context compiler trace;
- vault sync health.

Exit proof:
- no second dashboard;
- no invented progress denominator;
- UNKNOWN remains explicit;
- no mutation buttons until authority/action contracts are separately admitted.

## Parallel work lanes

### Lane A — forensic map
Owner: architecture/forensics agent
Work:
- Phase 0 store/writer/reader map;
- anti-duplication classification;
- Atlas nodes/edges.

### Lane B — portable protocol
Owner: architecture/design agent
Work:
- Phase 1 and 2 semantic schemas;
- compatibility and provenance rules;
- no runtime mutation.

### Lane C — ingestion characterization
Owner: code agent
Work:
- IngestionItem, connector event, KnowledgeSource, file/document flows;
- exact dedupe/retry/failure behavior;
- no new parallel ingestion service.

### Lane D — retrieval/context
Owner: KEY cognition agent
Work:
- UnifiedMemoryRetrievalService;
- BusinessGraph;
- Genome context;
- perception join;
- prompt/context assembly;
- identify minimal Context Compiler seam.

### Lane E — consolidation/learning
Owner: cognition/learning agent
Work:
- MemoryConsolidationService;
- GenomeMemoryEvent;
- reflection/intuition persistence gaps;
- procedural-learning seam.

### Lane F — safety/privacy
Owner: security agent
Work:
- tenant/user scope;
- export/redaction;
- secret-bearing source policy;
- deletion/retention/tombstones;
- untrusted Vault import.

## Order constraints

Must precede implementation:
1. Phase 0 audit.
2. Phase 1 semantic contract.
3. anti-duplication review against current memory and Genome models.

May proceed in parallel after Phase 1:
- portable protocol;
- ingestion source registry;
- Wiki projector prototype;
- Context Compiler characterization.

Must not precede claim/provenance proof:
- automatic Wiki truth updates;
- universal graph mutation;
- Mission Control memory controls;
- procedural auto-promotion.

## Hard invariants

1. No parallel memory authority.
2. No vector index as canonical memory.
3. No inference-as-truth.
4. No destructive contradiction resolution without lineage.
5. No new universal entity when a canonical domain identity exists.
6. No provider-specific portable format.
7. No second Mission Control.
8. No filesystem contents granting runtime authority.
9. No fake green or unbounded completion percentage.
10. Every architecture-affecting change updates the Living System Atlas.

## Immediate next packets

### KF-MEMORY-TRUTH-AUDIT-001
Read-only forensic packet.
Goal:
- enumerate stores;
- writers/readers;
- source/evidence/projection relationships;
- contradictions/dead paths;
- produce machine-readable memory topology.

### KF-MEMORY-SEMANTIC-CONTRACT-001
Architecture packet after the audit.
Goal:
- freeze Source/Observation/Entity/Claim/Relation/Event/Projection semantics;
- map existing models;
- identify only unavoidable schema gaps.

### KF-MEMORY-PORTABLE-VAULT-001
Protocol packet after semantic contract.
Goal:
- define versioned local-first portable representation and rebuild rules.

No production implementation packet should be released before the first two
packets converge.
