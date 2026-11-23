/**
 * FU-PAY-LINK-STATUS-GATE (P1 security; D-256, D-248) — a public pay link is
 * minted (or a live one handed out again) only for an invoice the customer
 * owes (REAL database, REAL CommerceController + CommerceService, REAL guards).
 *
 * Before: CommerceService.createPaymentLink refused only PAID and VOID, so
 * POST /commerce/businesses/:b/invoices/:id/payment-link minted a public pay
 * link for a DRAFT, PENDING, FAILED or FULLY_CREDITED invoice (or rotated a
 * live legacy one), and POST .../send-email wrote one for a PENDING, FAILED or
 * FULLY_CREDITED invoice and emailed it. Found by the
 * FU-SEND-REMINDER-SERVER-GATE security review (2026-11-23).
 *
 * The payable set is the one a customer may record a payment intent against
 * (INTENT_PAYABLE_STATUSES: SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED),
 * which is CREDIT_AWARE_SHAREABLE_INVOICE_STATUSES without PAID: the statuses
 * the token pay page shows and takes money for.
 *
 * Contract pinned here:
 *   PL-01  POST payment-link for every status outside the payable set and other than PAID/VOID
 *          (DRAFT, PENDING, FAILED, FULLY_CREDITED, and an unknown stored value) answers 409
 *          before any link row is written; the body names the status, not the invoice's
 *          contents (number, total, customer email).
 *   PL-02  such an invoice with a live legacy (cuid) link: refused, and the link is neither
 *          rotated nor given the requested expiry.
 *   PL-03  PAID and VOID keep their refusal and its text (three callers match on it).
 *   PL-04  the payable statuses still get a link: one is minted, and a live one is reused.
 *   PL-05  send-email of a DRAFT still sends with a pay link and then moves the invoice to SENT,
 *          with no link before (minted for the send) and with a live one (reused).
 *   PL-06  send-email of PENDING, FAILED, FULLY_CREDITED or an unknown stored value answers 409
 *          before any email or link row; a live legacy link is not rotated.
 *   PL-07  send-email of the payable statuses is unchanged: one email carrying the one live link.
 *   PL-09  KEY's commerce_send_invoice (flow-orchestrator) refuses PENDING, FAILED, FULLY_CREDITED
 *          and an unknown stored value before any email, link row or status change, as send-email
 *          does (D-248: KEY never emails the invoice without its pay button); a DRAFT and the
 *          payable statuses still go out with the pay link.
 *   PL-08  cross-tenant: B's invoice ids under A's business answer POST payment-link with the
 *          same 404 whatever their status, and send-email with the same 403 it gave before; under
 *          B's business the guard refuses; nothing is written or sent.
 *
 * Nothing on the boundary is mocked but the Gmail service (records every email and sends
 * nothing: no provider traffic), the event bus and the timeline write (recording stubs).
 * Identity attachment is the one stand-in: a test middleware reads `x-v57p-user` and attaches the
 * seeded user row as the Supabase-verifying AuthMiddleware would.
 *
 * Fixtures: prefix `v57p_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw
 * SQL (sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v57p_';
const HEADER = 'x-v57p-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
};
const EMAIL_A = `${P}customer_a@test.local`;
const EMAIL_B = `${P}customer_b@test.local`;

/** Not owed, and not PAID or VOID (those keep their own refusal). PARTIAL: a stored value no code writes. */
const NOT_PAYABLE = ['DRAFT', 'PENDING', 'FAILED', 'FULLY_CREDITED', 'PARTIAL'] as const;
/** Sent with send-email and refused there: everything above but DRAFT, which the send issues. */
const SEND_REFUSED = ['PENDING', 'FAILED', 'FULLY_CREDITED', 'PARTIAL'] as const;
const PAYABLE = ['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED'] as const;
const PAID_OR_VOID = ['PAID', 'VOID'] as const;
const LEGACY = /^c[a-z0-9]{24}$/;

