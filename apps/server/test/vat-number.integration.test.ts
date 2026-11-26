/**
 * P104 / V1-66 (VAT-BASICS server half, owner ruling D-165) — REAL database +
 * REAL HTTP (`supertest`).
 *
 * Contract pinned here:
 *
 *   1. Owner-only PATCH /identity/businesses/:businessId (D-11):
 *      - Owner sets `vatNumber: '  VAT-TT-12345  '` -> 200, trimmed `'VAT-TT-12345'`
 *        persisted in Postgres and returned by both PATCH and GET.
 *      - Owner clears `vatNumber` with `null`, `''`, or whitespace `'   '` -> 200,
 *        stored as `null` and returned as `null` by GET.
 *      - Invalid values: non-string (`123`) or length > 64 -> 400, row unchanged.
 *        A 64-character value is accepted (200).
 *      - ADMIN and STAFF (even with explicit `settings: 'write'`) -> 403, row
 *        byte-identical (D-11).
 *
 *   2. Taxed invoice (`taxRate: 12.5, taxAmount > 0`) on a business with
 *      `vatNumber = 'VAT-TT-12345'`:
 *      - GET /commerce/public/invoice-link/:token -> `invoice.business.vatNumber === 'VAT-TT-12345'`
 *      - GET /commerce/invoices/:id (anonymous public projection) -> `business.vatNumber === 'VAT-TT-12345'`
 *      - GET /commerce/public/invoice-link/:token/pay (pay-page projection) -> `business.vatNumber === 'VAT-TT-12345'`
 *      - GET /commerce/public/invoice-link/:token/receipt (paid) -> `business.vatNumber === 'VAT-TT-12345'`
 *      - GET /commerce/invoices/:id/receipt?businessId=:b (authenticated) -> `business.vatNumber === 'VAT-TT-12345'`
 *      - GET /commerce/businesses/:b/invoices/:id (operator) -> `business.vatNumber === 'VAT-TT-12345'`
 *
 *   3. Untaxed invoice (`taxRate: 0, taxAmount: 0`) on the SAME business with
 *      `vatNumber = 'VAT-TT-12345'`:
 *      - Public invoice-link, anonymous invoice projection, pay-page projection,
 *        public receipt, and authenticated receipt ALL omit the `vatNumber` key
 *        (`'vatNumber' in business === false`) so PC-01 / public-receipt exact
 *        key sets are preserved when no tax is charged.
 *
 *   4. Quotes (`GET /commerce/public/quotes/:token` + operator detail):
 *      - Taxed quote (`taxRate: 12.5, taxAmount > 0`) -> `business.vatNumber === 'VAT-TT-12345'`
 *        on public token view and operator quote detail.
 *      - Untaxed quote (`taxRate: 0, taxAmount: 0`) -> `'vatNumber' in res.body.business === false`
 *        on public token view.
 *
 *   5. Controls:
 *      - D-60 immutability: changing `defaultTaxRate` or `vatNumber` on the
 *        business after issuing an invoice does not alter stored `taxRate`,
 *        `taxAmount`, or `total` on the issued invoice.
 *      - `GET /identity/businesses/slug/:slug` (`PUBLIC_BUSINESS_FIELDS`) does
 *        NOT expose `vatNumber` (`'vatNumber' in res.body === false`).
 *      - Cross-tenant `PATCH /identity/businesses/:bizA` by another business's
 *        owner is refused `403`, row byte-identical.
 *
 * Fixtures: prefix `v66b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with inline `sqlLikePrefix(P)` in beforeAll & afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66b_';
const HEADER = 'x-v66b-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  staffWriteA: `${P}staffWriteA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizPatch: `${P}bizPatch`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactPatch: `${P}contactPatch`,
};

const SLUG = {
  bizA: `${P}biz-a`,
  bizPatch: `${P}biz-patch`,
  bizB: `${P}biz-b`,
};

const VAT = 'VAT-TT-12345';

let db: any;
let app: any;
let redis: any;

// Invoices and quotes created via real HTTP routes on bizA (vatNumber = VAT).
let taxedInvoiceId = '';
let taxedInvoiceToken = '';
let untaxedInvoiceId = '';
let untaxedInvoiceToken = '';
let taxedQuoteId = '';
let taxedQuoteToken = '';
let untaxedQuoteId = '';
let untaxedQuoteToken = '';

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

async function clearRateLimits() {
  if (!redis) return;
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

async function createAndPayInvoice(
  businessId: string,
  contactId: string,
  actorId: string,
  taxRate: number,
): Promise<{ id: string; token: string; total: number }> {
  const created = await agent()
    .post(`/commerce/businesses/${businessId}/invoices`)
    .set(HEADER, actorId)
    .send({
      contactId,
      currency: 'TTD',
      taxRate,
      items: [{ description: 'Advisory retainer', quantity: 1, unitPrice: 100 }],
    });
  if (created.status !== 201) {
    throw new Error(`createInvoice failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = created.body.id as string;
  const total = Number(created.body.total);

  const sent = await agent()
    .patch(`/commerce/invoices/${id}/status/SENT`)
    .set(HEADER, actorId)
    .send({ businessId, status: 'SENT' });
  if (sent.status !== 200) {
    throw new Error(`send invoice failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  }

  const linkRes = await agent()
    .post(`/commerce/businesses/${businessId}/invoices/${id}/payment-link`)
    .set(HEADER, actorId)
    .send({});
  if (linkRes.status !== 201 || !linkRes.body?.token) {
    throw new Error(`payment-link failed: ${linkRes.status} ${JSON.stringify(linkRes.body)}`);
  }

  const payRes = await agent()
    .post(`/commerce/businesses/${businessId}/invoices/${id}/payments`)
    .set(HEADER, actorId)
    .send({ amount: total, method: 'CASH', reference: `${P}ref_${id}` });
  if (payRes.status !== 201) {
    throw new Error(`record payment failed: ${payRes.status} ${JSON.stringify(payRes.body)}`);
  }

  return { id, token: linkRes.body.token as string, total };
}

async function createAndSendQuote(
  businessId: string,
  contactId: string,
  actorId: string,
  taxRate: number,
): Promise<{ id: string; token: string }> {
  const created = await agent()
    .post(`/commerce/businesses/${businessId}/quotes`)
    .set(HEADER, actorId)
    .send({
      contactId,
      currency: 'TTD',
      taxRate,
      items: [{ description: 'Implementation scope', quantity: 1, unitPrice: 200 }],
    });
  if (created.status !== 201) {
    throw new Error(`createQuote failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = created.body.id as string;

  const sent = await agent()
    .patch(`/commerce/quotes/${id}/status/SENT`)
    .set(HEADER, actorId)
    .send({ businessId, status: 'SENT' });
  if (sent.status !== 200) {
    throw new Error(`send quote failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  }

  const linkRes = await agent()
    .post(`/commerce/businesses/${businessId}/quotes/${id}/public-link`)
    .set(HEADER, actorId)
    .send({});
  if (linkRes.status !== 201 || !linkRes.body?.token) {
    throw new Error(`quote public-link failed: ${linkRes.status} ${JSON.stringify(linkRes.body)}`);
  }

  return { id, token: linkRes.body.token as string };
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
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { UpdateBusinessDto } = await import('../src/modules/identity/dto/update-business.dto');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
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
    controllers: [IdentityController, CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      IdentityService,
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: EventEmitter2,
        useValue: {
          emit: () => true,
          emitAsync: async () => [],
          on: () => undefined,
          off: () => undefined,
          once: () => undefined,
          removeListener: () => undefined,
        },
      },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: { sendEmail: async () => ({ messageId: `${P}msg` }) } },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Mirror tsc's emitted parameter metadata for UpdateBusinessDto so Nest's
  // global ValidationPipe({ whitelist: true, transform: true }) validates it
  // under vitest's esbuild transform identically to production.
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, UpdateBusinessDto, Object],
    IdentityController.prototype,
    'updateBusiness',
  );
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
  await app.init();

  await cleanup();
  await clearRateLimits();

  // Seed users
  for (const id of [ID.ownerA, ID.adminA, ID.staffWriteA, ID.ownerB]) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' },
    });
  }

  // Seed businesses
  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V66B VAT Co Ltd',
      slug: SLUG.bizA,
      ownerId: ID.ownerA,
      currency: 'TTD',
      defaultTaxRate: 12.5,
      vatNumber: VAT,
      email: `${P}biza@v66b.test.local`,
      phone: '+18685550100',
      address: '10 Frederick Street',
      city: 'Port of Spain',
      country: 'TT',
    },
  });
  await db.business.create({
    data: {
      id: ID.bizPatch,
      name: 'V66B Patch Test Co',
      slug: SLUG.bizPatch,
      ownerId: ID.ownerA,
      currency: 'TTD',
      defaultTaxRate: 12.5,
      vatNumber: null,
    },
  });
  await db.business.create({
    data: {
      id: ID.bizB,
      name: 'V66B Other Tenant',
      slug: SLUG.bizB,
      ownerId: ID.ownerB,
      currency: 'TTD',
    },
  });

  // Seed memberships
  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA_bizA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_adminA_bizA`, userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN' },
      {
        id: `${P}m_staffW_bizA`,
        userId: ID.staffWriteA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { settings: 'write' },
      },
      { id: `${P}m_ownerA_bizPatch`, userId: ID.ownerA, businessId: ID.bizPatch, role: 'OWNER' },
      { id: `${P}m_ownerB_bizB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  // Seed contacts
  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: 'Kerry',
      lastName: 'Customer',
      email: `${P}customerA@v66b.test.local`,
    },
  });
  await db.contact.create({
    data: {
      id: ID.contactPatch,
      businessId: ID.bizPatch,
      firstName: 'Pat',
      lastName: 'Client',
      email: `${P}customerPatch@v66b.test.local`,
    },
  });

  // Seed Chart of Accounts for businesses that post payments
  const coa = moduleRef.get(ChartOfAccountsSeederService);
  await coa.ensureDefaults(ID.bizA);
  await coa.ensureDefaults(ID.bizPatch);

  // Create taxed (12.5%) and untaxed (0%) paid invoices with live pay links on bizA
  const taxedInv = await createAndPayInvoice(ID.bizA, ID.contactA, ID.ownerA, 12.5);
  taxedInvoiceId = taxedInv.id;
  taxedInvoiceToken = taxedInv.token;

  const untaxedInv = await createAndPayInvoice(ID.bizA, ID.contactA, ID.ownerA, 0);
  untaxedInvoiceId = untaxedInv.id;
  untaxedInvoiceToken = untaxedInv.token;

  // Create taxed (12.5%) and untaxed (0%) sent quotes with public links on bizA
  const taxedQ = await createAndSendQuote(ID.bizA, ID.contactA, ID.ownerA, 12.5);
  taxedQuoteId = taxedQ.id;
  taxedQuoteToken = taxedQ.token;

  const untaxedQ = await createAndSendQuote(ID.bizA, ID.contactA, ID.ownerA, 0);
  untaxedQuoteId = untaxedQ.id;
  untaxedQuoteToken = untaxedQ.token;
}, 90_000);

beforeEach(async () => {
  await clearRateLimits();
});

afterAll(async () => {
  await clearRateLimits();
  if (PREVIOUS_RATE_LIMIT_NS === undefined) {
    delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  } else {
    process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  }
  if (app) await app.close();
  if (redis) await redis.quit();
  if (db) await cleanup();
}, 60_000);

describe('RED-BEFORE 1: Owner-only PATCH /identity/businesses/:businessId vatNumber (D-11, D-165)', () => {
  it('[V66B-P01] owner sets vatNumber with leading/trailing whitespace -> 200, trimmed value persisted & returned by GET', async () => {
    await db.business.update({ where: { id: ID.bizPatch }, data: { vatNumber: null } });

    const res = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ vatNumber: '  VAT-TT-12345  ' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.vatNumber).toBe(VAT);

    const stored = await db.business.findUnique({ where: { id: ID.bizPatch }, select: { vatNumber: true } });
    expect(stored?.vatNumber).toBe(VAT);

    const fetched = await agent()
      .get(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA);
    expect(fetched.status).toBe(200);
    expect(fetched.body.vatNumber).toBe(VAT);
  });

  it('[V66B-P02] owner clears vatNumber with null -> 200, stores null & returned as null by GET', async () => {
    await db.business.update({ where: { id: ID.bizPatch }, data: { vatNumber: 'VAT-CLEAR-NULL' } });

    const res = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ vatNumber: null });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.vatNumber).toBeNull();

    const stored = await db.business.findUnique({ where: { id: ID.bizPatch }, select: { vatNumber: true } });
    expect(stored?.vatNumber).toBeNull();

    const fetched = await agent()
      .get(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA);
    expect(fetched.status).toBe(200);
    expect(fetched.body.vatNumber).toBeNull();
  });

  it('[V66B-P03] owner clears vatNumber with empty string and whitespace-only string -> 200, stores null', async () => {
    for (const blank of ['', '   ']) {
      await db.business.update({ where: { id: ID.bizPatch }, data: { vatNumber: 'VAT-CLEAR-BLANK' } });

      const res = await agent()
        .patch(`/identity/businesses/${ID.bizPatch}`)
        .set(HEADER, ID.ownerA)
        .send({ vatNumber: blank });

      expect(res.status, `blank=${JSON.stringify(blank)}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.vatNumber).toBeNull();

      const stored = await db.business.findUnique({ where: { id: ID.bizPatch }, select: { vatNumber: true } });
      expect(stored?.vatNumber, `blank=${JSON.stringify(blank)}`).toBeNull();
    }
  });

  it('[V66B-P04] rejects non-string (123) and >64 chars with 400 (row unchanged); accepts 64-char max', async () => {
    await db.business.update({ where: { id: ID.bizPatch }, data: { vatNumber: 'VAT-KEEP-ME' } });
    const before = await businessRowText(ID.bizPatch);

    const nonString = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ vatNumber: 123 });
    expect(nonString.status, JSON.stringify(nonString.body)).toBe(400);
    expect(await businessRowText(ID.bizPatch)).toBe(before);

    const tooLong = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ vatNumber: 'V'.repeat(65) });
    expect(tooLong.status, JSON.stringify(tooLong.body)).toBe(400);
    expect(await businessRowText(ID.bizPatch)).toBe(before);

    const maxValid = 'V'.repeat(64);
    const ok = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ vatNumber: maxValid });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.vatNumber).toBe(maxValid);
  });

  it('[V66B-P05] ADMIN and STAFF (even with settings:write) are refused 403 and row stays byte-identical (D-11)', async () => {
    for (const actor of [ID.adminA, ID.staffWriteA]) {
      const before = await businessRowText(ID.bizA);
      const res = await agent()
        .patch(`/identity/businesses/${ID.bizA}`)
        .set(HEADER, actor)
        .send({ vatNumber: 'VAT-HIJACKED' });

      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(await businessRowText(ID.bizA), `${actor} left row byte-identical`).toBe(before);
    }
  });
});

describe('RED-BEFORE 2: Taxed invoice (taxRate 12.5, taxAmount > 0) exposes business.vatNumber on all invoice & receipt surfaces', () => {
  it('[V66B-T01] GET /commerce/public/invoice-link/:token returns invoice.business.vatNumber', async () => {
    const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(taxedInvoiceToken)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.totals.taxAmount).toBeGreaterThan(0);
    expect(res.body.invoice.business.vatNumber).toBe(VAT);
  });

  it('[V66B-T02] GET /commerce/invoices/:id (anonymous public projection) and GET /commerce/public/invoice-link/:token/pay return business.vatNumber', async () => {
    const bare = await agent().get(`/commerce/invoices/${taxedInvoiceId}`);
    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
    expect(bare.body.taxAmount).toBeGreaterThan(0);
    expect(bare.body.business.vatNumber).toBe(VAT);

    const payPage = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(taxedInvoiceToken)}/pay`);
    expect(payPage.status, JSON.stringify(payPage.body)).toBe(200);
    expect(payPage.body.taxAmount).toBeGreaterThan(0);
    expect(payPage.body.business.vatNumber).toBe(VAT);
  });

  it('[V66B-T03] GET /commerce/public/invoice-link/:token/receipt (paid) returns business.vatNumber', async () => {
    const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(taxedInvoiceToken)}/receipt`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.business.vatNumber).toBe(VAT);
  });

  it('[V66B-T04] GET /commerce/invoices/:id/receipt (authenticated) returns business.vatNumber', async () => {
    const res = await agent()
      .get(`/commerce/invoices/${taxedInvoiceId}/receipt?businessId=${ID.bizA}`)
      .set(HEADER, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.business.vatNumber).toBe(VAT);
  });

  it('[V66B-T05] Operator GET /commerce/businesses/:b/invoices/:id returns business.vatNumber', async () => {
    const res = await agent()
      .get(`/commerce/businesses/${ID.bizA}/invoices/${taxedInvoiceId}`)
      .set(HEADER, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.business.vatNumber).toBe(VAT);
  });
});

describe('RED-BEFORE 3: Untaxed invoice (taxRate 0, taxAmount 0) on same business omits business.vatNumber key everywhere on public & receipt surfaces', () => {
  it('[V66B-U01] public invoice-link omits business.vatNumber key', async () => {
    const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(untaxedInvoiceToken)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.totals.taxAmount).toBe(0);
    expect('vatNumber' in res.body.invoice.business).toBe(false);
  });

  it('[V66B-U02] anonymous invoice projection and token pay-page projection omit business.vatNumber key', async () => {
    const bare = await agent().get(`/commerce/invoices/${untaxedInvoiceId}`);
    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
    expect(bare.body.taxAmount).toBe(0);
    expect('vatNumber' in bare.body.business).toBe(false);

    const payPage = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(untaxedInvoiceToken)}/pay`);
    expect(payPage.status, JSON.stringify(payPage.body)).toBe(200);
    expect(payPage.body.taxAmount).toBe(0);
    expect('vatNumber' in payPage.body.business).toBe(false);
  });

  it('[V66B-U03] public receipt and authenticated receipt omit business.vatNumber key', async () => {
    const pub = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(untaxedInvoiceToken)}/receipt`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect('vatNumber' in pub.body.business).toBe(false);

    const auth = await agent()
      .get(`/commerce/invoices/${untaxedInvoiceId}/receipt?businessId=${ID.bizA}`)
      .set(HEADER, ID.ownerA);
    expect(auth.status, JSON.stringify(auth.body)).toBe(200);
    expect('vatNumber' in auth.body.business).toBe(false);
  });
});

describe('RED-BEFORE 4: Quotes (GET /commerce/public/quotes/:token and operator detail)', () => {
  it('[V66B-Q01] taxed quote (taxAmount > 0) exposes business.vatNumber on public quote link and operator detail', async () => {
    const pub = await agent().get(`/commerce/public/quotes/${encodeURIComponent(taxedQuoteToken)}`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.taxAmount).toBeGreaterThan(0);
    expect(pub.body.business.vatNumber).toBe(VAT);

    const op = await agent()
      .get(`/commerce/businesses/${ID.bizA}/quotes/${taxedQuoteId}`)
      .set(HEADER, ID.ownerA);
    expect(op.status, JSON.stringify(op.body)).toBe(200);
    expect(op.body.business.vatNumber).toBe(VAT);
  });

  it('[V66B-Q02] untaxed quote (taxAmount 0) omits business.vatNumber key on public quote link', async () => {
    const pub = await agent().get(`/commerce/public/quotes/${encodeURIComponent(untaxedQuoteToken)}`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.taxAmount).toBe(0);
    expect('vatNumber' in pub.body.business).toBe(false);
  });
});

describe('Controls: D-60 immutability, PUBLIC_BUSINESS_FIELDS slug privacy, cross-tenant PATCH', () => {
  it('[V66B-C01] D-60 immutability: changing defaultTaxRate or vatNumber after issue does not alter stored taxRate/taxAmount/total on issued invoice', async () => {
    await db.business.update({
      where: { id: ID.bizPatch },
      data: { defaultTaxRate: 12.5, vatNumber: VAT },
    });

    const created = await agent()
      .post(`/commerce/businesses/${ID.bizPatch}/invoices`)
      .set(HEADER, ID.ownerA)
      .send({
        contactId: ID.contactPatch,
        currency: 'TTD',
        taxRate: 12.5,
        items: [{ description: 'Immutability check', quantity: 1, unitPrice: 100 }],
      });
    expect(created.status).toBe(201);
    const invId = created.body.id as string;

    const sent = await agent()
      .patch(`/commerce/invoices/${invId}/status/SENT`)
      .set(HEADER, ID.ownerA)
      .send({ businessId: ID.bizPatch, status: 'SENT' });
    expect(sent.status).toBe(200);

    const patchRes = await agent()
      .patch(`/identity/businesses/${ID.bizPatch}`)
      .set(HEADER, ID.ownerA)
      .send({ defaultTaxRate: 20, vatNumber: 'VAT-TT-99999' });
    expect(patchRes.status).toBe(200);

    const stored = await db.invoice.findUnique({
      where: { id: invId },
      select: { taxRate: true, taxAmount: true, total: true },
    });
    expect(stored?.taxRate).toBe(12.5);
    expect(stored?.taxAmount).toBe(12.5);
    expect(stored?.total).toBe(112.5);
  });

  it('[V66B-C02] GET /identity/businesses/slug/:slug (PUBLIC_BUSINESS_FIELDS) does NOT expose vatNumber', async () => {
    const res = await agent().get(`/identity/businesses/slug/${SLUG.bizA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slug).toBe(SLUG.bizA);
    expect('vatNumber' in res.body).toBe(false);
  });

  it('[V66B-C03] cross-tenant PATCH /identity/businesses/:bizA by ownerB is refused 403 and row stays byte-identical', async () => {
    const before = await businessRowText(ID.bizA);
    const res = await agent()
      .patch(`/identity/businesses/${ID.bizA}`)
      .set(HEADER, ID.ownerB)
      .send({ vatNumber: 'VAT-FOREIGN-HIJACK' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });
});
