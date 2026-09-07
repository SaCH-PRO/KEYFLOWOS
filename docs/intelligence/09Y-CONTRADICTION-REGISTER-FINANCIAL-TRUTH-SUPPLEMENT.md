# KeyFlowOS Contradiction Register — Financial Truth Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C135 — ledger cash truth vs stored currentBalance cash projection

The ledger records ongoing financial movements while `FinancialAccount.currentBalance` can remain at opening balance, yet product surfaces consume the latter as live cash.

```text
LEDGER SAYS CASH CHANGED
vs
currentBalance CAN SAY OPENING BALANCE
```

Affected kernels: K10, K8.
Affected journeys: J7, J17.

---

## C136 — ledger currency identity vs currency-blind balance aggregation

Ledger entries preserve a currency code, while account/trial-balance aggregation combines debit/credit by account without currency separation or valuation conversion.

```text
ENTRY VALUES ARE CURRENCY-SPECIFIC
vs
REPORT AGGREGATION TREATS THEM AS DIRECTLY ADDITIVE
```

Affected kernels: K10, K8, K9.
Affected journeys: J7, J3, J4.

---

## C137 — PayrollRun PAID vs absent proven payment/accounting effect

Payroll can transition to `PAID` with no Payment, Expense, FinancialTransaction or LedgerEntry created by the inspected path.

```text
PAYROLL WORKFLOW SAYS PAID
vs
FINANCIAL CONSEQUENCE MAY NOT EXIST
```

Affected kernels: K10, K8, K6, K3.
Affected journeys: J7, J18, J17.

---

## Target resolution pressure

Financial projections and operational states must declare what truth layer they represent and derive stronger claims only from appropriate evidence/consequences.

No production implementation is authorized by this contradiction supplement.
