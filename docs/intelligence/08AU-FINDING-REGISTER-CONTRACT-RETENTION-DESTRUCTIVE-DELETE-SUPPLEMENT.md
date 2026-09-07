# KeyFlowOS Finding Register — Contract Retention / Destructive Delete Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F218 — Contract retention fields are writable/product-visible but do not constrain the hard-delete path, which cascades Contract-owned evidence/history

**Status:** VERIFIED CROSS-LAYER / RETENTION-INTEGRITY FINDING

The Contract domain persists explicit retention semantics:

```text
retentionPolicy: String?
retentionUntil: DateTime?
```

Both are accepted by the create/update DTOs. `retentionPolicy` is visibly editable in the standard Contracts UI with the label **Retention policy**. `retentionUntil` is accepted at the API/domain boundary even though the inspected standard form does not currently expose a date control for it.

Historical product planning also names a "Retention policy engine and audit trail", which is supporting product-intent evidence only; the live repository remains authoritative for current behaviour.

### Current delete door

`ContractsController.remove()` exposes:

```text
DELETE /contracts/businesses/:businessId/:contractId
```

with the ordinary operations write scope.

`ContractsService.deleteContract()` performs:

```text
find existing Contract
→ prisma.contract.delete({ id: contractId })
→ return { deleted: true }
```

The inspected path does not:

- inspect `retentionPolicy`;
- inspect `retentionUntil`;
- require a retention override/reason;
- distinguish archive/retire from destructive erasure;
- create a ContractRevision/deletion tombstone;
- emit a contract-deletion evidence event;
- preserve the Contract-owned revision/history descendants before deletion.

### Database consequence

The Contract migration declares `ON DELETE CASCADE` from Contract to:

```text
ContractParty
ContractTerm
ContractVersion
ContractAlert
ContractTagOnContract
```

Therefore deleting the Contract destroys, in the same referential action:

```text
party snapshots/associations
extracted term evidence rows
ContractVersion rows
local alert/disposition rows
tag mappings
```

The Contract's source-document IDs are stored as loose source reference columns in the inspected migration; no Contract→source-document foreign keys are declared there. This finding therefore does **not** claim the referenced Asset/BusinessAsset/DocumentInstance/Drive file itself is deleted.

### Reachable contradiction

A Contract can carry a future retention boundary such as:

```text
retentionUntil = 2033-01-01
```

while the same API surface can immediately hard-delete the Contract and its Contract-owned evidentiary descendants today.

Likewise a user can enter a human-readable retention policy in the standard UI without that value participating in deletion eligibility.

### Canonical distinctions

```text
RetentionPolicy
!= descriptive note only when exposed as domain retention state
```

```text
ARCHIVE / RETIRE / SUPERSEDE
!= HARD DELETE
```

```text
source document survives elsewhere
!= Contract registry evidence/history survives
```

### Why F218 is distinct

- F215/C165 concerns incomplete/reconstructability of Contract revision history during ordinary mutation and deletion strengthens its evidence pressure. F218 concerns a separate lifecycle invariant: whether declared retention state constrains destructive erasure at all.
- F182/KF-REC-051 owns orphaned operator-work convergence after source deletion, not retention eligibility or preservation of registry evidence.
- F216 concerns epistemic promotion of extracted assertions, not retention/destruction.
- This finding does not assert a jurisdiction-specific legal retention period or compliance obligation. It asserts only that KeyFlow's own persisted/product-facing retention semantics are currently non-load-bearing at the destructive delete door.

### Target law

A material Contract destruction request should resolve through an explicit retention/deletion policy:

```text
Contract current revision
+ retention policy / retentionUntil
+ lifecycle state
+ evidence/dependency requirements
+ actor/authority
+ reason / override evidence where permitted
→ DELETE_ALLOWED | ARCHIVE_ONLY | RETAIN_UNTIL | HOLD / REVIEW
```

If destructive deletion is permitted:

```text
intent + actor + policy decision + effective time
→ durable deletion/tombstone evidence sufficient for audit/reconstruction policy
→ dependent projections/work converge
→ destructive storage action
```

The exact persistence strategy is not frozen. A tombstone, immutable audit record, archival store, or another bounded design may satisfy the law. Do not infer that every deleted Contract must remain fully queryable forever.

### Product-value pressure

If retention is not intended to be enforceable product semantics, remove/relabel the fields instead of presenting inert governance controls. If it is intended to be enforceable, make the delete/archival lifecycle load-bearing and testable.

Affected kernels: K3, K4, K6, K8, K11.
Affected journeys: J11, J12, J17, J18.

No production implementation is authorized by this supplement.
