/**
 * W1F-ORDER-TRANSITIONS R1 review regression tests:
 *   - R1-SEC-01: PATCH /marketplace status trims leading/trailing whitespace on every status
 *     (e.g. ' shipped ' -> stored 'shipped', emits store_order.shipped).
 *   - R1-SEC-02: fulfillOrder('add_tracking') never overwrites order.status; all other
 *     status-writing fulfillOrder actions compare-and-set on (id, businessId, status).
 *   - R1-COR-01: namedOrderStatus guards against nullish/blank input without throwing.
 */
import { describe, it, expect, vi } from 'vitest';
import { MarketplaceService } from './marketplace.service';
import { namedOrderStatus } from './fulfillment-routing.service';

const BIZ = 'biz_r1_ot';
const ORDER_ID = 'ord_r1_ot';

function buildMarketplaceHarness(storedOrder: Record<string, unknown>) {
  let current = { ...storedOrder };
  const emitted: Array<{ name: string; payload: any }> = [];

  const tx = {
    marketplaceOrder: {
      update: vi.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return current;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== current.id || where.businessId !== current.businessId || where.status !== current.status) {
          return { count: 0 };
        }
        current = { ...current, ...data };
        return { count: 1 };
      }),
      findFirstOrThrow: vi.fn(async () => current),
    },
    $executeRaw: vi.fn(async () => 1),
  };

  const client = {
    marketplaceOrder: {
      findFirst: vi.fn(async () => current),
      findFirstOrThrow: vi.fn(async () => current),
      update: vi.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return current;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== current.id || where.businessId !== current.businessId || where.status !== current.status) {
          return { count: 0 };
        }
        current = { ...current, ...data };
        return { count: 1 };
      }),
    },
    invoice: { findFirst: vi.fn(async () => null) },
    shipment: { create: vi.fn(async ({ data }: any) => ({ id: 'shp_1', ...data })), update: vi.fn() },
    fulfillmentRoute: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const events = {
    emit: vi.fn((name: string, payload: any) => {
      emitted.push({ name, payload });
      return true;
    }),
  };

  const moduleRef = {
    get: vi.fn(() => ({
      hasCheckoutInvoice: vi.fn(async () => false),
      bookShippingExpenseOnce: vi.fn(async () => undefined),
    })),
  };

  const svc = new MarketplaceService(
    { client } as any,
    { send: vi.fn(async () => null) } as any,
    { createPickPackTasks: vi.fn(async () => undefined) } as any,
    events as any,
    {} as any,
    moduleRef as any,
  );

  return {
    svc,
    client,
    tx,
    emitted,
    moveStored: (patch: Record<string, unknown>) => {
      current = { ...current, ...patch };
    },
    getCurrent: () => current,
  };
}

describe('W1F-ORDER-TRANSITIONS R1 review regression tests', () => {
  it("R1-SEC-01: updateOrderStatus trims ' shipped ' to 'shipped' and emits store_order.shipped", async () => {
    const h = buildMarketplaceHarness({
      id: ORDER_ID,
      businessId: BIZ,
      orderNumber: 'ORD-R1-1',
      type: 'STANDARD',
      status: 'routed',
      paymentStatus: 'PAID',
      items: [],
      shipments: [],
    });

    const out = await h.svc.updateOrderStatus(BIZ, ORDER_ID, ' shipped ', undefined, 'actor_1');
    expect(out.status).toBe('shipped');
    expect(h.client.marketplaceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, businessId: BIZ, status: 'routed' },
      data: { status: 'shipped' },
    });
    expect(h.emitted.map((e) => e.name)).toEqual(['store_order.shipped']);
  });

  it("R1-SEC-02: fulfillOrder('add_tracking') never writes order.status and never rewinds a concurrent status change", async () => {
    const h = buildMarketplaceHarness({
      id: ORDER_ID,
      businessId: BIZ,
      orderNumber: 'ORD-R1-2',
      type: 'STANDARD',
      status: 'picking_packing',
      paymentStatus: 'PAID',
      items: [],
      shipments: [],
    });

    // Simulate a concurrent ship committing after add_tracking read order.status = 'picking_packing'.
    h.client.shipment.create.mockImplementationOnce(async ({ data }: any) => {
      h.moveStored({ status: 'shipped' });
      return { id: 'shp_r1', ...data };
    });

    const out = await h.svc.fulfillOrder(BIZ, ORDER_ID, 'add_tracking', { carrier: 'DHL', trackingNumber: 'TRK-R1' }, 'actor_1');
    expect(out.status).toBe('shipped');
    expect(h.tx.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(h.tx.marketplaceOrder.updateMany).not.toHaveBeenCalled();
  });

  it("R1-SEC-02: status-writing fulfillOrder actions (e.g. 'deliver', 'complete') CAS on (id, businessId, status) and throw 409 when status changed", async () => {
    const h = buildMarketplaceHarness({
      id: ORDER_ID,
      businessId: BIZ,
      orderNumber: 'ORD-R1-3',
      type: 'STANDARD',
      status: 'shipped',
      paymentStatus: 'PAID',
      items: [],
      shipments: [],
    });

    // Concurrent deliver wins before this deliver reaches its CAS write.
    h.client.fulfillmentRoute.updateMany.mockImplementationOnce(async () => {
      h.moveStored({ status: 'delivered' });
      return { count: 0 };
    });

    await expect(h.svc.fulfillOrder(BIZ, ORDER_ID, 'deliver', {}, 'actor_1')).rejects.toMatchObject({ status: 409 });
    expect(h.tx.marketplaceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, businessId: BIZ, status: 'shipped' },
      data: { status: 'delivered' },
    });
    expect(h.tx.marketplaceOrder.update).not.toHaveBeenCalled();
    expect(h.emitted).toEqual([]);
  });

  it('R1-COR-01: namedOrderStatus safely returns undefined for null, undefined, and blank strings', () => {
    expect(namedOrderStatus(null)).toBeUndefined();
    expect(namedOrderStatus(undefined)).toBeUndefined();
    expect(namedOrderStatus('')).toBeUndefined();
    expect(namedOrderStatus('   ')).toBeUndefined();
    expect(namedOrderStatus(' Shipped ')).toBe('shipped');
  });
});
