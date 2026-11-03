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
  const events = { emit: vi.fn((name: string, payload: any) => { emitted.push({ name, payload }); return true; }) };
  const writes: string[] = [];

  const tx = {
    invoice: {
      create: vi.fn(async ({ data }: any) => { writes.push('invoice.create'); return { id: 'inv_v18_1', ...data }; }),
    },
    payment: {
      create: vi.fn(async ({ data }: any) => { writes.push('payment.create'); return { id: 'pay_v18_1', ...data }; }),
    },
    inventoryStock: { findUnique: vi.fn(), update: vi.fn() },
    stockMovement: { create: vi.fn() },
    marketplaceOrder: {
      update: vi.fn(async ({ data }: any) => { writes.push('order.update'); return { ...stored, ...data }; }),
    },
  };

  const client = {
    marketplaceOrder: {
      findFirst: vi.fn(async () => stored),
      findUnique: vi.fn(async () => stored),
      update: vi.fn(async ({ data }: any) => { writes.push(`order.update:${Object.keys(data).sort().join(',')}`); return { ...stored, ...data }; }),
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
  );
  return { svc, emitted, writes, tx, client, revenuePosting };
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
    // Only the fulfilment status moves; nothing claims the money arrived.
    expect(h.writes).toEqual(['order.update:status']);
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
    expect(out?.paymentStatus).toBe('PAID');
  });

  it('SO-05 completeCheckout on an order already PAID writes nothing and emits nothing (control)', async () => {
    h = build(order({ paymentStatus: 'PAID', status: 'CONFIRMED' }));
    await h.svc.completeCheckout({ orderId: 'ord_v18_1', paymentRef: 'ref_v18' });
    expect(h.emitted).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });
});
