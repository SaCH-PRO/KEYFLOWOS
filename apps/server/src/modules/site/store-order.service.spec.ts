/**
 * V1-18-PUB-STOREFRONT-PAID-EVENT (M37, CF-45, F206): a storefront order is
 * "paid" only when StoreOrderService.completeCheckout settles it.
 *
 * At the V1 base, updateOrderStatus mapped CONFIRMED to `store_order.paid`
 * (store-order.service.ts:360). The merchant's Confirm button on an UNPAID
 * order therefore told every paid listener that money had arrived: the
 * marketplace listener (CommerceIntegrationService.createRevenueRecord)
 * fabricated a PAID INV-ORD-* invoice with no payment and no posting,
 * fulfilment routing ran, webhooks fired `store_order.paid` to the merchant's
 * integrations and the contact timeline logged a payment.
 *
 * Contract pinned here (StoreOrderService over stubs; the real-database proof
 * of the listener and the ledger is test/storefront-paid-event.integration.test.ts):
 *
 *   SO-01  CONFIRMED on an UNPAID order emits `store_order.confirmed` only:
 *          never `store_order.paid`, and the payment status is not written
 *   SO-02  SHIPPED / DELIVERED / CANCELLED keep their events (control)
 *   SO-03  a status with no lifecycle event emits nothing (control)
 *   SO-04  completeCheckout emits `store_order.paid` once, carrying the id of
 *          the invoice it created with the payment (the listener resolves it)
 *   SO-05  completeCheckout on an order already PAID writes nothing and emits
 *          nothing (control)
 *   SO-06  W11-ORDER-CANCEL-RELEASE (F-35; D-136): CANCELLED is written on the
 *          order's routing claim transaction (ROUTING_CLAIM_TX_OPTIONS): the
 *          claim first, then the order's routes cancelled and the status
 *          written on that transaction, with one store_order.cancelled after
 *          it; a SHIPPED order's CANCELLED is 400 with no status written and no
 *          event. At bb316619 CANCELLED was a plain update outside any
 *          transaction (SHIPPED included); the real-database proof is
 *          test/marketplace-routing-concurrency.integration.test.ts RC-42.
 *          Review OCR-COR-2: the status is written compare-and-set on the
 *          status the claim read (updateMany where status), not by id alone
 *   SO-07  W11-ORDER-CANCEL-RELEASE review OCR-COR-2 (D-136): a status that
 *          changed between the claim's read and the cancel's write (a ship
 *          that takes no claim committed meanwhile) is 409 with no event; at
 *          3fdf2399 CANCELLED was written over it by id (RC-44)
 *   SO-08  W11-ORDER-CANCEL-RELEASE review OCR-COR-1: an open order stored in
 *          a spelling outside canTransitionOrder's case-sensitive vocabulary
 *          ('processing', 'pending', 'on_hold') is cancelled; at 3fdf2399 it
 *          was 400 'Cannot cancel order in processing status' (RC-43)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StoreOrderService } from './store-order.service';

const BIZ = 'biz_v18_unit';

type Emitted = { name: string; payload: any };

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'ord_v18_1',
    businessId: BIZ,
    orderNumber: 'ORD-V18-1',
    status: 'PENDING',
    type: 'STOREFRONT',
    customerName: 'Vee Eighteen',
    customerEmail: 'v18@test.local',
    customerPhone: null,
    paymentStatus: 'UNPAID',
    paymentMethod: null,
    paymentRef: null,
    subtotal: 100,
    shippingFee: 0,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    currency: 'TTD',
    metadata: {},
    items: [{ id: 'item_1', productId: 'prod_v18', name: 'Widget', quantity: 1, unitPrice: 100, total: 100, currency: 'TTD' }],
    ...over,
  };
}

function build(stored: ReturnType<typeof order>) {
  const emitted: Emitted[] = [];
  // The order row as the transaction sees it: a cancel's compare-and-set (updateMany) writes it when its status matches.
  let current: Record<string, unknown> = { ...stored };
  const events = { emit: vi.fn((name: string, payload: any) => { emitted.push({ name, payload }); return true; }) };
  const writes: string[] = [];

  const tx = {
    invoice: {
      create: vi.fn(async ({ data }: any) => { writes.push('invoice.create'); return { id: 'inv_v18_1', ...data }; }),
    },
    payment: {
      create: vi.fn(async ({ data }: any) => { writes.push('payment.create'); return { id: 'pay_v18_1', ...data }; }),
    },
    inventoryStock: { findUnique: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn() },
    stockMovement: { create: vi.fn() },
    marketplaceOrder: {
      findFirst: vi.fn(async () => stored),
      update: vi.fn(async ({ data }: any) => { writes.push('order.update'); return { ...stored, ...data }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        writes.push('order.updateMany');
        if (where.id !== current.id || where.businessId !== current.businessId || where.status !== current.status) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      }),
      findFirstOrThrow: vi.fn(async () => current),
    },
    // W11-ORDER-CANCEL-RELEASE: a cancel's claim, release and timeline step on the transaction.
    fulfillmentRoute: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => { writes.push('routes.cancel'); return { count: 0 }; }),
    },
    $executeRaw: vi.fn(async () => { writes.push('tx.executeRaw'); return 1; }),
    $queryRaw: vi.fn(async () => []),
  };

  const client = {
    marketplaceOrder: {
      findFirst: vi.fn(async () => current),
      findUnique: vi.fn(async () => current),
      update: vi.fn(async ({ data }: any) => { writes.push(`order.update:${Object.keys(data).sort().join(',')}`); current = { ...current, ...data }; return current; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        writes.push(`order.updateMany:${Object.keys(data).sort().join(',')}`);
        if (where.id !== current.id || where.businessId !== current.businessId || where.status !== current.status) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      }),
      findFirstOrThrow: vi.fn(async () => current),
    },
    warehouse: { findFirst: vi.fn(async () => null) },
    product: {
      findMany: vi.fn(async () => [{ id: 'prod_v18', inventoryMode: null, outOfStockBehavior: null, name: 'Widget', _count: { inventoryStocks: 0 } }]),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const invoiceWorkflow = { transition: vi.fn(async () => ({})) };
  const revenuePosting = { onPaymentRecorded: vi.fn(async () => ({ transactionId: 'ft_1' })) };
  const revenueAttribution = { record: vi.fn(async () => undefined) };
  const crm = { findOrCreateContact: vi.fn(async () => ({ id: 'contact_v18' })) };
  const publicEvents = { logStorefrontEvent: vi.fn(async () => undefined) };
  const inventoryRisk = { evaluateProduct: vi.fn(async () => null) };
  // W11-CHECKOUT-COGS-TX (D-127): the COGS leg completeCheckout posts in its transaction.
  const expensePosting = { onProductSold: vi.fn(async () => null) };

  const svc = new StoreOrderService(
    { client } as any,
    events as any,
    {} as any,
    crm as any,
    publicEvents as any,
    invoiceWorkflow as any,
    inventoryRisk as any,
    revenueAttribution as any,
    revenuePosting as any,
    expensePosting as any,
  );
  return {
    svc,
    emitted,
    writes,
    tx,
    client,
    revenuePosting,
    expensePosting,
    /** Moves the stored row as a writer outside the cancel's transaction would (a ship that takes no claim). */
    moveStored: (data: Record<string, unknown>) => { current = { ...current, ...data }; },
  };
}

