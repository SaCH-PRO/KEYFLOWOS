# KF-JOURNEY-012 — Document / Evidence Lifecycle

Status: **ACTIVE MICROSCOPIC FORENSICS / INITIAL ACTIVATION / NO NEW ID ALLOCATED**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J12 models how KeyFlowOS creates, imports, parses, extracts, versions, reviews, approves, corrects, retains, deletes and reuses documents/evidence across domains.

Core question:

> What is the stable identity of a document and each document revision, what is observed evidence versus AI inference, which exact revision was reviewed/approved/consumed, and how do downstream domain truths remain attributable when a document is corrected, replaced, superseded, deleted or reprocessed?

Primary kernels: K4 Business Knowledge, K6 State Transition, K7 Temporal/Event, K8 Evidence/Outcome, K11 Recovery/Reliability.
Adjacent journeys: J11 Contract/Renewal, J7 Financial Truth, J14 External Event Ingress, J13 Connector Lifecycle, J16 Business Genome, J17 Operator Attention, J18 Recovery, J19 Privacy/Deletion, J23 Temporal Flow.

---

## B. Current architecture split

J12 already spans at least two materially different document systems.

### B1. AI-generated DocumentInstance system

`DocumentsService` owns a generated-document engine with:

```text
DocumentInstance
DocumentSection current mutable projection
DocumentVersion snapshots
DocumentChangeLog
ReviewTask
ProfileVersion / template provenance
status / healthStatus / currentVersionNum
```

Generation creates version 1, sections and metadata. AI tweak creates another `DocumentVersion`. Approval can mark a stored version approved.

### B2. External-document extraction / DocumentIntelligence

`DocumentIntelligenceService.extractFromDocument()` accepts:

```text
businessId
source
mimeType
url/base64Content
filename
externalId?
sourceConnector?
sourceId?
```

It may parse via DocumentParsingService, run an AI extraction, return a transient `DocumentExtractionResult`, log an AI execution summary, emit `document.extracted`, and let callers/listeners materialize domain effects.

Known consumers/callers include:

```text
Contracts
commerce payment evidence
AI upload endpoint
Device intake
Expenses
Drive / Connector intelligence
KEY / Flow orchestration
```

These two systems must not be assumed to share one canonical document/revision/evidence identity merely because both use the word "document".

---

## C. Initial target chain

```text
SOURCE OBJECT / generated document
→ stable Document identity
→ exact DocumentRevision / source revision
→ parse/normalization artifact where applicable
→ extraction/assertion occurrence
→ source spans / evidence / model provenance / confidence
→ review/verification/promotion policy
→ downstream domain decision / accepted revision
→ explicit lineage back to exact evidence revision
→ correction / supersession / deletion / retention convergence
```

Critical separation:

```text
DOCUMENT IDENTITY
!= DOCUMENT REVISION
!= PARSED REPRESENTATION
!= AI EXTRACTION / ASSERTION
!= VERIFIED EVIDENCE
!= DOWNSTREAM DOMAIN TRUTH
!= CURRENT MUTABLE PROJECTION
!= APPROVAL / REVIEW DISPOSITION
```

---

## D. Positive seams to preserve

### D1. Generated documents already have explicit DocumentVersion

`generateDocument()` creates the initial current sections and a version snapshot. `tweakDocument()` creates a later `DocumentVersion` after AI edits.

### D2. Generated documents retain change/review concepts

DocumentInstance can include change logs and review tasks. High-risk generated documents can create a pending generation review.

### D3. Document intelligence preserves confidence in its transient extraction result

Invoice/contact/contract extraction result types carry confidence, and some domain-processing paths apply explicit confidence/governance thresholds.

These seams should be strengthened rather than replaced with a universal document runtime.

---

## E. Initial microscopic finding candidates / anti-duplication

### E1. Manual inline edit versus approved version

Observed path:

```text
updateSection()
→ mutate DocumentSection current content
→ log change
→ NO DocumentVersion creation
→ NO currentVersionNum increment

later updateStatus(APPROVED)
→ get latest stored DocumentVersion
→ mark that version approvalStatus=APPROVED
```

