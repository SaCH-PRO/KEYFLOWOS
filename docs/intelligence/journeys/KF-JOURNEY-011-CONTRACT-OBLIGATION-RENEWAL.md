# KF-JOURNEY-011 — Contract / Obligation / Renewal

Status: **ACTIVE MICROSCOPIC FORENSICS / THROUGH F218/C168 / TARGET-SEMANTIC BOUNDARY EMERGING**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J11 models how KeyFlowOS turns contract evidence and human/AI-authored contract state into durable business obligations, renewal decisions, operator attention and later convergence.

Core question:

> What makes a contract fact authoritative, which revision did an obligation derive from, what identifies each renewal occurrence, what evidence proves a renewal decision, and how do correction, acknowledgement, settlement, termination, archival, retention and deletion converge without losing evidence or resurrecting/staling work?

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
→ RenewalOccurrence identity
→ work.obligation.raised
→ durable operator work projection
→ acknowledge / snooze / assign / decide
→ occurrence-specific RenewalDecision evidence
→ source-domain resolution / renewal / termination / lapse
→ work.obligation.settled / superseded / cancelled for that occurrence
→ retained history + later recurrence
→ archive/delete only through explicit retention/deletion policy
```

Critical separation:

```text
DOCUMENT ASSERTION
!= AUTHORITATIVE CONTRACT TRUTH
!= CONTRACT LIFECYCLE STATE
!= RENEWAL OCCURRENCE
!= RENEWAL DECISION EVIDENCE
!= LOCAL INFORMATIONAL ALERT
!= BUSINESS OBLIGATION
!= USER DISPOSITION
!= OBLIGATION SETTLEMENT
!= RETENTION / DELETION AUTHORITY
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

`ObligationListener` owns durable CommandItem materialization via upsert. Repeated daily sweeps therefore converge on one row for the same tuple.

### C2. Re-raising preserves disposition

`ObligationListener.onRaised()` refreshes obligation facts while excluding `status`, `completedAt`, `dismissedAt` and `dischargedAt` from the update set.

Valuable law already encoded:

```text
RECOMPUTE / RE-RAISE FACTS
!= RESURRECT USER DISPOSITION
```

The limitation is occurrence identity: the current five-tuple cannot distinguish a later genuine renewal cycle from a duplicate emission of the prior one. That is a J23/KF-REC-047 specialization, not a new J11 root.

### C3. There is a source-side settlement seam, but its predicate is unsafe

`ContractsService.updateContract()` can emit `WORK_OBLIGATION_SETTLED` using the same source/action tuple. Bidirectional ownership is architecturally desirable.

F217/C167 show that the current predicate is not target-quality: mere DTO presence of `ACTIVE|EXPIRED|TERMINATED|ARCHIVED` is treated as renewal-decision evidence, even when status did not change and no renewal decision occurred.

Preserve the **source-owned settlement seam**, replace the settlement predicate with occurrence-specific decision evidence.

---

## D. F215 / C165 — Contract revision history is not authoritative or reconstructable

`ContractVersion` stores version metadata but not a reconstructable Contract snapshot/delta. `createContract()` creates version 1 and `applyExtractionResult()` creates later metadata versions, while principal manual PATCH mutates authoritative Contract fields without creating a ContractVersion.

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

Hard deletion strengthens F215 because ContractVersion rows cascade away, but retention eligibility is now separately owned by F218/C168.

---

## E. F216 / C166 — uncertain AI extraction can become authoritative Contract truth

Probabilistic extraction can directly update renewal dates/types/notice, value/currency, jurisdiction and parties. Promoted top-level values do not preserve field-level confidence, verification/conflict state, source-span binding or the governance decision that authorized promotion.

Target law:

```text
EXTRACTION ASSERTION / EVIDENCE CANDIDATE
!= AUTHORITATIVE CONTRACT TRUTH BY DEFAULT
```

J11 composes with KF-REC-049 rather than creating a second generic epistemic engine.

---

## F. F217 / C167 — lifecycle status can falsely discharge renewal work

Reachable path:

```text
ACTIVE contract + OPEN renewal obligation
→ user opens standard Edit form
→ changes title / notes / party / another unrelated field
→ form resubmits current status = ACTIVE
→ updateContract(dto.status=ACTIVE)
→ settleRenewalIfResolved()
→ WORK_OBLIGATION_SETTLED(CONTRACT_RENEWAL)
→ obligation becomes COMPLETED
```

No renewal decision is required. The server comment says only a status change settles, but the implementation checks only whether a qualifying status value is supplied.

At the same time the daily renewal sweep intentionally scans:

```text
status in [ACTIVE, RENEWAL_DUE]
```

to raise renewal obligations.

