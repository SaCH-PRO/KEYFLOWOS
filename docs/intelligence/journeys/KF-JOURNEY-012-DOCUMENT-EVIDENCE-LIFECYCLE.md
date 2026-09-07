# KF-JOURNEY-012 — Document / Evidence Lifecycle

Status: **PROVISIONALLY CONVERGED / TARGET-ALIGNED THROUGH F221/C171/KF-REC-056**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.
Runtime proof has **NOT** been executed.

## A. Definition

J12 models how KeyFlowOS creates, imports, parses, extracts, versions, reviews, approves, corrects, retains, deletes and reuses documents/evidence across domains.

Core question:

> What is the stable identity of a document and each document revision, what is observed evidence versus AI inference, which exact revision was reviewed/approved/consumed, and how do downstream domain truths remain attributable when a document is corrected, replaced, superseded, deleted or reprocessed?

## B. Canonical target chain

```text
SOURCE OBJECT
→ stable object/document identity
→ exact source/document revision
→ parse/normalization artifact
→ extraction/assertion occurrence
→ provenance/model/confidence/source spans
→ EvidenceAdmissionDecision where material
→ ingestion/domain decision/effect
→ lineage back to exact evidence revision
→ correction/supersession/disposition convergence
```

Critical separation:

```text
DOCUMENT / EXTERNAL OBJECT IDENTITY
!= SOURCE / DOCUMENT REVISION
!= EXTRACTION / ASSERTION OCCURRENCE
!= QUALIFYING EVIDENCE
!= EVIDENCE ADMISSION DECISION
!= INGESTION OCCURRENCE
!= DOWNSTREAM DOMAIN TRUTH
!= REVIEW / APPROVAL DISPOSITION
!= DOCUMENT DISPOSITION DECISION
```

## C. Canonical roots

### F219/C169 — evidence admission

Transient document extraction/raw-text assertions can become successful payment evidence without explicit consumer-specific evidence admission.

Canonical law:

> An extracted document assertion must not become qualifying evidence merely because it is parseable or carries a confidence score. Material promotion must be explicit, consumer-specific, provenance-bearing and revision-bound.

Homes: `08AV` / `09AV`.

### F220/C170 — source revision / ingestion occurrence

Google Drive recognizes a newer source revision by `driveFileId + modifiedTime`, but canonical ingestion deduplicates only by stable object identity and can suppress R2 as duplicate R1.

Canonical law:

> Stable external object identity must not be used as the sole occurrence identity when that object can acquire materially new revisions.

Homes: `08AW` / `09AW`.

### F221/C171 — destructive document disposition

Mounted `DocumentInstance` hard delete can destroy `DocumentVersion` approval/history and `ReviewTask` evidence and detach surviving `DocumentChangeLog` history without an explicit disposition decision.

Canonical law:

> Destructive deletion of versioned/reviewed evidence must be a governed disposition decision, not an incidental parent-row delete.

Homes: `08AX` / `09AX`.

## D. Reuse / non-allocation decisions

```text
manual DocumentSection edit approved through stale version → F161 / KF-REC-049
Device reviewed-state reprocess                            → F161 / KF-REC-049
AI tweak mutation before version evidence                  → F164 / KF-REC-049
Drive import replacement without new version               → F161 + F164 pressure
stale descendants after corrected/withdrawn evidence       → F178/C128 + KF-REC-049
contract extraction promotion                              → F216/C166 + KF-REC-055
payment evidence replay                                    → KF-REC-048
Expense extraction/edit/submit                              → explicit human admission seam; provenance pressure only
direct AI document processing                              → extraction-only boundary
Drive new revision suppressed by object-id dedupe          → F220/C170 + KF-REC-035 reuse
DocumentInstance hard-delete proof destruction             → F221/C171 + J19 pressure
```

No F222/C172 was required during correction/supersession tracing, standards pressure testing or backward re-audit.

## E. Target recommendation

`KF-REC-056 — Document Evidence & Revision Integrity Contract`

Home:
`10O-RECOMMENDATION-REGISTER-DOCUMENT-EVIDENCE-REVISION-INTEGRITY-CONTINUATION.md`

KF-REC-056 owns only:

```text
DocumentEvidenceReference
EvidenceAdmissionDecision
SourceRevisionOccurrence binding at document/evidence boundary
DocumentDispositionDecision
```

Delegates:

```text
generic provenance / revision / verification / correction → KF-REC-049
ingress occurrence processing                               → KF-REC-035
same-occurrence retry / recovery / effect identity          → KF-REC-048
operator review / attention                                 → KF-REC-051
financial truth / evidence strength                         → KF-REC-052
contract-specific accepted revision / retention             → KF-REC-055
privacy / legal retention / erasure policy                  → J19
```

Explicit non-goals:

- no universal EDMS;
- no universal event store;
- no second provenance/revision engine;
- no second ingress runtime;
- no second recovery/idempotency engine;
- no second financial-truth system;
- no second contract lifecycle system;
- no global privacy/legal retention rules engine.

## F. Positive seams to preserve

- `DocumentInstance` / `DocumentVersion`;
- `DocumentChangeLog` / `ReviewTask`;
- `MediaAsset` / `VisualIntake` / `ExtractedEntity`;
- Drive `modifiedTime` source-change detection;
- DocumentIntelligence confidence/provenance inputs;
- Expense editable human-submit seam;
- mature K4, J14, J18, J7, J11 and J17 contracts.

## G. Assurance artifacts

Consumer/revision trace:
`investigations/J12-DOCUMENT-INTELLIGENCE-CONSUMER-REVISION-LINEAGE-TRACE.md`

Correction/supersession pre-pooling gate:
`investigations/J12-CORRECTION-SUPERSESSION-PRE-POOLING-CONVERGENCE-TRACE.md`

Standards/frontier pressure test:
`investigations/J12-DOCUMENT-EVIDENCE-LIFECYCLE-STANDARDS-FRONTIER-PRESSURE-TEST.md`

Backward re-audit:
`investigations/J12-J16-J14-J18-J7-J11-J19-J17-DOCUMENT-EVIDENCE-INTEGRITY-BACKWARD-REAUDIT.md`

## H. Backward re-audit verdict

```text
KF-REC-056 invalidated                            = NO
parallel Business Knowledge/provenance system    = NO
parallel ingress runtime                         = NO
parallel recovery/idempotency system             = NO
parallel financial-truth system                  = NO
parallel contract lifecycle/retention system     = NO
parallel operator-attention system               = NO
parallel privacy/legal rules engine               = NO
universal EDMS required                          = NO
second document engine required                  = NO
new finding/contradiction from re-audit          = NO
J12 target provisionally converged               = YES
runtime proof executed                           = NO
production implementation authorized             = NO
```

## I. Canonical ranges at convergence

```text
Findings:         F001–F221
Contradictions:   C001–C171
Recommendations: KF-REC-001–KF-REC-056
Concepts:         KF-CONCEPT-001–KF-CONCEPT-042
Next free:        F222 / C172 / KF-REC-057
```

## J. Reopen conditions

J12 remains reopenable if:

- J19 privacy/deletion convergence changes disposition requirements;
- migration design exposes a conflicting owner;
- runtime/concurrency/fault testing invalidates current identity/admission assumptions;
- later journeys prove additional cross-domain document/evidence semantics are irreducible.

Do not convert KF-REC-056 into an implementation packet merely because J12 target synthesis is complete.
