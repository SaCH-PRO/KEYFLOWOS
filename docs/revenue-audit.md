# Revenue / Commerce Truth Audit (R0)

This document is the source-of-truth registry for every commerce KPI we surface
and every invoice / payment state mutation. It is intentionally short — the goal
is for any engineer changing revenue code to be able to scan this file and know
exactly where each number comes from before they touch anything downstream.

## KPI sources

All commerce KPIs the dashboard surfaces resolve to one of two server services
(no hard-coded fallbacks, no `Math.random`, no mocked metrics in the KPI
computation paths):

| Metric | Server source | Backing query |
| --- | --- | --- |
| `totalRevenue` | `CommerceStatsService.getCommerceStats` | sum of `Invoice.total` where `status = PAID` |
| `outstandingAmount` | `CommerceStatsService` | sum of `Invoice.total` where `status in (SENT, OVERDUE)` |
| `overdueAmount` | `CommerceStatsService` | sum where `status = OVERDUE` OR (`SENT` and `dueDate < now`) |
| `monthlyPaid` | `CommerceStatsService` | sum of `PAID` invoices with `paidAt >= start-of-month` |
| `invoiceCount` / `quoteCount` / `productCount` | `CommerceStatsService` | `prisma.*.count` |
| `averageInvoiceValue` | `CommerceStatsService` | `totalRevenue / paidInvoices.length` |
| `quoteConversionRate` | `CommerceStatsService` | `acceptedQuotes / totalQuotes * 100` from `quote.groupBy` |
| `invoiceStatusBreakdown` / `quoteStatusBreakdown` | `CommerceStatsService` | `prisma.*.groupBy({ by: ['status'] })` |
| `topProducts` | `CommerceStatsService` | `prisma.invoiceItem.groupBy` (top 5 by revenue) |
| `revenueByMonth` | `CommerceStatsService.buildRevenueByMonth` | last 6 months of `PAID` invoices, bucketed by `paidAt` |
| Margin / source-risk / inventory-risk insights | `CommerceInsightsController.getInsightsOverview` | `MarginAnalysisService`, `SourceRiskService`, `InventoryRiskService` |

The web `commerce-kpi-strip.tsx` and `insights/commerce-insights-tab.tsx` map
1:1 to the fields above. Where the page falls back to client-side computation
(e.g. when stats fetch fails), it computes from the same `invoices` / `quotes`
arrays it already has — never from constants.

Hard-coded numbers that remain in the dashboard are **thresholds, not
KPIs** (e.g. `>= 60%` conversion celebration, `<= 7 days` expiring window).

## Webhook idempotency

Every payment webhook now goes through two layers of dedup:

1. **`WebhookEvent` table** (added in migration `20260506000000`) — a
   `(provider, providerEventId)` unique-constraint upsert is the first thing
   `handleStripeWebhook` / `handlePaypalWebhook` / `handleWipayCallback` do.
   Re-deliveries become a no-op without ever running the handler body.
2. **`Payment.providerPaymentId` unique constraint** — second-line guard against
   duplicate Payment rows even if dedup table is bypassed (e.g. legacy events).

Signature verification is **mandatory**:

- Stripe: `STRIPE_WEBHOOK_SECRET` env (or per-business `metaData.stripeWebhookSecret`); `verifyStripeSignature` uses HMAC-SHA256 timing-safe compare.
- PayPal: `PAYPAL_WEBHOOK_ID` (or per-business); `verify-webhook-signature` API call.
- WiPay: MD5 hash of `transaction_id|order_id|total|status`; **mismatched hashes are now rejected**, not just warned.

All webhook routes and public payment-link routes sit behind `PublicRateLimitGuard`
(see `payments.controller.ts`), and business scoping is inferred from the
referenced invoice (no cross-tenant leakage possible).

## Invoice state machine

Owned by `InvoiceWorkflowService`. Allowed transitions:

```
DRAFT          -> SENT, VOID
SENT           -> PARTIALLY_PAID, PAID, OVERDUE, VOID, FAILED, PENDING
PENDING        -> SENT, PARTIALLY_PAID, PAID, OVERDUE, VOID, FAILED
PARTIALLY_PAID -> PARTIALLY_PAID, PAID, OVERDUE, FAILED
OVERDUE        -> PARTIALLY_PAID, PAID, VOID, FAILED
FAILED         -> SENT, PARTIALLY_PAID, PAID, VOID
PAID           -> (terminal)
VOID           -> (terminal)
```

Illegal transitions throw `409 ConflictException` with the offending
`from -> to` pair. Tests in `invoice-workflow.service.spec.ts` lock this in.

## Balance math

`computeBalance(total, payments, currency)` is pure and the single source of
truth for "how much does this invoice still owe?". It:

- counts only `SUCCESSFUL` payments toward `paid`
- counts `REFUNDED` (positive or negative stored amount) toward `refunded`
- ignores `PENDING` / `FAILED`
- rounds to 2 decimals (TTD/USD/JMD/etc are all 2dp)
- uses a half-cent tolerance to absorb float drift
- clamps `remaining` at zero and surfaces `isOverpaid` separately

Coverage in `invoice-workflow.service.spec.ts`: zero-amount, single full,
multi-partial, partial-only, over-payment, refund (signed and unsigned),
mixed PENDING/FAILED, currency rounding (TTD), three-way partial (USD).

## Overdue detection

`InvoiceOverdueScheduler` runs every 15 minutes (skipped in `NODE_ENV=test`
or when `DISABLE_SCHEDULERS=1`). For every `SENT` invoice with
`dueDate < now`, it calls `workflow.transition(id, 'OVERDUE')`, which emits
the canonical `invoice.overdue` event. `FlowListener` translates that into a
business notification.

Autopilot's `delegation-loop.runPaymentRecovery` continues to drive the
reminder cadence on top of the same status flip.

## Receipts

`FlowListener.handleInvoicePaidCustomerNotif` listens for `invoice.paid` and
sends the `payment_receipt` transactional email through
`TransactionalEmailService`. Because every PAID transition flows through
`InvoiceWorkflowService`, every invoice that closes emits exactly one
`invoice.paid` and triggers exactly one receipt-send attempt. Missing
receipts are detectable by joining `Invoice` (`status = PAID`) against the
`transactional_email` send-log on `(businessId, type='payment_receipt', invoiceId)`
— this is the hook R3 will use to surface "receipts not delivered".

## Canonical revenue events

Registered in `packages/shared/src/contact-events.ts` under the
`sales_revenue` category:

`invoice.created`, `invoice.sent`, `invoice.overdue`, `invoice.paid`,
`invoice.void`, `invoice.payment_failed`, `invoice.payment_recorded`,
plus `quote.*` for the quote pipeline.

## Smoke script

`scripts/verify-revenue.sh` exercises the full happy path:
create-invoice → payment-link → simulated webhook PAID → assert state, balance, receipt.
It is intended to run against a disposable test business; it does not mutate
production data.
