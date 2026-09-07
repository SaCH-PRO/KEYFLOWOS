# J3/J4 — Commercial Relationship & Obligation Standards / Frontier Pressure Test

Status: ACTIVE TARGET-SYNTHESIS EVIDENCE
Last updated: 2026-09-06
Implementation baseline: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

Scope:
- J3 Lead → Customer → Cash
- J4 Booking → Service → Payment
- F197–F205 / C147–C155
- K4/K6/K7/K8/K9/K10/K11/K3

Method: standards and provider practice are the **floor**, not the target destination. Apply H1 FLOOR → H2 FRONTIER → H3 KEYFLOW SYNTHESIS.

---

# 1. Local pressure requiring synthesis

Current repository evidence says:

```text
commercial customer evidence
!= Contact lifecycle convergence                      [F197]

Deal WON + PAID Invoice
!= non-duplicative customer value                    [F198]

Booking COMPLETED
!= required receivable consequence exists            [F199]

DEPOSIT invoice D + FINAL invoice P
!= one settled service obligation P                  [F200]

Booking CANCELLED / NO_SHOW
!= financial disposition complete                    [F201]

BOOKING pipeline attribution + INVOICE realized row
!= directly additive revenue                         [F202]

canonical CRM status
!= KeyCortex read vocabulary                         [F203]

canonical booking.completed event
!= post-booking journey input/tool contract           [F204]

Contact.status
!= one stable lifecycle algebra                      [F205]
```

The combined root is larger than “fix CRM statuses” or “fix deposits”. KeyFlow lacks one explicit semantic contract connecting:

```text
party relationship
commercial evidence
commercial obligation
financial descendants
corrections/dispositions
value stage
operator/recovery visibility
```

without collapsing those dimensions into one record.

---

# 2. H1 — FLOOR

## 2.1 Event/message contracts must be machine-readable and versionable

Current external floor:

- CloudEvents defines common event identity/context and requires `source + id` uniqueness for distinct event instances; it provides `type`, optional `subject`, and optional `dataschema`, with incompatible schema changes expected to use a different schema URI.
- AsyncAPI 3.0 describes message-driven APIs in a machine-readable form; Message objects explicitly carry payload schemas and correlation IDs.

Implication for F204:

```text
event name coincidence
!= consumer contract compatibility
```

KeyFlow must be able to prove mechanically that:

```text
canonical event schema version
→ adapter
→ tool/action schema version
```

composes before an automated journey is admitted.

Floor requirement:
- typed event payload;
- event identity/correlation;
- schema version;
- compatibility validation;
- consumer mapping test;
- explicit semantic effect identity distinct from message identity.

## 2.2 Advance customer consideration is not automatically earned revenue or a second receivable

IFRS 15 presentation principles provide an accounting floor: when customer consideration is paid before the entity transfers the promised good/service, the relationship between performance and payment matters; advance consideration can represent a contract liability, while an unconditional right to consideration is a receivable.

This investigation is architecture work, not accounting/legal advice. The important system property is the distinction:

```text
customer paid early
!= service already earned
!= another independent service price becomes due
```

Implication for F200/F201:
- deposit/prepayment semantics require an explicit relationship to the underlying obligation;
- cancellation/no-show disposition depends on policy and performance state;
- settlement and revenue-recognition layers must remain distinguishable.

## 2.3 Partial payments, credits and overpayments require allocation against an obligation

Current Stripe invoicing supports multiple/partial payments against one invoice and exposes remaining amount/payment collections. Stripe also models credit-balance transactions that trace application and reversal of credits against invoices, and credit notes distinguish reduction of an open balance from refund/credit after payment.

Provider-specific mechanics are not the target. The floor property is:

```text
payment / credit / refund
→ allocated against a defined obligation
→ remaining amount is derivable
→ excess / reversal is explicit
```

This directly pressures the current `deposit invoice D + final invoice P` shape.

---

# 3. H2 — FRONTIER

## 3.1 Replace scalar lifecycle status with an evidence-derived relationship state vector

Conventional CRM products often expose one lifecycle stage plus opportunity stages. KeyFlow can do better because it already has:

- event/evidence history;
- Business Graph / Genome;
- governance;
- financial truth;
- temporal/recovery state;
- explicit Deal/Booking/Invoice/Payment artifacts.

Frontier direction:

