# KF-JOURNEY-012 — Document / Evidence Lifecycle

Status: **ACTIVE MICROSCOPIC FORENSICS / F219-C169 EVIDENCE ADMISSION + F220-C170 SOURCE-REVISION OCCURRENCE ROOTS / CONTINUING CROSS-DOMAIN TRACE**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.
Runtime proof has **NOT** been executed.

## A. Definition

J12 models how KeyFlowOS creates, imports, parses, extracts, versions, reviews, approves, corrects, retains, deletes and reuses documents/evidence across domains.

Core question:

> What is the stable identity of a document and each document revision, what is observed evidence versus AI inference, which exact revision was reviewed/approved/consumed, and how do downstream domain truths remain attributable when a document is corrected, replaced, superseded, deleted or reprocessed?

Primary kernels: K4 Business Knowledge, K6 State Transition, K7 Temporal/Event, K8 Evidence/Outcome, K9 Integration/External Reality, K11 Recovery/Reliability.
Adjacent journeys: J11 Contract/Renewal, J7 Financial Truth, J13 Connector Lifecycle, J14 External Event Ingress, J16 Business Genome, J17 Operator Attention, J18 Recovery, J19 Privacy/Deletion, J23 Temporal Flow.

---

## B. Current architecture split

### B1. AI-generated DocumentInstance system

```text
DocumentInstance
DocumentSection current mutable projection
DocumentVersion snapshots
DocumentChangeLog
ReviewTask
ProfileVersion / template provenance
status / healthStatus / currentVersionNum
```

Generation creates version 1. AI tweak creates a later `DocumentVersion`. Approval can mark a stored version approved.

### B2. External-document extraction / DocumentIntelligence

`DocumentIntelligenceService.extractFromDocument()` accepts source material and optional external/source identities, parses/extracts, returns a transient `DocumentExtractionResult`, logs an AI execution summary, emits `document.extracted`, and allows domain consumers to materialize consequences.

Known consumers include Contracts, payment evidence, AI upload, Device intake, Expenses, Drive/Connector intelligence, and KEY/Flow orchestration.

These systems must not be assumed to share one canonical identity model merely because both use the word document.

---

## C. Target chain under investigation

```text
SOURCE OBJECT
→ stable object/document identity
→ exact source/document revision
→ parse/normalization artifact
→ extraction/assertion occurrence
→ provenance/model/confidence/source spans
→ review/verification/admission/promotion
→ downstream domain decision/effect
→ lineage back to exact evidence revision
→ correction/supersession/deletion/retention convergence
```

Critical separation:

```text
DOCUMENT / EXTERNAL OBJECT IDENTITY
!= SOURCE / DOCUMENT REVISION
!= PARSED REPRESENTATION
!= EXTRACTION / ASSERTION OCCURRENCE
!= VERIFIED / QUALIFYING EVIDENCE
!= EVIDENCE ADMISSION DECISION
!= INGESTION OCCURRENCE
!= DOWNSTREAM DOMAIN TRUTH
!= CURRENT MUTABLE PROJECTION
!= APPROVAL / REVIEW DISPOSITION
```

---

## D. Positive seams to preserve

1. Generated documents already have explicit `DocumentVersion` snapshots.
2. Generated documents retain change/review concepts.
3. Document intelligence preserves confidence in transient extraction output.
4. Device intake has stable `MediaAsset`/`VisualIntake` identity plus PROPOSED vs ACCEPTED/REJECTED seams.
5. Google Drive sync already detects source change via `driveFileId + modifiedTime`.

The target should strengthen these seams rather than create a universal document runtime.

---

## E. Microscopic findings / anti-duplication

### E1. Manual inline edit versus approved version

```text
updateSection()
→ current DocumentSection changes
→ no DocumentVersion
→ no currentVersionNum increment
→ later APPROVED marks latest stored DocumentVersion
```

Verdict:

```text
SPECIALIZATION → F161 / KF-REC-049
```

No new root.

### E2. AI tweak mutation/version crash boundary

`tweakDocument()` mutates sections/logs before creating the new `DocumentVersion` and updating `currentVersionNum`, with no shared transaction observed.

Potential:

```text
section mutation succeeds
→ version creation fails
→ current content changed without matching version evidence
```

Current verdict:

```text
LIKELY SPECIALIZATION → F164
```

Exact closure remains open.

### E3. External extraction occurrence lineage

The shared extraction service exposes optional source coordinates but no generally observed stable extraction-occurrence/revision object. Consumer-by-consumer tracing remains required.

### E4. F219/C169 — document assertion admitted as payment evidence

Reachable chain:

```text
CommerceController
→ PaymentEvidenceService.processEvidence()
→ DocumentIntelligence extraction OR raw-text fallback
→ transient payment-like assertion
→ no observed consumer-specific evidence-admission gate
→ CommerceService.recordPayment()
→ Payment SUCCESSFUL
→ Invoice / financial consequences
```

Raw-text fallback can explicitly carry `confidence: 0.3` without an observed admission threshold.

Canonical law:

> An extracted document assertion must not become qualifying payment-completion evidence merely because it contains parseable payment-like fields. Promotion must be explicit, consumer-specific, provenance-bearing, revision-bound and evidence-strength-aware.

Homes:
- `08AV-FINDING-REGISTER-DOCUMENT-EVIDENCE-PROMOTION-INTEGRITY-SUPPLEMENT.md`
- `09AV-CONTRADICTION-REGISTER-DOCUMENT-EVIDENCE-PROMOTION-INTEGRITY-SUPPLEMENT.md`

