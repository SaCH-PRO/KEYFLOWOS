# KeyFlowOS Finding Register — Financial Truth Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F185 — FinancialAccount.currentBalance is initialization state but is consumed as live cash truth

`FinanceAccountsService.create()` writes `openingBalance` and `currentBalance` to the same opening value. Its update path does not maintain `currentBalance`, and `PostingService` writes `FinancialTransaction` / `LedgerEntry` without updating it.

Yet `SafeToSpendService` sums active CASH/BANK/PAYMENT_PROCESSOR `currentBalance` values as live `cashBalance`; maintained finance mapping identifies additional cash/runway/health consumers.

Therefore:

```text
LEDGER-DERIVED CASH MOVEMENT/BALANCE
!=
FinancialAccount.currentBalance initialized from opening balance
```

A stored convenience balance has become a competing financial-truth source.

Affected kernels: K10, K8.
Affected journeys: J7, J17.

---

## F186 — currency-tagged ledger entries are aggregated without a load-bearing valuation/conversion dimension

`PostingService` persists a currency on `FinancialTransaction` and each `LedgerEntry`.

`LedgerBalanceService.getAccountBalance()` aggregates by account, and `getTrialBalance()` groups by `accountId` only. Neither method separates currencies nor applies an FX valuation rate.

An ExchangeRate subsystem exists, but current finance mapping finds no posting/balance/reporting consumer.

Therefore:

```text
100 USD + 100 TTD
```

may enter a numeric account/report total as `200` if mixed-currency entries share the account.

Currency identity exists but reporting valuation semantics are not load-bearing.

Affected kernels: K10, K8, K9.
Affected journeys: J7, J3, J4.

---

## F187 — PayrollRun can claim PAID without payment or accounting consequences

`PayrollService.markRunPaid()` requires an APPROVED run and then performs only:

```text
PayrollRun.status = PAID
PayrollRun.paidAt = now
```

The service injects only PrismaService. No Payment, Expense, FinancialTransaction or LedgerEntry is created in the inspected path.

Therefore:

```text
PayrollRun = PAID
!= payroll money moved
!= payroll expense/liability posted
!= cash reduced
```

The operational payroll state claims a financial outcome stronger than its evidence/consequences.

Affected kernels: K10, K8, K6, K3.
Affected journeys: J7, J18, J17.

---

## Shared target pressure

These findings require explicit layered financial truth:

```text
commercial/operational document state
!= external money reality
!= KeyFlow payment/disbursement record
!= ledger/accounting truth
!= reconciliation truth
!= valuation truth
!= derived operator/reporting projection
```

No production implementation is authorized by this supplement.
