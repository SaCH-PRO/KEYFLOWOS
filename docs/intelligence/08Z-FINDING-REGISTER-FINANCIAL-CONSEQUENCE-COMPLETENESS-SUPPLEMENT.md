# KeyFlowOS Finding Register — Financial Consequence Completeness Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F188 — Direct PayPal capture can make Payment and Invoice truth terminal while permanently omitting the payment ledger consequence

**Status:** VERIFIED CROSS-LAYER / FINANCIAL-CONSEQUENCE COMPLETENESS FINDING

`PaymentsService` already contains a strong transactional helper:

```text
createPaymentWithPosting()
→ create Payment
→ if SUCCESSFUL: RevenuePostingService.onPaymentRecorded()
→ PostingService
→ FinancialTransaction + LedgerEntry
→ same DB transaction
```

The direct browser-driven PayPal capture path does not use that helper.

Observed chain:

```text
capturePaypalOrder(orderId, invoiceId)
→ PayPal returns COMPLETED
→ derive provider captureId
→ prisma.payment.create(status=SUCCESSFUL, providerPaymentId=captureId)
→ invoiceWorkflow.reconcileFromPayments(invoiceId)
```

No `RevenuePostingService.onPaymentRecorded()` call is made by this direct capture path.

`reconcileFromPayments()` is independently strong: a SUCCESSFUL Payment can move the Invoice to `PAID`, and when that happens the invoice status update and inventory COGS posting are transactionally coupled. Therefore the reachable state can be:

```text
provider capture = COMPLETED
Payment = SUCCESSFUL
Invoice = PAID
COGS consequence = possibly posted
payment deposit / AR-or-revenue ledger leg = ABSENT
```

The later `PAYMENT.CAPTURE.COMPLETED` webhook would normally use `createPaymentWithPosting()`, but it first deduplicates by the same `providerPaymentId`. The direct capture row therefore causes the webhook to return as already processed before the missing ledger consequence is repaired.

This is distinct from F158:

- F158: provider capture succeeded but **local Payment persistence failed**, and failure semantics/lineage impede reconciliation.
- F188: provider capture and local Payment persistence **both succeed**, but one mandatory local accounting consequence is omitted and occurrence dedupe suppresses the stronger repair path.

It strengthens the mature consequence-completeness law already used by F155:

```text
OCCURRENCE / PAYMENT DEDUPE
!= FINANCIAL CONSEQUENCE COMPLETENESS
```

and:

```text
Payment.status = SUCCESSFUL
or Invoice.status = PAID
!= payment accounting consequence complete
```

Target pressure:

- all successful provider-payment ingestion paths must converge through one consequence-complete payment-recording contract, or an equivalent idempotent repair contract;
- dedupe must suppress duplicate provider effects/occurrences, not suppress missing mandatory local consequences;
- financial completion checks should be consequence-aware across provider occurrence, Payment, ledger posting and Invoice reconciliation.

Affected kernels: K8, K9, K10, K11, K6.
Affected journeys: J3, J4, J7, J18, J23.

---

## F189 — CreditNote application cannot reach canonical Invoice ledger lineage because its source discriminator does not match the posting writer

**Status:** VERIFIED CODE-LEVEL / FINANCIAL-LINEAGE IDENTITY FINDING

`RevenuePostingService.onInvoiceFinalized()` writes the canonical invoice posting with:

```text
sourceType = 'Invoice'
sourceId   = <invoice id>
kind       = 'invoice_finalized'
```

`CreditNoteService.apply()` attempts to locate the original invoice revenue and AR ledger entries using:

```text
transaction.sourceType = 'INVOICE'
transaction.sourceId   = <invoice id>
```

The discriminator comparison is case-sensitive. The credit-note lookup therefore does not match the canonical posting written by RevenuePostingService.

If the required revenue/AR entries are not found, the method throws:

```text
Could not find original invoice ledger entries to reverse
```

Thus a valid posted Invoice can exist while its CreditNote reversal path is structurally unable to discover that lineage.

This is not merely a cosmetic string typo. `sourceType` participates in financial provenance, posting identity, reversal lookup, reporting and repair. A free-form discriminator vocabulary can make accounting consequences unreachable even when all underlying rows exist.

Canonical distinction:

```text
SAME BUSINESS ENTITY
!= SAME FINANCIAL LINEAGE IDENTITY
unless discriminator + source identity are canonical and stable
```

Target pressure:

```text
FinancialSourceIdentity
= canonical typed source discriminator
+ stable source id
+ consequence kind/version where required
```

All posting, reversal, reconciliation, reporting and repair consumers must resolve through the same identity contract rather than independently typed string literals.

Affected kernels: K8, K10, K11, K6.
Affected journeys: J3, J7, J18.

---

## Reused mature root — F155, do not duplicate

`PaymentsOpsService.refundCharge()` is a current J7 instance of existing **F155**:

```text
provider refund succeeds
→ negative Payment row written
→ ledger reversal omitted
→ invoice reconciliation omitted
→ later provider refund webhook dedupes on the already-written refund id
→ missing local consequences can remain unrepaired
```

This remains owned by F155 because the semantic root is identical:

> effect/occurrence dedupe must not suppress missing local consequence completion for a known external financial reversal.

No new ID is allocated for this refund instance.

---

## J7 consequence-completeness law

```text
EXTERNAL MONEY OCCURRENCE
+ LOCAL MONEY-MOVEMENT RECORD
+ ACCOUNTING CONSEQUENCE
+ SOURCE-DOCUMENT CONSEQUENCE
+ RECONCILIATION STATE

must be checkable as separate dimensions of one financial outcome.
```

A stronger status in any one dimension must not silently imply completeness of the others.

No production implementation is authorized by this supplement.
