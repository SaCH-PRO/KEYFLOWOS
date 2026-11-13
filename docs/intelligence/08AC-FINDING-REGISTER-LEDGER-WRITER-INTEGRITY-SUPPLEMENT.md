# KeyFlowOS Finding Register — Ledger Writer Integrity Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F193 — Expense voiding bypasses the canonical PostingService reversal door and directly writes FinancialTransaction + LedgerEntry rows

**Status:** VERIFIED CODE-LEVEL / LEDGER-WRITER INTEGRITY FINDING

The current J7 positive architecture treats `PostingService` as the sanctioned ledger writer and `PostingService.reverse()` as the canonical history-preserving reversal contract.

Repository search for `financialTransaction.create` found production writes in:

```text
PostingService
ExpensesService.voidExpense()
```

Repository search for `ledgerEntry.create` found the direct production call in:

```text
ExpensesService.voidExpense()
```

`ExpensesService.voidExpense()` loads every financial transaction for the Expense and manually performs:

```text
tx.financialTransaction.create(type=REVERSAL, reversalOfId=...)
→ for each original entry:
   tx.ledgerEntry.create(debit=e.credit, credit=e.debit)
→ Expense.status = VOID
```

This bypasses the canonical reversal door.

Consequences include bypassing or reimplementing controls that belong at `PostingService.reverse()`:

- reconciliation-lock enforcement;
- canonical reversal conflict behavior;
- canonical externalRef/idempotency semantics;
- centralized posting/reversal validation;
- any accounting-period enforcement subsequently added at the ledger write door;
- one-owner auditability for ledger mutation.

The immediate conflict with F191 is material. `PostingService.reverse()` refuses to reverse a reconciliation-locked original transaction, while `ExpensesService.voidExpense()` manually constructs reversal rows and does not inspect `lockedByReconciliationId`. The same financial invariant can therefore be enforced or bypassed depending on which reversal API a caller reaches.

This is distinct from F192:

- **F192**: AccountingPeriod closure is not enforced by the canonical posting door.
- **F193**: a domain service bypasses that canonical door altogether and independently writes ledger/reversal state.

Target law:

```text
ALL ORDINARY LEDGER CONSEQUENCES
→ ONE GOVERNED POSTING / REVERSAL CONTRACT
```

Domain services may own semantic recipes, but they must delegate ledger mutation to the canonical writer rather than duplicating the write protocol.

If a specialized reversal policy is required for Expense voiding, it should be expressed as an explicit PostingService capability/policy, not as a parallel raw ledger writer.

Affected kernels: K3, K8, K10, K11.
Affected journeys: J7, J18, J23.

No production implementation is authorized by this supplement.
