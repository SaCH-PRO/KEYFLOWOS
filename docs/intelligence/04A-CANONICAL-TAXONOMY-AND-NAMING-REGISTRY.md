# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-07

Purpose: prevent semantic duplication, alias drift, repeated indexing, inconsistent naming and multiple canonical entries for the same KeyFlowOS concept.

Numeric allocation for findings, contradictions and recommendations is governed by `04B-CANONICAL-ID-ALLOCATION-LEDGER.md`.

---

# 1. Prime law

```text
ONE SEMANTIC CONCEPT
→ ONE CANONICAL ID
→ ONE CANONICAL NAME
→ ONE CANONICAL OWNER / HOME REGISTER
→ ZERO DUPLICATE CANONICAL ENTRIES
→ MANY ALIASES / REFERENCES PERMITTED
```

Aliases are references, not new concepts.

---

# 2. Mandatory pre-create gate

```text
LOAD 04-CONCEPT-REGISTRY + 04A + 04B
→ SEARCH exact term + synonyms + implementation names + target names
→ CLASSIFY SAME / SPECIALIZATION / RELATED DISTINCT / IMPLEMENTATION ALIAS / HISTORICAL / GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE FIRST
→ allocate only if genuinely distinct and stable
```

---

# 3. Canonical namespaces

- Journeys: `J1 ... J25` — `03-ANALYSIS-MAP.md`.
- Kernels: `K1 ... K12` — `12-KERNEL-PROGRAMME.md`.
- Concepts: `KF-CONCEPT-001–KF-CONCEPT-042` — `04-CONCEPT-REGISTRY.md`.
- Findings: `F001–F221` — `08*`; allocator 04B.
- Contradictions: `C001–C171` — `09*`; allocator 04B.
- Recommendations: `KF-REC-001–KF-REC-055` — `10*`; allocator 04B.

Latest J12 roots:
```text
F219/C169 — transient document assertions can be admitted as successful payment evidence without an explicit consumer-specific evidence-admission decision
F220/C170 — a materially new external document revision can be suppressed as the prior ingestion occurrence when stable external object identity is used as dedupe identity
F221/C171 — mounted DocumentInstance hard delete can destroy version/approval/review proof and detach surviving change history without an explicit document-disposition decision
```

Current major pooled targets:
```text
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition controls
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
KF-REC-054 Commerce & Fulfilment Contract
KF-REC-055 Contract Integrity & Renewal Contract
```

---

# 4. High-value distinctions

```text
Document extraction assertion != qualifying PaymentCompletionEvidence != Payment SUCCESSFUL / Invoice paid truth
Document identity != document revision != parsed representation != extraction/assertion occurrence != verified evidence
EvidenceAdmissionDecision != extraction confidence alone != downstream domain state
ExternalObjectId != ExternalSourceRevisionId != IngestionOccurrenceId != ExtractionOccurrenceId
Same external object != same semantic occurrence when the object has materially changed
Same source revision replay != genuinely new source revision
Document archive/retire/supersede != user-visible delete != physical destruction
Approved/reviewed document revision != disposable current projection
Surviving audit row with detached source coordinate != reconstructable proof lineage
Contract current projection != ContractRevision evidence/history
RetentionPolicy != decorative metadata when exposed as domain retention state
ARCHIVE / RETIRE / SUPERSEDE != HARD DELETE
```

Other mature domain distinctions remain governed by their existing recommendation/journey homes.

---

# 5. High-value aliases / active target vocabulary

| Term | Canonical reference / rule |
|---|---|
| Business Knowledge Kernel / Knowledge Kernel | K4 |
| Business Genome | KF-CONCEPT-003 |
| Business Graph | KF-CONCEPT-007 |
| Clearance | KF-CONCEPT-026 |
| Execution Claim | KF-CONCEPT-028 |
| Temporal Work Projection | KF-REC-047 |
| Operator Attention & Priority Contract | KF-REC-051 |
| Financial Truth & Valuation Contract | KF-REC-052 |
| Commercial Relationship & Obligation Contract | KF-REC-053 |
| Commerce & Fulfilment Contract | KF-REC-054 |
| Contract Integrity & Renewal Contract | KF-REC-055 |
| EvidenceAdmissionDecision | F219/J12 provisional target vocabulary: consumer-specific decision that an exact assertion/evidence revision is admissible for a material downstream claim; generic epistemics delegate to KF-REC-049; no concept ID allocated |
| SourceRevisionOccurrence / IngestionOccurrence | F220/J12 provisional target vocabulary: materially distinct revision/occurrence of a stable external object; reuse J14/KF-REC-035 occurrence semantics and KF-REC-049 revision provenance; no concept ID allocated |
| DocumentDispositionDecision | F221/J12 provisional target vocabulary: explicit decision governing archive/retire/supersede/physical destruction of a versioned/reviewed document and the evidence that must survive; generic privacy/retention policy delegates to J19; no concept ID allocated |
| ExternalObjectId | Stable provider/source object identity; does not by itself prove revision or occurrence identity |
| ContractRevision | KF-REC-055 authoritative agreement-state revision lineage; generic provenance mechanics delegate to KF-REC-049 |
| RenewalDecision | KF-REC-055; requires occurrence-specific qualifying evidence, not lifecycle-status presence |
| RetentionDeletionDecision | KF-REC-055 contract-specific archival/destruction eligibility/evidence |

