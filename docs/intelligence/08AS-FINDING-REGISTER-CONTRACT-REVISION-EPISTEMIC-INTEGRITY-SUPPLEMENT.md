# KeyFlowOS Finding Register — Contract Revision & Epistemic Integrity Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Code-bearing baseline remains unchanged from the prior forensic tranche.
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F215 — ContractVersion does not provide a reconstructable or complete revision history for the authoritative Contract state

**Status:** VERIFIED REACHABLE REVISION / PROVENANCE FINDING

The contract registry exposes an explicit `ContractVersion` model and returns versions with each contract, but the version record contains only metadata:

```text
versionNumber
changeSummary?
fileName?
fileUrl?
fileAssetId?
createdBy?
createdAt
```

It stores no immutable Contract snapshot, field patch/diff, party snapshot, extracted-term snapshot, source-document revision, prior-value fingerprint, or direct binding to the exact authoritative values represented by that version.

The observed write doors are also asymmetric.

### Creation

`ContractsService.createContract()` transactionally creates the Contract and `ContractVersion(versionNumber=1, changeSummary='Contract created', createdBy=userId)`.

### AI extraction

`applyExtractionResult()` mutates current Contract fields, replaces extracted `ContractTerm` rows, can replace parties, and then creates a new `ContractVersion` metadata row in the same transaction.

### Principal manual PATCH

`ContractsController.update()` calls:

```text
updateContract(businessId, contractId, dto)
```

without carrying the authenticated actor into the service.

`ContractsService.updateContract()` can materially change:

```text
title
contractType
status
effectiveDate
expiryDate
renewalDate
renewalType
renewalNoticeDays
contractValue
currency
jurisdiction
retentionPolicy / retentionUntil
notes
source links
parties
tags
```

but creates **no ContractVersion at all**.

Therefore the visible version list is neither:

1. a complete ledger of authoritative mutations, nor
2. sufficient to reconstruct what any historical contract revision actually said.

A contract may materially change several times while the version count remains unchanged, and even a recorded version does not by itself preserve the state represented by that version.

### Secondary concurrency pressure

`applyExtractionResult()` reads the latest version number before entering its mutation transaction, derives `nextVersion`, and then inserts under a unique `(contractId, versionNumber)` constraint. Concurrent extraction applications can therefore race on the same next number unless a higher-level serialization mechanism exists. This is secondary pressure on the same revision-identity defect, not a separately allocated finding in this tranche.

### Distinction from existing findings

F146/F148 govern **long-lived workflow definition/occurrence provenance**. J11 needs that temporal law for renewals, but `ContractVersion` is not a WorkDefinition occurrence problem.

F161–F178/KF-REC-049 establish revision-specific provenance for business knowledge. F215 is a domain-specific specialization that proves the contract registry itself exposes a revision concept whose current implementation cannot provide complete/reconstructable contract-state lineage.

### Target law

```text
Authoritative Contract state
→ stable ContractRevision identity
→ exact reconstructable state or deterministic reconstructable delta
→ actor/source/evidence provenance
→ business-effective/system-known time where material
→ atomic current-state projection + revision evidence
```

Every material mutation door — manual, AI-derived, imported, API/tool, migration/correction — must either create a new semantic revision or explicitly prove it is non-material metadata.

The target does **not** require event sourcing, immutable whole-row snapshots, or a new universal document database. A snapshot, content-addressed source, deterministic patch chain, or another representation is acceptable if it can prove the same revision semantics.

### Proof pressure

Future proof must demonstrate:

1. every material manual PATCH advances or explicitly binds a contract revision;
2. the modifying principal/source is attributable;
3. a historical revision can be reconstructed exactly enough for business/legal/operational use;
4. party/term/value/date changes cannot disappear from revision history;
5. concurrent revision creation cannot produce ambiguous/duplicate revision numbers;
6. current Contract projection is provably derived from one current semantic revision;
7. corrections preserve history rather than rewriting prior evidence.

