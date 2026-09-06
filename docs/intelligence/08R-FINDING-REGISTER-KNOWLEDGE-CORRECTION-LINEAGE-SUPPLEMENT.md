# KeyFlowOS Finding Register — Knowledge Correction Lineage Supplement

Status: CANONICAL CONTINUATION OF `08Q-FINDING-REGISTER-CAUSAL-LEARNING-SUPPLEMENT.md`

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F177. Allocation checked against `04A` + `04B`.

---

## F178 — Fine-grained business-knowledge correction/withdrawal lacks lineage-aware invalidation across active derived Genome state

**Status:** VERIFIED CROSS-LAYER / CORRECTION-LINEAGE FINDING

Whole-business erasure has a strong self-verifying database-cascade implementation in `GdprPurgeService`.

The finer-grained K4 correction problem is different.

Current inspected services expose predominantly additive/overwrite/read semantics:

- `GenomeFactService`: upsert/get/list/listTop/count;
- `GenomeEvidenceService`: attach/list/summary;
- `GenomeMemoryService`: create/list/get/summarize/find/count.

A Blueprint correction/backfill can overwrite the current `GenomeFact` value at the same `(business, section, domain, field)` identity and update/attach Blueprint evidence.

However no first-class lineage-aware correction/withdrawal lifecycle was observed that propagates a source correction through already-derived active state such as:

```text
GenomeMemoryEvent
active GenomeRecommendation
recommendation confidence adaptations
module readiness
cross-domain snapshots
prompt working knowledge
other evidence that supported the replaced interpretation
```

Active recommendations are also deduplicated/reused by domain/title rather than being explicitly bound to a KnowledgeRevision, so a recommendation derived under older knowledge does not automatically become stale when that knowledge changes.

Therefore:

```text
CURRENT FACT CORRECTED
!=
DERIVED KNOWLEDGE / LEARNING CORRECTED
```

This is distinct from:

- F161 — obsolete verification metadata can survive a value replacement;
- F163 — Blueprint and GenomeFact can diverge as knowledge representations;
- F177 — observed outcomes propagate confidence too broadly.

F178 concerns **downstream invalidation/recomputation after the epistemic basis itself is corrected or withdrawn**.

### Target law

```text
KnowledgeRevision / Evidence source
→ explicit derivation lineage
→ correction | withdrawal | legal erasure | supersession
→ classify retention obligation
→ invalidate / recompute affected active derivatives
→ re-evaluate LearningEligibility descendants
→ preserve required audit history without preserving false active truth
```

Do not implement this as blind physical cascade deletion for every correction. Some historical evidence must remain. The invariant is that retained history cannot continue masquerading as current active knowledge.

Affected kernels: K4, K8, K7, K3.
Affected journeys: J16, J19, J2, J6.

---

# Positive seam

`GdprPurgeService` demonstrates the right philosophical property at tenant scope:

```text
DO NOT CLAIM ERASURE
UNTIL THE SYSTEM HAS VERIFIED THE REQUIRED DATA IS GONE
```

K4 correction should adopt the analogous semantic property:

```text
DO NOT CLAIM KNOWLEDGE CORRECTED
UNTIL ACTIVE DERIVATIVES HAVE CONVERGED OR ARE EXPLICITLY MARKED STALE/INCOMPLETE
```

No production implementation is authorized by this supplement.
