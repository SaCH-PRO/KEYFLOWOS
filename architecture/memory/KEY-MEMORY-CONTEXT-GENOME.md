# KEY Memory / Context Genome — Portable World-Model Architecture

Status: PLANNING / REPOSITORY-CROSS-REFERENCED
Plan ID: `KF-MEMORY-CONTEXT-GENOME-PLAN-001`
Baseline branch: `impl/kf-mission-control-atlas-readmodel-001`
Baseline head: `1190c2236011452485d7575668ad0407c7ca43c5`
Created: 2026-10-05

## 1. Decision

KEYFLOWOS should converge on a **portable, evidence-grounded, local-first memory/world-model architecture**.

This is **not** a second memory subsystem beside the current KEY memory, Business Genome, Temporal Flow, BusinessEvent, ingestion, Evidence, or Living System Atlas.

It is a unifying contract over them.

The architecture target is:

```
REALITY
  -> RAW EVIDENCE
  -> OBSERVATIONS
  -> IDENTITY RESOLUTION
  -> CLAIMS / EVENTS / RELATIONSHIPS
  -> WORLD MODEL / CONTEXT GENOME
  -> MATERIALIZED VIEWS
  -> CONTEXT COMPILER
  -> KEY
  -> PLAN / GOVERN / ACT
  -> REAL-WORLD EFFECT
  -> NEW EVIDENCE
  -> RECONCILE / LEARN
```

The portable filesystem representation is one projection/replica of the same semantic memory, not a competing source of truth.

## 2. Repository cross-reference summary

The current repository already contains most of the substrate. The work is primarily **convergence, authority clarification, provenance hardening, portability, and graph-aware retrieval**.

