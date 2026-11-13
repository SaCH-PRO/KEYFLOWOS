# KF-JOURNEY-007 — Financial Truth

Status: **ACTIVE MICROSCOPIC FORENSICS / INITIAL TRANCHE**
Date activated: 2026-09-06
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J7 models how KeyFlowOS represents, proves, reconciles, reverses and reports money.

It is not merely a finance-module journey. It asks:

> When KeyFlow says cash exists, an invoice is paid, payroll was paid, revenue was earned, money is safe to spend, a refund occurred, or a balance is correct — which layer owns that truth and what evidence makes the claim valid?

Primary kernels:

```text
K10 Financial Truth
K8  Evidence / Outcome
K9  Integration / External Reality
K6  State Transition
K7  Temporal / Workflow
K11 Recovery / Reliability
K3  Governance where money-moving authority is material
```

Primary adjacent journeys:

```text
J3  Lead → Customer → Cash
J4  Booking → Service → Payment
J17 Command Center → Priority → Action
J18 Failure → Recovery
J23 Temporal Flow / Long-Running Workflow
J2/J15 for governed money movement
```

---

## B. Product intent

Target product behavior:

```text
commercial/business event
→ operational financial document/state
→ provider/bank/external money reality where applicable
→ exact ledger consequence
→ reconciliation / valuation
→ financial reports / safe-to-spend / operator attention
→ reversal/recovery without rewriting history
```

A user should be able to ask:

- How much cash do I actually have?
- What do customers owe me?
- What do I owe?
- Has this invoice actually been paid?
- Did payroll actually leave the business?
- What is safe to spend?
- What is the authoritative value in my reporting currency?
- Why does a report disagree with an operational screen?
- What was reversed/refunded, and what still needs reconciliation?

and receive an answer grounded in explicit financial-truth layers rather than whichever projection happened to be queried.

---

## C. Current architecture — strong core

Current finance mapping reveals an unusually strong ledger spine.

### C1. Single posting door

`PostingService` is the sanctioned writer of `FinancialTransaction` + `LedgerEntry`.

Properties:

```text
validate >=2 entries
exact debit XOR credit per line
non-negative amounts
balanced debits == credits within Decimal tolerance
cross-business account/contact rejection
deterministic externalRef = sourceType:sourceId:kind
business-scoped unique idempotency
P2002 race convergence
transactional FinancialTransaction + child LedgerEntry write
```

### C2. Reversal preserves history

`PostingService.reverse()`:

```text
original transaction remains
→ new mirrored REVERSAL transaction
→ reversalOfId linkage
→ original status REVERSED
```

and refuses reversal when reconciled entries are locked.

This is a strong K10/K8/K11 seam.

### C3. Revenue posting recipes

`RevenuePostingService` maps invoice/payment/refund semantics into ledger entries with accounting-basis awareness.

### C4. Payment + posting transactional seam

Current mapped payment success path creates the `Payment` and invokes revenue posting in one DB transaction, then invoice reconciliation recomputes the invoice payment state from all Payment rows.

### C5. Reporting reads ledger

Trial balance/general ledger and ledger reporting derive from `LedgerEntry`, not from arbitrary source rows.

### C6. AR drift is made visible

`ReceivablesService` computes receivables from both invoice rows and ledger and reports the delta instead of hiding disagreement.

These positive seams are architectural assets to preserve.

---

## D. Financial truth layers — working model

J7 currently requires at least these layers to remain distinct:

```text
1. COMMERCIAL DOCUMENT TRUTH
   Invoice / Bill / PayrollRun / Expense / CreditNote / etc.

2. EXTERNAL MONEY REALITY
   provider transaction / bank occurrence / settlement / refund / chargeback

3. PAYMENT / MONEY-MOVEMENT RECORD
   KeyFlow Payment / bank transaction / provider operation identity

4. ACCOUNTING TRUTH
   FinancialTransaction + LedgerEntry

5. RECONCILIATION TRUTH
   bank/provider/source ↔ ledger agreement and locks

6. VALUATION TRUTH
   currency / reporting-currency basis / FX rate + effective time

7. DERIVED OPERATOR / REPORTING PROJECTION
   cash balance, safe-to-spend, runway, aging, health, Command Center attention
```

Prime law:

```text
A LAYER MAY DERIVE FROM ANOTHER
BUT MAY NOT SILENTLY PRETEND TO BE THAT OTHER LAYER'S TRUTH
```

---

## E. Initial microscopic chain — payment

Working chain from current finance map:

```text
Invoice payable
→ provider checkout/order
→ provider event/capture
→ verified provider occurrence
→ provider event idempotency
→ Payment row
→ RevenuePostingService
→ PostingService
→ FinancialTransaction + LedgerEntry
→ reconcileFromPayments(invoiceId)
→ Invoice PARTIALLY_PAID / PAID
→ ledger reporting / AR reconciliation
```

Recovery/reversal:

```text
refund intent
→ provider refund truth
→ negative Payment
→ reverse original ledger posting / refund posting
→ invoice/payment reconciliation
→ reports / operator projections converge
```

J18/K9/K10 already established that provider success and local consequence completion remain separate until reconciled.

---

## F. Initial canonical findings

### F185 — FinancialAccount.currentBalance is initialization state but is consumed as live cash truth

`FinanceAccountsService.create()` sets:

```text
openingBalance = opening
currentBalance = opening
```

`FinanceAccountsService.update()` does not update `currentBalance`.

`PostingService` writes ledger transactions/entries and does not maintain `FinancialAccount.currentBalance`.

