# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-07

Purpose: prevent semantic duplication, alias drift, repeated indexing, inconsistent naming and multiple canonical entries for the same KeyFlowOS concept.

Numeric allocation for findings, contradictions and recommendations is governed by `04B-CANONICAL-ID-ALLOCATION-LEDGER.md`.

## Prime law

```text
ONE SEMANTIC CONCEPT
→ ONE CANONICAL ID
→ ONE CANONICAL NAME
→ ONE CANONICAL OWNER / HOME REGISTER
→ ZERO DUPLICATE CANONICAL ENTRIES
→ MANY ALIASES / REFERENCES PERMITTED
```

## Mandatory pre-create gate

```text
LOAD 04-CONCEPT-REGISTRY + 04A + 04B
→ SEARCH exact term + synonyms + implementation names + target names
→ CLASSIFY SAME / SPECIALIZATION / RELATED DISTINCT / IMPLEMENTATION ALIAS / HISTORICAL / GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE FIRST
→ allocate only if genuinely distinct and stable
```

## Canonical namespaces

- Journeys: `J1 ... J25`
- Kernels: `K1 ... K12`
- Concepts: `KF-CONCEPT-001–KF-CONCEPT-042`
- Findings: `F001–F221`
- Contradictions: `C001–C171`
- Recommendations: `KF-REC-001–KF-REC-056`

Latest J12 roots:

```text
F219/C169 — evidence admission boundary
F220/C170 — source-revision / ingestion-occurrence identity
F221/C171 — destructive disposition of versioned/reviewed document evidence
```

Latest target:

```text
KF-REC-056 — Document Evidence & Revision Integrity Contract
```

## High-value J12 distinctions

```text
Document extraction assertion != qualifying evidence != domain truth
Document identity != document revision != extraction/assertion occurrence
EvidenceAdmissionDecision != confidence score
ExternalObjectId != ExternalSourceRevisionId != IngestionOccurrenceId != ExtractionOccurrenceId
same source revision replay != genuinely new source revision
review/approval != mutable current content coordinate
archive / retire / supersede != physical destruction
surviving detached audit row != reconstructable proof lineage
```

## J12 target vocabulary

| Term | Canonical reference / rule |
|---|---|
| DocumentEvidenceReference | KF-REC-056: boundary reference joining stable source/document identity to exact revision and extraction/assertion occurrence; generic provenance mechanics stay in KF-REC-049 |
| EvidenceAdmissionDecision | KF-REC-056: consumer-specific admission/rejection of exact assertion/evidence revision for a material claim/effect |
| SourceRevisionOccurrence | KF-REC-056 boundary identity linking a stable external object to a materially distinct source/extraction/ingestion occurrence; ingress processing stays in KF-REC-035 |
| DocumentDispositionDecision | KF-REC-056: explicit archive/supersede/destruction decision for versioned/reviewed evidence; generic retention/privacy policy stays in J19 |

No new concept ID has been allocated for these target terms.

## KF-REC-056 ownership boundary

KF-REC-056 owns only:

```text
DocumentEvidenceReference
EvidenceAdmissionDecision
SourceRevisionOccurrence binding at document/evidence boundary
DocumentDispositionDecision
```

It delegates:

```text
generic provenance / revision / verification / correction → KF-REC-049
ingress occurrence processing                               → KF-REC-035
same-occurrence retry / recovery / effect identity          → KF-REC-048
operator review / attention                                 → KF-REC-051
financial truth / evidence strength                         → KF-REC-052
contract-specific accepted revision / retention             → KF-REC-055
privacy / legal retention / erasure policy                  → J19
```

Do not let KF-REC-056 become a universal EDMS, event store, provenance engine, ingress runtime, recovery engine, financial-truth system, contract system or privacy rules engine.

## Current J12 anti-duplication checkpoint

```text
manual inline edit approved through stale version       → F161 / KF-REC-049
Device reviewed-state reprocessing                      → F161 / KF-REC-049
AI tweak mutation before version evidence               → F164 / KF-REC-049
Drive import replacement without version                → F161 + F164 pressure
stale descendants after corrected/withdrawn evidence    → F178/C128 + KF-REC-049
contract extraction promotion                           → F216/C166 + KF-REC-055
payment evidence admission                              → F219/C169
payment replay                                          → KF-REC-048
Expense extraction/edit/submit                          → explicit human admission seam; provenance pressure only
Direct AI document processing                           → extraction-only boundary
Drive new revision suppressed by object-ID dedupe       → F220/C170 + KF-REC-035 reuse
DocumentInstance destructive delete                     → F221/C171 + J19 pressure
```

## J12 convergence checkpoint

```text
pressure test: investigations/J12-DOCUMENT-EVIDENCE-LIFECYCLE-STANDARDS-FRONTIER-PRESSURE-TEST.md
backward re-audit: investigations/J12-J16-J14-J18-J7-J11-J19-J17-DOCUMENT-EVIDENCE-INTEGRITY-BACKWARD-REAUDIT.md
recommendation: 10O-RECOMMENDATION-REGISTER-DOCUMENT-EVIDENCE-REVISION-INTEGRITY-CONTINUATION.md
```

Backward re-audit found no parallel provenance, ingress, recovery, financial, contract, operator-attention, privacy or document runtime and no new F222/C172 root.

## Current ranges

```text
Finding range:           through F221
Contradiction range:     through C171
Recommendation range:    through KF-REC-056
Concept range:           through KF-CONCEPT-042
Next free:               F222 / C172 / KF-REC-057 — UNALLOCATED
```

J12 is **PROVISIONALLY CONVERGED / TARGET-ALIGNED through F221/C171/KF-REC-056**. It remains reopenable if J19 convergence, later journeys, migration design or runtime/concurrency/fault proof invalidate its assumptions.

No production implementation is authorized by this taxonomy artifact.
