import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import {
  computeBalance,
  deriveStatusAfterPayment,
  isLegalTransition,
} from '../src/modules/commerce/invoice-workflow.service';

function makeWorkflowMock(prisma: any, events: any) {
  return {
    transition: vi.fn(async (invoiceId: string, to: string, extra: any = {}) => {
      // Same legality rule as the real workflow (DRAFT -> PAID is a 409).
      const current = prisma.client.invoice.findUnique({ where: { id: invoiceId } });
      if (current && !isLegalTransition(current.status, to as any)) {
        throw new ConflictException(`Illegal invoice status transition: ${current.status} -> ${to}`);
      }
      const data: any = { status: to };
      if (extra.sentAt) data.sentAt = extra.sentAt;
      if (extra.dueDate !== undefined) data.dueDate = extra.dueDate;
      if (to === 'PAID') data.paidAt = extra.paidAt ?? new Date();
      const updated = prisma.client.invoice.update({ where: { id: invoiceId }, data });
      if (to === 'PAID') {
        events.emit?.('invoice.paid', { invoice: updated, businessId: updated.businessId, eventName: 'invoice.paid' });
      } else if (to === 'SENT' || to === 'OVERDUE' || to === 'VOID') {
        events.emit?.(`invoice.${to.toLowerCase()}`, { invoice: updated, businessId: updated.businessId, status: to, eventName: `invoice.${to.toLowerCase()}` });
      }
      return updated;
    }),
    // Recomputes the status from the payment rows the way the real workflow
    // does, and queues invoice.paid on the caller's buffer (R0-PL-03).
    reconcileFromPayments: vi.fn(async (invoiceId: string, extra: any = {}) => {
      const inv = prisma.client.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
      const balance = computeBalance(Number(inv.total), inv.payments, inv.currency);
      const next = deriveStatusAfterPayment(inv.status, balance);
      if (next === inv.status) return { status: next, balance, changed: false };
      const updated = prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { status: next, ...(next === 'PAID' ? { paidAt: new Date() } : {}) },
      });
      if (next === 'PAID') {
        const evt = { name: 'invoice.paid', payload: { invoice: updated, businessId: updated.businessId, eventName: 'invoice.paid' } };
        if (extra.eventBuffer) extra.eventBuffer.push(evt);
        else events.emit?.(evt.name, evt.payload);
      }
      return { status: next, balance, changed: true };
    }),
    assertNewProviderEvent: vi.fn(async () => true),
    assertLegalTransition: vi.fn(),
    getBalance: vi.fn(),
  };
}

class PrismaMock implements Partial<PrismaService> {
  private invoices: any[] = [{ id: 'inv_1', businessId: 'biz_1', status: 'DRAFT', paidAt: null }];
  private payments: any[] = [];
  private products: any[] = [];
  private invoicesCreated: any[] = [];
  private quotes: any[] = [{ id: 'quote_1', businessId: 'biz_1', status: 'DRAFT', contactId: 'contact_1' }];

  /** Replace the seeded invoice's fields (status, total, contactId, ...). */
  setInvoice(patch: Record<string, unknown>) {
    Object.assign(this.invoices[0], patch);
  }

  /** Seed a payment row. */
  addPayment(row: Record<string, unknown>) {
    this.payments.push({ id: `pay_seed_${this.payments.length + 1}`, createdAt: new Date(), ...row });
  }

