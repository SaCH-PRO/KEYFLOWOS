import { describe, expect, it, vi } from 'vitest';
import { DemoDataSeederService } from './demo-data-seeder.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function makeService(initial: {
  existingDemoContact?: { id: string } | null;
  existingInvoice?: { id: string; invoiceNumber: string } | null;
  latestInvoice?: { invoiceNumber: string } | null;
} = {}) {
  const createdContact = { id: 'contact_demo_1' };
  const createdInvoice = { id: 'invoice_demo_1', invoiceNumber: 'DEMO-001' };

  const tx = {
    contact: {
      create: vi.fn().mockResolvedValue(createdContact),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(initial.latestInvoice ?? null),
      create: vi.fn().mockResolvedValue(createdInvoice),
    },
  };

  const prisma = {
    client: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
      contact: {
        findFirst: vi.fn().mockResolvedValue(initial.existingDemoContact ?? null),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue(initial.existingInvoice ?? null),
      },
    },
  } as unknown as PrismaService;

  const service = new DemoDataSeederService(prisma);
  return { service, prisma, tx, createdContact, createdInvoice };
}

describe('DemoDataSeederService', () => {
  it('creates a sample contact and invoice', async () => {
    const { service, tx, createdContact, createdInvoice } = makeService();

    const result = await service.seedDemoData('biz_1');

    expect(result.contactId).toBe(createdContact.id);
    expect(result.invoiceId).toBe(createdInvoice.id);
    expect(result.invoiceNumber).toBe('DEMO-001');

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
          invoiceNumber: 'DEMO-001',
          currency: 'TTD',
          total: 500,
        }),
      }),
    );
  });

  it('is idempotent and returns existing demo data', async () => {
    const existingContact = { id: 'contact_existing' };
    const existingInvoice = { id: 'invoice_existing', invoiceNumber: 'DEMO-007' };
    const { service, tx, prisma } = makeService({
      existingDemoContact: existingContact,
      existingInvoice,
    });

    const result = await service.seedDemoData('biz_1');

    expect(result).toEqual({
      contactId: existingContact.id,
      invoiceId: existingInvoice.id,
      invoiceNumber: existingInvoice.invoiceNumber,
    });
    expect(prisma.client.contact.findFirst).toHaveBeenCalledWith({
      where: { businessId: 'biz_1', source: 'demo' },
      select: { id: true },
    });
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
