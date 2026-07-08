import { describe, expect, it, vi } from 'vitest';
import { DemoDataSeederService } from './demo-data-seeder.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function makeService(initial: {
  existingDemoContact?: { id: string } | null;
  existingInvoice?: { id: string; invoiceNumber: string } | null;
  businessCurrency?: string;
} = {}) {
  const createdContact = { id: 'contact_demo_1' };
  const createdInvoice = { id: 'invoice_demo_1', invoiceNumber: 'DEMO-A1B2C3' };

  const tx = {
    contact: {
      findFirst: vi.fn().mockResolvedValue(initial.existingDemoContact ?? null),
      create: vi.fn().mockResolvedValue(createdContact),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue({ currency: initial.businessCurrency ?? 'TTD' }),
    },
    invoice: {
      findFirst: vi.fn().mockImplementation(() =>
        Promise.resolve(initial.existingInvoice ?? null),
      ),
      create: vi.fn().mockResolvedValue(createdInvoice),
    },
  };

  const prisma = {
    client: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    },
  } as unknown as PrismaService;

  const service = new DemoDataSeederService(prisma);
  return { service, prisma, tx, createdContact, createdInvoice };
}

describe('DemoDataSeederService', () => {
  it('creates a sample contact and DRAFT invoice in business currency', async () => {
    const { service, tx, createdContact, createdInvoice } = makeService({ businessCurrency: 'USD' });

    const result = await service.seedDemoData('biz_1');

    expect(result.contactId).toBe(createdContact.id);
    expect(result.invoiceId).toBe(createdInvoice.id);
    expect(result.invoiceNumber).toMatch(/^DEMO-[0-9A-F]{6}$/);

    expect(tx.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          firstName: 'Sample',
          lastName: 'Client',
          email: 'sample-client@example.com',
          status: 'LEAD',
          source: 'demo',
        }),
      }),
    );

    expect(tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          contactId: createdContact.id,
          invoiceNumber: expect.stringMatching(/^DEMO-[0-9A-F]{6}$/),
          status: 'DRAFT',
          currency: 'USD',
          total: 500,
        }),
      }),
    );
  });

  it('falls back to TTD when business currency is unavailable', async () => {
    const { service, tx } = makeService({ businessCurrency: '' });
    await service.seedDemoData('biz_1');
    expect(tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: 'TTD' }),
      }),
    );
  });

  it('is idempotent and returns existing demo data', async () => {
    const existingContact = { id: 'contact_existing' };
    const existingInvoice = { id: 'invoice_existing', invoiceNumber: 'DEMO-007' };
    const { service, tx } = makeService({
      existingDemoContact: existingContact,
      existingInvoice,
    });

    const result = await service.seedDemoData('biz_1');

    expect(result).toEqual({
      contactId: existingContact.id,
      invoiceId: existingInvoice.id,
      invoiceNumber: existingInvoice.invoiceNumber,
    });
    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { businessId: 'biz_1', source: 'demo' },
      select: { id: true },
    });
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
