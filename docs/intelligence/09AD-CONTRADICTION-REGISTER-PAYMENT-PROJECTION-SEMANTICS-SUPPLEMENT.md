# KeyFlowOS Contradiction Register — Payment Projection Semantics Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C144 — canonical net invoice balance vs gross-successful payment projections

```text
InvoiceWorkflowService computes:
SUCCESSFUL - REFUNDED = net paid

while

multiple server/client projections compute:
SUCCESSFUL only = paidAmount / remaining / progress / revenue
```

A refund can therefore reopen an invoice canonically while active UI and finance projections still display the pre-refund paid amount, zero remaining, or 100% progress.

This violates the J7 rule that a derived financial projection must either reuse the canonical financial-balance contract or prove semantic equivalence to it.

Distinct from:
- C138 / F188 — omitted accounting consequence after direct PayPal capture;
- C135 / F185 — stale FinancialAccount.currentBalance consumed as live cash.

Target distinction:

```text
GROSS RECEIPTS
!= REFUNDS
!= NET RECEIPTS
!= OUTSTANDING BALANCE
!= ACCOUNTING REVENUE
```

No production implementation is authorized by this contradiction entry.
