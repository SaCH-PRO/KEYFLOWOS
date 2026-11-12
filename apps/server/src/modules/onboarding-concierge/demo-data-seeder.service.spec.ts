import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DemoDataSeederService, DEMO_SEED_CONFLICT } from './demo-data-seeder.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function makeService(initial: {
  existingDemoContact?: { id: string } | null;
  existingInvoice?: { id: string; invoiceNumber: string } | null;
  businessCurrency?: string;
  /** A live contact that is not the demo contact holding the sample email. */
  sampleEmailHolder?: { id: string } | null;
} = {}) {
  const createdContact = { id: 'contact_demo_1' };
  const createdInvoice = { id: 'invoice_demo_1', invoiceNumber: 'DEMO-A1B2C3' };

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    contact: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { source?: string; emailNormalized?: string } }) =>
        Promise.resolve(where.source === 'demo' ? initial.existingDemoContact ?? null : initial.sampleEmailHolder ?? null),
      ),
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

  // Review SDO-SEC-1 / CR-1: the completion door (with its tx) ran the create
  // unchecked, so the live unique's P2002 aborted completion (500, every retry).
  it('takes the business row lock before its first read (seeds queue instead of racing on the unique)', async () => {
    const { service, tx } = makeService();
    await service.seedDemoData('biz_1', tx as never);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, businessId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(strings.join('?')).toMatch(/FROM businesses WHERE id = \? FOR NO KEY UPDATE/);
    expect(businessId).toBe('biz_1');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.contact.findFirst.mock.invocationCallOrder[0]);
  });

  it('completion door: a live non-demo contact holding the sample email skips the seed (null) and writes nothing', async () => {
    const { service, tx } = makeService({ sampleEmailHolder: { id: 'contact_manual' } });
    await expect(service.seedDemoData('biz_1', tx as never)).resolves.toBeNull();
    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { businessId: 'biz_1', emailNormalized: 'sample-client@example.com', deletedAt: null },
      select: { id: true },
    });
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it('own transaction: the same holder answers 409 DEMO_SEED_CONFLICT at once (no retry) and writes nothing', async () => {
    const { service, prisma, tx } = makeService({ sampleEmailHolder: { id: 'contact_manual' } });
    const err = await service.seedDemoData('biz_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: DEMO_SEED_CONFLICT });
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it('completion door: any other error still propagates (only the sample-email refusal is skipped)', async () => {
    const { service, tx } = makeService();
    tx.contact.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.seedDemoData('biz_1', tx as never)).rejects.toMatchObject({ code: 'P2002' });
  });
});
