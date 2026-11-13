# J11 — Contract / Obligation / Renewal Standards & Frontier Pressure Test

Status: CANONICAL SUPPORTING INVESTIGATION
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED

## Purpose

Pressure-test J11 findings F215–F218 and the emerging target boundary against current authoritative records/provenance standards and useful open/open-source implementation patterns.

This is not a compliance certification exercise. No jurisdiction-specific retention period or legal obligation is inferred. The purpose is to test whether KeyFlowOS's proposed invariants are structurally sound and whether simpler existing patterns can prevent unnecessary architecture.

---

## 1. Evidence set

### ISO 15489-1:2016 — records-management concepts and principles

Official ISO page: `https://www.iso.org/standard/62542.html`

Current status: published and confirmed. ISO describes principles for records, record metadata, policies/responsibilities, records requirements, records controls, and processes for creating/capturing/managing records over time.

Transferable pressure:

```text
business record
→ trustworthy context + metadata + controls over time
```

ISO's public explanation also frames record systems around evidence of business activity and protection of authenticity, reliability, integrity and usability.

### ISO 23081-1:2017 — metadata for records

Official ISO page: `https://www.iso.org/standard/73172.html`

Transferable pressure:

```text
record metadata
→ describe the object + context + actions/processes affecting it
→ support assertions about authenticity/reliability/integrity/usability over time
```

This strongly supports actor/source/process/revision provenance without dictating an event-sourced persistence model.

### ISO 16175-1:2020 — functional requirements for software managing digital records

Official ISO page: `https://www.iso.org/standard/74294.html`

The standard explicitly applies not only to dedicated records-management systems but also to applications whose primary purpose is another business function while they manage digital records.

Transferable pressure:

```text
KeyFlow need not become an EDMS
but Contract-domain software should not make record integrity impossible
```

### ISO/TS 7538:2024 — disposition of records

Official ISO page: `https://www.iso.org/standard/83150.html`

The 2024 specification addresses responsibilities, assessment, implementation and operational integration for record-disposition processes. ISO's SC11 summary explicitly refers to retention periods, disposition processes/authorities and destruction requirements.

Transferable pressure:

```text
retention/disposition
→ explicit process + responsibility/authority
→ not a decorative field bypassed by destructive delete
```

No jurisdiction-specific duration is imported into KeyFlow.

### W3C PROV-O Recommendation

Official W3C Recommendation: `https://www.w3.org/TR/prov-o/`

PROV-O explicitly models:

```text
Entity
Agent
Activity
wasDerivedFrom
wasRevisionOf
wasAttributedTo
hadPrimarySource
wasInvalidatedBy / invalidatedAtTime
```

Transferable pressure:

```text
new ContractRevision
→ relation to prior revision / source / actor / generating activity
```

KeyFlow does not need RDF/OWL or the full PROV ontology. The useful principle is explicit provenance and revision/invalidation lineage.

### Open Contracting Data Standard 1.1.5

Official standard: `https://standard.open-contracting.org/latest/en/`

Relevant patterns:

- releases are immutable snapshots of information at a point/event in the contracting process;
- changed information is published in a new release;
- records can compile releases into current state and versioned history;
- contract amendments can carry date, rationale and links between before/after releases;
- contract IDs remain stable within the contracting process;
- related processes can represent renewal/replacement processes.

Transferable pressure:

```text
stable Contract identity
+ immutable/reconstructable revision lineage
+ explicit amendment/correction/lifecycle rationale
+ current compiled projection
```

OCDS is a public-procurement disclosure standard, not a generic CLM ontology. KeyFlow should borrow the separation, not its full schema.

### Temporal durable-work model

Current Temporal documentation distinguishes Workflow Definition from Workflow Execution and stores a durable Event History per execution. Workflow ID and Run ID provide separate levels of identity; schedules can create repeated runs over time.

Useful sources:
- `https://docs.temporal.io/workflow-execution`
- `https://docs.temporal.io/workflow-execution/workflowid-runid`

Transferable pressure:

```text
definition/source identity
!= concrete execution/occurrence identity
```

This reinforces the already-mature J23/KF-REC-047 law. J11 should not build its own workflow engine.