| Target concept | Current repository evidence | Classification | Plan consequence |
|---|---|---|---|
| Canonical structured memory writer | `apps/server/src/modules/key-cortex/unified-memory-writer.service.ts` -> `AiMemoryService.upsert` | REUSE / EXTEND | Preserve this seam. Do not create a parallel generic memory writer. |
| Unified retrieval | `apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts` + `unified-memory.types.ts` | REUSE / EXTEND | Evolve into graph/provenance-aware context retrieval rather than replace. |
| Prompt perception join | `apps/server/src/modules/ai/perception-join.spec.ts` proves structured observations reach both live chat paths | REUSE | The future Context Compiler should replace/absorb this bounded prompt-assembly role. |
| Semantic/vector memory | `apps/server/src/modules/ai/semantic-memory.service.ts` using `AiMemoryEmbedding` / pgvector | DERIVED INDEX | Treat embeddings as rebuildable acceleration, never canonical memory. |
| General ingestion queue | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` + `IngestionItem` | REUSE / EXTEND | Reuse as intake/control seam where appropriate; add memory-specific source registration rather than new queue. |
| Ingestion dedupe | `IngestionOrchestrator.computeDedupeHash` | PARTIAL | Keep delivery/event dedupe, but add content-addressed source identity independent of received time. |
| Connector ingestion event | `ingestion.item.received`, `file.uploaded`, `file.synced` | REUSE | Feed source registration through existing event fabric. |
| Entity resolution | `apps/server/src/core/connectors/entity-resolution.service.ts` | SPECIALIZED | Reuse deterministic CRM/contact resolution; do not pretend it is a universal knowledge-entity resolver. |
| Durable business facts | `GenomeFactService`, unique business/section/domain/field key | REUSE / CORE | Business Genome remains the business-truth projection, not replaced by a new Wiki database. |
| Evidence-backed business truth | `GenomeEvidenceService`, `GenomeSignalService`, scoring/verification lifecycle | REUSE / CORE | Candidate claims should flow through equivalent evidence/admission semantics. |
| User-stated fact extraction | `ConversationGenomeExtractorService` -> PENDING GenomeSignal + evidence | REUSE / EXEMPLAR | Use as the reference admission pattern: infer -> propose -> verify/merge, not infer -> truth. |
| Outcome/learning memory | `GenomeMemoryService` / `GenomeMemoryEvent` | REUSE / EXTEND | Strong substrate for episodic-to-procedural learning. |
| Temporal summaries/patterns | `TemporalFlowMemoryService` with `sourceEventIds` | DERIVED PROJECTION | Keep as temporal materialized memory; never treat summary as raw evidence. |
| Business mutation lineage | `BusinessEventService` with before/after/evidenceIds/correlationId | REUSE BUT HARDEN | Important evidence spine, but current fire-and-forget writes are insufficient for claims requiring guaranteed provenance. |
| Uploaded task evidence | `EvidenceService` | SPECIALIZED | Preserve business-work evidence semantics; do not overload it into the whole memory source ledger without audit. |
| Knowledge-source ledger | `KnowledgeSource` + `KnowledgeIngestionService` | DORMANT / SEED | Characterize and either reactivate through canonical ingestion or retire; do not build a second equivalent source ledger. |
| Knowledge ingestion | `KnowledgeIngestionService.ingestText` chunks and embeds; `ingestUrl` records pending only | INCOMPLETE | Replace chunk-first semantics with source -> observation -> claim/link -> projection pipeline. |
| Night consolidation | `MemoryConsolidationService` | REUSE CONCEPT / CORRECT SEMANTICS | Preserve circadian consolidation but remove destructive conflict deletion and persist durable consolidation checkpoints. |
| Business Graph | `apps/server/src/modules/ai/business-graph.service.ts` | DERIVED SNAPSHOT | It is a cached business snapshot, not the canonical knowledge graph. |
| Living System Atlas | `architecture/atlas/*` | REUSE / SYSTEM TWIN | Context Genome is the business/person twin; Atlas is the software/development twin. Both should share provenance/evidence laws. |
| Mission Control | `/admin/mission-control` stack on PR #146 | REUSE / OWNER VIEW | Add memory/world-model observability later; do not create a second owner dashboard. |
| Development durable memory | `architecture/`, `docs/intelligence/`, control artifacts | REUSE PATTERN | Repository intelligence is the prototype for model-independent persistent cognition. |

## 3. Important current-repo findings

### 3.1 The current memory architecture is already intentionally converging

`docs/development/KEY_10_ROADMAP_v2.md` explicitly says:

> Unify retrieval paths before adding new stores.

The code now reflects that direction:

- `KeyCortexMemoryService` describes `AiMemory` as the canonical write path.
- `UnifiedMemoryWriterService` routes structured writes to `AiMemoryService`.
- `UnifiedMemoryRetrievalService` normalizes multiple memory stores into one interface.
- `KeyCortexMemoryRetrievalService` is a facade over that retrieval layer.

Therefore the portable Context Genome must **extend this unification**, not introduce `VaultMemoryService` as another independent memory authority.

### 3.2 The repository already has a proto evidence/claim system

Business Genome is much closer to the intended claim architecture than generic `AiMemory`:

- `GenomeFact` has identity, typed value, source metadata, verification status, confidence, freshness, quality, readiness, risk-if-wrong and verification timestamps.
- `GenomeEvidence` attaches source module/entity/summary/strength/occurred time.
- `GenomeSignal` separates candidate knowledge from accepted fact.
- `ConversationGenomeExtractorService` only extracts facts the user explicitly stated, files them as pending signals and does not auto-merge.

This pattern should be generalized semantically before any new universal claim table is proposed.

### 3.3 Semantic embeddings are useful but are not durable knowledge

`SemanticMemoryService` currently:

- generates `text-embedding-3-small` 1536-dimensional vectors;
- stores content + source type + source id + metadata;
- performs cosine search;
- can backfill from `AiMemory`.

This must be classified as a **derived index**.

Hard law:

> Deleting every embedding/vector cache must not destroy any canonical memory or evidence.

### 3.4 Knowledge ingestion exists as code but is explicitly dormant

`KnowledgeIngestionService` is marked `@keyflow:dormant` and repository mapping reports zero callers.

Current behavior is only:

```
KnowledgeSource row
 -> character chunks
 -> SemanticMemory embeddings
 -> processed
```

It does not currently perform:

- content-addressed source registration;
- generalized entity resolution;
- atomic claim extraction;
- contradiction classification;
- provenance graph construction;
- Wiki/materialized-page projection;
- index update;
- claim admission;
- supersession lineage.

`ingestUrl` also does not fetch the URL.

This service is therefore a **seed to converge or retire**, not evidence that portable knowledge ingestion is already complete.

### 3.5 The generic ingestion fabric is stronger than the dormant knowledge ingestor

`IngestionOrchestrator` is already described in code as the canonical entry point for connector intake and writes `IngestionItem`.

It already supplies:

- per-business intake;
- external-id/dedupe detection;
- connector readiness;
- contact entity resolution;
- planning;
- review states;
- correction/rejection;
- controlled execution;
- optimistic-status protection.

The memory programme should reuse its intake/control semantics where appropriate rather than creating an independent ingestion runtime.

However its dedupe hash includes `receivedAt`, so it is **event/delivery dedupe**, not content-addressed evidence identity. The Vault requires an additional raw-content hash.

### 3.6 Current entity resolution is domain-specific, not universal

`EntityResolutionService` can resolve:

- contacts;
- payments;
- bookings;
- invoices;
- a limited company representation.

Contact matching is deterministic using external id -> email -> phone and may auto-create contacts.

That is valuable for CRM ingestion, but a general memory graph also needs non-CRM entities:

- decisions;
- projects;
- products;
- policies;
- concepts;
- locations;
- systems;
- documents;
- organisations without a contact row;
- relationships;
- temporal versions.

Do not silently stretch the existing contact resolver into a universal resolver.

### 3.7 TemporalFlowMemory is already a good example of a derived projection

`TemporalFlowMemoryService` stores:

- entity type/id;
- memory type;
- content;
- `sourceEventIds`;
- source module;
- metadata;
- confidence.

It summarizes threads, contacts and channels from temporal events and embeds sufficiently confident summaries.

That is almost exactly the intended **derived-memory** pattern:

```
events/evidence
 -> summary/pattern
 -> optional vector index
```

The source events, not the summary, remain the evidence basis.

### 3.8 Current consolidation contains one semantics conflict with the target

`MemoryConsolidationService.resolveConflicts()` currently deletes lower-confidence `AiMemory` rows.

For a provenance-first memory system, contradiction resolution must not erase history.

Target behavior is:

```
claim A
 -> superseded / disputed / retracted
 -> claim B
```

not:

```
delete A
```

The raw source and claim lineage must remain reconstructable.

### 3.9 Current consolidation scheduling is not yet a durable orchestration guarantee

The service runs hourly and circadian-gates by business local resting hours. It tracks businesses already consolidated today in an in-process `Map`.

That is an acceptable foundation but not enough for a durable multi-replica ingestion/consolidation contract.

The repository's system map also notes the broader scheduler/replica concern. The portable-memory programme should use durable idempotency/checkpoints rather than relying on process-local "already ran" state.

### 3.10 Some older strategy docs are stale and must not be copied as current truth

Example: `docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md` says `KeyCortexMemoryService` is Redis-only with no DB path.

Current code contradicts that historical statement: `KeyCortexMemoryService` now writes through `UnifiedMemoryWriterService` -> `AiMemoryService` and treats Redis as query cache.

This is precisely why the new architecture must preserve:

```
observed
accepted
intended
derived
historical
unknown
```

rather than flattening all documents into one truth layer.

## 4. Converged semantic architecture

The memory/world-model stack should be described as five planes.

```
REALITY PLANE
  humans | business | world | software | providers
        |
        v
EVIDENCE PLANE
  source objects | events | observations | provenance
        |
        v
KNOWLEDGE PLANE
  identities | claims | relationships | temporal lineage
  Business Genome | Context Genome | Atlas links
        |
        v
COGNITION PLANE
  context compiler | retrieval | reasoning | simulation | learning
        |
        v
CONTROL PLANE
  authority | approvals | execution | recovery | audit
        |
        +---- effects ----> REALITY
```

## 5. Canonical versus derived state

### Canonical / durable

The design target must preserve enough durable information to rebuild every derived projection:

- original source identity and hash;
- source provenance;
- immutable or append-only source/event history where legally appropriate;
- stable entity identity;
- atomic claims;
- claim status and authority;
- evidence links;
- temporal validity and transaction lineage;
- correction/supersession/retraction events;
- processing history.

### Domain-authoritative operational state

Existing domain models remain authoritative for their domains:

- CRM contact truth;
- invoice/payment/accounting truth;
- booking truth;
- project truth;
- Business Genome accepted business facts;
- authority/control state.

The Context Genome must **link to domain authority**, not copy it into an alternate competing truth table.

### Derived / rebuildable

- Wiki pages;
- `INDEX.md`;
- embeddings;
- full-text indexes;
- graph adjacency caches;
- prompt/context packages;
- BusinessGraph snapshots;
- TemporalFlow summaries;
- Mission Control views;
- analytics.

## 6. Primitive semantic contract

Before schema changes, the programme should agree on seven semantic primitives.

### Source

Original evidence or durable referent.

Required semantics:

- stable id;
- content hash where content-bearing;
- source system;
- original locator;
- captured/occurred time;
- tenant/owner;
- sensitivity/data class;
- MIME/type;
- retention/tombstone policy.

### Observation

An extraction directly attributable to a source.

Examples:

- OCR text;
- speaker utterance;
- parsed invoice total;
- document heading;
- detected named entity.

Observations are not automatically accepted business truth.

### Entity

Stable identity across observations and time.

The first implementation should reuse canonical domain identities whenever available rather than inventing duplicate IDs.

### Claim

Atomic assertion:

```
subject --predicate--> object/value
```

with:

- evidence;
- authority;
- confidence;
- status;
- valid time;
- recorded time;
- supersession/retraction lineage.

### Relation

Typed graph edge between entities/claims/events.

### Event

Something that happened, with actor/action/object/time/evidence.

Existing `BusinessEvent`, `TemporalFlowEvent`, `GenomeMemoryEvent`, execution logs and control events are candidates for mapping into this contract; they should not be flattened into one physical table without evidence.

### Projection

Human/agent optimized representation:

- Wiki;
- INDEX;
- Context Pack;
- Business Genome view;
- Temporal Flow memory;
- Atlas;
- Mission Control.

## 7. Epistemic state contract

Reuse the Atlas evidence discipline across KEY memory.

Candidate vocabulary:

```
OBSERVED
SUPPORTED
ACCEPTED
DISPUTED
SUPERSEDED
RETRACTED
UNKNOWN
```

Map rather than duplicate existing domain-specific statuses where possible:

- Genome verification status;
- GenomeSignal lifecycle;
- evidence verification;
- control-plane accepted/intended/unknown states.

Hard rule:

> AI inference cannot become authoritative domain truth solely because a model emitted it.

## 8. Portable Vault representation

The portable representation should be a protocol over canonical semantics.

User-facing shape:

```
KEY-Vault/
|- Raw/
|- Wiki/
|- INDEX.md
|- PROCESSING-LOG.jsonl
'- .key/
   |- manifest.json
   |- sources.ndjson
   |- entities.ndjson
   |- claims.ndjson
   |- relations.ndjson
   |- events.ndjson
   |- checkpoints/
   |- schemas/
   '- cache/
      |- vectors/
      |- fulltext/
      '- adjacency/
```

### Canonical-ish portable records

- `Raw/` original source payloads or references according to retention policy.
- `.key/sources.ndjson` source metadata and hashes.
- `.key/entities.ndjson` portable stable identities / mappings.
- `.key/claims.ndjson` claim records.
- `.key/relations.ndjson` graph edges.
- `.key/events.ndjson` append-only processing/domain memory events.
- `PROCESSING-LOG.jsonl` operational processing lineage.

### Derived

- `Wiki/`;
- `INDEX.md`;
- `.key/cache/*`.

No design should require a specific embedding provider to read the durable Vault.

## 9. Content identity and idempotency

Separate three identities:

1. **delivery identity** — webhook/message/provider event id;
2. **source object identity** — content hash / provider object id;
3. **business semantic identity** — entity/claim/event identity.

The current `IngestionItem` dedupe mechanism mainly addresses #1.

The Vault needs #2 and #3 as well.

Content-addressed source identity should use a cryptographic digest over canonical bytes, with metadata stored separately.

A file rename or duplicate import must not manufacture a second source object.

## 10. Ingestion state machine

Target logical flow:

```
RECEIVED
 -> HASHED
 -> REGISTERED
 -> PARSED
 -> OBSERVATIONS_EXTRACTED
 -> IDENTITIES_RESOLVED
 -> CLAIMS_PROPOSED
 -> CONTRADICTIONS_CLASSIFIED
 -> KNOWLEDGE_ADMITTED
 -> PROJECTIONS_UPDATED
 -> INDEXED
 -> RECONCILED
```

Failure must remain explicit at any stage.

Every operation must be idempotent or deduplicated.

Change classification:

```
NEW
CONFIRMATION
DUPLICATE
CORRECTION
CONTRADICTION
SUPERSESSION
RETRACTION
RELATION_DISCOVERY
```

## 11. Entity-resolution strategy

Use layered resolution:

1. exact canonical domain id;
2. provider/external mapping;
3. normalized deterministic identifiers;
4. high-confidence domain-specific rules;
5. probabilistic candidate match;
6. unresolved candidate requiring review.

Never auto-merge ambiguous entities merely because vector similarity is high.

The existing contact resolver is reused for CRM contacts.

A general resolver is a later kernel and must preserve candidate/merge lineage.

## 12. Retrieval and Context Compiler

The current `UnifiedMemoryRetrievalService` is a strong seam but its present ranking is primarily:

- semantic relevance;
- recency;
- source weight;
- confidence.

The target Context Compiler should add:

- graph distance/relevance;
- authority;
- claim status;
- evidence coverage;
- task relevance;
- contradiction inclusion;
- privacy/user scope;
- temporal validity;
- novelty/redundancy;
- token cost.

Logical retrieval:

```
query/task
 -> intent + entity extraction
 -> index routing
 -> candidate identities
 -> graph expansion
 -> authoritative claim selection
 -> contradiction/evidence attachment
 -> context-budget optimization
 -> ContextPack
 -> KEY
```

For high-risk decisions, the compiler should require provenance and contradiction context rather than return unsupported summaries.

## 13. Consolidation / replay

Preserve the existing circadian idea, but change the semantics.

Consolidation should:

- replay new episodes;
- score salience;
- identify repeated patterns;
- propose abstractions;
- connect evidence;
- classify contradictions;
- strengthen or weaken retrieval priority;
- propose procedural-memory candidates;
- create supersession links;
- refresh projections/indexes.

It must not:

- delete raw evidence merely because a newer belief won;
- silently overwrite contradictory claims;
- rely only on process-local once-per-night state;
- convert model inference into accepted truth without the relevant authority rule.

## 14. Procedural-memory convergence

`GenomeMemoryEvent`, action/execution logs, outcomes and repeated successful patterns should support:

```
episodes
 -> repeated pattern
 -> ProcedureCandidate
 -> evaluation
 -> approved ProcedureSpec
 -> skill/capability
```

This should converge with KEY skills/capabilities, not create a second automation language.

## 15. Development intelligence is the first proving environment

The repository development system already exercises the desired law:

```
observe repo
 -> map
 -> reason
 -> choose bounded work
 -> delegate
 -> implement
 -> test
 -> review
 -> detect contradiction
 -> correct
 -> checkpoint
 -> update durable intelligence
```

Use it as a high-observability proving environment for:

- provenance;
- state transitions;
- contradictions;
- source lineage;
- context packs;
- memory consolidation;
- multi-agent handoff.

Do not couple business runtime memory physically to development-control storage, but reuse the semantic laws.

## 16. Atlas integration

The Living System Atlas should gain memory-world-model semantic nodes/edges, for example:

```
KERNEL-MEMORY
KERNEL-EVIDENCE
KERNEL-IDENTITY
KERNEL-TIME
KERNEL-AUTHORITY

SOURCE-...
OBSERVATION-...
CLAIM-...
ENTITY-...
PROJECTION-...
```

Example edge chain:

```
RAW-SOURCE
 -> supports
CLAIM
 -> describes
ENTITY
 -> projected_as
GENOME-FACT / WIKI-PAGE
 -> retrieved_by
CONTEXT-PACK
 -> informs
KEY-DECISION
 -> authorized_by
AUTHORITY
 -> causes
ACTION
 -> produces
EVIDENCE
```

## 17. Mission Control integration

Do not create a second memory dashboard.

Mission Control should eventually expose a read-only memory/world-model projection:

- source ingestion backlog;
- processing failures;
- duplicate sources;
- unresolved entity candidates;
- candidate claims;
- contradictions;
- unsupported claims;
- stale/superseded knowledge;
- provenance coverage;
- last successful reconciliation;
- projection/index freshness;
- vector/index rebuild status;
- memory-store health;
- Context Compiler evidence completeness.

No synthetic "memory quality 87%" without a bounded denominator.

## 18. Security / privacy / tenancy laws

1. Every memory source/claim/event is tenant-scoped or explicitly platform-global.
2. Personal episodic memory remains user-scoped where the current retrieval contract already requires it.
3. Export must respect deletion, retention, consent and secrets policy.
4. Raw files may contain credentials/PHI/PII; portable storage requires encryption-at-rest options and redaction/export policy.
5. No local filesystem path is trusted as authorization.
6. A model may read only the ContextPack it is authorized to receive.
7. Vault import cannot grant authority merely by containing an authority-looking file.
8. Provider callbacks/events remain subject to existing authentication/signature rules.

## 19. Non-goals for the first implementation

Do not begin by:

- replacing Postgres with Markdown;
- replacing Business Genome;
- replacing IngestionItem;
- replacing BusinessEvent;
- creating a universal graph database;
- adding another vector database;
- creating a second KEY memory API;
- auto-merging inferred facts;
- exporting every secret-bearing table;
- letting a filesystem watcher directly mutate business truth;
- building the final visual graph UI before the semantic contract is proven.

## 20. Planning conclusion

The repository supports the proposed architecture, but the correct implementation is **convergence over existing seams**.

The key architectural gaps are:

1. no first-class portable/local-first memory representation;
2. no universal source/provenance contract spanning ingestion -> claims -> projections;
3. dormant external-knowledge ingestion;
4. no general claim/contradiction/supersession contract outside Business Genome;
5. no generalized entity graph beyond domain-specific identities;
6. vector index is useful but not explicitly treated as disposable cache everywhere;
7. consolidation currently destroys some lower-confidence memory rather than preserving lineage;
8. graph-aware/evidence-aware context compilation is not yet the canonical retrieval path;
9. reflection/intuition still have ephemeral outputs in parts of KEY;
10. Mission Control does not yet expose memory provenance/health.

The execution plan for closing these gaps is defined in:
`docs/development/KF-MEMORY-CONTEXT-GENOME-PLAN-001.md`.
