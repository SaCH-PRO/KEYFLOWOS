# KeyFlowOS Recommendation Register — Commercial Relationship & Obligation Continuation

Status: CANONICAL RECOMMENDATION REGISTER CONTINUATION
Last updated: 2026-09-06
Production implementation: NOT AUTHORIZED

## KF-REC-053 — Establish a Commercial Relationship & Obligation Contract

Status: RECOMMENDED / TARGET-SYNTHESIS INPUT
Primary journeys: J3 Lead → Customer → Cash; J4 Booking → Service → Payment
Primary kernels: K6 State Transition, K8 Evidence & Outcome, K4 Business Knowledge
Critical adjacent kernels: K10 Financial Truth, K7 Temporal/Event/Workflow, K11 Recovery, K3 Governance, K9 External Reality
Canonical evidence: F197–F205 / C147–C155
Pressure test: `investigations/J3-J4-COMMERCIAL-RELATIONSHIP-OBLIGATION-STANDARDS-FRONTIER-PRESSURE-TEST.md`

---

# 1. Recommendation

Establish one semantic contract that governs how KeyFlow represents and derives:

```text
customer relationship state
+ commercial evidence
+ commercial obligation lineage
+ service/order/offer value stages
+ deposits/prepayments/remaining obligations
+ cancellation/no-show/commercial disposition
+ required descendant consequences
+ event-to-action schema composition
```

without creating one universal CRM status, one universal order table, or one universal financial runtime.

The contract should make KeyFlow able to answer, for any material customer/service sale:

1. What commercial relationship does this party currently have with the business?
2. What evidence supports that state, and under which policy version?
3. What was promised or owed in this commercial occurrence?
4. Which documents/payments/credits/refunds belong to that same obligation?
5. What has been invoiced, paid, credited, refunded, retained or remains due?
6. Which required consequence is missing?
7. What disposition applies after cancellation/no-show/correction?
8. Which value stage is a metric showing: expected, committed, invoiced, collected or net realized?
9. Can an automated event→action mapping be mechanically proven compatible before execution?

---

# 2. Why a distinct recommendation is required

## 2.1 KF-REC-049 is upstream/downstream epistemic governance, not commercial-state ownership

KF-REC-049 governs knowledge revision, provenance, EpistemicEligibility and learning correction.

It should consume truthful commercial relationship/obligation evidence; it should not define how a deposit settles a service price or what makes a party a current client.

## 2.2 KF-REC-052 is the financial descendant contract, not the commercial-origin contract

KF-REC-052 begins with commercial/operational financial state and governs money movement, accounting, reconciliation, valuation and financial consequence completeness.

KF-REC-053 sits immediately upstream and beside it:

```text
commercial relationship / obligation truth
→ financial consequence requirements
→ KF-REC-052 financial truth
```

KF-REC-053 must never reimplement PostingService, invoice balance, payment/reconciliation, FX valuation or accounting-period semantics.

## 2.3 J7/J18/J23 cannot infer a missing obligation from a row that does not exist

F199 demonstrates:

```text
Booking COMPLETED
→ required invoice creation fails
→ no Invoice row
→ invoice-centric recovery/attention scans see nothing
```

KF-REC-053 must make **expected commercial consequences** derivable from source state so K7/K11/J17 can project missing descendants without fabricating them.

---

# 3. Target contract

## 3.1 Customer relationship dimensions

Do not preserve the current overloaded `Contact.status` model as the target.

Required separation:

```text
CustomerLifecycleState
!= RelationshipHealthState
!= DealState / DealStage
!= tags / segments / annotations
```

### CustomerLifecycleState

Owns broad commercial relationship semantics.

Properties:
- canonical versioned algebra;
- transition policy;
- qualifying evidence;
- disqualifying/correction evidence;
- effective/business time;
- system-known time where needed;
- transition provenance;
- manual override policy;
- external adapter mappings.

The exact state enum is intentionally **not frozen yet**. Do not mechanically use observed words `LEAD/PROSPECT/CLIENT/LOST/CUSTOMER/churned/partner` as the final target algebra.

### RelationshipHealthState

Separate current condition such as active/healthy/cold/at-risk/dormant.

A dormant client remains historically/currently a client unless lifecycle policy says otherwise.

### DealState / DealStage

Opportunity-specific. One party may have multiple simultaneous Deals.

Deal WON is evidence available to lifecycle policy, not the party lifecycle itself.

## 3.2 CommercialObligationLineage

Working semantic envelope:

