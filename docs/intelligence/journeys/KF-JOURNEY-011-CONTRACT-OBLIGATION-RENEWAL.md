# KF-JOURNEY-011 — Contract / Obligation / Renewal

Status: **PROVISIONALLY CONVERGED / TARGET-ALIGNED THROUGH F218/C168/KF-REC-055**
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.
Runtime proof remains **NOT EXECUTED**.

## A. Definition

J11 models how KeyFlowOS turns contract evidence and human/AI-authored contract state into durable business obligations, renewal decisions, operator attention and later convergence.

Core question:

> What makes a contract fact authoritative, which revision did an obligation derive from, what identifies each renewal occurrence, what evidence proves a renewal decision, and how do correction, acknowledgement, settlement, termination, archival, retention and deletion converge without losing evidence or resurrecting/staling work?

Primary kernels: K4 Business Knowledge, K6 State Transition, K7 Temporal/Workflow, K8 Evidence/Outcome, K11 Recovery/Reliability.
Adjacent journeys: J12 document/evidence, J23 temporal recurrence/work, J18 recovery, J17 operator attention, J7 valuation, J3/J4 commercial obligations.

Pressure test:
`investigations/J11-CONTRACT-OBLIGATION-RENEWAL-STANDARDS-FRONTIER-PRESSURE-TEST.md`

Backward re-audit:
`investigations/J11-J12-J23-J18-J17-J7-J3-J4-K4-K6-K7-K8-K11-CONTRACT-INTEGRITY-BACKWARD-REAUDIT.md`

Target recommendation:
`10N-RECOMMENDATION-REGISTER-CONTRACT-INTEGRITY-RENEWAL-CONTINUATION.md`

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

## C. Canonical J11 roots

### F215 / C165 — Contract revision history is not authoritative or reconstructable

`ContractVersion` stores version metadata but not a reconstructable Contract snapshot/delta. `createContract()` creates version 1 and `applyExtractionResult()` creates later metadata versions, while principal manual/KEY PATCH mutates authoritative Contract fields without creating a ContractVersion.

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

### F216 / C166 — uncertain AI extraction can become authoritative Contract truth

Probabilistic extraction can directly update renewal dates/types/notice, value/currency, jurisdiction and parties. Promoted top-level values do not preserve field-level confidence, verification/conflict state, source-span binding or the governance decision that authorized promotion.

Target law:

```text
EXTRACTION ASSERTION / EVIDENCE CANDIDATE
!= AUTHORITATIVE CONTRACT TRUTH BY DEFAULT
```

J11 composes with KF-REC-049 rather than creating a second generic epistemic engine.

### F217 / C167 — lifecycle status can falsely discharge renewal work

Reachable path:

```text
ACTIVE contract + OPEN renewal obligation
→ user edits unrelated Contract fields
→ form resubmits current status = ACTIVE
→ updateContract(dto.status=ACTIVE)
→ settleRenewalIfResolved()
→ WORK_OBLIGATION_SETTLED(CONTRACT_RENEWAL)
→ obligation becomes COMPLETED
```

At the same time the daily renewal sweep intentionally scans `ACTIVE|RENEWAL_DUE` to raise renewal obligations.

Canonical law:

```text
ContractLifecycleState
!= RenewalDecisionOccurrence
!= RenewalDecisionEvidence
!= RenewalObligationDisposition
```

### F218 / C168 — retention semantics are non-load-bearing at destructive delete

Contract persistence/API carries `retentionPolicy` and `retentionUntil`; the standard UI exposes Retention policy. `deleteContract()` nevertheless hard-deletes without consulting those semantics, and database cascades remove Contract-owned parties, terms, versions, alerts and tag mappings.

Target law:

```text
RetentionPolicy
!= decorative metadata if exposed as domain retention state
```

and:

```text
ARCHIVE / RETIRE / SUPERSEDE
!= HARD DELETE
```

This is not a jurisdiction-specific legal-compliance claim.

---

## D. Positive seams to preserve

### D1. Renewal sweep uses the canonical obligation bridge

`ContractRenewalSweep` emits `WORK_OBLIGATION_RAISED` instead of writing CommandItem directly. `ObligationListener` owns durable operator-work materialization.

### D2. Re-raising preserves disposition

The obligation upsert refreshes facts while deliberately excluding terminal/user-disposition fields from the update set.

Valuable law:

```text
RECOMPUTE / RE-RAISE FACTS
!= RESURRECT USER DISPOSITION
```

This is correct for repeated emissions of the same occurrence; later genuine cycles need J23/KF-REC-047 occurrence identity.

### D3. Source-owned settlement seam exists

ContractsService already owns a source-side `WORK_OBLIGATION_SETTLED` seam. Preserve that architectural direction, but bind settlement to occurrence-specific RenewalDecision evidence rather than generic lifecycle-status presence.

### D4. Authoritative writers are reasonably centralized

Manual/API, KEY and document-intelligence Contract writes mostly converge on ContractsService. This is an asset for future revision-contract enforcement.

---

## E. Reuse / non-allocation decisions

```text
renewal-cycle occurrence identity                  → J23 / KF-REC-047
ContractAlert acknowledgement resurrection         → F182 / KF-REC-051
ContractAlert threshold time progression           → J23 / KF-REC-047
source deletion leaves renewal work orphaned       → F182 / KF-REC-051
renewal date/notice correction leaves stale work   → F182 / KF-REC-051
local renewal alert vs obligation actionability    → KF-REC-047/051 pressure; no new root
recovery mechanics                                 → KF-REC-048
financial valuation/truth                          → KF-REC-052
commercial obligation consequences                 → KF-REC-053
provenance/epistemic eligibility                    → KF-REC-049
```

