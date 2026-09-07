# KF-JOURNEY-012 — Document / Evidence Lifecycle

Status: **ACTIVE MICROSCOPIC FORENSICS / PAYMENT-EVIDENCE ADMISSION ROOT ALLOCATED F219/C169 / CONTINUING CROSS-DOMAIN EXTRACTION TRACE**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.
Runtime proof has **NOT** been executed.

## A. Definition

J12 models how KeyFlowOS creates, imports, parses, extracts, versions, reviews, approves, corrects, retains, deletes and reuses documents/evidence across domains.

Core question:

> What is the stable identity of a document and each document revision, what is observed evidence versus AI inference, which exact revision was reviewed/approved/consumed, and how do downstream domain truths remain attributable when a document is corrected, replaced, superseded, deleted or reprocessed?

Primary kernels: K4 Business Knowledge, K6 State Transition, K7 Temporal/Event, K8 Evidence/Outcome, K11 Recovery/Reliability.
Adjacent journeys: J11 Contract/Renewal, J7 Financial Truth, J14 External Event Ingress, J13 Connector Lifecycle, J16 Business Genome, J17 Operator Attention, J18 Recovery, J19 Privacy/Deletion, J23 Temporal Flow.

---

## B. Current architecture split

J12 spans at least two materially different document systems.

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

These systems must not be assumed to share one canonical document/revision/evidence identity merely because both use the word "document".

---

## C. Target chain under investigation

```text
SOURCE OBJECT / generated document
→ stable Document identity
→ exact DocumentRevision / source revision
→ parse/normalization artifact where applicable
→ extraction/assertion occurrence
→ source spans / evidence / model provenance / confidence
→ review/verification/promotion/admission policy
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
!= VERIFIED / QUALIFYING EVIDENCE
!= EVIDENCE ADMISSION DECISION
!= DOWNSTREAM DOMAIN TRUTH
!= CURRENT MUTABLE PROJECTION
!= APPROVAL / REVIEW DISPOSITION
```

---

## D. Positive seams to preserve

### D1. Generated documents already have explicit DocumentVersion

`generateDocument()` creates initial current sections and a version snapshot. `tweakDocument()` creates a later `DocumentVersion` after AI edits.

### D2. Generated documents retain change/review concepts

DocumentInstance can include change logs and review tasks. High-risk generated documents can create a pending generation review.

### D3. Document intelligence preserves confidence in transient extraction output

Invoice/contact/contract extraction result types carry confidence, and some domain-processing paths apply explicit confidence/governance thresholds.

These seams should be strengthened rather than replaced with a universal document runtime.

---

## E. Microscopic findings / anti-duplication

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

No new J12 root for this manifestation.

### E2. AI tweak mutation/version crash boundary

`tweakDocument()` mutates sections one by one and logs changes before creating the new DocumentVersion and updating `currentVersionNum`. No shared transaction is visible across those operations.

Potential failure:

```text
section mutation succeeds
→ version creation/currentVersionNum update fails
→ current document changed without matching version evidence
```

Current anti-duplication pressure:

```text
LIKELY SPECIALIZATION → F164 / K4-K8 crash-consistent governed knowledge mutation evidence
```

Exact equivalence still requires closure before any new allocation.

### E3. External extraction occurrence lineage

`extractFromDocument()` returns/emits a transient extraction result and logs only a summarized AI execution record. The result shape has optional `sourceId`, but no stable extraction-occurrence/revision identifier has yet been observed in the service contract.

Open cross-domain question:

```text
When extraction creates or mutates material Contract/Invoice/Contact/Expense/etc. state,
what durable object proves:
- exact source document identity/revision,
- exact extraction occurrence/model,
- exact asserted values/source spans/confidence,
- review/promotion/admission decision,
- downstream domain effect lineage?
```

Continue consumer-by-consumer tracing; do not collapse all manifestations into F219 automatically.

### E4. F219 / C169 — payment-evidence admission boundary

Reachable path:

```text
authenticated commerce payment-evidence request
→ CommerceController
→ PaymentEvidenceService.processEvidence()
→ DocumentIntelligenceService.extractFromDocument(...)
   OR raw-text fallback
→ transient payment-like assertion
→ no observed consumer-specific evidence-admission / verification threshold
→ CommerceService.recordPayment(...)
→ Payment SUCCESSFUL
→ Invoice paidAmount/status mutation
→ revenue/ledger reconciliation
```

The raw-text fallback can explicitly return `confidence: 0.3`, yet no observed confidence/verification/governance gate intervenes before `recordPayment()`.

Canonical allocation:

```text
F219 — transient document assertions can become successful payment evidence without an explicit evidence-admission decision
C169 — payment-evidence semantics imply qualifying evidence while the reachable path accepts an unverified transient document assertion as a successful payment
```

