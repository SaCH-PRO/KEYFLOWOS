import { describe, it, expect, vi } from 'vitest';
import { FulfillmentRoutingService } from './fulfillment-routing.service';

function makeService(overrides?: {
  emailSend?: ReturnType<typeof vi.fn>;
  notificationFindMany?: ReturnType<typeof vi.fn>;
}) {
  const emailSend = overrides?.emailSend ?? vi.fn().mockResolvedValue(undefined);
  const notificationFindMany = overrides?.notificationFindMany ?? vi.fn().mockResolvedValue([]);
  const prisma = {
    client: {
      notification: { findMany: notificationFindMany },
      business: { findFirst: vi.fn().mockResolvedValue({ email: 'owner@store.test', name: 'Test Store' }) },
    },
  } as any;
  const events = { emit: vi.fn() } as any;
  const emailService = { send: emailSend } as any;
  const expensePosting = { onProductSold: vi.fn() } as any;
  return {
    service: new FulfillmentRoutingService(prisma, emailService, events, expensePosting),
    emailSend,
    notificationFindMany,
  };
}

describe('W1F-SETTLE-NO-STOCK (P130 R1 routing regressions)', () => {
  it('[R1-COR-01] routeLocalStock skips stock reservation and email for checkout-shortfall lines even when single-line qty <= available', async () => {
    const { service, emailSend } = makeService();
    const inventoryUpdate = vi.fn();
    const routeCreate = vi.fn(async ({ data }: any) => ({ id: 'route_1', ...data }));
    const tx = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          inventoryMode: 'tracked',
          _count: { inventoryStocks: 1 },
        }),
      },
      inventoryStock: {
        findFirst: vi.fn().mockResolvedValue({ id: 'stk_1', warehouseId: 'wh_1', quantity: 3, reserved: 0 }),
        update: inventoryUpdate,
      },
      fulfillmentRoute: { create: routeCreate },
    } as any;
    const afterCommit: Array<() => Promise<void>> = [];

    const route = await (service as any).routeLocalStock(
      tx,
      afterCommit,
      'biz_1',
      'ord_1',
      { id: 'item_1', productId: 'prod_dup', quantity: 2, name: 'Widget' },
      { id: 'lst_1' },
      ['stk_1'],
      new Set(['prod_dup']),
    );

    expect(route.status).toBe('FAILED');
    expect(route.metadata).toEqual({ inventoryMode: 'tracked', stockNotDecrementedAtCheckout: true });
    expect(inventoryUpdate).not.toHaveBeenCalled();
    expect(afterCommit).toHaveLength(0);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('[R1-COR-01] routeHybrid skips local stock reservation and takes dropship/preorder fallback for checkout-shortfall lines', async () => {
    const { service } = makeService();
    const inventoryUpdate = vi.fn();
    const routeCreate = vi.fn(async ({ data }: any) => ({ id: 'route_hyb', ...data }));
    const tx = {
      inventoryStock: {
        findFirst: vi.fn().mockResolvedValue({ id: 'stk_1', warehouseId: 'wh_1', quantity: 3, reserved: 0 }),
        update: inventoryUpdate,
      },
      productSourceLink: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      preOrder: {
        create: vi.fn().mockResolvedValue({ id: 'pre_1' }),
      },
      fulfillmentRoute: { create: routeCreate },
    } as any;
    const afterCommit: Array<() => Promise<void>> = [];

    const route = await (service as any).routeHybrid(
      tx,
      afterCommit,
      'biz_1',
      'ord_1',
      { id: 'item_1', productId: 'prod_hyb', quantity: 2, name: 'Hybrid Item', unitPrice: 10 },
      { id: 'lst_1', supplierName: null },
      { id: 'ord_1', businessId: 'biz_1', currency: 'USD' },
      ['stk_1'],
      new Set(['prod_hyb']),
    );

    expect(route.strategy).toBe('PREORDER');
    expect(inventoryUpdate).not.toHaveBeenCalled();
  });

  it('[R1-COR-02] routeManual suppresses seller_low_stock email for checkout-alerted products (both via alreadyAlertedProductIds and defense-in-depth notification check)', async () => {
    const emailSend = vi.fn().mockResolvedValue(undefined);
    const notificationFindMany = vi.fn().mockResolvedValue([
      { data: { orderId: 'ord_m1', products: [{ productId: 'prod_manual_alerted' }] } },
    ]);
    const { service } = makeService({ emailSend, notificationFindMany });
    const routeCreate = vi.fn(async ({ data }: any) => ({ id: 'route_m', ...data }));
    const tx = { fulfillmentRoute: { create: routeCreate } } as any;

    // 1. Metadata alreadyAlertedProductIds suppresses scheduling the email at all
    const afterCommit1: Array<() => Promise<void>> = [];
    await (service as any).routeManual(
      tx,
      afterCommit1,
      'biz_1',
      'ord_m1',
      { id: 'item_m1', productId: 'prod_manual_alerted', quantity: 2, name: 'Manual Tracked' },
      { id: 'lst_m1' },
      new Set(['prod_manual_alerted']),
    );
    expect(afterCommit1).toHaveLength(0);

    // 2. Defense-in-depth: even without metadata set, existing store_order.stock_not_decremented notification suppresses email
    const afterCommit2: Array<() => Promise<void>> = [];
    await (service as any).routeManual(
      tx,
      afterCommit2,
      'biz_1',
      'ord_m1',
      { id: 'item_m1', productId: 'prod_manual_alerted', quantity: 2, name: 'Manual Tracked' },
      { id: 'lst_m1' },
      new Set(),
    );
    expect(afterCommit2).toHaveLength(1);
    await afterCommit2[0]();
    await new Promise((r) => setImmediate(r));
    expect(emailSend).not.toHaveBeenCalled();

    // 3. Control: a different, non-alerted MANUAL product still sends seller_low_stock
    const afterCommit3: Array<() => Promise<void>> = [];
    await (service as any).routeManual(
      tx,
      afterCommit3,
      'biz_1',
      'ord_m1',
      { id: 'item_m2', productId: 'prod_other', quantity: 1, name: 'Normal Manual' },
      { id: 'lst_m2' },
      new Set(),
    );
    expect(afterCommit3).toHaveLength(1);
    await afterCommit3[0]();
    await new Promise((r) => setImmediate(r));
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'seller_low_stock' }));
  });
});
