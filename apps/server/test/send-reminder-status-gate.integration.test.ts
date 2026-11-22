/**
 * FU-SEND-REMINDER-SERVER-GATE (P1 security) — the server refuses an invoice
 * reminder unless the invoice is SENT, OVERDUE or PARTIALLY_PAID (REAL
 * database, REAL CommerceController + CommerceService, REAL guards).
 *
 * Before: POST /commerce/businesses/:b/invoices/:id/send-reminder
 * (CommerceService.sendInvoiceReminder) refused only PAID and VOID (a 400).
 * A revenue:write caller could remind a DRAFT, PENDING, FAILED or
 * FULLY_CREDITED invoice: the customer was emailed, a public pay link was
 * minted (or a live legacy one rotated) and invoice.payment_reminder_sent was
 * emitted and logged on the timeline. The web's canRemind (SENT, OVERDUE,
 * PARTIALLY_PAID) was the only barrier. Found by the SWP-INV-MONEY-TOTALS
 * acceptance review (2026-11-22). D-256: reminder lists are not owed figures
 * and keep their own set.
 *
 * Contract pinned here:
 *   SG-01  every status outside { SENT, OVERDUE, PARTIALLY_PAID } (DRAFT, PENDING, FAILED,
 *          FULLY_CREDITED, PARTIALLY_CREDITED, PARTIAL, PAID, VOID) answers 409 before anything
 *          happens: no email, no pay link minted, no event (not even reminder_failed), no
 *          timeline entry, the invoice row unchanged. The body names the status, not the
 *          invoice's contents (number, total, customer email).
 *   SG-02  a refused invoice with a live legacy (cuid) pay link keeps that link's token: the
 *          refusal comes before the link is looked up and rotated.
 *   SG-03  SENT, OVERDUE and PARTIALLY_PAID still remind exactly once: 201 delivered: true, one
 *          email to the contact with the pay link, one live link, one
 *          invoice.payment_reminder_sent event and one timeline entry; the status is unchanged.
 *   SG-04  cross-tenant: tenant A's owner naming tenant B's invoice id under A's business is a
 *          404 for a remindable and for a refused status alike (the status is never disclosed),
 *          and nothing is sent; under B's business it is refused by the business guard.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CommerceController and CommerceService read and write real rows behind the production
 * GlobalHttpExceptionFilter, ValidationPipe and TenantInterceptor. Identity attachment is the one
 * stand-in: a test middleware reads `x-v57r-user`, loads that seeded user row and attaches
 * `{ id, email, role }` as the Supabase-verifying AuthMiddleware would. The Gmail service records
 * every email and sends nothing (no provider traffic). The event bus and the commerce service's
 * timeline write (CrmService.logContactEvent) are recording stubs.
 *
 * Fixtures: prefix `v57r_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw
 * SQL (sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v57r_';
const HEADER = 'x-v57r-user';

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

const REFUSED = ['DRAFT', 'PENDING', 'FAILED', 'FULLY_CREDITED', 'PARTIALLY_CREDITED', 'PARTIAL', 'PAID', 'VOID'] as const;
const ALLOWED = ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] as const;

let db: any;
let app: any;
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

function remind(biz: string, inv: string, as: string = ID.ownerA) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/send-reminder`).set(HEADER, as).send({ channel: 'email' });
}

let seq = 0;
/** Seeds one invoice of `biz` in `status` directly (the gate reads the stored status). */
async function seedInvoice(biz: string, contact: string, status: string) {
  seq += 1;
  const id = `${P}inv_${biz === ID.bizA ? 'a' : 'b'}_${status.toLowerCase()}_${seq}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V57R-${seq}`,
      status,
      subtotal: 123.45,
      total: 123.45,
      currency: 'TTD',
      businessId: biz,
      contactId: contact,
      dueDate: new Date(Date.now() - 5 * 86_400_000),
      ...(status === 'PAID' ? { paidAt: new Date() } : {}),
      ...(status === 'SENT' || status === 'OVERDUE' || status === 'PARTIALLY_PAID' ? { sentAt: new Date() } : {}),
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
    await db.business.create({ data: { id: biz, name: `V57R ${tag}`, slug: `${P}${tag.toLowerCase()}`, ownerId: owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${tag}`, userId: owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V57R', lastName: `Customer ${tag}`, email } });
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

describe('send-reminder status gate (FU-SEND-REMINDER-SERVER-GATE)', () => {
  it.each(REFUSED)('SG-01 %s: 409 before any email, pay link, event or timeline entry; the body names the status, not the invoice', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const before = await db.invoice.findUnique({ where: { id: inv } });

    const res = await remind(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const body = JSON.stringify(res.body);
    expect(body).toContain(status);
    expect(body).not.toContain(before.invoiceNumber);
    expect(body).not.toContain('123.45');
    expect(body).not.toContain(EMAIL_A);
    expect(sentEmails, 'no email').toEqual([]);
    expect(await linksOf(inv), 'no pay link minted').toEqual([]);
    expect(emitted.map((e) => e.name), 'no event').toEqual([]);
    expect(timeline, 'no timeline entry').toEqual([]);
    const after = await db.invoice.findUnique({ where: { id: inv } });
    expect(after.status).toBe(status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it.each(['DRAFT', 'PENDING', 'FAILED', 'FULLY_CREDITED'] as const)('SG-02 %s with a live legacy pay link: refused, and the link token is not rotated', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);
    const legacy = await db.paymentLink.create({ data: { invoiceId: inv, businessId: ID.bizA } });
    expect(legacy.token, 'seeded legacy cuid token').toMatch(/^c[a-z0-9]{24}$/);

    const res = await remind(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(sentEmails).toEqual([]);
    expect(emitted).toEqual([]);
    expect((await linksOf(inv)).map((l: any) => [l.id, l.token, l.active, l.expiresAt])).toEqual([[legacy.id, legacy.token, true, null]]);
  });

  it.each(ALLOWED)('SG-03 %s: reminded exactly once (one email with the pay link, one live link, one event, one timeline entry); status unchanged', async (status) => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, status);

    const res = await remind(ID.bizA, inv);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.delivered).toBe(true);
    expect(res.body.channel).toBe('email');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(EMAIL_A);
    expect(sentEmails[0].subject).toContain('Reminder: Invoice #');
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0].active).toBe(true);
    expect(res.body.paymentUrl).toContain(`/public/invoice/${links[0].token}`);
    expect(sentEmails[0].htmlBody).toContain(`/public/invoice/${links[0].token}`);
    expect(emitted.map((e) => e.name)).toEqual(['invoice.payment_reminder_sent']);
    expect(timeline.map((e) => [e.type, e.data?.invoiceId, e.data?.status])).toEqual([['invoice.payment_reminder_sent', inv, status]]);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe(status);
  });

  it('SG-04 cross-tenant: B\'s invoice ids under A\'s business are 404 whatever their status; under B\'s business the guard refuses; nothing is sent', async () => {
    const bSent = await seedInvoice(ID.bizB, ID.contactB, 'SENT');
    const bDraft = await seedInvoice(ID.bizB, ID.contactB, 'DRAFT');

    for (const inv of [bSent, bDraft]) {
      const res = await remind(ID.bizA, inv);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('DRAFT');
      const viaB = await remind(ID.bizB, inv, ID.ownerA);
      expect(viaB.status, JSON.stringify(viaB.body)).toBe(403);
    }
    expect(sentEmails).toEqual([]);
    expect(emitted).toEqual([]);
    expect(timeline).toEqual([]);
    expect(await linksOf(bSent)).toEqual([]);
    expect(await linksOf(bDraft)).toEqual([]);
  });
});
