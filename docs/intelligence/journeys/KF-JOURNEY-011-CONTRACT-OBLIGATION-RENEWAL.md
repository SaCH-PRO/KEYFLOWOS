# KF-JOURNEY-011 — Contract / Obligation / Renewal

Status: **ACTIVE MICROSCOPIC FORENSICS / THROUGH F216/C166 / CROSS-KERNEL CONVERGENCE IN PROGRESS**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J11 models how KeyFlowOS turns contract evidence and human/AI-authored contract state into durable business obligations, renewal decisions, operator attention and later convergence.

Core question:

> What makes a contract fact authoritative, which revision did an obligation derive from, what identifies each renewal occurrence, what work is actually owed, and how do correction, acknowledgement, settlement, termination, archival and deletion converge without losing evidence or resurrecting stale work?

Primary kernels: K4 Business Knowledge, K6 State Transition, K7 Temporal/Workflow, K8 Evidence/Outcome, K11 Recovery/Reliability.
Adjacent journeys: J12 document/evidence, J23 temporal recurrence/work, J18 recovery, J17 operator attention, J7 valuation, J3/J4 commercial obligations.

---

## B. Target product chain

```text
source document / human entry / API / KEY action
→ assertion/evidence candidate
→ verification / governance / conflict handling where needed
→ authoritative ContractRevision
→ current Contract projection
→ renewal/termination terms + business-effective dates
→ renewal occurrence identity
→ work.obligation.raised
→ durable operator work projection
→ acknowledge / snooze / assign / decide
→ source-domain resolution / renewal / termination / expiry
→ work.obligation.settled / superseded / cancelled
→ retained history + later recurrence
```

Critical separation:

```text
DOCUMENT ASSERTION
!= AUTHORITATIVE CONTRACT TRUTH
!= RENEWAL OCCURRENCE
!= OPERATOR ALERT
!= BUSINESS OBLIGATION
!= USER DISPOSITION
!= OBLIGATION SETTLEMENT
```

---

## C. Positive seams to preserve

### C1. Renewal sweep uses the canonical obligation bridge

`ContractRenewalSweep` does not write `CommandItem` directly. It emits `WORK_OBLIGATION_RAISED` with a stable five-tuple:

```text
businessId
+ sourceModule=contracts
+ sourceType=contract
+ sourceId=<contract id>
+ actionType=CONTRACT_RENEWAL
```

`ObligationListener` owns the durable CommandItem materialization via upsert.

This is a strong cross-module seam because repeated daily sweeps converge on one semantic obligation row rather than creating duplicates.

### C2. Re-raising preserves disposition

`ObligationListener.onRaised()` intentionally refreshes obligation facts while excluding `status`, `completedAt`, `dismissedAt` and `dischargedAt` from the update set.

Target-quality law already present in code:

```text
RECOMPUTE / RE-RAISE FACTS
!= RESURRECT USER DISPOSITION
```

This positive seam should be reused by contract-derived alerts rather than duplicated with delete/recreate projection rows.

### C3. Contract status update has a settlement path

`ContractsService.updateContract()` calls `settleRenewalIfResolved()` after mutation. For status transitions to:

```text
ACTIVE
EXPIRED
TERMINATED
ARCHIVED
```

it emits `WORK_OBLIGATION_SETTLED` using the same contract/source/action tuple.

This gives the renewal obligation both a producer and, for those status updates, a load-bearing settler.

---

## D. F215 / C165 — Contract revision history is not authoritative or reconstructable

`ContractVersion` stores version metadata but not a reconstructable Contract snapshot/delta. `createContract()` creates version 1 and `applyExtractionResult()` creates a later metadata version, while principal manual PATCH mutates authoritative Contract fields without creating a ContractVersion.

Material current fields include status, dates, renewal semantics, value, currency, jurisdiction, parties, tags and source links.

Target law:

```text
Authoritative Contract mutation
→ stable ContractRevision identity
→ exact reconstructable state or deterministic delta
→ actor / source / evidence provenance
→ business-effective and system-known time where material
→ atomic current-state projection + revision evidence
```

This does not require event sourcing.

### D1. Deletion strengthens F215

Current `deleteContract()` performs a hard `contract.delete()` and creates no tombstone/revision/settlement evidence.

The Contract schema lineage uses `ON DELETE CASCADE` for Contract-owned descendants including `contract_versions` and `contract_alerts` (and other Contract-owned rows in this model family). Therefore deletion can destroy the very version/projection history intended to explain prior authoritative state.

Classification:

```text
NOT a new architecture root
→ SPECIALIZATION / STRENGTHENING of F215/C165
```

