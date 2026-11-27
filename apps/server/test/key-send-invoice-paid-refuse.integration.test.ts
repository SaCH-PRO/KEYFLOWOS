/**
 * FU-KEY-SEND-INVOICE-PAID-REFUSE (V1-92, P153; P2 launch-track, S; Journey K, D-248;
 * prefix `v92b_`): KEY's `commerce_send_invoice` refuses a PAID invoice, a soft-deleted
 * invoice, a soft-deleted contact, and any terminal/non-sendable invoice status BEFORE
 * creating any payment link, sending any email, changing invoice status, or logging
 * activity (REAL Postgres, REAL PrismaService, REAL CommerceService, REAL
 * InvoiceWorkflowService, REAL FlowOrchestratorService).
 *
 * Before this packet:
 *   - `flow-orchestrator.service.ts` bypassed `CommerceService.assertPayLinkStatus` for
 *     `PAID` invoices (`if (invoice.status !== 'PAID')`), so `commerce_send_invoice`
 *     emailed the customer for an already-PAID invoice and only then failed on the
 *     `PAID -> SENT` workflow transition.
 *   - `invoice.findFirst` in `commerce_send_invoice` lacked `deletedAt: null`, so a
 *     soft-deleted DRAFT invoice was found, emailed, and transitioned to `SENT`.
 *   - `commerce_send_invoice` did not check `contact.deletedAt`, so a live invoice whose
 *     contact was soft-deleted minted a payment link and attempted email delivery.
 *
 * Contract pinned here:
 *   KSIP-01  (RED-BEFORE) PAID invoice (with or without an existing live payment link):
 *            refused with ConflictException BEFORE any email (0 calls), 0 new pay links,
 *            0 activity logs; existing link untouched; invoice stays PAID in Postgres.
 *   KSIP-02  (RED-BEFORE) Soft-deleted DRAFT invoice -> refused with NotFoundException
 *            ('Invoice not found') BEFORE any email (0 calls), 0 pay links, 0 activities;
 *            invoice stays DRAFT with deletedAt intact and sentAt null in Postgres.
 *            Soft-deleted contact on a live DRAFT invoice -> refused with ConflictException
 *            BEFORE any pay link (0 rows), email (0 calls), or status flip.
 *   KSIP-03  Terminal / non-sendable statuses (VOID, PENDING, FAILED, FULLY_CREDITED,
 *            PARTIAL): each refused BEFORE any email (0 calls), 0 pay links,
 *            0 activities, status unchanged in Postgres.
 *   KSIP-04  Cross-tenant isolation: Business A targeting Business B's DRAFT, PAID, or
 *            soft-deleted invoice -> indistinguishable NotFoundException('Invoice not found'),
 *            0 email calls, 0 pay links, Business B's invoice unchanged; Business A's DRAFT
 *            invoice cross-linked to Business B's contact -> refused with 0 emails/links.
 *   KSIP-05  Positive controls: live DRAFT invoice in Business A -> succeeds, mints 1 active
 *            pay link, sends 1 email with `/public/invoice/<token>`, transitions to SENT in
 *            Postgres, logs 1 activity; live SENT invoice resend -> succeeds, reuses the 1
 *            active link, sends 1 email, stays SENT.
 *
 * Fixtures: prefix `v92b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92b_';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  contactA: `${P}contact_a`,
  contactADeleted: `${P}contact_a_del`,
  contactB: `${P}contact_b`,
};

const EMAIL_A = `${P}customer_a@test.local`;
const EMAIL_A_DEL = `${P}customer_a_deleted@test.local`;
const EMAIL_B = `${P}customer_b@test.local`;

let db: any;
let moduleRef: any;
let prismaService: any;
let commerce: any;
let FlowOrchestratorRef: any;

let seq = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM journal_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

async function seedInvoice(
  biz: string,
  contact: string,
  status: string,
  opts: { deletedAt?: Date | null; paidAt?: Date | null; sentAt?: Date | null } = {},
) {
  seq += 1;
  const id = `${P}inv_${biz === ID.bizA ? 'a' : 'b'}_${status.toLowerCase()}_${seq}`;
  const paidAt = opts.paidAt !== undefined ? opts.paidAt : status === 'PAID' ? new Date('2026-11-01T12:00:00.000Z') : null;
  const sentAt = opts.sentAt !== undefined ? opts.sentAt : status === 'DRAFT' ? null : new Date('2026-10-25T12:00:00.000Z');
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V92B-${seq}`,
      status,
      subtotal: 320,
      total: 320,
      currency: 'TTD',
      businessId: biz,
      contactId: contact,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      ...(paidAt ? { paidAt } : {}),
      ...(sentAt ? { sentAt } : {}),
      ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
      items: { create: [{ description: 'V92B line item', quantity: 1, unitPrice: 320, total: 320 }] },
    },
  });
  return id;
}

async function linksOf(invoiceId: string) {
  return db.paymentLink.findMany({
    where: { invoiceId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Invokes the real `FlowOrchestratorService.executeToolAction(businessId, 'commerce_send_invoice', ...)`
 * backed by real Postgres, real `PrismaService`, and real `CommerceService` (including real
 * `automatedInvoiceUrl` and real `updateInvoiceStatus` -> `InvoiceWorkflowService`).
 * Only `TransactionalEmailService.send` (recording spy; zero outbound traffic) and
 * `ActivityLogService.createActivity` (recording spy) are stand-ins.
 */