  /** Attach the invoice's payment rows when the query includes or selects them. */
  private withPayments(invoice: any, args: any) {
    if (!invoice) return null;
    const wantsPayments = args?.include?.payments || args?.select?.payments;
    return wantsPayments ? { ...invoice, payments: this.payments.filter((p) => p.invoiceId === invoice.id) } : invoice;
  }

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
    // V1-37: a document that names no currency is written in the business currency.
    business: {
      findUnique: vi.fn(() => ({ currency: 'TTD' })),
    },
    invoice: {
      update: vi.fn(({ where, data }: any) => {
        const invoice = this.invoices.find((i) => i.id === where.id);
        Object.assign(invoice, data);
        return invoice;
      }),
      findUnique: vi.fn((args: any) => {
        return this.withPayments(this.invoices.find((i) => i.id === args.where.id) || null, args);
      }),
      findFirst: vi.fn((args: any) => {
        const { where } = args;
        const invoice = this.invoices.find(
          (i) => i.id === where.id && (!where.businessId || i.businessId === where.businessId) && !i.deletedAt,
        );
        return this.withPayments(invoice || null, args);
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
    payment: {
      count: vi.fn(({ where }: any = {}) => this.payments.filter((p) => !where?.invoiceId || p.invoiceId === where.invoiceId).length),
      findMany: vi.fn(({ where }: any = {}) => this.payments.filter((p) => !where?.invoiceId || p.invoiceId === where.invoiceId)),
      findFirst: vi.fn(({ where }: any = {}) =>
        this.payments.find((p) => Object.entries(where ?? {}).every(([k, v]) => p[k] === v)) ?? null,
      ),
      create: vi.fn(({ data }: any) => {
        const row = { ...data, id: `pay_${this.payments.length + 1}`, createdAt: new Date() };
        this.payments.push(row);
        return row;
      }),
    },
    // The payment transaction runs on the same in-memory store.
    $transaction: vi.fn(async (fn: any) => fn(this.client)),
    // CommerceService.lockInvoiceForPayment: SELECT status, business_id, deleted_at ... FOR NO KEY UPDATE.
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, invoiceId: string) => {
      const inv = this.invoices.find((i) => i.id === invoiceId);
      return inv ? [{ status: inv.status, businessId: inv.businessId, deletedAt: inv.deletedAt ?? null }] : [];
    }),
  };
}

function makeService(prisma: PrismaService, events: EventEmitter2, crm: any) {
  const workflow = makeWorkflowMock(prisma, events);
  const revenuePosting = { onInvoiceFinalized: vi.fn(), onInvoiceVoided: vi.fn(), onPaymentRecorded: vi.fn(), onPaymentRefunded: vi.fn() };
  const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any, workflow as any, { createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn(), bulkUpdateProducts: vi.fn(), listProducts: vi.fn(), listPublicProducts: vi.fn(), deactivateProduct: vi.fn() } as any, { upsertStorefrontContact: vi.fn(), attachVisitorToContact: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn(), firstTouchFor: vi.fn() } as any, revenuePosting as any);
  return { service, workflow, revenuePosting };
}

