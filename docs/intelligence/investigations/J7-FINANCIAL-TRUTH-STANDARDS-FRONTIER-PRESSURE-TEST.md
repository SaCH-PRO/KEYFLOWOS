# J7 Financial Truth — Standards / Frontier Pressure Test

Status: POOLED RESEARCH EVIDENCE — NOT IMPLEMENTATION AUTHORIZATION
Date: 2026-09-06
Implementation evidence head: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical target under pressure test: `KF-REC-052 — Financial Truth & Valuation Contract`

## 1. Method

KeyFlowOS does not adopt external standards or common architectures as its target by default.

```text
H1 — FLOOR
What must be true for production-grade correctness, safety and accounting coherence?

H2 — FRONTIER
What stronger properties are available from modern payment, event-processing, temporal and evidence-aware architectures?

H3 — KEYFLOW SYNTHESIS
What can KeyFlowOS uniquely compose because Business Graph + Genome + Temporal + Authority + Evidence + Recovery can share one governed model?
```

External sources are used as pressure evidence, not as automatic product requirements or legal/accounting advice.

---

## 2. H1 — accounting and valuation floor

### 2.1 Functional currency and presentation currency are distinct concepts

IAS 21 distinguishes:

- the entity's **functional currency** — the currency of its primary economic environment;
- a **foreign currency** — any other currency;
- a **presentation currency** — the currency in which financial statements are presented.

The standard's central problems include which exchange rate to use and how exchange-rate effects are represented.

Pressure on KeyFlow:

```text
Business.currency alone is insufficient to explain every stored monetary value.
```

A load-bearing target needs to distinguish at least:

```text
native transaction currency
functional/accounting currency
presentation/reporting currency
```

where they differ.

### 2.2 Transaction-time and reporting-time valuation are not the same operation

IAS 21 requires foreign-currency transactions to be recognised in functional currency using an exchange rate at the transaction date and requires monetary items to be retranslated using a closing rate at reporting time.

Pressure on KeyFlow:

```text
ONE ExchangeRate row
!= complete valuation semantics
```

Target valuation needs to declare:

- what is being converted;
- from/to currency;
- valuation purpose;
- effective timestamp/date;
- rate source/provenance;
- whether it is transaction-time, settlement-time, reporting-time or revaluation-time;
- whether later revaluation creates a separately explainable accounting consequence.

This strengthens F186/C136 and does not create a new root.

---

## 3. H1 — provider/webhook reliability floor

### 3.1 At-least-once delivery is normal provider behaviour

Current PayPal webhook documentation states that non-2xx delivery is retried and describes webhook delivery as at-least-once, requiring duplicate-safe handling.

Pressure on KeyFlow:

```text
provider event duplicate suppression
is necessary
but
provider event receipt alone is not sufficient evidence that business consequences completed
```

This directly strengthens F190/C140.

### 3.2 Receipt, claim and completion must be separate durable states

A robust ingress contract should therefore distinguish:

```text
RECEIVED
AUTHENTICATED
CLAIMED / PROCESSING
CONSEQUENCES_COMPLETE
FAILED_RETRYABLE
FAILED_FINAL
AWAITING_RECONCILIATION
```

Idempotency prevents duplicate occurrence/effect application; it must not suppress repair of missing descendants.

---

## 4. H2 — frontier properties worth importing

### 4.1 Consequence-completeness over binary success

Common payment integrations often stop at:

```text
provider success
+ local payment row
```

KeyFlow should model a stronger completion vector:

```text
ExternalOccurrenceKnown
MoneyMovementRecorded
AccountingConsequenceComplete
SourceDocumentConverged
ReconciliationStateKnown
ValuationStateKnown
OperatorProjectionConverged
```

A financial outcome may be complete on some dimensions and incomplete on others without collapsing into one SUCCESS/FAILED flag.

### 4.2 Financial lineage as a first-class graph

Rather than loosely joining string discriminators, the target can model:

```text
FinancialOccurrence
→ FinancialEffect / MoneyMovement
→ AccountingConsequence(s)
→ ReconciliationEvidence
→ Correction / Reversal lineage
→ Valuation facts
→ Derived projections
```

