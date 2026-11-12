import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { mergeOrderMetadataObject, removeOrderMetadataKeyIf, replaceOrderMetadataKeyIf, setOrderMetadataKeyOnce } from './order-metadata';
import { memberMayRecordPayments } from '../site/store-order.service';
import { CrmService } from '../crm/crm.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import {
  StoreOrderCreatedPayload,
  StoreOrderPaidPayload,
  StoreOrderShippedPayload,
  StoreOrderDeliveredPayload,
  StoreOrderCancelledPayload,
  StoreOrderRefundedPayload,
  InventoryLowPayload,
  InventoryOutPayload,
  PurchaseOrderReceivedPayload,
  PreorderDelayedPayload,
} from '../../core/event-bus/events.types';

/** MarketplaceOrder.type of an order placed through the public storefront (StoreOrderService.createOrder). */
const STOREFRONT_ORDER_TYPE = 'STOREFRONT';

/**
 * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126): the order metadata key that claims its shipping Expense, once per
 * order: { claim, at } while it is booked, then { claim, at, expenseId }.
 */
export const SHIPPING_EXPENSE_METADATA_KEY = 'shippingExpense';

/**
 * W11-SHIPPING-EXPENSE-ONCE (D-126; review SEC-SEO-1): a shipping Expense claim with no expenseId older than this was
 * left by a call that never finished (it died, or its booking failed and the claim could not be taken back), and the
 * next qualifying ship takes it over. A call that is alive is done well within it: its reads are single queries and
 * createExpense posts in one interactive transaction (Prisma's default 2 s wait for a connection and 5 s timeout).
 */
export const SHIPPING_EXPENSE_CLAIM_STALE_MS = 10 * 60_000;

/** The value of metadata.shippingExpense while a call books it; expenseId is added when it is recorded. */
type ShippingExpenseClaim = { claim: string; at: string };

@Injectable()
export class CommerceIntegrationService {
  private readonly logger = new Logger(CommerceIntegrationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
  ) {}