Homes:

```text
08AV-FINDING-REGISTER-DOCUMENT-EVIDENCE-PROMOTION-INTEGRITY-SUPPLEMENT.md
09AV-CONTRADICTION-REGISTER-DOCUMENT-EVIDENCE-PROMOTION-INTEGRITY-SUPPLEMENT.md
```

Canonical law:

> An extracted document assertion must not become qualifying payment-completion evidence merely because it contains parseable payment-like fields. Promotion must be explicit, consumer-specific, provenance-bearing, revision-bound and evidence-strength-aware.

Anti-duplication verdict:

```text
RELATED DISTINCT → F219/C169
```

Delegation boundary:

```text
generic provenance / epistemic eligibility → KF-REC-049
financial claim strength / valuation        → KF-REC-052
retry/replay/effect identity                → KF-REC-048
J12/K8 owns                                → document/evidence admission boundary
```

No universal document runtime is implied.

### E5. Same payment evidence replay — no F220

`PaymentEvidenceService.processEvidence()` supplies no stable semantic evidence-effect identity to `recordPayment()`. `recordPayment()` creates a fresh random manual `providerPaymentId`; while an Invoice remains non-terminal, repeated processing can create another `SUCCESSFUL` Payment and additional financial consequences from the same semantic evidence.

Anti-duplication verdict:

```text
SPECIALIZATION → J18 / KF-REC-048
NO F220 allocation from this seam
```

J18 already requires:

```text
retry same work → same WorkOccurrenceId + EffectId
new execution attempt → new AttemptId
successful effect evidence → prevents duplicate effect
```

The payment manifestation strengthens the recovery/effect-identity contract; it does not justify a second idempotency architecture.

---

## F. Cross-domain reachability

`extractFromDocument()` is load-bearing across multiple domains:

```text
external/upload/Drive/device/expense/payment-evidence sources
→ DocumentIntelligence
→ transient extraction/assertion
→ domain-specific consumer/admission/promotion
→ Contacts / Invoice / Contract / Expense / other state
```

This cross-domain leverage remains the reason J12 is the active frontier.

---

## G. Current value-density classification

### Core value primitives

- stable source document identity;
- exact document/source revision identity;
- extraction/assertion occurrence identity;
- evidence/assertion provenance;
- exact review/verification/admission/promotion binding;
- downstream-effect lineage;
- correction/supersession/deletion lineage.

### Necessary domain specialization

- generated-document section/template/profile semantics;
- OCR/parser representation;
- invoice/contract/contact/expense-specific extraction schemas;
- consumer-specific evidence admission/promotion policy.

### Derived projections

- current generated DocumentSection content;
- parsed markdown/tables;
- extraction summaries;
- health/readiness/UI projections.

### Accidental complexity pressure

- multiple document representations without explicit identity/ownership mapping;
- mutable current content diverging from version approval evidence;
- transient extraction feeding durable domain state without durable extraction/admission lineage;
- downstream financial effects from assertions stronger than their observed admission evidence.

---

## H. Current anti-duplication ledger

```text
manual inline edit approved through stale version       → F161 / KF-REC-049 specialization
AI tweak partial mutation vs version evidence           → check F164 before allocation
contract extraction promotion                           → F216/C166 + KF-REC-055 domain manifestation
contract accepted revision linkage                      → KF-REC-055
payment evidence admission                              → F219/C169 J12/K8; delegates KF-REC-049/052
same payment evidence replay / fresh payment identity   → KF-REC-048 specialization; NO F220
operator review/attention                               → KF-REC-051
recovery                                                → KF-REC-048
temporal occurrence mechanics                           → KF-REC-047
```

Current canonical ranges:

```text
F001–F219
C001–C169
KF-REC-001–KF-REC-055
KF-CONCEPT-001–KF-CONCEPT-042
next free F220 / C170 / KF-REC-056
```

No J12 recommendation is allocated yet.

---

## I. Exact next trace

```text
1. enumerate and trace every material DocumentIntelligence consumer still unclosed;
2. trace stable source identity + exact source revision from upload, Drive, Asset, Device and Expense paths;
3. determine which consumers persist extraction/assertion evidence versus only final domain state;
4. trace correction/reprocess/replacement/supersession identity and descendant invalidation;
5. close E2 against F164 exactly before any allocation;
6. test whether additional admission failures reuse F219 or expose a genuinely different owner;
7. cross-link J12 with J11/J7/J13/J14/J19/J23 and K4/K8/K9/K10/K11;
8. pool stable roots before considering KF-REC-056;
9. do not allocate KF-REC-056 merely because F219 exists;
10. keep production code read-only and do not claim runtime proof.
```
