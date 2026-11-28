/**
 * FU-REMINDER-HONESTY (server half, P2 launch-track, Journey D) —
 * Payment reminders must record the actual recipient email used in the
 * timeline and re-check invoice status immediately before delivery (TOCTOU
 * guard against concurrent payment, void, credit, or soft-delete).
 *
 * Real Postgres, real CommerceController + CommerceService, real AuthGuard /
 * BusinessGuard / ModuleScopeGuard / TenantInterceptor / ValidationPipe /
 * GlobalHttpExceptionFilter. Gmail delivery is recorded in-memory (no
 * provider traffic). ContactEvent rows are persisted to the real database
 * and read back via GET /commerce/businesses/:b/invoices/:id/timeline.
 *
 * Contract pinned here:
 *   RH-01  body.recipientEmail override differs from contact.email: Gmail
 *          receives the override, and both the persisted ContactEvent and
 *          GET .../timeline record data.recipientEmail === override.
 *   RH-02  contact.email is null + body.recipientEmail provided (channel
 *          omitted): defaults to channel 'email', delivers to override, and
 *          timeline records data.recipientEmail === override.
 *   RH-03  whitespace-only recipientEmail falls back to contact.email;
 *          non-email channel ('manual') sends no email and records
 *          data.recipientEmail === null (never falsely attributes an email).
 *   RH-04  TOCTOU re-check immediately before delivery:
 *          (a) live link exists, concurrent SENT -> PAID -> 409 naming PAID,
 *              0 emails, 0 events, 0 timeline entries;
 *          (b) no live link, concurrent SENT -> VOID before createPaymentLink
 *              -> 409 naming VOID (never swallows paid/voided error into a
 *              CTA-less send), 0 emails, 0 events, 0 timeline entries;
 *          (c) live link exists, concurrent soft-delete (deletedAt set) ->
 *              404, 0 emails, 0 events, 0 timeline entries;
 *          (d) live link exists, concurrent SENT -> PARTIALLY_CREDITED ->
 *              409 naming PARTIALLY_CREDITED, 0 emails, 0 events, 0 timeline.
 *   RH-05  Controls & input hardening:
 *          (a) concurrent SENT -> PARTIALLY_PAID (still remindable) succeeds
 *              and records the fresh status 'PARTIALLY_PAID' on the timeline;
 *          (b) malformed / header-injection recipientEmail rejected with 400
 *              before any link creation or email send;
 *          (c) cross-tenant isolation preserved (404 under own biz, 403 under
 *              foreign biz, 0 emails, 0 timeline entries).
 *
 * Fixtures: prefix `v92s_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92s_';
const HEADER = 'x-v92s-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactNoEmailA: `${P}contactNoEmailA`,
  contactB: `${P}contactB`,
};
const EMAIL_A = `${P}contact_a@test.local`;
const EMAIL_B = `${P}contact_b@test.local`;

let db: any;
let app: any;
let redis: any;
let commerceService: any;
let prismaService: any;

const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
const gmailStub = {
  sendEmail: async (args: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    sentEmails.push(args);
    return { messageId: `${P}msg_${sentEmails.length}` };
  },
};

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

let eventSeq = 0;
const loggedEvents: Array<Record<string, any>> = [];
const crmStub = {
  logContactEvent: async (e: Record<string, any>) => {
    loggedEvents.push(e);
    eventSeq += 1;
    return db.contactEvent.create({
      data: {
        id: `${P}evt_${eventSeq}`,
        businessId: e.businessId,
        contactId: e.contactId,
        type: e.type,
        data: e.data ?? {},
        actorType: e.actorType ?? 'USER',
        actorId: e.actorId ?? null,
        source: e.source ?? 'commerce',
      },
    });
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
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function agent() {
  return request(app.getHttpServer());
}

let seq = 0;
async function seedInvoice(biz: string, contact: string, status: string, withLiveLink = false) {
  seq += 1;
  const id = `${P}inv_${seq}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V92S-${seq}`,
      status,
      subtotal: 250.0,
      total: 250.0,
      currency: 'TTD',
      businessId: biz,
      contactId: contact,
      dueDate: new Date(Date.now() - 3 * 86_400_000),
      sentAt: new Date(Date.now() - 10 * 86_400_000),
    },
  });
  if (withLiveLink) {
    await db.paymentLink.create({
      data: {
        id: `${P}pl_${seq}`,
        businessId: biz,
        invoiceId: id,
        token: `${P}tok_live_${seq}_${'a'.repeat(24)}`,
        active: true,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
  }
  return id;
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

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

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

  commerceService = moduleRef.get(CommerceService);
  prismaService = moduleRef.get(PrismaService);

  app = moduleRef.createNestApplication();
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
  app.useGlobalInterceptors(new TenantInterceptor(prismaService));
  await app.init();

  await cleanup();

  for (const [owner, biz, contact, email, tag] of [
    [ID.ownerA, ID.bizA, ID.contactA, EMAIL_A, 'A'],
    [ID.ownerB, ID.bizB, ID.contactB, EMAIL_B, 'B'],
  ] as const) {
    await db.user.create({ data: { id: owner, email: `${P}owner_${tag.toLowerCase()}@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: biz, name: `V92S ${tag}`, slug: `${P}${tag.toLowerCase()}`, ownerId: owner, currency: 'TTD' },
    });
    await db.membership.create({ data: { id: `${P}m_${tag}`, userId: owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({
      data: { id: contact, businessId: biz, firstName: 'V92S', lastName: `Customer ${tag}`, email },
    });
  }
  await db.contact.create({
    data: { id: ID.contactNoEmailA, businessId: ID.bizA, firstName: 'V92S', lastName: 'NoEmail', email: null },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  sentEmails.length = 0;
  emitted.length = 0;
  loggedEvents.length = 0;
  vi.restoreAllMocks();
});

describe('FU-REMINDER-HONESTY (server half)', () => {
  it('RH-01: timeline records body.recipientEmail override actually emailed, not stale contact.email', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    const overrideEmail = `${P}billing_override@test.local`;

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email', recipientEmail: `  ${overrideEmail}  ` });

    expect(res.status).toBe(201);
    expect(res.body.delivered).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(overrideEmail);

    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0].data.recipientEmail).toBe(overrideEmail);

    const tl = await agent()
      .get(`/commerce/businesses/${ID.bizA}/invoices/${inv}/timeline`)
      .set(HEADER, ID.ownerA);
    expect(tl.status).toBe(200);
    const rem = tl.body.entries.find((e: any) => e.type === 'invoice.payment_reminder_sent');
    expect(rem).toBeDefined();
    expect(rem.data.recipientEmail).toBe(overrideEmail);
  });

  it('RH-02: contact with null email + body.recipientEmail (channel omitted) sends email and logs actual recipient', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactNoEmailA, 'OVERDUE', true);
    const overrideEmail = `${P}direct_override@test.local`;

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ recipientEmail: overrideEmail });

    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('email');
    expect(res.body.delivered).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(overrideEmail);

    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0].data.recipientEmail).toBe(overrideEmail);
  });

  it('RH-03: whitespace recipientEmail falls back to contact.email; manual channel logs recipientEmail: null', async () => {
    const inv1 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    const res1 = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv1}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email', recipientEmail: '   ' });

    expect(res1.status).toBe(201);
    expect(res1.body.delivered).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(EMAIL_A);
    expect(loggedEvents[0].data.recipientEmail).toBe(EMAIL_A);

    sentEmails.length = 0;
    loggedEvents.length = 0;

    const inv2 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    const res2 = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv2}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'manual', recipientEmail: `${P}not_emailed@test.local` });

    expect(res2.status).toBe(201);
    expect(res2.body.channel).toBe('manual');
    expect(res2.body.delivered).toBe(false);
    expect(sentEmails).toHaveLength(0);
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0].data.recipientEmail).toBeNull();
  });

  it('RH-04a: TOCTOU guard refuses 409 if invoice becomes PAID between initial read and delivery (existing live link)', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);

    const origReissue = commerceService.reissueLink.bind(commerceService);
    vi.spyOn(commerceService, 'reissueLink').mockImplementationOnce(async (link: any) => {
      const out = await origReissue(link);
      await db.invoice.update({ where: { id: inv }, data: { status: 'PAID', paidAt: new Date() } });
      return out;
    });

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('PAID');
    expect(sentEmails).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
  });

  it('RH-04b: TOCTOU guard refuses 409 if invoice becomes VOID before createPaymentLink (no CTA-less fallback)', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'SENT', false);

    const origCreate = commerceService.createPaymentLink.bind(commerceService);
    vi.spyOn(commerceService, 'createPaymentLink').mockImplementationOnce(async (invoiceId: string, bizId: string) => {
      await db.invoice.update({ where: { id: inv }, data: { status: 'VOID' } });
      return origCreate(invoiceId, bizId);
    });

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('VOID');
    expect(sentEmails).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
  });

  it('RH-04c: TOCTOU guard refuses 404 if invoice is soft-deleted between initial read and delivery', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);

    const origReissue = commerceService.reissueLink.bind(commerceService);
    vi.spyOn(commerceService, 'reissueLink').mockImplementationOnce(async (link: any) => {
      const out = await origReissue(link);
      await db.invoice.update({ where: { id: inv }, data: { deletedAt: new Date() } });
      return out;
    });

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });

    expect(res.status).toBe(404);
    expect(sentEmails).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
  });

  it('RH-04d: TOCTOU guard refuses 409 if invoice becomes PARTIALLY_CREDITED before delivery', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);

    const origReissue = commerceService.reissueLink.bind(commerceService);
    vi.spyOn(commerceService, 'reissueLink').mockImplementationOnce(async (link: any) => {
      const out = await origReissue(link);
      await db.invoice.update({ where: { id: inv }, data: { status: 'PARTIALLY_CREDITED' } });
      return out;
    });

    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('PARTIALLY_CREDITED');
    expect(sentEmails).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
  });

  it('RH-05: fresh remindable status + payments logged on concurrent SENT->PARTIALLY_PAID; malformed recipientEmail 400; cross-tenant refused', async () => {
    // (a) Concurrent SENT -> PARTIALLY_PAID with a real 100.00 payment refreshes email balance due & timeline status
    const inv1 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    const origReissue = commerceService.reissueLink.bind(commerceService);
    vi.spyOn(commerceService, 'reissueLink').mockImplementationOnce(async (link: any) => {
      const out = await origReissue(link);
      await db.payment.create({
        data: {
          id: `${P}pay_concurrent_${seq}`,
          businessId: ID.bizA,
          invoiceId: inv1,
          amount: 100.0,
          currency: 'TTD',
          status: 'SUCCESSFUL',
          method: 'MANUAL',
          provider: 'MANUAL',
          providerPaymentId: `${P}pp_concurrent_${seq}`,
        },
      });
      await db.invoice.update({ where: { id: inv1 }, data: { status: 'PARTIALLY_PAID' } });
      return out;
    });

    const ok = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv1}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });
    expect(ok.status).toBe(201);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].htmlBody).toContain('150.00');
    expect(sentEmails[0].htmlBody).toContain('100.00');
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0].data.status).toBe('PARTIALLY_PAID');

    sentEmails.length = 0;
    loggedEvents.length = 0;

    // (b) Header-injection / malformed recipientEmail (including trailing CRLF, C1 NEL, quotes, degenerate domains) rejected with 400
    const inv2 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', false);
    for (const bad of [
      'victim@test.local\r\nBcc: evil@attacker.test',
      'victim@test.local\r\n',
      '\r\n',
      'victim@test.local\u0085',
      'a"b@test.local',
      'a@...',
      'a@.test.local',
      'a@test.local.',
      'a@test..local',
      'not-an-email',
      'a@b',
    ]) {
      const r = await agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices/${inv2}/send-reminder`)
        .set(HEADER, ID.ownerA)
        .send({ channel: 'email', recipientEmail: bad });
      expect(r.status).toBe(400);
    }
    expect(sentEmails).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
    expect(await db.paymentLink.count({ where: { invoiceId: inv2 } })).toBe(0);

    // (c) Cross-tenant isolation preserved
    const invB = await seedInvoice(ID.bizB, ID.contactB, 'SENT', true);
    const crossOwn = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${invB}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email', recipientEmail: `${P}probe@test.local` });
    expect(crossOwn.status).toBe(404);

    const crossForeign = await agent()
      .post(`/commerce/businesses/${ID.bizB}/invoices/${invB}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email', recipientEmail: `${P}probe@test.local` });
    expect(crossForeign.status).toBe(403);
    expect(sentEmails).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);
  });

  it('RH-06: TOCTOU refuses 409 on concurrent contactId reassignment; non-email deliver never receives or logs recipientEmail', async () => {
    // (a) Concurrent contactId change before delivery -> 409, 0 emails, 0 timeline events
    const inv1 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    const origReissue = commerceService.reissueLink.bind(commerceService);
    vi.spyOn(commerceService, 'reissueLink').mockImplementationOnce(async (link: any) => {
      const out = await origReissue(link);
      await db.invoice.update({ where: { id: inv1 }, data: { contactId: ID.contactNoEmailA } });
      return out;
    });

    const reassigned = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${inv1}/send-reminder`)
      .set(HEADER, ID.ownerA)
      .send({ channel: 'email' });
    expect(reassigned.status).toBe(409);
    expect(sentEmails).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(loggedEvents).toHaveLength(0);

    // (b) Service-level honesty: non-email channel passes recipientEmail: null to deliver and ignores any deliver-supplied email
    const inv2 = await seedInvoice(ID.bizA, ID.contactA, 'SENT', true);
    let receivedByDeliver: string | null | undefined = 'unset';
    const serviceRes = await commerceService.sendInvoiceReminder({
      invoiceId: inv2,
      businessId: ID.bizA,
      channel: 'manual',
      deliver: async ({ recipientEmail }: { recipientEmail: string | null }) => {
        receivedByDeliver = recipientEmail;
        return { delivered: false, recipientEmail: `${P}bogus@test.local` };
      },
    });
    expect(receivedByDeliver).toBeNull();
    expect(serviceRes.recipientEmail).toBeNull();
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0].data.recipientEmail).toBeNull();
  });
});
