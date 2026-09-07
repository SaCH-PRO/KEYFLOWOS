# KeyFlowOS Contradiction Register — Contract Revision & Epistemic Integrity Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C165 — a contract registry that exposes numbered versions contradicts its own revision semantics when principal mutations are unversioned and recorded versions cannot reconstruct historical state

The contract domain exposes `ContractVersion` as visible history, yet:

- manual authenticated PATCH can materially mutate the Contract with no version row;
- the controller does not pass the modifying actor into the update service;
- existing version rows contain metadata, not an exact snapshot/diff/field lineage;
- AI extraction can replace terms/parties/current fields while only a summary/file metadata row identifies the resulting version.

Therefore:

```text
ContractVersion N
!= proof of the exact authoritative Contract state at revision N
```

and version count does not equal material mutation count.

Target resolution:

```text
material Contract mutation
→ one semantic ContractRevision
→ reconstructable state/delta + actor/source/evidence lineage
→ atomic current projection/revision relationship
```

Affected finding: F215.
Affected kernels: K4, K6, K8, K7, K3.
Affected journeys: J11, J12, J17, J18, J23.

---

## C166 — probabilistic document extraction contradicts evidence-aware contract truth by allowing inferred values to become authoritative renewal/value/party state without a promotion gate

`DocumentIntelligenceService` returns explicit confidence, but the contract application path does not require a confidence threshold, verification state or governance decision before writing inferred values into `Contract`.

Those fields are then consumed operationally, including by the renewal sweep.

Thus:

```text
AI extraction / assertion evidence
is treated as
accepted authoritative Contract truth
```

without a contract-specific policy proving the inference may control future obligations.

This contradicts KeyFlow's existing evidence/governance direction and the more cautious invoice-extraction seam, where confidence and auto-approval are checked before domain creation.

Target resolution:

```text
extracted assertion
→ provenance/confidence/conflict state
→ policy/verification/governance gate
→ accepted ContractRevision OR unresolved evidence
```

Affected finding: F216.
Affected kernels: K4, K8, K6, K3, K7.
Affected journeys: J11, J12, J17, J18, J23.

No production implementation is authorized by this contradiction supplement.
