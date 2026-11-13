# Recommendation Register Continuation — J12 Document Evidence & Revision Integrity

Status: CANONICAL TARGET RECOMMENDATION
Last updated: 2026-09-07
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## KF-REC-056 — Document Evidence & Revision Integrity Contract

### Purpose

Provide one bounded cross-domain contract for the missing J12 semantics proven by:

```text
F219/C169 — evidence admission
F220/C170 — source-revision / ingestion-occurrence identity
F221/C171 — destructive document disposition
```

while reusing mature KeyFlowOS provenance, ingress, recovery, financial, contract and privacy semantics instead of creating a universal document runtime.

## 1. Ownership boundary

KF-REC-056 owns only four irreducible document/evidence boundary semantics.

### 1.1 DocumentEvidenceReference

A material consumer of document-derived evidence must be able to identify:

```text
stable source/document identity
+ exact source/document revision
+ exact extraction/assertion occurrence
+ source/provenance coordinates needed by the consumer
```

This reference is a boundary contract, not a new universal provenance graph.

### 1.2 EvidenceAdmissionDecision

Before a document assertion becomes qualifying evidence for a material downstream claim/effect, the consumer must make or receive an explicit admission decision bound to the exact assertion/evidence revision.

Minimum semantic shape:

```text
consumer / target business object
exact DocumentEvidenceReference
admission predicate / policy version
accepted or rejected asserted values
confidence / provenance relevant to that predicate
authority / reviewer evidence where required
resulting domain-effect identity where material
```

A parseable field or model confidence score alone is not an admission decision.

### 1.3 SourceRevisionOccurrence binding

For mutable external sources:

```text
ExternalObjectId
!= ExternalSourceRevisionId
!= ExtractionOccurrenceId
!= IngestionOccurrenceId
```

A materially new source revision must be representable as a new semantic occurrence while preserving lineage to the same external object. Reprocessing the same revision must still converge through mature ingress/recovery idempotency semantics.

KF-REC-056 defines the boundary identity relationship; it does not own the ingress engine.

### 1.4 DocumentDispositionDecision

Archive, supersede, retire and physical destruction must be distinguishable lifecycle outcomes for versioned/reviewed document evidence.

Before irreversible destruction where evidence has material lifecycle meaning, a disposition decision must determine:

```text
which document/revisions are affected
what approval/review/effect lineage depends on them
whether destruction is permitted
what audit/proof lineage must survive
who/what authorized the disposition
what external/linkage cleanup is required
```

KF-REC-056 does not define universal legal retention periods.

## 2. Delegations — mandatory anti-duplication boundary

KF-REC-056 delegates:

```text
generic provenance / revision / verification / correction → KF-REC-049
ingress occurrence processing and claim mechanics          → KF-REC-035\ same-occurrence retry / recovery / effect identity        → KF-REC-048
operator review / attention / disposition                  → KF-REC-051
financial truth / payment evidence strength / correction   → KF-REC-052
contract-specific accepted revision / retention            → KF-REC-055
privacy / legal retention / erasure policy                 → J19 when converged
```

It must not become a second implementation of any of those systems.

## 3. State algebra

The contract preserves these distinctions:

```text
SOURCE OBJECT
!= SOURCE REVISION
!= PARSED REPRESENTATION
!= EXTRACTION / ASSERTION OCCURRENCE
!= QUALIFYING EVIDENCE
!= EVIDENCE ADMISSION DECISION
!= INGESTION OCCURRENCE
!= DOMAIN TRUTH
!= REVIEW / APPROVAL DISPOSITION
!= DOCUMENT DISPOSITION DECISION
```

And:

```text
REPLAY SAME REVISION
!= ADMIT NEW REVISION

ARCHIVE / RETIRE / SUPERSEDE
!= PHYSICAL DESTRUCTION
```

## 4. Required invariants

### R1 — exact-source invariant

Any material document-derived claim must be attributable to an exact source/document revision and extraction/assertion occurrence, not only a mutable current document coordinate.

### R2 — admission invariant

No document assertion may become qualifying evidence for a material consumer solely because it was parsed/extracted successfully or exceeded a generic confidence threshold.

### R3 — revision-occurrence invariant

A stable external object may produce multiple legitimate source revisions. A materially new revision must not be suppressed as replay of the prior revision.

### R4 — same-revision replay invariant

Repeated processing of the same source revision must converge through the same semantic occurrence/effect identity rather than create duplicate business consequences.

### R5 — review-binding invariant

Review/approval belongs to the exact assertion/document revision reviewed. Reprocessing or replacing content cannot make old review metadata appear to verify the new revision.