Therefore `ACTIVE` cannot itself prove a renewal decision: it is simultaneously treated as a renewable/outstanding state and a resolved state depending on code path.

Canonical law:

```text
ContractLifecycleState
!= RenewalDecisionOccurrence
!= RenewalDecisionEvidence
!= RenewalObligationDisposition
```

Target:

```text
RenewalOccurrenceId
+ authoritative ContractRevision
+ explicit decision/disposition evidence
+ policy/version where material
→ RenewalDecision
→ settle exactly that occurrence
```

F217 composes with KF-REC-047/049/051/053; it does not move truth into CommandItem.

---

## G. F218 / C168 — retention semantics are non-load-bearing at destructive delete

Contract persistence/API carries:

```text
retentionPolicy
retentionUntil
```

and the standard Contracts UI exposes `Retention policy` as an editable/displayed domain field.

Yet `deleteContract()` performs immediate hard deletion without reading either retention field or producing an observed deletion/tombstone revision.

Database cascade deletes Contract-owned:

```text
ContractParty
ContractTerm
ContractVersion
ContractAlert
ContractTagOnContract
```

The inspected migration does not define Contract foreign keys to its source Asset/BusinessAsset/DocumentInstance/Drive references, so F218 does not claim those source documents are deleted.

Canonical distinction:

```text
RetentionPolicy
!= decorative metadata if product/API present it as retention state
```

and:

```text
ARCHIVE / RETIRE / SUPERSEDE
!= HARD DELETE
```

Target deletion eligibility must explicitly combine current revision, retention state, lifecycle/dependency requirements, actor/authority and reason/override evidence. If retention is not intended to be enforceable, remove/relabel the misleading fields instead.

F218 is not a jurisdiction-specific legal-compliance claim.

---

## H. Renewal occurrence identity — reuse J23, no new root

A multi-cycle contract needs a renewal occurrence identity distinct from the Contract source identity.

Current five-tuple dedupes repeated sweeps correctly for one cycle, while `ObligationListener` correctly avoids resurrecting terminal user disposition. But that combination can suppress a later genuine cycle because cycle N+1 reuses cycle N's terminal row.

Classification:

```text
SAME architectural law as J23 Definition != Occurrence
→ reuse KF-REC-047
→ no duplicate finding
```

---

## I. ContractAlert role classification — local projection, not second obligation spine

Current local alert types:

```text
EXPIRY_30
EXPIRY_7
EXPIRY_1
EXPIRED
RENEWAL_DUE
```

They are written/read through the Contracts module and rendered inside Contract detail plus local stats. Repository-wide direct persistence usage inspected so far is confined to `ContractsService`; no evidence shows ContractAlert as a broad cross-module work owner.

Useful role:

```text
ContractAlert
→ local contextual projection of time-relative contract facts
```

It should not become:

```text
ContractAlert
→ second canonical durable obligation / priority / recurrence system
```

Central owed renewal work belongs to RenewalOccurrence → canonical obligation → KF-REC-051 operator attention.

### I1. Acknowledgement regeneration

`regenerateAlerts()` deletes and recreates rows, so acknowledgement can disappear.

Classification:

```text
SPECIALIZATION of F182 / KF-REC-051
```

Target law:

```text
DERIVED FACT MAY BE RECOMPUTED
!= DURABLE OPERATOR DISPOSITION MAY BE ERASED
```

If local alerts remain ephemeral contextual facts, consider deriving them rather than persisting separate durable acknowledgement semantics. If acknowledgement is product-important, give the semantic alert stable identity/facts-vs-disposition separation.

### I2. Time advancement requires unrelated writes

`regenerateAlerts()` runs on Contract creation/update/extraction, not simply because time crosses an expiry threshold. Therefore EXPIRY_30→7→1→EXPIRED does not reliably advance from time passing alone.

Classification:

```text
J23/KF-REC-047 temporal materialization specialization
→ no new root
```

### I3. Renewal actionability semantics diverge

Local `ContractAlert(RENEWAL_DUE)` is produced for any future renewal date, regardless of `renewalNoticeDays`.

The central renewal obligation becomes actionable only once:

```text
now >= renewalDate - renewalNoticeDays
```

Thus local “RENEWAL DUE” and central owed work do not share an actionability predicate.

Current verdict:

```text
RELATED PROJECTION DIVERGENCE under KF-REC-051/KF-REC-047
→ record as J11 pressure
→ no F219 allocation yet
```

Target naming/UX should distinguish contextual future-date visibility from actual due/actionable obligation.

---

## J. Contract deletion versus already-raised renewal obligation — reuse J17 convergence law

Hard delete emits no `WORK_OBLIGATION_SETTLED` or cancellation/supersession event. An independently persisted CommandItem obligation can therefore remain open after source deletion.

Classification:

