# Contradiction Register Supplement — J12 Document Destructive Disposition Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## C171 — Generated documents are modeled as versioned/reviewed/approvable evidence while the mounted delete path can erase that proof lineage as an ordinary parent-row delete

### Contradiction

The generated-document subsystem models durable lifecycle/evidence concepts:

```text
DocumentVersion
approvalStatus / approvedAt
ReviewTask
DocumentChangeLog
DocumentInstance status including archive semantics
```

Yet the mounted delete route delegates directly to `documentInstance.delete()` without an observed disposition/retention/approval guard.

The schema then causes:

```text
DocumentVersion → CASCADE DELETE
DocumentSection → CASCADE DELETE
ReviewTask      → CASCADE DELETE
DocumentChangeLog → instanceId SET NULL
```

Thus the system simultaneously represents exact revision/review/approval history as meaningful evidence and allows that evidence to be destroyed or detached without a durable document-disposition decision.

### Semantic contradiction

```text
VERSIONED / REVIEWED / APPROVED DOCUMENT EVIDENCE
implies
revision-specific proof survives as needed to explain the document lifecycle

but

GENERIC HARD DELETE
can
remove version/review proof + sever surviving change history from its document
```

### Canonical pairing

- Finding: `F221`
- Contradiction: `C171`
- Primary journey: J12 Document / Evidence Lifecycle
- Primary kernel: K8 Evidence & Outcome
- Adjacent pressure: J19 Privacy / Deletion / Exit
- Reuse/delegation: KF-REC-049 revision/provenance; J19 generic retention/privacy policy when converged

### Anti-duplication note

This is not C168/F218. F218/C168 depends on Contract-specific retention semantics being non-load-bearing at hard delete. C171 concerns the generated-document evidence model itself: even without a Contract retention field, version/review/approval proof can be destroyed or detached through a mounted generic delete path.

This is also not F178/C128. F178 concerns corrected/withdrawn source truth whose derived descendants remain active. C171 concerns physical destruction/severance of the source document's own evidence history.

No production implementation is authorized by this contradiction.
