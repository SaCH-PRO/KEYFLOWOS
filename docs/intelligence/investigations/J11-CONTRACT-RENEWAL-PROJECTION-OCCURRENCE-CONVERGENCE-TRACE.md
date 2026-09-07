# J11 — Contract Renewal Projection / Occurrence / Convergence Trace

Status: MICROSCOPIC TRACE — CANONICAL SUPPORTING EVIDENCE
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED

## Purpose

Trace the lifecycle from Contract renewal state into both local ContractAlert projection and canonical operator obligation work, then test acknowledgement, settlement, deletion and later recurrence.

This trace allocates **no new finding or contradiction IDs**. It records J11 manifestations of existing canonical laws.

---

## 1. Local ContractAlert path

```text
createContract / updateContract / applyExtractionResult
→ regenerateAlerts(businessId, contractId)
→ compute alert facts from current expiryDate / renewalDate
→ deleteMany({ contractId })
→ createMany(recomputed ContractAlert rows)
```

Operator action:

```text
Contracts UI
→ acknowledgeContractAlert(...)
→ ContractsService.acknowledgeAlert(...)
→ acknowledgedAt / acknowledgedBy persisted on ContractAlert row
```

Later regeneration:

```text
same semantic alert condition still exists
→ prior row deleted
→ new row created
→ prior acknowledgement evidence absent
```

### Classification

`SPECIALIZATION of F182 / KF-REC-051`

Reason: stable operator-projection identity and persistent user disposition are already owned by the Operator Attention & Priority Contract. J11 exposes a concrete delete/recreate implementation that violates that law.

No F217/C167 allocation.

---

## 2. Canonical renewal-obligation path

```text
ContractRenewalSweep @ daily 07:00
→ find Contract where renewalDate <= horizon and status ACTIVE|RENEWAL_DUE
→ apply contract-specific noticeDays window
→ emit WORK_OBLIGATION_RAISED
```

Identity emitted:

```text
businessId
+ sourceModule=contracts
+ sourceType=contract
+ sourceId=contract.id
+ actionType=CONTRACT_RENEWAL
```

Materialization:

```text
ObligationListener.onRaised()
→ CommandItem.upsert(five-tuple)
→ create kind=OBLIGATION,status=OPEN
→ on repeat raise update FACTS ONLY
→ status/completedAt/dismissedAt/dischargedAt intentionally preserved
```

This is a positive seam for duplicate emission idempotency and disposition preservation.

---

## 3. Same-occurrence duplicate versus next-occurrence recurrence

The listener deliberately implements:

```text
repeat raise of same five-tuple
→ refresh due/title/value/etc.
→ DO NOT reopen terminal user disposition
```

That is correct when the same renewal occurrence is emitted repeatedly by:

- daily sweep;
- multiple replicas;
- retry/replay.

But the Contract renewal producer does not include a renewal-cycle/occurrence identity. A later genuine renewal cycle for the same Contract emits the same five-tuple.

Reachable sequence:

```text
Cycle N renewal enters notice window
→ five-tuple obligation OPEN
→ business decides / Contract status update
→ WORK_OBLIGATION_SETTLED
→ same CommandItem COMPLETED + dischargedAt

Contract remains/re-enters ACTIVE with a later renewalDate
→ Cycle N+1 enters notice window
→ sweep emits same five-tuple
→ upsert finds prior COMPLETED CommandItem
→ updates facts only
→ status remains COMPLETED
→ new renewal occurrence is not admitted as new actionable work
```

The existing unit test proves duplicate sweeps intentionally emit the same sourceId/actionType and rely on listener dedupe; it does not test a later renewal cycle.

### Classification

`SAME / SPECIALIZATION of mature J23 temporal Definition != Occurrence law and KF-REC-047`

This is not a new contract-specific architecture root.

Target distinction:

```text
CONTRACT / RENEWAL DEFINITION IDENTITY
!= RENEWAL WORK OCCURRENCE IDENTITY
```

Desired behaviour:

```text
same occurrence retry/replay
→ converge on same WorkOccurrence / disposition

next semantic renewal cycle
→ new WorkOccurrence identity
→ independently actionable/dischargeable
→ lineage back to same Contract definition/revision
```

No F217/C167 allocation.

---

## 4. Status-update settlement path

`ContractsService.updateContract()` calls `settleRenewalIfResolved()` after regeneration.

For status values:

```text
ACTIVE
EXPIRED
TERMINATED
ARCHIVED
```

it emits:

```text
WORK_OBLIGATION_SETTLED
sourceModule=contracts
sourceType=contract
sourceId=<contract id>
actionType=CONTRACT_RENEWAL
```

`ObligationListener.onSettled()` converges the matching CommandItem to COMPLETED/discharged.

Positive seam:

```text
source resolution
→ explicit reverse convergence event
→ durable operator work settlement
```

Open semantic question: `ACTIVE` is overloaded as a settlement signal even though it can mean either "renewal decision completed" or simply "contract currently active". The status vocabulary alone may not prove which renewal occurrence was discharged. Do not allocate a finding until the later recurrence/transition semantics are fully traced.