Delegation:

```text
generic provenance / epistemic eligibility → KF-REC-049
financial claim strength                   → KF-REC-052
retry/replay/effect identity               → KF-REC-048
J12/K8 owns                                → evidence admission boundary
```

### E5. Same payment evidence replay

Fresh random manual payment identity can allow same semantic evidence to be reapplied while invoice remains non-terminal.

Verdict:

```text
SPECIALIZATION → J18 / KF-REC-048
NO new root
```

### E6. F220/C170 — external object identity collapses a genuinely new source revision at ingestion

Google Drive sync correctly recognizes a newer `modifiedTime` for the same `driveFileId`, resets/re-extracts the intake, then emits ingestion with `externalId = driveFileId` but without the revision coordinate.

`IngestionOrchestrator.receive()` deduplicates by:

```text
businessId + sourceType + externalId
```

so a legitimate R2 revision of the same Drive object is returned as the existing R1 `IngestionItem` and its plan is not rebuilt.

Failure:

```text
Drive object D @ revision R1
→ extraction E1
→ IngestionOccurrence I1 / plan P1

Drive object D @ revision R2 (R2 != R1)
→ connector correctly detects change
→ extraction E2
→ same externalId D
→ ingestion dedupe says duplicate
→ no distinct occurrence/plan for R2
```

Canonical law:

> Stable external object identity must not be used as the sole ingestion-occurrence identity when that object can acquire materially new revisions.

Homes:
- `08AW-FINDING-REGISTER-DOCUMENT-SOURCE-REVISION-OCCURRENCE-SUPPLEMENT.md`
- `09AW-CONTRADICTION-REGISTER-DOCUMENT-SOURCE-REVISION-OCCURRENCE-SUPPLEMENT.md`

Anti-duplication:

```text
F127/C080 = SAME occurrence cannot resume after failure
F220/C170 = DISTINCT revision wrongly collapsed into prior occurrence
```

F220 reuses J14/KF-REC-035 for occurrence semantics, KF-REC-049 for revision/provenance, and KF-REC-048 for same-occurrence replay/effect identity. It does not create a second ingress runtime.

---

## F. Consumer tranche status

Detailed trace:
`investigations/J12-DOCUMENT-INTELLIGENCE-CONSUMER-REVISION-LINEAGE-TRACE.md`

| Consumer | Classification |
|---|---|
| PaymentEvidence | F219/C169 authoritative admission defect |
| Expenses extract-receipt | extraction-only endpoint so far; client promotion open |
| Flow attachment | prompt/context consumer; KF-REC-049 epistemic boundary |
| Device intake | strong stable identity + PROPOSED/ACCEPTED seam; mutable reprocess revision history open |
| Google Drive intake | F220/C170 source-revision occurrence suppression |
| Contracts | F216/C166 + KF-REC-055 manifestation |

---

## G. Value-density classification

### Core value primitives
- stable document/external-object identity;
- exact source/document revision identity;
- extraction/assertion occurrence identity;
- evidence provenance;
- exact admission/review/promotion binding;
- ingestion occurrence identity for mutable external sources;
- downstream-effect lineage;
- correction/supersession/deletion lineage.

### Necessary specialization
- generated-document sections/templates;
- OCR/parser representation;
- domain-specific extraction schemas;
- consumer-specific admission policy;
- provider/source-specific revision coordinates.

### Derived projections
- current DocumentSection;
- parsed markdown/tables;
- current DriveIntakeFile extraction;
- extraction summaries/health projections.

### Accidental complexity pressure
- multiple representations without explicit identity mapping;
- mutable current content diverging from approved revision;
- transient assertions feeding durable state without admission lineage;
- stable external object IDs overloading revision/occurrence identity.

---

## H. Current anti-duplication ledger

```text
manual inline edit approved through stale version       → F161 / KF-REC-049
AI tweak partial mutation vs version evidence           → check F164
contract extraction promotion                           → F216/C166 + KF-REC-055
payment evidence admission                              → F219/C169
payment evidence replay                                 → KF-REC-048 specialization
Drive mutable revision provenance                       → KF-REC-049 pressure
Drive new revision suppressed by externalId-only dedupe → F220/C170 + reuse KF-REC-035
operator review/attention                               → KF-REC-051
recovery/effect replay                                  → KF-REC-048
temporal occurrence mechanics                           → KF-REC-047 / KF-REC-035 as appropriate
```

Canonical ranges:

```text
F001–F220
C001–C170
KF-REC-001–KF-REC-055
KF-CONCEPT-001–KF-CONCEPT-042
next free F221 / C171 / KF-REC-056
```

No J12 recommendation is allocated yet.

---

## I. Exact next trace

```text
1. inspect Device reprocess reachability and guards after ACCEPTED/REJECTED;
2. trace Expense extract-receipt result through frontend/client into Expense creation;
3. inspect direct AI upload endpoint as extraction-only vs side-effect surface;
4. close generated-document tweak crash boundary against F164 exactly;
5. trace correction/replacement/supersession/deletion across accepted evidence;
6. classify every new seam against F219/F220 + mature KF-REC-049/035/048/052 before F221/C171;
7. pool stable J12 roots before considering KF-REC-056;
8. keep production code read-only and do not claim runtime proof.
```