function runSendInvoice(businessId: string, invoiceId: string) {
  const emailSendSpy = vi.fn(async (payload: Record<string, any>) => ({
    status: 'SENT' as const,
    messageId: `${P}mail_${emailSendSpy.mock.calls.length}`,
    payload,
  }));
  const activitySpy = vi.fn(async (payload: Record<string, any>) => ({
    id: `${P}act_${activitySpy.mock.calls.length}`,
    payload,
  }));
  const invoiceFindFirstWheres: Array<Record<string, any>> = [];
  const realInvoiceDelegate = prismaService.client.invoice;
  const spiedInvoiceDelegate = new Proxy(realInvoiceDelegate, {
    get(target, prop, receiver) {
      if (prop === 'findFirst') {
        return (args: any) => {
          invoiceFindFirstWheres.push(args?.where ? { ...args.where } : {});
          return target.findFirst(args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const spiedClient = new Proxy(prismaService.client, {
    get(target, prop, receiver) {
      if (prop === 'invoice') return spiedInvoiceDelegate;
      return Reflect.get(target, prop, receiver);
    },
  });
  const spiedPrisma = Object.create(prismaService, { client: { get: () => spiedClient } });

  const orchestrator = Object.assign(Object.create(FlowOrchestratorRef.prototype), {
    prisma: spiedPrisma,
    getCommerce: () => commerce,
    getTransactionalEmail: () => ({ send: emailSendSpy }),
    getActivityLog: () => ({ createActivity: activitySpy }),
  });

  const promise = (orchestrator as any).executeToolAction(businessId, 'commerce_send_invoice', { invoiceId });
  return { promise, emailSendSpy, activitySpy, invoiceFindFirstWheres };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  const eventStub = {
    emit: () => true,
    emitAsync: async () => [],
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  };

  moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      CommerceService,
      InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
    ],
  }).compile();

  prismaService = moduleRef.get(PrismaService);
  commerce = moduleRef.get(CommerceService);
  ({ FlowOrchestratorService: FlowOrchestratorRef } = await import('../src/modules/ai/flow-orchestrator.service'));

  await cleanup();
  await db.user.create({ data: { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V92B Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V92B Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ada', lastName: 'Lovelace', email: EMAIL_A },
  });
  await db.contact.create({
    data: {
      id: ID.contactADeleted,
      businessId: ID.bizA,
      firstName: 'Deleted',
      lastName: 'Customer',
      email: EMAIL_A_DEL,
      deletedAt: new Date('2026-11-10T00:00:00.000Z'),
    },
  });
  await db.contact.create({
    data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Grace', lastName: 'Hopper', email: EMAIL_B },
  });
}, 180_000);

afterAll(async () => {
  if (moduleRef) await moduleRef.close();
  if (db) {
    await cleanup();
    const left = await db.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
              (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
              (SELECT count(*) FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS contacts,
              (SELECT count(*) FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS invoices,
              (SELECT count(*) FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS payment_links,
              (SELECT count(*) FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS activities`,
    );
    expect(left).toEqual([
      { businesses: 0, users: 0, contacts: 0, invoices: 0, payment_links: 0, activities: 0 },
    ]);
  }
});

describe('FU-KEY-SEND-INVOICE-PAID-REFUSE (V1-92, P153; D-248)', () => {
  it('KSIP-01: PAID invoice is refused BEFORE any email is sent, pay link created, or status mutated', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'PAID');
    const before = await db.invoice.findUnique({ where: { id: inv } });

    const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, inv);
    const err = await promise.then(() => null, (e: unknown) => e);

    expect(err, 'PAID invoice must be refused').toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/PAID/);
    expect((err as Error).message).not.toContain(before.invoiceNumber);
    expect((err as Error).message).not.toContain(EMAIL_A);

    expect(emailSendSpy, 'zero emails may leave for a PAID invoice').toHaveBeenCalledTimes(0);
    expect(activitySpy, 'zero activities may be logged').toHaveBeenCalledTimes(0);
    expect(await linksOf(inv), 'zero payment links minted').toEqual([]);

    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe('PAID');
    expect(after.paidAt?.toISOString()).toBe(before.paidAt?.toISOString());
    expect(after.sentAt?.toISOString()).toBe(before.sentAt?.toISOString());
  });

  it('KSIP-01b: PAID invoice with an existing live payment link is refused before email and leaves the link untouched', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'PAID');
    const existing = await db.paymentLink.create({
      data: { id: `${P}plink_paid_existing`, invoiceId: inv, businessId: ID.bizA },
    });

    const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, inv);
    await expect(promise).rejects.toBeInstanceOf(ConflictException);

    expect(emailSendSpy).toHaveBeenCalledTimes(0);
    expect(activitySpy).toHaveBeenCalledTimes(0);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active, l.expiresAt])).toEqual([
      [existing.id, existing.token, true, null],
    ]);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('PAID');
  });

  it('KSIP-02: soft-deleted DRAFT invoice is refused explicitly with deletedAt: null BEFORE any email is sent or status changed', async () => {
    const deletedAt = new Date('2026-11-15T10:30:00.000Z');
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT', { deletedAt });

    const { promise, emailSendSpy, activitySpy, invoiceFindFirstWheres } = runSendInvoice(ID.bizA, inv);
    const err = await promise.then(() => null, (e: unknown) => e);

    expect(invoiceFindFirstWheres).toHaveLength(1);
    expect(
      invoiceFindFirstWheres[0],
      'commerce_send_invoice invoice.findFirst must explicitly bind deletedAt: null',
    ).toMatchObject({
      id: inv,
      businessId: ID.bizA,
      deletedAt: null,
    });
    expect(err, 'soft-deleted invoice must be refused as not found').toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe('Invoice not found');

    expect(emailSendSpy, 'zero emails may leave for a soft-deleted invoice').toHaveBeenCalledTimes(0);
    expect(activitySpy, 'zero activities may be logged').toHaveBeenCalledTimes(0);
    expect(await linksOf(inv), 'zero payment links minted').toEqual([]);

    // Raw SQL bypasses the soft-delete extension so we assert the deleted row itself was untouched.
    const rows = (await db.$queryRawUnsafe(
      `SELECT status, deleted_at, sent_at FROM invoices WHERE id = $1`,
      inv,
    )) as Array<{ status: string; deleted_at: Date | null; sent_at: Date | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DRAFT');
    expect(rows[0].deleted_at?.toISOString()).toBe(deletedAt.toISOString());
    expect(rows[0].sent_at).toBeNull();
  });

  it('KSIP-02b: live DRAFT invoice with a soft-deleted contact is refused BEFORE any pay link, email, or status change', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactADeleted, 'DRAFT');

    const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, inv);
    const err = await promise.then(() => null, (e: unknown) => e);

    expect(err, 'invoice for soft-deleted contact must be refused').toBeInstanceOf(ConflictException);
    expect(emailSendSpy, 'zero emails may leave for a soft-deleted contact').toHaveBeenCalledTimes(0);
    expect(activitySpy, 'zero activities may be logged').toHaveBeenCalledTimes(0);
    expect(await linksOf(inv), 'zero payment links minted').toEqual([]);

    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe('DRAFT');
    expect(after.sentAt).toBeNull();
  });

  it('KSIP-03: VOID, PENDING, FAILED, FULLY_CREDITED, and PARTIAL invoices are refused BEFORE any email or status mutation', async () => {
    // VOID keeps its explicit message pinned by flow-chat-envelope and key-invoice-email-pay-link.
    {
      const invVoid = await seedInvoice(ID.bizA, ID.contactA, 'VOID');
      const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, invVoid);
      await expect(promise).rejects.toThrow('Cannot email a voided invoice');
      expect(emailSendSpy).toHaveBeenCalledTimes(0);
      expect(activitySpy).toHaveBeenCalledTimes(0);
      expect(await linksOf(invVoid)).toEqual([]);
      expect((await db.invoice.findUnique({ where: { id: invVoid } })).status).toBe('VOID');
    }

    // All other non-sendable schema InvoiceStatus values (PENDING, FAILED, FULLY_CREDITED, PARTIAL).
    for (const status of ['PENDING', 'FAILED', 'FULLY_CREDITED', 'PARTIAL'] as const) {
      const inv = await seedInvoice(ID.bizA, ID.contactA, status);
      const before = await db.invoice.findUnique({ where: { id: inv } });
      const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, inv);
      const err = await promise.then(() => null, (e: unknown) => e);

      expect(err, `${status} must be refused with ConflictException`).toBeInstanceOf(ConflictException);
      expect((err as Error).message, status).toContain(`this invoice is ${status}`);
      expect((err as Error).message, status).not.toContain(before.invoiceNumber);
      expect(emailSendSpy, `${status}: 0 emails`).toHaveBeenCalledTimes(0);
      expect(activitySpy, `${status}: 0 activities`).toHaveBeenCalledTimes(0);
      expect(await linksOf(inv), `${status}: 0 pay links`).toEqual([]);
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe(status);
    }
  });

  it('KSIP-04: cross-tenant isolation — Business A targeting Business B invoices or foreign-linked contacts sends 0 emails and mutates nothing', async () => {
    const bizBDraft = await seedInvoice(ID.bizB, ID.contactB, 'DRAFT');
    const bizBPaid = await seedInvoice(ID.bizB, ID.contactB, 'PAID');
    const bizBDeleted = await seedInvoice(ID.bizB, ID.contactB, 'DRAFT', {
      deletedAt: new Date('2026-11-12T00:00:00.000Z'),
    });

    const messages: string[] = [];
    for (const foreignId of [bizBDraft, bizBPaid, bizBDeleted]) {
      const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, foreignId);
      const err = await promise.then(() => null, (e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      messages.push((err as Error).message);
      expect(emailSendSpy).toHaveBeenCalledTimes(0);
      expect(activitySpy).toHaveBeenCalledTimes(0);
      expect(await linksOf(foreignId)).toEqual([]);
    }
    expect(new Set(messages), 'indistinguishable refusal across foreign invoice statuses').toEqual(
      new Set(['Invoice not found']),
    );

    const draftAfter = await db.invoice.findUnique({ where: { id: bizBDraft } });
    expect(draftAfter.status).toBe('DRAFT');
    expect(draftAfter.sentAt).toBeNull();

    // Business A invoice cross-linked to Business B's contact: ownRelations drops the foreign contact.
    const crossLinked = await seedInvoice(ID.bizA, ID.contactB, 'DRAFT');
    const { promise: clPromise, emailSendSpy: clMail, activitySpy: clAct } = runSendInvoice(ID.bizA, crossLinked);
    await expect(clPromise).rejects.toThrow('Contact has no email address');
    expect(clMail).toHaveBeenCalledTimes(0);
    expect(clAct).toHaveBeenCalledTimes(0);
    expect(await linksOf(crossLinked)).toEqual([]);
    expect((await db.invoice.findUnique({ where: { id: crossLinked } })).status).toBe('DRAFT');
  });

  it('KSIP-05: positive controls — live DRAFT invoice emails once with pay link and transitions to SENT; live SENT invoice resends cleanly', async () => {
    const draftId = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    const { promise, emailSendSpy, activitySpy } = runSendInvoice(ID.bizA, draftId);
    const result = await promise;

    expect(result).toEqual({
      id: draftId,
      status: 'SENT',
      emailedTo: EMAIL_A,
      delivery: 'SENT',
    });

    const links = await linksOf(draftId);
    expect(links).toHaveLength(1);
    expect(links[0].active).toBe(true);

    expect(emailSendSpy).toHaveBeenCalledTimes(1);
    expect(emailSendSpy.mock.calls[0][0]).toMatchObject({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL_A,
      contactId: ID.contactA,
    });
    expect(emailSendSpy.mock.calls[0][0].templateData.invoiceUrl).toContain(`/public/invoice/${links[0].token}`);

    const afterDraft = await db.invoice.findUnique({ where: { id: draftId } });
    expect(afterDraft.status).toBe('SENT');
    expect(afterDraft.sentAt).toBeInstanceOf(Date);

    expect(activitySpy).toHaveBeenCalledTimes(1);
    expect(activitySpy.mock.calls[0][0]).toMatchObject({
      businessId: ID.bizA,
      action: 'invoice_sent',
      entityId: draftId,
      contactId: ID.contactA,
    });

    // Positive resend control on the now-SENT invoice: reuses existing link, sends once, stays SENT.
    const resend = runSendInvoice(ID.bizA, draftId);
    const resendResult = await resend.promise;

    expect(resendResult).toEqual({
      id: draftId,
      status: 'SENT',
      emailedTo: EMAIL_A,
      delivery: 'SENT',
    });
    expect(resend.emailSendSpy).toHaveBeenCalledTimes(1);
    expect(resend.emailSendSpy.mock.calls[0][0].templateData.invoiceUrl).toContain(`/public/invoice/${links[0].token}`);
    expect(await linksOf(draftId)).toHaveLength(1);
    expect((await db.invoice.findUnique({ where: { id: draftId } })).status).toBe('SENT');
  });
});