A semantic delete/withdrawal/archival decision is itself a material Contract lifecycle revision and must preserve required historical evidence even if the current projection is hidden from normal active views.

---

## E. F216 / C166 — uncertain AI extraction can become authoritative Contract truth

`DocumentIntelligenceService.extractFromDocument()` returns probabilistic contract data with confidence, but the explicit contract extraction path accepts a contract-shaped result and `applyExtractionResult()` can directly update authoritative top-level fields including renewal dates/types/notice, value/currency, jurisdiction and parties.

Those promoted top-level values do not retain field-level confidence, source-span/evidence binding, verification state, conflict state or the governance decision that authorized promotion.

Contrast: invoice extraction elsewhere uses an explicit confidence threshold plus governance auto-approval evaluation.

Target law:

```text
EXTRACTION ASSERTION / EVIDENCE CANDIDATE
!= AUTHORITATIVE CONTRACT TRUTH BY DEFAULT
```

Promotion should preserve at least source/revision, asserted value, extractor/model provenance, confidence, evidence reference, verification/conflict state and the accepted ContractRevision when promoted.

Classification relative to K4:

```text
J11 specialization of provenance/revision-aware Business Knowledge
→ compose with KF-REC-049
→ do not create a second generic epistemic engine
```

---

## F. Renewal occurrence identity — reuse J23, no new root

A recurring or multi-cycle contract may generate renewal work more than once. That requires occurrence identity distinct from the Contract definition/source identity.

This is already owned by the mature temporal law:

```text
WorkDefinition / source definition
!= WorkOccurrence / recurrence phase
```

Classification:

```text
SAME architectural law as J23 temporal recurrence
→ reuse KF-REC-047
→ no new finding allocated
```

J11 must still pressure-test whether the current five-tuple keyed only by Contract id/action type can represent multiple historically distinct renewal cycles after one cycle is discharged. That is a J11 manifestation of the existing temporal occurrence law, not permission to allocate a duplicate root.

---

## G. ContractAlert acknowledgement regeneration — reuse J17, no new root

Current local alert path:

```text
Contract dates
→ regenerateAlerts()
→ derived ContractAlert rows
→ acknowledgeAlert() persists acknowledgedAt / acknowledgedBy
```

But regeneration performs:

```text
deleteMany({ contractId })
→ createMany(recomputed alerts)
```

so a later contract edit or extraction can erase acknowledgement evidence and recreate the same semantic alert as unresolved.

This contrasts with the canonical obligation bridge, whose upsert refreshes facts while explicitly preserving user disposition.

Anti-duplication verdict:

```text
SPECIALIZATION of F182 / KF-REC-051
not a new architecture root
```

Why:

- F182 establishes that a durable operator projection requires stable identity plus reverse source-state convergence.
- KF-REC-051 explicitly separates source condition, operator attention and user disposition, and requires persistent disposition semantics.
- J11 adds a concrete delete/recreate manifestation but not a distinct ontology.

Target law:

```text
DERIVED FACT MAY BE RECOMPUTED
!= DURABLE OPERATOR DISPOSITION MAY BE ERASED
```

Possible target shapes remain open: stable semantic ContractAlert identity, facts/disposition separation, or retirement of ContractAlert as a competing durable attention system in favor of the existing obligation projection where semantics overlap.

---

## H. Contract deletion versus already-raised renewal obligation — reuse J17 convergence law

Current reachable path:

```text
ContractRenewalSweep
→ WORK_OBLIGATION_RAISED
→ ObligationListener upsert
→ persistent CommandItem(kind=OBLIGATION)
```

If the Contract is then status-updated to ACTIVE/EXPIRED/TERMINATED/ARCHIVED, `settleRenewalIfResolved()` emits the matching settlement event.

If the Contract is instead deleted:

```text
deleteContract()
→ hard Contract delete
→ no WORK_OBLIGATION_SETTLED
→ Contract-owned descendants cascade away
→ independently persisted CommandItem obligation is not source-FK-owned
→ already-raised renewal obligation can remain open with source record gone
```

Classification:

```text
operator-work orphaning → SPECIALIZATION of F182 / KF-REC-051
source-history destruction → STRENGTHENING of F215/C165
```

Do not allocate a new root unless later trace proves a distinct semantic owner not already covered by those contracts.

Target source lifecycle law:

```text
Contract withdrawal / deletion / termination / archival
→ explicit Contract lifecycle revision
→ re-evaluate every derived renewal occurrence and attention projection
→ KEEP | SETTLE | CANCEL | SUPERSEDE | REDERIVE
→ preserve historical evidence
```

