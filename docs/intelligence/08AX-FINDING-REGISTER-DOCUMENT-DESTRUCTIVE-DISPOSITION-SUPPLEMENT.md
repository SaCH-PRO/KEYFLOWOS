# Finding Register Supplement — J12 Document Destructive Disposition Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## F221 — Mounted DocumentInstance hard delete can destroy version/approval/review evidence and detach surviving change history without a document-disposition decision

### Owner

- Primary journey: `KF-JOURNEY-012 — Document / Evidence Lifecycle`
- Primary kernel: K8 Evidence & Outcome
- Adjacent journey/kernel: J19 Privacy / Deletion / Exit; K4 Business Knowledge; K3 Governance

### Reachable implementation path

`DocumentsModule` is imported by `AppModule`, so the controller is mounted even though its source is marked as a dormant/UI-feature-gated surface.

Reachable API:

```text
DELETE /documents/businesses/:businessId/instances/:instanceId
→ AuthGuard + BusinessGuard
→ DocumentsService.deleteInstance()
→ documentInstance.delete({ id })
```

`deleteInstance()` performs no observed check of:

```text
DocumentInstance.status
approval state
DocumentVersion approval evidence
pending/resolved ReviewTask state
archive eligibility
retention/disposition policy
external Drive linkage
whether the document has been sent/relied upon
```

### Database consequence

The canonical Prisma schema proves:

```text
DocumentVersion.instance    → onDelete: Cascade
DocumentSection.instance    → onDelete: Cascade
ReviewTask.instance         → onDelete: Cascade
DocumentChangeLog.instance  → onDelete: SetNull
```

Therefore hard deletion can:

```text
DocumentInstance deleted
→ DocumentVersion rows deleted
   including version-level approvalStatus / approvedAt evidence
→ DocumentSection rows deleted
→ ReviewTask rows deleted
→ DocumentChangeLog rows survive only with instanceId = null
```

The surviving change log can therefore lose the document coordinate required to reconstruct which document the history described, while stronger revision/review evidence disappears entirely.

### Why this is material

The generated-document system explicitly models:

```text
version history
review tasks
approval state
ARCHIVED status semantics elsewhere in the service
change history
Drive linkage
```

Those structures imply that a document can carry durable evidentiary/lifecycle meaning beyond its current mutable content. A generic hard delete of the parent can destroy or sever that proof lineage without a durable decision establishing that destructive disposition is permitted and what evidence must survive.

### Canonical law

> Destructive deletion of a versioned/reviewed document must be a governed disposition decision, not an incidental parent-row delete. The system must preserve enough lineage to explain which exact revisions were approved/reviewed/relied upon and why destruction, archival, anonymization or detachment was permitted.

The target does **not** require permanent retention of every document. It requires explicit separation of:

```text
ARCHIVE / RETIRE / SUPERSEDE
!= USER-VISIBLE DELETE
!= PHYSICAL DESTRUCTION
!= LEGALLY/OPERATIONALLY REQUIRED EVIDENCE RETENTION
```

### Anti-duplication verdict

`RELATED DISTINCT` — allocate F221.

#### Relationship to F218/C168

F218/C168 is contract-domain specific:

```text
Contract exposes retention semantics
→ hard delete ignores those retention semantics
→ Contract-owned evidence/history can be erased
```

F221 concerns the generated DocumentInstance evidence model itself:

```text
versioned / reviewed / approved document
→ mounted hard delete
→ revision/review proof destroyed or detached
```

No Contract retention field is required for the contradiction to exist. The semantic owner is document/evidence disposition, not Contract lifecycle.

#### Relationship to F178/C128 / J19

F178/C128 concerns fine-grained correction/withdrawal where derived knowledge remains semantically active after source truth changes. F221 concerns the opposite physical/evidentiary failure: the source document's own revision/review proof can be destroyed or detached.

J19 supplies the broader privacy/retention/disposition pressure lens and should own generic deletion/retention policy when that journey converges. F221 should be cross-linked into J19 rather than creating a second privacy ontology.

#### Relationship to KF-REC-049

KF-REC-049 supplies revision/provenance semantics: exact revisions and verification evidence must remain attributable. F221 is the destructive-disposition boundary that can make those semantics unreconstructable.

### Positive seams to preserve

- `DocumentInstance.status` can represent lifecycle states including `ARCHIVED` in current service logic.
- `DocumentVersion` already carries version and approval evidence.
- `ReviewTask` already carries explicit review disposition.
- `DocumentChangeLog` already provides mutation history.

The target should make destructive disposition respect these existing seams rather than replace them with a universal EDMS.

### Proof obligations for eventual implementation

- an approved/reviewed version cannot be physically destroyed merely by invoking a generic delete route without an explicit permitted disposition;
- archive/retire/supersede is distinguishable from physical destruction;
- retained audit/revision evidence remains attributable to the exact document/revision after any permitted destructive action;
- required external/linkage cleanup is explicit rather than accidental;
- business/user erasure requirements can still be satisfied under a documented retention/privacy policy;
- deletion authorization and the disposition reason/principal are durable where required.

No production implementation is authorized by this finding.
