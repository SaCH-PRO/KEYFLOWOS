# KeyFlowOS Recommendation Register — Contract Integrity & Renewal Continuation

Status: CANONICAL RECOMMENDATION REGISTER CONTINUATION
Last updated: 2026-09-07
Production implementation: NOT AUTHORIZED

## KF-REC-055 — Establish a bounded Contract Integrity & Renewal Contract

**Status:** RECOMMENDED / TARGET-SYNTHESIS INPUT

**Primary journey:** J11 — Contract / Obligation / Renewal
**Primary kernels:** K4 Business Knowledge, K6 State Transition, K7 Temporal/Workflow, K8 Evidence/Outcome
**Critical adjacent kernels:** K3 Governance, K11 Recovery/Reliability, K10 Financial Truth
**Adjacent journeys:** J12, J23, J18, J17, J7, J3/J4
**Canonical evidence:** F215–F218 / C165–C168
**Pressure test:** `investigations/J11-CONTRACT-OBLIGATION-RENEWAL-STANDARDS-FRONTIER-PRESSURE-TEST.md`

---

# 1. Recommendation

Establish one bounded semantic contract that governs four agreement-specific responsibilities:

```text
1. authoritative ContractRevision lineage
2. promotion of contract assertions/evidence into accepted Contract state
3. binding a renewal decision to one renewal occurrence and relevant Contract revision
4. retention / archival / destructive-disposition eligibility and evidence
```

This contract must compose existing KeyFlow kernels rather than become a universal record store, workflow engine, operator queue, knowledge engine or commercial-obligation system.

Its purpose is to make KeyFlow able to answer, for any material contract state or renewal decision:

1. What exact authoritative revision is current?
2. What prior revision, source evidence and actor produced it?
3. Which extracted/manual/external assertions were accepted, rejected, disputed or superseded?
4. Which exact renewal occurrence is approaching or being decided?
5. What evidence proves the decision for that occurrence?
6. Which operator work belongs to that occurrence, and has it been settled/superseded/cancelled?
7. What retention/disposition rule applies before archive or destructive deletion?
8. What durable evidence remains after an allowed destructive disposition?

---

# 2. Why this remains distinct after anti-duplication

## 2.1 KF-REC-049 owns generic epistemic governance, not authoritative agreement lifecycle

KF-REC-049 defines generic KnowledgeRevision, provenance, verification, conflict and consumer-specific epistemic eligibility.

J11 delegates those mechanisms to KF-REC-049.

KF-REC-055 remains responsible for the **domain decision**:

```text
which assertion/evidence may become authoritative Contract state
and which ContractRevision that promotion creates
```

It must not create a second provenance or verification engine.

## 2.2 KF-REC-047 owns temporal occurrence mechanics, not contract renewal meaning

KF-REC-047 owns WorkDefinition/WorkOccurrence identity and temporal projection.

KF-REC-055 supplies the contract-specific derivation/binding:

```text
Contract + relevant authoritative revision + renewal semantics
→ RenewalOccurrence identity/input
```

and the domain decision evidence that resolves that occurrence.

It must not create a second scheduler/workflow engine.

## 2.3 KF-REC-051 owns operator attention, not renewal truth

CommandItem/operator attention may project a renewal occurrence as owed work and preserve assignment/disposition.

KF-REC-055 determines whether the source-domain renewal decision actually occurred and which occurrence it resolves.

```text
operator disposition
!= renewal decision evidence
```

It must not create a second attention queue.

## 2.4 KF-REC-053 owns commercial obligation discipline, not agreement-record integrity

KF-REC-053 governs commercial relationship/obligation lineage and required commercial consequences.

KF-REC-055 owns the agreement-specific record/revision, renewal-decision and retention/disposition semantics that may originate or constrain those obligations.

It must not redefine customer lifecycle, commercial value stages, Invoice/Payment lineage or general commercial consequences.

---

# 3. ContractRevision — authoritative agreement-state lineage

