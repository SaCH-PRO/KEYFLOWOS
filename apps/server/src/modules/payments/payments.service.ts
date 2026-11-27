import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isLostTransactionConflict } from '../../core/prisma/transaction-conflict';
import { CommerceService } from '../commerce/commerce.service';
import {
  InvoiceWorkflowService,
  appliedCreditsOf,
  balanceOfStoredRows,
  creditAwareBalance,
  isCreditAwareShareableInvoiceStatus,
  ownTenantPayments,
  type CreditAwareBalance,
} from '../commerce/invoice-workflow.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { normalizeCurrency } from '../finance/posting.service';
import { fromCents, subtractMoney, toCents } from '../commerce/money';
import { WiPayConnector } from '../../core/connectors/implementations/wipay.connector';
import {
  WIPAY_CURRENCY,
  WIPAY_KEY_REQUIRED,
  platformWipayKeyForTransition,
  resolveWipayMerchant,
  wipayMerchantComplete,
  wipayTakesCurrency,
} from '../../core/connectors/implementations/wipay-merchant';
import { PayPalConnector } from '../../core/connectors/implementations/paypal.connector';
import { paypalCurrencyRefusal, paypalTakesCurrency } from './paypal-currency';
import {
  paypalConfigured,
  storePaypalCredentials,
  storeStripeCredentials,
  storefrontMethodNotOffered,
  stripeConfigured,
} from './storefront-checkout-methods';
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
 * The credentials a PayPal webhook is verified with (resolvePaypalBusinessCreds). W11-STORE-OWN-PAYMENT-KEYS (D-138):
 * `storefrontBusinessId` is set when the resource names a storefront order: the values are then that store's own (or
 * null), and verifyPaypalSignature takes none of them from the platform env.
 */
type PaypalWebhookCredentials = {
  clientId: string | null;
  clientSecret: string | null;
  webhookId: string | null;
  /** W11-STORE-OWN-PAYMENT-KEYS review (SEC-W11OPK-1): the business whose own settings these values are. */
  businessId: string;
  storefrontBusinessId?: string;
};

/**
 * W11-STORE-OWN-PAYMENT-KEYS review (SEC-W11OPK-1): the PayPal app a webhook was verified with. `businessId` is the
 * business whose own PayPal settings verified it (resolvePaypalBusinessCreds), or null for the platform's app (the
 * env). `store` is set when that business is a storefront order's store, verified with its own complete set only
 * (D-138). Every capture the event carries is settled only for what that app may settle: a storefront order of that
 * store (maybeCompleteStorefrontOrder), an invoice whose business takes PayPal with that app (paypalAppOfInvoice).
 */
type PaypalVerifier = { businessId: string | null; store: boolean };

/** The platform's PayPal app (the env): what a direct call of the capture processors stands for, as before. */
const PLATFORM_PAYPAL_VERIFIER: PaypalVerifier = Object.freeze({ businessId: null, store: false });

/**
 * The business's own PayPal settings, as a PayPal webhook naming one of its invoices is verified with them
 * (resolvePaypalBusinessCreds): each of the three values it saved, or null when it saved none of them (the platform's
 * app then verifies, and is the app its invoice pay link takes PayPal with: paypalConfigured, as built).
 */
function ownPaypalSettings(meta: unknown): { clientId: string | null; clientSecret: string | null; webhookId: string | null } | null {
  const m = (meta as Record<string, any> | null) ?? {};
  const clientId = (m.paypalClientId as string | undefined) || null;
  const clientSecret = (m.paypalClientSecret as string | undefined) || null;
  const webhookId = (m.paypalWebhookId as string | undefined) || null;
  return clientId || clientSecret || webhookId ? { clientId, clientSecret, webhookId } : null;
}

/**
 * PR210-PAYPAL-STORE-REFUND: the PayPal events whose resource is a refund (a capture refunded, or reversed by a
 * dispute). It names the capture it returns only through supplementary_data.related_ids.capture_id or its 'up' link
 * (paypalRefundedCaptureId), not through custom_id / invoice_id as a capture does.
 */
const PAYPAL_REFUND_EVENTS = new Set(['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED']);

/** The capture a PayPal refund resource returns: supplementary_data.related_ids.capture_id, else its 'up' link's last segment. */
function paypalRefundedCaptureId(resource: unknown): string | undefined {
  const refund = resource as
    | { supplementary_data?: { related_ids?: { capture_id?: unknown } }; links?: Array<{ rel?: unknown; href?: unknown } | null> }
    | null
    | undefined;
  const up = Array.isArray(refund?.links) ? refund.links.find((l) => l?.rel === 'up') : undefined;
  const captureId = refund?.supplementary_data?.related_ids?.capture_id || (typeof up?.href === 'string' ? up.href.split('/').pop() : undefined);
  return typeof captureId === 'string' && captureId ? captureId : undefined;
}

/**
 * W11-STORE-OWN-PAYMENT-KEYS (D-138): the credentials a PayPal webhook of a store's storefront order is verified with:
 * the store's own complete pair and its own webhook id, each null when the store has not saved it (verifyPaypalSignature
 * then refuses before any request), never one of the platform's (storefrontBusinessId makes the check store-only).
 */
function storefrontPaypalCredentials(businessId: string, meta: unknown): PaypalWebhookCredentials {
  const own = storePaypalCredentials(meta);
  return {
    clientId: own?.clientId ?? null,
    clientSecret: own?.clientSecret ?? null,
    webhookId: own?.webhookId ?? null,
    businessId,
    storefrontBusinessId: businessId,
  };
}

/**
 * V1-15c review (SEC-V15C-2, CR-V15C-1): the aborts of a payment transaction
 * that a second attempt can get past (P2028: the transaction expired or was
 * closed, typically behind a lock; P2034: a write conflict or deadlock), and
 * how many attempts recording a completed PayPal capture makes.
 */
const TRANSIENT_TX_ABORTS = new Set(['P2028', 'P2034']);
const PAYPAL_CAPTURE_RECORD_ATTEMPTS = 3;

/**
 * W11-TRANSIENT-CONFLICT (F-37): whether a PayPal capture recording abort is
 * transient and worth retrying — either a Prisma transaction abort code
 * (`P2028`, `P2034`) or a deadlock / serialization failure recognized by
 * `isLostTransactionConflict` (including no-code `@prisma/adapter-pg` 40P01
 * deadlocks and `P2010` raw-query wrappers).
 */
export function isTransientPaymentAbort(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return (typeof code === 'string' && TRANSIENT_TX_ABORTS.has(code)) || isLostTransactionConflict(err);
}

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
 * W1F-STORE-STRIPE-R0 (D-196, D-138): the Stripe refund event types handled by
 * the door. Platform-signed refund events never refund or mutate a storefront
 * order; store-signed refund events verify against the store's own webhook
 * secret and map directly to their storefront order.
 */
