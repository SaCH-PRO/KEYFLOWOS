# KeyFlowOS Contradiction Register — Ledger Writer Integrity Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C143 — Canonical reversal controls contradict a parallel raw Expense reversal writer that can bypass them

Expected:

```text
all ledger reversals
→ PostingService.reverse() or an explicitly equivalent governed contract
→ one set of lock/idempotency/validation/audit rules
```

Observed:

```text
PostingService.reverse()
→ enforces reconciliation-lock checks

ExpensesService.voidExpense()
→ directly creates FinancialTransaction + LedgerEntry reversal rows
→ no equivalent reconciliation-lock check observed
```

The same accounting invariant therefore depends on call path.

This contradiction is canonical with F193.

No production implementation is authorized by this supplement.
