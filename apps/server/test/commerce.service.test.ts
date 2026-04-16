import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private invoices: any[] = [{ id: 'inv_1', businessId: 'biz_1', status: 'DRAFT', paidAt: null }];
  private products: any[] = [];
  private invoicesCreated: any[] = [];
  private quotes: any[] = [{ id: 'quote_1', businessId: 'biz_1', status: 'DRAFT', contactId: 'contact_1' }];
  client: any = {
    product: {
      findMany: vi.fn(({ where }: any) =>
        this.products.filter((p) => p.businessId === where.businessId && p.deletedAt === null),
      ),
      count: vi.fn(({ where }: any) =>
        this.products.filter((p) => p.businessId === where.businessId && p.deletedAt === null).length,
      ),
      create: vi.fn(({ data }: any) => {
        const item = { ...data, id: `prod_${this.products.length + 1}`, deletedAt: null, createdAt: new Date() };
        this.products.push(item);
        return item;
      }),
    },
    membership: {
      findFirst: vi.fn(() => ({ id: 'mem_1', businessId: 'biz_1', userId: 'user_1', role: 'OWNER' })),
    },
    invoice: {
      update: vi.fn(({ where, data }: any) => {
        const invoice = this.invoices.find((i) => i.id === where.id);
        Object.assign(invoice, data);
        return invoice;
      }),
      findUnique: vi.fn(({ where }: any) => {
        return this.invoices.find((i) => i.id === where.id) || null;
      }),
      create: vi.fn(({ data }: any) => {
        const invoice = {
          ...data,
          id: `inv_${this.invoicesCreated.length + 2}`,
          items: (data.items?.create as any[]) ?? [],
        };
        this.invoicesCreated.push(invoice);
        return invoice;
      }),
    },
    quote: {
      update: vi.fn(({ where, data }: any) => {
        const quote = this.quotes.find((q) => q.id === where.id);
        Object.assign(quote, data);
        return quote;
      }),
      findUnique: vi.fn(({ where }: any) => {
        return this.quotes.find((q) => q.id === where.id) || null;
      }),
    },
  };
}

describe('CommerceService', () => {
  it('emits invoice.paid event on markInvoicePaid', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any);

    const invoice = await service.markInvoicePaid('inv_1');

    expect(invoice.status).toBe('PAID');
    expect(emit).toHaveBeenCalledWith(
      'invoice.paid',
      expect.objectContaining({
        businessId: 'biz_1',
        invoice: expect.objectContaining({ id: 'inv_1', status: 'PAID' }),
      }),
    );
  });

  it('creates and lists products', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any);

    await service.createProduct({ businessId: 'biz_1', name: 'Plan', price: 10 });
    const products = await service.listProducts('biz_1');

    expect(products.data).toHaveLength(1);
    expect(products.data[0].name).toBe('Plan');
  });

  it('creates invoice for service', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any);

    const invoice = await service.createInvoiceForService('biz_1', 'contact_1', {
      id: 'service_1',
      name: 'Consult',
      price: 50,
      duration: 60,
      businessId: 'biz_1',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      currency: 'TTD',
    } as any);

    expect(invoice.status).toBe('DRAFT');
    expect(invoice.items?.[0].description).toBe('Consult');
  });

  it('updates quote status and logs CRM event', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any);

    const quote = await service.updateQuoteStatus({ quoteId: 'quote_1', status: 'ACCEPTED', actorId: 'user_1' });

    expect(quote.status).toBe('ACCEPTED');
    expect(crm.logContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact_1',
        type: 'quote.accepted',
        actorType: 'USER',
        actorId: 'user_1',
      }),
    );
  });
});
