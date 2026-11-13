# J11 — Contract Renewal Projection / Occurrence / Convergence Trace

Status: MICROSCOPIC TRACE — CANONICAL SUPPORTING EVIDENCE / RECONCILED THROUGH F218/C168
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED

## Purpose

Trace Contract renewal state into local ContractAlert projection and canonical operator obligation work, then test acknowledgement, correction, settlement, deletion, retention and later recurrence.

---

## 1. Local ContractAlert path

```text
createContract / updateContract / applyExtractionResult
→ regenerateAlerts()
→ compute expiry / renewal alert facts from current Contract
→ delete all old ContractAlert rows
→ create recomputed rows
```

The Contracts UI renders these alerts locally and allows `Ack`, persisting `acknowledgedAt/acknowledgedBy`.

### 1.1 Disposition loss on regeneration

A later regeneration deletes acknowledged rows and recreates the same semantic condition without the prior disposition.

Verdict:

```text
SPECIALIZATION → F182 / KF-REC-051
```

Derived fact recomputation may not erase durable operator disposition if acknowledgement is intended to persist.

### 1.2 Time advancement is write-triggered

EXPIRY_30 / EXPIRY_7 / EXPIRY_1 / EXPIRED are recalculated only when `regenerateAlerts()` runs. Time crossing a threshold does not itself advance the stored local projection.

Verdict:

```text
SPECIALIZATION → J23 / KF-REC-047 temporal materialization law
```

### 1.3 Renewal actionability differs from central obligation

Local `RENEWAL_DUE` is created whenever `renewalDate > now`, independent of `renewalNoticeDays`.

The central renewal obligation only raises once:

```text
now >= renewalDate - renewalNoticeDays
```

Verdict:

```text
RELATED PROJECTION DIVERGENCE → KF-REC-047 + KF-REC-051
NO new ID currently allocated
```

A contextual future renewal date may be useful locally, but it should not be labelled/treated as the same actionable obligation unless the predicates agree.

---

## 2. Canonical renewal-obligation path

```text
ContractRenewalSweep @ daily 07:00
→ Contract status ACTIVE|RENEWAL_DUE
→ renewalDate within 365-day coarse horizon
→ noticeDays eligibility
→ WORK_OBLIGATION_RAISED
```

Current emitted identity:

```text
businessId
+ sourceModule=contracts
+ sourceType=contract
+ sourceId=contract.id
+ actionType=CONTRACT_RENEWAL
```

`ObligationListener` upserts CommandItem on that tuple. Re-raise refreshes facts but intentionally preserves status/disposition.

Positive seam:

```text
same occurrence duplicate/replay
→ same row
→ facts refresh
→ user disposition does not resurrect
```

---

## 3. Same occurrence versus next renewal occurrence

The tuple contains no renewal-cycle identity.

```text
Cycle N → OPEN → decision → COMPLETED
Cycle N+1 → same source/action tuple
→ prior COMPLETED row reused
→ facts update but terminal disposition remains
```

Verdict:

```text
SPECIALIZATION → J23 Definition != Occurrence / KF-REC-047
```

No duplicate J11 finding is allocated for this recurrence law.

---

## 4. F217/C167 — false settlement from lifecycle-status presence

`updateContract()` calls:

```text
settleRenewalIfResolved(businessId, contractId, dto.status)
```

and treats:

```text
ACTIVE | EXPIRED | TERMINATED | ARCHIVED
```

as sufficient to emit `WORK_OBLIGATION_SETTLED`.

The standard UI edit form is initialized from the current Contract and submits the whole form, including unchanged status.

Reachable path:

```text
ACTIVE contract + OPEN renewal obligation
→ edit notes/title/etc.
→ unchanged status=ACTIVE resubmitted
→ WORK_OBLIGATION_SETTLED
→ renewal work COMPLETED without renewal decision
```

At the same time `ContractRenewalSweep` scans `ACTIVE` contracts to raise renewal work.

Canonical allocation:

```text
F217 — false renewal discharge from generic Contract edit
C167 — ACTIVE means both renewal-resolved and renewal-eligible depending on path
```

Law:

```text
ContractLifecycleState
!= RenewalDecisionOccurrence
!= RenewalDecisionEvidence
!= RenewalObligationDisposition
```

---

## 5. Renewal-date / notice correction after work is raised

The obligation upsert can refresh `dueAt`, title, value and other facts when the sweep re-emits the same tuple.

That is useful when the same occurrence's factual details are corrected while it remains actionable.

But if a correction moves the renewal date or notice window so the previously raised obligation is no longer actionable:

```text
old occurrence/work is OPEN
→ Contract renewalDate/notice changes outside current action window
→ updateContract regenerates local alerts
→ no source-side cancellation/supersession of existing renewal obligation
→ later sweep emits nothing while outside window
→ prior CommandItem may remain OPEN
```

Verdict:

```text
SPECIALIZATION → F182 / KF-REC-051 reverse convergence
```

If the date change represents a genuinely new renewal cycle rather than correction of the same occurrence, occurrence identity delegates to J23/KF-REC-047.