```text
operator-work orphaning → F182 / KF-REC-051 specialization
retention eligibility/evidence destruction → F218/C168
revision-history impact → strengthens F215/C165
```

Deletion is not automatically equivalent to obligation settlement; the business disposition must be explicit.

---

## K. Current dynamic / causal / feedback graph

```text
Document / human / API / KEY input
        ↓
 assertion / evidence
        ↓ promotion policy
 ContractRevision → current Contract projection
        ↓
 renewalDate / notice / type / value
        ↓
 RenewalOccurrence eligibility
        ↓
 WORK_OBLIGATION_RAISED
        ↓
 ObligationListener
        ↓
 CommandItem / operator attention
        ↓
 business decision evidence
        ↓
 RenewalDecision for exact occurrence
        ↓
 WORK_OBLIGATION_SETTLED / SUPERSEDED / CANCELLED
        ↓
 retained occurrence + decision history
```

Current dangerous shortcuts:

```text
uncertain extraction → Contract truth → renewal work
ordinary edit + status=ACTIVE → false settlement
Contract delete → history cascades + operator obligation can remain
```

Competing local projection:

```text
Contract mutation
→ regenerateAlerts()
→ delete/recreate local alerts
→ acknowledgement can disappear
→ temporal threshold advancement depends on unrelated writes
```

---

## L. Macro/micro pool classification

### Core value primitives

- authoritative Contract projection backed by revision/evidence lineage;
- RenewalOccurrence identity;
- RenewalDecision evidence/disposition;
- canonical obligation/operator-work projection;
- explicit retention/deletion policy decision.

### Necessary domain specialization

- contract parties/terms/jurisdiction;
- renewal type and notice policy;
- contract-specific verification/promotion policy;
- contract retention semantics where product intends enforcement.

### Derived projection

- current Contract read model;
- local time-relative ContractAlert facts;
- stats such as renewal-due/expiring counts.

### Accidental/redundant complexity pressure

- metadata-only ContractVersion presented as version history;
- persisted ContractAlert acknowledgement system overlapping central operator disposition;
- same `ACTIVE` lifecycle label used as both unresolved-renewal eligibility and settlement evidence;
- descriptive retention fields disconnected from destructive lifecycle.

### Value-detracting pressure

- false discharge of owed renewal work;
- uncertain AI values becoming operative renewal truth;
- hard delete bypassing declared retention and removing registry evidence;
- orphan work after source deletion;
- recurrence suppressed by definition-level identity.

---

## M. Current anti-duplication ledger

```text
Contract reconstructable revision history      → F215/C165
AI extraction epistemic promotion              → F216/C166
false renewal discharge from lifecycle status  → F217/C167
retention vs destructive delete                → F218/C168
renewal occurrence identity                    → J23 / KF-REC-047
alert acknowledgement regeneration             → F182 / KF-REC-051
local alert time advancement                    → J23 / KF-REC-047
renewal alert vs obligation actionability       → KF-REC-051 + KF-REC-047 pressure; no new root yet
source deletion leaves renewal work orphaned   → F182 / KF-REC-051
recovery mechanics                             → KF-REC-048
financial valuation                            → KF-REC-052
commercial obligation transition discipline    → KF-REC-053
```

Current canonical range after this tranche:

```text
F001–F218
C001–C168
KF-REC-001–KF-REC-054
```

No KF-REC-055 allocation yet.

---

## N. Remaining microscopic questions

1. Trace every contract mutation door, including KEY/AI tools, for revision creation, renewal re-evaluation and settlement symmetry.
2. Determine whether changing renewalDate/notice/type after an obligation is already raised should UPDATE the same occurrence, SUPERSEDE it, or create a new occurrence.
3. Trace source-document correction/deletion and whether Contract truth stays linked to the exact source revision.
4. Test extraction concurrency/version-number race against F215 revision identity rather than allocating a duplicate root prematurely.
5. Determine what explicit product action constitutes RENEW / NON-RENEW / TERMINATE / LAPSE and whether the current status algebra can express it without overload.
6. Pressure-test retention/archive semantics against document/evidence J12 and operator/recovery downstreams.
7. After microscopic stability, run standards/frontier research and decide whether irreducible contract-domain semantics justify KF-REC-055.

---

## O. Exact next trace

```text
1. enumerate all non-UI Contract writers (KEY tools, document listener, imports/APIs);
2. compare mutation semantics against F215/F216/F217;
3. trace renewal-date correction after an already-raised occurrence;
4. trace explicit renewal/non-renewal product actions — or prove they are absent;
5. classify any new defect through existing K4/K6/K7/K8/K11 laws first;
6. pressure-test J11 with standards/OSS only after the code pool stabilizes;
7. synthesize KF-REC-055 only if a bounded Contract-domain contract remains after delegation.
```