const STRIPE_REFUND_EVENTS = new Set([
  'charge.refunded',
  'refund.created',
  'charge.refund.updated',
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
/**
 * W5-CREDIT-AWARE-PAY review (SEC-CAP-1, SEC-CAP-2, SEC-CAP-3, CR-CAP-1; D-13,
 * D-19): the webhook_events provider under which createWipayCheckout keeps,
 * before WiPay is called, each amount it asked WiPay for on an invoice: one
 * row per invoice and amount (`<invoiceId>:<integer cents>`, event type
 * 'requested'), with the invoice's business. WiPay's proof binds the amount
 * this server requested, and the remainder an invoice checkout asks for moves
 * with the invoice; so handleWipayCallback verifies against these kept
 * amounts, never against a remainder worked out again when the callback
 * arrives. It is not a dedupe claim (provider 'wipay').
 */
const WIPAY_REQUESTED_PROVIDER = 'wipay-requested';
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
 * W10-WIPAY-KEY review SEC-W10WK-2 / WK-CR-1 (owner ruling D-105; the D-76
 * `refused:<reason>` mark): the event type a WiPay transaction's
 * webhook_events row is kept under when its success was paid into the
 * platform's WiPay account (a checkout started before D-105) and so was not
 * recorded on the business's payable (refuseWipayPlatformAccount).
 */
const WIPAY_PLATFORM_ACCOUNT_REFUSAL = 'refused:platform-account';

/**
 * W3-VOID-PROVIDER-RACE review CR-VPR-1: createRefundWithPostingByInvoice's
 * answer when it recorded nothing because the invoice is VOID and holds no
 * payment the refund returns (its capture was refused, VN-08).
 */
const VOID_INVOICE_NOTHING_TO_REFUND = 'void_invoice_nothing_to_refund' as const;

/**
 * PR210-PAYPAL-STORE-REFUND review (COR-PR210-2; owner ruling D-121): the
 * webhook_events provider under which a PayPal refund of a store order's door
 * payment is kept when it is the refund the owner already recorded by hand
 * (the D-121 fulfil refund door, which calls no provider: the owner then makes
 * the refund in PayPal, and PayPal's notice of it arrives). One row per PayPal
 * refund id (the unique (provider, providerEventId) key), its business the
 * store's, and its event type `paired:<the hand-recorded refund row's id>`
 * (paypalPairedWith), so each hand-recorded refund stands for one PayPal refund
 * and the notice's redelivery or resend is the same refund. It is not a
 * delivery's dedupe claim (provider 'paypal').
 */
const PAYPAL_REFUND_PAIRED_PROVIDER = 'paypal-refund-paired';
const paypalPairedWith = (handRefundId: string) => `paired:${handRefundId}`;

/**
 * W11-LOAD-SENSITIVE-TESTS (MR-02 / MR-03): provider payment and refund posting
 * transactions lock the invoice row, record the Payment row, and post or
 * reverse ledger entries (a completing refund reverses both the original
 * payment posting and prior partial refund postings inside one commit). Under
 * load or against a remote database that can exceed Prisma's 5 s interactive
 * transaction default and abort a genuine payment or refund ("Transaction
 * already closed"). Matches CommerceService's RECORD_PAYMENT_TX_OPTIONS.
 */
export const PAYMENT_POSTING_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

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
    }, PAYMENT_POSTING_TX_OPTIONS);
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
   *
   * W10-REFUND-CHARGE-DOOR review SEC-RCD-1 (R0-PL-07, R0-CMF2 ST-R011-2,
   * D-90): `refunder` is the person (or KEY, its SYSTEM actor) who made the
   * refund through PaymentsOpsService.refundCharge, named as the manual
   * refund door names it: on the refund row's recordedBy, on the reversal or
   * refund posting's createdById, and on one FINANCE payment_refunded feed
   * row written through `tx` (auditInTransaction), so it commits with the
   * refund, and a failed insert rolls the recording back (refundCharge logs
   * it and the provider's refund event records the refund). A provider
   * event names no refunder and passes none: unchanged.
   *
   * W11-KEY-REFUND-INITIATED-BY (D-90, SEC-W7KMP-1): `refunder.initiatedBy`
   * is the member KEY's refund ran for, handed to onPaymentRefunded, which
   * keeps it as data.initiatedBy on that feed row beside a SYSTEM refunder
   * only. It names nobody on the row or the posting: KEY stays the refunder.
   */
  private async createRefundWithPosting(
    original: RefundOriginal,
    refund: ProviderRefund,
    amountToRecord: (tx: Prisma.TransactionClient) => Promise<number>,
    alsoLinkedBy: string[] = [],
    refunder?: { actorId: string | null; initiatedBy?: string | null },
    /**
     * PR210-PAYPAL-STORE-REFUND review (COR-PR210-1): what else the recorded refund changes, in this transaction (the
     * refunded store order: StoreOrderService.recordProviderRefundOnOrder), so it commits with the refund or not at all.
     */
    onRecorded?: (tx: Prisma.TransactionClient, amount: number) => Promise<void>,
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
          // SEC-RCD-1 (R0-PL-07): the refunder refundCharge names.
          ...(refunder ? { recordedBy: refunder.actorId } : {}),
        },
      });
      await this.revenuePosting.onPaymentRefunded(original.id, {
        tx: txClient,
        refund: { paymentId: created.id, amount },
        // SEC-RCD-1 (R0-PL-07, R0-CMF2): the posting and its feed row name the refunder, in this transaction.
        ...(refunder ? { createdById: refunder.actorId, auditInTransaction: true } : {}),
        // W11-KEY-REFUND-INITIATED-BY (D-90, SEC-W7KMP-1): the member KEY's refund ran for, audit data only.
        ...(refunder?.initiatedBy ? { initiatedBy: refunder.initiatedBy } : {}),
      });
      if (onRecorded) await onRecorded(txClient, amount);
      return created;
    }, PAYMENT_POSTING_TX_OPTIONS);
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
    }, PAYMENT_POSTING_TX_OPTIONS);
  }

  /**
   * W10-REFUND-CHARGE-DOOR (SOT-10b; the V1-29 refund convention, owner
   * rulings D-14 and D-102): the refund an operator or KEY made through
   * PaymentsOpsService.refundCharge, recorded through the provider refund
   * door. refundCharge wrote the negative REFUNDED row itself, with no
   * reversal of the original's posting, and the provider's refund event then
   * found the row by its refund id and posted nothing either: the refund never
   * reached the ledger and the invoice was never reopened.
   *
   * The original is the business's SUCCESSFUL payment of `provider` recorded
   * under the charge id itself, as refundCharge read it: a refund of a payment
   * recorded under its Checkout Session or PaymentIntent id is recorded, linked
   * and posted by the provider's refund event, as before. createRefundWithPosting
   * writes the row (reference = the original's providerPaymentId) and
   * RevenuePostingService.onPaymentRefunded's posting in one transaction under
   * the invoice lock, deduped on the refund id and never more than what is
   * left of the payment; a Stripe refund is counted against a cumulative
   * charge.refunded row as the webhook counts it (stripeRefundToRecord). So
   * whichever of this call and the provider's refund.created or charge.refunded
   * comes first records and posts the refund, and the other adds nothing: it
   * is posted once in total. The invoice is then reconciled as the provider
   * refund door reconciles it (under 'keep'): a refund that unsettles it
   * reopens it (D-14: SENT with paidAt cleared, or PARTIALLY_PAID), and that
   * reopen undoes its money effects (D-102). A failed reconcile is logged, as
   * the provider refund door logs it.
   *
   * Returns whether a row was recorded. A recording that fails throws, with
   * nothing written: the provider refunded, and its refund event records it.
   *
   * Review SEC-RCD-1 (R0-PL-07, R0-CMF2 ST-R011-2, D-90): `actorId` is who
   * made the refund (the authenticated user of the payments-ops route, a D-46
   * SUPER_ADMIN member included, or KEY_SYSTEM_ACTOR_ID for KEY's
   * payments_refund_charge), named on the refund row's recordedBy, the
   * reversal or refund posting's createdById and one FINANCE payment_refunded
   * feed row in the same transaction (KEY as SYSTEM, a person as USER), as
   * the manual refund door names its refunder. A refund the provider's event
   * records first names nobody, as before: no person is known to it.
   *
   * W11-KEY-REFUND-INITIATED-BY (D-90, SEC-W7KMP-1): `initiatedBy` is the
   * member KEY's payments_refund_charge ran for (FlowOrchestratorService
   * .contactBindMember), kept beside KEY as data.initiatedBy on that feed row
   * (RevenuePostingService.onPaymentRefunded drops it beside a person or when
   * it is a system actor). The owner's refund passes none.
   */
  async recordGatewayRefund(input: {
    businessId: string;
    provider: string;
    chargeId: string;
    refund: { id: string; amount: number; currency: string };
    reason?: string | null;
    actorId: string | null;
    initiatedBy?: string | null;
  }): Promise<boolean> {
    const { businessId, provider, chargeId, refund } = input;
    if (!refund.id) return false;
    const original: RefundOriginal | null = await this.prisma.client.payment.findFirst({
      where: { businessId, provider, status: 'SUCCESSFUL', providerPaymentId: chargeId },
      select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
    });
    if (!original) return false;
    const amount = Math.abs(Number(refund.amount));
    const persisted = await this.createRefundWithPosting(
      original,
      {
        provider,
        providerPaymentId: refund.id,
        currency: (refund.currency || original.currency).toUpperCase(),
        notes: input.reason ?? null,
      },
      provider === 'stripe'
        ? (tx) => this.stripeRefundToRecord(tx, original, { amountMinor: toCents(amount), charge: chargeId, cumulative: false })
        : async () => amount,
      [],
      { actorId: input.actorId ?? null, initiatedBy: input.initiatedBy ?? null },
    ).catch(this.refundAlreadyRecorded(provider, refund.id));
    if (!persisted) return false;
    await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId, { onIllegalTransition: 'keep' }).catch((e) => {
      this.logger.warn(`${provider} refund ${refund.id} reconcile failed for invoice ${original.invoiceId}: ${e instanceof Error ? e.message : e}`);
    });
    return true;
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
    /**
     * W11-STORE-OWN-PAYMENT-KEYS (D-138): for a PayPal capture, the business whose own PayPal app verified the
     * webhook (resolvePaypalBusinessCreds), or null when it was verified with any other credentials (the platform's
     * app, an invoice's business). A storefront order is settled by PayPal only for its own business: a capture
     * verified by the platform's app, or by another store's, records nothing for it.
     */
    paypalVerifiedFor?: string | null,
    /**
     * W1F-STORE-STRIPE-R0 (owner ruling D-196 `storestripe`, D-138): for a Stripe
     * payment event, the business whose own Stripe webhook secret verified the
     * webhook, or null for the platform secret. Defense-in-depth: a storefront
     * order is settled by Stripe ONLY for its own business.
     */
    stripeVerifiedFor?: string | null,
    /** Related Stripe payment_intent / charge id stashed on Payment.reference for refund correlation. */
    providerReference?: string | null,
  ): Promise<boolean> {
    if (!this.storeOrderService) return false;
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id: orderId },
      select: { id: true, businessId: true, paymentStatus: true, total: true, currency: true },
    });
    if (!order) return false;
    if (order.paymentStatus === 'PAID') {
      this.logger.debug(`Storefront order ${orderId} already PAID; idempotent no-op`);
      return true;
    }
    if (provider === 'paypal' && (!paypalVerifiedFor || paypalVerifiedFor !== order.businessId)) {
      this.logger.error(
        `PayPal payment ${providerPaymentId} for storefront order ${orderId} not recorded: the webhook was not verified ` +
          `with that store's own PayPal app (verified for ${paypalVerifiedFor ?? 'no store'}; D-138)`,
      );
      return true;
    }
    if (provider === 'stripe' && (!stripeVerifiedFor || stripeVerifiedFor !== order.businessId)) {
      this.logger.error(
        `Stripe payment ${providerPaymentId} for storefront order ${orderId} not recorded: the webhook was not verified ` +
          `with that store's own Stripe account (verified for ${stripeVerifiedFor ?? 'platform'}; D-196, D-138)`,
      );
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
    if (providerReference) {
      await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', providerPaymentId, provider, providerReference);
    } else {
      await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', providerPaymentId, provider);
    }
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
   * W5-CREDIT-AWARE-PAY (V1-44 review CR-V44-1, the rest W4-CREDIT-AWARE-
   * READERS left closed; D-13, D-75, D-78): the gate is the credit-aware list
   * the commerce share surfaces read (isCreditAwareShareableInvoiceStatus),
   * now that every route behind it nets the invoice's own APPLIED credit
   * notes: the status poll states the credited figure and the remainder
   * (invoicePaymentStatus), and every provider checkout asks for that
   * remainder, never invoice.total (checkoutAmountOf). So a PARTIALLY_CREDITED
   * invoice is payable here for exactly what its credits leave owing, and
   * paying it leaves the invoice PARTIALLY_CREDITED (D-78). FULLY_CREDITED
   * owes nothing and still reads as absent (credit-note-reversal CN-35,
   * CAP-05).
   */
  private async payLinkInvoice(token: string): Promise<{ invoiceId: string; businessId: string }> {
    const link = await this.commerceService.getPaymentLinkByToken(token);
    if (!link) throw new NotFoundException('Invoice not found');
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: link.invoiceId, businessId: link.businessId, deletedAt: null },
      select: { status: true },
    });
    if (!invoice || !isCreditAwareShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Invoice not found');
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
   * The gateways an invoice of this business can be checked out through: the
   * pay link, the bare-id pay page and the generic invoice checkout.
   * `payableCurrency` is the payable's own currency (an invoice's); without
   * one, the business currency (D-13).
   *
   * W11-STORE-OWN-PAYMENT-KEYS: not the storefront's list (getStorefrontGateways,
   * D-138). This one still offers PayPal and Stripe on the platform env, alone
   * or mixed with a business's own keys (paypalConfigured, stripeConfigured):
   * unchanged by D-138, recorded as a deviation for an owner ruling.
   */
  async getAvailableGateways(businessId: string, payableCurrency?: string | null): Promise<GatewayInfo[]> {
    return this.listGateways(businessId, payableCurrency, 'invoice');
  }

  /**
   * W11-STORE-OWN-PAYMENT-KEYS (owner ruling D-138): the gateways a storefront
   * checkout of this business can name (GET /site/storefront/public/:slug/
   * gateways; the checkout gate StoreOrderService.createOrder reads the same
   * credentials). WiPay and the currency rules as getAvailableGateways; PayPal
   * and Stripe only with the business's own complete set in its settings
   * (storePaypalCredentials, storeStripeCredentials): the platform env never
   * stands in and is never mixed in.
   */
  async getStorefrontGateways(businessId: string, payableCurrency?: string | null): Promise<GatewayInfo[]> {
    return this.listGateways(businessId, payableCurrency, 'storefront');
  }

  private async listGateways(
    businessId: string,
    payableCurrency: string | null | undefined,
    surface: 'invoice' | 'storefront',
  ): Promise<GatewayInfo[]> {
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
    // G6RC-1). W10-WIPAY-KEY (D-105): that source is the business's own pair;
    // a business with no WiPay key of its own is not offered WiPay (it was
    // offered the platform's account). This list serves the pay link, the
    // bare-id pay page and the storefront checkout (SiteController).
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

    // W10-PAYPAL-CURRENCY (D-106, PC-08b): PayPal is offered only for an amount in a currency PayPal supports
    // (paypal-currency.ts; never TTD, JMD, BBD, GYD or XCD), and in that currency: the order is made in the
    // payable's own currency (V1-05), not USD.
    // W11-STORE-CHECKOUT-METHOD-GATE (F-21): "configured" is one reading per surface (storefront-checkout-methods.ts).
    // W11-STORE-OWN-PAYMENT-KEYS (D-138): the storefront's is the business's own complete set only, shared with the
    // storefront checkout, which refuses PayPal and Stripe before the order is written where this list leaves them
    // out; the invoice pay link's still admits the platform env (unchanged here).
    const storefront = surface === 'storefront';
    const paypalOffered = storefront ? storePaypalCredentials(meta) !== null : paypalConfigured(meta);
    const stripeOffered = storefront ? storeStripeCredentials(meta) !== null : stripeConfigured(meta);
    if (paypalOffered && paypalTakesCurrency(currency)) {
      gateways.push({
        id: 'paypal',
        name: 'PayPal',
        currencies: [normalizeCurrency(currency)],
      });
    }

    if (stripeOffered) {
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
   *
   * W5-CREDIT-AWARE-PAY (CR-V44-1; D-78): and PARTIALLY_CREDITED, which owes
   * what its APPLIED credit notes leave and is collected for exactly that
   * (checkoutAmountOf answers 409 once nothing is owed). FULLY_CREDITED owes
   * nothing: 409, before any provider is called.
   */
  private assertInvoicePayable(status: string, invoiceId: string): void {
    const allowed = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PENDING', 'PARTIALLY_CREDITED']);
    if (allowed.has(status)) return;
    if (status === 'PAID') throw new BadRequestException('Invoice is already paid');
    if (status === 'FULLY_CREDITED') throw new ConflictException('Invoice is fully credited; nothing is owed');
    if (status === 'VOID') throw new BadRequestException('Invoice is void');
    if (status === 'DRAFT') {
      throw new BadRequestException(
        `Invoice ${invoiceId} is still a draft — send it before collecting payment`,
      );
    }
    throw new BadRequestException(`Invoice ${invoiceId} is not in a payable state (${status})`);
  }

  /**
   * W5-CREDIT-AWARE-PAY (V1-44 review CR-V44-1 rest; D-13, D-75, D-78): the
   * invoice's balance as the share views state it: its own-tenant payment
   * rows (Payment has no FK to Business, M31; D-75) read by
   * balanceOfStoredRows, net of its own APPLIED credit notes (appliedCreditsOf:
   * only for a credited status, only the invoice's business), in integer
   * cents (creditAwareBalance). `remaining` is what is still owed and
   * `credited` the notes netted; with nothing credited it is the balance
   * unchanged.
   */
  private async creditAwareBalanceOf(
    invoice: { id: string; businessId: string; status: string; total: unknown; currency: string | null },
  ): Promise<CreditAwareBalance> {
    const own = await this.prisma.client.payment.findMany({
      where: { invoiceId: invoice.id, businessId: invoice.businessId },
      select: { amount: true, status: true },
    });
    const credited = await appliedCreditsOf(this.prisma.client as unknown as Prisma.TransactionClient, invoice);
    return creditAwareBalance(balanceOfStoredRows(Number(invoice.total), own, invoice.currency), credited);
  }

  /**
   * W5-CREDIT-AWARE-PAY (CR-V44-1 rest; D-13, D-78): the amount every invoice
   * checkout asks its provider for (Stripe, WiPay, PayPal) and the PayPal
   * capture binds: the remainder net of payments received and APPLIED credit
   * notes (creditAwareBalanceOf), never invoice.total, which charged a
   * part-paid or part-credited invoice again for what it no longer owes. With
   * nothing owed (a part-credited invoice whose remainder is paid stays
   * PARTIALLY_CREDITED, D-78) the checkout is refused 409 before any provider
   * is called.
   */
  private async checkoutAmountOf(invoice: {
    id: string;
    businessId: string;
    status: string;
    total: unknown;
    currency: string | null;
  }): Promise<number> {
    const { remaining } = await this.creditAwareBalanceOf(invoice);
    if (toCents(remaining) <= 0) throw new ConflictException('Invoice is already paid');
    return remaining;
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
    // W5-CREDIT-AWARE-PAY (CR-V44-1; D-13): the remainder net of payments and APPLIED credit notes.
    const due = await this.checkoutAmountOf(invoice);

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
    const amount = toCents(due);
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
    // when an invoice can be resolved from the event, or to a store's own
    // complete Stripe set's webhook secret when it names a storefront order
    // (W11-STORE-OWN-PAYMENT-KEYS review, D-138).
    const candidateInvoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id;
    const candidateOrderId: string | undefined =
      (typeof obj?.metadata?.orderId === 'string' && obj.metadata.orderId) || candidateInvoiceId;

    const envSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let signatureOk = false;
    // V1-15c review (SEC-V15C-3): the business whose own secret verified the
    // delivery. A tenant sets that secret itself (Settings > Payments), so such
    // a delivery speaks for that tenant only; null when the deployment's
    // secret (Stripe's alone) verified it.
    let signedForBusinessId: string | null = null;
    if (envSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, envSecret)) {
      signatureOk = true;
    } else if (signatureHeader) {
      const inv = candidateInvoiceId
        ? await this.prisma.client.invoice.findUnique({
            where: { id: candidateInvoiceId },
            include: { business: { select: { metaData: true } } },
          }).catch(() => null)
        : null;
      const businessSecret = (inv?.business.metaData as Record<string, any> | null)?.stripeWebhookSecret as string | undefined;
      if (inv && businessSecret && this.verifyStripeSignature(rawPayload, signatureHeader, businessSecret)) {
        signatureOk = true;
        signedForBusinessId = inv.businessId;
      } else if (!inv && candidateOrderId && typeof candidateOrderId === 'string') {
        // W11-STORE-OWN-PAYMENT-KEYS (D-138) + W1F-STORE-STRIPE-R0 (D-196): a
        // storefront Stripe session, PaymentIntent, or Charge (including
        // charge.refunded carrying payment_intent_data.metadata.orderId) is on
        // the store's own account and verified ONLY with that store's own
        // webhook secret from its complete Stripe set (storeStripeCredentials).
        const order: { businessId: string; business: { metaData: unknown } | null } | null = await Promise.resolve()
          .then(() =>
            this.prisma.client.marketplaceOrder.findUnique({
              where: { id: candidateOrderId },
              select: { businessId: true, business: { select: { metaData: true } } },
            }),
          )
          .catch(() => null);
        const own = order ? storeStripeCredentials(order.business?.metaData) : null;
        if (order && own && this.verifyStripeSignature(rawPayload, signatureHeader, own.webhookSecret)) {
          signatureOk = true;
          signedForBusinessId = order.businessId;
        }
      }
      // W1F-STORE-STRIPE-R0: store-signed refund events that do not carry
      // metadata.orderId (e.g. refund.created / charge.refund.updated) can
      // still resolve the store's own webhook secret from the settled Stripe
      // payment row matching their charge / payment_intent id.
      if (!signatureOk && STRIPE_REFUND_EVENTS.has(eventType)) {
        const matchedBusinessId = await this.verifyStoreStripeRefundSignature(rawPayload, signatureHeader, obj);
        if (matchedBusinessId) {
          signatureOk = true;
          signedForBusinessId = matchedBusinessId;
        }
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
    const refusedProvider = opts.refusedProvider ?? STRIPE_REFUSED_PROVIDER;
    if (STRIPE_PAYMENT_EVENTS.has(eventType)) {
      await this.bindStripePaymentEvent(event, signedForBusinessId, refusedProvider);
    }
    // W1F-STORE-STRIPE-R0 (D-196, D-138): platform-signed refund events MUST
    // NEVER refund or mutate a storefront order on either webhook endpoint.
    if (STRIPE_REFUND_EVENTS.has(eventType)) {
      await this.bindStripeRefundEvent(event, signedForBusinessId, refusedProvider);
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
          await this.processStripeChargeOrSession(eventType, obj, event.id, signedForBusinessId);
          return { ok: true, received: true, processed: eventType };
        case 'charge.succeeded':
        case 'payment_intent.succeeded':
          await this.processStripeChargeOrSession(eventType, obj, event.id, signedForBusinessId);
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
   * Collects the charge / payment_intent identifiers carried by a Stripe
   * refund webhook payload (charge.refunded, refund.created, charge.refund.updated).
   */
  private static stripeRefundLookupIds(obj: unknown): string[] {
    const rec = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
    const ids = new Set<string>();
    const add = (v: unknown) => {
      if (typeof v === 'string' && v) ids.add(v);
    };
    add(rec.charge);
    add(rec.payment_intent);
    const refundsObj = rec.refunds && typeof rec.refunds === 'object' ? (rec.refunds as Record<string, unknown>) : null;
    const list: unknown[] = Array.isArray(refundsObj?.data) ? refundsObj.data : [];
    if (rec.object === 'charge' || typeof rec.amount_refunded === 'number' || Array.isArray(refundsObj?.data)) {
      add(rec.id);
    }
    for (const item of list) {
      const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      add(r.charge);
      add(r.payment_intent);
    }
    return [...ids];
  }

  /**
   * W1F-STORE-STRIPE-R0: verifies a store-signed Stripe refund event that does
   * not carry metadata.orderId by looking up candidate store businesses whose
   * settled Stripe payments match the charge/payment_intent ids and checking
   * each store's own complete Stripe webhook secret.
   */
  private async verifyStoreStripeRefundSignature(
    rawPayload: string,
    signatureHeader: string,
    obj: unknown,
  ): Promise<string | null> {
    const lookupIds = PaymentsService.stripeRefundLookupIds(obj);
    if (lookupIds.length === 0) return null;
    const rows = await this.prisma.client.payment.findMany({
      where: {
        provider: 'stripe',
        status: 'SUCCESSFUL',
        recordedBy: null,
        NOT: { providerPaymentId: { startsWith: MANUAL_PAYMENT_ID_PREFIX } },
        OR: [{ providerPaymentId: { in: lookupIds } }, { reference: { in: lookupIds } }],
      },
      select: { businessId: true },
    }).catch(() => []);
    const businessIds = [...new Set(rows.map((r) => r.businessId))];
    if (businessIds.length === 0) return null;
    const businesses = await this.prisma.client.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, metaData: true },
    }).catch(() => []);
    for (const biz of businesses) {
      const own = storeStripeCredentials(biz.metaData);
      if (own && this.verifyStripeSignature(rawPayload, signatureHeader, own.webhookSecret)) {
        return biz.id;
      }
    }
    return null;
  }

  /**
   * W1F-STORE-STRIPE-R0 (owner ruling D-196 `storestripe`, D-138): a
   * platform-signed Stripe refund event (signedForBusinessId === null) MUST
   * NEVER refund or mutate a storefront order — whether it names the order via
   * metadata.orderId or references the charge / payment_intent of a storefront
   * order's Stripe settlement payment. Refused 400 before the dedupe claim,
   * keeping one refusal row under `refusedProvider`.
   */
  private async bindStripeRefundEvent(
    event: { id?: string; type?: string; data?: { object?: unknown } },
    signedForBusinessId: string | null,
    refusedProvider: StripeRefusedProvider,
  ): Promise<void> {
    if (signedForBusinessId !== null) return;
    const obj = (event.data?.object ?? {}) as Record<string, unknown>;
    const meta = obj.metadata && typeof obj.metadata === 'object' ? (obj.metadata as Record<string, unknown>) : null;
    const namedOrderId: unknown = meta?.orderId;
    if (typeof namedOrderId === 'string' && namedOrderId && this.prisma.client.marketplaceOrder?.findUnique) {
      const order = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: namedOrderId },
        select: { id: true, businessId: true },
      });
      if (order) {
        await this.refuseStripePaymentEvent(
          event,
          { kind: 'order', id: order.id, businessId: order.businessId },
          'business',
          refusedProvider,
        );
      }
    }
    const lookupIds = PaymentsService.stripeRefundLookupIds(obj);
    if (lookupIds.length === 0 || !this.prisma.client.payment?.findMany) return;
    const matches = await this.prisma.client.payment.findMany({
      where: {
        provider: 'stripe',
        status: 'SUCCESSFUL',
        recordedBy: null,
        NOT: { providerPaymentId: { startsWith: MANUAL_PAYMENT_ID_PREFIX } },
        OR: [{ providerPaymentId: { in: lookupIds } }, { reference: { in: lookupIds } }],
      },
      select: { providerPaymentId: true, invoiceId: true, businessId: true },
    });
    if (matches.length === 0) return;
    let firstStore: { orderId: string; businessId: string } | null = null;
    for (const match of matches) {
      const store = await this.stripeStorefrontSettlementOf(match);
      if (!store) return; // Matches a non-storefront invoice payment; let invoice refund path decide.
      firstStore ??= store;
    }
    if (firstStore) {
      await this.refuseStripePaymentEvent(
        event,
        { kind: 'order', id: firstStore.orderId, businessId: firstStore.businessId },
        'business',
        refusedProvider,
      );
    }
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
   * metadata.businessId and carry exactly O's total in O's currency. Under
   * W11-STORE-OWN-PAYMENT-KEYS (D-138) and W1F-STORE-STRIPE-R0 (owner ruling
   * D-196 `storestripe`), O settles ONLY with an event verified by O's own
   * store's Stripe webhook secret (`signedForBusinessId === order.businessId`);
   * the platform's STRIPE_WEBHOOK_SECRET (`signedForBusinessId === null`)
   * NEVER settles a store order on either endpoint.
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
    const id: unknown = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id || obj.metadata?.orderId;
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
    // W1F-STORE-STRIPE-R0 (owner ruling D-196 `storestripe`, D-138, SEC-W11OPK-3):
    // a storefront order settles ONLY with an event signed by that store's own
    // Stripe account (signedForBusinessId === order.businessId). The platform's
    // STRIPE_WEBHOOK_SECRET (signedForBusinessId === null) NEVER settles a store
    // order, whether the store holds Stripe credentials of its own or none.
    const foreignSigner = signedForBusinessId !== order.businessId;
    const reason =
      obj.metadata?.orderId !== order.id
        ? 'order'
        : foreignSigner || namedBusiness !== order.businessId
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
    signedForBusinessId: string | null = null,
  ): Promise<void> {
    // checkout.session.completed: invoiceId comes from session metadata or
    // client_reference_id. payment_intent.succeeded / charge.succeeded:
    // invoiceId or orderId is on the payment_intent / charge metadata when set
    // during checkout.session creation (createStripeCheckout / createStorePayment).
    const invoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id ||
      obj?.metadata?.orderId;
    if (!invoiceId) {
      this.logger.warn(`Stripe ${eventType} has no invoiceId in metadata; ignoring`);
      return;
    }

    const providerPaymentId: string = obj.id || eventId || `stripe_${invoiceId}_${Date.now()}`;

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      const storeReference: string | null =
        obj.payment_intent ||
        obj.charge ||
        (typeof obj.latest_charge === 'string' ? obj.latest_charge : null) ||
        null;
      const completed = await this.maybeCompleteStorefrontOrder(
        invoiceId,
        providerPaymentId,
        'stripe',
        undefined,
        null,
        signedForBusinessId,
        storeReference,
      );
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
      let found: RefundOriginal | null = await this.prisma.client.payment.findFirst({
        where: originalWhere,
        orderBy: { createdAt: 'asc' },
        select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
      }).catch(() => null);

      // W1F-STORE-STRIPE-R0 (D-138, D-196): when a store-signed charge.refunded
      // carries metadata.orderId (from payment_intent_data.metadata) and the
      // settlement payment row predates Payment.reference stashing (reference is
      // null), map directly to that store order's checkout invoice payment.
      if (!found && signedForBusinessId && typeof obj?.metadata?.orderId === 'string' && obj.metadata.orderId) {
        const fallback = await this.stripeStoreOrderPaymentByOrderId(obj.metadata.orderId, signedForBusinessId, lookupIds);
        if (fallback.unsettledOrder) {
          // COR-W1FS-NB1: store's own webhook verified this refund for an unsettled order
          // (checkout.session.completed not yet recorded); throw 409 so the claim is released for retry.
          throw new ConflictException(
            `Stripe refund ${refund.id ?? charge} targets unsettled store order ${obj.metadata.orderId}; retry after settlement`,
          );
        }
        found = fallback.payment;
      }

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

      // W1F-STORE-STRIPE-R0 (D-196, D-138): defense-in-depth — a storefront
      // order's Stripe settlement is refunded ONLY by an event verified with
      // that store's own Stripe account, never by the platform signature.
      const store = await this.stripeStorefrontSettlementOf(original);
      if (store && signedForBusinessId !== store.businessId) {
        this.logger.error(
          `Stripe ${eventType} for charge ${charge} not recorded: it returns storefront order ${store.orderId}'s payment ` +
            `and was not verified with that store's own Stripe account (verified for ${signedForBusinessId ?? 'platform'}; D-196, D-138)`,
        );
        continue;
      }
      if (store && !this.storeOrderService) {
        // COR-W1FS-2: the refund of a store order is recorded with its order, or not at all (Stripe redelivers it).
        throw new Error(
          `Stripe refund ${refund.id ?? charge} of storefront order ${store.orderId} not recorded: the store orders are unavailable`,
        );
      }

      // The synthetic id names the payment it refunds (review SEC-V29C-3).
      const refundId = refund.cumulative
        ? `${SYNTHETIC_REFUND_ID_PREFIX}${original.id}_${charge}_${refund.amount}`
        : (refund.id as string);
      if (refund.cumulative && (await this.paymentRecorded(refundId).catch(() => false))) continue;

      let flipped = false;
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
        undefined,
        store
          ? async (tx, recorded) => {
              ({ flipped } = await this.storeOrderService!.recordProviderRefundOnOrder(tx, {
                orderId: store.orderId,
                businessId: store.businessId,
                invoiceId: original.invoiceId,
                provider: 'stripe',
                providerRefundId: refundId,
                amount: recorded,
              }));
            }
          : undefined,
      ).catch(this.refundAlreadyRecorded('Stripe', refundId));
      // Reopen the invoice if the refund moves the balance below total.
      // W5-REFUND-DOORS-KEEP (review SEC-CRP-1 / CR-REG-2; D-14, D-78): under
      // 'keep', as the manual refund door reconciles. A refund is money already
      // gone back: a credited invoice it leaves holding more than its credit
      // notes leave owing keeps its credited status (D-78) and
      // reconcileCreditedFromPayments re-derives its paidAt (cleared once the
      // payment rows no longer settle the total, D-14) instead of refusing 409,
      // which the catch below swallowed with the stale paidAt left in place.
      // An illegal move out of any other status is kept and logged, nothing
      // written, as that refusal already left it.
      if (persisted) {
        await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId, { onIllegalTransition: 'keep' }).catch((e) => {
          this.logger.warn(`Stripe refund reconcile failed for invoice ${original.invoiceId}: ${e instanceof Error ? e.message : e}`);
        });
      }
      if (persisted && flipped && store) {
        await this.storeOrderService?.announceProviderRefund(store.orderId, store.businessId, original.invoiceId).catch((e) => {
          this.logger.warn(`store_order.refunded for order ${store.orderId} not sent: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
  }

  /**
   * W1F-STORE-STRIPE-R0 (D-196, D-138): the storefront order a Stripe payment
   * settled through StoreOrderService.completeCheckout (checkout invoice
   * INV-<orderNumber>, order.paymentRef === payment.providerPaymentId, same
   * business), or null for any non-storefront invoice payment.
   */
  private async stripeStorefrontSettlementOf(
    payment: { providerPaymentId: string; invoiceId: string; businessId: string },
  ): Promise<{ orderId: string; businessId: string } | null> {
    if (!this.prisma.client.invoice?.findUnique || !this.prisma.client.marketplaceOrder?.findUnique) {
      return null;
    }
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: payment.invoiceId },
      select: { businessId: true, invoiceNumber: true },
    });
    const invoiceNumber = invoice?.invoiceNumber;
    if (!invoice || invoice.businessId !== payment.businessId || !invoiceNumber?.startsWith('INV-')) {
      return null;
    }
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { orderNumber: invoiceNumber.slice('INV-'.length) },
      select: { id: true, businessId: true, paymentRef: true },
    });
    if (!order || order.businessId !== payment.businessId || order.paymentRef !== payment.providerPaymentId) {
      return null;
    }
    return { orderId: order.id, businessId: order.businessId };
  }

  /**
   * W1F-STORE-STRIPE-R0: locate a store order's settled Stripe payment by
   * metadata.orderId within the signing store's own business when the settlement
   * payment row carries no conflicting reference (e.g. a row settled without
   * payment_intent stashed in reference).
   */
  private async stripeStoreOrderPaymentByOrderId(
    orderId: string,
    businessId: string,
    lookupIds: string[],
  ): Promise<{ payment: RefundOriginal | null; unsettledOrder: boolean }> {
    if (
      !this.prisma.client.marketplaceOrder?.findFirst ||
      !this.prisma.client.invoice?.findFirst ||
      !this.prisma.client.payment?.findFirst
    ) {
      return { payment: null, unsettledOrder: false };
    }
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { orderNumber: true, paymentRef: true },
    });
    if (!order) return { payment: null, unsettledOrder: false };
    if (!order.paymentRef) return { payment: null, unsettledOrder: true };
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { businessId, invoiceNumber: `INV-${order.orderNumber}` },
      select: { id: true },
    });
    if (!invoice) return { payment: null, unsettledOrder: false };
    const row = await this.prisma.client.payment.findFirst({
      where: {
        businessId,
        invoiceId: invoice.id,
        provider: 'stripe',
        providerPaymentId: order.paymentRef,
        status: 'SUCCESSFUL',
        recordedBy: null,
        NOT: { providerPaymentId: { startsWith: MANUAL_PAYMENT_ID_PREFIX } },
      },
      select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true, reference: true },
    });
    if (!row) return { payment: null, unsettledOrder: false };
    if (row.reference && lookupIds.length > 0 && !lookupIds.includes(row.reference)) {
      return { payment: null, unsettledOrder: false };
    }
    return {
      payment: {
        id: row.id,
        providerPaymentId: row.providerPaymentId,
        invoiceId: row.invoiceId,
        businessId: row.businessId,
        currency: row.currency,
        amount: row.amount,
      },
      unsettledOrder: false,
    };
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
    creds?: PaypalWebhookCredentials,
  ): Promise<boolean> {
    // W11-STORE-OWN-PAYMENT-KEYS (D-138): a storefront order's webhook is verified with the store's own pair and
    // webhook id only; none of the three falls back to the platform env (an invoice's still does, unchanged).
    const storeOnly = Boolean(creds?.storefrontBusinessId);
    const webhookId = storeOnly ? creds?.webhookId : creds?.webhookId || process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      this.logger.error(
        storeOnly
          ? `Store ${creds?.storefrontBusinessId} has no PayPal webhook id of its own; cannot verify its PayPal webhook (D-138)`
          : 'PAYPAL_WEBHOOK_ID is not configured; cannot verify PayPal webhooks',
      );
      return false;
    }
    const clientId = storeOnly ? creds?.clientId : creds?.clientId || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = storeOnly ? creds?.clientSecret : creds?.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      this.logger.error(
        storeOnly
          ? `Store ${creds?.storefrontBusinessId} has no complete PayPal pair of its own; cannot verify its PayPal webhook (D-138)`
          : 'PayPal client credentials not configured; cannot verify PayPal webhooks',
      );
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
    // W11-STORE-OWN-PAYMENT-KEYS (D-138): a storefront order resolves to its
    // store's own PayPal app only (never the env), and only a store's own app
    // settles that store's orders (maybeCompleteStorefrontOrder).
    // Review repair (SEC-W11OPK-1): the app is chosen from the first purchase
    // unit, but every captured unit is settled, so each one is settled only for
    // what that app may settle (an invoice: paypalAppOfInvoice).
    // PR210-PAYPAL-STORE-REFUND: a refund or reversal names only the capture it returns; a store's capture resolves
    // to that store's own app (resolvePaypalBusinessCreds), so its refund is never checked with the platform's.
    const businessCreds = await this.resolvePaypalBusinessCreds(event.resource || {}, event.event_type);
    const verified = await this.verifyPaypalSignature(headers, rawPayload, sandbox, businessCreds ?? undefined);
    if (!verified) {
      throw new BadRequestException('Invalid PayPal webhook signature');
    }
    const verifier: PaypalVerifier = {
      businessId: businessCreds?.businessId ?? null,
      store: Boolean(businessCreds?.storefrontBusinessId),
    };

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
          await this.processPaypalCaptureCompleted(resource, event.id, verifier);
          return { ok: true, received: true, processed: eventType };
        case 'CHECKOUT.ORDER.COMPLETED':
          // For ORDER.COMPLETED, resource.id is the *order* id, not the
          // capture id. Captures live under purchase_units[].payments.captures.
          // Persist a Payment row per capture so refund linkage (which keys on
          // capture id) keeps working, and idempotency stays intact even if
          // PAYMENT.CAPTURE.COMPLETED also arrives for the same capture.
          await this.processPaypalOrderCompleted(resource, event.id, verifier);
          return { ok: true, received: true, processed: eventType };
        case 'PAYMENT.CAPTURE.REFUNDED':
        case 'PAYMENT.CAPTURE.REVERSED':
          await this.processPaypalRefund(resource, event.id, verifier);
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
   *
   * PR210-PAYPAL-STORE-REFUND (Codex review P1 on PR #210; D-138): a refund or
   * reversal (PAYMENT.CAPTURE.REFUNDED / .REVERSED) names the capture it
   * returns only through related_ids.capture_id or its 'up' link, which none
   * of the readings below follow, so a store's own refund was checked with the
   * platform's app and webhook id: refused 400 (PayPal kept redelivering it)
   * and never recorded. The capture is followed first, to what the storefront
   * settlement recorded for it (paypalStorefrontSettlementOf): a store's
   * capture is verified with that store's own complete set only, whatever
   * else the resource names, never the platform's and never mixed (a store
   * missing a value refuses, as for a capture). Review SEC-PR210-2 /
   * COR-PR210-3: a store holding no PayPal setting of its own at all took no
   * capture into a PayPal account of its own (before D-138 the platform's app
   * settled its orders; since, it is offered no PayPal), so its capture's
   * refund is verified with the platform's app, as at the base. Any other
   * capture (an invoice's) keeps the path below, unchanged. A failed read throws: the
   * delivery is answered 500 and PayPal redelivers it, rather than it being
   * checked with an app the read did not choose.
   */
  private async resolvePaypalBusinessCreds(resource: any, eventType?: string): Promise<PaypalWebhookCredentials | null> {
    if (eventType && PAYPAL_REFUND_EVENTS.has(eventType)) {
      const store = await this.paypalStorefrontSettlementOf(paypalRefundedCaptureId(resource));
      // PR210 review (SEC-PR210-2, COR-PR210-3): a store that holds no PayPal setting of its own has no PayPal account
      // KeyFlow could have taken its order's capture into but the platform's (the platform's app settled storefront
      // orders before D-138; since D-138 such a store is offered no PayPal), so its capture's refund is the platform's
      // event, verified with the platform's app as at the base. A store holding any PayPal setting is checked with its
      // own complete set only.
      if (store) return ownPaypalSettings(store.metaData) ? storefrontPaypalCredentials(store.businessId, store.metaData) : null;
    }
    const link = await this.resolvePaypalInvoiceId(resource).catch(() => null);
    if (!link) return this.resolvePaypalStorefrontCreds(resource);
    const business = await this.prisma.client.business.findUnique({
      where: { id: link.businessId },
      select: { metaData: true },
    }).catch(() => null);
    const own = ownPaypalSettings(business?.metaData);
    return own ? { ...own, businessId: link.businessId } : null;
  }

  /**
   * W11-STORE-OWN-PAYMENT-KEYS review (SEC-W11OPK-1): the PayPal app an invoice of this business is settled by: the
   * business's own when it saved any PayPal setting of its own (a webhook naming its invoice is verified with them,
   * resolvePaypalBusinessCreds), else the platform's (null; the invoice pay link's PayPal, as built). A failed read
   * throws, so the delivery's claim is given back and PayPal redelivers it (V1-15c) rather than the capture being
   * refused for a read that did not happen.
   */
  private async paypalAppOfInvoice(businessId: string): Promise<string | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    return ownPaypalSettings(business?.metaData) ? businessId : null;
  }

  /**
   * W11-STORE-OWN-PAYMENT-KEYS (owner ruling D-138): the storefront PayPal
   * capture. A webhook resource that names no invoice but a storefront order
   * (custom_id or reference_id, as createStorePayment sets both to the order
   * id) is verified only with that store's own complete PayPal pair and its
   * own webhook id (storePaypalCredentials, storePaypalWebhookId): never the
   * platform's PayPal app, never one of the platform's values beside the
   * store's. A store missing any of the three gets nulls, and
   * verifyPaypalSignature refuses before any request. Before D-138 a
   * storefront order resolved to nothing and was verified with the platform's
   * app, so a capture into the platform's account settled a store's order.
   * Null when the resource names no storefront order (the env-level check, as
   * before).
   */
  private async resolvePaypalStorefrontCreds(resource: any): Promise<PaypalWebhookCredentials | null> {
    const candidate: unknown =
      resource?.custom_id ||
      resource?.invoice_id ||
      resource?.purchase_units?.[0]?.reference_id ||
      resource?.purchase_units?.[0]?.custom_id;
    if (!candidate || typeof candidate !== 'string') return null;
    const order: { businessId: string; business: { metaData: unknown } | null } | null = await Promise.resolve()
      .then(() =>
        this.prisma.client.marketplaceOrder.findUnique({
          where: { id: candidate },
          select: { businessId: true, business: { select: { metaData: true } } },
        }),
      )
      .catch(() => null);
    if (!order) return null;
    return storefrontPaypalCredentials(order.businessId, order.business?.metaData);
  }

  /**
   * PR210-PAYPAL-STORE-REFUND: the storefront order a PayPal capture settled, as the storefront settlement recorded it
   * (maybeCompleteStorefrontOrder -> StoreOrderService.updatePaymentStatus -> completeCheckout): the capture id is the
   * providerPaymentId of a PayPal payment on the order's checkout invoice (INV-<orderNumber>, written only by that paid
   * door) and the order's paymentRef, all under one business. Null for any other capture (an invoice's, one KeyFlow
   * never recorded). Its store's settings come with it, for the store-only check (storefrontPaypalCredentials).
   */
  private async paypalStorefrontSettlementOf(
    captureId: string | undefined,
  ): Promise<{ orderId: string; businessId: string; metaData: unknown } | null> {
    if (!captureId) return null;
    const payment = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: captureId },
      select: { provider: true, businessId: true, invoice: { select: { businessId: true, invoiceNumber: true } } },
    });
    const invoiceNumber = payment?.invoice?.invoiceNumber;
    if (payment?.provider !== 'paypal' || payment.invoice?.businessId !== payment.businessId || !invoiceNumber?.startsWith('INV-')) {
      return null;
    }
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { orderNumber: invoiceNumber.slice('INV-'.length) },
      select: { id: true, businessId: true, paymentRef: true, business: { select: { metaData: true } } },
    });
    if (!order || order.businessId !== payment.businessId || order.paymentRef !== captureId) return null;
    return { orderId: order.id, businessId: order.businessId, metaData: order.business?.metaData };
  }

  /**
   * Walk an ORDER.COMPLETED resource and persist a payment row for each
   * embedded capture. This is the only safe way to handle this event:
   * resource.id is the order id (not a capture id), so persisting it
   * directly would create a row that refund events cannot link to.
   */
  private async processPaypalOrderCompleted(resource: any, eventId?: string, verifier: PaypalVerifier = PLATFORM_PAYPAL_VERIFIER): Promise<void> {
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
      await this.processPaypalCaptureCompleted(cap, eventId, verifier);
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

  private async processPaypalCaptureCompleted(resource: any, eventId?: string, verifier: PaypalVerifier = PLATFORM_PAYPAL_VERIFIER): Promise<void> {
    // D-138: a storefront order is settled by PayPal only for its own store, verified with that store's own app.
    const verifiedStore = verifier.store ? verifier.businessId : null;
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
        }, verifiedStore);
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
      }, verifiedStore);
      if (completed) return;
      return;
    }

    // W11-STORE-OWN-PAYMENT-KEYS review (SEC-W11OPK-1): the app that verified the webhook was chosen from the event's
    // first purchase unit, and this capture may be a later unit's. It is recorded for the invoice only when that app
    // is the one the invoice's business takes PayPal with (its own settings, else the platform's): one business's own
    // app (a storefront order's store, or an invoice's business) never settles another business's invoice with money
    // paid into its own account, and the platform's app never settles the invoice of a business with its own PayPal.
    const invoiceApp = await this.paypalAppOfInvoice(invoice.businessId);
    if (invoiceApp !== verifier.businessId) {
      this.logger.error(
        `PayPal capture ${captureId} for invoice ${invoice.id} not recorded: the webhook was verified with ` +
          `${verifier.businessId ? `business ${verifier.businessId}'s own` : "the platform's"} PayPal app, not the one ` +
          `business ${invoice.businessId} takes PayPal with (SEC-W11OPK-1)`,
      );
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

  /**
   * `eventId`: the webhook_events id this delivery claimed (absent when PayPal sent none). `verifier`: the PayPal app
   * the delivery was verified with (handlePaypalWebhook); a direct call stands for the platform's, as before.
   *
   * PR210-PAYPAL-STORE-REFUND (D-138): a refund or reversal of a capture that settled a storefront order is recorded
   * through the provider refund door (createRefundWithPosting: the refund row on the order's checkout invoice, linked
   * to the capture's payment, deduped on the refund id, the settlement's payment posting reversed, never more than
   * what is left of it; then the invoice reconciled), and only when the delivery was verified with that order's own
   * store's app, as its capture was (maybeCompleteStorefrontOrder). An event verified with a store's own app (chosen
   * because it names that store's order) records refunds of that store's captures only, never an invoice's or another
   * store's. Anything else keeps its path, unchanged. A refusal is logged and acked with nothing recorded, as a
   * capture verified with the wrong app is.
   *
   * PR210 review repairs (D-121, D-138):
   *   - COR-PR210-1 / SEC-PR210-4: the refund also refunds the store order, in the same transaction
   *     (StoreOrderService.recordProviderRefundOnOrder: refundedTotal and a 'partially_refunded' step, or, once
   *     nothing received is left, the order REFUNDED and one store_order.refunded after commit). The order stayed
   *     CONFIRMED/PAID while its invoice was reopened.
   *   - COR-PR210-2: PayPal's notice of a refund the owner already recorded by hand (the D-121 door, which calls no
   *     provider) is paired with it and recorded once (paypalStoreRefundToRecord); it was recorded beside it.
   *   - SEC-PR210-1: the reads here throw (the delivery is answered 500 and PayPal redelivers it): a failed read of
   *     the capture's payment was taken as no capture and the genuine refund acked with nothing recorded.
   *   - SEC-PR210-3 / COR-PR210-4: a refund verified with a store's own app whose capture KeyFlow has not recorded yet
   *     is answered 409 with its claim given back, so PayPal redelivers it until the capture is recorded; it was
   *     acked with nothing recorded and its redeliveries acked as duplicates.
   *   - SEC-PR210-2 / COR-PR210-3: a store holding no PayPal setting of its own (its capture the platform's, settled
   *     before D-138) has its capture's refund verified with the platform's app (resolvePaypalBusinessCreds), and it
   *     is recorded for that verifier, as at the base.
   */
  private async processPaypalRefund(resource: any, eventId?: string, verifier: PaypalVerifier = PLATFORM_PAYPAL_VERIFIER): Promise<void> {
    const refundId: string | undefined = resource?.id;
    if (!refundId) {
      this.logger.warn('PayPal refund event missing refund id');
      return;
    }
    // SEC-PR210-1 (V1-15c): a failed read throws, so the claim is given back and PayPal redelivers the refund.
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: refundId },
      select: { id: true },
    });
    if (existing) return;

    // The original capture id is in supplementary_data.related_ids.capture_id, else the refund's 'up' link.
    const captureId = paypalRefundedCaptureId(resource);

    // The capture's payment, when the refund names one we recorded.
    const captured: RefundOriginal | null = captureId
      ? await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: captureId },
        select: { id: true, providerPaymentId: true, invoiceId: true, businessId: true, currency: true, amount: true },
      })
      : null;
    // PR210 (D-138): a store's capture is refunded only by the app it was taken with (its store's own; the platform's
    // for a store holding no PayPal setting of its own, SEC-PR210-2), and a store's app refunds nothing else.
    const store = captured ? await this.paypalStorefrontSettlementOf(captureId) : null;
    const storeApp: PaypalVerifier | null = store
      ? ownPaypalSettings(store.metaData)
        ? { businessId: store.businessId, store: true }
        : PLATFORM_PAYPAL_VERIFIER
      : null;
    if (!store && verifier.store && captureId && !captured) {
      // SEC-PR210-3 / COR-PR210-4: the store's own app verified it (it names the store's order), and its capture is not
      // recorded yet (its PAYMENT.CAPTURE.COMPLETED is still to come): 409, the claim given back, PayPal redelivers.
      throw new ConflictException(
        `PayPal refund ${refundId} returns capture ${captureId}, which is not recorded yet; it is recorded when PayPal redelivers it after the capture`,
      );
    }
    if ((store || verifier.store) && !(storeApp && storeApp.store === verifier.store && storeApp.businessId === verifier.businessId)) {
      this.logger.error(
        `PayPal refund ${refundId} of capture ${captureId ?? '<none>'} not recorded: ` +
          (store
            ? `it returns storefront order ${store.orderId}'s capture and the webhook was not verified with the PayPal app it was taken with`
            : `the webhook was verified with store ${verifier.businessId}'s own PayPal app and the capture is not that store's`) +
          ` (verified for ${verifier.businessId ?? 'the platform'}; D-138)`,
      );
      return;
    }
    if (store && !this.storeOrderService) {
      // COR-PR210-1: the refund of a store order is recorded with its order, or not at all (PayPal redelivers it).
      throw new Error(`PayPal refund ${refundId} of storefront order ${store.orderId} not recorded: the store orders are unavailable`);
    }
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
    // COR-PR210-1 / COR-PR210-2: a store capture's refund is paired with a refund recorded by hand, and refunds its
    // order with it, in the door's transaction.
    let flipped = false;
    const persisted = await (captured
      ? this.createRefundWithPosting(
          captured,
          refund,
          store ? (tx) => this.paypalStoreRefundToRecord(tx, captured, refundId, amount) : async () => amount,
          [],
          undefined,
          store && this.storeOrderService
            ? async (tx, recorded) => {
                ({ flipped } = await this.storeOrderService!.recordProviderRefundOnOrder(tx, {
                  orderId: store.orderId,
                  businessId: store.businessId,
                  invoiceId: captured.invoiceId,
                  provider: 'paypal',
                  providerRefundId: refundId,
                  amount: recorded,
                }));
              }
            : undefined,
        )
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
      // W5-REFUND-DOORS-KEEP (review SEC-CRP-1 / CR-REG-2; D-14, D-78): under
      // 'keep', as the manual refund door and processStripeRefund reconcile, so a
      // credited invoice the refund unsettles keeps its credited status and has
      // its paidAt re-derived by reconcileCreditedFromPayments, not refused 409.
      await this.invoiceWorkflow.reconcileFromPayments(target.invoiceId, { onIllegalTransition: 'keep' }).catch((e) => {
        this.logger.warn(`PayPal refund reconcile failed for invoice ${target.invoiceId}: ${e instanceof Error ? e.message : e}`);
      });
    }
    if (flipped && store) {
      // COR-PR210-1: the order this refund flipped REFUNDED is announced once, after commit (as refundOrder announces).
      await this.storeOrderService?.announceProviderRefund(store.orderId, store.businessId, target.invoiceId).catch((e) => {
        this.logger.warn(`store_order.refunded for order ${store.orderId} not sent: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  /**
   * PR210-PAYPAL-STORE-REFUND review (COR-PR210-2; owner ruling D-121): how much of a PayPal refund of a store
   * order's door payment (`original`) is not recorded yet, read under the invoice lock (createRefundWithPosting).
   *
   * The D-121 refund door (the owner's fulfil refund, CommerceService.markPaymentRefunded) calls no provider: it
   * records a refund the owner then makes in PayPal, and PayPal's notice of that refund arrives here. The V1-29c cap
   * (never more than is left of the payment) catches a duplicate full refund, not a partial one, so a refund of 30
   * recorded by hand and PayPal's notice of it were two refunds of 30. A notice whose amount is that of a refund
   * recorded by hand against this payment that no PayPal refund is paired with yet (the oldest first) is that refund:
   * the pairing is kept (one PAYPAL_REFUND_PAIRED_PROVIDER row under PayPal's refund id, committed with this
   * transaction) and nothing more is recorded. A notice already paired (its redelivery or resend) records nothing.
   * Any other notice is recorded in full (the door still caps it at what is left). A hand refund of the amount of a
   * PayPal refund already recorded is refused by the D-121 door in the other order (MarketplaceService
   * .partialRefundOf, and under this lock CommerceService.markPaymentRefunded).
   */
  private async paypalStoreRefundToRecord(
    tx: Prisma.TransactionClient,
    original: RefundOriginal,
    refundId: string,
    amount: number,
  ): Promise<number> {
    const paired = await tx.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider: PAYPAL_REFUND_PAIRED_PROVIDER, providerEventId: refundId } },
      select: { id: true },
    });
    if (paired) return 0;
    const cents = toCents(amount);
    const byHand = (
      await tx.payment.findMany({
        where: {
          businessId: original.businessId,
          invoiceId: original.invoiceId,
          status: 'REFUNDED',
          amount: { lt: 0 },
          reference: original.providerPaymentId,
          providerPaymentId: { startsWith: `${MANUAL_REFUND_ID_PREFIX}${original.id}_` },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, amount: true },
      })
    ).filter((r) => Math.abs(toCents(Number(r.amount))) === cents);
    if (byHand.length === 0) return amount;
    const taken = new Set(
      (
        await tx.webhookEvent.findMany({
          where: {
            provider: PAYPAL_REFUND_PAIRED_PROVIDER,
            businessId: original.businessId,
            eventType: { in: byHand.map((r) => paypalPairedWith(r.id)) },
          },
          select: { eventType: true },
        })
      ).map((w) => w.eventType),
    );
    const hand = byHand.find((r) => !taken.has(paypalPairedWith(r.id)));
    if (!hand) return amount;
    await tx.webhookEvent.create({
      data: {
        provider: PAYPAL_REFUND_PAIRED_PROVIDER,
        providerEventId: refundId,
        eventType: paypalPairedWith(hand.id),
        businessId: original.businessId,
      },
    });
    this.logger.log(
      `PayPal refund ${refundId} of ${fromCents(cents).toFixed(2)} ${original.currency} is the refund recorded by hand as ${hand.id}; ` +
        'not recorded again (D-121)',
    );
    return 0;
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
    credited?: number;
  }> {
    await this.assertBareIdInvoiceOpen(invoiceId);
    return this.invoicePaymentStatus(invoiceId);
  }

  /**
   * W5-CREDIT-AWARE-PAY (V1-44 review CR-V44-1 rest; D-13, D-75, D-78): the
   * credit-aware shareable statuses (PARTIALLY_CREDITED as well), and
   * `remaining` net of the invoice's own APPLIED credit notes, as the token
   * view and pay page state it (creditAwareBalance over appliedCreditsOf). A
   * credited invoice also carries `credited`, the notes netted, so the pay
   * page can show total, paid, credited and due adding up; an invoice with
   * nothing credited keeps the five keys. FULLY_CREDITED reads as absent.
   */
  private async invoicePaymentStatus(invoiceId: string): Promise<{
    status: string;
    paid: number;
    remaining: number;
    currency: string;
    lastPaymentAt: Date | null;
    credited?: number;
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
    if (!invoice || !isCreditAwareShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Invoice not found');
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
    const credited = await appliedCreditsOf(this.prisma.client as unknown as Prisma.TransactionClient, {
      id: invoiceId,
      businessId: invoice.businessId,
      status: invoice.status,
    });
    const balance = creditAwareBalance(balanceOfStoredRows(Number(invoice.total), own, invoice.currency), credited);
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
      ...(balance.credited > 0 ? { credited: balance.credited } : {}),
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
    // W5-CREDIT-AWARE-PAY (CR-V44-1; D-13): the remainder net of payments and APPLIED credit notes,
    // the amount handleWipayCallback verifies WiPay's proof against.
    const due = await this.checkoutAmountOf(invoice);

    const { apiUrl, environment, developerId, accountNumber } = PaymentsService.wipayCheckoutTarget(invoice.business.metaData);

    const contactName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : 'Customer';
    const contactEmail = invoice.contact?.email || 'customer@example.com';
    const contactPhone = invoice.contact?.phone || '0000000000';

    const params = new URLSearchParams();
    params.append('total', due.toFixed(2));
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

    // W5-CREDIT-AWARE-PAY review (SEC-CAP-1, CR-CAP-1; D-19): the amount asked is kept before WiPay is
    // called (a failed write starts no checkout), so the callback verifies against what was asked.
    await this.keepWipayRequestedAmount(invoice, due);

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
   * W5-CREDIT-AWARE-PAY review (SEC-CAP-1, SEC-CAP-2, CR-CAP-1; D-13, D-19):
   * keeps `amount`, the total createWipayCheckout is about to ask WiPay for on
   * the invoice, under WIPAY_REQUESTED_PROVIDER: one row per invoice and amount
   * in integer cents (a second checkout for the same amount adds none), with
   * the invoice's business. Written before WiPay is called and never removed,
   * so the callback of every checkout, and each redelivery of it, verifies
   * against the amount that checkout asked for whatever has happened to the
   * invoice since (wipayRequestedInvoiceTotals).
   */
  private async keepWipayRequestedAmount(invoice: { id: string; businessId: string }, amount: number): Promise<void> {
    await this.prisma.client.webhookEvent.createMany({
      data: [
        {
          provider: WIPAY_REQUESTED_PROVIDER,
          providerEventId: `${invoice.id}:${toCents(amount)}`,
          eventType: 'requested',
          businessId: invoice.businessId,
        },
      ],
      skipDuplicates: true,
    });
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
   * account the business's checkout pays into, the business's own
   * (metaData.wipayApiKey). W10-WIPAY-KEY (D-105; SEC-V33-2, PC-11b): never
   * the platform's (WIPAY_API_KEY). A business with no WiPay setting of its
   * own used to check out into the platform's account and be verified by the
   * platform key, so a success proved by that shared key could be booked
   * against any such tenant's invoice or storefront order of the same total
   * (WiPay's proof names no order_id). Now the key that proves a success
   * names the business whose payable it may settle, invoice and storefront
   * order alike. Review V05-SEC-3: a business with its own WiPay account but
   * no key of its own gets null. Nothing configured is null: the callback is
   * refused, never checked against a default (WiPay's sandbox key is public).
   */
  private static wipayApiKey(metaData: unknown): string | null {
    // Trial-N repair round 2 (G6RC-1) and D-105: the key of the business's own merchant (resolveWipayMerchant);
    // the gateway list, the checkouts and the connector read the same pair.
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
   * W10-PAYPAL-CURRENCY (owner ruling D-106, PC-08b): a PayPal order or capture
   * for an invoice or storefront order in a currency PayPal does not support
   * (paypal-currency.ts) is refused 400 PAYPAL_CURRENCY_UNSUPPORTED before
   * PayPal is called. The refusal names the currency, never the payable.
   */
  private static assertPaypalCurrency(currency: string | null | undefined, payable: 'invoice' | 'order'): void {
    if (paypalTakesCurrency(currency)) return;
    throw new BadRequestException(paypalCurrencyRefusal(currency, payable));
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
   *
   * W10-WIPAY-KEY (D-105): a business with no WiPay key of its own is refused
   * with code WIPAY_KEY_REQUIRED, every checkout alike (pay link, generic
   * invoice, event ticket and storefront checkouts, createStorePayment). It
   * used to check out into the platform's account (WIPAY_API_KEY,
   * WIPAY_ACCOUNT_NUMBER), which tenants no longer share.
   */
  private static wipayCheckoutTarget(metaData: unknown): {
    apiUrl: string;
    environment: 'live';
    developerId: string;
    accountNumber?: string;
  } {
    // Trial-N repair round 2 (G6RC-1): the key and the account are one merchant's, the business's own pair
    // (resolveWipayMerchant; D-105: never the platform's). A business with its own key and no account of its own is
    // refused here; it was sent to the platform's account, whose callback its own key then refused.
    const { apiKey, accountNumber } = resolveWipayMerchant(metaData);
    if (!apiKey) {
      throw new BadRequestException({
        code: WIPAY_KEY_REQUIRED,
        message: 'WiPay is not configured for this business: no WiPay API key to verify its payments',
      });
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

  /**
   * W5-CREDIT-AWARE-PAY (V1-44 review CR-V44-1 rest; D-13, D-78): the totals
   * this server asked WiPay for on an invoice, which a success callback's
   * keyed proof is verified against (the callback's own `total` is never
   * trusted, V1-05). First each amount a createWipayCheckout of this invoice
   * asked for (the remainder net of the payments received and the APPLIED
   * credit notes when it asked), as keepWipayRequestedAmount kept it under the
   * invoice's business. Then the whole total, which a checkout made before
   * W5-CREDIT-AWARE-PAY asked for: WiPay took that money, and the proof binds
   * it. A proof over any other amount is refused as before.
   *
   * Review SEC-CAP-1 / CR-CAP-1 / SEC-CAP-2: the remainder used to be worked
   * out again when the callback arrived, so a payment, a second paid checkout
   * or a credit note between the checkout and its callback (or the
   * redelivery of a recorded transaction) refused WiPay's genuine proof and
   * recorded nothing of the money WiPay took. Review SEC-CAP-3: WiPay's proof
   * does not cover order_id, and the invoice's current remainder bound a
   * proof to any invoice that happened to owe its amount; a kept amount binds
   * it to an invoice a checkout asked that amount for (as the total did on
   * the base).
   */
  private async wipayRequestedInvoiceTotals(invoice: { id: string; businessId: string; total: unknown }): Promise<number[]> {
    const total = Number(invoice.total);
    const prefix = `${invoice.id}:`;
    const kept = await this.prisma.client.webhookEvent.findMany({
      where: { provider: WIPAY_REQUESTED_PROVIDER, businessId: invoice.businessId, providerEventId: { startsWith: prefix } },
      select: { providerEventId: true },
    });
    const asked = new Set<number>();
    for (const { providerEventId } of kept) {
      // Exactly this invoice's rows (startsWith reads `_` and `%` in an id as LIKE wildcards).
      const cents = providerEventId.startsWith(prefix) ? providerEventId.slice(prefix.length) : '';
      if (/^[1-9]\d*$/.test(cents) && Number(cents) !== toCents(total)) asked.add(Number(cents));
    }
    return [...[...asked].sort((a, b) => a - b).map(fromCents), total];
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
   *
   * W10-WIPAY-KEY (D-105; SEC-V33-2, PC-11b): the key is the PAYABLE'S
   * business's own (wipayApiKey), for an invoice and a storefront order alike,
   * never the platform's. A storefront order of a business with no WiPay key
   * of its own is settled by no callback, and a success proved with one
   * business's key is refused for another business's payable. Review
   * SEC-W10WK-1: WiPay's public sandbox key ('123') saved as a business's key
   * is no key (resolveWipayMerchant). Review SEC-W10WK-2 / WK-CR-1: a success
   * the platform key proves for a business with no key of its own (a checkout
   * into the platform's account started before D-105) settles nothing and is
   * kept refused and told (refuseWipayPlatformAccount), not a bare 400.
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
    const apiKey = PaymentsService.wipayApiKey(invoice ? invoice.business.metaData : order!.business.metaData);
    // The total this server sent WiPay for this payable (createWipayCheckout, createStorePayment).
    // W5-CREDIT-AWARE-PAY (CR-V44-1; D-13): for an invoice that is an amount a checkout of it asked for,
    // as kept when it asked (review SEC-CAP-1..3, CR-CAP-1: wipayRequestedInvoiceTotals), or the whole
    // total a checkout made before it asked for.
    const requestedTotals = invoice ? await this.wipayRequestedInvoiceTotals(invoice) : [Number(order!.total)];
    const requestedTotal = requestedTotals.find((t) => PaymentsService.wipayProofVerifies(apiKey, transaction_id, t, hash));
    if (requestedTotal === undefined) {
      // W10-WIPAY-KEY review SEC-W10WK-2 / WK-CR-1 (the D-105 deploy transition): a business with no WiPay key of
      // its own checked out into the platform's WiPay account until D-105. A success the platform key proves for
      // such a business's payable is WiPay's word that money reached the platform's account: it settles nothing,
      // and is kept refused and told (refuseWipayPlatformAccount) instead of a 400 that records nothing.
      const platformKey = apiKey ? null : platformWipayKeyForTransition();
      const platformTotal = platformKey
        ? requestedTotals.find((t) => PaymentsService.wipayProofVerifies(platformKey, transaction_id, t, hash))
        : undefined;
      if (platformTotal !== undefined) {
        return this.refuseWipayPlatformAccount({
          transactionId: transaction_id!,
          payableType: invoice ? 'invoice' : 'order',
          payableId: order_id,
          businessId,
          currency: invoice ? invoice.currency : order!.currency,
          total: platformTotal,
        });
      }
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
   * W10-WIPAY-KEY review SEC-W10WK-2 / WK-CR-1 (owner ruling D-105; the D-76
   * pattern of refuseWipayCurrency): the deploy transition. Until D-105 a
   * business with no WiPay setting of its own checked out into the platform's
   * WiPay account, and its success callbacks were keyed with the platform's
   * key. A checkout started before D-105 and paid after it is therefore proved
   * with the platform key (WIPAY_API_KEY, platformWipayKeyForTransition) for a
   * payable of a business that now has no key verifying it: the money sits in
   * the platform's account, not the business's. Nothing is recorded as money:
   * no Payment row, no posting, the invoice and the storefront order as they
   * were. The transaction's webhook_events row is kept, marked
   * `refused:platform-account` with the payable's business, so every
   * redelivery is a no-op, and the business is told once (a 'payment.refused'
   * notification, reason 'platform-account'). The payer is answered
   * { success: false }. It used to be a 400 'Invalid WiPay callback
   * signature' with only a log line, so nothing in the system recorded the
   * money (the review's repro: PC-11 at 332eed5c).
   *
   * Reconciliation (operator): the platform's WiPay account holds each such
   * payment; webhook_events rows with provider 'wipay' and event_type
   * 'refused:platform-account' name the transaction and the business, and the
   * business's notification carries the payable and the amount. They are
   * passed on or refunded by hand from the platform's WiPay account.
   *
   * Only a proof the platform key verifies over an amount this server asked
   * for on that payable reaches here (the platform key is the secret behind
   * it), and only for a business with no WiPay key of its own: a business
   * with its own key is checked against its own key alone. WiPay's proof
   * names no order_id, so which keyless payable such a success is kept
   * against is the caller's choice; it is kept once, settles nothing and only
   * names where the money went.
   */
  private async refuseWipayPlatformAccount(input: {
    transactionId: string;
    payableType: 'invoice' | 'order';
    payableId: string;
    businessId: string;
    currency: string | null | undefined;
    total: number;
  }): Promise<{ success: boolean; invoiceId?: string; message: string }> {
    const currency = normalizeCurrency(input.currency) || PaymentsService.WIPAY_CURRENCY;
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'wipay',
      input.transactionId,
      WIPAY_PLATFORM_ACCOUNT_REFUSAL,
      input.businessId,
    );
    if (fresh) {
      this.logger.error(
        `WiPay transaction ${input.transactionId} for ${input.payableType} ${input.payableId} (business ${input.businessId}) ` +
          `not recorded: it was paid into the platform's WiPay account by a checkout started before D-105 (proved with ` +
          `WIPAY_API_KEY); reconcile it from the platform's WiPay account (webhook_events '${WIPAY_PLATFORM_ACCOUNT_REFUSAL}')`,
      );
      await this.prisma.client.notification
        .create({
          data: {
            businessId: input.businessId,
            type: 'payment.refused',
            title: 'WiPay payment not recorded',
            body:
              `WiPay reported a successful payment (transaction ${input.transactionId}) of ${currency} ` +
              `${Number(input.total).toFixed(2)} for ${input.payableType} ${input.payableId}. It was paid into the ` +
              "platform's WiPay account, not yours, by a checkout started before WiPay needed your own key, so it was " +
              'not recorded. Contact support to have it passed on to you or refunded, then record it by hand.',
            data: {
              provider: 'wipay',
              transactionId: input.transactionId,
              payableType: input.payableType,
              payableId: input.payableId,
              currency,
              total: input.total,
              reason: 'platform-account',
            },
          },
        })
        .catch((e: unknown) =>
          this.logger.error(
            `Could not notify business ${input.businessId} of WiPay platform-account transaction ${input.transactionId}: ${e instanceof Error ? e.message : e}`,
          ),
        );
    }
    return {
      success: false,
      invoiceId: input.payableId,
      message:
        `This payment was made into the platform's WiPay account, not the business's, so it was not recorded on this ` +
        `${input.payableType}; the business has been told`,
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
    // W5-CREDIT-AWARE-PAY (CR-V44-1; D-13): the remainder net of payments and APPLIED credit notes,
    // the amount capturePaypalOrder binds the order to.
    const due = await this.checkoutAmountOf(invoice);
    // W10-PAYPAL-CURRENCY (D-106, PC-08b): an invoice in a currency PayPal does not support is refused 400 before
    // PayPal is called (PayPal refused the order, and the payer got 500). After the payable gate and the amount, so
    // a settled invoice still answers 409 whatever the method.
    PaymentsService.assertPaypalCurrency(invoice.currency, 'invoice');

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
                // W10-PAYPAL-CURRENCY (D-106): one PayPal supports (assertPaypalCurrency above).
                currencyCode: normalizeCurrency(invoice.currency),
                value: due.toFixed(2),
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
      // W10-STORE-PAYMENT-INTENT (D-18): no provider session and no Payment row. The PENDING intent written here
      // put the MarketplaceOrder id in payments.invoice_id, a foreign key to invoices, so the write failed (the
      // generic checkout answered 500), and nothing would have settled or retired it. The order row carries its
      // payment state (paymentStatus PENDING, paymentMethod CASH / MANUAL), and the operator's offline completion
      // (StoreOrderService.completeOfflineOrder -> completeCheckout) writes the settled row through the door.
      return { status: 'PENDING_PAYMENT' };
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

      // W11-STORE-OWN-PAYMENT-KEYS (D-138): the session is made only with the store's own complete Stripe set (its
      // publishable key, secret key and webhook secret); the platform's STRIPE_SECRET_KEY never stands in, and a
      // store's key is never used beside a platform key. Same 400 as the checkout gate (StoreOrderService.createOrder)
      // and the storefront gateway list, which leave Stripe out for such a store.
      const own = storeStripeCredentials(business.metaData);
      if (!own) throw new BadRequestException(storefrontMethodNotOffered('STRIPE'));
      const secretKey = own.secretKey;

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
      // W1F-STORE-STRIPE-R0 (D-138, D-196): Stripe does not copy Checkout Session
      // metadata onto the PaymentIntent or Charge it creates. Setting
      // payment_intent_data.metadata carries the store order identity onto the
      // PaymentIntent and Charge so subsequent charge.refunded webhooks from the
      // store's own Stripe account verify with the store's secret and map to the order.
      body.append('payment_intent_data[metadata][orderId]', input.orderId);
      body.append('payment_intent_data[metadata][businessId]', business.id);
      body.append('payment_intent_data[metadata][type]', 'store_order');
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
      // W10-PAYPAL-CURRENCY (D-106, PC-08b): an order in a currency PayPal does not support is refused 400 before
      // PayPal is called (the storefront checkout and the generic storefront checkout both come here).
      PaymentsService.assertPaypalCurrency(input.currency, 'order');
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true, name: true },
      });
      // W11-STORE-OWN-PAYMENT-KEYS (D-138): the client is built only from the store's own complete PayPal pair; the
      // platform's PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET never stand in for it, and never fill in half of it.
      // W11-STORE-CHECKOUT-METHOD-GATE (F-21): a store with no PayPal is a 400 the payer can act on, as the storefront
      // checkout's refusal before the order is written (StoreOrderService.createOrder). It was a plain Error, so the
      // generic storefront checkout (createGenericCheckout) answered 500.
      const own = storePaypalCredentials(business?.metaData);
      const paypal = own ? this.getPaypalClient(own.clientId, own.clientSecret) : null;
      if (!paypal) throw new BadRequestException(storefrontMethodNotOffered('PAYPAL'));

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
                // in that currency (maybeCompleteStorefrontOrder). W10-PAYPAL-CURRENCY (D-106): one PayPal supports
                // (assertPaypalCurrency above).
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
    // W5-CREDIT-AWARE-PAY (CR-V44-1; D-13, D-78): the amount createPaypalOrder asked for (the remainder
    // net of payments and APPLIED credit notes, never invoice.total): the order must be for it, and it is
    // what is recorded.
    const due = await this.checkoutAmountOf(invoice);
    // W10-PAYPAL-CURRENCY (D-106, PC-08b): no PayPal order exists for an invoice in a currency PayPal does not
    // support (createPaypalOrder refuses it), so its capture is refused 400 before PayPal is called (no order read).
    PaymentsService.assertPaypalCurrency(invoice.currency, 'invoice');

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;

    const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
    if (!paypal) throw new Error('PayPal is not configured');

    // V1-46b review (SEC-V46B-3): before anything is captured or written.
    await this.assertPaypalOrderForInvoice(paypal.ordersController, orderId, { id: invoice.id, total: due, currency: invoice.currency });

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
            amount: due,
            currency: invoice.currency,
            status: 'FAILED',
            invoiceId,
            businessId: invoice.businessId,
          },
        });

        this.paypalConnector?.emitPaymentFailed(invoice.businessId, {
          amount: due,
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
            amount: due,
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
          if (attempt < PAYPAL_CAPTURE_RECORD_ATTEMPTS && isTransientPaymentAbort(e)) continue;
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
          amount: due,
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
          amount: due,
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
   *
   * W5-CREDIT-AWARE-PAY (CR-V44-1; D-13): `total` is the amount the order was
   * made for, the remainder createPaypalOrder asks for (checkoutAmountOf),
   * not invoice.total; an order for any other amount is refused here.
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
      // W10-STORE-PAYMENT-INTENT (D-18): a cash or manual gateway starts nothing online (createStorePayment writes
      // no intent for it); the order is paid offline and recorded by the business. A clean 400, never 500.
      if (result.status === 'PENDING_PAYMENT') {
        throw new BadRequestException(
          'A cash or manual payment starts no online checkout: this order is paid offline and the business records it',
        );
      }
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