### Paperless-ngx / Mayan EDMS implementation patterns

Paperless-ngx documents:

```text
document change history → audit log
initial delete → trash
permanent deletion later / separately
```

Mayan EDMS documents:

```text
document versions
retention policies
event tracking
trash vs permanent deletion
```

These are implementation examples, not normative standards. Their useful pressure is that preserving history, separating reversible removal from permanent destruction, and making retention load-bearing can be implemented without requiring an all-purpose event store.

---

## 2. F215 pressure test — Contract revision integrity

Current defect:

```text
current Contract mutates
while ContractVersion is metadata-only / incomplete / bypassable
```

Standards/frontier verdict: **STRONGLY VALIDATED**.

Common pressure across ISO metadata, W3C PROV and OCDS:

```text
current record state
!= sufficient historical/provenance evidence
```

Minimum KeyFlow target:

```text
ContractRevisionId
ContractId
priorRevisionId where applicable
mutationClass / rationale where material
actor / source / generating mechanism
recordedAt
businessEffectiveAt where material
reconstructable authoritative state OR deterministic reconstructable delta
source/evidence references
```

Rejected overbuild:

- mandatory event sourcing for the whole Contract aggregate;
- RDF/OWL provenance store;
- full OCDS release schema;
- generic immutable ledger shared by every KeyFlow domain.

A normal relational revision table with snapshots/deltas can satisfy the target.

---

## 3. F216 pressure test — extraction evidence versus authoritative truth

Current defect:

```text
probabilistic document extraction
→ direct authoritative Contract mutation
→ field-level confidence/verification/promotion evidence lost
```

Standards/frontier verdict: **STRONGLY VALIDATED**.

W3C/ISO pressure says record provenance should preserve source/agent/process context. OCDS likewise distinguishes source releases/documents and later compiled state.

Minimum KeyFlow target:

```text
ContractAssertion / source evidence
→ extractor/model + confidence + source span/ref + source revision
→ verification/conflict/promotion decision
→ accepted ContractRevision
```

Delegation:

```text
provenance / epistemic eligibility machinery → KF-REC-049
J11 owns only contract-domain promotion policy and accepted revision linkage
```

Rejected overbuild:

- second J11 knowledge engine;
- mandatory human review for every low-impact extracted field;
- storing every model token/prompt in the Contract domain.

---

## 4. F217 pressure test — renewal decision evidence

Current defect:

```text
PATCH contains status=ACTIVE
→ interpreted as renewal decision resolved
```

Standards/frontier verdict: **VALIDATED AS A DOMAIN-SEMANTIC DEFECT**.

OCDS distinguishes current contract status from contract updates, amendments and termination events/releases. Temporal distinguishes a reusable definition from concrete executions/runs.

Transferable principle:

```text
current Contract lifecycle projection
!= evidence of a particular renewal-decision occurrence
```

Minimum KeyFlow target:

```text
RenewalOccurrenceId
→ derived from Contract + relevant ContractRevision + renewal cycle/date
→ decision evidence: RENEW | NON_RENEW | TERMINATE | LAPSE_ACCEPTED | SUPERSEDE etc.
→ actor/source/effectiveAt/rationale where material
→ settle/supersede exactly that occurrence
```

Exact decision vocabulary remains product-policy work; the invariant is occurrence-specific evidence.

Delegations:

```text
occurrence/work mechanics → KF-REC-047
operator work/disposition → KF-REC-051
commercial obligation discipline → KF-REC-053
```

Rejected overbuild:

- a separate contract workflow runtime;
- treating every Contract.status edit as a domain event;
- forcing all contracts through one universal renewal state machine if contract types need bounded variation.

---

## 5. F218 pressure test — retention and destructive disposition

Current defect:

```text
retentionPolicy / retentionUntil exist
but deleteContract ignores them
and cascade-deletes Contract-owned evidence/history
```

Standards/frontier verdict: **STRONGLY VALIDATED**, without importing legal durations.

ISO/TS 7538 specifically treats disposition as a managed process with responsibility/authority and operational integration. EDMS patterns show practical separation of normal removal/trash/archival from permanent destruction.