describe('CommerceService', () => {
  it('emits invoice.paid event on markInvoicePaid', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const mock = new PrismaMock();
    // R0-PL-04: a DRAFT invoice can not be marked paid (409, pinned below); the
    // event is proven on an issued invoice.
    mock.setInvoice({ status: 'SENT', total: 100, currency: 'TTD' });
    const prisma = mock as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const { service } = makeService(prisma, events, crm);

    const invoice = await service.markInvoicePaid('inv_1');

    expect(invoice!.status).toBe('PAID');
    expect(emit).toHaveBeenCalledWith(
      'invoice.paid',
      expect.objectContaining({
        businessId: 'biz_1',
        invoice: expect.objectContaining({ id: 'inv_1', status: 'PAID' }),
      }),
    );
  });

  describe('markInvoicePaid records the remaining balance through recordPayment (R0-PL-04, G2)', () => {
    function setup(invoice: Record<string, unknown>, payments: Array<Record<string, unknown>> = []) {
      const emit = vi.fn();
      const events = { emit } as unknown as EventEmitter2;
      const mock = new PrismaMock();
      mock.setInvoice({ total: 100, currency: 'TTD', contactId: 'contact_1', ...invoice });
      for (const p of payments) mock.addPayment({ invoiceId: 'inv_1', businessId: 'biz_1', currency: 'TTD', ...p });
      const crm = { logContactEvent: vi.fn() } as any;
      const built = makeService(mock as unknown as PrismaService, events, crm);
      const recordSpy = vi.spyOn(built.service, 'recordPayment');
      return { ...built, prisma: mock as any, emit, crm, recordSpy };
    }

    it('SENT with no payments: one SUCCESSFUL manual payment for the total, posted in the payment transaction, recorded by the actor', async () => {
      const { service, prisma, revenuePosting, workflow, recordSpy, emit } = setup({ status: 'SENT' });

      const invoice = await service.markInvoicePaid('inv_1', 'user_1', 'biz_1');

      expect(invoice!.status).toBe('PAID');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith(
        'inv_1',
        'biz_1',
        // R0-PL-04 review (ST-PL04-1): no client-shaped idempotency key; the
        // slot is server-built and passed as an option, never in `input`.
        { amount: 100, method: 'MANUAL' },
        expect.objectContaining({ actorId: 'user_1', providerPaymentId: expect.stringMatching(/^manual_inv_1_markpaid_[0-9a-f]{32}$/) }),
      );
      expect(prisma.client.payment.create).toHaveBeenCalledTimes(1);
      const data = prisma.client.payment.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        invoiceId: 'inv_1',
        businessId: 'biz_1',
        amount: 100,
        status: 'SUCCESSFUL',
        provider: 'manual',
        method: 'MANUAL',
        recordedBy: 'user_1',
      });
      // R0-PL-04 review (ST-PL04-1 / ST-PL04-2): mark-paid's own random slot.
      // Not a client-key slot (manual_<inv>_key_), so no client row can be
      // replayed in its place, and not predictable, so no row can squat it.
      // Concurrent mark-paids are serialized by the invoice lock instead
      // (payments-mark-paid MP-09).
      expect(data.providerPaymentId).toMatch(/^manual_inv_1_markpaid_[0-9a-f]{32}$/);
      expect(data.providerPaymentId).not.toMatch(/_key_|_ref_/);
      // G2: the row is posted, in the payment transaction, attributed to the actor.
      expect(revenuePosting.onPaymentRecorded).toHaveBeenCalledTimes(1);
      expect(revenuePosting.onPaymentRecorded).toHaveBeenCalledWith(
        prisma.client.payment.create.mock.results[0].value.id,
        expect.objectContaining({ tx: expect.anything(), createdById: 'user_1' }),
      );
      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(workflow.reconcileFromPayments).toHaveBeenCalledWith('inv_1', expect.objectContaining({ tx: expect.anything() }));
      // The status comes from the payment rows, not from a bare transition.
      expect(workflow.transition).not.toHaveBeenCalled();
      expect(emit.mock.calls.filter(([name]) => name === 'invoice.paid')).toHaveLength(1);
    });

    it('after a 60 partial on a 100 invoice: one 40 balancing payment, posted; the rows now say PAID', async () => {
      const { service, prisma, revenuePosting, recordSpy } = setup(
        { status: 'PARTIALLY_PAID' },
        [{ amount: 60, status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: 'seed_60' }],
      );

      const invoice = await service.markInvoicePaid('inv_1', 'user_1', 'biz_1');

      expect(invoice!.status).toBe('PAID');
      expect(recordSpy).toHaveBeenCalledWith(
        'inv_1',
        'biz_1',
        { amount: 40, method: 'MANUAL' },
        expect.objectContaining({ actorId: 'user_1', providerPaymentId: expect.stringMatching(/^manual_inv_1_markpaid_[0-9a-f]{32}$/) }),
      );
      expect(prisma.client.payment.create).toHaveBeenCalledTimes(1);
      expect(prisma.client.payment.create.mock.calls[0][0].data).toMatchObject({ amount: 40, status: 'SUCCESSFUL', recordedBy: 'user_1' });
      expect(revenuePosting.onPaymentRecorded).toHaveBeenCalledTimes(1);
      const rows = prisma.client.payment.findMany({ where: { invoiceId: 'inv_1' } });
      expect(computeBalance(100, rows)).toMatchObject({ net: 100, remaining: 0, isFullyPaid: true });
    });

    it('already PAID: idempotent; no payment, no posting, no transition, no event, no timeline entry', async () => {
      const paidAt = new Date('2026-10-01T00:00:00Z');
      const { service, prisma, revenuePosting, workflow, recordSpy, emit, crm } = setup(
        { status: 'PAID', paidAt },
        [{ amount: 100, status: 'SUCCESSFUL', provider: 'manual', method: 'MANUAL', providerPaymentId: 'seed_100' }],
      );

      const invoice = await service.markInvoicePaid('inv_1', 'user_1', 'biz_1');

      expect(invoice).toMatchObject({ id: 'inv_1', status: 'PAID', paidAt });
      expect(recordSpy).not.toHaveBeenCalled();
      expect(prisma.client.payment.create).not.toHaveBeenCalled();
      expect(revenuePosting.onPaymentRecorded).not.toHaveBeenCalled();
      expect(workflow.transition).not.toHaveBeenCalled();
      expect(workflow.reconcileFromPayments).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
      expect(crm.logContactEvent).not.toHaveBeenCalled();
    });

    it('DRAFT: 409; nothing is written or posted', async () => {
      const { service, prisma, revenuePosting, emit, crm } = setup({ status: 'DRAFT' });

      await expect(service.markInvoicePaid('inv_1', 'user_1', 'biz_1')).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.client.payment.create).not.toHaveBeenCalled();
      expect(revenuePosting.onPaymentRecorded).not.toHaveBeenCalled();
      expect(prisma.client.invoice.findUnique({ where: { id: 'inv_1' } }).status).toBe('DRAFT');
      expect(emit).not.toHaveBeenCalled();
      expect(crm.logContactEvent).not.toHaveBeenCalled();
    });

    it('R0-PL-04 review (CR-PL04-1): a manually refunded (flipped) row on the invoice -> 409 before any write; computeBalance would have asked for 160', async () => {
      const { service, prisma, revenuePosting, recordSpy, emit, crm } = setup(
        { status: 'PARTIALLY_PAID' },
        [{ amount: 60, status: 'REFUNDED', provider: 'cash', method: 'cash', providerPaymentId: 'seed_60_refunded' }],
      );
      expect(computeBalance(100, prisma.client.payment.findMany({ where: { invoiceId: 'inv_1' } })).remaining).toBe(160);

      await expect(service.markInvoicePaid('inv_1', 'user_1', 'biz_1')).rejects.toBeInstanceOf(ConflictException);

      expect(recordSpy).not.toHaveBeenCalled();
      expect(prisma.client.payment.create).not.toHaveBeenCalled();
      expect(revenuePosting.onPaymentRecorded).not.toHaveBeenCalled();
      expect(prisma.client.invoice.findUnique({ where: { id: 'inv_1' } }).status).toBe('PARTIALLY_PAID');
      expect(emit).not.toHaveBeenCalled();
      expect(crm.logContactEvent).not.toHaveBeenCalled();
    });

    it('R0-PL-04 review (ST-PL04-1 / CR-PL04-2): a write that leaves the invoice short of PAID -> 409; no invoice.paid timeline entry', async () => {
      const { service, prisma, recordSpy, crm } = setup({ status: 'SENT' });
      // Stand-in for a write that did not settle the invoice (the pre-repair replay).
      recordSpy.mockResolvedValue({} as any);

      await expect(service.markInvoicePaid('inv_1', 'user_1', 'biz_1')).rejects.toBeInstanceOf(ConflictException);

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(prisma.client.invoice.findUnique({ where: { id: 'inv_1' } }).status).toBe('SENT');
      expect(crm.logContactEvent).not.toHaveBeenCalled();
    });

    it('R0-PL-04 review (ST-PL04-1 / ST-PL04-2): each mark-paid write gets a fresh random slot, never a client-key slot', async () => {
      const first = setup({ status: 'SENT' });
      const second = setup({ status: 'SENT' });

      await first.service.markInvoicePaid('inv_1', 'user_1', 'biz_1');
      await second.service.markInvoicePaid('inv_1', 'user_1', 'biz_1');

      const a = first.prisma.client.payment.create.mock.calls[0][0].data.providerPaymentId;
      const b = second.prisma.client.payment.create.mock.calls[0][0].data.providerPaymentId;
      expect(a).toMatch(/^manual_inv_1_markpaid_[0-9a-f]{32}$/);
      expect(b).toMatch(/^manual_inv_1_markpaid_[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    });
  });

  it('creates and lists products', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any, makeWorkflowMock(prisma, events) as any, { createProduct: vi.fn(async (i: any) => ({ id: 'p_1', businessId: i.businessId, name: i.name, price: i.price, currency: i.currency ?? 'TTD' })), updateProduct: vi.fn(), deleteProduct: vi.fn(), bulkUpdateProducts: vi.fn(), listProducts: vi.fn(async (bid: string) => ({ data: [{ id: 'p_1', businessId: bid, name: 'Plan', price: 10 }], total: 1, page: 1, pageSize: 50, totalPages: 1 })), listPublicProducts: vi.fn(), deactivateProduct: vi.fn() } as any, { upsertStorefrontContact: vi.fn(), attachVisitorToContact: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn(), firstTouchFor: vi.fn() } as any, { onInvoiceFinalized: vi.fn(), onInvoiceVoided: vi.fn(), onPaymentRecorded: vi.fn(), onPaymentRefunded: vi.fn() } as any);

    await service.createProduct({ businessId: 'biz_1', name: 'Plan', price: 10 });
    const products = await service.listProducts('biz_1');

    expect(products.data).toHaveLength(1);
    expect(products.data[0].name).toBe('Plan');
  });

  it('creates invoice for service', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { logContactEvent: vi.fn() } as any;
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any, makeWorkflowMock(prisma, events) as any, { createProduct: vi.fn(async (i: any) => ({ id: 'p_1', businessId: i.businessId, name: i.name, price: i.price, currency: i.currency ?? 'TTD' })), updateProduct: vi.fn(), deleteProduct: vi.fn(), bulkUpdateProducts: vi.fn(), listProducts: vi.fn(async (bid: string) => ({ data: [{ id: 'p_1', businessId: bid, name: 'Plan', price: 10 }], total: 1, page: 1, pageSize: 50, totalPages: 1 })), listPublicProducts: vi.fn(), deactivateProduct: vi.fn() } as any, { upsertStorefrontContact: vi.fn(), attachVisitorToContact: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn(), firstTouchFor: vi.fn() } as any, { onInvoiceFinalized: vi.fn(), onInvoiceVoided: vi.fn(), onPaymentRecorded: vi.fn(), onPaymentRefunded: vi.fn() } as any);

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
    const service = new CommerceService(prisma, events, crm, { checkAndEnforceLimit: vi.fn() } as any, { invalidateCache: vi.fn() } as any, makeWorkflowMock(prisma, events) as any, { createProduct: vi.fn(async (i: any) => ({ id: 'p_1', businessId: i.businessId, name: i.name, price: i.price, currency: i.currency ?? 'TTD' })), updateProduct: vi.fn(), deleteProduct: vi.fn(), bulkUpdateProducts: vi.fn(), listProducts: vi.fn(async (bid: string) => ({ data: [{ id: 'p_1', businessId: bid, name: 'Plan', price: 10 }], total: 1, page: 1, pageSize: 50, totalPages: 1 })), listPublicProducts: vi.fn(), deactivateProduct: vi.fn() } as any, { upsertStorefrontContact: vi.fn(), attachVisitorToContact: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn(), firstTouchFor: vi.fn() } as any, { onInvoiceFinalized: vi.fn(), onInvoiceVoided: vi.fn(), onPaymentRecorded: vi.fn(), onPaymentRefunded: vi.fn() } as any);

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