let db: any;
let app: any;
let commerce: any;
let prismaService: any;
let FlowOrchestratorRef: any;
let redis: any;

/** The Gmail boundary: every email is recorded; nothing is sent. */
const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
const gmailStub = {
  sendEmail: async (args: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    sentEmails.push(args);
    return { messageId: `${P}msg_${sentEmails.length}` };
  },
};

/** The event bus: records every emit. */
const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: unknown) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** The commerce service's timeline write: recorded. */
const timeline: Array<Record<string, any>> = [];
const crmStub = {
  logContactEvent: async (e: Record<string, any>) => {
    timeline.push(e);
    return null;
  },
};

async function cleanup() {
  for (const sql of [
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
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function payLink(biz: string, inv: string, as: string = ID.ownerA, body: Record<string, unknown> = {}) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/payment-link`).set(HEADER, as).send(body);
}

function sendEmail(biz: string, inv: string, as: string = ID.ownerA) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/send-email`).set(HEADER, as).send({});
}

let seq = 0;
/** Seeds one invoice of `biz` in `status` directly (the gate reads the stored status). */
async function seedInvoice(biz: string, contact: string, status: string) {
  seq += 1;
  const id = `${P}inv_${biz === ID.bizA ? 'a' : 'b'}_${status.toLowerCase()}_${seq}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V57P-${seq}`,
      status,
      subtotal: 123.45,
      total: 123.45,
      currency: 'TTD',
      businessId: biz,
      contactId: contact,
      dueDate: new Date(Date.now() - 5 * 86_400_000),
      ...(status === 'PAID' ? { paidAt: new Date() } : {}),
      ...(status === 'DRAFT' ? {} : { sentAt: new Date() }),
      items: { create: [{ description: 'V57P work', quantity: 1, unitPrice: 123.45, total: 123.45 }] },
    },
  });
  return id;
}

async function linksOf(inv: string) {
  return db.paymentLink.findMany({ where: { invoiceId: inv }, orderBy: { createdAt: 'asc' } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: gmailStub },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  commerce = moduleRef.get(CommerceService);
  prismaService = moduleRef.get(PrismaService);
  ({ FlowOrchestratorService: FlowOrchestratorRef } = await import('../src/modules/ai/flow-orchestrator.service'));

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [owner, biz, contact, email, tag] of [
    [ID.ownerA, ID.bizA, ID.contactA, EMAIL_A, 'A'],
    [ID.ownerB, ID.bizB, ID.contactB, EMAIL_B, 'B'],
  ] as const) {
    await db.user.create({ data: { id: owner, email: `${P}owner_${tag.toLowerCase()}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name: `V57P ${tag}`, slug: `${P}${tag.toLowerCase()}`, ownerId: owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${tag}`, userId: owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V57P', lastName: `Customer ${tag}`, email } });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  sentEmails.length = 0;
  emitted.length = 0;
  timeline.length = 0;
});

function expectNoContents(body: unknown, inv: { invoiceNumber: string }) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(inv.invoiceNumber);
  expect(text).not.toContain('123.45');
  expect(text).not.toContain(EMAIL_A);
}

describe('POST payment-link status gate (FU-PAY-LINK-STATUS-GATE)', () => {
  it.each(NOT_PAYABLE)('PL-01 %s: 409 before any link row is written; the body names the status, not the invoice', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const before = await db.invoice.findUnique({ where: { id: inv } });

    const res = await payLink(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain(`this invoice is ${status}`);
    expectNoContents(res.body, before);
    expect(await linksOf(inv), 'no pay link minted').toEqual([]);
    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe(status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it.each(NOT_PAYABLE)('PL-02 %s with a live legacy pay link: refused; the token is not rotated and no expiry is set', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const legacy = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA } });
    expect(legacy.token, 'seeded legacy cuid token').toMatch(LEGACY);

    const res = await payLink(ID.bizA, inv, ID.ownerA, { expiresInDays: 3 });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(legacy.token);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active, l.expiresAt])).toEqual([[legacy.id, legacy.token, true, null]]);
  });

  it.each(PAID_OR_VOID)('PL-03 %s: still the paid-or-voided 409, and no link row', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);

    const res = await payLink(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/paid or voided/i);
    expect(await linksOf(inv)).toEqual([]);
  });

  it.each(PAYABLE)('PL-04 %s: a link is minted, and a second call reuses it', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);

    const first = await payLink(ID.bizA, inv);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: first.body.id, token: first.body.token, active: true, businessId: ID.bizA });
    expect(links[0].token).not.toMatch(LEGACY);

    const second = await payLink(ID.bizA, inv);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect([second.body.id, second.body.token]).toEqual([first.body.id, first.body.token]);
    expect(await linksOf(inv)).toHaveLength(1);
  });
});

