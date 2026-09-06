# KF-JOURNEY-019 — Privacy / Deletion / Exit

Status: ACTIVE ADJACENT PRESSURE LENS — INITIAL J16/K4 CROSS-TRACE

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production implementation: READ-ONLY

## A. Definition

J19 covers how KeyFlowOS corrects, deletes, anonymizes, retains or exits business/user data while preserving legal/audit obligations and preventing erased or corrected information from continuing to influence the system through derived copies.

This initial dossier is intentionally scoped to the J16/K4 question:

> When business knowledge is corrected or erased, do Genome facts, evidence, memories, recommendations, projections and later reasoning converge to the corrected state?

## B. Distinguish two deletion scales

### Whole-business erasure

`GdprPurgeService.purgeBusiness()` is a strong positive seam.

Observed design:

```text
identify all public tables with business_id
→ clear known non-cascading blockers
→ raw DELETE business row inside transaction
→ database ON DELETE CASCADE removes tenant rows
→ query every business_id table afterwards
→ THROW if any tenant row remains
→ verify Business row is gone
```

This is materially stronger than a soft-delete promise and should be preserved.

### Fine-grained correction / erasure

Different problem:

```text
one source assertion/fact/evidence item is wrong, withdrawn or legally erased
→ what derived knowledge must change?
```

Whole-business cascade does not answer this.

## C. J16/K4 data lineage under pressure

Current inspected services expose:

### GenomeFactService

```text
upsertFact
getFact
listFacts
listTopFacts
countFacts
```

No first-class correction/supersession/invalidation/delete lifecycle was observed in this service.

### GenomeEvidenceService

```text
attachEvidence
list evidence for fact
evidence summary
```

Evidence can be attached/updated by source identity, but no first-class source-withdrawal / contradiction / legal-erasure propagation lifecycle was observed in the service.

### GenomeMemoryService

```text
create
list
get
summarize
find similar
counts
```

No source-retraction or invalidation lifecycle was observed.

### Blueprint → GenomeFact backfill

A later Blueprint correction can overwrite the current fact value/source through the same `(business, section, domain, field)` identity and attach/update Blueprint evidence.

That does not by itself:

- invalidate GenomeMemoryEvents previously derived from older signals/recommendations;
- mark active recommendations based on old evidence stale;
- withdraw other supporting evidence;
- record a first-class supersession relation between old and new knowledge revisions;
- invalidate prompt/readiness projections already computed from the old state.

## D. Derived-copy graph

Initial correction graph:

```text
SOURCE ASSERTION / BLUEPRINT / EVENT / SIGNAL
        ↓
GenomeEvidence
        ↓
GenomeFact current row
        ↓
scoring / module readiness / cross-domain snapshots
        ↓
recommendations / experiments
        ↓
action / outcome
        ↓
GenomeMemoryEvent
        ↓
UnifiedMemory / Cortex prompt
        ↓
future recommendation confidence
```

A correction at the top can therefore have descendants that remain semantically active after the source truth changes unless lineage invalidation/recomputation is explicit.

## E. Key distinction

```text
PHYSICAL ROW DELETION
!=
SEMANTIC INVALIDATION OF DERIVED KNOWLEDGE
```

and:

```text
CORRECT CURRENT VALUE
!=
RETRACT ALL LESSONS DERIVED FROM OLD VALUE
```

Some historical/audit evidence may need to remain legally or operationally. The target is not blind cascade deletion for every correction; it is explicit lineage-aware treatment.

## F. Initial target direction

For each KnowledgeRevision / Evidence source, preserve enough derivation lineage to decide:

```text
SOURCE CORRECTED / WITHDRAWN / ERASED
→ classify retention obligation
→ mark/retract/supersede source evidence
→ recompute canonical KnowledgeRevision
→ invalidate or recompute affected readiness/snapshots/recommendations
→ review LearningEligibility descendants
→ retract/qualify learned confidence where causal basis no longer holds
→ update prompt/materialization eligibility
→ preserve required audit history separately from active truth
```

Candidate derived-state statuses should reuse reserved J16 vocabulary where possible rather than create a parallel privacy ontology.

## G. Positive seams to preserve

- database-enforced full-business cascade;
- self-verifying GDPR purge rather than trusting ORM delete semantics;
- explicit GenomeEvidence source metadata;
- GenomeRecommendation evidence IDs;
- GenomeRecommendationOutcome linked action fields;
- K4 KnowledgeRevision/MaterializationState target direction;
- K8 durable evidence and J18 outcome/recovery certainty.

## H. Initial verified finding

- F178 — fine-grained knowledge correction/withdrawal does not currently demonstrate lineage-aware invalidation across Genome-derived facts/evidence/memory/recommendations.

Contradiction:
- C128 — corrected/withdrawn source truth vs still-active derived learning/recommendation/context state.

## I. Important non-conclusion

This trace does **not** conclude whole-business GDPR erasure is broken. The inspected `GdprPurgeService` is deliberately designed to erase and then verify all `business_id` rows.

The active concern is finer-grained correction/withdrawal and derived-state propagation.

## J. Next J19 pressure

Later J19 work should broaden beyond K4 to:

- user/contact-specific erasure;
- legal/audit retention boundaries;
- external provider copies;
- files/documents/blob stores;
- vector/semantic indexes;
- event/audit snapshots;
- exports/backups;
- connector deletion and revocation;
- tenant exit and ownership transfer.

For now J19 remains an adjacent pressure lens feeding J16/K4, not the whole-programme frontier.