---

## 5. Hard-delete asymmetry

`ContractsService.deleteContract()`:

```text
find Contract by businessId/id
→ prisma.contract.delete({ id })
→ return { deleted: true }
```

No matching `WORK_OBLIGATION_SETTLED` event is emitted.

The Contract database lineage includes `ON DELETE CASCADE` for Contract-owned descendants including `contract_versions` and `contract_alerts`.

The independently materialized CommandItem obligation is identified by scalar source metadata, not a Contract foreign-key ownership relation.

Therefore:

```text
renewal obligation OPEN
→ Contract hard delete
→ Contract source disappears
→ Contract-owned alert/version history cascades
→ CommandItem can survive
→ no settlement/cancellation/supersession event
→ operator work can remain actionable with no source record
```

### Classification

Two existing owners:

```text
orphan operator work
→ SPECIALIZATION of F182 / KF-REC-051

loss of Contract revision/history on destructive lifecycle mutation
→ STRENGTHENING of F215/C165
```

No new ID.

Target law:

```text
SOURCE DESTRUCTION / WITHDRAWAL
→ explicit lifecycle revision/tombstone where evidence retention requires it
→ explicit derived-work convergence
→ KEEP | SETTLE | CANCEL | SUPERSEDE | REDERIVE
→ history preserved according to retention policy
```

Deletion itself is not proof that an obligation was discharged.

---

## 6. Two renewal-attention representations

Current architecture contains both:

```text
ContractAlert
→ local contracts module projection
→ acknowledgedAt / acknowledgedBy
→ Contracts page + contract stats
```

and:

```text
CommandItem(kind=OBLIGATION, actionType=CONTRACT_RENEWAL)
→ canonical operator-work projection
→ disposition / due / value / priority / discharge
→ Command/attention ecosystem
```

These are not automatically duplicates:

- an informational expiry warning may be a local derived alert;
- a renewal decision owed by a date is durable operator work.

But overlapping `RENEWAL_DUE` semantics can produce competing attention/disposition unless ownership is explicit.

### Next anti-duplication question

For each ContractAlertType classify:

```text
INFORMATIONAL LOCAL PROJECTION
vs
DURABLE OPERATOR OBLIGATION
vs
TEMPORAL OCCURRENCE PROJECTION
vs
REDUNDANT COMPETING ATTENTION CHANNEL
```

Do not retain two durable disposition systems for the same semantic work occurrence.

---

## 7. Causal graph

```text
source evidence / human edit / AI extraction
→ Contract current projection
→ renewalDate / noticeDays / renewalType / value
        ├─→ regenerateAlerts → ContractAlert → local acknowledgement
        │                        ↑
        │                        └─ delete/recreate can erase disposition
        │
        └─→ daily renewal sweep
             → work.obligation.raised
             → stable CommandItem upsert
             → operator work/disposition
             → Contract decision/status mutation
             → work.obligation.settled
             → CommandItem discharge
```

Recurrence break:

```text
Cycle N discharged
→ later renewalDate for Cycle N+1
→ same five-tuple
→ old terminal CommandItem reused
→ new occurrence can be hidden
```

Deletion break:

```text
open obligation
→ hard-delete Contract
→ source/history disappear
→ obligation may survive without convergence
```

Epistemic upstream pressure:

```text
uncertain AI-extracted renewal fact
→ authoritative Contract projection
→ both alert and obligation systems
→ operator priority/action
```

This composes F216 with J17/J23 rather than creating a new epistemic root.

---

## 8. Anti-duplication verdict table

| J11 manifestation | Canonical owner | Verdict |
|---|---|---|
| ContractAlert acknowledgement lost on regeneration | F182 / KF-REC-051 | SPECIALIZATION |
| Delete source leaves obligation open | F182 / KF-REC-051 | SPECIALIZATION |
| Hard delete destroys Contract revision descendants | F215 / C165 | STRENGTHENING |
| Repeated sweep dedupe | KF-REC-051 positive seam | PRESERVE |
| Next renewal cycle hidden by same five-tuple | J23 / KF-REC-047 | SPECIALIZATION |
| AI inferred renewal state drives work | F216 / C166 + KF-REC-049 | COMPOSITION |

Current allocation remains:

```text
Findings through F216
Contradictions through C166
Recommendations through KF-REC-054
F217 / C167 / KF-REC-055 remain unallocated
```

---

## 9. Exact next trace

1. classify every ContractAlertType against the CommandItem obligation/Temporal Work roles;
2. determine whether the user can see two actionable representations of one renewal occurrence;
3. trace update/extraction/status mutation order when renewalDate changes after an obligation has already been raised;
4. test whether `ACTIVE` as a settlement status can prematurely settle a newly changed/future renewal occurrence;
5. trace retentionPolicy/retentionUntil versus hard-delete capability;
6. trace authorization/audit evidence for delete and material contract mutation;
7. only after these traces, decide whether irreducible J11 semantics justify F217/C167 or KF-REC-055.

No production implementation is authorized by this trace.
