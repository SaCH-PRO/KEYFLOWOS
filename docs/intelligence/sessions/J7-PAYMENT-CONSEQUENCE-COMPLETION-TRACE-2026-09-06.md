# J7 Payment Consequence Completion Trace — 2026-09-06

Status: EVIDENCE PACKET — TAXONOMY RECONCILIATION REQUIRED BEFORE NEW ID

Journey: `J7 — Financial Truth`
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

## Question

Does existence of a KeyFlow `Payment` row or accepted provider-event row prove that the corresponding provider money occurrence has completed all required local financial consequences, including ledger posting/reversal and invoice reconciliation?

Working law:

```text
PAYMENT ROW EXISTS
!= PROVIDER EVENT FULLY CONSUMED
!= ACCOUNTING CONSEQUENCE COMPLETE
!= INVOICE / SOURCE STATE RECONCILED
```

and:

```text
WEBHOOK EVENT SEEN
!= WEBHOOK CONSEQUENCES COMPLETED
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

`PostingService.reverse()` is also history-preserving and reconciliation-aware:

```text
load original transaction + entries
→ reject cross-business reversal
→ reject already reversed
→ reject if any entry is locked by reconciliation
→ create mirrored REVERSAL transaction
→ mark original REVERSED
```

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

## Failure pattern C — ingestion dedupe is receipt-only, not consequence-completion state

`InvoiceWorkflowService.assertNewProviderEvent(...)` creates a `WebhookEvent` row before the provider-specific handler body completes. A unique `(provider, providerEventId)` collision is interpreted as a replay and causes the caller to skip side effects.

The `WebhookEvent` schema/migration contains:

```text
provider
providerEventId
eventType
businessId
receivedAt
```

with no observed processing lifecycle such as:

```text
PROCESSING
CONSEQUENCES_COMPLETE
FAILED_RETRYABLE
FAILED_TERMINAL
lastError
attemptCount
completedAt
```

The migration explicitly describes re-deliveries as silently ignored at the ingestion layer.

Therefore the checkpoint proves receipt/deduplication identity, not completion of descendants.

### Reconciliation-lock interaction

`PostingService.reverse()` correctly refuses to reverse a financial transaction when any original ledger entry is locked by reconciliation.

That is a desirable local accounting invariant. But if a real provider refund arrives and the provider event identity is persisted before the reversal is attempted, a later reversal failure can leave:

```text
provider refund already real
→ WebhookEvent receipt already durable
→ local refund/reversal consequence fails (for example reconciliation lock)
→ provider retries same event
→ WebhookEvent dedupe classifies retry as already seen
→ handler side effects can be skipped
```

This creates a potential certainty/recovery gap unless another durable recovery mechanism reopens consequence processing independently of provider redelivery.

This packet does not yet claim universal permanent stranding on every handler/error path; the next trace must inspect error propagation and any reconciliation repair worker. But receipt-only dedupe is insufficient by itself to prove consequence completion.

## Shared mechanism

The observed paths expose two related overloads:

```text
EXISTENCE OF PROVIDER-IDENTIFIED PAYMENT ROW
is used as
PAYMENT / EVENT COMPLETION DEDUPE
```

and:

```text
EXISTENCE OF WEBHOOK RECEIPT ROW
is used as
PROVIDER REDELIVERY COMPLETION DEDUPE
```

without a durable proof that all required descendants exist.

The correct semantic distinction is closer to:

```text
ProviderEventIdentity
→ ProviderOccurrenceVerified
→ PaymentRecorded
→ AccountingConsequencePosted/Reversed
→ SourceStateReconciled
→ ConsequenceCompletionEvidence
```

A dedupe check on an intermediate materialization cannot safely stand in for the full completion state.

## Evidence classification

### IMPLEMENTATION FACT

- successful-payment wrapper transactionally couples Payment + RevenuePosting where used;
- canonical refund helpers couple refund Payment + original posting reversal where used;
- synchronous PayPal capture directly creates a SUCCESSFUL Payment keyed by capture id;
- PayPal capture webhook returns when that providerPaymentId already exists;
- PaymentsOps refund calls provider first and then best-effort directly creates a REFUNDED Payment;
- PaymentsOps refund does not invoke RevenuePostingService or invoice reconciliation;
- Stripe refund webhook skips refund IDs already present as Payment rows;
- provider-event dedupe writes WebhookEvent receipt identity before downstream consequence completion;
- WebhookEvent has no observed processing/completion lifecycle fields;
- PostingService reversal rejects reconciliation-locked entries.

### INTERPRETATION

Payment-row identity and WebhookEvent receipt identity are both used as stronger completion signals than their schemas prove. This can make partial local consequence completion durable and can suppress the event redelivery path that might otherwise repair it.

### UNRESOLVED

- whether every provider handler propagates downstream posting/reversal failures such that the provider retries;
- whether any independent repair/reconciliation worker detects a WebhookEvent whose financial descendants are incomplete;
- whether reconciliation unlock/reopen automatically requeues a blocked provider consequence;
- whether mature J18/J23 findings already canonically own this exact mechanism.

### TEST STATUS

Source/tests may exist, but no runtime tests were executed during this trace. No pass/fail claim is made.

## Taxonomy gate

Do not allocate a new finding/contradiction until this is compared against mature J18/J23/K8/K9/K11 roots for:

- provider success vs local consequence completion;
- provider-event idempotency vs effect/consequence idempotency;
- durable checkpoint/recovery semantics;
- partial-success recovery ownership;
- certainty-aware recovery after ambiguous/blocked external effects.

If those existing roots already own the semantic mechanism, this J7 packet should specialize/cross-reference them rather than allocate a duplicate.

If not, the distinct J7 root is likely:

```text
Payment/Webhook receipt existence
!= completed financial consequence consumption
```

with concrete PayPal capture, refund and reconciliation-lock examples.

## Next trace

1. Reconcile this packet against F145–F160 and related J18/J23 supplements.
2. Inspect provider handler error propagation and any independent payment/reconciliation repair workers.
3. Trace invoice `reconcileFromPayments()` after every payment and refund path, including negative REFUNDED rows.
4. Trace `RevenuePostingService.onPaymentRefunded` behavior when the original posting is missing or already reversed.
5. Trace bank reconciliation lock release/reopen mechanics and whether blocked reversals are re-driven.
6. Do not modify production code.
