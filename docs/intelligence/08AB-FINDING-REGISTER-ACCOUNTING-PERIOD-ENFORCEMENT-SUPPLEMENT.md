# KeyFlowOS Finding Register — Accounting Period Enforcement Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F192 — AccountingPeriod can be marked CLOSED without making the canonical posting path reject new back-dated entries into that period

**Status:** VERIFIED CODE-LEVEL / FINANCIAL-CONTROL ENFORCEMENT FINDING

`AccountingPeriodService.close()` marks an accounting period `CLOSED` and stamps every *existing* in-period `FinancialTransaction.metadata.lockedByPeriod`.

`AccountingPeriodService.checkClosed(businessId, date)` can query whether a date lies inside a closed period.

Repository-wide search in this tranche found no caller of `checkClosed()` outside `AccountingPeriodService` itself. In particular, the canonical `PostingService.post()` path does not invoke it before creating a new `FinancialTransaction` and `LedgerEntry` rows with the caller-supplied posting date.

Therefore the reachable sequence is:

```text
period P
→ AccountingPeriod.status = CLOSED
→ existing transactions stamped lockedByPeriod
→ later PostingService.post(date inside P)
→ new FinancialTransaction + LedgerEntry inserted into P
```

The new transaction is not part of the close-time stamp set and can alter ledger/report balances for a period that the product represents as closed.

This is distinct from F191:

- **F191** concerns a reconciliation lock on historical entries being too strong for a later current-period corrective reversal.
- **F192** concerns `AccountingPeriod.status=CLOSED` being too weak because new back-dated accounting truth can still be inserted into the closed period.

The two together reveal two independent closure mechanisms with opposite enforcement failures:

```text
Reconciliation lock: can over-block later corrective consequence
AccountingPeriod close: does not block later in-period posting
```

Target law:

```text
ACCOUNTING PERIOD CLOSED
→ canonical posting authority for dates in that period is denied
unless an explicit governed reopen / adjustment policy applies
```

A reopen operation may legitimately restore posting authority, but closure must be load-bearing at the single ledger-write door rather than represented only by status/metadata on rows that already existed at close time.

Affected kernels: K3, K8, K10, K11.
Affected journeys: J7, J15, J18, J23.

No production implementation is authorized by this supplement.