Deletion is not automatically equivalent to settlement; the business meaning must be explicit.

---

## I. Current dynamic / causal / feedback graph

```text
Document / human / API / KEY input
        ↓
   Contract projection
        ↓
 renewalDate / notice / type / value
        ↓
 ContractRenewalSweep (daily)
        ↓
 WORK_OBLIGATION_RAISED
        ↓
 ObligationListener stable upsert
        ↓
 CommandItem / operator attention
        ↓
 user disposition + business decision
        ↓
 Contract status mutation
        ↓
 WORK_OBLIGATION_SETTLED
        ↓
 durable obligation convergence
```

Competing side projection:

```text
Contract mutation / extraction
→ regenerateAlerts()
→ delete old ContractAlerts
→ create new ContractAlerts
→ acknowledgement history can disappear
```

Deletion break:

```text
open renewal obligation
+ Contract hard delete
→ source disappears
→ Contract-owned history cascades
→ obligation settlement event absent
→ stale/orphan operator work can survive
```

Epistemic feedback risk:

```text
uncertain AI extraction
→ authoritative renewalDate/value/type
→ renewal sweep
→ operator obligation / priority/value
→ user/business action
```

Therefore weak source knowledge can propagate into real work unless promotion eligibility is explicit.

---

## J. Macro/micro pool classification

### Core value primitives

- authoritative Contract current projection backed by revision/evidence lineage;
- renewal occurrence / temporal obligation;
- one canonical durable operator-work projection with persistent disposition;
- explicit settlement/cancellation/supersession;
- source-grounded valuation and party identity.

### Necessary domain specialization

- contract parties/terms/jurisdiction;
- renewal type and notice policy;
- contract-specific verification/promotion policy for high-impact extracted terms.

### Derived projection

- current Contract status/read model;
- alert/attention surfaces;
- stats such as renewal-due/expiring counts.

### Redundant / accidental-complexity pressure

- ContractAlert as a separate durable acknowledgement system overlapping CommandItem obligation attention;
- delete/recreate projection semantics that discard disposition;
- metadata-only ContractVersion rows presented as historical versions.

### Value-detracting pressure

- hard deletion of business-critical Contract history;
- uncertain AI values becoming operative renewal truth without promotion evidence;
- orphan work remaining actionable after its source disappears.

---

## K. Current anti-duplication ledger

```text
Contract reconstructable revision history     → F215/C165
AI extraction epistemic promotion             → F216/C166
renewal occurrence identity                   → reuse J23 / KF-REC-047
alert acknowledgement regeneration            → reuse F182 / KF-REC-051
source deletion leaves renewal work orphaned  → reuse F182 / KF-REC-051
hard delete destroys Contract revision lineage→ strengthen F215/C165
recovery mechanics                            → KF-REC-048
financial valuation                           → KF-REC-052
commercial obligation semantics               → KF-REC-053 where applicable
```

No F217/C167 allocation is justified by the current evidence tranche.
No KF-REC-055 allocation is justified yet.

---

## L. Open microscopic questions

1. Can a discharged Contract renewal obligation represent a later renewal cycle with the current five-tuple, or does the existing terminal disposition prevent the next WorkOccurrence from becoming actionable? Treat any defect as J23 temporal occurrence specialization first.
2. Does every contract mutation door that changes renewal semantics trigger alert regeneration and/or obligation re-evaluation consistently?
3. What exact UI/API surfaces expose ContractAlert versus CommandItem renewal work, and can the user receive duplicate competing attention for one renewal condition?
4. Are Contract delete/archival permissions and retention policy semantically aligned with legal/business evidence retention?
5. Do downstream AI/health/priority consumers distinguish verified authoritative contract facts from extracted assertions?
6. How are changed renewal dates after an obligation is already raised reflected in dueAt/title/value while preserving disposition and occurrence identity?
7. If an AI extraction corrects a previously wrong renewal date after operator disposition, what should KEEP / REDERIVE / SUPERSEDE mean?

---

## M. Exact next trace

```text
1. trace one completed/discharged renewal obligation into the next renewal cycle;
2. prove whether five-tuple identity can reopen a genuinely new occurrence without resurrecting the old one;
3. trace ContractAlert and CommandItem surfaces for duplicate operator attention;
4. trace all Contract mutation doors for renewal re-evaluation symmetry;
5. classify results through existing J23/J17/K4 roots before new allocation;
6. only after the microscopic pool stabilizes, run standards/frontier pressure testing;
7. synthesize KF-REC-055 only if irreducible contract-domain semantics remain after delegation.
```

No production implementation is authorized by this dossier.
