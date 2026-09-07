# KF-JOURNEY-012 — Document / Evidence Lifecycle

Status: **ACTIVE MICROSCOPIC FORENSICS / F219-C169 EVIDENCE ADMISSION + F220-C170 SOURCE-REVISION OCCURRENCE + F221-C171 DESTRUCTIVE DISPOSITION ROOTS / PRE-POOLING TRACE**
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

Generation creates version 1. AI tweak can create later `DocumentVersion`. Approval can mark a stored version approved.

### B2. External-document extraction / DocumentIntelligence

`DocumentIntelligenceService.extractFromDocument()` accepts source material plus optional external/source identity, parses/extracts, returns a transient `DocumentExtractionResult`, logs an AI summary, emits `document.extracted`, and lets consumers materialize consequences.

Known consumers include Contracts, payment evidence, AI upload, Device intake, Expenses, Drive/Connector intelligence and KEY/Flow orchestration.

These systems must not be assumed to share one canonical identity model merely because both use the word document.

## C. Target chain under investigation

```text
SOURCE OBJECT
→ stable object/document identity
→ exact source/document revision
→ parse/normalization artifact
→ extraction/assertion occurrence
→ provenance/model/confidence/source spans
→ review/verification/admission/promotion
→ ingestion/domain decision/effect
→ lineage back to exact evidence revision
→ correction/supersession/archive/destruction convergence
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
!= DOCUMENT DISPOSITION DECISION
```

## D. Positive seams to preserve

1. Generated documents already have explicit `DocumentVersion` snapshots.
2. Generated documents retain `ReviewTask` and `DocumentChangeLog` concepts.
3. Document intelligence preserves confidence in transient extraction output.
4. Device intake has stable `MediaAsset`/`VisualIntake` identity plus PROPOSED vs ACCEPTED/REJECTED seams.
5. Google Drive sync already detects changed source revisions via `driveFileId + modifiedTime`.
6. Expense receipt extraction prefills editable fields and still requires explicit human submit.
7. Direct AI document processing returns extraction output without direct domain mutation at that controller boundary.

The target should strengthen these seams rather than create a universal document runtime or EDMS.

## E. Microscopic findings / anti-duplication

### E1. Manual inline edit versus approved version

`updateSection()` mutates current `DocumentSection` without creating `DocumentVersion` or incrementing `currentVersionNum`; later APPROVED marks the latest stored version.

Verdict:

```text
SPECIALIZATION → F161 / KF-REC-049
```

No new root.

### E2. AI tweak mutation/version crash boundary

`tweakDocument()` mutates sections and logs each change before creating the new `DocumentVersion` and incrementing `currentVersionNum`, with no shared transaction across those operations.

Verdict after exact comparison:

```text
SPECIALIZATION → F164 / KF-REC-049
NO new root
```

F164 already owns crash-consistent authoritative knowledge mutation plus matching evidence/revision state.

### E3. Drive import replacing current document without a new version

`importBodyFromDrive()` transactionally deletes all current sections and creates one imported-body section, but does not create a `DocumentVersion` or increment `currentVersionNum`; its change log is written after the transaction.

Verdict:

```text
revision/approval mismatch → F161 / KF-REC-049
post-mutation evidence crash boundary → F164 / KF-REC-049
NO new root
```

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

Homes: `08AV` / `09AV`.

Delegation:

```text
generic provenance / epistemic eligibility → KF-REC-049
financial claim strength                   → KF-REC-052
retry/replay/effect identity               → KF-REC-048
J12/K8 owns                                → evidence admission boundary
```

### E5. Same payment evidence replay

Same semantic evidence can receive fresh random payment identity while invoice remains non-terminal.

Verdict:

```text
SPECIALIZATION → J18 / KF-REC-048
NO new root
```

### E6. F220/C170 — external object identity collapses a genuinely new source revision at ingestion

Drive sync recognizes a newer `modifiedTime` for the same `driveFileId`, re-extracts it, then emits ingestion with `externalId = driveFileId` but without the source-revision coordinate.

`IngestionOrchestrator.receive()` deduplicates by `businessId + sourceType + externalId`, so legitimate revision R2 is returned as existing R1 and its plan is not rebuilt.

Canonical law:

> Stable external object identity must not be used as the sole ingestion-occurrence identity when that object can acquire materially new revisions.

Homes: `08AW` / `09AW`.

Anti-duplication:

```text
F127/C080 = SAME occurrence cannot resume after failure
F220/C170 = DISTINCT revision wrongly collapsed into prior occurrence
```

F220 reuses J14/KF-REC-035 occurrence semantics, KF-REC-049 revision/provenance and KF-REC-048 same-occurrence replay/effect identity.

### E7. Device reviewed-state reprocessing

Mounted `processCapture` has no observed guard against reprocessing an ACCEPTED/REJECTED intake. Reprocess overwrites extracted payload/confidence, resets intake/entity statuses to PROCESSED/PROPOSED, and can leave prior reviewer metadata on the mutable intake coordinate.

Verdict:

```text
SPECIALIZATION → F161 / KF-REC-049
NO F221 from Device
```

Review belongs to an exact assertion revision, not to a mutable intake coordinate.

### E8. Expense receipt extraction → Expense creation

Expense extraction only returns a transient result. Web UI uses it to prefill editable description/amount/vendor/date fields; user must explicitly submit. `createExpense()` then creates the business record and, by default, treats it as `PAID` and posts it transactionally.