This strengthens F189, F191 and F195.

### 4.3 Closed-period policy should govern mutation, not erase representability

A mature ledger does not need to mutate closed historical entries to represent a later real-world refund or correction.

KeyFlow target:

```text
historical evidence remains immutable
+
new current-period correcting consequence remains representable
+
lineage to original closed event remains explicit
```

This is stronger than simply adding an "unlock" switch and supports F191/C141.

### 4.4 Projection contracts should be typed by truth basis

Instead of every UI independently calculating `paidAmount`, `cashBalance`, or `revenue`, projections can declare:

```text
metric identity
truth basis
asOf
currency / valuation basis
completeness
known exclusions
source freshness
rebuildability
```

This strengthens F185 and F194 and aligns with J17's derivative-attention discipline.

---

## 5. H3 — KeyFlow-specific synthesis

### 5.1 Financial Consequence Vector

Candidate target primitive inside KF-REC-052, not yet a standalone KF-CONCEPT:

```text
FinancialConsequenceVector {
  occurrenceCertainty
  moneyMovementState
  accountingState
  sourceDocumentState
  reconciliationState
  valuationState
  projectionState
}
```

Purpose: answer "what exactly is complete?" without conflating external payment, bookkeeping, reconciliation and UI state.

### 5.2 FinancialSourceIdentity

Retain the working target:

```text
FinancialSourceIdentity
= typed source discriminator
+ stable source id
+ consequence kind
+ version where required
```

It must be usable by posting, reversal, reporting, repair and reconciliation.

### 5.3 ValuationEvidence

Candidate target structure inside KF-REC-052:

```text
ValuationEvidence {
  nativeAmount
  nativeCurrency
  functionalAmount?
  functionalCurrency
  presentationAmount?
  presentationCurrency?
  rate?
  rateSource?
  effectiveAt
  valuationPurpose
  computedAt
}
```

Not every transaction requires every field; the contract must make absence deliberate rather than ambiguous.

### 5.4 Financial read semantics as reusable domain contracts

Instead of client/server copies of arithmetic:

```text
CanonicalInvoiceBalance
CanonicalCashPosition
CanonicalReceivablePosition
CanonicalPayablePosition
CanonicalValuation
```

should be reusable query/domain semantics with explicit basis metadata.

A projection may optimize/materialize these values, but it cannot silently redefine them.

### 5.5 Correction Completion Closure

Financial correction should borrow K4's influence-closure insight without collapsing domains:

```text
correction accepted
→ accounting descendant correction
→ document-state recomputation
→ reconciliation impact identified
→ derived projection convergence
→ operator attention reset/reissue where required
```

This is the financial specialization of descendant convergence, not a duplicate global concept.

---

## 6. Target rejection list

Reject as insufficient:

- one mutable `currentBalance` pretending to be cash truth;
- one business currency field pretending to solve multi-currency valuation;
- `WebhookEvent` seen/not-seen as processing lifecycle;
- `Payment.status` as proof of full financial completion;
- direct raw ledger writes outside one governed posting contract;
- closed periods enforced only by metadata on rows that already existed;
- reversing by mutating/deleting historical postings;
- one `Invoice.status` column controlled by multiple undeclared state machines;
- duplicated paid/refund arithmetic across UI surfaces;
- universal scalar "financial health" without basis/completeness metadata.

---

## 7. Current pressure-test verdict

`KF-REC-052` survives the standards/frontier pressure test and should be strengthened in five places:

1. **Financial consequence completeness** becomes an explicit multidimensional state rather than an implied invariant.
2. **ValuationEvidence** distinguishes native/functional/presentation currency and effective-rate semantics.
3. **Ingress processing lifecycle** separates receipt/idempotency from consequence completion and redrive.
4. **Closed-period correction architecture** permits governed current-period corrections while preserving historical immutability.
5. **Canonical read contracts** prevent product projections from reimplementing and weakening financial semantics.

No new canonical recommendation is required. These are refinements inside KF-REC-052.

No production implementation is authorized by this research artifact.
