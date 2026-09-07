# Finding Register Supplement — J12 Document Source Revision / Ingestion Occurrence Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## F220 — Google Drive object identity is used as ingestion-occurrence identity, causing legitimate modified file revisions to be suppressed as duplicates

### Owner

- Primary journey: `KF-JOURNEY-012 — Document / Evidence Lifecycle`
- Primary kernels: K8 Evidence & Outcome, K9 Integration & External Reality
- Adjacent journeys/kernels: J13 Connector Lifecycle, J14 External Event Ingress, J18 Recovery, J23 Temporal Flow, K4 Business Knowledge, K7 Temporal/Event, K11 Recovery

### Reachable implementation chain

`ConnectorIntelligenceService.syncGoogleDrive()` correctly detects that the same Drive file has materially changed by comparing `driveFileId + modifiedTime`.

```text
same driveFileId
+ newer modifiedTime
→ recognized as changed source revision
→ same DriveIntakeFile reset and re-extracted
→ ingestion.item.received emitted
   externalId = driveFileId
```

The emitted ingestion input does not carry the `modifiedTime` revision coordinate that caused the source to be reprocessed.

`IngestionListener` forwards the item to `IngestionOrchestrator.receive()`.

When `externalId` is present, `receive()` deduplicates using:

```text
businessId + sourceType + externalId
```

For Google Drive this means:

```text
businessId + google_drive + driveFileId
```

If an earlier ingestion item exists, the orchestrator logs the item as duplicate and returns it without rebuilding the plan.

### Failure topology

```text
Drive file revision R1
→ driveFileId D, modifiedTime T1
→ extraction E1
→ IngestionItem I1
→ plan P1

same Drive file is legitimately edited
→ driveFileId D, modifiedTime T2 > T1
→ connector correctly recognizes new revision R2
→ downloads new bytes
→ extraction E2
→ emits ingestion input with externalId D
→ IngestionOrchestrator finds I1 by D
→ "Duplicate ingestion item skipped"
→ R2 receives no distinct ingestion occurrence / rebuilt plan
```

The system therefore collapses:

```text
EXTERNAL OBJECT IDENTITY
!= EXTERNAL SOURCE REVISION IDENTITY
!= INGESTION OCCURRENCE IDENTITY
!= EXTRACTION OCCURRENCE IDENTITY
```

into one `externalId` coordinate at the dedupe boundary.

### Material consequence

A legitimate source correction/update can be re-extracted in the connector intake layer while the canonical ingestion layer continues to expose the prior occurrence/plan as though nothing new happened. Downstream review, proposed actions, approval/execution and evidence lineage can therefore remain attributable to R1 while current mutable intake/extraction state represents R2.

This is a **distinct-occurrence suppression** defect, not a duplicate-delivery replay defect.

### Canonical law

> Stable external object identity must not be used as the sole ingestion-occurrence identity when that object can acquire materially new revisions. A new source revision that changes interpretation or actionable evidence must be representable as a new source/ingestion occurrence while preserving lineage to the same external object.

A target identity may be represented by provider-native revision/version IDs or a stable derived revision fingerprint, for example:

```text
ExternalObjectId
+ ExternalRevisionId / modifiedTime / content fingerprint
→ SourceRevisionOccurrenceId
→ ExtractionOccurrenceId
→ IngestionOccurrenceId
→ consumer plan/review/effect lineage
```

Exact physical representation is not frozen by this finding.

### Anti-duplication verdict

`RELATED DISTINCT` — allocate F220.

#### Not F127 / C080

F127/C080 concern **one already-identified occurrence** whose first-seen dedupe suppresses recovery after downstream failure:

```text
same occurrence
→ claimed/seen
→ processing fails
→ replay cannot resume
```

F220 concerns **two legitimately distinct source revisions** being treated as one occurrence:

```text
revision R1 != revision R2
→ same external object id
→ R2 incorrectly classified as duplicate R1
```

These are inverse cardinality failures and require different proof.

#### Relationship to KF-REC-035 / J14

KF-REC-035 supplies the mature narrow ingress-occurrence target law and required distinction between provider/source identity and occurrence identity. F220 **reuses that contract direction**; it does not create a second IngressOccurrence runtime.

The J14 dossier already states that external occurrence identity must survive into downstream consequences and that object/delivery/occurrence identities must remain distinct. F220 is the first canonical root in the current pool proving the opposite error for a mutable pull-based document source: stable object ID is over-deduped across distinct revisions.

#### Relationship to KF-REC-049

KF-REC-049 requires revision-aware knowledge/provenance and prevents overwriting material revisions without lineage. It explains why preserving R1/R2 matters epistemically, but it does not own the ingestion dedupe decision that suppresses R2 as an occurrence.

#### Relationship to KF-REC-048

KF-REC-048 owns retry/replay and semantic effect identity for the **same** work/effect. F220 is not a retry of the same semantic occurrence; it is failure to admit a new occurrence.

### Positive seam to preserve

`ConnectorIntelligenceService.syncGoogleDrive()` already detects newer `modifiedTime` and intentionally resets the intake for reprocessing. The target should carry that source-revision identity through the downstream ingestion boundary rather than replace the connector architecture.

### Proof obligations for eventual implementation

- unchanged Drive revision is deduped/reused as one occurrence;
- a newer materially changed Drive revision is admitted as a distinct source/ingestion occurrence;
- both revisions remain linked to the same external object identity;
- extraction/admission/review/plan lineage identifies the exact source revision;
- reprocessing the same revision is replay-safe;
- correction/supersession can identify which downstream plans/effects came from which revision;
- no duplicate consequence occurs merely because the same revision is delivered more than once.

No production implementation is authorized by this finding.