```yaml
commercial_obligation_id: stable semantic identity
business_id: tenant
party_id: contact/customer party
origin:
  type: booking|quote|deal|order|service_occurrence|other
  id: ...
  occurrence_id: ...
components:
  - component_id: ...
    kind: service|product|deposit|fee|discount|tax|credit|other
    contracted_amount: ...
    currency: ...
    effective_at: ...
value_state:
  expected: ...
  committed: ...
  invoiced: ...
  allocated_paid: ...
  credited: ...
  refunded: ...
  retained: ...
  remaining: ...
descendants:
  invoice_ids: []
  payment_ids: []
  credit_note_ids: []
  refund_ids: []
  financial_consequence_refs: []
disposition:
  type: ...
  policy_version: ...
  evidence_refs: []
completion:
  expected_consequences: []
  missing_consequences: []
```

This is a semantic contract, **not an approved new database table**.

Existing domain IDs should map to these identities wherever possible.

## 3.3 CommercialValueStage

Every commercial-value projection must explicitly identify its basis.

Minimum semantic stages to pressure-test:

```text
EXPECTED
COMMITTED
INVOICED
COLLECTED_GROSS
NET_REALIZED
REVERSED / CREDITED
```

Do not require every consumer to use every stage.

Required projection metadata:

```text
stage
amount
currency / valuation basis
commercial lineage
asOf
provenance
completeness
known exclusions
```

This prevents F198/F202-class cross-stage addition.

## 3.4 ServiceFinancialDisposition

Cancellation/no-show/correction must select an explicit commercial/financial disposition under a policy version.

Candidate outcomes:

```text
REFUND
PARTIAL_REFUND
RETAIN_AS_EARNED_FEE
APPLY_AS_CUSTOMER_CREDIT
CANCELLATION_FEE
WAIVE_REMAINING_BALANCE
BALANCE_REMAINS_DUE
MANUAL_REVIEW
NOT_APPLICABLE
```

This vocabulary remains target-candidate until business/product evidence refines it.

The contract must not assume all deposits are refundable or all retained deposits are earned revenue.

Once a disposition is selected, KF-REC-052 owns the financial descendants and K11 owns recovery/certainty.

## 3.5 Expected consequence semantics

A required descendant must be representable even when the descendant row is absent.

Target semantic shape:

```text
ExpectedConsequence {
  semantic_kind
  source_ref
  required_by_policy_version
  state: SATISFIED | PENDING | FAILED | WAIVED | NOT_APPLICABLE | OUTCOME_UNKNOWN
  expected_effect_identity
  observed_descendant_ref?
  last_checked_at
  failure/recovery_ref?
}
```

This is not automatically a universal persistence model.

It must be possible for:
- KF-REC-047 to project it;
- KF-REC-048 to recover it;
- KF-REC-051 to prioritize it;
- K8 to prove completion;
without those systems owning the obligation.

## 3.6 EventToActionContractAdapter

Prevent F204-class runtime incompatibility with a compile/testable contract:

```text
DomainEventSchema vN
+ MappingDefinition vX
+ Action/ToolSchema vM
→ compatibility validation
→ executable mapping only if valid
```

Required properties:
- canonical event identity/type/version;
- payload schema;
- explicit mapping;
- output/action schema validation;
- correlation/causal references;
- semantic EffectId derivation;
- compatibility tests at build/CI time;
- runtime validation/fail-closed behavior;
- migration/deprecation rules.

Message/plan idempotency must remain distinct from commercial effect idempotency.

---

# 4. Key invariants

1. One party lifecycle dimension has one canonical owner/algebra version.
2. Relationship health is not customer lifecycle.
3. Deal stage/status is not customer lifecycle.
4. Tags/segments do not silently become lifecycle truth.
5. External-provider customer labels require explicit adapter mapping.
6. Commercial evidence is retained even if current lifecycle state later changes.
7. Lifecycle transitions preserve evidence and policy provenance.
8. One commercial obligation may have multiple documents/payments; those descendants must share lineage.
9. A deposit/prepayment is allocated under explicit obligation policy; it is not silently additive.
10. Service completion does not imply financial completion.
11. Cancellation/no-show does not imply financial disposition completion.
12. Missing required descendant is explicit missing work, not absence of work.
13. Expected/committed/invoiced/collected/net-realized value are not directly interchangeable.
14. Revenue/LTV projections declare stage, currency/valuation basis and lineage.
15. Corrections/refunds preserve history and recompute current derived views.
16. Event name equality is not schema compatibility.
17. Automated event→action execution requires validated schema composition.
18. Plan/message idempotency is not commercial effect idempotency.
19. Financial descendants delegate to KF-REC-052.
20. Recovery delegates certainty/retry/compensation to KF-REC-048.
21. Attention projections delegate ranking to KF-REC-051.
22. Temporal/operator projections remain derived and non-authoritative.
23. Knowledge/learning consumes only epistemically eligible relationship/obligation evidence under KF-REC-049.
24. No single universal commercial table/runtime is required for semantic convergence.

