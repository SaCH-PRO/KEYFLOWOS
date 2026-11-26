import { Injectable, Inject, Optional, forwardRef, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { ownStockRows, resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { lockStockRowsInOrder } from '../../core/inventory/stock-lock-order';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PromoCodeService } from './promo-code.service';
import { CrmService } from '../crm/crm.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { InvoiceWorkflowService, balanceOfStoredRows } from '../commerce/invoice-workflow.service';
import { fromCents, toCents } from '../commerce/money';
import { InventoryRiskService } from '../commerce/inventory-risk.service';
import { RevenueAttributionService } from '../commerce/revenue-attribution.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { CommerceService } from '../commerce/commerce.service';
import { isSystemActor } from '../../core/auth/system-actor';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import {
  WIPAY_CURRENCY,
  WIPAY_KEY_REQUIRED,
  resolveWipayMerchant,
  wipayMerchantComplete,
  wipayTakesCurrency,
} from '../../core/connectors/implementations/wipay-merchant';
import { paypalCurrencyRefusal, paypalTakesCurrency } from '../payments/paypal-currency';
import { CommerceIntegrationService } from '../marketplace/commerce-integration.service';
import {
  ORDER_STATUS_CHANGED_DURING_CANCEL,
  ORDER_STATUS_CHANGED_DURING_EDIT,
  ROUTING_CLAIM_TX_OPTIONS,
  assertStatusEditTransition,
  releaseOrderFulfilmentForCancel,
  statusEditMayCancel,
  statusEditMayTransition,
} from '../marketplace/fulfillment-routing.service';
import { appendOrderTimeline, recordOrderRefundedTotal } from '../marketplace/order-metadata';
import {
  normalizeStorefrontMethod,
  storePaypalCredentials,
  storeStripeCredentials,
  storefrontMethodNotOffered,
} from '../payments/storefront-checkout-methods';

export interface QuickSaleInvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  currency: string;
  contactId: string;
}

export interface QuickSalePaymentSummary {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  providerPaymentId: string | null;
}

export interface QuickSaleCommittedResult {
  order: any;
  invoice: QuickSaleInvoiceSummary;
  payment: QuickSalePaymentSummary;
  receiptToken: string;
}

export interface QuickSaleCheckoutInput {
  businessId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  contactId: string | null;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  notes: string | null;
  items: Array<{
    productId: string;
    name: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
    currency: string;
  }>;
  receiptToken: string;
  idempotency: { slot: string; requestHash: string } | null;
  onCommitted: (result: QuickSaleCommittedResult, replayed?: boolean) => void;
}

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
 *
 * Trial-N review (G6PUB-SEC-2): compared upper-cased, because the marketplace
 * fulfil route writes its own lowercase vocabulary ('shipped', 'delivered',
 * 'picking_packing', ...) on the same storefront orders (fulfillment-routing
 * ORDER_STATUSES past 'paid').
 */
const FULFILMENT_PAST_CONFIRMED = new Set([
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'AWAITING_FULFILLMENT',
  'ROUTED',
  'SUPPLIER_ORDERED',
  'PICKING_PACKING',
]);

/**
 * G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-2): the statuses PATCH
 * /site/businesses/:businessId/orders/:orderId/status may write, the site's
 * fulfilment vocabulary (the store order list's own statuses, plus COMPLETED).
 * Payment states are not statuses here: an order is paid only through
 * completeCheckout and refunded only through refundOrder. The route copied any
 * string, so 'paid' opened the marketplace refund and 'REFUNDED' on a PAID order
 * made the D-14 refund route answer "already refunded" with the books still on.
 */
export const SITE_FULFILMENT_STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

/**
 * G6PUB-R3-STORE-ORDER-DOORS review (CR-1): how many times completeCheckout
 * resolves the order's contact before it answers that none could be resolved
 * (a concurrent creation of the same contact refuses the first attempt).
 */
const CONTACT_RESOLVE_ATTEMPTS = 3;

/**
 * W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-1): a tracked line of a provider
 * settlement whose (product, default warehouse) pair another business's stock
 * row holds, so no stock was taken for it (completeCheckout, providerSettlement).
 */
interface StockHeldElsewhereLine {
  productId: string;
  name: string;
  quantity: number;
}

/** The notification a business is told of such lines with (tellStockHeldElsewhere). */
export const STOCK_NOT_DECREMENTED_NOTIFICATION = 'store_order.stock_not_decremented';

const PROVIDER_LABEL: Record<string, string> = { wipay: 'WiPay', stripe: 'Stripe', paypal: 'PayPal' };

/**
 * Trial-N review (G6PUB-SEC-2): an order nothing more is collected for:
 * cancelled or refunded, in the site's uppercase vocabulary or the marketplace
 * fulfil route's lowercase one, or with its payment refunded. Offline
 * completion refuses it, a checkout retry starts no session for it and the
 * generic storefront checkout sends it to no provider.
 */
export function isClosedStorefrontOrder(order: { status?: string | null; paymentStatus?: string | null }): boolean {
  const status = (order.status ?? '').toUpperCase();
  return status === 'CANCELLED' || status === 'REFUNDED' || (order.paymentStatus ?? '').toUpperCase() === 'REFUNDED';
}

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

/**
 * Trial-N review (G6PUB-SEC-1, D-46): why `actorId` may not record (or refund)
 * a payment of the business, or null when it may: a member of the business
 * whose revenue level is write or above, read as ModuleScopeGuard reads it (an
 * explicit scope map, else the role's defaults), with no SUPER_ADMIN bypass.
 */
async function paymentRecorderRefusal(
  prisma: PrismaService,
  businessId: string,
  actorId: string | null | undefined,
): Promise<string | null> {
  if (!actorId || isSystemActor(actorId)) return 'A member must record this payment';
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: actorId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return 'Not a member of this business';
  const scopes: Record<string, string> =
    membership.permissionScopes && typeof membership.permissionScopes === 'object'
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(membership.role);
  const level = scopes.revenue || 'none';
  if (rankOf(level) < LEVEL_RANK.write) return `Insufficient permissions: revenue requires write access (you have ${level})`;
  return null;
}

/**
 * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126): whether `actorId` is a member
 * of the business with revenue write (D-46, no SUPER_ADMIN bypass), the rule
 * StoreOrderService.assertMemberMayRecordPayments enforces, as a boolean for a
 * caller that must not refuse: an order's shipped marking stays open to every
 * member (D-112) and only the member with revenue write books its shipping fee
 * (CommerceIntegrationService.bookShippingExpenseOnce).
 */
