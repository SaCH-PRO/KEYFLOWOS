# J7 Payment Consequence Completion Trace — 2026-09-06

Status: EVIDENCE PACKET — TAXONOMY RECONCILIATION REQUIRED BEFORE NEW ID

Journey: `J7 — Financial Truth`
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

## Question

Does existence of a KeyFlow `Payment` row prove that the corresponding provider money occurrence has completed all required local financial consequences, including ledger posting/reversal and invoice reconciliation?

Working law:

```text
PAYMENT ROW EXISTS
!= PROVIDER EVENT FULLY CONSUMED
!= ACCOUNTING CONSEQUENCE COMPLETE
!= INVOICE / SOURCE STATE RECONCILED
```

## Positive canonical path

`PaymentsService.createPaymentWithPosting()` provides a strong seam for successful provider payments:

```text
DB transaction
→ create Payment
→ if SUCCESSFUL: RevenuePostingService.onPaymentRecorded(..., same tx)
→ commit Payment + ledger consequence together
```

Refund helpers similarly provide stronger paths:

```text
createRefundWithPosting(...)
→ create negative REFUNDED Payment
→ resolve original Payment
→ RevenuePostingService.onPaymentRefunded(..., same tx)
```

and an invoice-based fallback resolves a recent successful original payment where capture identity is unavailable.

These seams should be preserved.

## Failure pattern A — synchronous PayPal capture

### Provider occurrence

`PaymentsService.capturePaypalOrder(orderId, invoiceId)` performs synchronous PayPal capture.

The inspected source persists a local Payment with:

```text
provider = paypal
providerPaymentId = captureId
status = SUCCESSFUL
invoiceId = invoice.id
```

using a direct Payment create rather than the `createPaymentWithPosting()` wrapper.

### Later webhook recovery is suppressed

`processPaypalCaptureCompleted(resource)` resolves the same provider capture identity:

```text
existing = Payment.findUnique(providerPaymentId = captureId)
if (existing) return
```

Therefore:

```text
synchronous capture
→ Payment(SUCCESSFUL, providerPaymentId=captureId)
→ no observed ledger posting on that direct-create path
→ provider webhook later arrives
→ sees Payment row
→ returns before posting
```

The Payment row acts as a completion marker even though the accounting consequence was not completed by the producer that created it.

## Failure pattern B — PaymentsOps refund

`PaymentsOpsService.refundCharge(...)`:

```text
call external gateway refund
→ receive RefundResult
→ best-effort local Payment.create(...)
   amount = negative refund amount
   status = REFUNDED
   providerPaymentId = refund.id
→ return provider refund result
```

The service does not inject or call `RevenuePostingService`, and does not call `InvoiceWorkflowService.reconcileFromPayments()`.

Thus an externally successful refund can leave:

```text
provider refund = real
Payment refund row = present
original accounting posting = unreversed
invoice payment state = unreconciled
```

### Webhook repair can be poisoned by the locally inserted refund row

The Stripe refund webhook path deduplicates by the same refund provider identity:

```text
existing = Payment.findUnique(providerPaymentId = refund.id)
if (existing) continue
```

The operator refund path has already inserted that `refund.id`, so the later canonical webhook repair can be skipped before it invokes the refund posting/reconciliation flow.

## Shared mechanism

Both paths demonstrate the same underlying control defect:

```text
EXISTENCE OF PROVIDER-IDENTIFIED PAYMENT ROW
is used as
EVENT / CONSEQUENCE COMPLETION DEDUPE
```

without proving that all required descendants exist.

The correct semantic distinction is closer to:

```text
ProviderEventIdentity
→ ProviderOccurrenceVerified
→ PaymentRecorded
→ AccountingConsequencePosted/Reversed
→ SourceStateReconciled
→ Outcome / Consequence Completion Evidence
```

A dedupe check on one intermediate materialization cannot safely stand in for the full completion state.

## Evidence classification

### IMPLEMENTATION FACT

- successful-payment wrapper transactionally couples Payment + RevenuePosting where used;
- canonical refund helpers couple refund Payment + original posting reversal where used;
- synchronous PayPal capture directly creates a SUCCESSFUL Payment keyed by capture id;
- PayPal capture webhook returns when that providerPaymentId already exists;
- PaymentsOps refund calls provider first and then best-effort directly creates a REFUNDED Payment;
- PaymentsOps refund does not invoke RevenuePostingService or invoice reconciliation;
- Stripe refund webhook skips refund IDs already present as Payment rows.

### INTERPRETATION

Payment-row identity is overloaded as both money-movement record identity and completed-consumption/idempotency evidence. This can make partial local consequence completion durable and suppress the later event path that would otherwise repair it.

### TEST STATUS

Source/tests may exist, but no runtime tests were executed during this trace. No pass/fail claim is made.

## Taxonomy gate

Do not allocate a new finding/contradiction until this is compared against mature J18/J23/K8/K9/K11 roots for:

- provider success vs local consequence completion;
- provider-event idempotency vs effect/consequence idempotency;
- durable checkpoint/recovery semantics;
- partial-success recovery ownership.

If those existing roots already own the semantic mechanism, this J7 packet should specialize/cross-reference them rather than allocate a duplicate.

If not, the distinct J7 root is likely:

```text
Payment row existence
!= completed financial consequence consumption
```

with concrete PayPal capture and refund examples.

## Next trace

1. Reconcile this packet against F145–F160 and related J18/J23 supplements.
2. Trace `RevenuePostingService.onPaymentRecorded/onPaymentRefunded` externalRef/reversal identity and reconciliation-lock failure behavior.
3. Determine what happens when the provider event is real but ledger posting/reversal fails after/before local Payment persistence on every payment path.
4. Trace invoice `reconcileFromPayments()` after payment and refund paths, including negative REFUNDED rows.
5. Do not modify production code.
