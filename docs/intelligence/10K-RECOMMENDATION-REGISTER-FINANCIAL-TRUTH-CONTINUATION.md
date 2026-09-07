# KeyFlowOS Recommendation Register — Financial Truth Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-051
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## KF-REC-052 — Establish a layered Financial Truth & Valuation Contract

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary journey:** J7 — Financial Truth
**Primary kernel:** K10 — Financial Truth
**Secondary kernels:** K8 Evidence/Outcome, K9 External Reality, K6 State Transition, K11 Recovery/Reliability, K3 Governance

### Objective

Make every strong financial claim identify which truth layer owns it, what evidence/consequence establishes it, how it is valued, and how all derived projections converge.

Target layers:

```text
COMMERCIAL / OPERATIONAL DOCUMENT STATE
Invoice / Bill / PayrollRun / Expense / CreditNote / etc.

EXTERNAL MONEY REALITY
provider charge/capture/refund / bank occurrence / settlement

KEYFLOW MONEY-MOVEMENT RECORD
Payment / bank transaction / disbursement identity

ACCOUNTING TRUTH
FinancialTransaction + LedgerEntry

RECONCILIATION TRUTH
source/provider/bank ↔ ledger agreement + locks

VALUATION TRUTH
native currency + reporting currency + FX rate/provenance/effective time

DERIVED OPERATOR / REPORTING PROJECTION
cash / runway / safe-to-spend / aging / health / priority
```

Prime law:

```text
NO LAYER MAY SILENTLY CLAIM A STRONGER FINANCIAL OUTCOME THAN ITS EVIDENCE SUPPORTS
```

---

# A. Ledger ownership

Preserve the current strong single-door architecture:

```text
monetary accounting consequence
→ PostingService
→ deterministic posting identity
→ balanced Decimal entries
→ FinancialTransaction + LedgerEntry
```

Direct ledger writes remain prohibited except through an explicitly equivalent governed migration mechanism.

---

# B. Cash basis ownership

Choose one canonical architectural basis for current cash.

Preferred direction from current evidence:

```text
ledger-derived/reconciled account balance
→ cash projections
```

rather than an independently mutable `FinancialAccount.currentBalance`.

If `currentBalance` remains for performance/product reasons, it must be an explicit materialized projection with:

```text
source basis
computedAt
rebuild/reconcile semantics
freshness
completeness
```

and may not compete silently with ledger balance.

This resolves F185/C135.

---

# C. Financial outcome states

Operational states such as:

```text
PAID
REFUNDED
VOIDED
SETTLED
DISBURSED
REVERSED
```

must define their evidence contract.

Example target for payroll:

```text
PayrollRun APPROVED
→ payment/disbursement intent
→ current financial authority/control
→ actual disbursement or explicit manual external-payment evidence
→ accounting consequence
→ evidence/reconciliation
→ PayrollRun financially settled state
```

A product may support a manual “mark paid externally” path, but that must capture enough evidence to distinguish:

```text
USER ASSERTS EXTERNALLY PAID
from
KEYFLOW EXECUTED PAYMENT
from
BANK/PROVIDER CONFIRMED SETTLEMENT
```

and must create/repair the required accounting consequence.

This resolves F187/C137 without requiring KeyFlow to become the payroll payment processor.

---

# D. Multi-currency valuation

Before supporting cross-currency aggregation, define:

```text
native amount
native currency
reporting/base currency
FX rate
rate source
rate effective time
conversion policy / rounding
valuation amount
```

Target choices must be explicit:

### Option 1 — single-currency business/accounting scope initially

```text
business reporting currency enforced
→ reject/segregate incompatible postings
→ no false cross-currency addition
```

### Option 2 — multi-currency accounting

```text
native-currency ledger identity retained
+ reporting-currency valuation layer
+ explicit FX provenance/time
→ reports aggregate valued amounts, not raw heterogeneous numbers
```

Do not retain the current ambiguous middle state where currency tags exist but balance aggregation ignores them.

This resolves F186/C136.

---

# E. Reconciliation and recovery

J18/K9/K10/K11 semantics remain load-bearing:

```text
provider success
!= Payment persistence
!= ledger posting
!= invoice consequence convergence
```

When any stage is ambiguous or partially committed:

```text
external/provider truth
+ local payment state
+ ledger state
+ source document state
→ reconcile
→ repair missing local consequences idempotently
```

Do not classify provider success + local failure as provider failure.

Reversal/refund remains a new financial consequence, not destructive history mutation.

---

# F. Derived financial projections

Every derived product figure must expose or internally track:

```text
truth basis
asOf / computedAt
currency / valuation basis
source completeness
known exclusions
reconciliation state where material
```

Examples:
- safe-to-spend;
- cash runway;
- Command Center cash risk;
- aging;
- financial health;
- money-move recommendations.

A figure with known missing payroll/debt obligations may remain useful, but its uncertainty/completeness cannot disappear merely because a number is returned.

---

# G. Float → Decimal boundary

The current ledger is Decimal while many operational money fields are Float.

Do not change every field blindly during early migration.

Target principle:

```text
MONETARY VALUE HAS A DECLARED PRECISION / ROUNDING CONTRACT BEFORE IT BECOMES ACCOUNTING TRUTH
```

Migration should inventory which Float-based source fields can materially cause reconciliation drift and move them in dependency order, preserving API compatibility where needed.

---

# H. Relationship to J17 / KF-REC-051

Financial attention consumes K10 truth:

```text
current reconciled financial condition
+ materiality / due time / consequence
→ PriorityAssessment
```

not:

```text
CommandItem MONEY/HIGH label
→ financial truth
```

When financial source state resolves, attention/work projections must converge under KF-REC-051.

---

# I. Relationship to J15/J2 governance

High financial importance does not grant financial authority.

```text
financial action candidate
→ exact capability/action
→ current Clearance
→ effect ownership
→ financial/provider consequence
→ ledger/evidence convergence
```

Money-moving control remains K3/J15-owned.

---

# J. Positive seams to preserve

- `PostingService` single sanctioned ledger writer;
- Decimal posting validation;
- deterministic business-scoped externalRef idempotency;
- cross-business account/contact rejection;
- transactionally coupled payment/source + posting where already present;
- history-preserving reversal;
- reconciliation locks;
- provider event + Payment idempotency;
- invoice payment state recomputed from Payment rows;
- ledger-native reporting;
- explicit AR source-vs-ledger drift reporting;
- bank matching/reconciliation pipeline.

---

# K. Initial migration/proof gates

Before implementation:

1. map every consumer of `FinancialAccount.currentBalance` and choose ledger/projection replacement semantics;
2. characterize all paths that set strong financial statuses (`PAID`, `REFUNDED`, etc.);
3. map every ledger posting recipe and source transaction boundary;
4. decide single-currency enforcement vs multi-currency valuation target;
5. inventory Float monetary fields and reconciliation-risk priority;
6. define payroll/AP/change-order accounting consequence ownership;
7. define provider/bank/local partial-commit reconciliation;
8. define source/report/operator projection completeness metadata;
9. backward re-audit J3/J4/J17/J18/J23 plus K8/K9/K10/K11/K3;
10. produce fault-injection/proof obligations before any finance implementation packet.

No production implementation is authorized by KF-REC-052.
