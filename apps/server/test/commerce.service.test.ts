import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private invoices: any[] = [{ id: 'inv_1', businessId: 'biz_1', status: 'DRAFT', paidAt: null }];
  private products: any[] = [];
  client = {
    product: {
      findMany: vi.fn(({ where }: any) =>
        this.products.filter((p) => p.businessId === where.businessId && p.deletedAt === null),
      ),
      create: vi.fn(({ data }: any) => {
        const item = { ...data, id: `prod_${this.products.length + 1}`, deletedAt: null, createdAt: new Date() };
        this.products.push(item);
        return item;
      }),
    },
    invoice: {
      update: vi.fn(({ where, data }: any) => {
        const invoice = this.invoices.find((i) => i.id === where.id);
        Object.assign(invoice, data);
        return invoice;
      }),
    },
  };
}

describe('CommerceService', () => {
  it('emits invoice.paid event on markInvoicePaid', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new CommerceService(prisma, events);

    const invoice = await service.markInvoicePaid('inv_1');

    expect(invoice.status).toBe('PAID');
    expect(emit).toHaveBeenCalledWith('invoice.paid', { invoiceId: 'inv_1', businessId: 'biz_1' });
  });

  it('creates and lists products', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new CommerceService(prisma, events);

    await service.createProduct({ businessId: 'biz_1', name: 'Plan', price: 10 });
    const products = await service.listProducts('biz_1');

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Plan');
  });
});
