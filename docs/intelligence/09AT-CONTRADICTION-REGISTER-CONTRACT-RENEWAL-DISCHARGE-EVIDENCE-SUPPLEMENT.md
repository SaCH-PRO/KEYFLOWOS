# KeyFlowOS Contradiction Register — Contract Renewal Discharge Evidence Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C167 — `ACTIVE` is simultaneously treated as evidence that a renewal obligation is resolved and as a status that remains eligible to generate renewal work

The renewal subsystem asserts two incompatible meanings for the same Contract state.

Settlement path:

```text
updateContract(... dto.status = ACTIVE)
→ settleRenewalIfResolved()
→ ACTIVE is in resolved[]
→ WORK_OBLIGATION_SETTLED(CONTRACT_RENEWAL)
```

Sweep path:

```text
ContractRenewalSweep
→ query status in [ACTIVE, RENEWAL_DUE]
→ if renewal notice window open
→ WORK_OBLIGATION_RAISED(CONTRACT_RENEWAL)
```

The standard web edit form resubmits the current status during ordinary edits, so an unchanged ACTIVE status can reach the settlement path without a renewal decision.

Therefore:

```text
ACTIVE
→ may mean renewal decision completed
```

and at the same time:

```text
ACTIVE
→ may mean renewal decision is still upcoming/outstanding
```

These meanings cannot both be inferred from Contract.status alone.

### Canonical contradiction

```text
ContractLifecycleState
!= RenewalDecisionOccurrence
!= RenewalObligationDisposition
```

A renewal obligation may be settled only by evidence that identifies the relevant renewal occurrence and its decision/disposition, not by the mere presence of a lifecycle status field in an update DTO.

### Required resolution pressure

The target must define:

```text
one renewal occurrence identity
+ one authoritative decision/disposition predicate
+ qualifying evidence/provenance
→ settle exactly that occurrence
```

`ACTIVE`, `TERMINATED`, `EXPIRED`, etc. may participate in the policy but must not independently claim that a specific renewal decision occurred.

Composes with KF-REC-047, KF-REC-051 and KF-REC-053; does not move contract truth into the operator projection.

No production implementation is authorized by this contradiction.