---

## 6. Hard-delete / retention asymmetry

`deleteContract()` hard-deletes without consulting `retentionPolicy` or `retentionUntil` and without an observed deletion revision/tombstone.

Database cascades Contract-owned:

```text
ContractParty
ContractTerm
ContractVersion
ContractAlert
ContractTagOnContract
```

The inspected migration does not declare Contract foreign keys to source Asset/BusinessAsset/DocumentInstance/Drive objects; source-document deletion is therefore not claimed.

Canonical allocation:

```text
F218 — persisted/product-facing retention state is non-load-bearing at hard delete
C168 — declared retention semantics conflict with unconditional destructive deletion
```

Separately, an already-raised CommandItem may survive deletion because deletion emits no obligation settle/cancel/supersede event:

```text
orphan operator work → F182 / KF-REC-051 specialization
```

---

## 7. Writer inventory / symmetry

### Authoritative create/update/delete owners

Primary authoritative write ownership is concentrated in `ContractsService`:

```text
manual UI/API create → createContract()
KEY contracts_create → createContract(... KEY_SYSTEM_ACTOR_ID)
manual UI/API update → updateContract()
KEY contracts_update → updateContract()
explicit document extraction → applyExtractionResult()
document.extracted listener → create Contract if needed + applyExtractionResult()
manual UI/API delete → deleteContract()
KEY contracts_delete → deleteContract()
```

`ContractClauseService` separately writes `Contract.clauseAnalysis`, but its own documentation classifies zero-shot clause extraction as advisory, human-review output. Repository search found no independent consumer of persisted `clauseAnalysis` outside that extractor. Current classification:

```text
DERIVED / ADVISORY PROJECTION
not authoritative ContractRevision truth by itself
persistence value-density remains questionable
```

### Revision asymmetry

```text
createContract → ContractVersion v1
applyExtractionResult → ContractVersion metadata row
updateContract manual/KEY → no ContractVersion
ContractClause advisory projection → no ContractVersion, acceptable if kept explicitly derived
hard delete → ContractVersion history cascades away
```

This strengthens F215; no new root required.

### KEY deletion evidence contradiction

The `contracts_delete` tool description itself says:

```text
Prefer TERMINATED or ARCHIVED — a contract that existed is a fact about the business, and the register is evidence.
```

and the tool is classified high risk / tier 3, yet its execution handler delegates directly to the unconditional `deleteContract()` path. This strengthens F218/C168 rather than creating another root.

---

## 8. Explicit renewal-decision capability search

Repository search did not reveal a distinct first-class product action such as:

```text
RENEW
NON_RENEW
LAPSE
ACCEPT_RENEWAL
REJECT_RENEWAL
```

The standard product surface exposes generic Contract editing/status selection instead.

Current interpretation:

```text
absence of explicit decision artifact
+ generic status-as-settlement shortcut
→ already captured by F217/C167
```

Do not allocate another finding merely for the absence of a dedicated button/command unless later evidence proves a separate semantic failure.

---

## 9. Attention-role classification

```text
ContractAlert
→ LOCAL CONTEXTUAL DERIVED PROJECTION
→ useful for contract-detail awareness
```

```text
RenewalOccurrence + CommandItem obligation
→ DURABLE OWED WORK / CENTRAL OPERATOR ATTENTION
```

Target pressure:

- do not create a second canonical obligation spine from ContractAlert;
- derive local informational warnings cheaply where possible;
- if local acknowledgement is durable product state, preserve semantic identity/disposition;
- use the canonical obligation occurrence for due/actionable renewal work;
- distinguish future visibility from actionability in naming/UI.

---

## 10. Anti-duplication verdict table

| J11 manifestation | Canonical owner | Verdict |
|---|---|---|
| Contract revision incompleteness | F215/C165 | CANONICAL J11 ROOT |
| uncertain extraction promoted to truth | F216/C166 | CANONICAL J11 ROOT |
| false renewal discharge via status presence | F217/C167 | CANONICAL J11 ROOT |
| retention ignored at hard delete | F218/C168 | CANONICAL J11 ROOT |
| alert acknowledgement lost on regeneration | F182 / KF-REC-051 | SPECIALIZATION |
| source deletion leaves obligation open | F182 / KF-REC-051 | SPECIALIZATION |
| date correction makes prior work stale | F182 / KF-REC-051 | SPECIALIZATION |
| next renewal cycle hidden by same tuple | J23 / KF-REC-047 | SPECIALIZATION |
| alert thresholds do not advance with time | J23 / KF-REC-047 | SPECIALIZATION |
| local renewal alert vs obligation timing | KF-REC-047/051 | RELATED PROJECTION DIVERGENCE |
| advisory clauseAnalysis direct write | derived projection | NO REVISION ROOT; VALUE-DENSITY REVIEW |

Current canonical ranges:

```text
Findings through F218
Contradictions through C168
Recommendations through KF-REC-054
Next free F219 / C169 / KF-REC-055
```

No production implementation is authorized.