The current `Contract` row should be treated as a current projection of one accepted authoritative revision, not as the complete historical record by itself.

Minimum semantic envelope:

```yaml
contract_revision_id: stable revision identity
contract_id: stable agreement identity
prior_revision_id: optional prior accepted revision
revision_class: create|amendment|correction|lifecycle|source_promotion|other
recorded_at: system-known time
business_effective_at: optional business-effective time
actor_ref: human|KEY|integration|migration|system
source_refs: []
evidence_refs: []
rationale: optional/reason where material
authoritative_state: reconstructable snapshot OR deterministic reconstructable delta
status: accepted|superseded|invalidated as appropriate
```

Exact schema/table shape is not frozen.

### Required laws

```text
material authoritative Contract mutation
→ one accepted ContractRevision
```

```text
current Contract projection
→ deterministically attributable to an accepted revision
```

```text
manual edit / KEY edit / extraction promotion / migration / correction
→ same revision-integrity contract
```

A derived/advisory field may be excluded when explicitly classified as non-authoritative projection metadata.

### Concurrency / crash consistency

Revision number allocation, current-state mutation and accepted revision evidence must not race into ambiguous history.

Possible implementations include:

- transactionally allocated revision sequence;
- optimistic version/fingerprint precondition;
- database sequence/locking;
- stable revision IDs without relying on read-latest-then-plus-one.

The contract does **not** mandate event sourcing.

---

# 4. ContractAssertionPromotion — evidence is not truth by default

Contract assertions may originate from:

```text
human entry
AI/document extraction
source document import
external API/integration
KEY-assisted action
migration/correction
```

For probabilistic or externally sourced assertions, preserve enough semantics to decide whether promotion is allowed.

Minimum relationship:

```text
ContractAssertion
  source document/revision/ref
  asserted field/value
  source span/evidence ref where available
  extractor/agent provenance
  confidence/quality where applicable
  verification/conflict state
        ↓ contract-specific promotion policy
ACCEPT | REJECT | REVIEW | CONFLICT | SUPERSEDE
        ↓ if accepted
ContractRevision
```

Generic epistemic state and evidence handling delegate to KF-REC-049.

### High-impact promotion pressure

At minimum, promotion policy should explicitly consider fields whose error can create real obligations or material business decisions, such as:

```text
party identity
renewal/termination date
renewal type / auto-renew semantics
notice period
contract value/currency
jurisdiction
material obligations/clauses
```

The exact human-review threshold is not frozen and should be risk/policy-sensitive.

---

# 5. RenewalOccurrence and RenewalDecision

## 5.1 Definition is not occurrence

```text
Contract identity
!= renewal cycle / WorkOccurrence identity
```

A repeated daily sweep for one renewal cycle must converge on the same occurrence. A later genuine cycle must receive a new occurrence identity even when the Contract ID is unchanged.

Occurrence mechanics delegate to KF-REC-047.

Suggested derivation inputs may include:

```text
contractId
relevant ContractRevisionId
renewal effective/date boundary
cycle/phase identity where deterministically available
```

The exact hash/key format is not frozen.

## 5.2 Decision evidence is not lifecycle status presence

Target distinction:

```text
ContractLifecycleState
!= RenewalDecision
```

A renewal occurrence should close only from occurrence-specific qualifying evidence.

Candidate decision classes to pressure-test:

```text
RENEW
NON_RENEW
TERMINATE
LAPSE_ACCEPTED
SUPERSEDED_BY_NEW_AGREEMENT
OTHER_EXPLICIT_DISPOSITION
```

Exact vocabulary remains product-policy work.

Minimum decision semantics:

```yaml
renewal_occurrence_id: ...
contract_revision_id: ...
decision: ...
actor_or_source: ...
decided_at: ...
business_effective_at: optional
rationale_or_evidence_refs: []
policy_version: optional/material
```

Then:

```text
RenewalDecision for occurrence X
→ settle / cancel / supersede occurrence X
→ operator work converges from source evidence
```

An ordinary PATCH that happens to contain `status=ACTIVE` is not decision evidence.