`ContractClauseService.clauseAnalysis` remains classified as a derived/advisory projection and value-density question, not authoritative ContractRevision truth by default.

No F219/C169 allocation emerged from pressure testing or backward re-audit.

---

## F. ContractAlert role classification

Current local alert types:

```text
EXPIRY_30
EXPIRY_7
EXPIRY_1
EXPIRED
RENEWAL_DUE
```

Target role:

```text
ContractAlert
→ local contextual derived projection of time-relative contract facts
```

not:

```text
ContractAlert
→ second canonical durable obligation / recurrence / priority system
```

If local alert acknowledgement remains durable product state, semantic alert identity must preserve user disposition across recomputation. If local alerts are informational only, derive them cheaply rather than maintaining a competing persisted work model.

Future renewal visibility must not masquerade as actionable due work when `renewalNoticeDays` says the work is not yet actionable.

---

## G. KF-REC-055 target ownership

`KF-REC-055 — Contract Integrity & Renewal Contract` owns only the irreducible J11 semantics:

```text
ContractRevision
→ authoritative agreement-state lineage

ContractAssertionPromotion
→ contract-specific acceptance of evidence/assertions into an accepted ContractRevision

RenewalDecision binding
→ relevant ContractRevision + RenewalOccurrence + qualifying decision evidence

RetentionDeletionDecision
→ agreement archival/destructive-disposition eligibility + durable decision evidence
```

It explicitly delegates:

```text
provenance / epistemic eligibility → KF-REC-049
occurrence / temporal work mechanics→ KF-REC-047
recovery / outcome certainty        → KF-REC-048
operator attention / disposition    → KF-REC-051
financial truth / valuation         → KF-REC-052
commercial obligation discipline    → KF-REC-053
generic governance / clearance      → K3
cross-domain evidence architecture  → K8
```

---

## H. Anti-mega-runtime verdict

KF-REC-055 requires none of the following:

```text
universal event store                         NO
universal EDMS / CLM suite                    NO
second generic provenance system              NO
second scheduler/workflow engine              NO
second operator attention queue               NO
second recovery engine                        NO
second financial truth system                 NO
second commercial obligation system           NO
universal governance engine                   NO
jurisdiction-wide legal rules engine          NO
one universal Contract state machine          NO
```

Minimum target pressure remains ordinary composable domain primitives and policies.

---

## I. Dynamic / causal / feedback graph

```text
J12 source document / human / integration / KEY
        ↓
K4 / KF-REC-049 provenance + epistemic eligibility
        ↓
KF-REC-055 contract-specific promotion
        ↓
ContractRevision
        ↓
renewal semantics
        ↓
K7 / KF-REC-047 RenewalOccurrence mechanics
        ↓
J17 / KF-REC-051 operator attention
        ↓
operator/domain decision + K3 authority where needed
        ↓
KF-REC-055 RenewalDecision
        ↓
KF-REC-053 commercial consequences if any
        ↓
KF-REC-052 financial descendants if any
        ↓
KF-REC-048 recovery if outcomes are uncertain
```

Deletion branch:

```text
archive/delete request
→ K3 authority where required
→ KF-REC-055 RetentionDeletionDecision
→ converge dependent work/projections
→ allowed archive/destruction action
→ K8 durable disposition evidence
```

---

## J. Standards/frontier pressure-test verdict

Current records/provenance/contract/temporal patterns validated the target shape without forcing enterprise bulk:

- records standards support trustworthy record controls, metadata and disposition;
- provenance standards support source/actor/revision lineage;
- contract-data patterns support stable identity + immutable/reconstructable revisions/amendments + current compiled projection;
- durable-work systems reinforce Definition != Occurrence;
- EDMS examples show history and reversible-removal/permanent-deletion separation is practical without event sourcing.

Pressure test verdict:

```text
F215 strongly validated
F216 strongly validated
F217 validated as domain-semantic defect
F218 strongly validated
bounded J11 target remains necessary = YES
mega-runtime required = NO
```

---

## K. Backward re-audit verdict

```text
KF-REC-055 invalidated                               = NO
parallel knowledge/provenance system                = NO
parallel temporal/workflow system                   = NO
parallel operator-attention system                  = NO
parallel recovery system                            = NO
parallel financial-truth system                     = NO
parallel commercial-obligation system               = NO
parallel governance/evidence runtime                = NO
universal records/contract mega-runtime required    = NO
new finding/contradiction from backward re-audit    = NO
J11 target can be provisionally converged           = YES
runtime proof executed                              = NO
production implementation authorized                = NO
```

---

## L. Convergence state

J11 is **PROVISIONALLY CONVERGED / TARGET-ALIGNED** through:

```text
F215–F218
C165–C168
KF-REC-055
```

Current canonical ranges:

```text
Findings:        F001–F218
Contradictions:  C001–C168
Recommendations: KF-REC-001–KF-REC-055
next free:       F219 / C169 / KF-REC-056
```

J11 remains reopenable if J12, later journey coverage, migration design, or runtime/concurrency/fault proof falsifies its target semantics.

## M. Next programme action

Do **not** turn KF-REC-055 into an implementation packet yet.

Return J11 to the pooled whole-system model and select the next genuinely unpooled/high-leverage journey from `03-ANALYSIS-MAP.md` plus current dossier coverage.

Selection procedure:

```text
1. load journey inventory + existing dossier set;
2. identify genuinely unpooled first-pass gaps;
3. compare reachable native implementation footprint and cross-kernel leverage;
4. activate the highest-leverage gap;
5. begin microscopic tracing from native write/effect paths;
6. reuse F001–F218 / C001–C168 / KF-REC-001–055 before new allocation;
7. keep production code untouched.
```
