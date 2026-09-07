# KeyFlowOS Finding Register — Financial Consumption and Closed-Period Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F190 — Provider webhook receipt identity is committed before financial consequence completion, so redelivery can be consumed by an incomplete first attempt

**Status:** VERIFIED CROSS-PROVIDER / CONSUMPTION-COMPLETENESS FINDING

`InvoiceWorkflowService.assertNewProviderEvent()` is the common provider-event guard for Stripe, PayPal and WiPay.

Its contract is currently:

```text
(provider, providerEventId) not seen
→ INSERT WebhookEvent
→ return true

(provider, providerEventId) already exists
→ return false
→ caller should ACK / do nothing
```

The `WebhookEvent` write occurs **before** payment/refund persistence, ledger posting/reversal and invoice reconciliation.

Repository-wide search in this tranche found the only `webhookEvent.` write/read usage in this ingestion guard; no worker or lifecycle owner was found that later updates the event to processed/failed/retryable or re-drives incomplete consequences.

### Stripe

`handleStripeWebhook()` persists receipt identity before dispatching the event to payment/refund handlers.

Successful-payment handling then calls `createPaymentWithPosting()`. If that transactional Payment+posting operation throws, the webhook method can fail while the provider event has already been durably marked as seen. A provider redelivery of the same `evt_*` is then short-circuited before consequence execution.

Stripe refund handling is even more explicit: `createRefundWithPosting()` errors are caught and converted to `null`, after which the outer webhook handler can still return a normal processed response. The receipt survives while refund consequences do not.

### PayPal

`handlePaypalWebhook()` follows the same receipt-first sequence before `processPaypalCaptureCompleted()`, `processPaypalOrderCompleted()` or `processPaypalRefund()`.

The refund path catches persistence/reversal failure and returns without a durable processing-failure state on `WebhookEvent`.

### WiPay

`handleWipayCallback()` persists `WebhookEvent` before successful Payment creation/posting/reconciliation. Its downstream `try/catch` converts processing exceptions into `{ success: false, message: 'Payment processing error' }`, but the receipt remains consumed. A repeated callback using the same transaction id returns `Duplicate callback ignored` before re-running the missing consequence chain.

### Distinction from existing roots

F190 is broader than F155 and F188:

- **F155**: a specific manual provider-refund path creates the refund Payment and suppresses the stronger webhook repair path.
- **F188**: direct PayPal capture creates the successful Payment and suppresses the stronger webhook posting path.
- **F190**: the **provider event occurrence itself** is treated as completed consumption when only receipt has been durably recorded, independent of whether a Payment row exists.

It is also distinct from F116/F119, which concern occurrence/delivery identity propagation and outbound webhook durability. F190 concerns **ingress consumption completion**.

Target law:

```text
WEBHOOK RECEIVED / AUTHENTICATED
!= WEBHOOK CONSUMPTION CLAIM
!= FINANCIAL CONSEQUENCES COMPLETE
```

A provider occurrence needs a durable processing lifecycle such as:

```text
RECEIVED
→ CLAIMED / PROCESSING
→ CONSEQUENCES_COMPLETE
or
→ FAILED_RETRYABLE / FAILED_FINAL / AWAITING_RECONCILIATION
```

Redelivery or repair must be able to complete missing descendants idempotently without repeating the external provider effect.

Affected kernels: K7, K8, K9, K10, K11.
Affected journeys: J7, J14, J18, J23.

---

## F191 — Reconciliation locking blocks the canonical current-period reversal of a legitimate later refund, with no observed unlock or adjustment path

**Status:** VERIFIED CODE-LEVEL + REPOSITORY-SEARCH-SCOPED / CLOSED-PERIOD RECOVERY FINDING

`ReconciliationService.complete()` locks every in-scope `LedgerEntry` by setting `lockedByReconciliationId` and marks the reconciliation `RECONCILED`.

This is a positive accounting-integrity seam: closed-period historical entries should not be silently mutated.

However, the canonical reversal mechanism does not mutate those historical entries. `PostingService.reverse()` is explicitly history preserving and prepares a **new** `FinancialTransaction` with:

```text
type = REVERSAL
status = POSTED
date = new Date()
reversalOfId = original.id
mirrored new LedgerEntry rows
```

Before creating that current-period reversal, it checks the *original* entries. If any original entry has `lockedByReconciliationId`, it throws:

```text
Cannot reverse: entry ... is locked by reconciliation ...
```

Thus the lock on historical source evidence also blocks creation of a new accounting consequence in the current period.

This matters directly to provider refunds. A payment may be validly received, posted and bank-reconciled in an earlier period. A customer refund can then occur later at Stripe/PayPal. The provider reversal is real, but `RevenuePostingService.onPaymentRefunded()` delegates to `PostingService.reverse()` and cannot create the canonical offsetting reversal if the original payment posting is locked.

Repository search in this tranche found no implemented reconciliation unlock/reopen operation and no separate current-period refund-adjustment posting path that bypasses mutation of the historical closed entry while retaining reversal lineage. The code comment says an admin override is required to break the seal, but the inspected repository exposes no such operation.

Canonical distinction:

```text
CLOSED HISTORICAL ENTRY IMMUTABILITY
!= PROHIBITION ON NEW CURRENT-PERIOD CORRECTIVE CONSEQUENCE
```

Target law:

> A closed period may prohibit mutation of historical accounting evidence while still permitting policy-governed, current-period reversing/adjusting entries that preserve lineage to the closed source transaction.

Target pressure:

```text
Original posting remains immutable + reconciled
→ later external refund/reversal occurrence
→ current-period FinancialCorrection / Reversal consequence
→ explicit linkage to original posting
→ affected reconciliation/reporting disclosure
→ no historical rewrite
```

If the accounting policy instead requires reopening a closed reconciliation, that must be a first-class controlled operation with authority, audit evidence and downstream re-reconciliation—not an absent/manual database procedure.

Affected kernels: K8, K9, K10, K11, K3.
Affected journeys: J7, J18, J23.

---

# J7 laws added by this tranche

```text
RECEIPT IDEMPOTENCY
!= CONSUMPTION COMPLETENESS
```

```text
CLOSED-PERIOD IMMUTABILITY
!= INABILITY TO REPRESENT A LATER REAL-WORLD FINANCIAL REVERSAL
```

No production implementation is authorized by this supplement.