## 5.3 Correction / re-derivation

When renewal facts change after work exists, classify the semantic change:

```text
same occurrence factual correction
→ update/rederive occurrence facts

source correction makes occurrence no longer actionable
→ cancel/supersede current work, preserve history

new renewal cycle
→ new occurrence identity
```

Do not leave stale work simply because future sweeps stop raising it.

---

# 6. RetentionDeletionDecision — archive is not hard delete

If KeyFlow exposes retention semantics, they must either become load-bearing or be removed/relabelled as descriptive metadata.

When enforceable, destructive lifecycle must resolve an explicit decision before data erasure.

Minimum semantic envelope:

```yaml
contract_id: ...
contract_revision_id: current/relevant revision
requested_action: archive|delete|purge|other
retention_policy: optional
retention_until: optional
hold_or_dependency_state: optional
actor_or_authority: ...
reason: ...
override_evidence: optional
decision: ARCHIVE | RETAIN | DELETE_ALLOWED | REVIEW_OR_HOLD
decided_at: ...
```

### Required laws

```text
retentionUntil in future
→ hard delete is not automatically allowed
```

```text
ARCHIVED
!= erased from evidence/history
```

```text
source document survives elsewhere
!= Contract registry evidence is therefore safely disposable
```

If permanent deletion is allowed, retain enough durable disposition/tombstone evidence to explain the act according to KeyFlow's declared policy.

No universal legal-retention duration is defined here.

---

# 7. ContractAlert role — bounded local projection

Current local alert concepts such as:

```text
EXPIRY_30
EXPIRY_7
EXPIRY_1
EXPIRED
future renewal visibility
```

may remain useful as **derived local Contract-detail projections**.

They should not become a second durable obligation system.

Target choice:

```text
if informational only
→ derive cheaply from authoritative ContractRevision/current projection + time
→ no durable acknowledgement required
```

or:

```text
if acknowledgement is durable product state
→ stable semantic alert identity
→ facts separate from user disposition
→ recomputation cannot erase disposition
```

Actionable renewal work belongs to RenewalOccurrence → canonical obligation → KF-REC-051.

Future visibility should not be labelled as "due" when `renewalNoticeDays` says it is not yet actionable.

---

# 8. Advisory clause analysis — keep derived unless promoted

`clauseAnalysis`/similar AI analysis should be explicitly classified:

```text
DERIVED / ADVISORY ANALYSIS
```

If no durable consumer requires it, avoid low-value persistence.

If retained for future reasoning, preserve source/provenance/freshness as a derived evidence projection.

If a clause finding becomes authoritative Contract truth, promote it through ContractAssertionPromotion into a new accepted ContractRevision.

Do not silently treat advisory AI JSON on the Contract row as authoritative history.

---

# 9. Composition graph

```text
source document / human / integration / KEY
        ↓
ContractAssertion / direct authoritative intent
        ↓
KF-REC-049 epistemic/provenance mechanics
        ↓ contract-specific promotion / mutation policy
ContractRevision
        ↓
current Contract projection
        ↓
renewal semantics
        ↓
RenewalOccurrence derivation
        ↓ KF-REC-047 occurrence/work mechanics
canonical obligation
        ↓ KF-REC-051 operator attention
operator decision/action
        ↓ authoritative source-domain decision evidence
RenewalDecision
        ↓
settle/supersede/cancel exact occurrence
        ↓ KF-REC-048 if recovery/uncertainty exists
history / later recurrence
```

Financial values delegate to KF-REC-052. Commercial obligation/customer semantics delegate to KF-REC-053.

Deletion branch:

```text
archive/delete request
→ RetentionDeletionDecision
→ KEEP / ARCHIVE / HOLD / DELETE_ALLOWED
→ converge dependent work/projections
→ destructive action only if allowed
→ durable disposition evidence
```

---

# 10. Anti-mega-runtime constraints

KF-REC-055 explicitly does **not** authorize:

