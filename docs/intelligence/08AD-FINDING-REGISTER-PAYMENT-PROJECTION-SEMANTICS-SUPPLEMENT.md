# KeyFlowOS Finding Register — Payment Projection Semantics Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Code-bearing baseline remains `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`.
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F194 — Product payment projections reconstruct gross successful receipts while canonical invoice truth nets refunds

**Status:** VERIFIED CROSS-SURFACE / DERIVED-FINANCIAL-PROJECTION FINDING

`InvoiceWorkflowService.computeBalance()` is the canonical invoice payment-balance semantic used by `reconcileFromPayments()`:

```text
SUCCESSFUL Payment amounts
- REFUNDED Payment amounts
= net paid
→ remaining
→ PARTIALLY_PAID / PAID
```

This means a refund can legitimately reopen a previously PAID invoice to PARTIALLY_PAID.

Several active product projections independently reconstruct payment state using only rows where:

```text
status == SUCCESSFUL
```

and ignore separate `REFUNDED` rows.

Verified examples include:

- `CommerceService.listPayments()` computes `paidAmount` from SUCCESSFUL rows only and `remaining = total - paidAmount`;
- invoice detail page computes `paidAmount` and `remaining` from SUCCESSFUL rows only;
- invoice stat cards do the same;
- invoice list payment progress uses SUCCESSFUL rows only;
- invoice payment-modal prefill computes remaining from SUCCESSFUL rows only;
- `FinanceOverviewService` computes `revenueThisMonth` from Payment rows with `status='SUCCESSFUL'`, excluding separate REFUNDED rows.

A reachable post-refund state can therefore be:

```text
canonical invoice workflow:
  paid = 100
  refunded = 40
  net = 60
  remaining = 40
  status = PARTIALLY_PAID

while product projection:
  paidAmount = 100
  remaining = 0
  payment progress = 100%
```

This is distinct from F188. F188 concerns a missing mandatory ledger consequence after a direct PayPal capture. F194 concerns **derived read semantics after the underlying Payment rows exist**.

It is also distinct from F185. F185 concerns `FinancialAccount.currentBalance` being an opening-balance snapshot consumed as live cash. F194 concerns multiple projections independently rebuilding Payment semantics and omitting refund subtraction.

Canonical law:

```text
GROSS SUCCESSFUL PAYMENT RECEIPTS
!= CURRENT NET PAID POSITION
```

and:

```text
DERIVED FINANCIAL PROJECTION
must reuse or be provably equivalent to canonical financial balance semantics
```

Target pressure:

- expose a canonical invoice/payment balance read contract rather than re-implementing status arithmetic in each UI/service;
- distinguish gross receipts, refunds, net receipts, outstanding balance and accounting revenue rather than naming all of them `paidAmount`/`revenue`;
- make projection basis and as-of semantics explicit where the number is reused for operator decisions;
- derived screens must converge after refund/reversal without requiring bespoke client logic.

Affected kernels: K6, K8, K10, K11.
Affected journeys: J3, J4, J7, J17.

No production implementation is authorized by this supplement.