describe('send-email pay link status gate (FU-PAY-LINK-STATUS-GATE)', () => {
  it('PL-05a DRAFT with no link: sent with a newly minted live link, then moved to SENT', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ active: true, expiresAt: null });
    expect(res.body.paymentUrl).toContain(`/public/invoice/${links[0].token}`);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(EMAIL_A);
    expect(sentEmails[0].htmlBody).toContain(`/public/invoice/${links[0].token}`);
    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe('SENT');
    expect(after.sentAt).not.toBeNull();
  });

  it('PL-05b DRAFT with a live link: sent with that link (same id and token), then moved to SENT', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    const live = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA, token: `${P}live_draft_${seq}` } });

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active])).toEqual([[live.id, live.token, true]]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].htmlBody).toContain(`/public/invoice/${live.token}`);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('SENT');
  });

  it('PL-05c DRAFT with a live legacy link: the link is rotated in place and the email carries the new token; moved to SENT', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    const legacy = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA } });
    expect(legacy.token).toMatch(LEGACY);

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe(legacy.id);
    expect(links[0].token).not.toMatch(LEGACY);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].htmlBody).toContain(`/public/invoice/${links[0].token}`);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('SENT');
  });

  it.each(SEND_REFUSED)('PL-06a %s: 409 before any email or link row; status unchanged; the body names the status only', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const before = await db.invoice.findUnique({ where: { id: inv } });

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain(`this invoice is ${status}`);
    expectNoContents(res.body, before);
    expect(sentEmails, 'no email').toEqual([]);
    expect(await linksOf(inv), 'no pay link').toEqual([]);
    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe(status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it.each(SEND_REFUSED)('PL-06b %s with a live legacy link: 409, no email, and the token is not rotated', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const legacy = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA } });

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(sentEmails).toEqual([]);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active, l.expiresAt])).toEqual([[legacy.id, legacy.token, true, null]]);
  });

  it.each(PAYABLE)('PL-07 %s: sent once with the one live link; status unchanged', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);

    const res = await sendEmail(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ active: true, expiresAt: null });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].htmlBody).toContain(`/public/invoice/${links[0].token}`);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe(status);
  });
});

describe('cross-tenant (FU-PAY-LINK-STATUS-GATE)', () => {
  it('PL-08 B\'s invoice ids under A\'s business: payment-link 404 and send-email 403 whatever the status; B\'s business refuses A; nothing written or sent', async () => {
    const ids = { SENT: await seedInvoice(ID.bizB, ID.contactB, 'SENT'), DRAFT: await seedInvoice(ID.bizB, ID.contactB, 'DRAFT'), FAILED: await seedInvoice(ID.bizB, ID.contactB, 'FAILED') };

    const linkAnswers: string[] = [];
    const sendAnswers: string[] = [];
    for (const [status, inv] of Object.entries(ids)) {
      const link = await payLink(ID.bizA, inv);
      expect(link.status, JSON.stringify(link.body)).toBe(404);
      expect(JSON.stringify(link.body)).not.toContain(status);
      linkAnswers.push(JSON.stringify({ s: link.status, m: link.body?.message }));

      const send = await sendEmail(ID.bizA, inv);
      expect(send.status, JSON.stringify(send.body)).toBe(403);
      expect(JSON.stringify(send.body)).not.toContain(status);
      sendAnswers.push(JSON.stringify({ s: send.status, m: send.body?.message }));

      expect((await payLink(ID.bizB, inv, ID.ownerA)).status).toBe(403);
      expect((await sendEmail(ID.bizB, inv, ID.ownerA)).status).toBe(403);
    }
    expect(new Set(linkAnswers).size, 'one answer whatever the status').toBe(1);
    expect(new Set(sendAnswers).size, 'one answer whatever the status').toBe(1);
    expect(sentEmails).toEqual([]);
    for (const inv of Object.values(ids)) expect(await linksOf(inv)).toEqual([]);
  });
});

