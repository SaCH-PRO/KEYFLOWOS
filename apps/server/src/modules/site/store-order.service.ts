import { Injectable, Inject, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PromoCodeService } from './promo-code.service';
import { CrmService } from '../crm/crm.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { InvoiceWorkflowService } from '../commerce/invoice-workflow.service';
import { InventoryRiskService } from '../commerce/inventory-risk.service';
import { RevenueAttributionService } from '../commerce/revenue-attribution.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';

/**
 * V1-33: what a storefront checkout's Idempotency-Key slot remembers, in the
 * existing idempotency_keys row (`response`): the order it created and, once
 * started, the payment session the customer was sent to. `paymentFailed` marks
 * a payment step that threw, so a retry may start it again. `claim` names the
 * one call that holds the payment step while the row is 'pending'.
 *
 * The row's status is the payment step's state (V1-33 review, V33-CR-1,
 * V33-CR-2, SEC-V33-3), in the table's own vocabulary:
 *   completed  final: `payment` is the session handed out (null for a method
 *              that needs none: CASH, MANUAL, none). A replay answers with it.
 *   pending    a call holds the payment step under `claim` and has not
 *              finished. A replay waits for it (CHECKOUT_IN_FLIGHT_WAIT_MS),
 *              then answers 409 with Retry-After; it is never answered as if
 *              the order had no session. A claim whose row has not moved for
 *              CHECKOUT_PAYMENT_LEASE_MS belongs to a call that died after the
 *              order committed, and the next retry takes it over.
 *   failed     the payment step threw, or the call failed after the order
 *              committed and before it: no session was handed out. The next
 *              retry claims the step and starts it.
 * Taking a claim is a compare-and-set on the row (status and updated_at as
 * read), so of two concurrent retries exactly one starts the session; the
 * other waits for it. Settling is bound to the claim.
 */
interface CheckoutRetryRecord {
  orderId?: string;
  payment?: unknown;
  paymentFailed?: boolean;
  claim?: string;
}

type StoreOrderWithItems = Prisma.MarketplaceOrderGetPayload<{ include: { items: true } }>;
type CheckoutStartPayment<P> = (order: StoreOrderWithItems) => Promise<P | null>;
type CheckoutAnswer<P> = { order: StoreOrderWithItems; payment: P | null; replayed: boolean };

/**
 * V1-33 review: how long a retry waits for the call that holds the payment
 * step before it is answered 409 (Retry-After), in ms.
 */
export const CHECKOUT_IN_FLIGHT_WAIT_MS = 2_500;
/** V1-33 review: how often a waiting retry reads the slot again, in ms. */
const CHECKOUT_IN_FLIGHT_POLL_MS = 100;
/**
 * V1-33 review: a payment-step claim older than this belongs to a call that
 * died after its order committed (a crash, a killed worker); the next retry
 * takes it over and starts the session. Far longer than a provider call.
 */
const CHECKOUT_PAYMENT_LEASE_MS = 60_000;
/** V1-33 review: the Retry-After (seconds) a retry that found the payment step in flight is given. */
export const CHECKOUT_IN_FLIGHT_RETRY_AFTER_S = 2;

/**
 * V1-33 review (V33-CR-1): the first call with this Idempotency-Key is still
 * starting the order's payment session. Retry shortly; the retry is answered
 * with the session. Never a final answer, and nothing was written.
 */
export class CheckoutInFlightException extends ConflictException {
  constructor() {
    super('This checkout is still being processed; retry shortly with the same Idempotency-Key');
  }
}

/** V1-33: storefront orders paid outside a provider, completed by an operator. */
const OFFLINE_PAYMENT_METHODS = new Set(['CASH', 'MANUAL']);

/**
 * V1-33 review (V33-CR-3): order statuses that are fulfilment progress past
 * CONFIRMED. Settling an order's payment never rewinds them: a cash-on-delivery
 * order is SHIPPED or DELIVERED before its cash is recorded.
 */