Affected kernels: K4, K6, K8, K7, K3.
Affected journeys: J11, J12, J17, J18, J23; adjacent commercial/financial consequences may touch J3/J4/J7.

---

## F216 — AI contract extraction can promote uncertain inferred values into authoritative Contract and renewal state without preserving an epistemic/governance gate

**Status:** VERIFIED REACHABLE AI-EVIDENCE / DOMAIN-TRUTH FINDING

`DocumentIntelligenceService.extractFromDocument()` asks the model to infer contract type, parties, dates, renewal terms, value, currency, jurisdiction and clauses. The result explicitly carries `confidence`.

After successful JSON parsing it emits `document.extracted` regardless of confidence and returns the result.

The explicit contract extraction route then accepts any result satisfying only:

```text
documentType == 'contract'
contractData exists
```

and calls `applyExtractionResult()`.

That method writes inferred values directly into the authoritative `Contract` projection:

```text
contractType
effectiveDate
expiryDate
renewalDate
renewalType
renewalNoticeDays
contractValue
currency
jurisdiction
```

It can also replace Contract parties and extracted terms.

`ContractTerm` rows retain a confidence value, but the promoted top-level Contract fields do not retain field-level confidence, verification state, evidence binding, source span, or a policy decision proving that the inference may become authoritative operational truth.

The mounted `ContractsService` also listens to `document.extracted`; where `sourceId` is supplied it can auto-create or update the linked Contract through the same extraction application path, again with no observed confidence/governance threshold in the contract listener.

This matters beyond display quality. `ContractRenewalSweep` later consumes `renewalDate`, `renewalNoticeDays`, `renewalType`, `contractValue`, currency and party information to raise business obligations. Therefore an inferred document value can become future operational work.

### Positive contrast already present in KeyFlow

The same `DocumentIntelligenceService.processExtractedDocument()` treats invoice creation more cautiously:

```text
invoice confidence > 0.7
→ evaluateAutoApproval(...)
→ create only when auto-approved / explicitly allowed
```

That existing seam proves KeyFlow already has the distinction between extracted evidence and permission to create authoritative/effectful domain state. The contract path does not currently apply an equivalent contract-specific epistemic/governance rule.

### Distinction from F215

F215 concerns **whether authoritative contract revisions are completely/reconstructably recorded**.

F216 concerns **whether uncertain extracted evidence is allowed to become authoritative contract truth at all**.

A perfect revision ledger would still faithfully record a wrong low-confidence AI inference; therefore revision completeness alone does not resolve F216.

### Target law

```text
Document extraction
= assertion / evidence candidate
!= authoritative Contract truth by default
```

Target adaptation should preserve, at the material field/revision level where needed:

```text
source document / source revision
source span or evidence reference
inferred value
confidence / uncertainty
extractor/model provenance
verification/review state
conflict state
policy/governance decision
accepted ContractRevision (if promoted)
```

High-impact extracted fields such as renewal/termination dates, auto-renewal semantics, monetary value, party identity and jurisdiction should require an explicit policy for automatic promotion. Low-confidence or conflicting extraction remains evidence pending review/reconciliation rather than silently replacing current truth.

This should compose with KF-REC-049 revision/epistemic semantics and J12 Document/Evidence lifecycle; it does not justify a second generic knowledge engine.

### Proof pressure

Future proof must demonstrate:

1. low-confidence extraction cannot silently alter authoritative renewal/value/party state;
2. accepted extracted fields retain source/evidence provenance;
3. conflicting extraction does not erase previously verified/current values without an explicit resolution policy;
4. an AI-derived renewal obligation is traceable back to the accepted evidence revision that established its due date/policy;
5. automation/governance policy can distinguish low-risk metadata from high-impact contract terms;
6. correction/re-extraction produces a new revision and preserves prior evidence;
7. manual review/verification is attributable where required.

Affected kernels: K4, K8, K6, K3, K7.
Affected journeys: J11, J12, J17, J23, J18; downstream obligation/value effects can reach J7/J3/J4.

No production implementation is authorized by this supplement.