```text
RelationshipStateVector {
  commercial_relationship
  relationship_health
  active_opportunity_state[]
  service_relationship_state
  financial_relationship_state
  recency / confidence / provenance
}
```

This is **not** a proposal for one giant table. It is a semantic composition contract over existing owners.

A consumer can request a lens:

```text
CRM list lens            → lifecycle + health
sales lens               → opportunities + lifecycle
retention lens           → lifecycle + health + realized history
KEY reasoning lens       → evidence + eligibility + contradictions
```

rather than overloading `Contact.status`.

## 3.2 Model commercial obligations as lineage, not document coincidence

Frontier direction:

```text
CommercialIntent / Offer / ServiceOccurrence
→ CommercialObligation
→ obligation components
→ invoices / credits / adjustments
→ payments / allocations
→ financial/accounting consequences
→ disposition / closure
```

One business obligation may have many documents and money movements. One document may represent only one stage of the obligation.

Needed identities/dimensions:

```text
CommercialObligationId
ObligationComponentId
source occurrence / service / deal / order
contracted/native amount + currency
value stage
amount due
amount allocated
amount credited/refunded/retained
remaining amount
policy/disposition basis
lineage refs
completion state
```

These may map onto existing IDs and models; no universal obligation table is justified yet.

## 3.3 Make missing descendants first-class negative evidence

Current F199 shows a structural observability hole:

```text
required invoice never created
→ no Invoice row
→ invoice-centric scanners see nothing
```

Frontier direction:

```text
ExpectedConsequence
→ SATISFIED | PENDING | FAILED | WAIVED | NOT_APPLICABLE | OUTCOME_UNKNOWN
```

A commercial/service occurrence can therefore expose a missing required descendant without fabricating the descendant itself.

This composes with J18/J23:
- durable recovery owner;
- certainty-aware retry;
- Temporal Work Projection;
- operator attention.

Do not create a universal expected-consequence table from this pressure test alone.

## 3.4 Value-stage semantics should be queryable, not embedded in metric names

Current F202 demonstrates that `RevenueAttribution` contains heterogeneous value stages.

Frontier direction:

```text
CommercialValueAssessment {
  lineage
  stage: EXPECTED | COMMITTED | INVOICED | COLLECTED | NET_REALIZED | REVERSED
  amount
  currency
  effective_at
  as_of
  confidence / completeness
  provenance
}
```

A dashboard should ask for a stage/basis rather than infer it from which table happened to be queried.

---

# 4. H3 — KEYFLOW SYNTHESIS

## 4.1 Commercial Relationship & Obligation Contract

KeyFlow-specific synthesis:

```text
PARTY / CONTACT
    ↓
Commercial Evidence Stream
    ├─ Deal WON/LOST
    ├─ Quote ACCEPTED/REJECTED
    ├─ Booking COMPLETED/CANCELLED/NO_SHOW
    ├─ Order fulfilled/refunded
    ├─ Invoice/payment financial evidence
    └─ relationship/contact evidence
    ↓
CustomerLifecycle evaluation
    + RelationshipHealth evaluation
    + active Deal/service state
    ↓
CommercialObligationLineage
    ↓
Expected consequences
    ↓
Invoice / Payment / Credit / Refund / Ledger descendants
    ↓
Disposition / closure evidence
    ↓
CommercialValueStage projections
    ↓
CRM / People / Growth / KEY / Command Center lenses
```

This creates one semantic mesh without requiring one monolithic runtime or database table.

## 4.2 Relationship transition policy is evidence-aware and correction-aware

Target lifecycle transition should not be hard-coded to one global trigger such as “first paid invoice”. Different businesses may define customerhood differently, but the semantics must still be governed.

Candidate policy shape:

```text
LifecycleTransitionPolicy {
  from
  to
  qualifying evidence predicates
  disqualifying / correction predicates
  confidence / evidence minimum
  manual override rules
  effective time
  version
}
```

Examples to pressure later:
- Deal WON may be enough for one sales-led business;
- first fulfilled/paid service may be stronger for another;
- a refunded purchase need not erase historical customerhood;
- churn/relationship termination may change current relationship state without rewriting history.

Key law:

```text
CORRECTION OF COMMERCIAL EVIDENCE
!= DELETION OF RELATIONSHIP HISTORY
```

## 4.3 Financial disposition is policy-selected but mechanically complete