describe('V1-18 StoreOrderService: CONFIRMED is not paid', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    h = build(order());
  });

  it('SO-01 CONFIRMED on an UNPAID order emits store_order.confirmed only, never store_order.paid', async () => {
    const out = await h.svc.updateOrderStatus('ord_v18_1', 'CONFIRMED', BIZ);

    expect(h.emitted.map((e) => e.name)).toEqual(['store_order.confirmed']);
    expect(h.emitted.some((e) => e.name === 'store_order.paid')).toBe(false);
    expect(h.emitted[0].payload.businessId).toBe(BIZ);
    expect(h.emitted[0].payload.order.id).toBe('ord_v18_1');
    // Only the fulfilment status moves (compare-and-set on the status read, W1F-ORDER-TRANSITIONS D-198); nothing claims the money arrived.
    expect(h.writes).toEqual(['order.updateMany:status']);
    expect(out.paymentStatus).toBe('UNPAID');
    expect(h.tx.invoice.create).not.toHaveBeenCalled();
    expect(h.tx.payment.create).not.toHaveBeenCalled();
    expect(h.revenuePosting.onPaymentRecorded).not.toHaveBeenCalled();
  });

  it.each([
    ['SHIPPED', 'store_order.shipped'],
    ['DELIVERED', 'store_order.delivered'],
    ['CANCELLED', 'store_order.cancelled'],
  ])('SO-02 %s keeps its lifecycle event %s (control)', async (status, event) => {
    await h.svc.updateOrderStatus('ord_v18_1', status, BIZ);
    expect(h.emitted.map((e) => e.name)).toEqual([event]);
  });

  it('SO-03 a status with no lifecycle event emits nothing (control)', async () => {
    await h.svc.updateOrderStatus('ord_v18_1', 'PROCESSING', BIZ);
    expect(h.emitted).toEqual([]);
  });

  it('SO-04 completeCheckout emits store_order.paid once, carrying the invoice it created with the payment', async () => {
    const out = await h.svc.completeCheckout({ orderId: 'ord_v18_1', paymentRef: 'ref_v18', provider: 'stripe', method: 'card' });

    const paid = h.emitted.filter((e) => e.name === 'store_order.paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].payload.invoiceId).toBe('inv_v18_1');
    expect(paid[0].payload.businessId).toBe(BIZ);
    expect(paid[0].payload.order.paymentStatus).toBe('PAID');
    expect(h.emitted.some((e) => e.name === 'store_order.confirmed')).toBe(false);
    expect(h.writes).toEqual(['invoice.create', 'payment.create', 'order.update']);
    expect(h.revenuePosting.onPaymentRecorded).toHaveBeenCalledWith('pay_v18_1', expect.objectContaining({ tx: h.tx }));
    // W11-CHECKOUT-COGS-TX (D-127): the order's COGS leg is posted once, in the same transaction.
    expect(h.expensePosting.onProductSold).toHaveBeenCalledTimes(1);
    expect(h.expensePosting.onProductSold).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ, sourceType: 'MarketplaceOrder', sourceId: 'ord_v18_1', currency: 'TTD', contactId: 'contact_v18', items: [{ productId: 'prod_v18', quantity: 1 }] }),
      h.tx,
    );
    expect(out?.paymentStatus).toBe('PAID');
  });

  it('SO-05 completeCheckout on an order already PAID writes nothing and emits nothing (control)', async () => {
    h = build(order({ paymentStatus: 'PAID', status: 'CONFIRMED' }));
    await h.svc.completeCheckout({ orderId: 'ord_v18_1', paymentRef: 'ref_v18' });
    expect(h.emitted).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.client.$transaction).not.toHaveBeenCalled();
    expect(h.expensePosting.onProductSold).not.toHaveBeenCalled();
  });
});