The visible/current DocumentSection content can therefore differ from the snapshot that receives approval.

Anti-duplication verdict:

```text
SPECIALIZATION → F161 / KF-REC-049
```

F161 law:

```text
verification belongs to an exact revision/value, not a mutable field coordinate
```

No F219 allocation for this manifestation unless later evidence proves a distinct document-specific semantic root.

### E2. AI tweak mutation/version crash boundary

`tweakDocument()` mutates sections one by one and logs changes before creating the new DocumentVersion and updating `currentVersionNum`. No shared transaction is visible across those operations.

Potential failure:

```text
section mutation succeeds
→ version creation/currentVersionNum update fails
→ current document changed without matching version evidence
```

Initial anti-duplication pressure:

```text
likely specialization of F164 / K4-K8 crash-consistent governed knowledge mutation evidence
```

Do not allocate until exact equivalence is checked.

### E3. External extraction occurrence lineage

`extractFromDocument()` returns/emits a transient extraction result and logs only a summarized AI execution record. The result shape has optional `sourceId`, but no observed stable extraction-occurrence/revision identifier in the service contract.

This is the current primary frontier.

Question:

```text
When extraction creates or mutates material Contract/Invoice/Contact/Expense/etc. state,
what durable object proves:
- exact source document identity/revision,
- exact extraction occurrence/model,
- exact asserted values/source spans/confidence,
- review/promotion decision,
- downstream domain effect lineage?
```

Do not allocate before tracing each material consumer and checking KF-REC-049 / existing provenance findings.

---

## F. Current cross-domain reachability

`extractFromDocument()` is load-bearing across multiple domains, making J12 a high-leverage frontier:

```text
external/upload/Drive/device/expense/payment-evidence sources
→ DocumentIntelligence
→ transient extraction
→ domain-specific consumer/promotion
→ Contacts / Invoice / Contract / other state
```

This is why J12 was selected ahead of narrower remaining first-pass gaps.

---

## G. Current value-density classification

### Core value primitives

- stable source document identity;
- exact document revision/source revision identity;
- evidence/assertion provenance;
- exact review/approval/promotion binding;
- correction/supersession/deletion lineage.

### Necessary domain specialization

- generated-document section/template/profile semantics;
- OCR/parser representation;
- invoice/contract/contact-specific extraction schemas;
- domain-specific promotion policy.

### Derived projections

- current generated DocumentSection content;
- parsed markdown/tables;
- extraction summaries;
- health/readiness/UI projections.

### Accidental complexity pressure

- multiple document representations without explicit identity/ownership mapping;
- mutable current content diverging from version approval evidence;
- transient extraction feeding durable domain state without yet-proven durable extraction lineage.

---

## H. Current anti-duplication ledger

```text
manual inline edit approved through stale version → F161 / KF-REC-049 specialization
AI tweak partial mutation vs version evidence      → check F164 before allocation
contract extraction promotion                     → F216/C166 + KF-REC-055 domain manifestation
contract accepted revision linkage                → KF-REC-055
operator review/attention                         → KF-REC-051
recovery                                           → KF-REC-048
temporal occurrence mechanics                     → KF-REC-047
```

Current canonical ranges remain:

```text
F001–F218
C001–C168
KF-REC-001–KF-REC-055
next free F219 / C169 / KF-REC-056
```

---

## I. Exact next trace

```text
1. enumerate all material callers/consumers of DocumentIntelligence extraction;
2. trace source identity/revision supplied by upload, Drive, Asset, DocumentInstance and device paths;
3. trace which consumers persist extraction evidence versus only final domain state;
4. test repeat/reprocess/correction identity and duplicate descendant behaviour;
5. trace generated DocumentVersion/updateSection/tweak/status transaction and approval semantics;
6. classify each seam through F161/F164/F165/KF-REC-049 before new allocation;
7. cross-link J12 with J11/J7/J13/J14/J19/J23;
8. keep production code read-only.
```