/**
 * KEY's commerce_send_invoice, the real FlowOrchestratorService handler over the real
 * CommerceService and database. The transactional email service records and sends nothing;
 * updateInvoiceStatus and the activity log are recorded.
 */
function keySend(invoiceId: string) {
  const mail: Array<{ type: string; templateData: Record<string, any> }> = [];
  const statusMoves: string[] = [];
  const run = Object.assign(Object.create(FlowOrchestratorRef.prototype), {
    prisma: prismaService,
    getTransactionalEmail: () => ({
      send: async (args: { type: string; templateData: Record<string, any> }) => {
        mail.push(args);
        return { status: 'SENT' };
      },
    }),
    getCommerce: () => ({
      automatedInvoiceUrl: (id: string, biz: string) => commerce.automatedInvoiceUrl(id, biz),
      publicInvoiceUrl: (id: string, biz: string) => commerce.publicInvoiceUrl(id, biz),
      updateInvoiceStatus: async (a: { status: string }) => {
        statusMoves.push(a.status);
        return { id: invoiceId, status: a.status };
      },
    }),
    getActivityLog: () => ({ createActivity: async () => ({}) }),
  }).executeToolAction(ID.bizA, 'commerce_send_invoice', { invoiceId });
  return { run, mail, statusMoves };
}

describe("KEY's commerce_send_invoice (FU-PAY-LINK-STATUS-GATE, D-248)", () => {
  it.each(SEND_REFUSED)('PL-09a %s: refused before any email, link row or status change', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const before = await db.invoice.findUnique({ where: { id: inv } });

    const { run, mail, statusMoves } = keySend(inv);
    const err = await run.then(() => null, (e: Error) => e);

    expect(err, 'the tool call fails').toBeInstanceOf(Error);
    expect(err!.message).toContain(`this invoice is ${status}`);
    expect(err!.message).not.toContain(before.invoiceNumber);
    expect(mail, 'no email').toEqual([]);
    expect(statusMoves, 'no status change').toEqual([]);
    expect(await linksOf(inv), 'no pay link').toEqual([]);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe(status);
  });

  it.each(SEND_REFUSED)('PL-09b %s with a live legacy link: refused, no email, the token is not rotated', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const legacy = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA } });

    const { run, mail, statusMoves } = keySend(inv);
    await expect(run).rejects.toThrow(`this invoice is ${status}`);

    expect(mail).toEqual([]);
    expect(statusMoves).toEqual([]);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active, l.expiresAt])).toEqual([[legacy.id, legacy.token, true, null]]);
  });

  it.each(['DRAFT', ...PAYABLE] as const)('PL-09c %s: emailed once with the one live pay link, then moved to SENT', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);

    const { run, mail, statusMoves } = keySend(inv);
    const result = await run;

    expect(result.status).toBe('SENT');
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0].active).toBe(true);
    expect(mail).toHaveLength(1);
    expect(mail[0].type).toBe('invoice_sent');
    expect(mail[0].templateData.invoiceUrl).toContain(`/public/invoice/${links[0].token}`);
    expect(statusMoves).toEqual(['SENT']);
  });
});