describe('W11-ORDER-CANCEL-RELEASE StoreOrderService: CANCELLED releases the order on its routing claim', () => {
  it('SO-06 CANCELLED is written on the routing claim transaction (claim, routes cancelled, step, status), then emits store_order.cancelled once; a SHIPPED order is 400 with nothing written and no event', async () => {
    const h = build(order({ status: 'CONFIRMED', paymentStatus: 'PAID' }));
    const out = await h.svc.updateOrderStatus('ord_v18_1', ' cancelled ', BIZ);
    expect(h.client.$transaction).toHaveBeenCalledTimes(1);
    expect(h.client.$transaction.mock.calls[0][1]).toEqual({ maxWait: 5_000, timeout: 20_000 });
    // The claim (an advisory lock), the routes cancelled, the cancelled step, then the status: all on the transaction.
    expect(h.writes).toEqual(['tx.executeRaw', 'routes.cancel', 'tx.executeRaw', 'order.updateMany']);
    // Review OCR-COR-2: compare-and-set on the status the claim read.
    expect(h.tx.marketplaceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'ord_v18_1', businessId: BIZ, status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
    });
    expect(h.tx.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(h.client.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(out.status).toBe('CANCELLED');
    expect(out.paymentStatus, 'the payment kept').toBe('PAID');
    expect(h.emitted.map((e) => e.name)).toEqual(['store_order.cancelled']);

    const shipped = build(order({ status: 'SHIPPED', paymentStatus: 'PAID' }));
    await expect(shipped.svc.updateOrderStatus('ord_v18_1', 'CANCELLED', BIZ)).rejects.toMatchObject({
      status: 400,
      message: 'Cannot cancel order in SHIPPED status',
    });
    expect(shipped.writes.filter((w) => w !== 'tx.executeRaw'), 'no status, route or step written').toEqual([]);
    expect(shipped.client.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(shipped.emitted).toEqual([]);
  });

  it('SO-07 (review OCR-COR-2; D-136) a status that changed between the claim read and the cancel write (a ship committed meanwhile) is 409 with no event: nothing is written over it', async () => {
    const h = build(order({ status: 'CONFIRMED', paymentStatus: 'PAID' }));
    // The ship commits after the claim's read (CONFIRMED) and before the cancel's write.
    h.tx.fulfillmentRoute.updateMany.mockImplementationOnce(async () => {
      h.writes.push('routes.cancel');
      h.moveStored({ status: 'SHIPPED' });
      return { count: 0 };
    });
    await expect(h.svc.updateOrderStatus('ord_v18_1', 'CANCELLED', BIZ)).rejects.toMatchObject({
      status: 409,
      message:
        "This order's status changed while it was being cancelled (it was shipped or edited meanwhile): nothing was written. " +
        'Reload the order and cancel it again if it can still be cancelled',
    });
    expect(h.tx.marketplaceOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'CONFIRMED' }) }));
    expect(h.tx.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(h.emitted).toEqual([]);
  });

  it("SO-08 (review OCR-COR-1) an open order stored in a spelling outside canTransitionOrder's case-sensitive vocabulary ('processing', 'pending', 'on_hold') is cancelled, its status compare-and-set on the spelling read", async () => {
    for (const status of ['processing', 'pending', 'on_hold']) {
      const h = build(order({ status, paymentStatus: 'PAID' }));
      const out = await h.svc.updateOrderStatus('ord_v18_1', 'CANCELLED', BIZ);
      expect(out.status, status).toBe('CANCELLED');
      expect(h.tx.marketplaceOrder.updateMany, status).toHaveBeenCalledWith({
        where: { id: 'ord_v18_1', businessId: BIZ, status },
        data: { status: 'CANCELLED' },
      });
      expect(h.emitted.map((e) => e.name), status).toEqual(['store_order.cancelled']);
    }
  });

  it('SO-09 (W1F-ORDER-TRANSITIONS; D-198) moving SHIPPED or DELIVERED backwards is refused 400 with nothing written and no event', async () => {
    const shipped = build(order({ status: 'SHIPPED', paymentStatus: 'PAID' }));
    await expect(shipped.svc.updateOrderStatus('ord_v18_1', 'PROCESSING', BIZ)).rejects.toMatchObject({ status: 400 });
    expect(shipped.writes).toEqual([]);
    expect(shipped.emitted).toEqual([]);

    const delivered = build(order({ status: 'DELIVERED', paymentStatus: 'PAID' }));
    await expect(delivered.svc.updateOrderStatus('ord_v18_1', 'SHIPPED', BIZ)).rejects.toMatchObject({ status: 400 });
    expect(delivered.writes).toEqual([]);
    expect(delivered.emitted).toEqual([]);
  });

  it('SO-10 (W1F-ORDER-TRANSITIONS; D-198) SHIPPED compare-and-set refuses 409 when a concurrent cancel commits between read and write', async () => {
    const h = build(order({ status: 'CONFIRMED', paymentStatus: 'PAID' }));
    h.client.marketplaceOrder.findFirst.mockImplementationOnce(async () => {
      const snap = { ...order({ status: 'CONFIRMED', paymentStatus: 'PAID' }) };
      h.moveStored({ status: 'CANCELLED' });
      return snap;
    });
    await expect(h.svc.updateOrderStatus('ord_v18_1', 'SHIPPED', BIZ)).rejects.toMatchObject({ status: 409 });
    expect(h.emitted).toEqual([]);
  });

  it("SO-11 (W1F-ORDER-TRANSITIONS review R1-SEC-01) isClosedStorefrontOrder and completeCheckout FULFILMENT_PAST_CONFIRMED trim padded statuses: ' cancelled ' is closed and refused, and ' shipped ' is not rewound to CONFIRMED", async () => {
    const { isClosedStorefrontOrder } = await import('./store-order.service');
    expect(isClosedStorefrontOrder({ status: ' cancelled ', paymentStatus: 'UNPAID' })).toBe(true);
    expect(isClosedStorefrontOrder({ status: ' refunded ', paymentStatus: 'PAID' })).toBe(true);
    expect(isClosedStorefrontOrder({ status: 'PENDING', paymentStatus: ' refunded ' })).toBe(true);

    // Padded ' shipped ' order settled via completeCheckout keeps trimmed 'shipped' (never rewound to CONFIRMED).
    const hShipped = build(order({ status: ' shipped ', paymentStatus: 'UNPAID' }));
    hShipped.tx.$queryRaw.mockResolvedValueOnce([{ id: 'ord_v18_1', status: ' shipped ', payment_status: 'UNPAID' }]);
    const settled = await hShipped.svc.completeCheckout({
      orderId: 'ord_v18_1',
      paymentRef: 'ref_r1_shipped',
      provider: 'stripe',
      method: 'card',
    });
    expect(settled?.status).toBe('shipped');
    expect(hShipped.tx.marketplaceOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'shipped', paymentStatus: 'PAID' }),
      }),
    );

    // Padded ' cancelled ' order with refuseClosedOrder: true is refused 409 with nothing written.
    const hCancelled = build(order({ status: ' cancelled ', paymentStatus: 'UNPAID' }));
    hCancelled.tx.$queryRaw.mockResolvedValueOnce([{ id: 'ord_v18_1', status: ' cancelled ', payment_status: 'UNPAID' }]);
    await expect(
      hCancelled.svc.completeCheckout({
        orderId: 'ord_v18_1',
        paymentRef: 'ref_r1_cancelled',
        provider: 'manual',
        method: 'cash',
        refuseClosedOrder: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(hCancelled.tx.invoice.create).not.toHaveBeenCalled();
    expect(hCancelled.tx.marketplaceOrder.update).not.toHaveBeenCalled();
  });
});
