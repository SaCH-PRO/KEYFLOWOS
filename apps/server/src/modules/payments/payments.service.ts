import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';
import { InvoiceWorkflowService, balanceOfStoredRows, isShareableInvoiceStatus, ownTenantPayments } from '../commerce/invoice-workflow.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { normalizeCurrency } from '../finance/posting.service';
import { fromCents, subtractMoney, toCents } from '../commerce/money';
import { WiPayConnector } from '../../core/connectors/implementations/wipay.connector';
import { WIPAY_CURRENCY, resolveWipayMerchant, wipayMerchantComplete, wipayTakesCurrency } from '../../core/connectors/implementations/wipay-merchant';
import { PayPalConnector } from '../../core/connectors/implementations/paypal.connector';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { StoreOrderService, isClosedStorefrontOrder } from '../site/store-order.service';
import { CheckoutPaymentIntent, Client, Environment, LogLevel, OrdersController } from '@paypal/paypal-server-sdk';

interface WipayCallbackParams {
  transaction_id?: string;
  order_id?: string;
  status?: string;
  total?: string;
  hash?: string;
}

interface GatewayInfo {
  id: string;
  name: string;
  currencies: string[];
}

/** What a provider webhook answers. */
type WebhookAck = { ok: true; received?: boolean; processed?: string };

/**
 * V1-15c review (SEC-V15C-2, CR-V15C-1): the aborts of a payment transaction
 * that a second attempt can get past (P2028: the transaction expired or was
 * closed, typically behind a lock; P2034: a write conflict or deadlock), and
 * how many attempts recording a completed PayPal capture makes.
 */
const TRANSIENT_TX_ABORTS = new Set(['P2028', 'P2034']);
const PAYPAL_CAPTURE_RECORD_ATTEMPTS = 3;

/**
 * V1-29c-REFUND-WRITE-DOOR — the payment a provider refund refunds, and the
 * refund row the door writes for it.
 */
type RefundOriginal = {
  id: string;
  providerPaymentId: string;
  invoiceId: string;
  businessId: string;
  currency: string;
  amount: number;
};
type ProviderRefund = { providerPaymentId: string; provider: string; currency: string; notes: string | null };

/**
 * V1-29c (BR-08): the id of a Stripe refund row recorded from a
 * charge.refunded event without refunds.data, which carries only the
 * charge's cumulative amount_refunded:
 * re_synth_<original Payment.id>_<charge>_<amount_refunded> (re_synth_<charge>
 * before V1-29c). Review SEC-V29C-3: the id names the payment it refunds
 * (a server-built id no tenant can guess), so a row another tenant writes for
 * the same charge id never takes the id of this tenant's refund; a refund id
 * a provider event supplies with this prefix is refused.
 */
const SYNTHETIC_REFUND_ID_PREFIX = 're_synth_';
/** The providerPaymentId prefix of a manual refund row (CommerceService.markPaymentRefunded). */
const MANUAL_REFUND_ID_PREFIX = 'manual_refund_';
/**
 * FOLLOW3-A3-REFUND-DOOR-TENANCY: the providerPaymentId prefix of every
 * hand-recorded payment (CommerceService.recordPayment: the manual payment
 * route, KEY processPayment, the evidence confirm, mark-paid).
 */
const MANUAL_PAYMENT_ID_PREFIX = 'manual_';

/**
 * R0-20c: the Stripe event types the door records as a payment of an invoice or a storefront order.
 * R0-20c review (SEC-R020C-2): checkout.session.async_payment_succeeded is the one that settles a
 * session completed with a delayed payment method (payment_status 'unpaid'), so it is bound too.
 */
const STRIPE_PAYMENT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'charge.succeeded',
  'payment_intent.succeeded',
]);
/**
 * R0-20c-STRIPE-DOOR-BINDING (review SEC-R020B-2, as the legacy route's
 * SEC-R020B-3): the webhook_events provider under which the door keeps a
 * payment event it refused, one row per Stripe event id (a retry adds none),
 * with the business of the invoice or order it named and `<type>:<reason>` as
 * its event type. It is not the door's dedupe claim (provider 'stripe').
 */
const STRIPE_REFUSED_PROVIDER = 'stripe-refused';
/**
 * R0-20d (W3-STRIPE-LEGACY-BINDING; R0-20b review SEC-R020B-3): the label the
 * deprecated POST /webhooks/stripe keeps its refused payment events under.
 * That route has no binding of its own any more: it hands its verified event
 * to handleStripeWebhook with this label, so the door's binding is the only
 * one and each endpoint still keeps its own refusal row for an event.
 */
export const STRIPE_LEGACY_REFUSED_PROVIDER = 'stripe-legacy-refused';
/** R0-20d: the webhook_events provider a refused Stripe payment event is kept under, by endpoint. */
export type StripeRefusedProvider = typeof STRIPE_REFUSED_PROVIDER | typeof STRIPE_LEGACY_REFUSED_PROVIDER;
/** R0-20c: the fields of a Stripe session, charge or payment intent the door's binding reads. */
type StripePaymentObject = {
  metadata?: Record<string, unknown> | null;
  client_reference_id?: unknown;
  amount_total?: unknown;
  amount_received?: unknown;
  amount?: unknown;
  currency?: unknown;
  payment_link?: unknown;
};

/**
 * R0-20c review (SEC-R020C-2): whether a Checkout Session has taken its money.
 * A session completed with a delayed payment method arrives with payment_status
 * 'unpaid' (the money is due, not taken) and is settled later by
 * checkout.session.async_payment_succeeded ('paid') or failed by
 * checkout.session.async_payment_failed. Stripe always sends payment_status on
 * a session; a charge or payment intent event carries none and is taken by its
 * type (succeeded).
 */
function stripeSessionTookMoney(obj: { payment_status?: unknown } | null | undefined): boolean {
  return obj?.payment_status === undefined || obj.payment_status === 'paid';
}

/**
 * W3-VOID-PROVIDER-RACE (VN-08; the D-76 `refused:<reason>` mark): the event
 * type a provider delivery's webhook_events row is kept under when its
 * payment was not recorded because the invoice is VOID.
 */
const INVOICE_VOID_REFUSAL = 'refused:invoice_void';

/**
 * W3-VOID-PROVIDER-RACE review CR-VPR-1: createRefundWithPostingByInvoice's
 * answer when it recorded nothing because the invoice is VOID and holds no
 * payment the refund returns (its capture was refused, VN-08).
 */
