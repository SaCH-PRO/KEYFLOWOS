import { Allow } from 'class-validator';

/**
 * Body of POST /commerce/businesses/:businessId/invoices/:invoiceId/payments/:paymentId/confirm
 * (V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE; V1-41 review CR-V41-3, SEC-V41-1).
 *
 * `amount` is optional: the amount the member was shown and approved. It is
 * `@Allow()`ed, not validated here, as RecordPaymentDto does for its fields:
 * PaymentEvidenceService.confirmPendingPayment owns the check (a value that is
 * not a finite number, a numeric string or null included, 400; a value other
 * than the pending row's amount, in cents, 409; nothing written in either
 * case). Absent, the pending row's own amount is confirmed. The whitelist
 * drops every other field, so a body can never name the recorder: the
 * confirming member is the authenticated user.
 */
export class ConfirmPendingPaymentDto {
  @Allow()
  amount?: unknown;
}