const FULFILMENT_PAST_CONFIRMED = new Set(['PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Prisma P2002: a unique index refused the write. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/** JSON with sorted object keys, so the same checkout always hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256 = (material: string) => createHash('sha256').update(material, 'utf8').digest('hex');

@Injectable()
export class StoreOrderService {
  private readonly logger = new Logger(StoreOrderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PromoCodeService) private readonly promoCodeService: PromoCodeService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(InventoryRiskService) private readonly inventoryRisk: InventoryRiskService,
    @Inject(RevenueAttributionService) private readonly revenueAttribution: RevenueAttributionService,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
  ) {}

  async validateCart(items: { productId: string; quantity: number }[], businessId: string) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.client.product.findMany({
      where: {
        id: { in: productIds },
        businessId,
        deletedAt: null,
        isActive: true,
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    const errors: string[] = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        errors.push(`Product ${item.productId} not found or unavailable`);
        continue;
      }
      if (item.quantity < 1) {
        errors.push(`Invalid quantity for ${product.name}`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }

    return {
      valid: true,
      products: items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.price,
          quantity: item.quantity,
          total: product.price * item.quantity,
          currency: product.currency,
        };
      }),
    };
  }

  async calculateOrderTotals(
    items: { productId: string; quantity: number }[],
    businessId: string,
    promoCode?: string,
    shippingZoneId?: string,
  ) {
    const validated = await this.validateCart(items, businessId);
    const subtotal = validated.products.reduce((sum, p) => sum + p.total, 0);
    const currency = validated.products[0]?.currency ?? 'TTD';

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { defaultTaxRate: true, currency: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    let discountAmount = 0;
    let freeShipping = false;
    let promoDetails: any = null;

    if (promoCode) {
      const promo = await this.promoCodeService.validate(businessId, promoCode, subtotal);
      const result = this.promoCodeService.apply(promo, subtotal);
      discountAmount = result.discount;
      freeShipping = result.freeShipping;
      promoDetails = {
        id: promo.id,
        code: promo.code,
        type: promo.type,
        value: promo.value,
        discount: discountAmount,
        freeShipping,
      };
    }

    let shippingFee = 0;
    let shippingDetails: any = null;
    if (shippingZoneId && !freeShipping) {
      const zone = await this.prisma.client.shippingZone.findFirst({
        where: { id: shippingZoneId, businessId, isActive: true },
      });
      if (zone) {
        shippingFee = zone.baseFee;
        if (zone.freeAbove !== null && subtotal >= zone.freeAbove) {
          shippingFee = 0;
        }
        shippingDetails = {
          zoneId: zone.id,
          zoneName: zone.name,
          fee: shippingFee,
          estimatedDays: zone.estimatedDays,
          carrier: zone.carrier,
        };
      }
    }

    const taxRate = business.defaultTaxRate ?? 0;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = Math.round(((taxableAmount * taxRate) / 100) * 100) / 100;
    const total = Math.round((subtotal - discountAmount + taxAmount + shippingFee) * 100) / 100;

    return {
      items: validated.products,
      subtotal,
      discountAmount,
      taxRate,
      taxAmount,
      shippingFee,
      total,
      currency,
      promo: promoDetails,
      shipping: shippingDetails,
    };
  }

  async createOrder(input: {
    businessId: string;
    cartItems: { productId: string; quantity: number }[];
    customerInfo: { name: string; email?: string; phone?: string; country?: string };
    promoCode?: string;
    shippingInfo?: {
      zoneId?: string;
      address?: Record<string, any>;
    };
    paymentMethod?: string;
    notes?: string;
    storefrontSlug?: string | null;
    visitorId?: string | null;
    referralCode?: string | null;
  }, retryClaim?: { slot: string; requestHash: string; claim: string | null }) {
    const totals = await this.calculateOrderTotals(
      input.cartItems,
      input.businessId,
      input.promoCode,
      input.shippingInfo?.zoneId,
    );

    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const orderData = {
      businessId: input.businessId,
      orderNumber,
      status: 'PENDING',
      type: 'STOREFRONT',
      customerName: input.customerInfo.name,
      customerEmail: input.customerInfo.email ?? null,
      customerPhone: input.customerInfo.phone ?? null,
      customerCountry: input.customerInfo.country ?? null,
      shippingAddress: input.shippingInfo?.address ?? undefined,
      subtotal: totals.subtotal,
      shippingFee: totals.shippingFee,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      total: totals.total,
      currency: totals.currency,
      paymentMethod: input.paymentMethod ?? null,
      paymentStatus: input.paymentMethod === 'CASH' ? 'PENDING' : 'UNPAID',
      promoCodeId: totals.promo?.id ?? null,
      notes: input.notes ?? null,
      metadata: {
        taxRate: totals.taxRate,
        promoCode: totals.promo?.code ?? null,
        shipping: totals.shipping,
        referralCode: input.referralCode ?? null,
        visitorId: input.visitorId ?? null,
        storefrontSlug: input.storefrontSlug ?? null,
      },
      items: {
        create: totals.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          sku: item.sku ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          currency: item.currency,
        })),
      },
    };

    // V1-33: with a retry slot, the order and its idempotency_keys row commit
    // together. A concurrent checkout holding the same slot blocks on the
    // unique index and then fails with P2002, rolling its order back; the
    // caller (createOrderOnce) answers it with the order that won. Nothing
    // below (promo usage, events, CRM) runs for the loser. A checkout that
    // needs a payment session commits its row 'pending' under this call's
    // claim (the payment step is this call's); one that needs none commits it
    // 'completed' with no session (V1-33 review, V33-CR-1).
    const order = retryClaim
      ? await this.prisma.client.$transaction(async (tx) => {
          const created = await tx.marketplaceOrder.create({ data: orderData, include: { items: true } });
          const record: CheckoutRetryRecord = retryClaim.claim
            ? { orderId: created.id, claim: retryClaim.claim }
            : { orderId: created.id, payment: null };
          await tx.idempotencyKey.create({
            data: {
              businessId: input.businessId,
              idempotencyKey: retryClaim.slot,
              status: retryClaim.claim ? 'pending' : 'completed',
              requestHash: retryClaim.requestHash,
              response: record as Prisma.InputJsonValue,
            },
          });
          return created;
        })
      : await this.prisma.client.marketplaceOrder.create({ data: orderData, include: { items: true } });

    if (totals.promo?.id) {
      await this.promoCodeService.incrementUsage(totals.promo.id);
    }

    this.events.emit('store_order.created', { order, businessId: input.businessId });

    try {
      const sourceDetail = input.storefrontSlug
        ? `storefront:${input.storefrontSlug}`
        : `order:${order.orderNumber}`;
      const nameParts = (input.customerInfo.name ?? '').trim().split(/\s+/);
      // When we have a visitorId, route through upsertStorefrontContact so
      // first-touch attribution (firstSource / utmMedium / utmCampaign /
      // firstReferrer / firstLandingPath) is enriched onto the Contact.
      const contact = input.visitorId
        ? await this.publicEvents.upsertStorefrontContact({
            businessId: input.businessId,
            sourceDetail,
            referralCode: input.referralCode ?? null,
            visitorId: input.visitorId,
            identity: {
              firstName: nameParts[0] ?? null,
              lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
              email: input.customerInfo.email ?? null,
              phone: input.customerInfo.phone ?? null,
            },
          })
        : await this.crm.findOrCreateContact(input.businessId, {
            firstName: nameParts[0] ?? null,
            lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            email: input.customerInfo.email ?? null,
            phone: input.customerInfo.phone ?? null,
            source: 'storefront',
            sourceDetail,
            ...(input.referralCode ? { custom: { referralCode: input.referralCode } } : {}),
          });
      if (contact?.id) {
        if (input.visitorId) {
          await this.publicEvents.backstitchVisitor({
            businessId: input.businessId,
            visitorId: input.visitorId,
            contactId: contact.id,
            sourceDetail,
          }).catch(() => undefined);
        }
        const baseData = {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: order.total,
          currency: order.currency,
          itemCount: order.items.length,
          referralCode: input.referralCode ?? null,
        };
        await this.publicEvents.logStorefrontEvent({
          businessId: input.businessId,
          contactId: contact.id,
          type: 'checkout.started',
          sourceDetail,
          data: baseData,
        });
        await this.publicEvents.logStorefrontEvent({
          businessId: input.businessId,
          contactId: contact.id,
          type: 'store_order.created',
          sourceDetail,
          data: baseData,
        });
        if (order.paymentStatus === 'PAID') {
          await this.publicEvents.logStorefrontEvent({
            businessId: input.businessId,
            contactId: contact.id,
            type: 'payment.completed',
            sourceDetail,
            data: baseData,
          });
        }
      }
    } catch (err: any) {
      this.logger.warn(`[store-order] CRM hook failed: ${(err as Error).message}`);
    }

    return order;
  }

  /**
   * V1-33 (M37, SSP-BP-03): a storefront checkout that carries an
   * Idempotency-Key. The first call creates the order (createOrder, its
   * idempotency_keys row committed with it) and starts the payment session;
   * every later call with the same key on the same storefront is answered
   * with that order and that session, and writes nothing. The key is scoped
   * to the business and the slug, so the same key on another storefront is
   * another order. The same key for a different checkout (cart, customer,
   * promo, shipping, payment method or notes) is a conflict, not a replay.
   *
   * The slot is the existing idempotency_keys table (unique on business and
   * key; no migration). The client's key is stored hashed, so its length is
   * bounded whatever the client sends.
   *
   * A replay never calls the payment provider again, except when no session
   * was handed out: the first call's payment step threw, the call failed after
   * its order committed, or it died holding the step past its lease. Then the
   * one retry that claims the step starts the session (V1-33 review).
   *
   * `startPayment` is null when the checkout's method needs no session (CASH,
   * MANUAL, none): its slot is final as soon as the order commits. Otherwise a
   * retry that finds the first call still starting the session waits for it
   * and is answered with it; past CHECKOUT_IN_FLIGHT_WAIT_MS it is answered
   * CheckoutInFlightException (409), never with an order and no session as if
   * that were final (V33-CR-1, SEC-V33-3).
   */
  async createOrderOnce<P>(
    input: Parameters<StoreOrderService['createOrder']>[0],
    idempotencyKey: string,
    startPayment: CheckoutStartPayment<P> | null,
  ): Promise<CheckoutAnswer<P>> {
    const slot = `storefront_checkout:${input.storefrontSlug ?? ''}:${sha256(idempotencyKey)}`;
    const requestHash = sha256(
      canonicalJson({
        items: input.cartItems,
        customer: input.customerInfo,
        promoCode: input.promoCode ?? null,
        shipping: input.shippingInfo ?? null,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes ?? null,
      }),
    );

    const prior = await this.checkoutReplay(input.businessId, slot, requestHash, startPayment);
    if (prior) return prior;

    // This call's claim on the payment step, committed with the order (none
    // when the method needs no session).
    const claim = startPayment ? randomUUID() : null;
    let order: StoreOrderWithItems;
    try {
      order = await this.createOrder(input, { slot, requestHash, claim });
    } catch (err) {
      // V1-33 review (V33-CR-1): the order may have committed before the
      // failure (promo usage, a throwing store_order.created listener). Give
      // the payment step up, so the next retry starts it now rather than after
      // the lease. A no-op when nothing committed or the row is another call's.
      if (claim) await this.releaseCheckoutClaim(input.businessId, slot, claim);
      // A concurrent checkout with the same key committed first: answer with its order.
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.checkoutReplay(input.businessId, slot, requestHash, startPayment);
      if (winner) return winner;
      throw err;
    }
    const payment = startPayment && claim
      ? await this.startCheckoutPayment(input.businessId, slot, claim, order, startPayment)
      : null;
    return { order, payment, replayed: false };
  }

  /**
   * V1-33: the order (and payment session) a used checkout key answers with,
   * or null when the key is new. While another call holds the payment step,
   * this waits for its session (V1-33 review, V33-CR-1); when no session was
   * handed out, this call claims the step and starts it, and of concurrent
   * retries only the one whose claim lands does (V33-CR-2).
   */
  private async checkoutReplay<P>(
    businessId: string,
    slot: string,
    requestHash: string,
    startPayment: CheckoutStartPayment<P> | null,
  ): Promise<CheckoutAnswer<P> | null> {
    const deadline = Date.now() + CHECKOUT_IN_FLIGHT_WAIT_MS;
    for (;;) {
      const row = await this.prisma.client.idempotencyKey.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: slot } },
      });
      if (!row) return null;
      if (row.requestHash !== requestHash) {
        throw new ConflictException('This Idempotency-Key was already used for a different checkout; use a new key for a new order');
      }
      const record = (row.response ?? null) as unknown as CheckoutRetryRecord | null;
      const inFlight = row.status === 'pending' && Date.now() - row.updatedAt.getTime() < CHECKOUT_PAYMENT_LEASE_MS;
      if (!inFlight) {
        const order = record?.orderId
          ? await this.prisma.client.marketplaceOrder.findFirst({ where: { id: record.orderId, businessId }, include: { items: true } })
          : null;
        if (!order) {
          throw new ConflictException('This Idempotency-Key was already used and its order no longer exists; use a new key');
        }
        if (row.status === 'completed') {
          return { order, payment: (record?.payment ?? null) as P | null, replayed: true };
        }
        // No session was handed out: the step threw (failed), or the call that
        // held it died after its order committed (pending, lease expired).
        const settled = order.paymentStatus === 'PAID' || order.status === 'CANCELLED' || order.status === 'REFUNDED';
        if (settled || !startPayment) return { order, payment: null, replayed: true };
        const claim = await this.claimCheckoutPayment(businessId, slot, row, order.id);
        if (claim) {
          const payment = await this.startCheckoutPayment(businessId, slot, claim, order, startPayment);
          return { order, payment, replayed: true };
        }
        // Another retry claimed the step first: wait for its session below.
      }

      // Another call is starting the payment session. Answer with it once it
      // exists; never with the order alone, as if no session were coming.
      if (Date.now() >= deadline) throw new CheckoutInFlightException();
      await sleep(CHECKOUT_IN_FLIGHT_POLL_MS);
    }
  }

  /**
   * V1-33 review (V33-CR-2): take the payment step of a slot whose session was
   * never handed out. A compare-and-set on the row as it was read (status and
   * updated_at), so of concurrent retries exactly one gets the claim.
   */
  private async claimCheckoutPayment(
    businessId: string,
    slot: string,
    row: { status: string; updatedAt: Date },
    orderId: string,
  ): Promise<string | null> {
    const claim = randomUUID();
    const { count } = await this.prisma.client.idempotencyKey.updateMany({
      where: { businessId, idempotencyKey: slot, status: row.status, updatedAt: row.updatedAt },
      data: {
        status: 'pending',
        response: { orderId, claim } satisfies CheckoutRetryRecord,
        updatedAt: new Date(),
      },
    });
    return count === 1 ? claim : null;
  }

  /** V1-33: start the order's payment session under this call's claim and settle the slot with it (or with its failure). */
  private async startCheckoutPayment<P>(
    businessId: string,
    slot: string,
    claim: string,
    order: StoreOrderWithItems,
    startPayment: CheckoutStartPayment<P>,
  ): Promise<P | null> {
    let payment: P | null;
    try {
      payment = (await startPayment(order)) ?? null;
    } catch (err) {
      await this.settleCheckoutClaim(businessId, slot, claim, 'failed', { orderId: order.id, paymentFailed: true });
      throw err;
    }
    await this.settleCheckoutClaim(businessId, slot, claim, 'completed', { orderId: order.id, payment });
    return payment;
  }

  /**
   * V1-33 review: settle the payment step this call holds. Bound to the claim:
   * a claim another retry took over (this call outlived its lease) is left as
   * that retry wrote it.
   */
  private async settleCheckoutClaim(
    businessId: string,
    slot: string,
    claim: string,
    status: 'completed' | 'failed',
    record: CheckoutRetryRecord,
  ): Promise<void> {
    try {
      const { count } = await this.prisma.client.idempotencyKey.updateMany({
        where: { businessId, idempotencyKey: slot, status: 'pending', response: { path: ['claim'], equals: claim } },
        data: { status, response: record as Prisma.InputJsonValue, updatedAt: new Date() },
      });
      if (count !== 1) {
        this.logger.warn(`[store-order] a checkout's payment step was taken over before it settled (${status}); the stored outcome is the other call's`);
      }
    } catch (err) {
      this.logger.warn(`[store-order] could not record the checkout's payment step on its key: ${(err as Error).message}`);
    }
  }

  /** V1-33 review: give up this call's claim when it failed after its order committed (failed: no session handed out). */
  private async releaseCheckoutClaim(businessId: string, slot: string, claim: string): Promise<void> {
    try {
      const row = await this.prisma.client.idempotencyKey.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: slot } },
      });
      const record = (row?.response ?? null) as unknown as CheckoutRetryRecord | null;
      if (!row || row.status !== 'pending' || record?.claim !== claim || !record.orderId) return;
      await this.settleCheckoutClaim(businessId, slot, claim, 'failed', { orderId: record.orderId, paymentFailed: true });
    } catch (err) {
      this.logger.warn(`[store-order] could not release the checkout's payment step: ${(err as Error).message}`);
    }
  }

  async getOrder(orderId: string, businessId?: string) {
    const where: any = { id: orderId };
    if (businessId) where.businessId = businessId;

    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where,
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getPublicOrder(orderId: string, email: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, customerEmail: email },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      total: order.total,
      currency: order.currency,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      })),
      createdAt: order.createdAt,
    };
  }

  async updateOrderStatus(orderId: string, status: string, businessId: string) {
    const existing = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!existing) throw new NotFoundException('Order not found');

    const order = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: { status },
      include: { items: true },
    });

    // CONFIRMED is the merchant's fulfilment status, not money (V1-18, CF-45).
    // `store_order.paid` is emitted only by completeCheckout, after the
    // invoice, the payment and its posting commit, and it carries that
    // invoiceId. Mapping CONFIRMED to it told every paid listener that an
    // UNPAID order had been paid.
    const eventMap: Record<string, string> = {
      CONFIRMED: 'store_order.confirmed',
      SHIPPED: 'store_order.shipped',
      DELIVERED: 'store_order.delivered',
      CANCELLED: 'store_order.cancelled',
    };

    const eventName = eventMap[status];
    if (eventName) {
      this.events.emit(eventName, { order, businessId: order.businessId });
    }

    return order;
  }

  async updatePaymentStatus(orderId: string, paymentStatus: string, paymentRef?: string) {
    if (paymentStatus === 'PAID') {
      // Route through completeCheckout so Invoice + Payment + stock decrement
      // + RevenueAttribution all land in one transaction.
      return this.completeCheckout({
        orderId,
        paymentRef,
        provider: 'unknown',
        method: 'unknown',
      });
    }

    const order = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        ...(paymentRef && { paymentRef }),
      },
      include: { items: true },
    });
    return order;
  }

  /**
   * V1-33 (M37, V18-T3): an operator records the cash (or manual payment) a
   * storefront customer paid outside any provider. A CASH order is created
   * PENDING and nothing else moves it: updatePaymentStatus('PAID') is reached
   * only from provider callbacks, and CONFIRMED is fulfilment, not money
   * (V1-18). This goes through the same door a provider payment does,
   * completeCheckout: one PAID invoice, one SUCCESSFUL payment of the order
   * total recorded by the operator, its payment_recorded posting, the stock
   * decrement and the revenue attribution, in one transaction, then one
   * store_order.paid carrying the invoiceId.
   *
   * Only STOREFRONT orders whose method needs no provider (CASH, MANUAL) are
   * completed here; a provider-method order is settled by its provider. A
   * cancelled or refunded order is refused. An order already PAID is answered
   * as it stands and nothing is written, so a double click (or two operators
   * at once: the second transaction fails on the order's invoice-number
   * unique index and rolls back) records one payment.
   *
   * The payment reference is server-random (V1-33 review, SEC-V33-1), as
   * markInvoicePaid's is (ST-PL04-1/2). providerPaymentId is unique across
   * every tenant and the public WiPay failure callback writes one of the
   * caller's choosing, so a reference derived from the order id could be
   * planted ahead of this call and refuse it for good. Nothing keys a replay
   * on it; the invoice number serializes concurrent completions.
   *
   * An order whose fulfilment is already past CONFIRMED (a cash-on-delivery
   * order SHIPPED or DELIVERED before its cash is recorded) keeps that status
   * (completeCheckout, V33-CR-3).
   */
  async completeOfflineOrder(orderId: string, businessId: string, actorId: string | null) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { id: true, type: true, status: true, paymentStatus: true, paymentMethod: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentStatus === 'PAID') return this.getOrder(order.id, businessId);

    const method = (order.paymentMethod ?? '').toUpperCase();
    if (order.type !== 'STOREFRONT' || !OFFLINE_PAYMENT_METHODS.has(method)) {
      throw new BadRequestException(
        'Only a storefront order paid in cash or manually is completed offline; this order is settled by its payment provider',
      );
    }
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') {
      throw new ConflictException(`This order is ${order.status.toLowerCase()} and cannot be completed`);
    }

    try {
      return await this.completeCheckout({
        orderId: order.id,
        paymentRef: `storefront_offline_${order.id}_${randomBytes(16).toString('hex')}`,
        provider: method.toLowerCase(),
        method: method.toLowerCase(),
        actorId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const settled = await this.prisma.client.marketplaceOrder.findFirst({
          where: { id: order.id, businessId },
          include: { items: true },
        });
        if (settled?.paymentStatus === 'PAID') return settled;
      }
      throw err;
    }
  }

  /**
   * Atomically finalize a successful storefront checkout.
   *
   * Creates, in a single transaction:
   *   1. Invoice + InvoiceItems (status PAID, going through workflow service)
   *   2. Payment (status SUCCESSFUL) linked to invoice + business
   *   3. InventoryStock decrement + StockMovement audit row per item
   *   4. RevenueAttribution row (source='storefront', revenueType='ORDER')
   *   5. MarketplaceOrder updated to status CONFIRMED (a fulfilment status
   *      already past it is kept), paymentStatus PAID
   *
   * Failure of any step rolls back the whole thing — we never want a paid
   * order with no invoice or stock that didn't decrement. After the
   * transaction commits we do best-effort side-effects (event emission,
   * inventory-risk evaluation, CRM timeline write); failures there are
   * logged but never fail the checkout.
   */
  async completeCheckout(input: {
    orderId: string;
    paymentRef?: string;
    provider?: string;
    method?: string;
    paidAmount?: number;
    /** V1-33: the operator who recorded an offline payment (Payment.recordedBy, the posting's createdById). */
    actorId?: string | null;
  }) {
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id: input.orderId },
      include: { items: true, business: { select: { defaultTaxRate: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.paymentStatus === 'PAID') {
      // Idempotent: if we already completed this order, return as-is.
      this.logger.debug(`[store-order] completeCheckout no-op for already-PAID order ${order.id}`);
      return this.prisma.client.marketplaceOrder.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
    }

    // Resolve customer contact OUTSIDE the tx so CRM dedup logic
    // (which has its own internal logic) doesn't expand the tx footprint.
    let contactId: string | null = null;
    let referralCode: string | null = null;
    try {
      const meta = (order.metadata as Record<string, unknown> | null) ?? {};
      referralCode = typeof meta.referralCode === 'string' ? meta.referralCode : null;
      const nameParts = (order.customerName ?? '').trim().split(/\s+/);
      const contact = await this.crm.findOrCreateContact(order.businessId, {
        firstName: nameParts[0] ?? null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        email: order.customerEmail,
        phone: order.customerPhone,
        source: 'storefront',
        sourceDetail: `order:${order.orderNumber}`,
        ...(referralCode ? { custom: { referralCode } } : {}),
      });
      contactId = contact?.id ?? null;
    } catch (err: any) {
      this.logger.warn(`[store-order] CRM resolve failed for order ${order.id}: ${(err as Error).message}`);
    }
    if (!contactId) {
      // Invoice requires a contact. Surface this clearly rather than
      // silently dropping the row.
      throw new BadRequestException(
        'Cannot finalize checkout: unable to resolve a contact for this order. Provide a customer email or phone.',
      );
    }

    // Pick a default warehouse for stock decrement (first active per business).
    const defaultWarehouse = await this.prisma.client.warehouse.findFirst({
      where: { businessId: order.businessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const amount = input.paidAmount ?? order.total;
    const provider = input.provider ?? order.paymentMethod?.toLowerCase() ?? 'manual';
    const method = (input.method ?? order.paymentMethod ?? 'manual').toLowerCase();
    const paymentRef = input.paymentRef ?? order.paymentRef ?? `${provider}_${order.id}_${Date.now()}`;
    const invoiceNumber = `INV-${order.orderNumber}`;

    // Pre-load inventory mode so stock invariants can be enforced inside the
    // tx. Untracked / virtual products skip the decrement explicitly, not
    // silently.
    //
    // NULL IS NOT "TRACKED", AND TWO SERVICES USED TO DISAGREE ABOUT THAT.
    // `Product.inventoryMode` is `String?` with no default and nothing on the
    // create path sets it, so it is NULL for every product whose owner never
    // opened inventory settings. This file resolved that to 'tracked' and then
    // failed the whole checkout — invoice and payment rolled back — with
    // "no active warehouse configured for tracked products".
    //
    // inventory-risk.service.ts reads the same column as
    // `inventoryMode === 'tracked' || stocks.length > 0`, so a product this
    // file refused to sell was one that file considered untracked. Same field,
    // opposite meaning, and the merchant sees only that checkout is broken.
    //
    // Resolved the risk service's way, because it is the one that matches what
    // a merchant actually did: a product counts as tracked if they SAID so, or
    // if stock is being kept for it. Someone who never configured inventory is
    // not opted into an inventory invariant, and refusing their sales protects
    // a number nobody is maintaining.
    //
    // The protection itself is unchanged. A product that IS tracked still
    // cannot oversell, still needs a warehouse and a stock row, and still
    // rolls the checkout back — see the loop below.
    const productIds = order.items.map((i) => i.productId);
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        inventoryMode: true,
        outOfStockBehavior: true,
        name: true,
        _count: { select: { inventoryStocks: true } },
      },
    });
    const productMode = new Map(
      products.map((p) => [
        p.id,
        resolveInventoryMode(p.inventoryMode, p._count.inventoryStocks > 0),
      ]),
    );
    const productOOSBehavior = new Map(
      products.map((p) => [p.id, p.outOfStockBehavior ?? 'hide']),
    );

    // Buffer for invoice events emitted by InvoiceWorkflowService.transition
    // calls inside the transaction. We flush AFTER the tx commits so
    // listeners (e.g. InvoiceReceiptListener) never act on uncommitted
    // state if a later tx step rolls back.
    const pendingEvents: Array<{ name: string; payload: unknown }> = [];

    const result = await this.prisma.client.$transaction(async (tx) => {
      // 1. Invoice — created DRAFT then immediately walked DRAFT→SENT→PAID
      // through the canonical InvoiceWorkflowService inside this same
      // transaction so the row is never observable in DRAFT outside the
      // commit boundary. Events are buffered for post-commit emission.
      const now = new Date();
      const invoice = await tx.invoice.create({
        data: {
          businessId: order.businessId,
          contactId: contactId!,
          invoiceNumber,
          status: 'DRAFT',
          subtotal: order.subtotal,
          taxAmount: order.taxAmount,
          discountAmount: order.discountAmount ?? 0,
          total: order.total,
          currency: order.currency,
          issueDate: now,
          notes: `Storefront order ${order.orderNumber}`,
          items: {
            create: order.items.map((item) => ({
              description: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          },
        },
      });
      const txClient = tx as unknown as Prisma.TransactionClient;
      await this.invoiceWorkflow.transition(invoice.id, 'SENT', { sentAt: now, tx: txClient, eventBuffer: pendingEvents });
      await this.invoiceWorkflow.transition(invoice.id, 'PAID', { paidAt: now, tx: txClient, eventBuffer: pendingEvents });

      // 2. Payment row + ledger posting (FIN2). Posting runs inside the
      //    same transaction so revenue / AR / deposit entries commit
      //    atomically with the payment row.
      const payment = await tx.payment.create({
        data: {
          provider,
          providerPaymentId: paymentRef,
          amount,
          currency: order.currency,
          status: 'SUCCESSFUL',
          method,
          invoiceId: invoice.id,
          businessId: order.businessId,
          recordedBy: input.actorId ?? null,
        },
      });
      await this.revenuePosting.onPaymentRecorded(payment.id, { tx: txClient, createdById: input.actorId ?? null });

      // 3. Stock decrement + movement rows. Tracked products MUST have a
      //    warehouse + stock row with sufficient quantity; otherwise we
      //    fail the entire checkout (rolling back invoice + payment) so
      //    we never sell stock we can't fulfill. Untracked / virtual
      //    products are explicitly skipped per their inventoryMode.
      const decrementedProductIds: string[] = [];
      const trackedItems = order.items.filter((i) => {
        const mode = productMode.get(i.productId) ?? 'untracked';
        return mode === 'tracked';
      });
      if (trackedItems.length > 0 && !defaultWarehouse) {
        throw new BadRequestException(
          'Cannot finalize checkout: no active warehouse configured for tracked products.',
        );
      }
      for (const item of order.items) {
        const mode = productMode.get(item.productId) ?? 'untracked';
        if (mode !== 'tracked') {
          this.logger.debug(`[store-order] skipping stock decrement for ${mode} product ${item.productId}`);
          continue;
        }
        const stock = await tx.inventoryStock.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: defaultWarehouse!.id,
            },
          },
        });
        if (!stock) {
          throw new BadRequestException(
            `Cannot finalize checkout: tracked product ${item.productId} has no stock row in the default warehouse.`,
          );
        }
        if (stock.quantity < item.quantity) {
          // Merchant explicitly opted into backorder for this product —
          // allow the sale through and let stock dip negative so the
          // owed-units delta is still tracked + visible in inventory.
          const allowBackorder = productOOSBehavior.get(item.productId) === 'allow_backorder';
          if (!allowBackorder) {
            throw new BadRequestException(
              `Cannot finalize checkout: insufficient stock for product ${item.productId} (have ${stock.quantity}, need ${item.quantity}).`,
            );
          }
        }
        await tx.inventoryStock.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity - item.quantity },
        });
        await tx.stockMovement.create({
          data: {
            businessId: order.businessId,
            warehouseId: defaultWarehouse!.id,
            productId: item.productId,
            quantityChange: -item.quantity,
            type: 'sale',
            referenceId: order.orderNumber,
          },
        });
        decrementedProductIds.push(item.productId);
      }

      // 4. Revenue attribution — hard requirement; failures roll back.
      await this.revenueAttribution.record(
        {
          businessId: order.businessId,
          source: 'storefront',
          sourceDetail: `order:${order.orderNumber}`,
          revenueType: 'ORDER',
          revenueId: order.id,
          amount: order.total,
          currency: order.currency,
          contactId,
          referralCode,
        },
        tx as unknown as Prisma.TransactionClient,
      );

      // 5. Order — paid + confirmed. V1-33 review (V33-CR-3): fulfilment
      //    already past CONFIRMED (a cash-on-delivery order shipped or
      //    delivered before its cash was recorded) is kept, not rewound.
      const updatedOrder = await tx.marketplaceOrder.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: FULFILMENT_PAST_CONFIRMED.has(order.status) ? order.status : 'CONFIRMED',
          paymentRef,
        },
        include: { items: true },
      });

      return { updatedOrder, invoice, decrementedProductIds };
    });

    // Tx committed — now safe to flush buffered invoice events and
    // dispatch the storefront-funnel timeline + CRM hooks.
    for (const evt of pendingEvents) {
      this.events.emit(evt.name, evt.payload);
    }

    try {
      const baseData = {
        orderId: result.updatedOrder.id,
        orderNumber: result.updatedOrder.orderNumber,
        invoiceId: result.invoice.id,
        total: result.updatedOrder.total,
        currency: result.updatedOrder.currency,
        paymentRef,
      };
      await this.publicEvents.logStorefrontEvent({
        businessId: order.businessId,
        contactId: contactId!,
        type: 'payment.completed',
        sourceDetail: `order:${order.orderNumber}`,
        data: baseData,
      });
    } catch (err: any) {
      this.logger.warn(`[store-order] post-checkout timeline write failed: ${(err as Error).message}`);
    }

    this.events.emit('store_order.paid', { order: result.updatedOrder, businessId: order.businessId, invoiceId: result.invoice.id });

    // Re-evaluate inventory risk for affected products & emit signals so
    // inventory-risk listeners (action queue, alerts) can react.
    for (const productId of result.decrementedProductIds) {
      try {
        const risk = await this.inventoryRisk.evaluateProduct(productId, order.businessId);
        if (!risk) continue;
        for (const signal of risk.signals) {
          if (signal.type === 'out_of_stock' || signal.type === 'low_stock') {
            this.events.emit(`inventory.${signal.type}`, {
              businessId: order.businessId,
              productId,
              productName: risk.productName,
              signal,
              triggeredBy: { type: 'order', id: order.id, orderNumber: order.orderNumber },
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`[store-order] inventory-risk eval failed for ${productId}: ${(err as Error).message}`);
      }
    }

    return result.updatedOrder;
  }

  async listOrders(
    businessId: string,
    filters?: {
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 20, 1), 100);

    const where: any = { businessId };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters?.search) {
      where.OR = [
        { customerName: { contains: filters.search, mode: 'insensitive' } },
        { customerEmail: { contains: filters.search, mode: 'insensitive' } },
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.client.marketplaceOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.marketplaceOrder.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOrderSummary(businessId: string) {
    const [totalOrders, pendingOrders, confirmedOrders, shippedOrders, completedOrders, cancelledOrders, revenueResult] =
      await Promise.all([
        this.prisma.client.marketplaceOrder.count({ where: { businessId } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'PENDING' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CONFIRMED' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'SHIPPED' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: { in: ['COMPLETED', 'DELIVERED'] } } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CANCELLED' } }),
        this.prisma.client.marketplaceOrder.findMany({
          where: { businessId, paymentStatus: 'PAID' },
          select: { total: true },
        }),
      ]);

    const totalRevenue = revenueResult.reduce((sum, o) => sum + o.total, 0);

    return {
      totalOrders,
      pendingOrders,
      confirmedOrders,
      shippedOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
    };
  }

  async refundOrder(orderId: string, businessId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === 'REFUNDED') {
      throw new BadRequestException('Order has already been refunded');
    }

    const updated = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        status: 'REFUNDED',
        paymentStatus: 'REFUNDED',
      },
      include: { items: true },
    });

    this.events.emit('store_order.refunded', { order: updated, businessId, refundAmount: updated.total });

    return updated;
  }
}