---

# 5. Migration architecture pressure

## Phase A — characterize and inventory

- inventory persisted `Contact.status` values and origins;
- inventory `lifecycleStage`, `pipelineStage`, `relationshipHealth`, tags and Deal vocabularies;
- inventory booking/service deposit/final invoice relationships;
- inventory Booking.paymentStatus values and whether any real data differs from UNPAID;
- inventory RevenueAttribution rows by `revenueType`, source and cross-lineage duplicates;
- inventory event→journey mappings and schema compatibility.

## Phase B — establish semantic adapters/read contracts

Before destructive schema constraints:
- canonical lifecycle read adapter;
- provider/import mappings;
- commercial obligation lineage resolver;
- value-stage resolver;
- expected-consequence resolver;
- typed event/action adapters.

## Phase C — backfill/migrate

- map genuine lifecycle aliases;
- relocate leaked relationship-health values;
- preserve ambiguous historical values as unresolved evidence rather than guessing;
- connect deposit/final invoice descendants to obligation lineage;
- classify attribution stage;
- backfill expected-consequence state where deterministically derivable.

## Phase D — enforce write doors

- prevent direct unvalidated Contact lifecycle writes from integrations;
- require commercial obligation/effect identity on relevant document generation;
- require cancellation/no-show disposition policy where financial descendants exist;
- require event→action schema compatibility for automated journey activation.

## Phase E — consumer cutover

Cut consumers by risk:
1. AI/KeyCortex and operator projections;
2. CRM/People segmentation;
3. growth/revenue attribution;
4. lifecycle automations;
5. write paths and destructive schema constraints only after parity proof.

---

# 6. Proof architecture pressure

Required future proof classes:

### Customer lifecycle
- Shopify/customer integration cannot persist an undeclared lifecycle alias without mapping.
- relationshipHealth cannot leak into lifecycle state.
- Deal WON/Invoice PAID evidence produces only policy-authorized lifecycle transition.
- correction/refund does not erase historical commercial evidence.
- all major CRM/People/KEY consumers observe one canonical lifecycle interpretation.

### Commercial obligation
- deposit + final invoice never exceed intended obligation unless explicit fee policy says so.
- partial payment/credit/refund allocation yields deterministic remaining obligation.
- cancellation/no-show selects one disposition and proves required descendants.
- missing completion invoice is observable/recoverable without an Invoice row.
- repeated repair does not duplicate the commercial effect.

### Value stage
- same sale cannot be double-counted across Deal/Booking/Invoice stages in a stage-specific metric.
- mixed currencies require KF-REC-052 valuation semantics.
- net-realized views respond correctly to refund/credit/reversal.

### Event/action compatibility
- incompatible event/tool schemas fail CI or activation before runtime effect pursuit.
- mapping version is traceable from event occurrence to effect/outcome.
- schema migration can run old/new versions concurrently under explicit compatibility rules.

---

# 7. Innovation value

KF-REC-053 should differentiate KeyFlow from a conventional CRM by treating relationship and obligation state as **evidence-linked, correction-aware, cross-domain computed semantics** rather than mutable labels.

Potential KeyFlow advantage:

```text
Business Graph evidence
+ CustomerLifecycle policy
+ CommercialObligationLineage
+ KF-REC-052 Financial Truth
+ KF-REC-047 Temporal Projection
+ KF-REC-048 Recovery
+ KF-REC-051 Attention
+ KF-REC-049 Epistemic Eligibility
→ explainable commercial operating twin
```

This can support questions conventional isolated systems struggle to answer coherently:

- “This client cancelled after paying a deposit — what is actually owed, what must we do, and why?”
- “This completed service has no invoice — is that intentional, failed, waived or missing?”
- “Why is this person classified as a current client?”
- “Which revenue number is pipeline versus collected versus net realized?”
- “Which automated follow-up is blocked because its event/action contract no longer matches?”

The differentiation comes from composition and evidence, not from inventing another monolithic platform primitive.

---

# 8. Explicit non-goals

KF-REC-053 does NOT authorize:
- production code changes;
- a universal commercial-obligation database table;
- replacement of Deal/Booking/Invoice/Payment models;
- one giant Contact status enum;
- hard-coded accounting treatment of deposits;
- new financial ledger semantics outside KF-REC-052;
- a universal workflow engine;
- AI deciding lifecycle or financial disposition without policy/evidence/governance.

---

# 9. Relationship to canonical evidence

Primary findings:
```text
F197 F198 F199 F200 F201 F202 F203 F204 F205
```

Primary contradictions:
```text
C147 C148 C149 C150 C151 C152 C153 C154 C155
```

No production implementation is authorized by this recommendation.
