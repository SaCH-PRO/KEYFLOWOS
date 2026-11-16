/**
 * SWEEP-P0-SCOPES (browser sweep 2026-11-13, BUG-030 major) — a contact's Money and Quotes &
 * Invoices tabs list that contact's documents only, against a REAL database through the HTTP routes.
 *
 * BUG-030 (re-checked 2026-11-13): an onboarded owner's new contact showed the demo invoice of
 * "Sample Client" on its /money and /quotes-invoices tabs. Both tabs
 * (apps/web/src/app/app/crm/contacts/[contactId]/money/page.tsx and .../quotes-invoices/page.tsx)
 * call GET /commerce/businesses/:businessId/invoices?contactId=<id> and .../quotes?contactId=<id>;
 * CommerceController.listInvoices and listQuotes read only page and pageSize, so the contactId was
 * dropped and every invoice and quote of the business came back.
 *
 * The rule: with ?contactId=<id>, both lists answer only the documents of that contact (in the
 * route's business); without it they answer the whole business as before; the page totals count
 * the filtered set. The revenue read scope on both routes is unchanged.
 *
 * Nothing on the read path is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CommerceController and CommerceService are real against DATABASE_URL. Collaborators the two list
 * reads never call are stubs, as in quote-contact-tenant.integration.test.ts.
 *
 * Requires DATABASE_URL (and REDIS_URL for the public rate-limit guard the controller mounts).
 * Every seeded row carries the `v99c_` prefix and is hard-deleted by raw SQL (sqlLikePrefix) in
 * beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99c_';
const ID = {
  owner: `${P}owner`,
  staffNoRevenue: `${P}staffNoRevenue`, // STAFF of bizA, explicit revenue 'none'
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  ownerB: `${P}ownerB`,
  sample: `${P}c_sample`, // "Sample Client": the onboarding demo invoice's contact
  fresh: `${P}c_fresh`, // a contact created after onboarding, with no documents
  other: `${P}c_other`, // a third contact of bizA, with its own invoice and quote
  foreign: `${P}c_foreign`, // a contact of bizB
};

let db: any;
let app: any;
let redis: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const get = (url: string, actor: string) => request(app.getHttpServer()).get(url).set('x-test-user', actor);
const invoices = (biz: string = ID.bizA) => `/commerce/businesses/${biz}/invoices`;
const quotes = (biz: string = ID.bizA) => `/commerce/businesses/${biz}/quotes`;

async function seedInvoice(id: string, biz: string, contactId: string, number: string) {
  return db.invoice.create({
    data: { id, invoiceNumber: `${P}${number}`, status: 'SENT', subtotal: 100, total: 100, currency: 'TTD', businessId: biz, contactId },
  });
}
async function seedQuote(id: string, biz: string, contactId: string, number: string) {
  return db.quote.create({
    data: { id, quoteNumber: `${P}${number}`, status: 'SENT', subtotal: 20, total: 20, currency: 'TTD', businessId: biz, contactId },
  });
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
      { provide: RevenuePostingService, useValue: {} },
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: CrmService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.staffNoRevenue, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99C Biz A', ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99C Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staffNoRevenue, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.contact.create({ data: { id: ID.sample, businessId: ID.bizA, firstName: 'Sample', lastName: 'Client', email: `${P}sample@test.local` } });
  await db.contact.create({ data: { id: ID.fresh, businessId: ID.bizA, firstName: 'Fresh', lastName: 'Contact', email: `${P}fresh@test.local` } });
  await db.contact.create({ data: { id: ID.other, businessId: ID.bizA, firstName: 'Other', lastName: 'Contact', email: `${P}other@test.local` } });
  await db.contact.create({ data: { id: ID.foreign, businessId: ID.bizB, firstName: 'Foreign', lastName: 'Contact', email: `${P}foreign@test.local` } });

  await seedInvoice(`${P}inv_demo`, ID.bizA, ID.sample, 'DEMO-0001');
  await seedInvoice(`${P}inv_other`, ID.bizA, ID.other, 'INV-0002');
  await seedInvoice(`${P}inv_foreign`, ID.bizB, ID.foreign, 'INV-B-0001');
  await seedQuote(`${P}q_demo`, ID.bizA, ID.sample, 'QUO-DEMO');
  await seedQuote(`${P}q_other`, ID.bizA, ID.other, 'QUO-0002');
  await seedQuote(`${P}q_foreign`, ID.bizB, ID.foreign, 'QUO-B-0001');
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (redis) await redis.quit().catch(() => undefined);
  if (db) await cleanup();
});

const ids = (body: any) => (body?.data ?? []).map((d: any) => d.id).sort();

describe("BUG-030: a contact's Money and Quotes & Invoices tabs list that contact's documents only", () => {
  it('[CDOC-01] RED-BEFORE: a contact with no documents (the new contact) lists no invoice and no quote, not the demo invoice of Sample Client', async () => {
    const inv = await get(`${invoices()}?contactId=${ID.fresh}`, ID.owner);
    expect(inv.status).toBe(200);
    expect(ids(inv.body)).toEqual([]);
    expect(inv.body.total).toBe(0);
    const quo = await get(`${quotes()}?contactId=${ID.fresh}`, ID.owner);
    expect(quo.status).toBe(200);
    expect(ids(quo.body)).toEqual([]);
    expect(quo.body.total).toBe(0);
  });

  it("[CDOC-02] RED-BEFORE: a contact with documents lists exactly its own, and its page total counts only them", async () => {
    const inv = await get(`${invoices()}?contactId=${ID.sample}`, ID.owner);
    expect(ids(inv.body)).toEqual([`${P}inv_demo`]);
    expect(inv.body.total).toBe(1);
    for (const row of inv.body.data) expect(row.contactId).toBe(ID.sample);
    const quo = await get(`${quotes()}?contactId=${ID.other}`, ID.owner);
    expect(ids(quo.body)).toEqual([`${P}q_other`]);
    expect(quo.body.total).toBe(1);
  });

  it("[CDOC-03] RED-BEFORE: another business's contact id lists nothing in this business (the filter stays inside the route's tenant)", async () => {
    const inv = await get(`${invoices()}?contactId=${ID.foreign}`, ID.owner);
    expect(inv.status).toBe(200);
    expect(ids(inv.body)).toEqual([]);
    const quo = await get(`${quotes()}?contactId=${ID.foreign}`, ID.owner);
    expect(ids(quo.body)).toEqual([]);
  });

  it('[CDOC-04] without contactId both lists still answer every document of the business (the Invoices and Quotes pages)', async () => {
    const inv = await get(invoices(), ID.owner);
    expect(ids(inv.body)).toEqual([`${P}inv_demo`, `${P}inv_other`]);
    const quo = await get(quotes(), ID.owner);
    expect(ids(quo.body)).toEqual([`${P}q_demo`, `${P}q_other`]);
  });

  it('[CDOC-05] the revenue read scope is unchanged: a member with revenue none is refused, with or without contactId', async () => {
    expect((await get(`${invoices()}?contactId=${ID.sample}`, ID.staffNoRevenue)).status).toBe(403);
    expect((await get(`${quotes()}?contactId=${ID.sample}`, ID.staffNoRevenue)).status).toBe(403);
  });
});