```text
universal event store
universal document/records management suite
second provenance/knowledge engine
second scheduler/workflow runtime
second operator attention queue
second commercial obligation runtime
second financial truth system
jurisdiction-wide legal-rules engine
one universal contract state machine for every agreement type
```

Prefer ordinary relational revisions, typed domain decisions and adapters where sufficient.

---

# 11. Findings / contradictions addressed

Primary J11 roots:

```text
F215 / C165 — ContractVersion/revision-history integrity
F216 / C166 — uncertain extraction promotion into authoritative truth
F217 / C167 — false renewal discharge / overloaded ACTIVE semantics
F218 / C168 — retention semantics bypassed by destructive delete
```

Related mature roots reused rather than duplicated:

```text
F182 / KF-REC-051 → reverse projection/work convergence
KF-REC-047        → Definition != Occurrence / temporal materialization
KF-REC-048        → recovery/outcome certainty
KF-REC-049        → epistemic provenance/revision mechanics
KF-REC-052        → financial valuation/truth
KF-REC-053        → commercial obligation discipline
```

---

# 12. Proof obligations before implementation authorization

At minimum prove:

1. every material authoritative mutation door creates/binds one reconstructable ContractRevision;
2. concurrent revisions cannot produce duplicate/ambiguous revision sequence or lose current-state lineage;
3. manual, KEY, extraction and migration/correction paths share the same revision contract;
4. uncertain AI assertions cannot become high-impact authoritative fields without the configured promotion policy;
5. accepted promoted values retain source/evidence linkage to the exact ContractRevision;
6. repeated sweep/retry for the same renewal cycle converges on the same RenewalOccurrence;
7. a later renewal cycle becomes a distinct actionable occurrence;
8. ordinary unrelated Contract edits cannot discharge renewal work;
9. renewal-date/notice corrections cancel/update/supersede stale work correctly;
10. an explicit RenewalDecision closes only the intended occurrence;
11. local ContractAlert recomputation cannot erase durable user disposition if acknowledgement remains supported;
12. local informational renewal visibility cannot masquerade as actionable due work;
13. retention policy / retentionUntil participate in destructive-disposition eligibility when configured as enforceable;
14. hard delete cannot silently destroy required revision/evidence history before a permitted disposition decision;
15. source Contract deletion/archival converges dependent operator work explicitly;
16. advisory clause analysis remains derived unless explicitly promoted;
17. existing KF-REC-047/048/049/051/052/053 owners remain authoritative for their delegated semantics;
18. no implementation packet creates a universal Contract mega-runtime.

---

# 13. Migration pressure

A future implementation programme should prefer staged convergence:

```text
A. characterize existing Contract/Version/Term/Alert data and active obligations
B. introduce revision read/write contract around current writers
C. preserve/associate extraction assertions and accepted revision linkage
D. introduce renewal occurrence identity without breaking existing obligation projection
E. add explicit renewal decision semantics / migrate safe historical evidence where derivable
F. make retention/archive/delete policy load-bearing
G. simplify ContractAlert persistence according to final informational-vs-durable role
H. cut over consumers and remove compatibility paths after parity proof
```

Historical ambiguity must be preserved as ambiguity rather than fabricated during backfill.

---

# 14. Promotion / convergence gate

Before KF-REC-055 is considered converged:

- complete J11 backward re-audit across J12/J23/J18/J17/J7/J3-J4 and K4/K6/K7/K8/K11;
- verify no parallel Contract truth/provenance/attention/temporal system is introduced;
- pressure-test source-document correction/deletion interaction with ContractRevision provenance;
- define minimum product decision vocabulary for renewal/non-renewal/termination/lapse;
- define retention field semantics: enforceable policy vs descriptive-only;
- decide whether local ContractAlert acknowledgement remains product-worthy;
- define concurrency and transaction boundaries for revision creation/current projection;
- design runtime/fault/concurrency proof plan;
- keep production implementation unauthorized until whole-system sequencing allows it.

No production implementation is authorized by KF-REC-055.
