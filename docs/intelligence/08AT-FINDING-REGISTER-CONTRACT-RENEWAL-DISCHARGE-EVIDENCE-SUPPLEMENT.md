# KeyFlowOS Finding Register — Contract Renewal Discharge Evidence Supplement

Status: CANONICAL CONTINUATION — J11 CONTRACT / OBLIGATION / RENEWAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F217 — Renewal obligations can be discharged by an ordinary Contract edit because submitted lifecycle status is treated as renewal-decision evidence without proving a status transition or renewal occurrence

**Status:** VERIFIED END-TO-END / OBLIGATION-DISCHARGE INTEGRITY FINDING

The server has a desirable bidirectional renewal pattern:

```text
ContractRenewalSweep
→ WORK_OBLIGATION_RAISED
→ CommandItem(CONTRACT_RENEWAL)

Contract decision later resolves
→ WORK_OBLIGATION_SETTLED
→ obligation completed/discharged
```

The defect is the settlement predicate.

`ContractsService.updateContract()` always passes the DTO status into:

```text
settleRenewalIfResolved(businessId, contractId, dto.status)
```

The helper does not compare prior state with new state and does not require a renewal-decision occurrence. Any supplied status in:

```text
ACTIVE | EXPIRED | TERMINATED | ARCHIVED
```

is treated as sufficient evidence to emit:

```text
WORK_OBLIGATION_SETTLED
sourceModule = contracts
sourceType   = contract
sourceId     = contractId
actionType   = CONTRACT_RENEWAL
```

The web Contract edit form makes this materially reachable. Edit state is initialized from the current Contract and `submit()` sends the whole form object. `handleSave()` then passes that full object to `updateContract()`.

Therefore an existing ACTIVE contract can follow:

```text
renewal obligation is OPEN
→ user opens Edit
→ changes title / notes / party / another unrelated field
→ form resubmits status = ACTIVE
→ server receives dto.status = ACTIVE
→ WORK_OBLIGATION_SETTLED
→ CommandItem renewal obligation becomes COMPLETED
```

No renewal decision, renewal-cycle identity, renewalDate change, accepted renewal document, termination instruction or other decision evidence is required.

The server comment says "Only a status change settles it. Editing the title does not," but the implementation checks only whether a status value is present, not whether it changed. The standard UI supplies that value during ordinary edits.

### Additional semantic contradiction

`ContractRenewalSweep` simultaneously treats `ACTIVE` as a **renewable status** eligible to raise renewal work.

Thus the same state value can mean:

```text
ACTIVE supplied to updateContract
→ renewal decision is resolved
```

while:

```text
ACTIVE observed by daily renewal sweep
→ renewal decision may be outstanding and should be raised
```

This makes `ACTIVE` alone incapable of carrying the claimed discharge meaning.

A later sweep may also recreate/refresh the same five-tuple after a false settlement, but because the obligation listener deliberately preserves terminal disposition on re-raise, the row may remain completed. That recurrence consequence composes with the existing J23 Definition != Occurrence law rather than creating a second J11 root.

### Canonical distinction

```text
ContractLifecycleState
!= RenewalDecisionOccurrence
!= RenewalDecisionEvidence
!= RenewalObligationDisposition
```

and:

```text
DTO CONTAINS status=ACTIVE
!= status transitioned
!= renewal decision occurred
!= renewal obligation was discharged
```

### Why F217 is distinct

- F182 concerns source-derived operator work lacking reverse convergence after source resolution. F217 has a reverse convergence path, but its predicate can fire when the source obligation is **not** resolved.
- F180 concerns an operator projection terminalizing itself without source/effect proof. F217 originates in the authoritative Contract mutation path and falsely emits source-side discharge evidence.
- F197/F205 concern customer lifecycle ownership/algebra, not contract renewal occurrence/discharge.
- KF-REC-053 supplies the broader rule that lifecycle/obligation transitions require qualifying evidence and policy provenance; F217 is the concrete J11 false-discharge implementation root.
- KF-REC-047 supplies occurrence identity; KF-REC-051 owns the resulting operator projection; neither should infer the missing renewal decision on behalf of Contracts.

### Target law

For each renewal cycle:

```text
RenewalOccurrenceId
+ authoritative Contract revision
+ explicit decision/disposition evidence
+ policy/version where material
→ RenewalDecision
→ obligation settlement for that exact occurrence
```

A lifecycle status may be one input to that decision policy, but mere presence of the field in a PATCH is never sufficient evidence.

Possible decision evidence may include, depending on product policy:

```text
renewed / accepted new term
terminated / non-renewed
explicit lapse decision
replacement contract/revision
verified provider/legal outcome
manual decision with actor + effective time
```

The exact workflow/UI is not frozen.

### Architectural pressure

Do not solve this by moving renewal truth into CommandItem. Contracts remains the source-domain owner of renewal facts/decisions; CommandItem remains a derived operator-work projection under KF-REC-051.

Compose with:

```text
KF-REC-047 → renewal occurrence identity / temporal projection
KF-REC-049 → evidence/provenance where extracted knowledge contributes
KF-REC-051 → operator attention and disposition
KF-REC-053 → obligation/evidence transition discipline
F215       → authoritative Contract revision identity
F216       → extraction promotion gate
```

Affected kernels: K6, K7, K8, K4, K11.
Affected journeys: J11, J17, J23, J18, J12.

No production implementation is authorized by this supplement.