---

# 6. J12 ownership boundary

```text
F219 owns document/evidence admission at a material consumer boundary.
F220 owns source-revision vs stable external-object occurrence identity at ingestion.
F221 owns destructive disposition of versioned/reviewed document evidence.
```

Delegations:

```text
generic provenance / epistemic eligibility → KF-REC-049
ingress occurrence target direction         → KF-REC-035
same-occurrence retry / effect identity      → KF-REC-048
financial claim strength                     → KF-REC-052
generic privacy / retention / erasure policy → J19 when converged
contract-specific retention/deletion         → F218/C168 + KF-REC-055
```

Do not let J12 become a universal EDMS, event store, ingress runtime, provenance engine, recovery engine or privacy rules engine.

---

# 7. Index integrity rules

1. IDs are monotonically allocated and never reused.
2. One canonical ID has one current semantic meaning/home.
3. Supplement filename letters are organizational labels, never allocators.
4. Reappearance across journeys reuses existing IDs.
5. Implementation classes/tables do not automatically receive architecture IDs.
6. Candidate primitives may be reserved by name before permanent concept allocation.
7. `04-CONCEPT-REGISTRY` owns semantic vocabulary.
8. `04B` owns numeric F/C/KF-REC allocation.
9. Journey/Kernel maps own J/K identity.
10. CURRENT/HANDOFF/ROLLOVER carry current ranges/frontier.
11. Search/reuse is mandatory across ChatGPT, Claude Code and Kimi Code sessions.
12. A document/extraction assertion must not be treated as qualifying domain evidence merely because it is parseable or carries confidence.
13. Stable external object identity must not be the sole occurrence/dedupe identity for a mutable source when materially new revisions matter.
14. Reprocessing the same source revision and admitting a genuinely new source revision are different idempotency problems.
15. Review/verification belongs to an exact revision/value; replacing content under a reviewed coordinate reuses F161/KF-REC-049 rather than creating a domain-local review system.
16. Mutation and its durable revision/evidence record must be crash-consistent; generated-document tweak/import manifestations reuse F164 where equivalent.
17. Physical destruction of versioned/reviewed evidence must not be conflated with archive/retire/supersede; F221 owns the current J12 manifestation while J19 owns generic privacy/retention pressure.

---

# 8. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F221
Contradiction range:     through C171
Recommendation range:    through KF-REC-055
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
Next free:               F222 / C172 / KF-REC-056 — UNALLOCATED
```

J11 remains provisionally converged through F218/C168/KF-REC-055. **J12 is ACTIVE microscopic forensics through F221/C171; no J12 recommendation is allocated yet.**

Current J12 homes:
- `journeys/KF-JOURNEY-012-DOCUMENT-EVIDENCE-LIFECYCLE.md`
- F219 — `08AV`; C169 — `09AV`
- F220 — `08AW`; C170 — `09AW`
- F221 — `08AX`; C171 — `09AX`
- consumer/revision trace — `investigations/J12-DOCUMENT-INTELLIGENCE-CONSUMER-REVISION-LINEAGE-TRACE.md`

Current reuse decisions:
- manual inline edit approved through stale version → F161 / KF-REC-049
- Device reviewed-state reprocess → F161 / KF-REC-049
- AI tweak partial mutation/version evidence → F164
- Drive import section replacement without version → F161 + F164 pressure
- contract extraction → F216/C166 + KF-REC-055
- payment replay → KF-REC-048
- Expense extraction → explicit editable human submit seam; provenance pressure only so far
- direct AI upload → extraction-only controller result
- Drive modified revision suppression → F220/C170
- DocumentInstance hard-delete proof destruction → F221/C171

Next programme action is to finish J12 correction/supersession/deletion dependencies, update the consumer trace/dossier, then decide whether F219–F221 are sufficient to synthesize a bounded KF-REC-056 or whether more first-pass roots remain. No production implementation is authorized.
