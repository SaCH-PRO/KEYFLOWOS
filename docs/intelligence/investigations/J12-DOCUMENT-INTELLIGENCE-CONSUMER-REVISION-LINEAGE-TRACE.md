# J12 — DocumentIntelligence Consumer / Revision Lineage Trace

Status: ACTIVE INVESTIGATION — CONSUMER TRANCHE CHECKPOINT THROUGH F220/C170
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## Purpose

Continue J12 after F219/C169 by distinguishing:

```text
extraction-only / advisory consumption
!= proposed evidence state
!= accepted/admitted evidence
!= authoritative domain mutation
```

and by tracing whether stable source identity, exact source revision and extraction/assertion occurrence survive reprocessing.

## 1. Expense receipt extraction

Reachable endpoint:

```text
POST expenses/businesses/:businessId/expenses/extract-receipt
→ ExpensesController.extractReceipt()
→ DocumentIntelligenceService.extractFromDocument()
→ return transient extraction result to caller
```

Observed input identity:

```text
source: expense_receipt_upload
url
filename
mimeType hard-coded image/jpeg
```

No direct `Expense` mutation occurs in this endpoint. Expense creation is a separate write surface.

### Classification

```text
EXTRACTION-ONLY RESPONSE / ADVISORY INPUT
not a direct F219-style authoritative promotion path from this endpoint alone
```

Open trace: frontend/client flow may copy returned fields into `createExpense`; if so, determine whether human review/edit is explicit evidence admission or merely UI-mediated automatic promotion.

## 2. Flow / KEY attachment context

`FlowOrchestrator.buildAttachmentContext()`:

```text
FlowAttachment
→ source URL or object-storage bytes
→ DocumentIntelligence.extractFromDocument()
→ rawText / JSON extraction summary
→ ATTACHMENT CONTEXT text
→ model prompt/context
```

When object storage is available, extraction source becomes `att.objectPath`; otherwise URL is used. The extraction request shown here does not supply a stable document revision or extraction occurrence identity.

The immediate consumer is model context, not a direct domain write.

### Classification

```text
MODEL / PROMPT CONTEXT CONSUMER
→ governed by KF-REC-049 consumer-specific epistemic prompt contract
→ not F219 unless a downstream tool/domain write consumes the assertion without its own admission gate
```

Important follow-through: any tool call caused by attachment-derived context must be traced at the tool/domain boundary; prompt inclusion itself must not be mislabeled as authoritative promotion.

## 3. Device / visual intake

Positive identity seam:

```text
MediaAsset stable id
→ VisualIntake stable id
→ ExtractedEntity linked to MediaAsset + VisualIntake
```

Initial deterministic classification creates `ExtractedEntity.status=PROPOSED`.
AI auto-extraction and explicit `processCapture()` call DocumentIntelligence and update the same VisualIntake.

Observed reprocessing behavior:

```text
extract document again
→ overwrite VisualIntake.extractedText
→ overwrite VisualIntake.extractedData
→ overwrite VisualIntake.confidenceScore
→ existing ExtractedEntity.proposedData overwritten
→ ExtractedEntity.status reset/remains PROPOSED
```

No extraction-occurrence/revision history is observed in these writes.

Positive governance seam:

```text
approveIntake() / rejectIntake()
→ VisualIntake ACCEPTED / REJECTED
→ reviewedById + reviewedAt
```

`createContactFromCard()` additionally creates Contact from explicit caller-supplied values, links MediaAsset, updates ExtractedEntity to ACCEPTED and VisualIntake to ACCEPTED.

### Current classification

```text
STABLE SOURCE/INTAKE IDENTITY: POSITIVE
PROPOSED vs ACCEPTED SEPARATION: POSITIVE
EXTRACTION REPROCESS REVISION HISTORY: WEAK / MUTABLE OVERWRITE
```

Anti-duplication pressure:

```text
likely KF-REC-049 revision/provenance specialization
not F219: extraction remains proposed until an acceptance/action seam
```

Open question: if an already ACCEPTED intake is reprocessed, does `runAutoExtraction()` / `processCapture()` overwrite accepted evidence/proposed data and set intake back to PROCESSED without preserving the accepted revision? Trace controller reachability and state guards before allocating anything.

## 4. Google Drive connector intake

`ConnectorIntelligenceService.syncGoogleDrive()` has a strong source-change detection seam:

```text
Drive external file id + modifiedTime
→ if existing.modifiedTime >= incoming.modifiedTime: skip
→ otherwise treat as new revision/change
```

The changed Drive revision is materialized by updating the same `DriveIntakeFile` row keyed by `(businessId, driveFileId)`:

```text
same DriveIntakeFile
→ modifiedTime replaced
→ status reset pending
→ confidence cleared
→ documentType cleared
→ extractedData cleared
→ proposedActions cleared
→ processedAt cleared
```

`processDriveIntakeFile()` then:

```text
download current Drive bytes
→ DocumentIntelligence.extractFromDocument(
     externalId = driveFileId,
     sourceConnector = google_drive
   )
→ overwrite same DriveIntakeFile extractedData/confidence/documentType
→ emit file.uploaded
→ emit ingestion.item.received
```

The event payload carries stable `driveFileId` / `externalId`, extraction result and intakeId, but not the `modifiedTime` revision coordinate that distinguished the source revision.

### Downstream closure

`IngestionListener` forwards `ingestion.item.received` into `IngestionOrchestrator.receive()`.

When `externalId` exists, the orchestrator deduplicates by:

```text
businessId + sourceType + externalId
```

For Drive:

```text
businessId + google_drive + driveFileId
```

If an existing ingestion item is found, the orchestrator logs it as duplicate and returns the existing item without rebuilding the plan.

Therefore:

```text
R1: driveFileId D + modifiedTime T1
→ extraction E1
→ IngestionItem I1 / Plan P1

R2: same D + newer T2
→ connector recognizes changed revision
→ re-extracts E2
→ emits same externalId D
→ ingestion dedupe finds I1
→ "Duplicate ingestion item skipped"
→ no distinct I2 / refreshed plan for R2
```

### Canonical allocation

```text
F220/C170
```

Home:

```text
08AW-FINDING-REGISTER-DOCUMENT-SOURCE-REVISION-OCCURRENCE-SUPPLEMENT.md
09AW-CONTRADICTION-REGISTER-DOCUMENT-SOURCE-REVISION-OCCURRENCE-SUPPLEMENT.md
```

Canonical distinction:

```text
ExternalObjectId
!= ExternalSourceRevisionId
!= ExtractionOccurrenceId
!= IngestionOccurrenceId
```

### Anti-duplication verdict

`RELATED DISTINCT` from F127/C080.

F127/C080:

```text
same occurrence
→ claimed/seen
→ processing later fails
→ replay cannot resume
```

F220/C170:

```text
distinct source revision R2
→ same external object id
→ R2 incorrectly classified as duplicate R1
```

J14/KF-REC-035 already supplies the mature ingress-occurrence target direction and must be reused. KF-REC-049 supplies revision/provenance semantics. F220 does not authorize a second ingress engine.

Positive seam to preserve: Drive sync already detects `modifiedTime` changes. The repair direction is to propagate that revision/occurrence identity through ingestion rather than replace the connector.

## 5. Payment evidence reference point

Canonical:

```text
F219/C169 → document assertion admitted as successful payment evidence without explicit evidence-admission decision
```

Replay/double application remains:

```text
SPECIALIZATION → KF-REC-048
NO new root from payment replay
```

## 6. Current consumer matrix

| Consumer | Immediate role | Stable source identity | Exact source revision | Durable extraction occurrence | Admission/promotion state | Current classification |
|---|---|---|---|---|---|---|
| PaymentEvidence | authoritative payment path | weak/filename/source-level | not proven | not proven | absent before SUCCESSFUL payment | F219/C169 |
| Expenses extract-receipt | extraction response | URL/filename | not proven | not proven | caller-side/open | advisory/extraction-only so far |
| Flow attachment | prompt/model context | URL/objectPath | not proven | not proven | model context only | KF-REC-049 prompt epistemics |
| Device intake | MediaAsset + VisualIntake | yes | not explicit revision object | not observed | PROPOSED/ACCEPTED seams exist | KF-REC-049 pressure; positive seam |
| Google Drive intake | driveFileId | modifiedTime detected | detected upstream but omitted from ingestion identity | not distinct downstream | reviewing/extracted + ingestion plan | F220/C170 |
| Contracts | Contract target/source request | domain-specific | incomplete | incomplete | unsafe contract promotion already known | F216/C166 + KF-REC-055 |

## 7. Current ranges

```text
F001–F220
C001–C170
KF-REC-001–KF-REC-055
next free F221 / C171 / KF-REC-056
```

## 8. Immediate next trace

```text
1. inspect Device controller guards/reprocess reachability, especially after ACCEPTED/REJECTED;
2. trace Expense frontend/client flow from extract-receipt result into createExpense;
3. inspect direct AI upload endpoint as extraction-only vs downstream side-effect surface;
4. close generated Document tweak crash boundary against F164;
5. trace correction/replacement/supersession/deletion lineage across accepted evidence;
6. classify any new seam against F219/F220 + KF-REC-049/035/048 before F221/C171;
7. pool stable J12 roots before considering KF-REC-056.
```