const VOID_INVOICE_NOTHING_TO_REFUND = 'void_invoice_nothing_to_refund' as const;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerceService: CommerceService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
    @Optional() @Inject(WiPayConnector) private readonly wipayConnector?: WiPayConnector,
    @Optional() @Inject(PayPalConnector) private readonly paypalConnector?: PayPalConnector,
    @Optional() @Inject(forwardRef(() => StoreOrderService)) private readonly storeOrderService?: StoreOrderService,
    // FOLLOW3-A3 (D-56): the provider read that binds a platform-signed refund to its business.
    @Optional() @Inject(StripeConnector) private readonly stripeConnector?: StripeConnector,
  ) {}

  /**
   * FIN2 — single tx wrapper for SUCCESSFUL provider payments. Persists
   * the Payment row and posts the deposit-side ledger entries together;
   * returns the created row so callers can keep their existing logging.
   * Idempotency on (Payment, id, payment_recorded) means replay is safe.
   *
   * W3-VOID-PROVIDER-RACE (VN-08; review SEC-V82-1 / CR-B1-1): every provider
   * settlement door (the Stripe charge / session webhook, the PayPal capture
   * webhook, the WiPay callback, capturePaypalOrder) records here, so here the
   * payment takes the invoice row lock (lockInvoice, the lock
   * InvoiceWorkflowService.transition holds while a void decides) and reads the
   * status under it. A void that holds the lock is waited for; a payment the
   * lock finds the invoice VOID for is not written and null is returned (the
   * caller keeps the event refused and tells the owner: refuseVoidInvoicePayment,
   * the D-76 pattern). A void that comes after waits for this commit and then
   * finds the money received (D-14: refund first). The insert's own foreign-key
   * check (FOR KEY SHARE) was never blocked by the void's FOR NO KEY UPDATE.
   */
  private async createPaymentWithPosting(data: Prisma.PaymentUncheckedCreateInput) {
    return this.prisma.client.$transaction(async (tx) => {
      await PaymentsService.lockInvoice(tx as unknown as Prisma.TransactionClient, data.invoiceId);
      const invoice = await tx.invoice.findUnique({ where: { id: data.invoiceId }, select: { status: true } });
      if (invoice?.status === 'VOID') return null;
      const created = await tx.payment.create({ data });
      if (created.status === 'SUCCESSFUL') {
        await this.revenuePosting.onPaymentRecorded(created.id, {
          tx: tx as unknown as Prisma.TransactionClient,
        });
      }
      return created;
    });
  }

  /**
   * W3-VOID-PROVIDER-RACE (VN-08), the pattern owner ruling D-76 set for a
   * WiPay success the invoice cannot take: a provider reported a successful
   * payment for an invoice that is VOID (voided before the payment arrived, or
   * while the door waited on its lock). Nothing is recorded as money on it: no
   * Payment row, no posting, no reconcile, no payment-received event. The
   * delivery's webhook_events row (the claim its door made: Stripe's or
   * PayPal's event id, WiPay's transaction id; capturePaypalOrder, which has
   * none, keeps one under its capture id) is kept, marked
   * `refused:invoice_void` with the invoice's business, so every redelivery
   * is a no-op (keepInvoiceVoidRefusal: never another business's row, review
   * SEC-VN08-1); and the business is told once per payment (a
   * 'payment.refused' notification) to refund it or record it by hand. Best
   * effort: a failure here is logged and the refusal stands.
   */
  private async refuseVoidInvoicePayment(input: {
    provider: 'stripe' | 'paypal' | 'wipay';
    providerPaymentId: string;
    /**
     * The webhook_events id this delivery's own dedupe claim wrote
     * (assertNewProviderEvent returned true for it); absent when the delivery
     * claimed none, and the refusal is then kept under the payment's id.
     */
    claimedEventId?: string;
    invoiceId: string;
    businessId: string;
    amount: number;
    currency: string;
  }): Promise<void> {
    const label = { stripe: 'Stripe', paypal: 'PayPal', wipay: 'WiPay' }[input.provider];
    const currency = normalizeCurrency(input.currency) || input.currency;
    this.logger.error(
      `${label} payment ${input.providerPaymentId} for invoice ${input.invoiceId} not recorded: the invoice is VOID (VN-08, D-76 pattern)`,
    );
    await this.keepInvoiceVoidRefusal({
      provider: input.provider,
      claimedEventId: input.claimedEventId,
      key: input.providerPaymentId,
      businessId: input.businessId,
      label,
    });
    try {
      // Told once per payment: capturePaypalOrder and PayPal's own capture webhook refuse the same capture.
      const told = await this.prisma.client.notification.findFirst({
        where: {
          businessId: input.businessId,
          type: 'payment.refused',
          AND: [
            { data: { path: ['provider'], equals: input.provider } },
            { data: { path: ['transactionId'], equals: input.providerPaymentId } },
          ],
        },
        select: { id: true },
      });
      if (told) return;
      await this.prisma.client.notification.create({
        data: {
          businessId: input.businessId,
          type: 'payment.refused',
          title: `${label} payment not recorded`,
          body:
            `${label} reported a successful payment (${input.providerPaymentId}) of ${currency} ${Number(input.amount).toFixed(2)} ` +
            `for invoice ${input.invoiceId}, which is void, so it was not recorded. Check the payment in your ${label} ` +
            'account and refund it or record it by hand.',
          data: {
            provider: input.provider,
            transactionId: input.providerPaymentId,
            payableType: 'invoice',
            payableId: input.invoiceId,
            currency,
            amount: Number(input.amount),
            reason: 'invoice_void',
          },
        },
      });
    } catch (e: unknown) {
      this.logger.error(
        `Could not notify business ${input.businessId} of refused ${label} payment ${input.providerPaymentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * W3-VOID-PROVIDER-RACE review SEC-VN08-1 (owner ruling D-76: a refusal is
   * kept insert-only, as refuseWipayCurrency and refuseStripePaymentEvent
   * keep theirs): the webhook_events row a VOID-invoice refusal is kept as,
   * never another business's. `claimedEventId` is the row this delivery's own
   * dedupe claim wrote: it is re-marked `refused:invoice_void` with the
   * invoice's business, and only while it names no business or that one. A
   * delivery that claimed nothing (the WiPay refusal before the claim, a
   * Stripe or PayPal event with no event id, capturePaypalOrder) only inserts
   * its row under `key`. A row already there under that key (this payment's
   * earlier refusal, or another business's delivery: the key is the caller's
   * choice, a WiPay transaction id hashed with the business's own key or a
   * Stripe object id signed with its own secret) is left exactly as it was.
   * Best effort: a failure is logged and the refusal stands.
   */
  private async keepInvoiceVoidRefusal(input: {
    provider: 'stripe' | 'paypal' | 'wipay';
    claimedEventId?: string;
    key: string;
    businessId: string;
    label: string;
  }): Promise<void> {
    const mark = { eventType: INVOICE_VOID_REFUSAL, businessId: input.businessId };
    const providerEventId = input.claimedEventId ?? input.key;
    try {
      if (input.claimedEventId) {
        const kept = await this.prisma.client.webhookEvent.updateMany({
          where: {
            provider: input.provider,
            providerEventId: input.claimedEventId,
            OR: [{ businessId: null }, { businessId: input.businessId }],
          },
          data: mark,
        });
        if (kept.count > 0) return;
      }
      await this.prisma.client.webhookEvent.create({ data: { provider: input.provider, providerEventId, ...mark } });
    } catch (e: unknown) {
      // P2002: a row is already kept under this key; whichever business holds it, it is not rewritten.
      if ((e as { code?: string } | null)?.code !== 'P2002') {
        this.logger.error(`Refusal of ${input.label} ${providerEventId} could not be kept: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * V1-29c — the row lock every money write on an invoice takes
   * (CommerceService.lockInvoiceForPayment: payments, manual refunds), so a
   * provider refund's dedupe and amount are read with every refund of the
   * invoice committed before it, and two deliveries of one refund (or a
   * charge.refunded and the refund.created of the same refund) are one after
   * the other, never side by side.
   */
  private static async lockInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR NO KEY UPDATE`;
  }

  /**
   * FIN2 — single tx wrapper for provider refunds. Records the negative
   * Payment row tagged REFUNDED and posts the refund in one commit.
   *
   * V1-29c-REFUND-WRITE-DOOR: under the invoice lock, the refund is deduped
   * on its id inside the transaction, `amountToRecord` says how much of it is
   * not recorded yet (0: nothing is written), the row carries reference = the
   * original's providerPaymentId (the link V1-29's readers match exactly,
   * SEC-V29-1), and RevenuePostingService.onPaymentRefunded posts the amount
   * refunded, not the whole payment (BR-07).
   *
   * Review SEC-V29C-2: never more than what is left of the payment
   * (leftToRefundCents: its amount less every refund row linked to it, the
   * manual refund's included), so a refund another door already recorded
   * (a manual refund, then the provider's event for the same money) is not
   * recorded twice, whichever arrives first: the manual refund answers 409
   * in the other order (CommerceService.refundableOf).
   */
  private async createRefundWithPosting(
    original: RefundOriginal,
    refund: ProviderRefund,
    amountToRecord: (tx: Prisma.TransactionClient) => Promise<number>,
    alsoLinkedBy: string[] = [],
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      await PaymentsService.lockInvoice(txClient, original.invoiceId);
      const recorded = await tx.payment.findUnique({
        where: { providerPaymentId: refund.providerPaymentId },
        select: { id: true },
      });
      if (recorded) return null;
      const amount = this.cappedAtWhatIsLeft(
        await amountToRecord(txClient),
        await PaymentsService.leftToRefundCents(txClient, original, alsoLinkedBy),
        original,
        refund,
      );
      if (!(toCents(amount) > 0)) return null;
      const created = await tx.payment.create({
        data: {
          provider: refund.provider,
          providerPaymentId: refund.providerPaymentId,
          amount: subtractMoney(0, amount),
          currency: refund.currency,
          status: 'REFUNDED',
          invoiceId: original.invoiceId,
          businessId: original.businessId,
          reference: original.providerPaymentId,
          notes: refund.notes,
        },
      });
      await this.revenuePosting.onPaymentRefunded(original.id, {
        tx: txClient,
        refund: { paymentId: created.id, amount },
      });
      return created;
    });
  }

  /**
   * V1-29c review (SEC-V29C-2): what is left of `original` to refund, in
   * cents (0 or less: nothing), read under the invoice lock: its amount less
   * every negative REFUNDED row of its invoice and tenant linked to it, by
   * reference = its providerPaymentId (the manual refund, payments-ops
   * refundCharge and the provider refund door all link so) or by
   * `alsoLinkedBy` (the Stripe charge id, the reference Stripe refund rows
   * carried before V1-29c).
   */
  private static async leftToRefundCents(
    tx: Prisma.TransactionClient,
    original: RefundOriginal,
    alsoLinkedBy: string[],
  ): Promise<number> {
    const rows = await tx.payment.findMany({
      where: {
        businessId: original.businessId,
        invoiceId: original.invoiceId,
        status: 'REFUNDED',
        amount: { lt: 0 },
        reference: { in: [original.providerPaymentId, ...alsoLinkedBy] },
      },
      select: { amount: true },
    });
    const refunded = rows.reduce((s, r) => s + Math.abs(toCents(Number(r.amount))), 0);
    return toCents(Number(original.amount)) - refunded;
  }

  /** V1-29c review (SEC-V29C-2): `amount`, never more than `leftCents`; a cut is logged. */
  private cappedAtWhatIsLeft(amount: number, leftCents: number, original: RefundOriginal, refund: ProviderRefund): number {
    const wanted = toCents(amount);
    if (!(wanted > 0)) return 0;
    const cents = Math.min(wanted, Math.max(leftCents, 0));
    if (cents < wanted) {
      this.logger.warn(
        `${refund.provider} refund ${refund.providerPaymentId} of ${fromCents(wanted)} exceeds what is left of payment ${original.id} ` +
          `(${fromCents(Math.max(leftCents, 0))}, its other refunds already recorded); ` +
          `${cents > 0 ? `recording ${fromCents(cents)}` : 'nothing recorded'}`,
      );
    }
    return cents > 0 ? fromCents(cents) : 0;
  }

  /**
   * Refund variant used when the original capture id is unavailable (e.g.
   * a PayPal refund webhook with no `supplementary_data.related_ids`). The
   * original is resolved on the invoice, under its lock: the most recent
   * SUCCESSFUL payment of the refund's provider (any provider when the
   * invoice has none), and the refund row links to it (V1-29c: reference =
   * its providerPaymentId) and posts the amount refunded in the same commit,
   * never more than what is left of it (review SEC-V29C-2).
   *
   * W3-VOID-PROVIDER-RACE review CR-VPR-1 (the D-76 pattern VN-08 follows,
   * D-14): a VOID invoice holding no SUCCESSFUL payment took none this refund
   * can return (its capture was refused, VN-08, and the owner refunded it as
   * the refusal notice asks). Read under the lock, nothing is written and
   * VOID_INVOICE_NOTHING_TO_REFUND is answered, so the caller keeps the event
   * refused; recording the full amount with no original would leave the VOID
   * invoice at net -amount with a ledger that reads 0.
   */
  private async createRefundWithPostingByInvoice(
    invoice: { invoiceId: string; businessId: string },
    refund: ProviderRefund,
    requested: number,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      await PaymentsService.lockInvoice(txClient, invoice.invoiceId);
      const recorded = await tx.payment.findUnique({
        where: { providerPaymentId: refund.providerPaymentId },
        select: { id: true },
      });
      if (recorded || !(toCents(requested) > 0)) return null;
      const candidates = { invoiceId: invoice.invoiceId, businessId: invoice.businessId, status: 'SUCCESSFUL' };
      const select = { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true };
      const original: RefundOriginal | null =
        (await tx.payment.findFirst({
          where: { ...candidates, provider: refund.provider },
          orderBy: { createdAt: 'desc' },
          select,
        })) ??
        (await tx.payment.findFirst({
          where: candidates,
          orderBy: { createdAt: 'desc' },
          select,
        }));
      if (!original) {
        // CR-VPR-1: nothing received to return on a VOID invoice; no row, no posting.
        const current = await tx.invoice.findUnique({ where: { id: invoice.invoiceId }, select: { status: true } });
        if (current?.status === 'VOID') return VOID_INVOICE_NOTHING_TO_REFUND;
      }
      const amount = original
        ? this.cappedAtWhatIsLeft(requested, await PaymentsService.leftToRefundCents(txClient, original, []), original, refund)
        : requested;
      if (!(toCents(amount) > 0)) return null;
      const created = await tx.payment.create({
        data: {
          provider: refund.provider,
          providerPaymentId: refund.providerPaymentId,
          amount: subtractMoney(0, amount),
          currency: refund.currency,
          status: 'REFUNDED',
          invoiceId: invoice.invoiceId,
          businessId: invoice.businessId,
          reference: original?.providerPaymentId ?? null,
          notes: refund.notes,
        },
      });
      if (original) {
        await this.revenuePosting.onPaymentRefunded(original.id, {
          tx: txClient,
          refund: { paymentId: created.id, amount },
        });
      }
      return created;
    });
  }

  /**
   * V1-29c (BR-08) — how much of a Stripe refund is not recorded yet, in
   * currency units, read under the invoice lock. `held`: the Stripe refund
   * rows of the original's charge (linked to the original, or, written before
   * V1-29c, referencing the charge id); a manual refund is not Stripe's and is
   * not counted.
   *
   * - charge.refunded without refunds.data carries only the charge's
   *   cumulative amount_refunded: what it adds to `held` is recorded (the
   *   dedupe on charge + cumulative amount delta), so a redelivery, a repeat
   *   with the same cumulative, or a cumulative the refunds already recorded
   *   under their own ids reach, write nothing.
   * - A refund with its own id (not recorded under it) is recorded in full,
   *   unless a cumulative row written before it already holds it: the refunds
   *   recorded under their own ids plus this one do not exceed `held`. A
   *   cumulative row and the refunds it holds are never both counted; a
   *   refund that arrives ahead of the charge.refunded naming it is caught up
   *   by that cumulative.
   *
   * Never more than the payment: the door (createRefundWithPosting) caps the
   * result at what is left after every refund linked to the payment, the
   * manual refund's included (review SEC-V29C-2).
   */
  private async stripeRefundToRecord(
    tx: Prisma.TransactionClient,
    original: RefundOriginal,
    refund: { amountMinor: number; charge: string; cumulative: boolean },
  ): Promise<number> {
    const stripeRows = {
      businessId: original.businessId,
      invoiceId: original.invoiceId,
      provider: 'stripe',
      status: 'REFUNDED',
      amount: { lt: 0 },
      reference: { in: [original.providerPaymentId, refund.charge] },
      NOT: { providerPaymentId: { startsWith: MANUAL_REFUND_ID_PREFIX } },
    };
    const amountCents = Math.round(Math.abs(refund.amountMinor));
    const grossCents = toCents(Number(original.amount));
    if (!refund.cumulative) {
      const cumulativeRow = await tx.payment.findFirst({
        where: { ...stripeRows, providerPaymentId: { startsWith: SYNTHETIC_REFUND_ID_PREFIX } },
        select: { id: true },
      });
      if (!cumulativeRow) return fromCents(amountCents);
    }
    const rows = await tx.payment.findMany({ where: stripeRows, select: { providerPaymentId: true, amount: true } });
    const held = rows.reduce((s, r) => s + Math.abs(toCents(Number(r.amount))), 0);
    const heldUnderOwnIds = rows
      .filter((r) => !r.providerPaymentId.startsWith(SYNTHETIC_REFUND_ID_PREFIX))
      .reduce((s, r) => s + Math.abs(toCents(Number(r.amount))), 0);
    const adds = refund.cumulative
      ? Math.min(amountCents, grossCents) - held
      : heldUnderOwnIds + amountCents <= held
        ? 0
        : amountCents;
    const cents = Math.min(adds, grossCents - held);
    return cents > 0 ? fromCents(cents) : 0;
  }

  /**
   * V1-15c — a provider delivery's dedupe claim (the webhook_events row that
   * InvoiceWorkflowService.assertNewProviderEvent writes before any side
   * effect) means "this event was handled". It commits before the payment
   * transaction runs, so when that transaction aborts (P2028 behind a lock, a
   * deadlock, a failed posting) the payment is rolled back while the claim
   * stays, and every redelivery is acked as a duplicate: the payment is lost
   * (the V1-15 verification; LWD-07 and LWD-21's history). A delivery that
   * fails gives its claim back, so the provider's redelivery runs it again;
   * every money write it repeats is idempotent on Payment.providerPaymentId.
   * Best effort: a release that fails is logged and the delivery's own error
   * stands.
   */
  private async releaseProviderEvent(provider: string, providerEventId: string | undefined): Promise<void> {
    if (!providerEventId) return;
    try {
      await this.prisma.client.webhookEvent.deleteMany({ where: { provider, providerEventId } });
    } catch (e) {
      this.logger.error(
        `Could not release ${provider} webhook ${providerEventId} after its delivery failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** V1-15c — run a claimed delivery's side effects; when they throw, release the claim, then rethrow. */
  private async underProviderEventClaim<T>(provider: string, providerEventId: string | undefined, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      await this.releaseProviderEvent(provider, providerEventId);
      throw e;
    }
  }

  /**
   * V1-15c review (SEC-V15C-1, CR-V15C-2) — whether a Payment row with this
   * provider id is committed. A unique violation alone does not say so: the
   * payment transaction also writes financial_transactions, whose
   * (business_id, external_ref) and reversal_of_id are unique too, and a
   * violation of either rolls the Payment row back with it.
   */
  private async paymentRecorded(providerPaymentId: string | undefined): Promise<boolean> {
    if (!providerPaymentId) return false;
    const row = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * V1-15c — a provider refund whose row another delivery already recorded
   * (unique providerPaymentId) is done; any other failure aborted the refund
   * transaction, so it fails the delivery (and releases its claim) instead of
   * being acked as processed with nothing recorded. Review (SEC-V15C-1,
   * CR-V15C-2): the P2002 is tolerated only when the refund's own row is
   * committed. Two partial refunds of one capture processed together both
   * reverse the same original posting; the loser fails on
   * financial_transactions.reversal_of_id and its refund row is rolled back,
   * so its delivery fails and the provider's redelivery records it.
   */
  private refundAlreadyRecorded(provider: string, refundId: string | undefined) {
    return async (e: unknown): Promise<null> => {
      if ((e as { code?: string } | null)?.code !== 'P2002' || !(await this.paymentRecorded(refundId))) throw e;
      this.logger.warn(`${provider} refund ${refundId} was already recorded by another delivery`);
      return null;
    };
  }

  /**
   * When a payment webhook references an ID that is not an Invoice, it may
   * be a MarketplaceOrder (storefront checkout). If so, call
   * StoreOrderService to complete the checkout lifecycle atomically.
   */
  private async maybeCompleteStorefrontOrder(
    orderId: string,
    providerPaymentId: string,
    provider: 'stripe' | 'paypal',
    /**
     * Trial-N review (G6PUB-SEC-4): what the provider says it took, when the
     * order is not bound to the payment by this server. A PayPal order can be
     * made client-side with the public client id, so its capture names any
     * storefront order in custom_id for any amount and currency; the order is
     * settled (for its whole total) only by a capture of exactly its total in
     * its currency. Any other capture is logged and nothing is recorded.
     */
    paid?: { amount: unknown; currency: unknown },
  ): Promise<boolean> {
    if (!this.storeOrderService) return false;
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id: orderId },
      select: { id: true, paymentStatus: true, total: true, currency: true },
    });
    if (!order) return false;
    if (order.paymentStatus === 'PAID') {
      this.logger.debug(`Storefront order ${orderId} already PAID; idempotent no-op`);
      return true;
    }
    if (paid) {
      const value = Number(paid.amount);
      const matches =
        Number.isFinite(value) &&
        value.toFixed(2) === Number(order.total).toFixed(2) &&
        normalizeCurrency(typeof paid.currency === 'string' ? paid.currency : null) === normalizeCurrency(order.currency);
      if (!matches) {
        this.logger.error(
          `${provider} payment ${providerPaymentId} for storefront order ${orderId} not recorded: it took ` +
            `${String(paid.amount)} ${String(paid.currency)}, the order is ${Number(order.total).toFixed(2)} ${order.currency}`,
        );
        return true;
      }
    }
    // Trial-N review (G6ML-3): the provider is the payment's (its deposit leg is PAYMENT_PROCESSOR, not CASH).
    await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', providerPaymentId, provider);
    return true;
  }

  private getPaypalClient(clientId?: string, clientSecret?: string): { client: Client; ordersController: OrdersController } | null {
    const id = clientId || process.env.PAYPAL_CLIENT_ID;
    const secret = clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) return null;

    const isProduction = process.env.PAYPAL_ENVIRONMENT === 'production';
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: id,
        oAuthClientSecret: secret,
      },
      environment: isProduction ? Environment.Production : Environment.Sandbox,
      logging: {
        logLevel: LogLevel.Error,
        logRequest: { logBody: false },
        logResponse: { logBody: false },
      },
    });

    const ordersController = new OrdersController(client);
    return { client, ordersController };
  }

  /**
   * V1-46b-TOKEN-PAY-COMPLETE (M34, review ST-1; D-07: token links only) —
   * the invoice a customer pay-link token opens, resolved ONLY through an
   * active, unexpired PaymentLink of the invoice's own tenant: the resolver
   * the token pay read and intent use (CommerceService.getPaymentLinkByToken,
   * V1-48/V1-46). Behind it, the same shareable gate as that read: a DRAFT,
   * VOID, FAILED, PENDING or soft-deleted invoice reads as absent. Every
   * refusal is one 404 body, the one an unknown token gets, and nothing
   * downstream (no provider, no row) is reached.
   *
   * W4-CREDIT-AWARE-READERS (V1-44 review CR-V44-1, reader half; D-78): this
   * gate stays SHAREABLE_INVOICE_STATUSES, not the credit-aware list the
   * commerce share surfaces read (isCreditAwareShareableInvoiceStatus). A
   * PARTIALLY_CREDITED invoice is shown on the token pay page with what its
   * APPLIED credit notes leave owing, and takes the offline intent there
   * (CommerceService), but the routes behind this gate do not net credits:
   * the status poll serves a credit-unaware `remaining` (invoicePaymentStatus)
   * and the provider checkouts charge invoice.total (assertInvoicePayable
   * refuses a credited invoice). So a credited invoice reads as absent here,
   * no gateway is offered for it and no provider is reached, rather than a
   * false amount due or a checkout for the credited part
   * (credit-note-reversal CN-32 / CN-35; the residual is that suite's it.todo).
   */
  private async payLinkInvoice(token: string): Promise<{ invoiceId: string; businessId: string }> {
    const link = await this.commerceService.getPaymentLinkByToken(token);
    if (!link) throw new NotFoundException('Invoice not found');
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: link.invoiceId, businessId: link.businessId, deletedAt: null },
      select: { status: true },
    });
    if (!invoice || !isShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Invoice not found');
    return { invoiceId: link.invoiceId, businessId: link.businessId };
  }

  /**
   * V1-46b (ST-1): the anonymous bare-id routes (status, gateway list, the
   * generic checkout's invoice payables) answer like an unknown id once every
   * link of the invoice is revoked or expired (CommerceService.
   * isBareIdPublicAccessOpen). Unknown and closed share one 404 body.
   */
  private async assertBareIdInvoiceOpen(invoiceId: string): Promise<void> {
    if (!(await this.commerceService.isBareIdPublicAccessOpen(invoiceId))) {
      throw new NotFoundException('Invoice not found');
    }
  }

  /** V1-46b: the pay page's status poll, by the token (the five keys of getInvoicePaymentStatus). */
  async getInvoicePaymentStatusByToken(token: string) {
    const { invoiceId } = await this.payLinkInvoice(token);
    return this.invoicePaymentStatus(invoiceId);
  }

  /** V1-46b: the gateways the token's business accepts. */
  async getGatewaysByToken(token: string): Promise<GatewayInfo[]> {
    const { invoiceId, businessId } = await this.payLinkInvoice(token);
    // D-69: the invoice's own currency decides whether WiPay is offered for it.
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { currency: true } });
    return this.getAvailableGateways(businessId, invoice?.currency ?? null);
  }

  /**
   * V1-46b: the bare-id gateway list (GET invoice/:invoiceId/gateways). It
   * answered a plain Error (500) for an unknown id; unknown and a closed id
   * now answer one 404 (assertBareIdInvoiceOpen).
   */
  async getGatewaysForInvoice(invoiceId: string): Promise<GatewayInfo[]> {
    await this.assertBareIdInvoiceOpen(invoiceId);
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, currency: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.getAvailableGateways(invoice.businessId, invoice.currency);
  }

  /**
   * V1-46b: a Stripe, WiPay or PayPal checkout for the token's invoice. The
   * per-provider work is createInvoiceCheckout, unchanged (payable gate,
   * return-URL allow-list, provider request); only the invoice comes from the
   * token instead of a bare id in the path.
   */
  async createCheckoutByToken(
    token: string,
    input: { gateway: 'stripe' | 'paypal' | 'wipay'; returnUrl?: string; successUrl?: string; cancelUrl?: string },
  ) {
    const { invoiceId } = await this.payLinkInvoice(token);
    return this.createInvoiceCheckout(invoiceId, input.gateway, input.returnUrl, input.successUrl, input.cancelUrl);
  }

  /**
   * V1-46b: the PayPal capture for the token's invoice. The invoice is the
   * token's, never one named by the caller (the bare route took
   * `body.invoiceId`, so any order could be captured against any invoice).
   * The token alone does not bind the ORDER to that invoice: capturePaypalOrder
   * reads the order first and refuses one created for another invoice, order
   * or tenant, or for another amount (V1-46b review SEC-V46B-3,
   * assertPaypalOrderForInvoice).
   */
  async capturePaypalOrderByToken(token: string, orderId: string) {
    const { invoiceId } = await this.payLinkInvoice(token);
    return this.capturePaypalOrder(orderId, invoiceId);
  }

  /**
   * The gateways a payable of this business can be checked out through.
   * `payableCurrency` is the payable's own currency (an invoice's); without
   * one, the business currency (D-13).
   */
  async getAvailableGateways(businessId: string, payableCurrency?: string | null): Promise<GatewayInfo[]> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true, currency: true },
    });

    const gateways: GatewayInfo[] = [];
    const meta = (business?.metaData as Record<string, any>) || {};

    // Trial-N review (NEW-1, CR-V05-6): WiPay is offered only where its checkout
    // starts and its callbacks can be verified (wipayCheckoutTarget): a key
    // that verifies this business's payments and an account number to pay
    // into, both from one source (resolveWipayMerchant; repair round 2,
    // G6RC-1: the business's own pair or the platform's, never mixed).
    // D-69 (G6ML-2): and only for a TTD amount, until WiPay's currency
    // parameter is verified from its documentation.
    const currency = payableCurrency ?? business?.currency ?? null;
    if (wipayMerchantComplete(resolveWipayMerchant(meta)) && PaymentsService.wipayTakesCurrency(currency)) {
      gateways.push({
        id: 'wipay',
        name: 'WiPay',
        currencies: [PaymentsService.WIPAY_CURRENCY],
      });
    }

    const paypalId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (paypalId && paypalSecret) {
      gateways.push({
        id: 'paypal',
        name: 'PayPal',
        currencies: ['USD'],
      });
    }

    const stripePub = meta.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const stripeSecret = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    const stripeWh = meta.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (stripePub && stripeSecret && stripeWh) {
      gateways.push({
        id: 'stripe',
        name: 'Stripe',
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
      });
    }

    return gateways;
  }

  /**
   * Centralised payment-eligibility gate. Checkout/order/redirect endpoints
   * must call this before creating an external session — DRAFT invoices
   * MUST NOT be paid (they have no commitment), and PAID/VOID/FAILED are
   * terminal. Allowed states: SENT, OVERDUE, PARTIALLY_PAID, PENDING.
   */
  private assertInvoicePayable(status: string, invoiceId: string): void {
    const allowed = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PENDING']);
    if (allowed.has(status)) return;
    if (status === 'PAID') throw new BadRequestException('Invoice is already paid');
    if (status === 'VOID') throw new BadRequestException('Invoice is void');
    if (status === 'DRAFT') {
      throw new BadRequestException(
        `Invoice ${invoiceId} is still a draft — send it before collecting payment`,
      );
    }
    throw new BadRequestException(`Invoice ${invoiceId} is not in a payable state (${status})`);
  }

  async createStripeCheckout(
    invoiceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ redirectUrl: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: { select: { email: true } },
        business: { select: { id: true, name: true, metaData: true } },
      },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const secretKey = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new BadRequestException('Stripe is not configured for this business');

    const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.startsWith('http') ? s : `https://${s}`);
    if (allowed.length === 0) {
      this.logger.error('No PUBLIC_URL_ALLOWLIST configured; rejecting Stripe checkout for safety');
      throw new BadRequestException('Server misconfigured: no allowed return-URL origins set');
    }
    const isAllowedUrl = (u: string): boolean => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return allowed.some((a) => {
          try { return new URL(a).origin === parsed.origin; } catch { return false; }
        });
      } catch { return false; }
    };
    if (!isAllowedUrl(successUrl) || !isAllowedUrl(cancelUrl)) {
      throw new BadRequestException('Invalid success/cancel URL');
    }

    const currency = (invoice.currency || 'USD').toLowerCase();
    const amount = Math.round(Number(invoice.total) * 100);
    const description = `Invoice ${invoice.invoiceNumber || invoice.id} — ${invoice.business.name || ''}`.trim();

    const body = new URLSearchParams();
    body.append('mode', 'payment');
    body.append('success_url', successUrl);
    body.append('cancel_url', cancelUrl);
    body.append('client_reference_id', invoiceId);
    body.append('metadata[invoiceId]', invoiceId);
    body.append('metadata[businessId]', invoice.business.id);
    if (invoice.contact?.email) body.append('customer_email', invoice.contact.email);
    body.append('line_items[0][quantity]', '1');
    body.append('line_items[0][price_data][currency]', currency);
    body.append('line_items[0][price_data][unit_amount]', String(amount));
    body.append('line_items[0][price_data][product_data][name]', description);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Stripe checkout creation failed: ${text}`);
      throw new BadRequestException('Failed to create Stripe checkout session');
    }

    const session = (await res.json()) as { id: string; url: string };
    return { redirectUrl: session.url };
  }

  private verifyStripeSignature(rawPayload: string, signatureHeader: string, secret: string): boolean {
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = (acc[k.trim()] ? acc[k.trim()] + ',' : '') + v.trim();
      return acc;
    }, {});
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) return false;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawPayload}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const candidates = provided.split(',').map((s) => Buffer.from(s, 'utf8'));
    return candidates.some((b) => b.length === a.length && timingSafeEqual(a, b));
  }

  async handleStripeWebhook(
    rawPayload: string,
    signatureHeader: string | undefined,
    /** R0-20d: the legacy POST /webhooks/stripe names its own refusal label; the door's endpoint keeps the default. */
    opts: { refusedProvider?: StripeRefusedProvider } = {},
  ): Promise<{ ok: true; received?: boolean; processed?: string }> {
    if (!rawPayload) throw new BadRequestException('Missing Stripe webhook payload');

    let event: { id?: string; type?: string; data?: { object?: any } };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook payload');
    }

    const obj = event.data?.object || {};
    const eventType = event.type || '';

    // Verify signature using a webhook endpoint secret. Prefer the global env
    // secret (one shared Stripe webhook endpoint per deployment); fall back to
    // a per-business secret stored in business.metaData.stripeWebhookSecret
    // when an invoice can be resolved from the event.
    const candidateInvoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id;

    const envSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let signatureOk = false;
    // V1-15c review (SEC-V15C-3): the business whose own secret verified the
    // delivery. A tenant sets that secret itself (Settings > Payments), so such
    // a delivery speaks for that tenant only; null when the deployment's
    // secret (Stripe's alone) verified it.
    let signedForBusinessId: string | null = null;
    if (envSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, envSecret)) {
      signatureOk = true;
    } else if (candidateInvoiceId) {
      const inv = await this.prisma.client.invoice.findUnique({
        where: { id: candidateInvoiceId },
        include: { business: { select: { metaData: true } } },
      }).catch(() => null);
      const businessSecret = (inv?.business.metaData as Record<string, any> | null)?.stripeWebhookSecret as string | undefined;
      if (inv && businessSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, businessSecret)) {
        signatureOk = true;
        signedForBusinessId = inv.businessId;
      }
    }

    if (!signatureOk) {
      if (!envSecret) {
        this.logger.error('Stripe webhook secret not configured; rejecting webhook');
      } else {
        this.logger.warn(`Stripe webhook signature verification failed (event=${eventType})`);
      }
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // R0-20c-STRIPE-DOOR-BINDING (review SEC-R020B-2): a payment event is bound
    // to the invoice or storefront order it names before the dedupe claim, so a
    // refused one writes nothing (no payment, no posting, no claim). The legacy
    // POST /webhooks/stripe hands its verified events here too, and since
    // R0-20d this is its only binding (its refusals keep its own label).
    if (STRIPE_PAYMENT_EVENTS.has(eventType)) {
      await this.bindStripePaymentEvent(event, signedForBusinessId, opts.refusedProvider ?? STRIPE_REFUSED_PROVIDER);
    }

    // Provider-event-id idempotency: if Stripe re-delivers this `evt_...`,
    // ack it as received but skip all side-effects. Belt-and-suspenders with
    // the per-Payment.providerPaymentId unique constraint downstream.
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'stripe',
      event.id,
      eventType,
      undefined,
    );
    if (!fresh) {
      return { ok: true, received: true };
    }

    // Dispatch by event type. Unknown event types are acked but ignored so
    // Stripe doesn't keep retrying them. A dispatch that throws gives the
    // claim back (V1-15c), so Stripe's redelivery is processed, not acked.
    return this.underProviderEventClaim<WebhookAck>('stripe', event.id, async () => {
      switch (eventType) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          // Note: Stripe Payment Links surface as `checkout.session.completed`
          // events with `payment_link` set on the session — there is no
          // separate `payment_link.completed` event in the Stripe API.
          // R0-20c review (SEC-R020C-2): a session that has not taken its
          // money (payment_status 'unpaid': a delayed payment method) records
          // nothing; its async_payment_succeeded records it, and an
          // async_payment_failed (acknowledged below) has nothing to undo.
          if (!stripeSessionTookMoney(obj)) {
            this.logger.log(`Stripe ${eventType} ${event.id ?? ''} is ${String(obj?.payment_status)}; nothing recorded until it is paid`);
            return { ok: true, received: true };
          }
          await this.processStripeChargeOrSession(eventType, obj, event.id);
          return { ok: true, received: true, processed: eventType };
        case 'charge.succeeded':
        case 'payment_intent.succeeded':
          await this.processStripeChargeOrSession(eventType, obj, event.id);
          return { ok: true, received: true, processed: eventType };
        case 'charge.refunded':
        case 'refund.created':
        case 'charge.refund.updated':
          await this.processStripeRefund(eventType, obj, signedForBusinessId);
          return { ok: true, received: true, processed: eventType };
        default:
          return { ok: true, received: true };
      }
    });
  }

  /**
   * R0-20c-STRIPE-DOOR-BINDING (review SEC-R020B-2; the binding R0-20b gave the
   * legacy route alone). A verified event the door would record as a payment
   * must be one made for the invoice or storefront order it names; the id is
   * read exactly as processStripeChargeOrSession reads it.
   *
   * Invoice X (createStripeCheckout): the business is X's. metadata.businessId,
   * when the event carries one, is X's business; a platform-signed event (a
   * session, Payment Link or not, a charge or a payment intent) must carry it
   * (R0-20c review SEC-R020C-1, as the legacy route); a delivery a tenant
   * signed with its own secret speaks for that tenant only.
   * The currency is X's and the amount a positive number of minor units. The
   * amount recorded is the one the event carries (D-05, R0-20b review
   * CR-R020B-1), never a fallback to X's total.
   *
   * Storefront order O (createStorePayment): the door settles O for its whole
   * total, so the event must name O in metadata.orderId and O's business in
   * metadata.businessId and carry exactly O's total in O's currency.
   *
   * Anything else is refused (400) before the dedupe claim, so nothing is
   * written, and the refusal is kept as one webhook_events row under
   * `refusedProvider` (R0-20d: stripe-legacy-refused when the legacy POST
   * /webhooks/stripe handed the event over; this is that route's only
   * binding). An id that is neither is left to the dispatch, which records
   * nothing for it.
   */
  private async bindStripePaymentEvent(
    event: { id?: string; type?: string; data?: { object?: unknown } },
    signedForBusinessId: string | null,
    refusedProvider: StripeRefusedProvider,
  ): Promise<void> {
    const obj = (event.data?.object ?? {}) as StripePaymentObject;
    const id: unknown = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id;
    if (!id || typeof id !== 'string') return;
    const amountMinor: unknown = obj.amount_total ?? obj.amount_received ?? obj.amount;
    const positiveAmount = typeof amountMinor === 'number' && Number.isFinite(amountMinor) && amountMinor > 0;
    const currency = normalizeCurrency(typeof obj.currency === 'string' ? obj.currency : null);
    const namedBusiness: unknown = obj.metadata?.businessId;

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id },
      select: { businessId: true, currency: true },
    });
    if (invoice) {
      // R0-20c review (SEC-R020C-1): a platform-signed event must name the
      // invoice's business (the legacy route's copy of this binding demanded
      // it too; R0-20d removed that copy, both endpoints bind here). Every session
      // KeyFlow makes names it (createStripeCheckout, createStorePayment, a
      // Payment Link's metadata), and Stripe does not copy a session's
      // metadata onto its PaymentIntent or Charge, so one naming no business
      // is not KeyFlow's: its client_reference_id or metadata.invoiceId is
      // the payer's or another account's choice.
      const foreign =
        (signedForBusinessId !== null && signedForBusinessId !== invoice.businessId) ||
        (namedBusiness != null ? namedBusiness !== invoice.businessId : signedForBusinessId === null);
      const reason = foreign
        ? 'business'
        : currency === '' || currency !== normalizeCurrency(invoice.currency)
          ? 'currency'
          : !positiveAmount
            ? 'amount'
            : null;
      if (reason) await this.refuseStripePaymentEvent(event, { kind: 'invoice', id, businessId: invoice.businessId }, reason, refusedProvider);
      return;
    }

    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id },
      select: { id: true, businessId: true, total: true, currency: true },
    });
    if (!order) return;
    const reason =
      obj.metadata?.orderId !== order.id
        ? 'order'
        : namedBusiness !== order.businessId
          ? 'business'
          : currency === '' || currency !== normalizeCurrency(order.currency)
            ? 'currency'
            : !positiveAmount || amountMinor !== Math.round(Number(order.total) * 100)
              ? 'amount'
              : null;
    if (reason) await this.refuseStripePaymentEvent(event, { kind: 'order', id, businessId: order.businessId }, reason, refusedProvider);
  }

  /** R0-20c: keeps the refusal (one webhook_events row per event id and label), then refuses the delivery: 400, nothing recorded. */
  private async refuseStripePaymentEvent(
    event: { id?: string; type?: string },
    target: { kind: 'invoice' | 'order'; id: string; businessId: string },
    reason: string,
    refusedProvider: StripeRefusedProvider,
  ): Promise<never> {
    this.logger.warn(`Stripe ${event.type} ${event.id ?? '(no event id)'} refused: its ${reason} does not match ${target.kind} ${target.id}`);
    if (event.id) {
      try {
        await this.prisma.client.webhookEvent.create({
          data: {
            provider: refusedProvider,
            providerEventId: event.id,
            eventType: `${event.type}:${reason}`,
            businessId: target.businessId,
          },
        });
      } catch (e: unknown) {
        // A retry of an event already kept (unique provider + event id) adds nothing.
        if ((e as { code?: string } | null)?.code !== 'P2002') {
          this.logger.error(`Stripe refusal of ${event.id} could not be kept: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    throw new BadRequestException(`Stripe event does not match the ${target.kind}`);
  }

  private async processStripeChargeOrSession(
    eventType: string,
    obj: any,
    eventId: string | undefined,
  ): Promise<void> {
    // checkout.session.completed: invoiceId comes from session metadata or
    // client_reference_id. payment_intent.succeeded / charge.succeeded:
    // invoiceId is on the payment_intent / charge metadata if it was set
    // during checkout.session creation (see createStripeCheckout above).
    const invoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id;
    if (!invoiceId) {
      this.logger.warn(`Stripe ${eventType} has no invoiceId in metadata; ignoring`);
      return;
    }

    const providerPaymentId: string = obj.id || eventId || `stripe_${invoiceId}_${Date.now()}`;

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      const completed = await this.maybeCompleteStorefrontOrder(invoiceId, providerPaymentId, 'stripe');
      if (completed) return;
      this.logger.warn(`Stripe ${eventType} references unknown invoice ${invoiceId}`);
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId },
    }).catch(() => null);
    if (existing) return;

    // NOTE: We deliberately do NOT block subsequent successful payments for
    // the same invoice — partial payments must accumulate. The dedup above
    // (providerPaymentId @unique + the WebhookEvent table) already guards
    // against double-counting the same Stripe event/charge.

    const amountMinor: number =
      obj.amount_total ?? obj.amount_received ?? obj.amount ?? 0;
    const amount = amountMinor / 100;
    const currency = (obj.currency || invoice.currency || 'USD').toUpperCase();

    if (currency !== invoice.currency.toUpperCase()) {
      this.logger.warn(
        `Stripe ${eventType} currency mismatch for invoice ${invoiceId}: got ${currency}, expected ${invoice.currency}`,
      );
      throw new BadRequestException('Stripe webhook currency mismatch');
    }
    // Allow over- and under-payments (partials). Workflow reconciliation
    // decides whether the invoice flips PARTIALLY_PAID or PAID.
    const expectedAmount = Number(invoice.total);
    if (amount > expectedAmount + 0.01) {
      this.logger.warn(
        `Stripe ${eventType} overpayment for invoice ${invoiceId}: got ${amount}, expected ${expectedAmount}`,
      );
    }

    // Stash the related payment_intent / charge id in `reference` so that
    // later refund events (which arrive keyed by charge id and contain the
    // payment_intent) can correlate back to this row. Without this, a
    // `checkout.session.completed` row stored as `cs_...` would be
    // un-linkable from a `charge.refunded` event for the same payment.
    const reference: string | null =
      obj.payment_intent ||
      obj.charge ||
      (typeof obj.latest_charge === 'string' ? obj.latest_charge : null) ||
      null;

    const recordedAmount = amount > 0 ? amount : expectedAmount;
    const created = await this.createPaymentWithPosting({
      provider: 'stripe',
      providerPaymentId,
      amount: recordedAmount,
      currency,
      status: 'SUCCESSFUL',
      invoiceId,
      businessId: invoice.businessId,
      reference,
    });
    if (!created) {
      // VN-08 (D-76 pattern): the invoice is VOID under its lock; the delivery is acked, its event kept refused.
      await this.refuseVoidInvoicePayment({
        provider: 'stripe',
        providerPaymentId,
        // SEC-VN08-1: event.id is this delivery's claim when Stripe sent one; with none, nothing was claimed.
        claimedEventId: eventId,
        invoiceId,
        businessId: invoice.businessId,
        amount: recordedAmount,
        currency,
      });
      return;
    }
    // Workflow recomputes the invoice balance from ALL payment rows and
    // decides PARTIALLY_PAID vs PAID. Single source of truth for state.
    await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch((e) => {
      this.logger.warn(`Stripe reconcile failed for invoice ${invoiceId}: ${e instanceof Error ? e.message : e}`);
    });
  }

  private async processStripeRefund(eventType: string, obj: any, signedForBusinessId: string | null): Promise<void> {
    // For charge.refunded the object is a Charge with refunds.data[]. For
    // refund.created / charge.refund.updated the object is a Refund itself.
    const refunds: Array<{
      id?: string;
      amount?: number;
      currency?: string;
      charge?: string;
      paymentIntent?: string | null;
      status?: string;
      reason?: string | null;
      /** V1-29c: the charge's cumulative amount_refunded, not one refund. */
      cumulative: boolean;
    }> = [];

    if (eventType === 'charge.refunded') {
      const list: any[] = obj?.refunds?.data ?? [];
      for (const r of list) {
        refunds.push({
          id: r.id,
          amount: r.amount,
          currency: r.currency,
          charge: r.charge ?? obj.id,
          paymentIntent: r.payment_intent ?? obj.payment_intent ?? null,
          status: r.status,
          reason: r.reason,
          cumulative: false,
        });
      }
      // Without refunds.data (Stripe API 2022-11-15 and later omit
      // Charge.refunds) the charge's cumulative amount_refunded is all there
      // is. V1-29c (BR-08): the row is keyed by the payment, charge and
      // cumulative (its id is built once the payment is found, review
      // SEC-V29C-3), and the door records only what that cumulative adds to
      // the refunds already recorded for the charge (stripeRefundToRecord).
      if (refunds.length === 0 && typeof obj.amount_refunded === 'number') {
        refunds.push({
          id: undefined,
          amount: obj.amount_refunded,
          currency: obj.currency,
          charge: obj.id,
          paymentIntent: obj.payment_intent ?? null,
          status: 'succeeded',
          cumulative: true,
        });
      }
    } else {
      refunds.push({
        id: obj.id,
        amount: obj.amount,
        currency: obj.currency,
        charge: obj.charge,
        paymentIntent: obj.payment_intent ?? null,
        status: obj.status,
        reason: obj.reason,
        cumulative: false,
      });
    }

    // FOLLOW3-A3 (D-56): the provider's answer per business and charge, read once per event.
    const ownsCharge = new Map<string, boolean>();
    for (const refund of refunds) {
      if (!refund.charge || (!refund.cumulative && !refund.id)) continue;
      const charge = refund.charge;
      // Review SEC-V29C-3: the synthetic ids are the door's own; a refund id
      // an event supplies under that prefix is refused.
      if (!refund.cumulative && refund.id?.startsWith(SYNTHETIC_REFUND_ID_PREFIX)) {
        this.logger.warn(`Stripe ${eventType} names refund id ${refund.id}, a synthetic refund id the door builds itself; skipping`);
        continue;
      }
      // Idempotent: skip if we already recorded this refund (checked again
      // inside the refund transaction, under the invoice lock).
      if (refund.id && (await this.paymentRecorded(refund.id).catch(() => false))) continue;

      // Locate the original payment row to get invoiceId/businessId. The
      // original may have been stored as: the charge id (charge.succeeded
      // path), the session id with payment_intent stashed in reference
      // (checkout.session.completed path), or the payment_intent id
      // (payment_intent.succeeded path). Try every linkable identifier.
      // Review (SEC-V15C-3): Payment is outside the tenant extension (M31), so
      // this lookup spans every tenant. A delivery verified by a tenant's own
      // secret refunds that tenant's payments only: a charge id of another
      // tenant is not found, and nothing is written or reversed.
      // V1-29c: only a SUCCESSFUL payment is an original; a refund row
      // carries its original's id in reference and must never match.
      // FOLLOW3-A3-REFUND-DOOR-TENANCY: a hand-recorded row (recordedBy set,
      // or a manual_ id: the manual payment route, KEY processPayment, the
      // evidence confirm, which keep the method typed and any reference; since
      // owner ruling D-55 a 'stripe' method is stored with provider 'manual',
      // and rows stored before it carry provider 'stripe', so this rule still
      // decides for them) is no provider evidence (the V1-15d rule of payments-ops):
      // it is never an original and never an ambiguity witness below, so a
      // member who typed another tenant's charge or payment_intent can neither
      // take that tenant's refund nor block it. Rows the provider's own
      // deliveries wrote (recordedBy null, the provider's id) stay originals.
      const lookupIds = [charge, refund.paymentIntent].filter((v): v is string => !!v);
      const originalWhere: Prisma.PaymentWhereInput = {
        provider: 'stripe',
        status: 'SUCCESSFUL',
        recordedBy: null,
        NOT: { providerPaymentId: { startsWith: MANUAL_PAYMENT_ID_PREFIX } },
        ...(signedForBusinessId ? { businessId: signedForBusinessId } : {}),
        OR: [
          { providerPaymentId: { in: lookupIds } },
          { reference: { in: lookupIds } },
        ],
      };
      const found: RefundOriginal | null = await this.prisma.client.payment.findFirst({
        where: originalWhere,
        orderBy: { createdAt: 'asc' },
        select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
      }).catch(() => null);

      if (!found) {
        this.logger.warn(
          `Stripe ${eventType} could not locate original payment for charge ${charge} (pi=${refund.paymentIntent ?? 'none'})` +
            `${signedForBusinessId ? ` of business ${signedForBusinessId}, whose secret signed it` : ''}; skipping`,
        );
        continue;
      }

      // Review SEC-V29C-1: a delivery the deployment's own secret verified is
      // looked up across every tenant. When its ids match payments of more
      // than one business, the event does not say which one it refunds: a
      // tenant can store any payment_intent id in the reference of a payment
      // it signs for itself with its own secret. Nothing is written and the
      // refusal is logged; taking one of them (the oldest) could write one
      // tenant's refund into another tenant's books. Not caught: a failed
      // read fails the delivery (its claim is released) rather than letting
      // an ambiguous refund through.
      // FOLLOW3-A3 (owner ruling D-56): with the Stripe connector (always, as
      // the container builds this service) the provider's record binds the
      // refund to its business instead (platformRefundOriginal), whether one
      // business matches or several; the rule above holds for a service built
      // without it.
      const original = !signedForBusinessId && this.stripeConnector
        ? await this.platformRefundOriginal(eventType, charge, refund.paymentIntent ?? null, originalWhere, ownsCharge)
        : found;
      if (!original) continue;
      if (!signedForBusinessId && !this.stripeConnector) {
        const other = await this.prisma.client.payment.findFirst({
          where: { ...originalWhere, businessId: { not: original.businessId } },
          select: { id: true, businessId: true },
        });
        if (other && other.businessId !== original.businessId) {
          this.logger.warn(
            `Stripe ${eventType} for charge ${charge} (pi=${refund.paymentIntent ?? 'none'}) matches payments of more than one business ` +
              `(${original.businessId}, ${other.businessId}); refusing to record it against either`,
          );
          continue;
        }
      }

      // The synthetic id names the payment it refunds (review SEC-V29C-3).
      const refundId = refund.cumulative
        ? `${SYNTHETIC_REFUND_ID_PREFIX}${original.id}_${charge}_${refund.amount}`
        : (refund.id as string);
      if (refund.cumulative && (await this.paymentRecorded(refundId).catch(() => false))) continue;

      const persisted = await this.createRefundWithPosting(
        original,
        {
          provider: 'stripe',
          providerPaymentId: refundId,
          currency: (refund.currency || original.currency || 'USD').toUpperCase(),
          notes: refund.reason ?? null,
        },
        (tx) => this.stripeRefundToRecord(tx, original, { amountMinor: refund.amount ?? 0, charge, cumulative: refund.cumulative }),
        // Stripe refund rows written before V1-29c reference the charge id.
        [charge],
      ).catch(this.refundAlreadyRecorded('Stripe', refundId));
      // Reopen the invoice if the refund moves the balance below total.
      if (persisted) {
        await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId).catch((e) => {
          this.logger.warn(`Stripe refund reconcile failed for invoice ${original.invoiceId}: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
  }

  /**
   * FOLLOW3-A3-REFUND-DOOR-TENANCY (owner ruling D-56): the payment a Stripe
   * refund event verified by the deployment's own secret refunds. Such an
   * event carries no owner tag (a Refund object has no charge metadata;
   * createStripeCheckout tags the Checkout Session, not the charge), and a
   * row of another business can name its ids: a tenant records any
   * payment_intent in the reference of a payment it signs for itself with its
   * own secret, and Payment does not store which secret verified it. So the
   * provider's record decides: StripeConnector.isOwnCharge reads the charge
   * (then the Checkout Session of its payment_intent) and says whether the
   * platform tagged it with a business. Of the businesses whose payments
   * match (`originalWhere`), the one it names is the refund's, its oldest
   * matching payment the original. When it names none of them, or more than
   * one, nothing is written and the refusal is logged: a refund is never
   * booked into, or blocked by, another tenant's self-signed row. A failed
   * read is not caught: the delivery fails (its claim is released) and Stripe
   * delivers it again. `owns` keeps the answer per business and charge, so a
   * charge.refunded listing several refunds reads the provider once.
   *
   * Review SEC-A3-1/2, CR-A3-2: such an event is about a charge on the
   * platform account, so only a business that takes Stripe payments there (no
   * Stripe key of its own, onPlatformAccount) is asked through isOwnCharge.
   * For a business with its own key, isOwnCharge reads that business's own
   * account with that key and counts that business's own rows (which a
   * delivery it signs itself writes) as proof: its answer, or its failure, is
   * never the platform's record, and asking it would let a tenant fail every
   * delivery of another tenant's refund (an invalid key) or claim or block it
   * (a self-signed row naming the charge). A business that saves a key of its
   * own while it is being asked is treated the same: its answer does not count
   * and its failed read does not fail the delivery.
   *
   * W3-PLATFORM-CHARGE-BIND (review CR-A3-1, owner ruling D-56; review
   * repairs SEC-PCB-1, PCB-CR-1): a business that holds a key of its own may
   * still own a charge on the platform account: one taken there for it before
   * it saved that key, whenever its payment row was recorded (a Checkout
   * Session opened before the save can be paid, and its completion delivered
   * or redelivered, after it). So every such business with a matching payment
   * is answered by the platform account's own record
   * (StripeConnector.platformChargeOwners: read once per charge with the
   * deployment's key, the platform's tag only, no payment row as evidence, no
   * business's own key), and that answer counts as the answer of a business on
   * the platform account does. Whether the record is read for such a business
   * depends on nothing it can move (when its business row was last written,
   * when its payment row was recorded). A failed read fails the delivery
   * (review PCB-CR-2): its claim is released and Stripe delivers it again.
   */
  private async platformRefundOriginal(
    eventType: string,
    charge: string,
    paymentIntent: string | null,
    originalWhere: Prisma.PaymentWhereInput,
    owns: Map<string, boolean>,
  ): Promise<RefundOriginal | null> {
    const connector = this.stripeConnector;
    if (!connector) return null;
    const matches = await this.prisma.client.payment.findMany({
      where: originalWhere,
      orderBy: { createdAt: 'asc' },
      select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
    });
    const businesses = [...new Set(matches.map((m) => m.businessId))];
    const onPlatform = await this.onPlatformAccount(businesses);
    const owners: string[] = [];
    for (const businessId of businesses) {
      if (!onPlatform.has(businessId)) continue;
      const key = `${businessId} ${charge}`;
      let own = owns.get(key);
      if (own === undefined) {
        own = await connector.isOwnCharge(businessId, charge).catch(async (err: unknown) => {
          // A read on the platform account failed: the delivery fails. A read
          // on a key the business saved meanwhile is no answer at all.
          if ((await this.onPlatformAccount([businessId])).has(businessId)) throw err;
          return false;
        });
        owns.set(key, own);
      }
      if (own) owners.push(businessId);
    }
    // W3-PLATFORM-CHARGE-BIND (CR-A3-1, D-56; review SEC-PCB-1, PCB-CR-1): every
    // business holding a key of its own is answered by the platform account's
    // own record, read once per charge for all of them, whenever its payment was
    // recorded. A failed read is not caught: the delivery fails (PCB-CR-2).
    const ownKey = businesses.filter((b) => !onPlatform.has(b));
    const unread = ownKey.filter((b) => !owns.has(`${b} ${charge} platform`));
    if (unread.length > 0) {
      const named = await connector.platformChargeOwners(charge, unread);
      for (const b of unread) owns.set(`${b} ${charge} platform`, named.has(b));
    }
    const platformOwners = ownKey.filter((b) => owns.get(`${b} ${charge} platform`) === true);
    // An owner that saved a key of its own while it was asked answered from its own account.
    const stillOnPlatform = owners.length > 0 ? await this.onPlatformAccount(owners) : new Set<string>();
    const confirmed = [...owners.filter((b) => stillOnPlatform.has(b)), ...platformOwners];
    if (confirmed.length !== 1) {
      const moved = owners.filter((b) => !stillOnPlatform.has(b));
      this.logger.warn(
        `Stripe ${eventType} for charge ${charge} (pi=${paymentIntent ?? 'none'}) matches payments of ${businesses.join(', ')}, ` +
          `but the platform account's record of the charge names ${confirmed.length ? `more than one of them (${confirmed.join(', ')})` : 'none of them'}` +
          `${moved.length ? ` (not counted, as they saved a Stripe key of their own while they were asked: ${moved.join(', ')})` : ''}; ` +
          'refusing to record it',
      );
      return null;
    }
    return matches.find((m) => m.businessId === confirmed[0]) ?? null;
  }

  /**
   * Review SEC-A3-1: of `businessIds`, the ones that take Stripe payments on
   * the platform account, i.e. hold no Stripe key of their own (the rule by
   * which StripeConnector.resolveKey, createStripeCheckout and the gateway
   * list choose the deployment's STRIPE_SECRET_KEY).
   */
  private async onPlatformAccount(businessIds: string[]): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const rows = await this.prisma.client.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, metaData: true },
    });
    return new Set(
      rows.filter((b) => !(b.metaData as Record<string, unknown> | null)?.stripeSecretKey).map((b) => b.id),
    );
  }

  // ---------------------------------------------------------------------------
  // PayPal webhook
  // ---------------------------------------------------------------------------

  private async verifyPaypalSignature(
    headers: Record<string, string | undefined>,
    rawPayload: string,
    sandbox: boolean,
    creds?: { clientId?: string | null; clientSecret?: string | null; webhookId?: string | null },
  ): Promise<boolean> {
    const webhookId = creds?.webhookId || process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      this.logger.error('PAYPAL_WEBHOOK_ID is not configured; cannot verify PayPal webhooks');
      return false;
    }
    const clientId = creds?.clientId || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = creds?.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      this.logger.error('PayPal client credentials not configured; cannot verify PayPal webhooks');
      return false;
    }
    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-transmission-sig',
      'paypal-cert-url',
      'paypal-auth-algo',
    ] as const;
    for (const h of required) {
      if (!headers[h]) {
        this.logger.warn(`PayPal webhook missing required header: ${h}`);
        return false;
      }
    }
    const base = sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    let token: string;
    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) {
        this.logger.warn(`PayPal token fetch for webhook verify failed: ${tokenRes.status}`);
        return false;
      }
      const data = (await tokenRes.json()) as { access_token?: string };
      if (!data.access_token) return false;
      token = data.access_token;
    } catch (e) {
      this.logger.warn(`PayPal token fetch error: ${e instanceof Error ? e.message : e}`);
      return false;
    }

    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(rawPayload);
    } catch {
      return false;
    }

    try {
      const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: webhookEvent,
        }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.text().catch(() => '');
        this.logger.warn(`PayPal verify-webhook-signature returned ${verifyRes.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
        return false;
      }
      const result = (await verifyRes.json()) as { verification_status?: string };
      return result.verification_status === 'SUCCESS';
    } catch (e) {
      this.logger.warn(`PayPal verify-webhook-signature error: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  async handlePaypalWebhook(
    rawPayload: string,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: true; received?: boolean; processed?: string }> {
    if (!rawPayload) throw new BadRequestException('Missing PayPal webhook payload');

    let event: { id?: string; event_type?: string; resource?: any };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('Invalid PayPal webhook payload');
    }

    const sandbox = process.env.PAYPAL_ENVIRONMENT !== 'production';

    // Resolve per-business PayPal credentials before verifying signature, so
    // multi-tenant deployments where each business has its own PayPal app
    // (with its own webhook id) work correctly. We try to identify the
    // business via custom_id/invoice_id/related order; if none match, fall
    // back to env-level credentials.
    const businessCreds = await this.resolvePaypalBusinessCreds(event.resource || {});
    const verified = await this.verifyPaypalSignature(headers, rawPayload, sandbox, businessCreds ?? undefined);
    if (!verified) {
      throw new BadRequestException('Invalid PayPal webhook signature');
    }

    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'paypal',
      event.id,
      event.event_type,
      undefined,
    );
    if (!fresh) {
      return { ok: true, received: true };
    }

    const eventType = event.event_type || '';
    const resource = event.resource || {};

    // A dispatch that throws gives the claim back (V1-15c): PayPal's redelivery is processed, not acked.
    return this.underProviderEventClaim<WebhookAck>('paypal', event.id, async () => {
      switch (eventType) {
        case 'PAYMENT.CAPTURE.COMPLETED':
          await this.processPaypalCaptureCompleted(resource, event.id);
          return { ok: true, received: true, processed: eventType };
        case 'CHECKOUT.ORDER.COMPLETED':
          // For ORDER.COMPLETED, resource.id is the *order* id, not the
          // capture id. Captures live under purchase_units[].payments.captures.
          // Persist a Payment row per capture so refund linkage (which keys on
          // capture id) keeps working, and idempotency stays intact even if
          // PAYMENT.CAPTURE.COMPLETED also arrives for the same capture.
          await this.processPaypalOrderCompleted(resource, event.id);
          return { ok: true, received: true, processed: eventType };
        case 'PAYMENT.CAPTURE.REFUNDED':
        case 'PAYMENT.CAPTURE.REVERSED':
          await this.processPaypalRefund(resource, event.id);
          return { ok: true, received: true, processed: eventType };
        default:
          return { ok: true, received: true };
      }
    });
  }

  /**
   * Look up the business behind a PayPal webhook resource (via the linked
   * invoice) and return its PayPal app credentials, falling back to env.
   * Returns null when no business can be resolved — the caller will then use
   * env-level credentials only.
   */
  private async resolvePaypalBusinessCreds(
    resource: any,
  ): Promise<{ clientId: string | null; clientSecret: string | null; webhookId: string | null } | null> {
    const link = await this.resolvePaypalInvoiceId(resource).catch(() => null);
    if (!link) return null;
    const business = await this.prisma.client.business.findUnique({
      where: { id: link.businessId },
      select: { metaData: true },
    }).catch(() => null);
    const meta = (business?.metaData as Record<string, any> | null) ?? {};
    const clientId = (meta.paypalClientId as string | undefined) ?? null;
    const clientSecret = (meta.paypalClientSecret as string | undefined) ?? null;
    const webhookId = (meta.paypalWebhookId as string | undefined) ?? null;
    if (!clientId && !clientSecret && !webhookId) return null;
    return { clientId, clientSecret, webhookId };
  }

  /**
   * Walk an ORDER.COMPLETED resource and persist a payment row for each
   * embedded capture. This is the only safe way to handle this event:
   * resource.id is the order id (not a capture id), so persisting it
   * directly would create a row that refund events cannot link to.
   */
  private async processPaypalOrderCompleted(resource: any, eventId?: string): Promise<void> {
    const orderId: string | undefined = resource?.id;
    const purchaseUnits: any[] = Array.isArray(resource?.purchase_units) ? resource.purchase_units : [];
    const captures: any[] = [];
    for (const pu of purchaseUnits) {
      const capList: any[] = pu?.payments?.captures ?? [];
      for (const cap of capList) {
        captures.push({
          ...cap,
          custom_id: cap?.custom_id ?? pu?.custom_id ?? resource?.custom_id,
          invoice_id: cap?.invoice_id ?? pu?.invoice_id ?? resource?.invoice_id,
          supplementary_data: {
            related_ids: { order_id: orderId, ...(cap?.supplementary_data?.related_ids ?? {}) },
          },
        });
      }
    }
    if (captures.length === 0) {
      this.logger.log(
        `PayPal order ${orderId ?? '<unknown>'} completed but no captures present; awaiting PAYMENT.CAPTURE.COMPLETED`,
      );
      return;
    }
    for (const cap of captures) {
      await this.processPaypalCaptureCompleted(cap, eventId);
    }
  }

  /**
   * Resolve the local invoiceId for a PayPal resource. PayPal does not echo
   * purchase_units back on capture events, so we rely on `custom_id` /
   * `invoice_id` (set when the order was created) and fall back to looking up
   * an existing payment row by the related order id.
   */
  private async resolvePaypalInvoiceId(resource: any): Promise<{ invoiceId: string; businessId: string } | null> {
    const candidate: string | undefined =
      resource?.custom_id ||
      resource?.invoice_id ||
      resource?.purchase_units?.[0]?.reference_id ||
      resource?.purchase_units?.[0]?.custom_id;
    if (candidate) {
      const inv = await this.prisma.client.invoice.findUnique({
        where: { id: candidate },
        select: { id: true, businessId: true },
      }).catch(() => null);
      if (inv) return { invoiceId: inv.id, businessId: inv.businessId };
    }
    const orderId: string | undefined = resource?.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      const existing = await this.prisma.client.payment.findFirst({
        where: { provider: 'paypal', OR: [{ providerPaymentId: orderId }, { reference: orderId }] },
        select: { invoiceId: true, businessId: true },
      });
      if (existing) return { invoiceId: existing.invoiceId, businessId: existing.businessId };
    }
    return null;
  }

  private async processPaypalCaptureCompleted(resource: any, eventId?: string): Promise<void> {
    const captureId: string | undefined = resource?.id;
    if (!captureId) {
      this.logger.warn('PayPal capture completed event missing capture id');
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: captureId },
    }).catch(() => null);
    if (existing) return;

    const link = await this.resolvePaypalInvoiceId(resource);
    if (!link) {
      const orderId: string | undefined =
        resource?.custom_id ||
        resource?.invoice_id ||
        resource?.purchase_units?.[0]?.custom_id ||
        resource?.purchase_units?.[0]?.reference_id;
      if (orderId) {
        const completed = await this.maybeCompleteStorefrontOrder(orderId, captureId, 'paypal', {
          amount: resource?.amount?.value,
          currency: resource?.amount?.currency_code,
        });
        if (completed) return;
      }
      this.logger.warn(`PayPal capture ${captureId} could not be linked to a local invoice or storefront order; skipping persist`);
      return;
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: link.invoiceId },
    });
    if (!invoice) {
      const completed = await this.maybeCompleteStorefrontOrder(link.invoiceId, captureId, 'paypal', {
        amount: resource?.amount?.value,
        currency: resource?.amount?.currency_code,
      });
      if (completed) return;
      return;
    }

    const amount = Number(resource?.amount?.value ?? invoice.total);
    const currency = (resource?.amount?.currency_code || invoice.currency || 'USD').toUpperCase();

    const created = await this.createPaymentWithPosting({
      provider: 'paypal',
      providerPaymentId: captureId,
      amount,
      currency,
      status: 'SUCCESSFUL',
      invoiceId: invoice.id,
      businessId: invoice.businessId,
      reference: resource?.supplementary_data?.related_ids?.order_id ?? null,
    });
    if (!created) {
      // VN-08 (D-76 pattern): the invoice is VOID under its lock; the delivery is acked, its event kept refused.
      await this.refuseVoidInvoicePayment({
        provider: 'paypal',
        providerPaymentId: captureId,
        // SEC-VN08-1: event.id is this delivery's claim when PayPal sent one; with none, nothing was claimed.
        claimedEventId: eventId,
        invoiceId: invoice.id,
        businessId: invoice.businessId,
        amount,
        currency,
      });
      return;
    }

    await this.invoiceWorkflow.reconcileFromPayments(invoice.id).catch((e) => {
      this.logger.warn(`PayPal reconcile failed for invoice ${invoice.id}: ${e instanceof Error ? e.message : e}`);
    });

    const payer = resource?.payer as { email_address?: string; name?: { given_name?: string; surname?: string } } | undefined;
    this.paypalConnector?.emitPaymentReceived(invoice.businessId, {
      amount,
      currency,
      invoiceId: invoice.id,
      payerEmail: payer?.email_address,
      payerName: payer?.name ? `${payer.name.given_name ?? ''} ${payer.name.surname ?? ''}`.trim() : undefined,
      externalId: captureId,
    }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
  }

  /** `eventId`: the webhook_events id this delivery claimed (absent when PayPal sent none). */
  private async processPaypalRefund(resource: any, eventId?: string): Promise<void> {
    const refundId: string | undefined = resource?.id;
    if (!refundId) {
      this.logger.warn('PayPal refund event missing refund id');
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: refundId },
    }).catch(() => null);
    if (existing) return;

    // The original capture id is in supplementary_data.related_ids.capture_id
    const captureId: string | undefined =
      resource?.supplementary_data?.related_ids?.capture_id ||
      resource?.links?.find?.((l: any) => l.rel === 'up')?.href?.split('/').pop();

    // The capture's payment, when the refund names one we recorded.
    const captured: RefundOriginal | null = captureId
      ? await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: captureId },
        select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
      }).catch(() => null)
      : null;
    let invoice: { invoiceId: string; businessId: string; currency: string } | null = captured;
    if (!invoice) {
      const link = await this.resolvePaypalInvoiceId(resource);
      if (link) {
        const inv = await this.prisma.client.invoice.findUnique({
          where: { id: link.invoiceId },
          select: { id: true, businessId: true, currency: true },
        });
        if (inv) invoice = { invoiceId: inv.id, businessId: inv.businessId, currency: inv.currency };
      }
    }
    if (!invoice) {
      this.logger.warn(`PayPal refund ${refundId} could not be linked to a local payment; skipping`);
      return;
    }
    const target = invoice;

    // PayPal sends one event per refund with its own id (no cumulative event):
    // the whole amount is recorded once, deduped on the id in the door.
    const amount = Math.abs(Number(resource?.amount?.value ?? 0));
    const refund: ProviderRefund = {
      provider: 'paypal',
      providerPaymentId: refundId,
      currency: (resource?.amount?.currency_code || target.currency || 'USD').toUpperCase(),
      notes: resource?.note_to_payer ?? null,
    };
    const persisted = await (captured
      ? this.createRefundWithPosting(captured, refund, async () => amount)
      : this.createRefundWithPostingByInvoice(target, refund, amount)
    ).catch(this.refundAlreadyRecorded('PayPal', refundId));
    if (persisted === VOID_INVOICE_NOTHING_TO_REFUND) {
      // W3-VOID-PROVIDER-RACE review CR-VPR-1 (D-76 pattern): the refund of a capture VN-08 refused; kept refused as that capture was.
      this.logger.warn(
        `PayPal refund ${refundId} for invoice ${target.invoiceId} not recorded: the invoice is VOID and holds no payment it returns (its capture was refused, VN-08)`,
      );
      await this.keepInvoiceVoidRefusal({
        provider: 'paypal',
        claimedEventId: eventId,
        key: refundId,
        businessId: target.businessId,
        label: 'PayPal',
      });
      return;
    }
    if (persisted) {
      await this.invoiceWorkflow.reconcileFromPayments(target.invoiceId).catch((e) => {
        this.logger.warn(`PayPal refund reconcile failed for invoice ${target.invoiceId}: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  /**
   * KF-REVENUE-AUTH-PROJECTION-001 (G5): the public pay page's post-payment
   * poll. This returned every Payment row (reference, notes, evidence URL,
   * who recorded it) to anyone holding an invoice id. It now returns exactly
   * `{ status, paid, remaining, currency, lastPaymentAt }`, computed from the
   * canonical balance — PENDING and FAILED rows contribute nothing and no
   * row-shaped data leaves the server.
   *
   * Review (ST-3): the same shareable gate as the public invoice view. A
   * DRAFT or VOID id answered 200 with its status and full total while an
   * unknown id answered 404 — the distinction and the amount were both new
   * disclosures (main answered `[]` for either). Non-shareable now answers
   * exactly like unknown.
   *
   * V1-46b (ST-1): and so does an invoice whose links are all revoked or
   * expired (assertBareIdInvoiceOpen). The pay page polls the token route
   * (getInvoicePaymentStatusByToken), which serves the same five keys.
   */
  async getInvoicePaymentStatus(invoiceId: string): Promise<{
    status: string;
    paid: number;
    remaining: number;
    currency: string;
    lastPaymentAt: Date | null;
  }> {
    await this.assertBareIdInvoiceOpen(invoiceId);
    return this.invoicePaymentStatus(invoiceId);
  }

  private async invoicePaymentStatus(invoiceId: string): Promise<{
    status: string;
    paid: number;
    remaining: number;
    currency: string;
    lastPaymentAt: Date | null;
  }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        businessId: true,
        status: true,
        total: true,
        currency: true,
        payments: { select: { amount: true, status: true, createdAt: true, businessId: true } },
      },
    });
    if (!invoice || !isShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Invoice not found');
    // DEP-R3-OWN-ROW-READS (D-75): the invoice's own-tenant rows (M31), as the
    // pay page's intent decides from them: a row of another business told the
    // customer nothing was due (RC2-DEP-1) and dated a payment the business
    // never received.
    const own = ownTenantPayments(invoice);
    // FOLLOW3-A4-PUBLIC-PAID-NET (CR-29b-1): the stored rows as every balance
    // reader reads them (balanceOfStoredRows: a pre-V1-29 flipped REFUNDED row
    // is its payment plus its refund, not a refund subtracted twice), and
    // `paid` is the net received, max(0, net), the figure the public receipt
    // and the token view state. It was computeBalance's gross: 60 + 40 paid
    // with the 40 refunded polled "paid 100" beside a receipt of 60.
    const balance = balanceOfStoredRows(Number(invoice.total), own, invoice.currency);
    let lastPaymentAt: Date | null = null;
    for (const p of own) {
      if (p.status !== 'SUCCESSFUL') continue;
      if (!lastPaymentAt || p.createdAt > lastPaymentAt) lastPaymentAt = p.createdAt;
    }
    return {
      status: invoice.status,
      paid: Math.max(0, balance.net),
      remaining: balance.remaining,
      currency: invoice.currency,
      lastPaymentAt,
    };
  }

  async createWipayCheckout(invoiceId: string, returnUrl: string): Promise<{ redirectUrl: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        business: { select: { id: true, metaData: true } },
      },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);
    PaymentsService.assertWipayCurrency(invoice.currency, 'invoice');
    PaymentsService.assertWipayReturnUrl(returnUrl);

    const { apiUrl, environment, developerId, accountNumber } = PaymentsService.wipayCheckoutTarget(invoice.business.metaData);

    const contactName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : 'Customer';
    const contactEmail = invoice.contact?.email || 'customer@example.com';
    const contactPhone = invoice.contact?.phone || '0000000000';

    const params = new URLSearchParams();
    params.append('total', invoice.total.toFixed(2));
    params.append('phone', contactPhone);
    params.append('email', contactEmail);
    params.append('name', contactName);
    params.append('order_id', invoiceId);
    params.append('return_url', returnUrl);
    params.append('developer_id', developerId);
    params.append('environment', environment);
    if (accountNumber) {
      params.append('account_number', accountNumber);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    });

    const locationHeader = response.headers.get('location');
    if (locationHeader) {
      return { redirectUrl: locationHeader };
    }

    const body = await response.text();

    const urlMatch = body.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch) {
      return { redirectUrl: urlMatch[0] };
    }

    if (response.ok) {
      // The request's own parameters (TG-16b). Review V05-SEC-1: they carry no secret any more (wipayCheckoutTarget).
      return { redirectUrl: `${apiUrl}?${params.toString()}` };
    }

    this.logger.error(`WiPay checkout creation failed: ${response.status} - ${body}`);
    throw new Error('Failed to create WiPay checkout');
  }

  /**
   * V1-05-PUB-PROVIDER-CALLBACKS (M35; owner ruling D-19) — WiPay's response
   * hash as WiPay's Transaction Response documentation defines it
   * (docs.wipayfinancial.com/payments-api/transaction-response; WiPay API
   * Documentation, wipaycaribbean.com/WiPay-API-Documentation.pdf): the MD5 of
   * transaction_id, the ORIGINAL total this server sent in the payment request
   * (two decimals; not the customer-facing total of the response) and the
   * merchant's API key, concatenated in that order with no separator.
   */
  private static wipayResponseHash(transactionId: string, originalTotal: number, apiKey: string): string {
    return createHash('md5').update(`${transactionId}${originalTotal.toFixed(2)}${apiKey}`).digest('hex');
  }

  /**
   * The WiPay API key a callback is verified with: the key of the WiPay
   * account the business's checkout pays into. That is the business's own
   * (metaData.wipayApiKey); else, for a business that checks out into the
   * platform's account (no WiPay setting of its own), the platform's
   * (WIPAY_API_KEY). Review V05-SEC-3: a business with its own WiPay account
   * but no key of its own gets null, so the platform key never settles a
   * payable of a tenant whose money goes to another account. Nothing
   * configured is null: the callback is refused, never checked against a
   * default (WiPay's sandbox key is public).
   */
  private static wipayApiKey(metaData: unknown): string | null {
    // Trial-N repair round 2 (G6RC-1): the key of the one merchant the business resolves to, its own or the
    // platform's (resolveWipayMerchant); the gateway list, the checkouts and the connector read the same pair.
    return resolveWipayMerchant(metaData).apiKey;
  }

  /** D-69: the one currency a WiPay checkout is made in (wipay-merchant.ts holds the rule the storefront order door reads too). */
  private static readonly WIPAY_CURRENCY = WIPAY_CURRENCY;

  private static wipayTakesCurrency(currency: string | null | undefined): boolean {
    return wipayTakesCurrency(currency);
  }

  /**
   * D-69 (trial-N recheck G6ML-2): a WiPay checkout, invoice or storefront,
   * for an amount not in TTD is refused (400) before WiPay is called. The
   * checkouts send WiPay no currency, so a USD invoice or order was settled in
   * WiPay's default currency and booked as USD. Lifted only once WiPay's
   * currency parameter is verified from its documentation (D-19).
   */
  private static assertWipayCurrency(currency: string | null | undefined, payable: 'invoice' | 'order'): void {
    if (PaymentsService.wipayTakesCurrency(currency)) return;
    throw new BadRequestException(
      `WiPay takes ${PaymentsService.WIPAY_CURRENCY} only: this ${payable} is in ${normalizeCurrency(currency) || 'no currency'}`,
    );
  }

  /**
   * Review V05-SEC-1: where a WiPay checkout goes and which merchant it names.
   * The API key is the secret behind the callback proof (wipayResponseHash),
   * so it never leaves this server: it used to be sent as developer_id, and so
   * reached the anonymous payer in the request echo (createWipayCheckout,
   * createStorePayment). developer_id is the merchant's WiPay account number;
   * a checkout with no account number configured is refused (400) before
   * WiPay is called.
   *
   * Trial-N review (NEW-1, D-19 fails closed): a checkout whose callback no key
   * can verify (wipayApiKey is null) is refused (400) before WiPay is called.
   * A business with its own WiPay account and only the platform's key started
   * a live checkout into its own account whose callback was always refused, so
   * the payer was charged and nothing was recorded. The keyless sandbox
   * checkout is gone with it: no key verifies a sandbox callback either (the
   * public sandbox key is never a default), so it could settle nothing.
   */
  private static wipayCheckoutTarget(metaData: unknown): {
    apiUrl: string;
    environment: 'live';
    developerId: string;
    accountNumber?: string;
  } {
    // Trial-N repair round 2 (G6RC-1): the key and the account are one merchant's, the business's own pair or the
    // platform's (resolveWipayMerchant). A business with its own key and no account of its own is refused here; it
    // was sent to the platform's account, whose callback its own key then refused.
    const { apiKey, accountNumber } = resolveWipayMerchant(metaData);
    if (!apiKey) {
      throw new BadRequestException('WiPay is not configured for this business: no WiPay API key to verify its payments');
    }
    if (!accountNumber) {
      throw new BadRequestException('WiPay is not configured for this business: no WiPay account number');
    }
    return { apiUrl: 'https://tt.wipayfinancial.com/v1/gateway_live', environment: 'live', developerId: accountNumber, accountNumber };
  }

  /**
   * Review V05-SEC-3: WiPay hands its response, proof included, to the
   * checkout's return_url, so the invoice checkout's return URL must be on
   * one of the platform's public origins (PUBLIC_URL_ALLOWLIST, else
   * NEXT_PUBLIC_BASE_URL), as the Stripe checkout's success and cancel URLs
   * are; none configured refuses the checkout.
   */
  private static assertWipayReturnUrl(returnUrl: string): void {
    const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.startsWith('http') ? s : `https://${s}`));
    if (allowed.length === 0) {
      throw new BadRequestException('Server misconfigured: no allowed return-URL origins set');
    }
    let parsed: URL;
    try {
      parsed = new URL(returnUrl);
    } catch {
      throw new BadRequestException('Invalid return URL');
    }
    const onAllowedOrigin =
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      allowed.some((a) => {
        try { return new URL(a).origin === parsed.origin; } catch { return false; }
      });
    if (!onAllowedOrigin) throw new BadRequestException('Invalid return URL');
  }

  /** Whether `hash` is WiPay's keyed response hash for this transaction (constant-time compare). */
  private static wipayProofVerifies(
    apiKey: string | null,
    transactionId: string | undefined,
    originalTotal: number,
    hash: unknown,
  ): boolean {
    if (!apiKey || !transactionId || typeof hash !== 'string' || !Number.isFinite(originalTotal)) return false;
    const expected = Buffer.from(PaymentsService.wipayResponseHash(transactionId, originalTotal, apiKey), 'utf8');
    const given = Buffer.from(hash.trim().toLowerCase(), 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * The WiPay callback (the payer's browser brings WiPay's response back to
   * the pay page, which forwards its query here).
   *
   * V1-05-PUB-PROVIDER-CALLBACKS (M35; D-19: any callback that does not
   * verify is refused): a success callback must carry WiPay's keyed response
   * hash (wipayResponseHash) over its transaction_id, the total this server
   * requested for the invoice or storefront order and the key of the WiPay
   * account the business checks out into (wipayApiKey). One that does not
   * verify, or that arrives with no key to verify it, is refused with 400
   * before anything is written: no Payment row, no WebhookEvent claim, no
   * storefront status. The hash used to be md5(transaction_id + order_id +
   * total + status), every input public, so anyone holding an invoice id
   * settled it for the total they chose. A verified success records the
   * requested total (the amount the hash binds), never the callback's `total`,
   * through createPaymentWithPosting, deduplicated on the transaction id.
   *
   * Review V05-SEC-2, CR-V05-2, CR-V05-3: the hash does not cover `status`,
   * and WiPay documents it for successful transactions only (its decline
   * carries none), so it is proof of a success and of nothing else. A
   * callback whose status is not a success, hashed or not, is answered
   * { success: false, 'Payment was not successful' } and acted on in no way:
   * no FAILED row, no claim on its transaction id (which would turn the
   * genuine success of that transaction into 'Duplicate callback ignored'),
   * no storefront FAILED status and no payment-failed event or email. It
   * used to write a FAILED row and claim the transaction id of the caller's
   * choosing; since the packet it was a 400 the pay page showed the payer
   * as 'Invalid WiPay callback signature'.
   */
  async handleWipayCallback(queryParams: WipayCallbackParams): Promise<{ success: boolean; invoiceId?: string; message: string }> {
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
    const transaction_id = str(queryParams.transaction_id);
    const order_id = str(queryParams.order_id);
    const status = str(queryParams.status);
    const { hash } = queryParams;

    if (!order_id || !status) {
      return { success: false, message: 'Missing required callback parameters' };
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: order_id },
      include: { business: { select: { metaData: true } } },
    });

    let order: { id: string; businessId: string; currency: string; total: number; paymentStatus: string; business: { metaData: Prisma.JsonValue } } | null = null;
    if (!invoice) {
      order = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: order_id },
        select: { id: true, businessId: true, currency: true, total: true, paymentStatus: true, business: { select: { metaData: true } } },
      });
      if (!order) {
        return { success: false, message: 'Invoice not found' };
      }
    }

    // Review V05-SEC-2 / CR-V05-2 / CR-V05-3: a failure is answered, never acted on (see above).
    const isSuccessful = status === 'success' || status === '1';
    if (!isSuccessful) {
      return { success: false, invoiceId: order_id, message: 'Payment was not successful' };
    }

    const businessId = invoice?.businessId ?? order!.businessId;
    // The total this server sent WiPay for this payable (createWipayCheckout, createStorePayment).
    const requestedTotal = invoice ? Number(invoice.total) : Number(order!.total);
    const apiKey = PaymentsService.wipayApiKey(invoice ? invoice.business.metaData : order!.business.metaData);
    if (!PaymentsService.wipayProofVerifies(apiKey, transaction_id, requestedTotal, hash)) {
      this.logger.error(
        `WiPay callback for ${order_id} refused: ${apiKey ? 'its hash is not WiPay\'s keyed response hash' : 'no WiPay API key is configured to verify it'}`,
      );
      throw new BadRequestException('Invalid WiPay callback signature');
    }

    // D-76 (recheck G6PUB-RC1-4): WiPay takes TTD only (D-69). A verified
    // success for a payable in another currency (a checkout started before
    // D-69) was settled by WiPay in its default currency, so it is not recorded
    // as money in the payable's.
    const payableCurrency = invoice ? invoice.currency : order!.currency;
    if (!PaymentsService.wipayTakesCurrency(payableCurrency)) {
      return this.refuseWipayCurrency({
        transactionId: transaction_id!,
        payableType: invoice ? 'invoice' : 'order',
        payableId: order_id,
        businessId,
        currency: payableCurrency,
        total: requestedTotal,
      });
    }

    // W3-VOID-PROVIDER-RACE (VN-08, the D-76 pattern): a verified success for a
    // VOID invoice is not recorded as money on it. Refused before the claim (as
    // D-76's currency refusal), so a repeat callback is refused the same way
    // rather than answered 'Duplicate callback ignored'; a transaction already
    // recorded before the void is left to the duplicate answer below.
    // Review SEC-VN08-1: nothing is claimed yet, so the refusal only inserts its row (D-76).
    if (invoice?.status === 'VOID' && !(await this.paymentRecorded(transaction_id))) {
      return this.refuseWipayForVoidInvoice(invoice, transaction_id!, requestedTotal, false);
    }

    // Provider-event-id idempotency. WiPay's transaction_id (verified above)
    // identifies a callback delivery; re-deliveries become no-ops.
    const wipayEventId = transaction_id!;
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'wipay',
      wipayEventId,
      status,
      businessId,
    );
    if (!fresh) {
      return { success: true, invoiceId: order_id, message: 'Duplicate callback ignored' };
    }

    try {
      if (order) {
        // Storefront checkout path
        if (order.paymentStatus !== 'PAID' && this.storeOrderService) {
          // Trial-N review (G6ML-3): settled by WiPay (its deposit leg is PAYMENT_PROCESSOR, not CASH).
          await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', transaction_id, 'wipay');
        }
        return { success: true, invoiceId: order_id, message: 'Payment successful' };
      }

      const existingPayment = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: wipayEventId },
        select: { status: true, invoiceId: true },
      });

      // Review V05-SEC-2: only this invoice's own SUCCESSFUL row of this
      // transaction means it is already recorded. Another row on the id (a
      // FAILED row a pre-V1-05 failure callback wrote, or another payable's
      // payment) is not this payment: nothing is recorded (the id is unique)
      // and the payer is not told it succeeded.
      if (existingPayment && (existingPayment.status !== 'SUCCESSFUL' || existingPayment.invoiceId !== order_id)) {
        this.logger.error(
          `WiPay transaction ${wipayEventId} for invoice ${order_id} not recorded: a ${existingPayment.status} payment of ` +
            `${existingPayment.invoiceId ?? 'no invoice'} already holds that provider id`,
        );
        await this.releaseProviderEvent('wipay', wipayEventId);
        return { success: false, invoiceId: order_id, message: 'Payment processing error' };
      }

      if (!existingPayment) {
        // V1-05: the requested total the verified hash binds, never the callback's `total`.
        const created = await this.createPaymentWithPosting({
          provider: 'wipay',
          providerPaymentId: wipayEventId,
          amount: requestedTotal,
          currency: invoice!.currency,
          status: 'SUCCESSFUL',
          invoiceId: order_id,
          businessId: invoice!.businessId,
        });
        // VN-08: voided while this callback waited on the invoice lock; its claim is kept, marked refused.
        if (!created) return this.refuseWipayForVoidInvoice(invoice!, wipayEventId, requestedTotal, true);

        await this.invoiceWorkflow.reconcileFromPayments(order_id).catch((e) => {
          this.logger.warn(`WiPay reconcile failed for invoice ${order_id}: ${e instanceof Error ? e.message : e}`);
        });

        this.wipayConnector?.emitPaymentReceived(invoice!.businessId, {
          amount: requestedTotal,
          currency: invoice!.currency,
          invoiceId: order_id,
          externalId: transaction_id,
        }).catch((e) => this.logger.warn(`WiPay connector event emission failed: ${e.message}`));
      }

      return { success: true, invoiceId: order_id, message: 'Payment successful' };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process WiPay payment for order ${order_id}: ${errMsg}`);
      // V1-15c: nothing was recorded, so the callback is not handled: a redelivery runs it again.
      await this.releaseProviderEvent('wipay', wipayEventId);
      return { success: false, invoiceId: order_id, message: 'Payment processing error' };
    }
  }

  /**
   * D-76 (G6PUB-R3-STORE-ORDER-DOORS, recheck G6PUB-RC1-4): a verified WiPay
   * success for a payable not in TTD records no money: no Payment row, no
   * posting, the invoice and the storefront order as they were. Its
   * transaction's webhook_events row is kept, marked refused
   * (`refused:currency:<CUR>`), so every redelivery is a no-op, and the
   * business is told once (a 'payment.refused' notification) that WiPay
   * reported money this server did not record, to settle by hand. The payer
   * is answered { success: false }.
   */
  private async refuseWipayCurrency(input: {
    transactionId: string;
    payableType: 'invoice' | 'order';
    payableId: string;
    businessId: string;
    currency: string | null | undefined;
    total: number;
  }): Promise<{ success: boolean; invoiceId?: string; message: string }> {
    const currency = normalizeCurrency(input.currency) || 'no currency';
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'wipay',
      input.transactionId,
      `refused:currency:${currency}`,
      input.businessId,
    );
    if (fresh) {
      this.logger.error(
        `WiPay transaction ${input.transactionId} for ${input.payableType} ${input.payableId} not recorded: ` +
          `WiPay takes ${PaymentsService.WIPAY_CURRENCY} only (D-69) and the ${input.payableType} is in ${currency} (D-76)`,
      );
      await this.prisma.client.notification
        .create({
          data: {
            businessId: input.businessId,
            type: 'payment.refused',
            title: 'WiPay payment not recorded',
            body:
              `WiPay reported a successful payment (transaction ${input.transactionId}) for ${input.payableType} ` +
              `${input.payableId}, which is in ${currency}. WiPay takes ${PaymentsService.WIPAY_CURRENCY} only, so it ` +
              'was not recorded. Check the payment in your WiPay account and record or refund it by hand.',
            data: {
              provider: 'wipay',
              transactionId: input.transactionId,
              payableType: input.payableType,
              payableId: input.payableId,
              currency,
              total: input.total,
              reason: 'currency',
            },
          },
        })
        .catch((e: unknown) =>
          this.logger.error(`Could not notify business ${input.businessId} of refused WiPay transaction ${input.transactionId}: ${e instanceof Error ? e.message : e}`),
        );
    }
    return {
      success: false,
      invoiceId: input.payableId,
      message: `WiPay takes ${PaymentsService.WIPAY_CURRENCY} only: this ${input.payableType} is in ${currency}, so the payment was not recorded`,
    };
  }

  /**
   * W3-VOID-PROVIDER-RACE (VN-08, the D-76 pattern): a verified WiPay success
   * for a VOID invoice records no money; its transaction is kept refused, the
   * owner is told once (refuseVoidInvoicePayment) and the payer is answered
   * { success: false }. `claimed`: this callback's own claim on the
   * transaction id is written (assertNewProviderEvent); before it, the
   * refusal only inserts its row (review SEC-VN08-1, D-76).
   */
  private async refuseWipayForVoidInvoice(
    invoice: { id: string; businessId: string; currency: string },
    transactionId: string,
    total: number,
    claimed: boolean,
  ): Promise<{ success: boolean; invoiceId?: string; message: string }> {
    await this.refuseVoidInvoicePayment({
      provider: 'wipay',
      providerPaymentId: transactionId,
      claimedEventId: claimed ? transactionId : undefined,
      invoiceId: invoice.id,
      businessId: invoice.businessId,
      amount: total,
      currency: invoice.currency,
    });
    return { success: false, invoiceId: invoice.id, message: 'This invoice is void, so the payment was not recorded' };
  }

  async getPaypalClientToken(): Promise<{ clientToken: string }> {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    if (!clientId) {
      throw new Error('PayPal is not configured');
    }
    return { clientToken: clientId };
  }

  async createPaypalOrder(invoiceId: string): Promise<{ orderId: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        business: { select: { id: true, metaData: true, name: true } },
        items: true,
      },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;

    const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
    if (!paypal) throw new Error('PayPal is not configured');

    try {
      const { result } = await paypal.ordersController.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: invoiceId,
              customId: invoiceId,
              description: `Invoice ${invoice.invoiceNumber} - ${invoice.business.name}`,
              amount: {
                // V1-05: the invoice's own currency (it was USD whatever the invoice's), which the capture checks.
                // PayPal does not offer every currency (TTD among them): it refuses such an order and the checkout
                // fails closed here; the up-front 400 is held by pay-link-token-gate TG-14/TG-14b (review V05-COR-4).
                currencyCode: normalizeCurrency(invoice.currency),
                value: invoice.total.toFixed(2),
              },
            },
          ],
        },
        prefer: 'return=representation',
      });

      if (!result.id) throw new Error('PayPal order creation returned no ID');

      return { orderId: result.id };
    } catch (error: any) {
      this.logger.error(`PayPal order creation failed: ${error.message}`, error.stack);
      throw new Error('Failed to create PayPal order', { cause: error });
    }
  }

  async createStorePayment(input: {
    orderId: string;
    amount: number;
    currency: string;
    method: string;
    businessId: string;
    returnUrl?: string;
  }): Promise<{ paymentId?: string; redirectUrl?: string; status: string }> {
    if (input.method === 'CASH' || input.method === 'MANUAL') {
      const payment = await this.prisma.client.payment.create({
        data: {
          provider: 'manual',
          providerPaymentId: `manual_${input.orderId}_${Date.now()}`,
          amount: input.amount,
          currency: input.currency,
          status: 'PENDING',
          method: input.method.toLowerCase(),
          invoiceId: input.orderId,
          businessId: input.businessId,
        },
      });
      return { paymentId: payment.id, status: 'PENDING_PAYMENT' };
    }

    if (input.method === 'WIPAY') {
      // D-69 (G6ML-2): a TTD order only; the request names no currency, so another one was settled in WiPay's default.
      PaymentsService.assertWipayCurrency(input.currency, 'order');
      // Trial-N review (G6PUB-SEC-5, V05-SEC-3): WiPay hands its keyed proof to
      // the return URL, so the storefront checkout's must be on a platform
      // origin too, as the invoice checkout's is (a missing one is refused).
      const returnUrl = input.returnUrl ?? '';
      PaymentsService.assertWipayReturnUrl(returnUrl);
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true },
      });
      // Review V05-SEC-1: developer_id is the account number, never the API key (wipayCheckoutTarget).
      const { apiUrl, environment, developerId, accountNumber } = PaymentsService.wipayCheckoutTarget(business?.metaData);

      const params = new URLSearchParams();
      params.append('total', input.amount.toFixed(2));
      params.append('phone', '0000000000');
      params.append('email', 'customer@store.com');
      params.append('name', 'Store Customer');
      params.append('order_id', input.orderId);
      params.append('return_url', returnUrl);
      params.append('developer_id', developerId);
      params.append('environment', environment);
      if (accountNumber) params.append('account_number', accountNumber);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        redirect: 'manual',
      });

      const locationHeader = response.headers.get('location');
      if (locationHeader) {
        return { status: 'REDIRECT', redirectUrl: locationHeader };
      }

      const body = await response.text();
      const urlMatch = body.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) {
        return { status: 'REDIRECT', redirectUrl: urlMatch[0] };
      }

      if (response.ok) {
        return { status: 'REDIRECT', redirectUrl: `${apiUrl}?${params.toString()}` };
      }

      this.logger.error(`WiPay store checkout failed: ${response.status} - ${body}`);
      throw new Error('Failed to create WiPay checkout');
    }

    if (input.method === 'STRIPE') {
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { id: true, name: true, metaData: true },
      });
      if (!business) throw new BadRequestException('Business not found');

      const meta = (business.metaData as Record<string, any>) || {};
      const secretKey = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
      if (!secretKey) throw new BadRequestException('Stripe is not configured for this business');

      const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || '')
        .split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.startsWith('http') ? s : `https://${s}`);
      if (allowed.length === 0) {
        this.logger.error('No PUBLIC_URL_ALLOWLIST configured; rejecting Stripe store checkout for safety');
        throw new BadRequestException('Server misconfigured: no allowed return-URL origins set');
      }
      const isAllowedUrl = (u: string): boolean => {
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
          return allowed.some((a) => {
            try { return new URL(a).origin === parsed.origin; } catch { return false; }
          });
        } catch { return false; }
      };
      if (input.returnUrl && !isAllowedUrl(input.returnUrl)) {
        throw new BadRequestException('Invalid return URL');
      }

      const currency = (input.currency || 'USD').toLowerCase();
      const amountCents = Math.round(input.amount * 100);

      const body = new URLSearchParams();
      body.append('mode', 'payment');
      body.append('client_reference_id', input.orderId);
      body.append('metadata[orderId]', input.orderId);
      body.append('metadata[businessId]', business.id);
      body.append('line_items[0][quantity]', '1');
      body.append('line_items[0][price_data][currency]', currency);
      body.append('line_items[0][price_data][unit_amount]', String(amountCents));
      body.append('line_items[0][price_data][product_data][name]', `Store Order — ${business.name || ''}`.trim());
      if (input.returnUrl) {
        body.append('success_url', input.returnUrl);
        body.append('cancel_url', input.returnUrl);
      }

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const json = await res.json().catch(() => ({ error: { message: 'Invalid Stripe response' } }));
      if (!res.ok) {
        this.logger.error(`Stripe store checkout failed: ${json.error?.message || res.statusText}`);
        throw new BadRequestException(json.error?.message || 'Stripe checkout creation failed');
      }
      if (!json.url) {
        this.logger.error('Stripe store checkout returned no redirect URL');
        throw new BadRequestException('Stripe checkout creation failed: no redirect URL');
      }

      // Trial-N review (G6ML-4): no PENDING payment row. It named the order as
      // the payment's invoice (payments.invoice_id references invoices), so it
      // failed with P2003 after the session was created and every storefront
      // Stripe checkout answered 500 (and, under V1-33, each retry made another
      // session). The session's own webhook settles the order through
      // completeCheckout, which writes the payment; nothing read this row.
      return { paymentId: json.id, status: 'REDIRECT', redirectUrl: json.url };
    }

    if (input.method === 'PAYPAL') {
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true, name: true },
      });
      const meta = (business?.metaData as Record<string, any>) || {};
      const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
      const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;
      const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
      if (!paypal) throw new Error('PayPal is not configured');

      const { result } = await paypal.ordersController.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: input.orderId,
              customId: input.orderId,
              description: `Store Order - ${business?.name ?? 'Store'}`,
              amount: {
                // Trial-N review (G6PUB-SEC-4): the order's own currency (it was USD whatever the order's), as
                // createPaypalOrder does for an invoice; the capture webhook settles the order only for its total
                // in that currency (maybeCompleteStorefrontOrder). PayPal refuses a currency it does not offer
                // (TTD among them), so such a checkout fails closed here (PC-08b).
                currencyCode: normalizeCurrency(input.currency),
                value: input.amount.toFixed(2),
              },
            },
          ],
        },
        prefer: 'return=representation',
      });

      if (!result.id) throw new Error('PayPal order creation returned no ID');

      const links = result.links as Array<{ href: string; rel: string; method?: string }> | undefined;
      const approveLink = links?.find(
        (l) => l.rel === 'approve' || l.rel === 'payer-action',
      );
      if (approveLink?.href) {
        return { paymentId: result.id, status: 'REDIRECT', redirectUrl: approveLink.href };
      }

      return { paymentId: result.id, status: 'PAYPAL_AWAITING_APPROVAL' };
    }

    throw new BadRequestException(`Unsupported payment method: ${input.method}`);
  }

  async capturePaypalOrder(orderId: string, invoiceId: string): Promise<any> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { business: { select: { id: true, metaData: true } } },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;

    const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
    if (!paypal) throw new Error('PayPal is not configured');

    // V1-46b review (SEC-V46B-3): before anything is captured or written.
    await this.assertPaypalOrderForInvoice(paypal.ordersController, orderId, invoice);

    // Review (SEC-V15C-2, CR-V15C-1): this try covers PayPal's capture call
    // alone. Only a capture that did not happen is recorded FAILED and
    // announced as failed; recording a capture PayPal completed is below.
    let result: Awaited<ReturnType<OrdersController['captureOrder']>>['result'];
    try {
      ({ result } = await paypal.ordersController.captureOrder({
        id: orderId,
        prefer: 'return=representation',
      }));
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`PayPal capture failed for order ${orderId}: ${errMsg}`);

      try {
        await this.prisma.client.payment.create({
          data: {
            provider: 'paypal',
            providerPaymentId: `paypal_fail_${orderId}_${Date.now()}`,
            amount: invoice.total,
            currency: invoice.currency,
            status: 'FAILED',
            invoiceId,
            businessId: invoice.businessId,
          },
        });

        this.paypalConnector?.emitPaymentFailed(invoice.businessId, {
          amount: Number(invoice.total),
          currency: invoice.currency,
          error: errMsg,
          invoiceId,
          externalId: orderId,
        }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
      } catch (recordError: unknown) {
        const recErrMsg = recordError instanceof Error ? recordError.message : 'Unknown error';
        this.logger.error(`Failed to record failed PayPal payment: ${recErrMsg}`);
      }

      throw new Error('Failed to capture PayPal order', { cause: error });
    }

    if (result.status === 'COMPLETED') {
      const captureId = result.purchaseUnits?.[0]?.payments?.captures?.[0]?.id || orderId;

      // PayPal has taken the money: from here nothing is recorded FAILED,
      // nothing is announced as failed and the payer is not told to pay again.
      // V1-15c: the captured payment and its posting commit together (the
      // door every provider settlement uses); payment.create left it unposted.
      // Review (SEC-V15C-2, CR-V15C-1): that transaction can abort. An abort
      // that PayPal's own PAYMENT.CAPTURE.COMPLETED delivery caused by
      // recording this capture first (P2002) leaves it recorded; a transient
      // abort (P2028 behind a lock, P2034 a deadlock) is retried; when the
      // retries are spent the capture is left to that delivery, whose claim a
      // failure releases, so PayPal's redelivery records it (V1-15c).
      // W3-VOID-PROVIDER-RACE (VN-08): 'refused' when the invoice was voided while PayPal captured.
      let recorded: 'here' | 'elsewhere' | 'refused' | 'not' = 'not';
      for (let attempt = 1; recorded === 'not'; attempt += 1) {
        try {
          const created = await this.createPaymentWithPosting({
            provider: 'paypal',
            providerPaymentId: captureId,
            amount: invoice.total,
            currency: invoice.currency,
            status: 'SUCCESSFUL',
            invoiceId,
            businessId: invoice.businessId,
          });
          recorded = created ? 'here' : 'refused';
        } catch (e: unknown) {
          if (await this.paymentRecorded(captureId).catch(() => false)) {
            recorded = 'elsewhere';
            break;
          }
          const code = (e as { code?: string } | null)?.code;
          if (attempt < PAYPAL_CAPTURE_RECORD_ATTEMPTS && code && TRANSIENT_TX_ABORTS.has(code)) continue;
          this.logger.error(
            `PayPal captured order ${orderId} (capture ${captureId}, invoice ${invoiceId}) but it could not be recorded after ` +
              `${attempt} attempt(s): ${e instanceof Error ? e.message : e}. PayPal's PAYMENT.CAPTURE.COMPLETED delivery records it.`,
          );
          break;
        }
      }

      if (recorded === 'refused') {
        // VN-08 (D-76 pattern): PayPal took the money but the invoice is VOID; nothing is recorded on it.
        await this.refuseVoidInvoicePayment({
          provider: 'paypal',
          providerPaymentId: captureId,
          invoiceId,
          businessId: invoice.businessId,
          amount: Number(invoice.total),
          currency: invoice.currency,
        });
        throw new ConflictException(
          'This invoice was voided while PayPal took the payment, so it was not recorded; the business has been told to refund it or record it by hand',
        );
      }

      if (recorded !== 'not') {
        await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch((e) => {
          this.logger.warn(`PayPal capture reconcile failed for invoice ${invoiceId}: ${e instanceof Error ? e.message : e}`);
        });
      }

      // Announced once, by whichever writer recorded it (the webhook announces its own).
      if (recorded === 'here') {
        const payer = result.payer as { emailAddress?: string; name?: { givenName?: string; surname?: string } } | undefined;
        this.paypalConnector?.emitPaymentReceived(invoice.businessId, {
          amount: Number(invoice.total),
          currency: invoice.currency,
          invoiceId,
          payerEmail: payer?.emailAddress,
          payerName: payer?.name ? `${payer.name.givenName ?? ''} ${payer.name.surname ?? ''}`.trim() : undefined,
          externalId: captureId,
        }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
      }
    }

    return {
      id: result.id,
      status: result.status,
      payer: result.payer,
    };
  }

  /**
   * V1-46b review (SEC-V46B-3): the order a capture names must be the one
   * createPaypalOrder made for this invoice: exactly one purchase unit, its
   * custom_id this invoice's id and its amount this invoice's total. The
   * PayPal credentials may be shared by every tenant (the env pair), so an
   * order id alone could name another invoice's, a storefront order's or
   * another tenant's order, and the capture recorded it as a SUCCESSFUL
   * payment of this invoice's whole total. An order that does not match, or
   * cannot be read, is refused (400) before it is captured; nothing is written
   * and no FAILED row is left behind.
   *
   * V1-05-PUB-PROVIDER-CALLBACKS (M35): and its currency this invoice's
   * currency. The capture records the invoice's amount in the invoice's
   * currency, so an order in another currency (every order was USD, a TTD
   * invoice's included) recorded X TTD for X USD taken; an order whose
   * currency cannot be read is refused too.
   */
  private async assertPaypalOrderForInvoice(
    ordersController: OrdersController,
    orderId: string,
    invoice: { id: string; total: number; currency: string },
  ): Promise<void> {
    const refusal = 'This PayPal order does not belong to this invoice';
    let units: Array<{ customId?: string; amount?: { value?: string; currencyCode?: string } }> | undefined;
    try {
      const { result } = await ordersController.getOrder({ id: orderId });
      units = result.purchaseUnits;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`PayPal order ${orderId} could not be read for invoice ${invoice.id}: ${errMsg}`);
      throw new BadRequestException(refusal);
    }
    const unit = units?.length === 1 ? units[0] : undefined;
    const value = Number(unit?.amount?.value);
    const currency = normalizeCurrency(unit?.amount?.currencyCode);
    if (
      !unit ||
      unit.customId !== invoice.id ||
      !Number.isFinite(value) ||
      value.toFixed(2) !== Number(invoice.total).toFixed(2) ||
      !currency ||
      currency !== normalizeCurrency(invoice.currency)
    ) {
      this.logger.warn(`PayPal order ${orderId} is not an order for invoice ${invoice.id}; capture refused`);
      throw new BadRequestException(refusal);
    }
  }

  private async createInvoiceCheckout(
    invoiceId: string,
    gateway: 'stripe' | 'paypal' | 'wipay',
    returnUrl?: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ type: 'redirect'; redirectUrl: string } | { type: 'paypal_order'; orderId: string }> {
    if (gateway === 'stripe') {
      if (!successUrl || !cancelUrl) {
        throw new BadRequestException('Stripe checkout requires successUrl and cancelUrl');
      }
      const { redirectUrl } = await this.createStripeCheckout(invoiceId, successUrl, cancelUrl);
      return { type: 'redirect', redirectUrl };
    }
    if (gateway === 'wipay') {
      if (!returnUrl) {
        throw new BadRequestException('WiPay checkout requires returnUrl');
      }
      const { redirectUrl } = await this.createWipayCheckout(invoiceId, returnUrl);
      return { type: 'redirect', redirectUrl };
    }
    if (gateway === 'paypal') {
      const { orderId } = await this.createPaypalOrder(invoiceId);
      return { type: 'paypal_order', orderId };
    }
    throw new BadRequestException(`Unsupported gateway: ${gateway}`);
  }

  private async resolveMassCommInvoiceId(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, campaignId: true },
    });
    if (!invoice) throw new BadRequestException('Mass-communication invoice not found');
    if (!invoice.campaignId) {
      throw new BadRequestException('Invoice is not linked to a mass-communication campaign');
    }
    this.assertInvoicePayable(invoice.status, invoiceId);
    return invoiceId;
  }

  /**
   * Unified checkout entry-point for any supported payable.
   * Supports invoices, storefront orders, event tickets (via their linked
   * invoice), and mass-communication campaign invoices.
   */
  async createGenericCheckout(input: {
    payableType: 'invoice' | 'storefront_order' | 'event_ticket' | 'mass_comm';
    payableId: string;
    gateway: 'stripe' | 'paypal' | 'wipay';
    returnUrl?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<{ type: 'redirect'; redirectUrl: string } | { type: 'paypal_order'; orderId: string }> {
    if (input.payableType === 'invoice' || input.payableType === 'mass_comm') {
      const invoiceId =
        input.payableType === 'mass_comm'
          ? await this.resolveMassCommInvoiceId(input.payableId)
          : input.payableId;
      // V1-46b (ST-1): an anonymous bare-id invoice checkout closes with the invoice's links.
      await this.assertBareIdInvoiceOpen(invoiceId);
      return this.createInvoiceCheckout(
        invoiceId,
        input.gateway,
        input.returnUrl,
        input.successUrl,
        input.cancelUrl,
      );
    }

    if (input.payableType === 'storefront_order') {
      const order = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: input.payableId },
        select: { id: true, businessId: true, total: true, currency: true, paymentStatus: true, status: true },
      });
      if (!order) throw new BadRequestException('Storefront order not found');
      // Trial-N review (G6PUB-SEC-2): closed in either status vocabulary (the marketplace route writes 'cancelled').
      if (order.paymentStatus === 'PAID' || isClosedStorefrontOrder(order)) {
        throw new BadRequestException('Storefront order is already paid or cancelled');
      }
      const result = await this.createStorePayment({
        orderId: order.id,
        amount: order.total,
        currency: order.currency,
        method: input.gateway.toUpperCase(),
        businessId: order.businessId,
        returnUrl: input.returnUrl || input.successUrl,
      });
      if (result.redirectUrl) {
        return { type: 'redirect', redirectUrl: result.redirectUrl };
      }
      if (input.gateway === 'paypal' && result.paymentId) {
        return { type: 'paypal_order', orderId: result.paymentId };
      }
      throw new BadRequestException('Unable to create storefront checkout');
    }

    if (input.payableType === 'event_ticket') {
      const attendee = await this.prisma.client.eventAttendee.findUnique({
        where: { id: input.payableId },
        include: { ticketType: true },
      });
      if (!attendee) throw new BadRequestException('Event attendee not found');
      if (!attendee.paymentId) {
        throw new BadRequestException('Attendee does not have a payable invoice');
      }
      await this.assertBareIdInvoiceOpen(attendee.paymentId);
      return this.createInvoiceCheckout(
        attendee.paymentId,
        input.gateway,
        input.returnUrl,
        input.successUrl,
        input.cancelUrl,
      );
    }

    throw new BadRequestException(`Unsupported payable type: ${input.payableType}`);
  }
}