Yet `SafeToSpendService.calculate()` sums `FinancialAccount.currentBalance` across CASH/BANK/PAYMENT_PROCESSOR accounts as its live `cashBalance` input.

Maintained finance mapping identifies additional consumers including cashflow forecast, finance overview, finance intelligence, health score and OS surfaces.

Therefore KeyFlow has two incompatible cash notions:

```text
ledger-derived cash movement / balance
vs
FinancialAccount.currentBalance initialized from opening balance
```

This is a financial-truth ownership defect, not merely stale cache implementation.

### F186 — currency-tagged ledger entries are aggregated without a valuation/conversion dimension

`PostingService` persists `currency` on `FinancialTransaction` and every `LedgerEntry`.

But `LedgerBalanceService.getTrialBalance()` groups ledger entries only by `accountId` and sums debit/credit values without grouping or converting by currency.

`getAccountBalance()` similarly aggregates by account only.

Thus entries such as:

```text
100 USD
+ 100 TTD
```

can be treated as numeric `200` for an account/reporting chain unless upstream constraints happen to prevent mixed currency.

An `ExchangeRate` subsystem exists, but current finance mapping reports no consumer in posting/balance/reporting.

Currency metadata therefore exists without a load-bearing valuation contract.

### F187 — PayrollRun can claim PAID without payment or accounting consequences

`PayrollService.markRunPaid()` requires APPROVED then performs only:

```text
PayrollRun.status = PAID
PayrollRun.paidAt = now
```

The service injects only PrismaService.

No Payment, Expense, FinancialTransaction or LedgerEntry is created in the inspected path.

So:

```text
PayrollRun = PAID
!= payroll money moved
!= payroll expense/liability posted
!= cash reduced
```

This creates a financial-business state stronger than the evidence/consequences support.

---

## G. Initial contradictions

### C135 — ledger cash truth vs stored currentBalance cash projection

```text
Ledger entries record financial movement
while
FinancialAccount.currentBalance can remain opening balance
and product surfaces consume currentBalance as current cash
```

### C136 — ledger entry currency identity vs currency-blind balance aggregation

```text
LedgerEntry says amounts belong to specific currencies
while
trial/account balances add amounts by account without valuation conversion
```

### C137 — PayrollRun PAID vs no proven money/accounting effect

```text
Payroll lifecycle says paid
while
Payment / Expense / ledger consequence may not exist
```

---

## H. Initial J7 invariants

1. Ledger/accounting truth is produced through one sanctioned posting contract.
2. Operational document state is not automatically accounting truth.
3. Provider/bank success is not automatically local ledger/payment truth.
4. A `PAID` claim requires declared payment/effect evidence appropriate to that domain.
5. Reversal/refund writes new financial consequences; historical posting is not deleted.
6. Reconciled entries cannot be silently mutated/reversed without reconciliation-aware control.
7. Derived cash/runway/safe-to-spend projections identify their authoritative basis and completeness.
8. Stored convenience balances cannot silently compete with ledger-derived balances.
9. Multi-currency addition requires an explicit valuation basis or currency-separated output.
10. Native amount/currency and reporting amount/currency remain distinguishable.
11. FX rate provenance/effective time is part of valuation truth where conversion occurs.
12. Financial materiality/priority does not grant authority to move money.
13. Financial recovery consumes current K3/K8/K9/K10/K11 truth.
14. Product claims such as `PAID`, `REFUNDED`, `SAFE_TO_SPEND` or `CASH_BALANCE` must specify what layer of truth they represent.

---

## I. Positive seams to preserve

- one sanctioned PostingService;
- Decimal ledger arithmetic;
- deterministic posting idempotency;
- transactionally coupled source/payment + posting where already implemented;
- reversal transactions rather than destructive mutation;
- reconciliation locks;
- provider-event + Payment provider-id dedupe;
- `reconcileFromPayments()` recomputation rather than increment-only invoice payment state;
- ledger-native reporting;
- AR ledger-vs-invoice drift surfacing;
- bank reconciliation/matching pipeline;
- source-specific finance intelligence projection convergence patterns from J17.

---

## J. Current unresolved questions

1. Is ledger-derived cash the canonical cash basis everywhere, or should FinancialAccount become a maintained subledger projection with explicit reconciliation?
2. Is KeyFlow intentionally single-currency per business, or should reporting support multi-currency valuation?
3. What is the canonical reporting currency and FX effective-time policy?
4. Should payroll payment create a payment/disbursement record, ledger posting, Expense, or a bounded combination?
5. Which operational `PAID`/`REFUNDED`/`VOID` states across modules have complete financial consequence ownership?
6. Which source monetary fields still use Float and what migration/rounding boundary is required?
7. How should change orders/contracts/payroll become ledger consequences without duplicating commerce/expense truth?
8. What operator surfaces currently read source rows rather than ledger/reconciled financial truth?
9. Which provider/bank reconciliation paths can repair partial local consequences?
10. Which finance control mutations require J15/K3 current Clearance and which are ordinary bookkeeping entries?

---

## K. Exact next trace

```text
1. trace Invoice → Payment → posting → invoice reconcile → refund/reversal directly in source;
2. trace bank reconciliation locks and reversal interaction;
3. map all cash/safe-to-spend/runway consumers to their financial basis;
4. map currency/FX usage end-to-end and decide single-currency vs valuation target pressure;
5. trace payroll/AP/change-order money-claim gaps;
6. run taxonomy duplicate check before new IDs;
7. synthesize K10 Financial Truth ownership contract and target recommendation;
8. backward re-audit J3/J4/J17/J18/J23 plus K8/K9/K10/K11/K3.
```

No production implementation is authorized by this dossier.