Current verdict:

```text
explicit human admission seam exists → NOT F219
extraction provenance/admission lineage not persisted → KF-REC-049 / KF-REC-052 pressure
NO new root yet
```

### E9. Direct AI document processing endpoint

`POST /ai/businesses/:businessId/agent/documents/process` validates source content and returns `DocumentIntelligence.extractFromDocument()` output. No direct domain write occurs in this controller path.

Verdict:

```text
EXTRACTION-ONLY / ADVISORY BOUNDARY
NO new root
```

Downstream consumers still require their own evidence-admission policy.

### E10. F221/C171 — destructive disposition of versioned/reviewed document evidence

`DocumentsModule` is imported by `AppModule`; therefore the controller is mounted despite a dormant/UI-feature-gated comment.

Reachable API:

```text
DELETE /documents/businesses/:businessId/instances/:instanceId
→ DocumentsService.deleteInstance()
→ documentInstance.delete()
```

No observed status/approval/review/archive/retention/disposition guard precedes deletion.

Canonical Prisma relations prove:

```text
DocumentVersion.instance   → onDelete: Cascade
DocumentSection.instance   → onDelete: Cascade
ReviewTask.instance        → onDelete: Cascade
DocumentChangeLog.instance → onDelete: SetNull
```

Therefore deleting a `DocumentInstance` can erase version-level approval/history and review evidence and detach surviving change logs from the document they described.

Canonical law:

> Destructive deletion of a versioned/reviewed document must be a governed disposition decision, not an incidental parent-row delete. Enough lineage must survive to explain which exact revisions were reviewed/approved/relied upon and why archive, supersession or destruction was permitted.

Homes: `08AX` / `09AX`.

Anti-duplication:

```text
F218/C168 = Contract-specific retention semantics ignored by Contract hard delete
F221/C171 = generated document's own version/review proof destroyed or detached by generic hard delete
F178/C128 = corrected/withdrawn source truth leaves derived descendants active
```

F221 delegates generic privacy/retention/erasure policy to J19 and revision/provenance mechanics to KF-REC-049. It does not create a second privacy ontology or EDMS.

## F. Consumer tranche status

Detailed trace:
`investigations/J12-DOCUMENT-INTELLIGENCE-CONSUMER-REVISION-LINEAGE-TRACE.md`

| Consumer | Current classification |
|---|---|
| PaymentEvidence | F219/C169 |
| Expenses receipt flow | explicit editable human submit; provenance pressure only |
| Flow attachment | prompt/context consumer; KF-REC-049 boundary |
| Device intake | F161/KF-REC-049 specialization |
| Google Drive intake | F220/C170 |
| Contracts | F216/C166 + KF-REC-055 |
| Direct AI upload | extraction-only boundary |
| Generated DocumentInstance deletion | F221/C171 |

## G. Value-density classification

### Core value primitives
- stable document/external-object identity;
- exact source/document revision identity;
- extraction/assertion occurrence identity;
- evidence provenance;
- exact admission/review/promotion binding;
- source-revision ingestion occurrence identity;
- downstream-effect lineage;
- correction/supersession/disposition lineage.

### Necessary specialization
- generated-document sections/templates;
- OCR/parser representation;
- domain-specific extraction schemas;
- consumer-specific evidence admission policy;
- provider/source-specific revision coordinates.

### Derived projections
- current `DocumentSection`;
- parsed markdown/tables;
- current `DriveIntakeFile` extraction;
- extraction summaries/health projections.

### Accidental complexity pressure
- mutable current content diverging from stored/approved revision;
- transient assertions feeding durable state without admission lineage;
- stable external object IDs overloading revision/occurrence identity;
- destructive parent deletion erasing or severing revision/review evidence.

## H. Current anti-duplication ledger

```text
manual inline edit approved through stale version       → F161 / KF-REC-049
Device reviewed-state reprocess                         → F161 / KF-REC-049
AI tweak mutation vs version evidence                   → F164 / KF-REC-049
Drive import replacement without new version            → F161 + F164 pressure
contract extraction promotion                           → F216/C166 + KF-REC-055
payment evidence admission                              → F219/C169
payment evidence replay                                 → KF-REC-048
Drive new revision suppressed by externalId-only dedupe → F220/C170 + KF-REC-035 reuse
Expense human submit after extraction                   → no root; KF-REC-049/052 pressure
Direct AI upload                                        → extraction-only; no root
DocumentInstance destructive delete                     → F221/C171 + J19 pressure
```

Canonical ranges:

```text
F001–F221
C001–C171
KF-REC-001–KF-REC-055
KF-CONCEPT-001–KF-CONCEPT-042
next free F222 / C172 / KF-REC-056
```

No J12 recommendation is allocated yet.

## I. Exact next trace / convergence gate

```text
1. finish correction/supersession dependency trace: what downstream effects remain after source revision correction or destructive disposition;
2. test whether F178 already owns any resulting stale-descendant behavior before F222/C172;
3. update the consumer trace with direct upload, Expense, F164 reuse and F221;
4. assess whether F219–F221 plus reused F161/F164/F178/KF-REC-035/048/049/052 are sufficient for one bounded J12 target contract;
5. only if roots are stable, perform standards/frontier pressure test before allocating KF-REC-056;
6. keep production code read-only and do not claim runtime proof.
```
