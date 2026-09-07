# Contradiction Register Supplement — J12 Document Source Revision / Ingestion Occurrence Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## C170 — Connector intake recognizes a new Drive file revision while canonical ingestion classifies it as the already-seen occurrence

### Contradiction

The Google Drive connector explicitly treats a newer `modifiedTime` for the same `driveFileId` as a changed source that must be downloaded, re-extracted and reprocessed.

Yet the downstream ingestion boundary deduplicates solely by:

```text
businessId + sourceType + externalId
```

where `externalId = driveFileId`.

Thus the same system simultaneously asserts:

```text
connector layer:
R2 is new enough to reprocess

canonical ingestion layer:
R2 is the same occurrence as R1 and should be skipped
```

The source revision coordinate that establishes `R2 != R1` is not preserved into the dedupe identity that decides whether a new ingestion occurrence exists.

### Semantic contradiction

```text
EXTERNAL OBJECT IDENTITY = same Drive file

but

SOURCE REVISION R1 != SOURCE REVISION R2

therefore

INGESTION OCCURRENCE FOR R1
!= INGESTION OCCURRENCE FOR R2
```

Current behavior instead makes object identity act as occurrence identity.

### Consequence

The connector's mutable current extraction can advance to R2 while the canonical `IngestionItem` and its plan/review/execution lineage remain the prior R1 occurrence. This creates split temporal/evidentiary truth between current source interpretation and downstream ingestion state.

### Canonical pairing

- Finding: `F220`
- Contradiction: `C170`
- Primary journey: J12 Document / Evidence Lifecycle
- Primary kernels: K8 Evidence & Outcome, K9 Integration & External Reality
- Reuse: J14/KF-REC-035 occurrence semantics; KF-REC-049 revision/provenance; KF-REC-048 replay/effect identity

### Anti-duplication note

This is not C080. C080 concerns one occurrence that cannot resume after failure. C170 concerns a genuinely later source revision that is incorrectly collapsed into the prior occurrence before processing begins.

No production implementation is authorized by this contradiction.
