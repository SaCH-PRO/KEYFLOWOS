# KeyFlowOS Contradiction Register — Financial Consequence Completeness Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C138 — provider capture / Payment / Invoice completion vs missing payment accounting consequence

A direct PayPal capture can produce:

```text
provider capture = COMPLETED
Payment = SUCCESSFUL
Invoice = PAID
```

while the payment's deposit / AR-or-revenue ledger consequence is absent because the direct path bypasses `createPaymentWithPosting()`.

The later webhook sees the same provider capture id already present on `Payment` and returns before running the stronger posting path.

Contradiction:

```text
PAYMENT + INVOICE STATE SAY COMPLETE
while
ACCOUNTING CONSEQUENCE IS INCOMPLETE
and
DEDUPE SUPPRESSES NORMAL REPAIR
```

Related finding: F188.

---

## C139 — canonical invoice posting identity vs credit-note reversal lookup identity

The canonical invoice posting is written with:

```text
sourceType = 'Invoice'
```

while `CreditNoteService.apply()` queries:

```text
sourceType = 'INVOICE'
```

Contradiction:

```text
CANONICAL INVOICE LEDGER LINEAGE EXISTS
while
CREDIT NOTE REVERSAL LOOKUP CANNOT DISCOVER IT
```

because the financial-source discriminator vocabulary is not canonicalized.

Related finding: F189.

---

## Reused contradiction — no new ID for manual refund

The direct `PaymentsOpsService.refundCharge()` path remains an instance of the mature F155 recovery/consequence-completeness root and its existing contradiction lineage. No duplicate contradiction identity is allocated.

No production implementation is authorized by this supplement.