Minimum KeyFlow target:

```text
RetentionDeletionDecision:
  ContractRevision
  requestedAction
  retentionPolicy / retentionUntil
  hold/dependency state where applicable
  actor/authority
  reason / override evidence
  decision: ARCHIVE | RETAIN | DELETE_ALLOWED | REVIEW/HOLD
```

Permanent destruction should leave enough durable evidence to explain the disposition according to the product's own policy. The exact tombstone/audit shape is not frozen.

Rejected overbuild:

- jurisdiction-specific legal retention engine before product requirements exist;
- WORM storage for every Contract by default;
- full enterprise legal-hold platform;
- retaining full contract contents forever after permitted deletion.

---

## 6. ContractAlert / operator attention pressure test

No external standard creates a reason to keep `ContractAlert` as a second durable obligation system.

Best-fit target remains:

```text
local contract-detail time-relative facts
→ cheap derived projection

owed renewal decision
→ RenewalOccurrence
→ canonical obligation/operator attention
```

If local acknowledgement is retained as durable product semantics, it needs stable semantic identity/disposition. Otherwise derive alerts ephemerally and avoid a separate acknowledgement store.

Verdict: **delegate to KF-REC-047/051; do not create a J11 attention runtime.**

---

## 7. clauseAnalysis value-density pressure test

`ContractClauseService` explicitly classifies zero-shot clause extraction as advisory and human-review-oriented, yet persists `clauseAnalysis` directly on Contract. Repository search found no independent consumer outside the extractor path.

Current classification:

```text
DERIVED / ADVISORY PROJECTION
+ persistence-value question
```

Target options:

```text
A. if consumed later → store as provenance-aware analysis/evidence projection
B. if only immediate tool response → stop persisting it
C. if promoted into authoritative clauses → route through KF-REC-049 + ContractRevision promotion
```

Do not turn advisory analysis into authoritative history merely because it shares the Contract row.

---

## 8. Minimum target primitives after pressure test

The pressure test leaves four bounded J11 responsibilities that are not fully owned by adjacent generic contracts:

```text
1. ContractRevision
   authoritative agreement-state revision lineage

2. ContractAssertionPromotion
   contract-specific acceptance of source/extraction assertions into a revision
   (generic epistemics delegated to KF-REC-049)

3. RenewalDecision binding
   Contract + relevant revision + RenewalOccurrence → occurrence-specific decision evidence
   (occurrence mechanics delegated to KF-REC-047; attention to KF-REC-051)

4. RetentionDeletionDecision
   contract-record archival/destruction eligibility + disposition evidence
```

These form one bounded **Contract Integrity & Renewal** responsibility, not four new infrastructure subsystems.

---

## 9. Anti-mega-runtime test

Target must NOT become:

```text
universal event store                       NO
universal document/records management suite NO
second knowledge/provenance engine          NO
second temporal/workflow engine             NO
second operator attention queue             NO
second commercial obligation engine         NO
jurisdiction-wide legal rules engine        NO
```

It SHOULD compose existing owners:

```text
K4/KF-REC-049 → provenance / epistemic eligibility
K7/KF-REC-047 → recurrence / WorkOccurrence
K11/KF-REC-048→ uncertainty/recovery
J17/KF-REC-051→ operator attention/disposition
J7/KF-REC-052 → valuation
J3/J4/KF-REC-053→ commercial obligation discipline
```

---

## 10. Recommendation-allocation verdict

After delegation, irreducible Contract-domain semantics remain:

```text
what constitutes an authoritative ContractRevision
what revision/source a renewal derives from
what evidence constitutes a renewal decision for one occurrence
what contract-specific retention/disposition decision governs archival/destruction
```

These semantics are coherent, bounded and high-value. They are not owned by KF-REC-049, 047, 051 or 053 individually.

**Pressure-test verdict: allocate one bounded J11 recommendation, not additional findings/infrastructure.**

Proposed name:

`KF-REC-055 — Contract Integrity & Renewal Contract`

Allocation still requires the canonical 04A/04B anti-duplication gate before creation.

No production implementation is authorized by this investigation.