export async function memberMayRecordPayments(
  prisma: PrismaService,
  businessId: string,
  actorId: string | null | undefined,
): Promise<boolean> {
  return (await paymentRecorderRefusal(prisma, businessId, actorId)) === null;
}

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
    /**
     * W11-CHECKOUT-COGS-TX (owner ruling D-127): the COGS leg (onProductSold) completeCheckout posts inside its
     * transaction for every order it marks paid. FinanceModule exports it; SiteModule imports FinanceModule.
     */
    @Inject(ExpensePostingService) private readonly expensePosting: ExpensePostingService,
    /** The D-14 refund door (refundOrder). Optional only so the unit harnesses that never refund need not build it. */
    @Optional() @Inject(forwardRef(() => CommerceService)) private readonly commerce?: CommerceService,
    /**
     * W11-SHIPPING-EXPENSE-ONCE (D-126): resolves CommerceIntegrationService (MarketplaceModule, which SiteModule does
     * not import) when a SHIPPED marking books the order's shipping fee. W11A-SEAM-REPAIR: ModuleRef is a Nest
     * framework provider every module resolves, so it is injected without @Optional() (it is never undefined under
     * Nest, and phantom-injection.spec.ts holds every @Optional() injection to a registered provider). The parameter
     * stays optional in TypeScript and last only so the positional unit constructions still build; without it
     * nothing is booked and a warning is logged.
     */
    @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,
  ) {}

  async validateCart(items: { productId: string; quantity: number }[], businessId: string) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const productIds = items.map((i) => i.productId);
    const [products, listings] = await Promise.all([
      this.prisma.client.product.findMany({
        where: {
          id: { in: productIds },
          businessId,
          deletedAt: null,
          isActive: true,
        },
      }),
      this.prisma.client.service.findMany({
        where: {
          businessId,
          deletedAt: null,
          sourceProductId: { in: productIds },
        },
        select: { sourceProductId: true },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const listedProductIds = new Set(
      listings
        .map((l) => l.sourceProductId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const errors: string[] = [];
    const unlistedProducts = new Map<string, string>();

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        errors.push(`Product ${item.productId} not found or unavailable`);
        continue;
      }
      if (!listedProductIds.has(product.id)) {
        if (!unlistedProducts.has(product.id)) {
          unlistedProducts.set(product.id, product.name);
        }
        continue;
      }
      if (item.quantity < 1) {
        errors.push(`Invalid quantity for ${product.name}`);
      }
    }

    // SWP-STORE-LISTING-SERVER (BUG-055, ruling storelisting): refuse checkout
    // of any active product that is not listed in this business's store before
    // any order, retry slot, or promo usage is written.
    if (unlistedProducts.size > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_IN_STORE',
        message: [...unlistedProducts.values()].map((name) => `Product ${name} is not listed in this store`).join('; '),
        productIds: [...unlistedProducts.keys()],
      });
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

    // W11-STORE-CHECKOUT-METHOD-GATE (F-21): the method compared trimmed and
    // upper-cased (normalizeStorefrontMethod): ' PAYPAL' on a TTD cart passed
    // the checks below untrimmed and was refused by createStorePayment only
    // after the order, its retry slot and its promo use had committed. Unknown
    // methods are not refused here: only the public checkout (SiteController.
    // publicCheckout) starts a provider session and refuses them, and direct
    // callers place orders under their own method names.
    const method = normalizeStorefrontMethod(input.paymentMethod);

    // D-69 (trial-N recheck G6PUB-RC1-1): WiPay takes TTD only. A WiPay
    // checkout of an order in another currency is refused here, before the
    // order is written and its promo use counted. createStorePayment refuses
    // it too, but only after the order had committed, so every such checkout
    // left an UNPAID order behind.
    if (method === 'WIPAY' && !wipayTakesCurrency(totals.currency)) {
      throw new BadRequestException(
        `WiPay takes ${WIPAY_CURRENCY} only: this order is in ${(totals.currency ?? '').toUpperCase() || 'no currency'}`,
      );
    }

    // W10-PAYPAL-CURRENCY review (SEC-W10PPC-1; owner ruling D-106): a PayPal
    // checkout of an order in a currency PayPal does not support (TTD, JMD,
    // BBD, GYD, XCD, ...) is refused here, before the order is written and its
    // promo use counted, as WiPay's above. createStorePayment refuses it too,
    // but only after the order had committed, so every attempt (and every
    // retry) left another UNPAID order and used up a limited promo code. Same
    // 400 body as createStorePayment's (paypalCurrencyRefusal).
    if (method === 'PAYPAL' && !paypalTakesCurrency(totals.currency)) {
      throw new BadRequestException(paypalCurrencyRefusal(totals.currency, 'order'));
    }

    if (method === 'WIPAY' || method === 'PAYPAL' || method === 'STRIPE') {
      // The business settings, read once for the provider the checkout names.
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true },
      });
      const meta = business?.metaData;
      if (method === 'WIPAY') {
        // G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-4): nor for a business
        // with no WiPay merchant pair (the one rule the gateway list and the
        // checkouts read, resolveWipayMerchant). createStorePayment refused it
        // too, but only after the order and its promo use had committed, so every
        // attempt (and every retry) left another UNPAID order.
        // W10-WIPAY-KEY (D-105): the pair is the business's own; a store with no
        // WiPay key of its own (it used to check out into the platform's account)
        // is refused with code WIPAY_KEY_REQUIRED, before anything is written.
        const merchant = resolveWipayMerchant(meta);
        if (!wipayMerchantComplete(merchant)) {
          const message = 'WiPay is not configured for this business: choose another payment method';
          throw new BadRequestException(merchant.apiKey ? message : { code: WIPAY_KEY_REQUIRED, message });
        }
      }
      // W11-STORE-CHECKOUT-METHOD-GATE (F-21; D-106: the payer sees which
      // methods can pay it): PayPal and Stripe only where the storefront's
      // gateway list offers them (getStorefrontGateways reads the same
      // storePaypalCredentials / storeStripeCredentials). A store with no PayPal
      // was a 500 from createStorePayment, and one with no Stripe a 400, both
      // after the order and its promo use had committed.
      // W11-STORE-OWN-PAYMENT-KEYS (owner ruling D-138): the store's own
      // complete set only (PayPal: client id and secret; Stripe: publishable
      // key, secret key and webhook secret, in its settings). The platform's
      // PayPal / Stripe env never stands in for a store, and a store's key is
      // never completed by a platform key: refused here before anything is
      // written, as createStorePayment refuses it.
      if (method === 'PAYPAL' && !storePaypalCredentials(meta)) {
        throw new BadRequestException(storefrontMethodNotOffered('PAYPAL'));
      }
      if (method === 'STRIPE' && !storeStripeCredentials(meta)) {
        throw new BadRequestException(storefrontMethodNotOffered('STRIPE'));
      }
    }

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

    // SWP-STORE-OVERSELL (BUG-017): aggregate requested quantities per product
    // across cart lines and identify tracked non-backorder products so oversell
    // is refused BEFORE any order, idempotency slot, promo increment, or event
    // is written. Uses ownStockRows(businessId) + active own warehouses only.
    const requestedByProduct = new Map<string, { qty: number; name: string }>();
    for (const item of totals.items) {
      const existing = requestedByProduct.get(item.productId);
      if (existing) {
        existing.qty += item.quantity;
      } else {
        requestedByProduct.set(item.productId, { qty: item.quantity, name: item.name });
      }
    }
    const cartProductIds = [...requestedByProduct.keys()];
    const cartProducts = cartProductIds.length > 0
      ? await this.prisma.client.product.findMany({
          where: { id: { in: cartProductIds }, businessId: input.businessId },
          select: {
            id: true,
            name: true,
            inventoryMode: true,
            outOfStockBehavior: true,
            _count: { select: { inventoryStocks: { where: ownStockRows(input.businessId) } } },
          },
        })
      : [];
    const productNameById = new Map(cartProducts.map((p) => [p.id, p.name]));
    const trackedCheckedIds = cartProducts
      .filter(
        (p) =>
          resolveInventoryMode(p.inventoryMode, p._count.inventoryStocks > 0) === 'tracked' &&
          (p.outOfStockBehavior ?? 'hide') !== 'allow_backorder',
      )
      .map((p) => p.id);

    // V1-33: with a retry slot, the order and its idempotency_keys row commit
    // together. A concurrent checkout holding the same slot blocks on the
    // unique index and then fails with P2002, rolling its order back; the
    // caller (createOrderOnce) answers it with the order that won. Nothing
    // below (promo usage, events, CRM) runs for the loser. A checkout that
    // needs a payment session commits its row 'pending' under this call's
    // claim (the payment step is this call's); one that needs none commits it
    // 'completed' with no session (V1-33 review, V33-CR-1).
    const order =
      retryClaim || trackedCheckedIds.length > 0
        ? await this.prisma.client.$transaction(async (tx) => {
            if (trackedCheckedIds.length > 0) {
              await lockStockRowsInOrder(tx, input.businessId, trackedCheckedIds);
              const stockRows = await tx.inventoryStock.findMany({
                where: {
                  businessId: input.businessId,
                  productId: { in: trackedCheckedIds },
                  warehouse: { businessId: input.businessId, isActive: true },
                },
                select: { productId: true, quantity: true, reserved: true },
              });
              const availableByProduct = new Map<string, number>();
              for (const row of stockRows) {
                const avail = Math.max(0, row.quantity - row.reserved);
                availableByProduct.set(row.productId, (availableByProduct.get(row.productId) ?? 0) + avail);
              }
              for (const productId of trackedCheckedIds) {
                const available = availableByProduct.get(productId) ?? 0;
                const reqEntry = requestedByProduct.get(productId)!;
                if (available < reqEntry.qty) {
                  const productName = productNameById.get(productId) || reqEntry.name || 'Product';
                  throw new ConflictException({
                    code: 'INSUFFICIENT_STOCK',
                    message: `Cannot place order: insufficient stock for product "${productName}" (only ${available} available, requested ${reqEntry.qty}).`,
                    available,
                    requested: reqEntry.qty,
                  });
                }
              }
            }
            const created = await tx.marketplaceOrder.create({ data: orderData, include: { items: true } });
            if (retryClaim) {
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
            }
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
        const settled = order.paymentStatus === 'PAID' || isClosedStorefrontOrder(order);
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

  /**
   * PATCH /site/businesses/:businessId/orders/:orderId/status: a fulfilment
   * status only (SITE_FULFILMENT_STATUSES, any case, stored upper-case).
   * G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-2): a payment state or any
   * other string is refused (400) before anything is read or written.
   * W11-ORDER-PAID-VALUES (owner ruling D-117): so is a body carrying
   * paymentStatus, paymentMethod or paymentRef (`body`, the route's whole
   * body): they were answered 200 and silently dropped. A status-only call is
   * unchanged.
   * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; F-24): `actorId` is the
   * authenticated member (SiteController). A SHIPPED it writes books the
   * order's shipping fee once per order, and only for a member with revenue
   * write (CommerceIntegrationService.bookShippingExpenseOnce); the status
   * change itself stays open to every member and never fails on the booking.
   * W11-ORDER-CANCEL-RELEASE (F-35; owner ruling D-136): CANCELLED releases
   * the order's fulfilment under its routing claim, as the marketplace cancel
   * does (400 with nothing written for an order that can no longer be
   * cancelled: SHIPPED, DELIVERED, COMPLETED, CANCELLED, REFUNDED). Every
   * other status is written as before.
   */
  async updateOrderStatus(
    orderId: string,
    status: string,
    businessId: string,
    body?: Record<string, unknown> | null,
    actorId: string | null = null,
  ) {
    const paymentFields = ['paymentStatus', 'paymentMethod', 'paymentRef'].filter((field) => body?.[field] !== undefined);
    if (paymentFields.length > 0) {
      throw new BadRequestException(
        `An order's payment fields (${paymentFields.join(', ')}) are not written here: this route moves its fulfilment status only. ` +
          'It is paid through its checkout (its payment provider, or POST .../orders/:orderId/complete-offline) and refunded with ' +
          'POST .../orders/:orderId/refund',
      );
    }
    const normalized = typeof status === 'string' ? status.trim().toUpperCase() : '';
    if (!SITE_FULFILMENT_STATUSES.has(normalized)) {
      throw new BadRequestException(
        `An order's status here is one of ${[...SITE_FULFILMENT_STATUSES].join(', ')}. It is paid through its checkout ` +
          '(its payment provider, or POST .../orders/:orderId/complete-offline) and refunded with POST .../orders/:orderId/refund',
      );
    }
    const existing = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!existing) throw new NotFoundException('Order not found');
    if ((existing.type ?? '').toUpperCase() === 'QUICK_SALE') {
      throw new BadRequestException(
        'A quick sale is already completed at checkout and cannot change fulfilment status; refund it through the refund door instead',
      );
    }

    let order;
    if (normalized === 'CANCELLED') {
      order = await this.cancelReleasingFulfilment(businessId, orderId);
    } else {
      // W1F-ORDER-TRANSITIONS (D-198 `orderstatus`, SEC-W11OCR-2): refuse backwards moves from SHIPPED, DELIVERED, or
      // COMPLETED, and refuse reopening terminal CANCELLED/REFUNDED orders.
      assertStatusEditTransition(existing.status, normalized);
      // W1F-ORDER-TRANSITIONS (D-198, reverse race): compare-and-set on the status read above so a concurrent cancel,
      // delivery, or ship is never overwritten by a stale status edit. Idempotent concurrent same-status PATCHes
      // retry CAS against the committed same status when still permitted.
      let { count } = await this.prisma.client.marketplaceOrder.updateMany({
        where: { id: orderId, businessId, status: existing.status },
        data: { status: normalized },
      });
      if (count === 0) {
        const now = await this.prisma.client.marketplaceOrder.findFirst({
          where: { id: orderId, businessId },
          select: { status: true },
        });
        if (now && now.status === normalized && statusEditMayTransition(now.status, normalized)) {
          const retry = await this.prisma.client.marketplaceOrder.updateMany({
            where: { id: orderId, businessId, status: now.status },
            data: { status: normalized },
          });
          count = retry.count;
        }
        if (count === 0) throw new ConflictException(ORDER_STATUS_CHANGED_DURING_EDIT);
      }
      order = await this.prisma.client.marketplaceOrder.findFirstOrThrow({
        where: { id: orderId, businessId },
        include: { items: true },
      });
    }

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

    const eventName = eventMap[normalized];
    if (eventName) {
      this.events.emit(eventName, { order, businessId: order.businessId });
    }

    // W11-SHIPPING-EXPENSE-ONCE (D-126): after the SHIPPED write has committed; store_order.shipped books nothing.
    if (normalized === 'SHIPPED') await this.bookShippingExpenseOnce(businessId, orderId, actorId);

    return order;
  }

  /**
   * W11-ORDER-CANCEL-RELEASE (F-35; owner ruling D-136): updateOrderStatus's CANCELLED, in one transaction under the
   * order's routing claim, as the marketplace status cancel (MarketplaceService.updateOrderStatus) and the fulfil
   * 'cancel' action: releaseOrderFulfilmentForCancel waits for a router to commit, re-reads the status (400 with nothing
   * written for an order that can no longer be cancelled; canTransitionOrder reads this vocabulary through
   * LEGACY_STATUS_MAP), gives back what the order's LOCAL_STOCK routes reserved and cancels its routes; then the
   * cancelled step and CANCELLED. It wrote CANCELLED alone: a routed order's reservations were held for good, an order
   * being routed got its routes after the cancel, and a SHIPPED order was cancelled. It releases reservations only (what
   * a paid checkout decremented is not restocked) and records no refund.
   *
   * Review repairs: the status is read in any case, padded or not (statusEditMayCancel, OCR-COR-1): an open order the
   * marketplace route stored 'processing' was refused 400 by canTransitionOrder alone, and no route could cancel it.
   * CANCELLED is written compare-and-set on the status read under the claim (OCR-COR-2, D-136): a SHIPPED takes no
   * claim, so one that committed while the release waited for its stock rows had CANCELLED written over it by id; 409
   * now, the transaction rolled back (the release with it), nothing written and no event.
   */
  private cancelReleasingFulfilment(businessId: string, orderId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const readStatus = await releaseOrderFulfilmentForCancel(tx, businessId, orderId, statusEditMayCancel);
      await appendOrderTimeline(tx, businessId, orderId, [
        { status: 'cancelled', timestamp: new Date().toISOString(), note: 'Order cancelled' },
      ]);
      const { count } = await tx.marketplaceOrder.updateMany({
        where: { id: orderId, businessId, status: readStatus },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) throw new ConflictException(ORDER_STATUS_CHANGED_DURING_CANCEL);
      return tx.marketplaceOrder.findFirstOrThrow({ where: { id: orderId, businessId }, include: { items: true } });
    }, ROUTING_CLAIM_TX_OPTIONS);
  }

  /**
   * W11-SHIPPING-EXPENSE-ONCE (D-126): CommerceIntegrationService.bookShippingExpenseOnce for a SHIPPED this service
   * wrote, resolved from the application. A failure is logged and never fails the status change.
   */
  private async bookShippingExpenseOnce(businessId: string, orderId: string, actorId: string | null): Promise<void> {
    if (!this.moduleRef) {
      this.logger.warn(`Order ${orderId} shipped: no ModuleRef to reach CommerceIntegrationService, so no shipping Expense is booked`);
      return;
    }
    try {
      await this.moduleRef.get(CommerceIntegrationService, { strict: false }).bookShippingExpenseOnce(businessId, orderId, actorId);
    } catch (err) {
      this.logger.error(`Shipping Expense for order ${orderId} not booked: ${(err as Error).message}`);
    }
  }

  /**
   * @param provider The provider that settled the order (wipay, stripe,
   *   paypal). Trial-N review (G6ML-3): it is the payment's provider and
   *   method, so the posting's deposit leg is PAYMENT_PROCESSOR; recorded as
   *   'unknown' it went to CASH and the row did not say who took the money.
   */
  async updatePaymentStatus(orderId: string, paymentStatus: string, paymentRef?: string, provider?: string) {
    if (paymentStatus === 'PAID') {
      // Route through completeCheckout so Invoice + Payment + stock decrement
      // + RevenueAttribution all land in one transaction.
      // W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-1): a provider settlement (the
      // WiPay callback, the Stripe and PayPal webhooks): the provider has taken
      // the money (completeCheckout, providerSettlement).
      return this.completeCheckout({
        orderId,
        paymentRef,
        provider: provider ?? 'unknown',
        method: provider ?? 'unknown',
        providerSettlement: true,
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
   *
   * Trial-N review:
   *   - G6PUB-SEC-1 (D-46): the recorder must be a member of the business
   *     with revenue write, as for every other recorded payment
   *     (PaymentEvidenceService.confirmPendingPayment). The route's guards let
   *     a platform SUPER_ADMIN through; a SUPER_ADMIN who is not a member is
   *     refused (403) before anything is read or written.
   *   - G6PUB-SEC-2: a cancelled or refunded order is refused in either
   *     status vocabulary (isClosedStorefrontOrder); the marketplace fulfil
   *     route writes lowercase 'cancelled'.
   *   - SEC-V33-5: the refusal is checked again inside the transaction, on the
   *     order row locked FOR UPDATE, so an order cancelled between this read
   *     and the transaction is refused (409) and nothing is written.
   */
  async completeOfflineOrder(orderId: string, businessId: string, actorId: string | null) {
    await this.assertMemberMayRecordPayments(businessId, actorId);
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
    if (isClosedStorefrontOrder(order)) {
      throw new ConflictException(`This order is ${order.status.toLowerCase()} and cannot be completed`);
    }

    try {
      return await this.completeCheckout({
        orderId: order.id,
        paymentRef: `storefront_offline_${order.id}_${randomBytes(16).toString('hex')}`,
        provider: method.toLowerCase(),
        method: method.toLowerCase(),
        actorId,
        refuseClosedOrder: true,
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
   * Trial-N review (G6PUB-SEC-1, D-46): ModuleScopeGuard's rule for revenue >=
   * write, for the member who records an offline payment, with no SUPER_ADMIN
   * bypass (PaymentEvidenceService.assertMemberMayRecordPayments). 403 otherwise.
   * G6PUB-R3-STORE-ORDER-DOORS: public, so the marketplace doors that record or
   * refund an order's money (MarketplaceService.createOrder paid on creation,
   * D-77) check the same rule before they write anything.
   */
  async assertMemberMayRecordPayments(businessId: string, actorId: string | null | undefined): Promise<void> {
    // W11-SHIPPING-EXPENSE-ONCE (D-126): the rule is paymentRecorderRefusal, shared with memberMayRecordPayments.
    const refusal = await paymentRecorderRefusal(this.prisma, businessId, actorId);
    if (refusal !== null) throw new ForbiddenException(refusal);
  }

  /**
   * Atomically finalize a successful storefront checkout.
   *
   * Creates, in a single transaction:
   *   1. Invoice + InvoiceItems (status PAID, going through workflow service)
   *   2. Payment (status SUCCESSFUL) linked to invoice + business
   *   3. InventoryStock decrement + StockMovement audit row per item
   *   4. RevenueAttribution row (source='storefront', revenueType='ORDER')
   *   4b. COGS posting (Dr COGS / Cr Inventory, MarketplaceOrder:<id>:cogs)
   *      for the order's product lines (W11-CHECKOUT-COGS-TX, D-127)
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
    /**
     * Trial-N review (SEC-V33-5): the offline completion only. Inside the
     * transaction the order row is locked FOR UPDATE and a cancelled or
     * refunded order is refused (409), so a cancel that landed after the
     * caller's guard read is not revived. A provider settlement does not set
     * it: the provider has taken the money and it is recorded.
     */
    refuseClosedOrder?: boolean;
    /**
     * G6PUB-R3-STORE-ORDER-DOORS (D-77): the status a paid order not yet past
     * CONFIRMED takes, in its own vocabulary. A STANDARD (marketplace) order
     * created paid is 'paid', the state its fulfilment transitions start from;
     * the storefront's is CONFIRMED (the default).
     */
    paidStatus?: string;
    /**
     * D-77: a STANDARD order's stock moves through its fulfilment routes
     * (reserved when routed, decremented when shipped), so the paid door does
     * not decrement it again here.
     */
    stockMovesOnFulfilment?: boolean;
    /**
     * W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-1, CPS-COR-2; D-137, the D-76
     * pattern): a provider settlement (updatePaymentStatus: the WiPay
     * callback, the Stripe and PayPal webhooks). The provider has taken the
     * customer's money, so a tracked line whose (product, default warehouse)
     * pair is held by another business's stock row (a planted row D-137 leaves
     * for an operator) does not refuse it: the money is recorded, no stock is
     * taken for that line (the other business's row is never written), and the
     * business is told ('store_order.stock_not_decremented'). Refused, the
     * settlement recorded nothing and the callback released its claim, so every
     * redelivery was refused the same way. Every other stock refusal stands,
     * and the offline completion (no provider holds the money) is refused for
     * such a line as for a missing own row.
     */
    providerSettlement?: boolean;
    /**
     * V1-66 (QUICK-SALE-SERVER, P83, Journey L): atomic counter-sale mode.
     * Creates the QUICK_SALE MarketplaceOrder, optional shared Walk-in customer
     * contact (under per-business pg_advisory_xact_lock), PAID invoice, canonical
     * Payment + ledger posting, stock decrement under lock order + routing claim,
     * COGS posting, receipt PaymentLink token, and IdempotencyKey in ONE transaction.
     */
    quickSale?: QuickSaleCheckoutInput;
  }) {
    const qs = input.quickSale ?? null;
    let existingOrder: any = null;
    if (!qs) {
      existingOrder = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: input.orderId },
        include: { items: true, business: { select: { defaultTaxRate: true } } },
      });
      if (!existingOrder) throw new NotFoundException('Order not found');

      if (existingOrder.paymentStatus === 'PAID') {
        // Idempotent: if we already completed this order, return as-is.
        this.logger.debug(`[store-order] completeCheckout no-op for already-PAID order ${existingOrder.id}`);
        return this.prisma.client.marketplaceOrder.findUnique({
          where: { id: existingOrder.id },
          include: { items: true },
        });
      }
    }

    const targetBusinessId: string = qs ? qs.businessId : existingOrder.businessId;
    const targetItems: Array<{ productId: string; name: string; quantity: number; unitPrice: number; total: number }> =
      qs ? qs.items : existingOrder.items;
    const targetTotal: number = qs ? qs.total : existingOrder.total;
    const targetSubtotal: number = qs ? qs.subtotal : existingOrder.subtotal;
    const targetTaxAmount: number = qs ? qs.taxAmount : existingOrder.taxAmount;
    const targetDiscountAmount: number = qs ? 0 : (existingOrder.discountAmount ?? 0);
    const targetCurrency: string = qs ? qs.currency : existingOrder.currency;
    const targetOrderNumber: string = qs ? qs.orderNumber : existingOrder.orderNumber;

    let contactId: string | null = qs ? qs.contactId : null;
    const meta = (existingOrder?.metadata as Record<string, unknown> | null) ?? {};
    const referralCode: string | null = !qs && typeof meta.referralCode === 'string' ? meta.referralCode : null;

    if (!qs) {
      const nameParts = (existingOrder.customerName ?? '').trim().split(/\s+/);
      for (let attempt = 1; attempt <= CONTACT_RESOLVE_ATTEMPTS; attempt += 1) {
        try {
          const contact = await this.crm.findOrCreateContact(existingOrder.businessId, {
            firstName: nameParts[0] ?? null,
            lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            email: existingOrder.customerEmail,
            phone: existingOrder.customerPhone,
            source: 'storefront',
            sourceDetail: `order:${existingOrder.orderNumber}`,
            ...(referralCode ? { custom: { referralCode } } : {}),
          });
          contactId = contact?.id ?? null;
          break; // resolved, or the CRM resolves no contact for this order: nothing to try again
        } catch (err: any) {
          this.logger.warn(
            `[store-order] CRM resolve failed for order ${existingOrder.id} (attempt ${attempt} of ${CONTACT_RESOLVE_ATTEMPTS}): ${(err as Error).message}`,
          );
        }
      }
      if (!contactId) {
        // Invoice requires a contact. Surface this clearly rather than
        // silently dropping the row.
        throw new BadRequestException(
          'Cannot finalize checkout: unable to resolve a contact for this order. Provide a customer email or phone.',
        );
      }
    }

    // Pick a default warehouse for stock decrement (first active per business).
    const defaultWarehouse = await this.prisma.client.warehouse.findFirst({
      where: { businessId: targetBusinessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const amount = input.paidAmount ?? targetTotal;
    const provider = input.provider ?? existingOrder?.paymentMethod?.toLowerCase() ?? 'manual';
    const method = (input.method ?? existingOrder?.paymentMethod ?? 'manual').toLowerCase();
    const paymentRef =
      input.paymentRef ?? existingOrder?.paymentRef ?? `${provider}_${existingOrder?.id ?? targetOrderNumber}_${Date.now()}`;
    const invoiceNumber = `INV-${targetOrderNumber}`;

    const productIds = targetItems.map((i) => i.productId);
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds }, businessId: targetBusinessId },
      select: {
        id: true,
        inventoryMode: true,
        outOfStockBehavior: true,
        name: true,
        _count: { select: { inventoryStocks: { where: ownStockRows(targetBusinessId) } } },
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
    const productNameById = new Map(
      products.map((p) => [p.id, p.name]),
    );

    const pendingEvents: Array<{ name: string; payload: unknown }> = [];

    const decrementedStockProducts =
      input.stockMovesOnFulfilment || !defaultWarehouse
        ? []
        : targetItems.filter((i) => productMode.get(i.productId) === 'tracked').map((i) => i.productId);

    const result = await this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      const now = new Date();

      // V1-66 (QUICK-SALE-SERVER): resolve/create per-business Walk-in customer contact
      // under a per-business transaction-scoped advisory lock BEFORE stock row locks
      // (strict total order: walk-in lock -> global stock lock order -> order row).
      let resolvedContactId = contactId;
      if (qs && !resolvedContactId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quick-sale-walkin:${targetBusinessId}`}))`;
        const existingWalkIn = await tx.contact.findFirst({
          where: { businessId: targetBusinessId, deletedAt: null, source: 'quick_sale_walkin' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (existingWalkIn) {
          resolvedContactId = existingWalkIn.id;
        } else {
          const createdWalkIn = await tx.contact.create({
            data: {
              businessId: targetBusinessId,
              firstName: 'Walk-in',
              lastName: 'customer',
              displayName: 'Walk-in customer',
              status: 'CLIENT',
              source: 'quick_sale_walkin',
              sourceDetail: 'Quick counter sale',
              visibility: 'TEAM',
              tags: ['walk-in'],
            },
            select: { id: true },
          });
          resolvedContactId = createdWalkIn.id;
        }
      }

      // W10-Z4-ROUTE-FIX (SEAMZ4-CR-1): lock every stock row in global order before writes.
      await lockStockRowsInOrder(tx, targetBusinessId, decrementedStockProducts);

      // CONC-QS-2: if a concurrent retry with the same Idempotency-Key waited on the
      // walk-in/stock locks while the winner committed, short-circuit before creating
      // any order/invoice/payment/ledger rows and return the winner's committed summary.
      if (qs?.idempotency) {
        const existingSlot = await tx.idempotencyKey.findUnique({
          where: {
            businessId_idempotencyKey: { businessId: targetBusinessId, idempotencyKey: qs.idempotency.slot },
          },
        });
        if (existingSlot) {
          if (existingSlot.requestHash !== qs.idempotency.requestHash) {
            throw new ConflictException(
              'This Idempotency-Key was already used for a different quick sale; use a new key',
            );
          }
          const saved = existingSlot.response as unknown as QuickSaleCommittedResult | null;
          if (saved?.order?.id && saved?.invoice?.id && saved?.payment?.id && saved?.receiptToken) {
            return {
              replayed: true as const,
              updatedOrder: saved.order,
              invoice: null,
              resolvedContactId: saved.invoice.contactId,
              decrementedProductIds: [] as string[],
              stockHeldElsewhere: [] as StockHeldElsewhereLine[],
              quickSaleSummary: saved,
            };
          }
        }
      }

      let activeOrder = existingOrder;
      if (qs) {
        activeOrder = await tx.marketplaceOrder.create({
          data: {
            businessId: targetBusinessId,
            orderNumber: qs.orderNumber,
            status: 'COMPLETED',
            type: 'QUICK_SALE',
            customerName: qs.customerName,
            customerEmail: qs.customerEmail,
            customerPhone: qs.customerPhone,
            subtotal: qs.subtotal,
            shippingFee: 0,
            taxAmount: qs.taxAmount,
            dutyAmount: 0,
            discountAmount: 0,
            total: qs.total,
            currency: qs.currency,
            paymentStatus: 'PAID',
            paymentMethod: method.toUpperCase(),
            paymentRef,
            notes: qs.notes,
            metadata: {
              source: 'QUICK_SALE',
              taxRate: qs.taxRate,
              links: { contactId: resolvedContactId },
              statusTimeline: [{ status: 'completed', timestamp: now.toISOString(), note: 'Quick sale completed' }],
            },
            items: {
              create: qs.items.map((item) => ({
                productId: item.productId,
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                currency: item.currency,
              })),
            },
          },
          include: { items: true },
        });
      }

      // The order's status as of this transaction (SEC-V33-5): read under a
      // row lock for the offline completion, which refuses a closed order.
      let currentStatus: string = activeOrder.status;
      if (!qs && input.refuseClosedOrder) {
        const [locked] = await tx.$queryRaw<Array<{ status: string; payment_status: string }>>`
          SELECT status, payment_status FROM marketplace_orders WHERE id = ${activeOrder.id} FOR UPDATE`;
        if (!locked) throw new NotFoundException('Order not found');
        if (isClosedStorefrontOrder({ status: locked.status, paymentStatus: locked.payment_status })) {
          throw new ConflictException(`This order is ${locked.status.toLowerCase()} and cannot be completed`);
        }
        currentStatus = locked.status;
      }

      // 1. Invoice — created DRAFT then immediately walked DRAFT→SENT→PAID
      // through the canonical InvoiceWorkflowService inside this same
      // transaction so the row is never observable in DRAFT outside the
      // commit boundary. Events are buffered for post-commit emission.
      const invoice = await tx.invoice.create({
        data: {
          businessId: targetBusinessId,
          contactId: resolvedContactId!,
          invoiceNumber,
          status: 'DRAFT',
          subtotal: targetSubtotal,
          ...(qs ? { taxRate: qs.taxRate } : {}),
          taxAmount: targetTaxAmount,
          discountAmount: targetDiscountAmount,
          total: targetTotal,
          currency: targetCurrency,
          issueDate: now,
          notes: qs ? `Quick sale ${targetOrderNumber}` : `Storefront order ${targetOrderNumber}`,
          items: {
            create: targetItems.map((item) => ({
              description: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          },
        },
      });
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
          currency: targetCurrency,
          status: 'SUCCESSFUL',
          method,
          invoiceId: invoice.id,
          businessId: targetBusinessId,
          recordedBy: input.actorId ?? null,
        },
      });
      await this.revenuePosting.onPaymentRecorded(payment.id, { tx: txClient, createdById: input.actorId ?? null });

      // 3. Stock decrement + movement rows.
      const decrementedProductIds: string[] = [];
      const stockHeldElsewhere: StockHeldElsewhereLine[] = [];
      const trackedItems = input.stockMovesOnFulfilment
        ? []
        : targetItems.filter((i) => {
            const mode = productMode.get(i.productId) ?? 'untracked';
            return mode === 'tracked';
          });
      if (trackedItems.length > 0 && !defaultWarehouse) {
        throw new BadRequestException(
          'Cannot finalize checkout: no active warehouse configured for tracked products.',
        );
      }
      for (const item of input.stockMovesOnFulfilment ? [] : targetItems) {
        const mode = productMode.get(item.productId) ?? 'untracked';
        if (mode !== 'tracked') {
          this.logger.debug(`[store-order] skipping stock decrement for ${mode} product ${item.productId}`);
          continue;
        }
        const productName = productNameById.get(item.productId) || item.name || 'Product';
        const ownRows = await tx.inventoryStock.findMany({
          where: {
            businessId: targetBusinessId,
            productId: item.productId,
            warehouse: { businessId: targetBusinessId, isActive: true },
          },
          orderBy: [{ warehouse: { createdAt: 'asc' } }, { id: 'asc' }],
        });
        if (ownRows.length === 0) {
          if (input.providerSettlement) {
            const holder = await tx.inventoryStock.findUnique({
              where: { productId_warehouseId: { productId: item.productId, warehouseId: defaultWarehouse!.id } },
              select: { businessId: true },
            });
            if (holder && holder.businessId !== targetBusinessId) {
              stockHeldElsewhere.push({ productId: item.productId, name: item.name, quantity: item.quantity });
              continue;
            }
          }
          throw new BadRequestException(
            `Cannot finalize checkout: tracked product "${productName}" has no stock row in the default warehouse.`,
          );
        }
        const orderedRows = [
          ...ownRows.filter((r) => r.warehouseId === defaultWarehouse!.id),
          ...ownRows.filter((r) => r.warehouseId !== defaultWarehouse!.id),
        ];
        const totalAvailable = orderedRows.reduce((sum, r) => sum + Math.max(0, r.quantity - r.reserved), 0);
        if (totalAvailable < item.quantity) {
          const allowBackorder = productOOSBehavior.get(item.productId) === 'allow_backorder';
          if (!allowBackorder) {
            throw new ConflictException({
              code: 'INSUFFICIENT_STOCK',
              message: `Cannot finalize checkout: insufficient stock for product "${productName}" (have ${totalAvailable}, need ${item.quantity}).`,
              available: totalAvailable,
              requested: item.quantity,
            });
          }
        }
        const takenFrom = new Map<string, number>();
        let remaining = item.quantity;
        for (const stock of orderedRows) {
          if (remaining <= 0) break;
          const availInRow = Math.max(0, stock.quantity - stock.reserved);
          if (availInRow <= 0) continue;
          const take = Math.min(availInRow, remaining);
          takenFrom.set(stock.id, take);
          remaining -= take;
        }
        if (remaining > 0) {
          const primary = orderedRows[0];
          takenFrom.set(primary.id, (takenFrom.get(primary.id) ?? 0) + remaining);
        }
        for (const stock of orderedRows) {
          const take = takenFrom.get(stock.id) ?? 0;
          if (take <= 0) continue;
          await tx.inventoryStock.update({
            where: { id: stock.id },
            data: { quantity: stock.quantity - take },
          });
          await tx.stockMovement.create({
            data: {
              businessId: targetBusinessId,
              warehouseId: stock.warehouseId,
              productId: item.productId,
              quantityChange: -take,
              type: 'sale',
              referenceId: targetOrderNumber,
            },
          });
        }
        decrementedProductIds.push(item.productId);
      }

      // 4. Revenue attribution — hard requirement; failures roll back.
      await this.revenueAttribution.record(
        {
          businessId: targetBusinessId,
          source: qs ? 'manual' : 'storefront',
          sourceDetail: qs ? `quick_sale:${targetOrderNumber}` : `order:${targetOrderNumber}`,
          revenueType: 'ORDER',
          revenueId: activeOrder.id,
          amount: targetTotal,
          currency: targetCurrency,
          contactId: resolvedContactId!,
          referralCode,
        },
        txClient,
      );

      // 4b. W11-CHECKOUT-COGS-TX (D-127): COGS leg inside the same transaction.
      const soldItems = targetItems
        .filter((item) => item.productId && item.quantity > 0)
        .map((item) => ({ productId: item.productId, quantity: item.quantity }));
      if (soldItems.length > 0) {
        await this.expensePosting.onProductSold(
          {
            businessId: targetBusinessId,
            sourceType: 'MarketplaceOrder',
            sourceId: activeOrder.id,
            date: now,
            currency: targetCurrency,
            contactId: resolvedContactId!,
            items: soldItems,
          },
          txClient,
        );
      }

      // 5. Order finalization + quick-sale PaymentLink & IdempotencyKey commit.
      const updatedOrder = qs
        ? activeOrder
        : await tx.marketplaceOrder.update({
            where: { id: activeOrder.id },
            data: {
              paymentStatus: 'PAID',
              status: FULFILMENT_PAST_CONFIRMED.has(currentStatus.toUpperCase()) ? currentStatus : (input.paidStatus ?? 'CONFIRMED'),
              paymentRef,
            },
            include: { items: true },
          });

      let quickSaleSummary: QuickSaleCommittedResult | null = null;
      if (qs) {
        await tx.paymentLink.create({
          data: {
            invoiceId: invoice.id,
            businessId: targetBusinessId,
            token: qs.receiptToken,
            active: true,
          },
        });
        quickSaleSummary = {
          order: updatedOrder,
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: 'PAID',
            subtotal: Number(invoice.subtotal ?? targetSubtotal),
            taxAmount: Number(invoice.taxAmount ?? targetTaxAmount),
            total: Number(invoice.total),
            currency: invoice.currency,
            contactId: resolvedContactId!,
          },
          payment: {
            id: payment.id,
            amount: Number(payment.amount),
            currency: payment.currency,
            method: payment.method ?? method,
            status: payment.status,
            providerPaymentId: payment.providerPaymentId ?? null,
          },
          receiptToken: qs.receiptToken,
        };
        if (qs.idempotency) {
          await tx.idempotencyKey.create({
            data: {
              businessId: targetBusinessId,
              idempotencyKey: qs.idempotency.slot,
              status: 'completed',
              requestHash: qs.idempotency.requestHash,
              response: {
                ...quickSaleSummary,
                receiptPath: `/commerce/public/invoice-link/${qs.receiptToken}/receipt`,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      return {
        replayed: false as const,
        updatedOrder,
        invoice,
        resolvedContactId: resolvedContactId!,
        decrementedProductIds,
        stockHeldElsewhere,
        quickSaleSummary,
      };
    }, qs ? ROUTING_CLAIM_TX_OPTIONS : undefined);

    if (qs && result.quickSaleSummary) {
      qs.onCommitted(result.quickSaleSummary, result.replayed);
    }
    if (result.replayed) {
      return result.updatedOrder;
    }

    // Tx committed — now safe to flush buffered invoice events and
    // dispatch the storefront-funnel timeline + CRM hooks.
    for (const evt of pendingEvents) {
      this.events.emit(evt.name, evt.payload);
    }

    if (result.stockHeldElsewhere.length > 0) {
      await this.tellStockHeldElsewhere(result.updatedOrder, defaultWarehouse!, provider, result.stockHeldElsewhere);
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
        businessId: targetBusinessId,
        contactId: result.resolvedContactId,
        type: 'payment.completed',
        sourceDetail: `order:${result.updatedOrder.orderNumber}`,
        data: baseData,
      });
    } catch (err: any) {
      this.logger.warn(`[store-order] post-checkout timeline write failed: ${(err as Error).message}`);
    }

    this.events.emit('store_order.paid', { order: result.updatedOrder, businessId: targetBusinessId, invoiceId: result.invoice.id });

    for (const productId of result.decrementedProductIds) {
      try {
        const risk = await this.inventoryRisk.evaluateProduct(productId, targetBusinessId);
        if (!risk) continue;
        for (const signal of risk.signals) {
          if (signal.type === 'out_of_stock' || signal.type === 'low_stock') {
            this.events.emit(`inventory.${signal.type}`, {
              businessId: targetBusinessId,
              productId,
              productName: risk.productName,
              signal,
              triggeredBy: { type: 'order', id: result.updatedOrder.id, orderNumber: result.updatedOrder.orderNumber },
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`[store-order] inventory-risk eval failed for ${productId}: ${(err as Error).message}`);
      }
    }

    return result.updatedOrder;
  }

  /**
   * W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-1, CPS-COR-2; the D-76 pattern of
   * PaymentsService.refuseWipayCurrency): after a provider settlement that took
   * no stock for a line whose (product, default warehouse) pair another
   * business's stock row holds (a planted row D-137 leaves for an operator),
   * the business is told once (the settlement commits once: a settled order is
   * answered as it stands) by a STOCK_NOT_DECREMENTED_NOTIFICATION naming the
   * order, each such product and its quantity, and the warehouse, never the
   * other business; and the operator log names the order for the planted-row
   * repair (W11-PLANTED-STOCK-CENSUS). Best effort: the money is recorded, so
   * a failure here is logged and the settlement stands.
   */
  private async tellStockHeldElsewhere(
    order: { id: string; businessId: string; orderNumber: string },
    warehouse: { id: string; name: string },
    provider: string,
    lines: StockHeldElsewhereLine[],
  ): Promise<void> {
    const label = PROVIDER_LABEL[provider] ?? provider;
    this.logger.error(
      `[store-order] order ${order.id} of business ${order.businessId} settled by ${provider} with no stock taken for ` +
        `${lines.map((l) => `${l.productId} x${l.quantity}`).join(', ')} in warehouse ${warehouse.id}: the (product, warehouse) ` +
        'stock row is another business\'s (D-137 planted row); repair it with the planted-row census, then adjust the stock',
    );
    try {
      const named = lines.map((l) => `${l.name} x ${l.quantity}`).join(', ');
      await this.prisma.client.notification.create({
        data: {
          businessId: order.businessId,
          type: STOCK_NOT_DECREMENTED_NOTIFICATION,
          title: 'Paid order: stock not taken',
          body:
            `Order ${order.orderNumber} was paid through ${label} and the payment is recorded, but no stock was taken ` +
            `from ${warehouse.name} for ${named}: the stock row for ${lines.length === 1 ? 'that product' : 'those products'} ` +
            'in that warehouse is held by another record. Ask an operator to repair it, then adjust your stock by hand.',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            provider,
            warehouseId: warehouse.id,
            products: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
            reason: 'stock_row_held_elsewhere',
          },
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        `[store-order] could not tell business ${order.businessId} of order ${order.id}'s stock not taken: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  /**
   * FU-SITE-ANALYTICS-REVENUE-SCOPE (owner rulings D-100, D-234; security
   * review M1): the order summary as the member asking may see it. Below
   * revenue read, totalRevenue (the PAID orders' totals) is withheld, and so
   * are completedOrders and totalOrders (sales volume; totalOrders less the
   * kept counts would give completedOrders back): the keys are absent and
   * their queries do not run. The fulfilment queue (pending, confirmed,
   * shipped, cancelled) stays for every member. `readsRevenue` is the
   * caller's reading of the member's level (SiteService.readsRevenue).
   */
  async getOrderSummaryForReader(businessId: string, readsRevenue: boolean) {
    if (readsRevenue) return this.getOrderSummary(businessId);
    const [pendingOrders, confirmedOrders, shippedOrders, cancelledOrders] = await Promise.all([
      this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'PENDING' } }),
      this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CONFIRMED' } }),
      this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'SHIPPED' } }),
      this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CANCELLED' } }),
    ]);
    return { pendingOrders, confirmedOrders, shippedOrders, cancelledOrders };
  }

  /** The full order summary, money included: for a caller that has required revenue read (getOrderSummaryForReader). */
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

  /**
   * Refund an order in full (the site refund route).
   *
   * Trial-N recheck (G6PUB-RC1-3): a refund moves money state, so it takes a
   * member with revenue write (D-46: no SUPER_ADMIN bypass), the same rule as
   * the offline completion. It used to set paymentStatus REFUNDED on any order
   * and leave its books as they were (invoice PAID, payment SUCCESSFUL), and
   * the store_order.refunded listener then booked the order total as an
   * Expense, also for an order nobody had paid.
   *
   *   - An order nothing was paid on has nothing to refund: 409, nothing is
   *     written and no event is emitted (cancel it instead).
   *   - A storefront order's money is on its checkout invoice
   *     (INV-<orderNumber>, completeCheckout). Each SUCCESSFUL payment on it is
   *     refunded through the D-14 refund door (CommerceService.
   *     markPaymentRefunded): a negative REFUNDED row naming the refunder, the
   *     payment's posting reversed, the invoice reopened (SENT, paidAt
   *     cleared, for a full refund). A payment with nothing left to refund (an
   *     earlier refund of it, this order's interrupted refund included) is
   *     skipped. store_order.refunded then names the invoice, so its listener
   *     books no Expense beside the refund. A paid storefront order with no
   *     recorded payment is refused (409): there is no money door to move.
   *   - The order flips to REFUNDED once (compare-and-set on the paymentStatus
   *     read), so a concurrent refund emits nothing a second time.
   *
   * G6PUB-R3-STORE-ORDER-DOORS review (SEC-R3-2): a STANDARD (marketplace)
   * order created paid (D-77) has its money on a checkout invoice too
   * (completeCheckout's INV-<orderNumber>, hasCheckoutInvoice), and is
   * refunded on it the same way. Only the storefront's was: the D-77 order
   * flipped to REFUNDED with its invoice PAID, its payment SUCCESSFUL and its
   * posting on, and store_order.refunded named no invoice, so its listener
   * booked an Expense as well. A STANDARD order with no checkout invoice (one
   * marked paid by the marketplace 'mark_paid' action, which records no
   * payment) is refunded as before: the listener books the refund as an
   * Expense.
   */
  async refundOrder(orderId: string, businessId: string, actorId: string | null = null) {
    await this.assertMemberMayRecordPayments(businessId, actorId);
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if ((order.status ?? '').toUpperCase() === 'REFUNDED' || (order.paymentStatus ?? '').toUpperCase() === 'REFUNDED') {
      throw new BadRequestException('Order has already been refunded');
    }
    if ((order.paymentStatus ?? '').toUpperCase() !== 'PAID') {
      throw new ConflictException('Nothing was paid on this order, so there is nothing to refund; cancel it instead');
    }

    const orderType = (order.type ?? '').toUpperCase();
    const onCheckoutInvoice =
      orderType === 'STOREFRONT' || orderType === 'QUICK_SALE' || (await this.hasCheckoutInvoice(businessId, order.orderNumber));
    const invoiceId = onCheckoutInvoice ? await this.refundCheckoutPayments(order, actorId) : undefined;

    const { count } = await this.prisma.client.marketplaceOrder.updateMany({
      where: { id: orderId, businessId, paymentStatus: order.paymentStatus },
      data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
    });
    const updated = await this.getOrder(orderId, businessId);
    if (count === 1) {
      this.events.emit('store_order.refunded', {
        order: updated,
        businessId,
        refundAmount: updated.total,
        ...(invoiceId ? { invoiceId } : {}),
      });
    }

    return updated;
  }

  /**
   * PR210-PAYPAL-STORE-REFUND review (COR-PR210-1, SEC-PR210-4; owner rulings
   * D-121, D-138): the order side of a refund the order's payment provider
   * reported (PayPal's PAYMENT.CAPTURE.REFUNDED / .REVERSED of the capture
   * that settled it), which the provider refund door has just recorded on the
   * order's checkout invoice. It runs inside that door's transaction
   * (PaymentsService.createRefundWithPosting, under the invoice lock), so the
   * refund row, its posting and what the order shows commit together or not
   * at all, and a delivery that fails is redelivered whole (V1-15c). The
   * provider's refund was recorded with only the invoice before: the order
   * stayed CONFIRMED/PAID with no refunded total, Sales > Orders and the
   * orders summary counted it as paid, and no store_order.refunded was sent.
   *
   * What the order shows is read from the invoice's rows (the balance read
   * contract, balanceOfStoredRows), as the D-121 refund door reads it
   * (MarketplaceService.refundPartThroughDoor): while something received is
   * left the order keeps its status and paymentStatus PAID (the order
   * vocabulary has no partly refunded value; D-121 makes no schema change),
   * metadata.refundedTotal is what is refunded and a 'partially_refunded' step
   * names the provider's refund. Once nothing is left the order is REFUNDED,
   * with a compare-and-set on PAID as refundOrder flips it, and a 'refunded'
   * step. No member is named: the provider refunded. Returns whether this call
   * flipped the order, so the caller announces it once the transaction has
   * committed (announceProviderRefund).
   */
  async recordProviderRefundOnOrder(
    tx: Prisma.TransactionClient,
    input: { orderId: string; businessId: string; invoiceId: string; provider: string; providerRefundId: string; amount: number },
  ): Promise<{ flipped: boolean }> {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
      select: { total: true, currency: true },
    });
    if (!invoice) throw new NotFoundException('The order\'s checkout invoice was not found');
    const rows = await tx.payment.findMany({
      where: { businessId: input.businessId, invoiceId: input.invoiceId },
      select: { amount: true, status: true },
    });
    const balance = balanceOfStoredRows(Number(invoice.total), rows, invoice.currency);
    const refundedTotal = fromCents(toCents(balance.refunded));
    const inFull = !(toCents(balance.net) > 0);
    const flipped = inFull
      ? (
          await tx.marketplaceOrder.updateMany({
            where: { id: input.orderId, businessId: input.businessId, paymentStatus: 'PAID' },
            data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
          })
        ).count === 1
      : false;
    await recordOrderRefundedTotal(tx, input.businessId, input.orderId, refundedTotal, [
      {
        status: inFull ? 'refunded' : 'partially_refunded',
        timestamp: new Date().toISOString(),
        refundAmount: input.amount,
        refundedTotal,
        provider: input.provider,
        providerRefundId: input.providerRefundId,
      },
    ]);
    return { flipped };
  }

  /**
   * PR210-PAYPAL-STORE-REFUND review (COR-PR210-1): the one store_order.refunded
   * of an order a provider's refund flipped REFUNDED (recordProviderRefundOnOrder),
   * sent after the refund has committed, as refundOrder sends its own: it names
   * the checkout invoice the refund is on, so its listener books no Expense
   * beside the refund (CommerceIntegrationService.handleOrderRefunded).
   */
  async announceProviderRefund(orderId: string, businessId: string, invoiceId: string): Promise<void> {
    const order = await this.getOrder(orderId, businessId);
    this.events.emit('store_order.refunded', { order, businessId, refundAmount: order.total, invoiceId });
  }

  /**
   * G6PUB-R3-STORE-ORDER-DOORS review (SEC-R3-1/2/3): whether the order's
   * money is on its checkout invoice, INV-<orderNumber>, which only the paid
   * door (completeCheckout) writes: every checked-out storefront order, and a
   * STANDARD order created paid (D-77). Such an order's payment fields move
   * only through the paid door and the refund door (refundOrder).
   */
  async hasCheckoutInvoice(businessId: string, orderNumber: string): Promise<boolean> {
    if (!orderNumber) return false;
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { businessId, invoiceNumber: `INV-${orderNumber}` },
      select: { id: true },
    });
    return !!invoice;
  }

  /**
   * Trial-N recheck (G6PUB-RC1-3, D-14): refund the money a storefront order's
   * checkout recorded, through the D-14 refund door. Returns the invoice the
   * refund is on. G6PUB-R3-STORE-ORDER-DOORS review (SEC-R3-2): also a
   * STANDARD order created paid (D-77), whose checkout invoice it is the same.
   */
  private async refundCheckoutPayments(
    order: { businessId: string; orderNumber: string },
    actorId: string | null,
  ): Promise<string> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { businessId: order.businessId, invoiceNumber: `INV-${order.orderNumber}` },
      select: { id: true },
    });
    const payments = invoice
      ? await this.prisma.client.payment.findMany({
          where: { businessId: order.businessId, invoiceId: invoice.id, status: 'SUCCESSFUL' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        })
      : [];
    if (!invoice || payments.length === 0) {
      throw new ConflictException('This order has no recorded payment to refund');
    }
    if (!this.commerce) throw new ServiceUnavailableException('Refunds are unavailable');
    for (const payment of payments) {
      try {
        await this.commerce.markPaymentRefunded(
          payment.id,
          order.businessId,
          `Storefront order ${order.orderNumber} refunded`,
          actorId,
          undefined,
          undefined,
          { allowApiGatewayBookkeeping: true },
        );
      } catch (err) {
        // 409: nothing is left of this payment to refund; an earlier refund holds it.
        if (!(err instanceof ConflictException)) throw err;
      }
    }
    return invoice.id;
  }
}