  /**
   * Resolve a contactId for an order using metadata links first, then falling
   * back to an email/phone lookup against the business's contacts.
   */
  private async resolveContactId(businessId: string, order: any): Promise<string | null> {
    const meta = (order.metadata as Record<string, any>) ?? {};
    const metaContactId = (meta.links as Record<string, any>)?.contactId as string | undefined;
    if (metaContactId) return metaContactId;

    if (order.customerEmail) {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId, emailNormalized: order.customerEmail.toLowerCase(), deletedAt: null },
        select: { id: true },
      });
      if (contact) return contact.id;
    }

    if (order.customerPhone) {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId, phone: order.customerPhone, deletedAt: null },
        select: { id: true },
      });
      if (contact) return contact.id;
    }

    return null;
  }

  private async linkContactToOrder(businessId: string, orderId: string, contactId: string): Promise<void> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { metadata: true },
    });
    if (!order) return;

    const meta = (order.metadata as Record<string, unknown>) ?? {};
    const links = (meta.links as Record<string, unknown>) ?? {};
    if (links.contactId === contactId) return;

    // W10-SOP-FIX (SOP-V4): links.contactId is written in one statement (order-metadata.ts). This listener runs on the
    // paid door's store_order.paid beside the routing listener and mark_paid's autoRouteOrder, and its copy of the
    // metadata, written back whole, undid the routing steps they appended meanwhile (and theirs undid this link).
    await mergeOrderMetadataObject(this.prisma.client, businessId, orderId, 'links', { contactId });
  }

  private async linkProjectToOrder(businessId: string, orderId: string, projectId: string): Promise<void> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { metadata: true },
    });
    if (!order) return;

    const meta = (order.metadata as Record<string, unknown>) ?? {};
    const links = (meta.links as Record<string, unknown>) ?? {};
    if (links.projectId === projectId) return;

    // W10-SOP-FIX (SOP-V4): links.projectId in one statement, as linkContactToOrder writes links.contactId.
    await mergeOrderMetadataObject(this.prisma.client, businessId, orderId, 'links', { projectId });
  }

  private async createNotification(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    }).catch((e) => this.logger.error(`Failed to create notification: ${(e as Error).message}`));
  }

  @OnEvent('store_order.created')
  async handleOrderCreated(payload: StoreOrderCreatedPayload) {
    try {
      const order = payload.order;
      if (!order.customerEmail && !order.customerPhone) return;

      const contact = await this.crm.findOrCreateContact(payload.businessId, {
        firstName: order.customerName?.split(' ')[0] ?? null,
        lastName: order.customerName?.split(' ').slice(1).join(' ') || null,
        email: order.customerEmail ?? null,
        phone: order.customerPhone ?? null,
        source: 'store_order',
        sourceDetail: `Order ${order.orderNumber ?? order.id}`,
        tags: ['customer', 'store-order'],
      });

      if (contact?.id) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId: contact.id,
          type: 'store_order.created',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            currency: order.currency,
            status: order.status,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });

        await this.linkContactToOrder(payload.businessId, order.id, contact.id);
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.created',
        title: 'New Store Order',
        body: `Order ${order.orderNumber ?? order.id} placed by ${order.customerName ?? 'Customer'} for ${order.currency} ${order.total?.toFixed?.(2) ?? order.total}`,
        data: { orderId: order.id, orderNumber: order.orderNumber, total: order.total },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.created handler failed: ${(e as Error).message}`);
    }
  }

  /**
   * `store_order.paid` says money arrived. For a storefront order that is
   * true only once StoreOrderService.completeCheckout has committed the
   * invoice, the SUCCESSFUL payment and its posting and set the order PAID;
   * that emission carries `invoiceId`. The stored order is read, not the
   * payload: a paid event for an order of another business, for a
   * storefront order that is not PAID (what CONFIRMED emitted before V1-18,
   * a queued copy of it, or a forged one), or for a storefront order set
   * PAID without completeCheckout's invoice (the marketplace fulfillOrder
   * 'mark_paid' and PATCH .../status 'paid' routes, which record no invoice
   * and no payment) writes nothing, so no invoice, no 'paid' tag, no paid
   * timeline event and no "payment received" notification follow from it.
   * W10-STORE-ORDER-PAID (V18-T2b, D-112): nor does one for an order of any
   * type that is not stored PAID.
   *
   * W10-STORE-ORDER-PAID review (SEC-SOP-3): a stored PAID alone is not a
   * recorded payment. Since D-112 the marketplace routes mark a STANDARD order
   * PAID only through the paid door (MarketplaceService.
   * recordPaymentThroughDoor), but a STANDARD order can still be stored PAID
   * with no checkout invoice: the Shopify sync writes PAID for an order paid
   * at Shopify, and rows written before D-112 exist. Such an order's paid
   * event is no longer emitted: store_order.paid comes from the paid door
   * only (completeCheckout, with its invoice), and the marketplace status
   * route, which emitted it on every PATCH 'paid' (any member) and so
   * replayed this handler's invoice, notification and timeline event, emits
   * it no more (MarketplaceService.emitOrderLifecycleEvent).
   */
  @OnEvent('store_order.paid')
  async handleOrderPaid(payload: StoreOrderPaidPayload & { invoiceId?: string | null }) {
    try {
      const order = payload.order;
      if (!order?.id) return;

      const stored = await this.prisma.client.marketplaceOrder.findFirst({
        where: { id: order.id, businessId: payload.businessId },
        select: { type: true, paymentStatus: true, orderNumber: true },
      });
      if (!stored) {
        this.logger.warn(`[CommerceIntegration] store_order.paid names order ${order.id}, not found in business ${payload.businessId}; ignored`);
        return;
      }
      // W10-STORE-ORDER-PAID (V18-T2b, review STL-SEC-2 / CR-W9SPL-1; D-112): every order type is acted on only when
      // stored PAID. PATCH .../status 'paid' alone (a fulfilment status change, open to any member) emitted
      // store_order.paid for a STANDARD order stored UNPAID (it no longer does, review SEC-SOP-2; a copy can still be
      // queued or forged), and this STANDARD branch wrote its contact timeline event, its "Order Payment Received"
      // notification and a raw PAID INV-ORD invoice with no payment.
      if ((stored.paymentStatus ?? '').toUpperCase() !== 'PAID') {
        this.logger.warn(
          `[CommerceIntegration] store_order.paid for ${stored.type} order ${order.id} whose payment status is ${stored.paymentStatus}; ignored (an order is paid through the paid door)`,
        );
        return;
      }
      if (stored.type === STOREFRONT_ORDER_TYPE) {
        // Settled means completeCheckout's invoice for THIS order exists in
        // this business (and is the one the event names, when it names one).
        const settled = await this.prisma.client.invoice.findFirst({
          where: {
            businessId: payload.businessId,
            invoiceNumber: `INV-${stored.orderNumber}`,
            ...(payload.invoiceId ? { id: payload.invoiceId } : {}),
          },
          select: { id: true },
        });
        if (!settled) {
          this.logger.warn(
            `[CommerceIntegration] store_order.paid for storefront order ${order.id} with no completeCheckout invoice INV-${stored.orderNumber}${payload.invoiceId ? ` matching ${payload.invoiceId}` : ''}; ignored (set PAID outside completeCheckout: no invoice, no payment recorded)`,
          );
          return;
        }
      }

      await this.createRevenueRecord(payload.businessId, order, stored.type, payload.invoiceId ?? null);

      let contactId: string | null = null;
      if (order.customerEmail || order.customerPhone) {
        const contact = await this.crm.findOrCreateContact(payload.businessId, {
          firstName: order.customerName?.split(' ')[0] ?? null,
          lastName: order.customerName?.split(' ').slice(1).join(' ') || null,
          email: order.customerEmail ?? null,
          phone: order.customerPhone ?? null,
          source: 'store_order',
          sourceDetail: `Order ${order.orderNumber ?? order.id}`,
          tags: ['customer', 'store-order', 'paid'],
        });
        contactId = contact?.id ?? null;

        if (contactId) {
          await this.crm.logContactEvent({
            businessId: payload.businessId,
            contactId,
            type: 'store_order.paid',
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              total: order.total,
              currency: order.currency,
            },
            actorType: 'SYSTEM',
            source: 'commerce',
          });

          await this.linkContactToOrder(payload.businessId, order.id, contactId);
        }
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.paid',
        title: 'Order Payment Received',
        body: `Order ${order.orderNumber ?? order.id} paid — ${order.currency} ${order.total?.toFixed?.(2) ?? order.total}`,
        data: { orderId: order.id, orderNumber: order.orderNumber, total: order.total, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.paid handler failed: ${(e as Error).message}`);
    }
  }

  /**
   * The invoice behind a paid order (F206). Before V1-18 this deduplicated on
   * `notes contains order:<id>` alone. completeCheckout's invoice is
   * INV-<orderNumber> with the notes "Storefront order <orderNumber>", so it
   * was never found, and every checkout got a second, raw PAID invoice
   * INV-ORD-<orderNumber> with no payment and no posting.
   *
   *   1. The event names its invoice (completeCheckout): resolve it in this
   *      business and write nothing, whether or not it is found.
   *   2. A storefront order is invoiced only by completeCheckout, in one
   *      transaction with its payment and posting: a paid event without an
   *      invoiceId (the legacy shape, a replay) writes nothing. (handleOrderPaid
   *      has already ignored a storefront order without that invoice.)
   *   3. Any other order with an invoice already (INV-<orderNumber>,
   *      INV-ORD-<orderNumber> or the notes marker): nothing.
   *   4. Otherwise (a marketplace order marked paid) the legacy record below.
   */
  private async createRevenueRecord(businessId: string, order: any, orderType: string, invoiceId: string | null) {
    try {
      if (invoiceId) {
        const settled = await this.prisma.client.invoice.findFirst({
          where: { id: invoiceId, businessId },
          select: { id: true },
        });
        if (!settled) {
          this.logger.warn(
            `[CommerceIntegration] store_order.paid for order ${order.id} names invoice ${invoiceId}, not found in business ${businessId}; no invoice written`,
          );
        }
        return;
      }
      if (orderType === STOREFRONT_ORDER_TYPE) return;

      const numbers: string[] = order.orderNumber ? [`INV-${order.orderNumber}`, `INV-ORD-${order.orderNumber}`] : [];
      const existing = await this.prisma.client.invoice.findFirst({
        where: {
          businessId,
          OR: [...numbers.map((invoiceNumber) => ({ invoiceNumber })), { notes: { contains: `order:${order.id}` } }],
        },
        select: { id: true },
      });
      if (existing) return;

      const items = (order.items ?? []).map((item: any) => ({
        description: item.name ?? item.product?.name ?? 'Product',
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0,
        total: item.total ?? (item.quantity ?? 1) * (item.unitPrice ?? 0),
      }));

      const subtotal = items.reduce((s: number, i: any) => s + i.total, 0);

      const contactId = await this.resolveContactId(businessId, order);
      if (!contactId) throw new Error(`Cannot create invoice: no contact resolved for order ${order.id}`);

      await this.prisma.client.invoice.create({
        data: {
          businessId,
          contactId,
          invoiceNumber: `INV-ORD-${order.orderNumber ?? order.id.slice(-8).toUpperCase()}`,
          status: 'PAID',
          issueDate: new Date(),
          paidAt: new Date(),
          subtotal,
          taxAmount: order.taxAmount ?? 0,
          discountAmount: order.discountAmount ?? 0,
          total: order.total ?? subtotal,
          currency: order.currency ?? 'TTD',
          notes: `Auto-generated from store order ${order.orderNumber ?? order.id}. order:${order.id}`,
          items: {
            create: items,
          },
        },
      });

      this.logger.log(`[CommerceIntegration] Revenue record created for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.error(`[CommerceIntegration] Failed to create revenue record: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.shipped')
  async handleOrderShipped(payload: StoreOrderShippedPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.shipped',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            trackingNumber: order.trackingNumber,
            carrier: order.carrier,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      // W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; F-24): no Expense is booked here. store_order.shipped follows
      // every shipped marking by any member (PATCH .../status 'shipped' has no transition check), and booked the
      // payload's shippingFee as a PAID Expense, posted to the ledger, each time: a revenue:none STAFF member's three
      // PATCHes booked three. The order routes book it once per order, for a member with revenue write, after their
      // status write (bookShippingExpenseOnce).

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.shipped',
        title: 'Order Shipped',
        body: `Order ${order.orderNumber ?? order.id} has been shipped.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.shipped handler failed: ${(e as Error).message}`);
    }
  }

  /**
   * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; F-24): books the order's shipping fee as a PAID shipping Expense
   * (Dr expense / Cr cash, ExpensesService.createExpense), once per order, for the first shipped marking made by a
   * member with revenue write on any order route (MarketplaceService.updateOrderStatus and fulfillOrder 'ship',
   * StoreOrderService.updateOrderStatus SHIPPED), called by the route after its status write has committed.
   *
   * - `actorId` must be a member of the business with revenue write (memberMayRecordPayments: no SUPER_ADMIN bypass,
   *   D-46). Anyone else's ship books nothing and is not refused: the status change stays open to every member
   *   (D-112).
   * - The fee, currency and number are the order as stored in the business, never an event payload. A fee of 0 or
   *   less books nothing.
   * - The order is claimed in one statement (setOrderMetadataKeyOnce on metadata.shippingExpense), so repeated and
   *   concurrent markings, on any route, book once.
   * - An Expense booked for the order before D-126 (notes `order:<id>`, tag 'shipping', not deleted) is recorded in
   *   the claim and nothing more is booked.
   * - Review CR-W11SE-1: if any step after the claim fails (that read, the booking, recording its id) the claim is
   *   taken back (only while it is still this call's), so the next qualifying ship books it; an Expense that committed
   *   before the failure is found there by the check above. The failure is logged, never thrown: the status change
   *   has committed.
   * - Review SEC-SEO-1: a claim that never got an expenseId (its call died, or failed and could not take it back) and
   *   is older than SHIPPING_EXPENSE_CLAIM_STALE_MS is taken over by the next qualifying ship, logged, and that ship
   *   goes through the check above, so an Expense the old call committed is recorded rather than booked again.
   */
  async bookShippingExpenseOnce(businessId: string, orderId: string, actorId: string | null | undefined): Promise<void> {
    if (!(await memberMayRecordPayments(this.prisma, businessId, actorId))) return;
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { id: true, orderNumber: true, shippingFee: true, currency: true },
    });
    const fee = Number(order?.shippingFee ?? 0);
    if (!order || !Number.isFinite(fee) || fee <= 0) return;

    const claim: ShippingExpenseClaim = { claim: randomBytes(16).toString('hex'), at: new Date().toISOString() };
    if (!(await this.claimShippingExpense(businessId, orderId, claim))) return;

    try {
      // getOrderCrossLinks reads an order's Expenses by these notes.
      const notes = `order:${order.id}`;
      const booked = await this.prisma.client.expense.findFirst({
        where: { businessId, deletedAt: null, notes, tags: { has: 'shipping' } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const expenseId =
        booked?.id ??
        (
          await this.expenses.createExpense({
            businessId,
            description: `Shipping cost for order ${order.orderNumber ?? order.id}`,
            amount: fee,
            currency: order.currency ?? 'TTD',
            date: new Date(),
            vendor: 'Shipping Carrier',
            tags: ['shipping', 'order-expense'],
            notes,
          })
        )?.id ??
        null;
      // Recorded only while the claim is still this call's: one taken over meanwhile (SEC-SEO-1) is left to its taker.
      const recorded = await replaceOrderMetadataKeyIf(this.prisma.client, businessId, orderId, SHIPPING_EXPENSE_METADATA_KEY, claim, {
        ...claim,
        expenseId,
      });
      if (!recorded) {
        this.logger.warn(
          `[CommerceIntegration] Shipping Expense ${expenseId} of order ${orderId} not recorded on the order: its claim was taken over meanwhile`,
        );
      }
    } catch (e) {
      await removeOrderMetadataKeyIf(this.prisma.client, businessId, orderId, SHIPPING_EXPENSE_METADATA_KEY, claim.claim).catch((undoErr) =>
        this.logger.error(
          `[CommerceIntegration] Could not release the shipping Expense claim of order ${orderId}: ${(undoErr as Error).message}; ` +
            `the first qualifying ship after ${SHIPPING_EXPENSE_CLAIM_STALE_MS / 60_000} minutes takes it over`,
        ),
      );
      this.logger.error(`[CommerceIntegration] Shipping Expense for order ${orderId} not booked: ${(e as Error).message}`);
    }
  }

  /**
   * W11-SHIPPING-EXPENSE-ONCE (D-126): takes the order's shipping Expense claim for `claim`. True when the key was
   * empty (setOrderMetadataKeyOnce), or held a claim left without an expenseId and older than
   * SHIPPING_EXPENSE_CLAIM_STALE_MS, replaced in one statement only while it is still the value read (review
   * SEC-SEO-1), so of two ships meeting it one takes it. False when the order is booked (an expenseId), a younger
   * claim may still be booking, or another call took it first.
   */
  private async claimShippingExpense(businessId: string, orderId: string, claim: ShippingExpenseClaim): Promise<boolean> {
    const client = this.prisma.client;
    if (await setOrderMetadataKeyOnce(client, businessId, orderId, SHIPPING_EXPENSE_METADATA_KEY, claim)) return true;

    const row = await client.marketplaceOrder.findFirst({ where: { id: orderId, businessId }, select: { metadata: true } });
    const metadata = row?.metadata;
    const held =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)[SHIPPING_EXPENSE_METADATA_KEY]
        : undefined;
    // Taken back since the claim above: claim it now (false again if another call is first).
    if (held === undefined || held === null) {
      return setOrderMetadataKeyOnce(client, businessId, orderId, SHIPPING_EXPENSE_METADATA_KEY, claim);
    }
    const heldObject = typeof held === 'object' && !Array.isArray(held) ? (held as Record<string, unknown>) : null;
    if (heldObject?.expenseId) return false;
    const heldAt = typeof heldObject?.at === 'string' ? Date.parse(heldObject.at) : Number.NaN;
    // A claim made within SHIPPING_EXPENSE_CLAIM_STALE_MS (either way: clocks of two instances differ) may still be booking.
    if (Number.isFinite(heldAt) && Math.abs(Date.now() - heldAt) < SHIPPING_EXPENSE_CLAIM_STALE_MS) return false;

    const taken = await replaceOrderMetadataKeyIf(client, businessId, orderId, SHIPPING_EXPENSE_METADATA_KEY, held, claim);
    if (taken) {
      this.logger.warn(
        `[CommerceIntegration] Order ${orderId}: took over a shipping Expense claim left without an Expense ` +
          `(made ${typeof heldObject?.at === 'string' ? heldObject.at : 'at an unknown time'}); booking it now`,
      );
    }
    return taken;
  }

  @OnEvent('store_order.delivered')
  async handleOrderDelivered(payload: StoreOrderDeliveredPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.delivered',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            deliveredAt: new Date(),
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      if (order.customerEmail || contactId) {
        await this.scheduleReviewRequest(payload.businessId, order, contactId);
        await this.scheduleReorderPrompt(payload.businessId, order, contactId);
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.delivered',
        title: 'Order Delivered',
        body: `Order ${order.orderNumber ?? order.id} has been delivered.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.delivered handler failed: ${(e as Error).message}`);
    }
  }

  private async scheduleReorderPrompt(businessId: string, order: any, contactId: string | null) {
    try {
      const reorderDelayMs = 30 * 24 * 60 * 60 * 1000;
      const deliveredAt = new Date();
      await this.prisma.client.scheduledAgentJob.upsert({
        where: {
          businessId_entityId_checkpoint: {
            businessId,
            entityId: order.id,
            checkpoint: 'reorder_prompt',
          },
        },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(deliveredAt.getTime() + reorderDelayMs),
        },
        create: {
          businessId,
          jobType: 'post_purchase_reorder_prompt',
          entityId: order.id,
          checkpoint: 'reorder_prompt',
          scheduledFor: new Date(deliveredAt.getTime() + reorderDelayMs),
          payload: {
            contactId,
            orderNumber: order.orderNumber,
            orderId: order.id,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            currency: order.currency,
            total: order.total,
            deliveredAt: deliveredAt.toISOString(),
            productNames: (order.items ?? []).map((i: any) => i.name ?? i.product?.name).filter(Boolean),
          },
        },
      });
      this.logger.log(`[CommerceIntegration] Reorder prompt scheduled for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] Failed to schedule reorder prompt: ${(e as Error).message}`);
    }
  }

  private async scheduleReviewRequest(businessId: string, order: any, contactId: string | null) {
    try {
      const reviewDelayMs = 3 * 24 * 60 * 60 * 1000;
      await this.prisma.client.scheduledAgentJob.upsert({
        where: {
          businessId_entityId_checkpoint: {
            businessId,
            entityId: order.id,
            checkpoint: 'review_request',
          },
        },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(Date.now() + reviewDelayMs),
        },
        create: {
          businessId,
          jobType: 'post_purchase_review_request',
          entityId: order.id,
          checkpoint: 'review_request',
          scheduledFor: new Date(Date.now() + reviewDelayMs),
          payload: {
            contactId,
            orderNumber: order.orderNumber,
            orderId: order.id,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            currency: order.currency,
            total: order.total,
            productNames: (order.items ?? []).map((i: any) => i.name ?? i.product?.name).filter(Boolean),
          },
        },
      });
      this.logger.log(`[CommerceIntegration] Review request scheduled for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] Failed to schedule review request: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.cancelled')
  async handleOrderCancelled(payload: StoreOrderCancelledPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.cancelled',
          data: { orderId: order.id, orderNumber: order.orderNumber },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.cancelled',
        title: 'Order Cancelled',
        body: `Order ${order.orderNumber ?? order.id} has been cancelled.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.cancelled handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.refunded')
  async handleOrderRefunded(payload: StoreOrderRefundedPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.refunded',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            refundAmount: payload.refundAmount ?? order.total,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      // Trial-N recheck (G6PUB-RC1-3, D-14): a refund recorded on the order's
      // invoice (payload.invoiceId: negative REFUNDED rows, the posting
      // reversed) is already in the books; an Expense beside it would take the
      // money out twice.
      if (payload.refundAmount && payload.refundAmount > 0 && !payload.invoiceId) {
        await this.expenses.createExpense({
          businessId: payload.businessId,
          description: `Refund for order ${order.orderNumber ?? order.id}`,
          amount: payload.refundAmount,
          currency: order.currency ?? 'TTD',
          date: new Date(),
          vendor: order.customerName ?? 'Customer',
          tags: ['refund', 'order-expense'],
          notes: `order:${order.id}`,
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.refunded',
        title: 'Order Refunded',
        body: `Order ${order.orderNumber ?? order.id} has been refunded (${order.currency} ${(payload.refundAmount ?? order.total)?.toFixed?.(2) ?? ''}).`,
        data: { orderId: order.id, orderNumber: order.orderNumber, refundAmount: payload.refundAmount, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.refunded handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('inventory.low')
  async handleInventoryLow(payload: InventoryLowPayload) {
    try {
      await this.createNotification({
        businessId: payload.businessId,
        type: 'inventory.low',
        title: 'Low Stock Alert',
        body: `Product "${payload.productName}" is running low in ${payload.warehouseName}. Only ${payload.quantity} units available (reorder at ${payload.reorderAt}).`,
        data: {
          productId: payload.productId,
          productName: payload.productName,
          warehouseId: payload.warehouseId,
          quantity: payload.quantity,
          reorderAt: payload.reorderAt,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] inventory.low handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('inventory.out')
  async handleInventoryOut(payload: InventoryOutPayload) {
    try {
      await this.createNotification({
        businessId: payload.businessId,
        type: 'inventory.out',
        title: 'Out of Stock',
        body: `Product "${payload.productName}" is out of stock in ${payload.warehouseName}.`,
        data: {
          productId: payload.productId,
          productName: payload.productName,
          warehouseId: payload.warehouseId,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] inventory.out handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('purchaseOrder.received')
  async handlePurchaseOrderReceived(payload: PurchaseOrderReceivedPayload) {
    try {
      if (payload.total > 0) {
        await this.expenses.createExpense({
          businessId: payload.businessId,
          description: `Purchase Order ${payload.poNumber} received — sourcing cost`,
          amount: payload.total,
          currency: payload.currency,
          date: new Date(),
          vendor: payload.supplierName ?? 'Supplier',
          tags: ['purchase-order', 'sourcing-cost'],
          notes: `purchaseOrder:${payload.purchaseOrderId}`,
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'purchaseOrder.received',
        title: 'Purchase Order Received',
        body: `Purchase order ${payload.poNumber} from ${payload.supplierName ?? 'supplier'} has been received.`,
        data: {
          purchaseOrderId: payload.purchaseOrderId,
          poNumber: payload.poNumber,
          total: payload.total,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] purchaseOrder.received handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('preorder.delayed')
  async handlePreorderDelayed(payload: PreorderDelayedPayload) {
    try {
      if (payload.customerEmail) {
        await this.sendPreorderDelayNotice(payload).catch((err) =>
          this.logger.error(`Failed to send preorder delay notice: ${(err as Error).message}`),
        );
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'preorder.delayed',
        title: 'Pre-order Delayed',
        body: `Pre-order for "${payload.productName}" for ${payload.customerName ?? 'customer'} has been delayed.`,
        data: {
          preOrderId: payload.preOrderId,
          productId: payload.productId,
          productName: payload.productName,
          customerName: payload.customerName,
          newExpectedDate: payload.newExpectedDate,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] preorder.delayed handler failed: ${(e as Error).message}`);
    }
  }

  private async sendPreorderDelayNotice(payload: PreorderDelayedPayload) {
    if (!payload.customerEmail) return;

    const newDateStr = payload.newExpectedDate
      ? new Date(payload.newExpectedDate).toLocaleDateString('en-TT', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'a later date';

    const originalDateStr = payload.originalExpectedDate
      ? new Date(payload.originalExpectedDate).toLocaleDateString('en-TT', { year: 'numeric', month: 'long', day: 'numeric' })
      : undefined;

    await this.emailService.send({
      businessId: payload.businessId,
      type: 'preorder_delay_notice',
      recipientEmail: payload.customerEmail,
      recipientName: payload.customerName ?? 'Customer',
      templateData: {
        customerName: payload.customerName ?? 'Customer',
        productName: payload.productName,
        originalExpectedDate: originalDateStr,
        newExpectedDate: newDateStr,
        reason: payload.reason ?? undefined,
      },
      dedupeKey: `preorder-delay-${payload.preOrderId}`,
    });
  }

  async promoteProductToContent(businessId: string, productId: string): Promise<{ post: any; message: string }> {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new Error('Product not found');

    const content = [
      `🎉 Introducing ${product.name}!`,
      product.description ? `\n\n${product.description}` : '',
      `\n\nAvailable now for ${product.currency} ${product.price.toFixed(2)}.`,
      `\n\n#${product.name.replace(/\s+/g, '')} #shop #new`,
    ].join('');

    const post = await this.prisma.client.socialPost.create({
      data: {
        businessId,
        content: content.trim(),
        mediaUrls: product.imageUrl ? [product.imageUrl] : [],
        status: 'DRAFT',
        channelIds: [],
      },
    });

    this.logger.log(`[CommerceIntegration] Created content campaign draft for product ${product.name}`);

    return {
      post,
      message: `Content campaign draft created for product "${product.name}". Review and publish from your Content section.`,
    };
  }

  async createProjectForBundleOrder(businessId: string, orderId: string, options?: { name?: string; description?: string; contactId?: string }) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new Error('Order not found');

    const serviceItems = (order.items as any[]).filter((item: any) =>
      item.product?.category === 'SERVICE',
    );
    if (serviceItems.length === 0) {
      return { created: false, message: 'No service items found in order. Projects are only created for service+product bundle orders.' };
    }

    const orderMeta = (order.metadata as Record<string, unknown>) ?? {};
    const orderLinks = (orderMeta.links as Record<string, string | undefined>) ?? {};
    const linkedProjectId = orderLinks.projectId ?? null;
    const linkedContactId = orderLinks.contactId ?? null;

    if (linkedProjectId) {
      const existingProject = await this.prisma.client.project.findFirst({
        where: { id: linkedProjectId, businessId, deletedAt: null },
      });
      if (existingProject) {
        return { created: false, project: existingProject, message: 'Project already exists for this order.' };
      }
    }

    let resolvedContactId: string | null = options?.contactId ?? linkedContactId ?? null;

    if (resolvedContactId) {
      const contactCheck = await this.prisma.client.contact.findFirst({
        where: { id: resolvedContactId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!contactCheck) {
        this.logger.warn(`[CommerceIntegration] contactId ${resolvedContactId} does not belong to business ${businessId} — ignoring`);
        resolvedContactId = null;
      }
    }

    const contactId = resolvedContactId;
    const projectName = options?.name ?? `Order ${order.orderNumber ?? orderId} - Custom Work`;
    const description = options?.description ?? `Project for service work linked to order ${order.orderNumber ?? orderId}.\nService items: ${serviceItems.map((i: any) => i.name).join(', ')}`;

    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: projectName,
        description,
        status: 'ACTIVE',
        priority: 'NORMAL',
        contactId: contactId ?? null,
        dueDate: null,
      },
      include: { tasks: true },
    });

    await this.linkProjectToOrder(businessId, orderId, project.id);

    this.logger.log(`[CommerceIntegration] Created project ${project.id} for bundle order ${orderId}`);

    return { created: true, project, message: `Project "${projectName}" created for custom service work.` };
  }

  async getOrderCrossLinks(businessId: string, orderId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: { include: { product: true } },
        shipments: true,
      },
    });
    if (!order) throw new Error('Order not found');

    const orderMeta = (order.metadata as Record<string, unknown>) ?? {};
    const orderLinks = (orderMeta.links as Record<string, string | undefined>) ?? {};
    const linkedContactId = orderLinks.contactId ?? null;
    const linkedProjectId = orderLinks.projectId ?? null;

    const [invoices, expenses, contact, project] = await Promise.all([
      // The order's revenue: the legacy listener invoice carries the notes
      // marker; completeCheckout's invoice (a storefront order's only one
      // since V1-18) is INV-<orderNumber> with no marker.
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [{ notes: { contains: `order:${orderId}` } }, { invoiceNumber: `INV-${order.orderNumber}` }],
        },
        select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, paidAt: true },
      }),
      this.prisma.client.expense.findMany({
        where: {
          businessId,
          deletedAt: null,
          notes: { contains: `order:${orderId}` },
        },
        select: { id: true, description: true, amount: true, currency: true, date: true, vendor: true },
      }),
      linkedContactId
        ? this.prisma.client.contact.findFirst({
            where: { id: linkedContactId, businessId, deletedAt: null },
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          })
        : Promise.resolve(null),
      linkedProjectId
        ? this.prisma.client.project.findFirst({
            where: { id: linkedProjectId, businessId, deletedAt: null },
            select: { id: true, name: true, status: true, priority: true },
          })
        : Promise.resolve(null),
    ]);

    const margin = invoices.reduce((s, i) => s + (i.total ?? 0), 0) -
      expenses.reduce((s, e) => s + (e.amount ?? 0), 0);

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        currency: order.currency,
      },
      revenue: invoices,
      expenses,
      contact,
      project,
      margin,
    };
  }

  async getContactOrderHistory(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
    });
    if (!contact) throw new Error('Contact not found');

    const ordersViaContactId = await this.prisma.client.marketplaceOrder.findMany({
      where: {
        businessId,
        metadata: { path: ['links', 'contactId'], equals: contactId },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    }).catch(() => [] as any[]);

    const ordersViaEmail = contact.email
      ? await this.prisma.client.marketplaceOrder.findMany({
          where: { businessId, customerEmail: contact.email },
          include: { items: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
        }).catch(() => [] as any[])
      : [];

    const allOrders = [...ordersViaContactId];
    const seenIds = new Set(ordersViaContactId.map((o: any) => o.id));
    for (const o of ordersViaEmail) {
      if (!seenIds.has(o.id)) allOrders.push(o);
    }

    const totalSpent = allOrders
      .filter((o: any) => ['paid', 'CONFIRMED', 'shipped', 'delivered', 'completed'].includes(o.status))
      .reduce((s: number, o: any) => s + (o.total ?? 0), 0);

    const productsBought = allOrders
      .flatMap((o: any) => o.items ?? [])
      .map((i: any) => ({ productId: i.productId, name: i.name ?? i.product?.name }));

    return {
      contact: {
        id: contact.id,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        email: contact.email,
      },
      orders: allOrders,
      orderCount: allOrders.length,
      totalSpent,
      productsBought,
    };
  }

  /**
   * V1-84 (FOLLOW3-D17-JOB-RUNNER-CLAIMS): the V1-35 claim, unchanged. These
   * job types are also run by the cross-module poller, and this runner is
   * reachable by any member (POST marketplace/businesses/:b/post-purchase/process),
   * so each job is claimed before any effect by a compare-and-set on the version
   * read (this business, PENDING, same updatedAt, still due; count === 1). A
   * failed execution marks the row FAILED only while it is still this claim's.
   * A claim that throws leaves the row PENDING and ends the call. `processed`
   * counts the jobs this call claimed.
   */
  async processPostPurchaseJobs(businessId: string) {
    const now = new Date();
    const dueJobs = await this.prisma.client.scheduledAgentJob.findMany({
      where: {
        businessId,
        jobType: { in: ['post_purchase_review_request', 'post_purchase_reorder_prompt'] },
        status: 'PENDING',
        scheduledFor: { lte: now },
      },
      take: 20,
    });

    let processed = 0;
    for (const job of dueJobs) {
      const claimedAt = new Date();
      const claim = await this.prisma.client.scheduledAgentJob.updateMany({
        where: { id: job.id, businessId, status: 'PENDING', updatedAt: job.updatedAt, scheduledFor: { lte: claimedAt } },
        data: { status: 'COMPLETED', executedAt: claimedAt },
      });
      if (claim.count !== 1) continue; // taken by another claimant, cancelled, or re-armed after the read
      processed += 1;
      try {
        const p = job.payload as any;
        if (job.jobType === 'post_purchase_review_request') {
          if (p.customerEmail) {
            await this.sendReviewRequestEmail(businessId, p);
          }
          if (p.contactId) {
            await this.addCrmTaskIfAbsent(businessId, p.contactId, `review-${p.orderId}`,
              `Request product review for order ${p.orderNumber ?? p.orderId}`);
          }
        } else if (job.jobType === 'post_purchase_reorder_prompt') {
          if (p.customerEmail) {
            await this.sendReorderPromptEmail(businessId, p);
          }
          if (p.contactId) {
            await this.addCrmTaskIfAbsent(businessId, p.contactId, `reorder-${p.orderId}`,
              `Follow up for reorder — order ${p.orderNumber ?? p.orderId}`);
          }
        }
      } catch (e) {
        this.logger.error(`[CommerceIntegration] Failed to process post-purchase job ${job.id} (${job.jobType}): ${(e as Error).message}`);
        // Fenced to this claim: a row its writer re-armed during the execution keeps its new run.
        const failed = await this.prisma.client.scheduledAgentJob.updateMany({
          where: { id: job.id, businessId, status: 'COMPLETED', executedAt: claimedAt },
          data: { status: 'FAILED' },
        }).catch(() => null);
        if (failed && failed.count !== 1) {
          this.logger.warn(`[CommerceIntegration] Post-purchase job ${job.id} changed during its failed execution; left as its writer set it`);
        }
      }
    }

    return { processed };
  }

  private async addCrmTaskIfAbsent(businessId: string, contactId: string, _dedupeKey: string, title: string) {
    try {
      const existing = await this.prisma.client.contactTask.findFirst({
        where: { businessId, contactId, title },
        select: { id: true },
      });
      if (existing) return;

      await this.crm.addTask({
        businessId,
        contactId,
        title,
        priority: 'NORMAL',
        dueDate: new Date().toISOString(),
        source: 'commerce-integration',
      });
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] addCrmTaskIfAbsent failed: ${(e as Error).message}`);
    }
  }

  private async sendReviewRequestEmail(businessId: string, p: any) {
    await this.emailService.send({
      businessId,
      type: 'review_request',
      recipientEmail: p.customerEmail,
      recipientName: p.customerName ?? 'Customer',
      templateData: {
        customerName: p.customerName ?? 'Customer',
        orderNumber: p.orderNumber ?? p.orderId,
        productNames: p.productNames ?? [],
      },
      dedupeKey: `review-request-${p.orderId}`,
    });
  }

  private async sendReorderPromptEmail(businessId: string, p: any) {
    let daysSincePurchase: number | undefined;
    if (p.deliveredAt) {
      const delivered = new Date(p.deliveredAt);
      daysSincePurchase = Math.round((Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24));
    }

    await this.emailService.send({
      businessId,
      type: 'reorder_prompt',
      recipientEmail: p.customerEmail,
      recipientName: p.customerName ?? 'Customer',
      templateData: {
        customerName: p.customerName ?? 'Customer',
        orderNumber: p.orderNumber ?? p.orderId,
        productNames: p.productNames ?? [],
        daysSincePurchase,
      },
      dedupeKey: `reorder-prompt-${p.orderId}`,
    });
  }
}