### R6 — mutation-evidence invariant

Material document mutation and the revision/evidence state representing that mutation must be crash-consistent through KF-REC-049/F164 semantics.

### R7 — correction/supersession invariant

Correction, withdrawal or supersession must preserve enough lineage to identify dependent materialized descendants and invoke the appropriate KF-REC-049/F178 plus domain-specific correction contract.

### R8 — disposition invariant

Irreversible destruction of versioned/reviewed evidence requires an explicit disposition decision and must not accidentally erase required proof lineage.

## 5. Existing seams to strengthen

Do not replace these positive structures:

```text
DocumentInstance / DocumentVersion
DocumentChangeLog / ReviewTask
MediaAsset / VisualIntake / ExtractedEntity
DriveIntakeFile + modifiedTime change detection
DocumentIntelligence confidence/provenance inputs
Expense editable human-review submit seam
J14 ingress occurrence contract
K4 provenance/revision contract
```

The migration direction should make these structures obey one coherent boundary contract.

## 6. Domain composition examples

### Payment evidence

```text
receipt/source revision
→ extraction occurrence
→ DocumentEvidenceReference
→ PaymentEvidenceAdmissionDecision
→ qualifying PaymentCompletionEvidence
→ KF-REC-052 financial truth
```

### Google Drive

```text
Drive file identity
+ Drive revision identity
→ extraction occurrence
→ J14/KF-REC-035 ingestion occurrence
→ review/admission/plan
```

### Contract extraction

```text
contract source revision
→ extraction/assertion occurrence
→ KF-REC-056 reference/admission boundary
→ KF-REC-055 ContractAssertionPromotion / accepted ContractRevision
```

### Device intake

```text
MediaAsset
→ extraction revision/occurrence
→ PROPOSED assertion
→ exact-revision review
→ accepted/rejected evidence
```

### Destructive disposition

```text
DocumentInstance + revision/review history
→ DocumentDispositionDecision
→ archive / supersede / destroy
→ preserve required lineage
```

## 7. Explicit non-goals

KF-REC-056 is **not**:

- a universal EDMS;
- a universal event store;
- a W3C PROV implementation;
- a second Business Knowledge/provenance engine;
- a second ingress/event runtime;
- a second retry/idempotency engine;
- a second financial-truth system;
- a second contract lifecycle system;
- a global jurisdiction-specific privacy/retention rules engine;
- a requirement to retain every document forever;
- a requirement for one confidence threshold across all consumers.

## 8. Migration / implementation implications — not authorization

An eventual implementation packet should prefer incremental strengthening:

1. make exact source/document revision identity available at DocumentIntelligence boundaries;
2. add durable extraction/assertion occurrence identity where material;
3. carry source revision into ingestion dedupe identity for mutable sources;
4. bind review/approval to exact revisions;
5. make consumer admission explicit for material effects;
6. make destructive disposition distinct from ordinary archive/supersede flows;
7. preserve existing domain-specific consumers and delegate downstream truth semantics.

No implementation is authorized by this recommendation.

## 9. Proof obligations

A future implementation must demonstrate at minimum:

- low-confidence/ambiguous document assertions cannot silently become strong material evidence;
- accepted evidence identifies exact source revision and extraction/assertion occurrence;
- same-revision replay is idempotent;
- new source revision is not suppressed as old occurrence;
- review/approval cannot silently migrate to replaced content;
- mutation and version evidence are crash-consistent;
- correction/supersession can identify dependent descendants;
- physical destruction cannot erase required proof without an explicit permitted disposition;
- cross-domain consumers continue to delegate financial, contract, privacy, operator and recovery semantics to their canonical owners.

## 10. Standards/frontier basis

Pressure test:
`investigations/J12-DOCUMENT-EVIDENCE-LIFECYCLE-STANDARDS-FRONTIER-PRESSURE-TEST.md`

The pressure test validated F219/F220/F221, found no need for F222/C172, and concluded that one bounded J12 target contract is justified while a universal EDMS/runtime is not.

## 11. Convergence gate

Before J12 may be called provisionally converged:

```text
BACKWARD RE-AUDIT
→ J16/K4 provenance/revision
→ J14/K9 ingress occurrence
→ J18/K11 recovery/effect identity
→ J7/K10 financial truth
→ J11/K8 contract accepted revision/retention
→ J19 privacy/deletion pressure
→ J17 operator review/attention
→ generated-document engine
```

The re-audit must confirm KF-REC-056 creates no parallel kernel/runtime and does not invalidate mature recommendations.