For cancellation/no-show:

```text
source state + service performance + deposit/payment state + policy version
→ ServiceFinancialDisposition
   REFUND
   RETAIN_AS_EARNED_FEE
   APPLY_AS_CREDIT
   PARTIAL_REFUND
   CANCELLATION_FEE
   WAIVE_BALANCE
   BALANCE_REMAINS_DUE
   MANUAL_REVIEW
→ required financial descendants
→ completion evidence
```

The exact choices remain domain/business-policy dependent. The architectural requirement is that a disposition is explicit, versioned, evidence-backed and consequence-complete.

## 4.4 Event-to-action contract compilation

Instead of letting automation templates assume arbitrary payload shapes:

```text
DomainEventSchema vN
+ ActionSchema vM
+ MappingDefinition
→ compile/validate
→ compatibility result
→ only compatible journey definitions become executable
```

At runtime:

```text
EventOccurrenceId
→ validated adapter
→ exact ActionEnvelope
→ governance/Clearance
→ ExecutionClaim
→ EffectId
→ OutcomeEvidence
```

This turns F204 from a one-off mapping bug into a whole-system prevention property and composes directly with K3/K7/K8/K11.

## 4.5 Commercial obligation twin as a derived control view

Innovation candidate, not a new source of truth:

```text
Commercial Obligation Twin
= derived, recomputable control view over authoritative domain + financial state
```

It can answer:

- What was promised/owed?
- What has been invoiced?
- What has been paid/allocated?
- What remains due?
- What was cancelled/credited/refunded/retained?
- Which mandatory consequence is missing?
- Which source evidence supports each answer?
- Is the view stale/incomplete/contradicted?

This would let J17/J18/J23 discover **absence** and contradiction without becoming authority.

Do not materialize this as a new persistence system unless migration/proof analysis shows value beyond derived computation/projection.

---

# 5. Pressure-test against existing KeyFlow targets

## KF-REC-049 Business Knowledge Contract

Relevant but insufficient alone.

It governs provenance/revision/epistemic eligibility. It does not own:
- customer lifecycle transition algebra;
- commercial obligation allocation;
- cancellation financial disposition;
- value-stage accounting across commercial documents.

Relationship/obligation facts should feed K4 only after this domain contract produces truthful evidence.

## KF-REC-052 Financial Truth & Valuation Contract

Necessary but starts too late to own the full commercial relationship.

It governs:
- money movement;
- accounting/reconciliation/valuation;
- financial consequence completeness;
- canonical financial reads.

It should remain the financial descendant owner. A commercial obligation contract should reference KF-REC-052 rather than duplicate ledger/payment semantics.

## KF-REC-047 / 048 / 051

- KF-REC-047 can project due/missing commercial consequences.
- KF-REC-048 owns recovery certainty and safe retry/reconcile.
- KF-REC-051 can rank commercial obligations/relationship attention.

None should become the source of commercial relationship or obligation truth.

---

# 6. Recommendation pressure verdict

A distinct recommendation is justified if it remains bounded to:

```text
customer relationship state algebra
+ commercial obligation lineage
+ commercial value-stage semantics
+ service financial disposition contract
+ event-to-action schema composition
```

while explicitly delegating:
- epistemic provenance to KF-REC-049;
- financial/accounting truth to KF-REC-052;
- temporal projection to KF-REC-047;
- recovery to KF-REC-048;
- attention/ranking to KF-REC-051;
- execution authority to K3.

Working title:

> **KF-REC-053 — Establish a Commercial Relationship & Obligation Contract**

This is materially distinct from a conventional CRM lifecycle enum and from a universal order/payment model.

---

# 7. External references used as floor

Accessed 2026-09-06:
- CloudEvents Specification — event identity/context, type, source/id uniqueness, schema URI/versioning properties.
- AsyncAPI Specification 3.0 — machine-readable message payload schemas and correlation IDs.
- IFRS 15 Revenue from Contracts with Customers — presentation distinction between advance consideration/contract liability and receivable based on performance/payment relationship. Used only as architecture/accounting-semantic floor, not legal/accounting advice.
- Stripe Invoicing — partial payments, amount remaining, overpayments, credit balances, credit notes and refund/application mechanics. Provider implementation is reference evidence, not KeyFlow target architecture.

---

No production implementation is authorized by this pressure test.
