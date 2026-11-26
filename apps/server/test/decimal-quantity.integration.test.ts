/**
 * P108 (V1-64 / DECIMALS-SERVER, D-166) — decimal quantities up to 2 decimal
 * places on commercial document lines, with whole-unit enforcement for
 * stock-tracked products (REAL Postgres, REAL HTTP ValidationPipe +
 * GlobalHttpExceptionFilter, REAL CommerceService, InvoiceWorkflowService,
 * InvoiceReceiptBuilderService, RecurringInvoiceService, CreditNoteService,
 * RevenuePostingService, PostingService, and KEY FlowOrchestratorService
 * dispatcher).
 *
 * Proof groups:
 *   1. Non-stock / service lines: 2.5 x 100.00 -> 201, persisted quantity 2.5,
 *      total 250, ACCRUAL posting 250.00, receipt payload preserves 2.5;
 *      1.25 x 33.33 === 41.66 rounding; 1.15 x 100 === 115 (IEEE-754 trap).
 *   2. Validation boundaries: 1.555 (3 decimals), 0.001, 0, -1, '2',
 *      2147483648 -> 400 with 0 writes.
 *   3. Stock-tracked refusal (canonical isStockTracked + ownStockRows):
 *      - inventoryMode: 'tracked' -> 1.5 refused 400 + 0 writes; 2 -> 201
 *      - inventoryMode: null + own InventoryStock -> 1.5 refused 400 + 0 writes; 2 -> 201
 *      - inventoryMode: null + 0 own stock (even with planted foreign stock) -> 1.5 -> 201
 *      - inventoryMode: 'untracked' (even with own stock) -> 1.5 -> 201
 *      - cross-tenant productId -> 404 + 0 writes
 *   4. All document write paths: quote create, quote update, quote convert,
 *      invoice update, duplicate-via-create, credit note create/update,
 *      recurring schedule create/update + processRecurringInvoices.
 *   5. KEY commerce_create_invoice & commerce_create_quote: schema declares
 *      quantity: number and productId: string; 2.5 succeeds; 1.5 on tracked
 *      productId refused with zero writes.
 *
 * Fixtures: prefix `v64f_`; hard-deleted by raw SQL with sqlLikePrefix(P) in
 * dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64f_';
const HEADER = 'x-v64f-user';
const TRACKED_MSG = 'Stock-tracked products must be billed in whole units';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  warehouseA: `${P}whA`,
  warehouseB: `${P}whB`,
  prodTrackedExplicit: `${P}prodTrackedExplicit`,
  prodNullWithStock: `${P}prodNullWithStock`,
  prodNullNoStock: `${P}prodNullNoStock`,
  prodUntrackedWithStock: `${P}prodUntrackedWithStock`,
  prodFlipsTracked: `${P}prodFlipsTracked`,
  prodFlipsTrackedRec: `${P}prodFlipsTrackedRec`,
  prodBizB: `${P}prodBizB`,
};

let db: any;
let app: any;
let redis: any;
let commerceSvc: any;
let creditNoteSvc: any;
let recurringRunner: any;
let keyDispatcher: any;
let getToolByNameFn: (name: string) => any;

const recordedEvents: Array<{ name: string; payload: unknown }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return true;
  },
  emitAsync: async (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return [];
  },
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

function wrapClientForRecurring(client: any, tx: boolean): any {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'recurringInvoice' && !tx) {
        const delegate = Reflect.get(target, prop);
        return new Proxy(delegate, {
          get(dTarget, dProp) {
            const orig = Reflect.get(dTarget, dProp);
            if (typeof orig !== 'function') return orig;
            if (dProp === 'findMany') {
              return (...args: any[]) => {
                const a = args[0] ?? {};
                const scoped = { ...a, where: { AND: [a.where ?? {}, { businessId: { in: [ID.bizA] } }] } };
                return orig.apply(dTarget, [scoped]);
              };
            }
            return orig.bind(dTarget);
          },
        });
      }
      if (prop === '$transaction' && !tx) {
        return (arg: any, opts?: any) =>
          typeof arg === 'function'
            ? target.$transaction((inner: any) => arg(wrapClientForRecurring(inner, true)), opts)
            : target.$transaction(arg, opts);
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function asA(req: request.Test) {
  return req.set(HEADER, ID.ownerA);
}

async function countBizA() {
  const [invoices, quotes, creditNotes, recurring, transactions] = await Promise.all([
    db.invoice.count({ where: { businessId: ID.bizA } }),
    db.quote.count({ where: { businessId: ID.bizA } }),
    db.creditNote.count({ where: { businessId: ID.bizA } }),
    db.recurringInvoice.count({ where: { businessId: ID.bizA } }),
    db.financialTransaction.count({ where: { businessId: ID.bizA } }),
  ]);
  return { invoices, quotes, creditNotes, recurring, transactions };
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
  const { RecurringInvoiceController } = await import('../src/modules/commerce/recurring-invoice.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
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
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { CreditNoteService } = await import('../src/modules/finance/credit-note.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { getToolByName } = await import('../src/modules/ai/flow-tool-registry');
  getToolByNameFn = getToolByName;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, RecurringInvoiceController],
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
      RecurringInvoiceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      PostingService,
      ChartOfAccountsSeederService,
      RevenuePostingService,
      CreditNoteService,
      { provide: ExpensePostingService, useValue: { postCogsForPaidInvoice: async () => null } },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: { logContactEvent: async () => ({ id: `${P}evt` }) } },
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

  commerceSvc = moduleRef.get(CommerceService);
  creditNoteSvc = moduleRef.get(CreditNoteService);
  const prismaSvc = moduleRef.get(PrismaService);
  const workflowSvc = moduleRef.get(InvoiceWorkflowService);
  const coaSeeder = moduleRef.get(ChartOfAccountsSeederService);

  // Recurring runner scoped to ID.bizA so processRecurringInvoices() never reads other suites' schedules.
  const scopedPrisma = { client: wrapClientForRecurring(prismaSvc.client, false) } as any;
  recurringRunner = new RecurringInvoiceService(scopedPrisma, eventRecorder as any, workflowSvc);

  // KEY FlowOrchestratorService dispatcher backed by the real CommerceService and PrismaService.
  const proto = FlowOrchestratorService.prototype as any;
  keyDispatcher = Object.create(proto);
  keyDispatcher.prisma = prismaSvc;
  keyDispatcher.commerce = commerceSvc;
  keyDispatcher.getCommerce = () => commerceSvc;

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
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V64F Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V64F Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V64F', lastName: 'ClientA', email: `${P}clienta@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V64F', lastName: 'ClientB', email: `${P}clientb@test.local` } });
  await coaSeeder.ensureDefaults(ID.bizA);

  await db.warehouse.create({ data: { id: ID.warehouseA, businessId: ID.bizA, name: 'V64F Main A' } });
  await db.warehouse.create({ data: { id: ID.warehouseB, businessId: ID.bizB, name: 'V64F Main B' } });

  // 1. Explicitly tracked (no stock row needed).
  await db.product.create({
    data: { id: ID.prodTrackedExplicit, businessId: ID.bizA, name: 'V64F Tracked Explicit', price: 100, inventoryMode: 'tracked' },
  });
  // 2. inventoryMode: null WITH own InventoryStock row -> tracked by canonical rule.
  await db.product.create({
    data: { id: ID.prodNullWithStock, businessId: ID.bizA, name: 'V64F Null With Stock', price: 100, inventoryMode: null },
  });
  await db.inventoryStock.create({
    data: { id: `${P}stk_null_own`, businessId: ID.bizA, productId: ID.prodNullWithStock, warehouseId: ID.warehouseA, quantity: 10 },
  });
  // 3. inventoryMode: null with 0 own stock rows (and a planted foreign-tenant stock row -> must stay untracked!).
  await db.product.create({
    data: { id: ID.prodNullNoStock, businessId: ID.bizA, name: 'V64F Null No Own Stock', price: 100, inventoryMode: null },
  });
  await db.inventoryStock.create({
    data: { id: `${P}stk_planted_foreign`, businessId: ID.bizB, productId: ID.prodNullNoStock, warehouseId: ID.warehouseB, quantity: 5 },
  });
  // 4. Explicitly untracked even with an own stock row -> untracked by canonical rule.
  await db.product.create({
    data: { id: ID.prodUntrackedWithStock, businessId: ID.bizA, name: 'V64F Untracked Explicit', price: 100, inventoryMode: 'untracked' },
  });
  await db.inventoryStock.create({
    data: { id: `${P}stk_untracked_own`, businessId: ID.bizA, productId: ID.prodUntrackedWithStock, warehouseId: ID.warehouseA, quantity: 10 },
  });
  // 5. Products that start untracked and flip to tracked to test convertQuoteToInvoice & processRecurringInvoices re-checks.
  await db.product.create({
    data: { id: ID.prodFlipsTracked, businessId: ID.bizA, name: 'V64F Flips Tracked Quote', price: 100, inventoryMode: null },
  });
  await db.product.create({
    data: { id: ID.prodFlipsTrackedRec, businessId: ID.bizA, name: 'V64F Flips Tracked Rec', price: 100, inventoryMode: null },
  });
  // 6. Cross-tenant product belonging to bizB.
  await db.product.create({
    data: { id: ID.prodBizB, businessId: ID.bizB, name: 'V64F Foreign Product', price: 100, inventoryMode: null },
  });
}, 180_000);

afterAll(async () => {
  await cleanup();
  if (app) await app.close();
  if (redis) await redis.quit();
}, 30_000);

beforeEach(() => {
  recordedEvents.length = 0;
});

describe('P108 DECIMALS-SERVER: 1. Non-stock fractional billing, rounding, accrual posting & receipt', () => {
  it('2.5 x 100.00 persists quantity 2.5 and total 250, posts 250.00 on ACCRUAL issue, and receipt preserves 2.5', async () => {
    const createRes = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Consulting hours', quantity: 2.5, unitPrice: 100 }],
        }),
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.total).toBe(250);
    expect(createRes.body.subtotal).toBe(250);
    expect(createRes.body.items).toHaveLength(1);
    expect(createRes.body.items[0].quantity).toBe(2.5);
    expect(createRes.body.items[0].total).toBe(250);

    const invoiceId = createRes.body.id as string;
    const itemRows: Array<{ quantity: number; total: number }> = await db.$queryRawUnsafe(
      `SELECT quantity, total FROM invoice_items WHERE invoice_id = '${invoiceId}'`,
    );
    expect(itemRows).toEqual([{ quantity: 2.5, total: 250 }]);

    // Issue invoice -> ACCRUAL posts AR 250.00
    const issueRes = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`)
        .send({ status: 'SENT' }),
    );
    expect(issueRes.status).toBe(200);
    const posting = await db.financialTransaction.findUnique({
      where: {
        businessId_externalRef: {
          businessId: ID.bizA,
          externalRef: `Invoice:${invoiceId}:invoice_finalized`,
        },
      },
    });
    expect(posting).toBeTruthy();
    expect(Number(posting.amount)).toBe(250);

    // Receipt preserves fractional quantity 2.5
    const receiptRes = await asA(
      agent().get(`/commerce/invoices/${invoiceId}/receipt?businessId=${ID.bizA}`),
    );
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.total).toBe(250);
    expect(receiptRes.body.items[0].quantity).toBe(2.5);
    expect(receiptRes.body.items[0].total).toBe(250);
  });

  it('exact decimal rounding (1.25 x 33.33 === 41.66) and IEEE-754 float trap (1.15 x 100 === 115)', async () => {
    const r1 = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Design slice', quantity: 1.25, unitPrice: 33.33 }],
        }),
    );
    expect(r1.status).toBe(201);
    expect(r1.body.items[0].quantity).toBe(1.25);
    expect(r1.body.items[0].total).toBe(41.66);
    expect(r1.body.total).toBe(41.66);

    const r2 = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'IEEE-754 trap 1.15', quantity: 1.15, unitPrice: 100 }],
        }),
    );
    expect(r2.status).toBe(201);
    expect(r2.body.items[0].quantity).toBe(1.15);
    expect(r2.body.items[0].total).toBe(115);
    expect(r2.body.total).toBe(115);
  });
});

describe('P108 DECIMALS-SERVER: 2. Validation boundaries', () => {
  for (const [label, quantity] of [
    ['3 decimals (1.555)', 1.555],
    ['3 decimals (0.001)', 0.001],
    ['zero (0)', 0],
    ['negative (-1)', -1],
    ['string ("2")', '2'],
    ['above MAX_LINE_QUANTITY (2147483648)', 2147483648],
  ] as const) {
    it(`rejects ${label} with 400 and zero DB writes`, async () => {
      const before = await countBizA();
      const res = await asA(
        agent()
          .post(`/commerce/businesses/${ID.bizA}/invoices`)
          .send({
            contactId: ID.contactA,
            items: [{ description: `Bad ${label}`, quantity, unitPrice: 50 }],
          }),
      );
      expect(res.status, label).toBe(400);
      expect(await countBizA()).toEqual(before);
    });
  }
});

describe('P108 DECIMALS-SERVER: 3. Stock-tracked refusal (canonical isStockTracked + ownStockRows) & cross-tenant product', () => {
  it('explicit inventoryMode=tracked refuses 1.5 (400, 0 writes) and accepts whole unit 2 (persisting productId)', async () => {
    const before = await countBizA();
    const refused = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Widget', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        }),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe(TRACKED_MSG);
    expect(await countBizA()).toEqual(before);

    const accepted = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Widget', quantity: 2, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        }),
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.items[0].quantity).toBe(2);
    expect(accepted.body.items[0].productId).toBe(ID.prodTrackedExplicit);
  });

  it('inventoryMode=null WITH own InventoryStock row refuses 1.5 (400, 0 writes) and accepts whole unit 2', async () => {
    const before = await countBizA();
    const refused = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Stocked item', quantity: 1.5, unitPrice: 100, productId: ID.prodNullWithStock }],
        }),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe(TRACKED_MSG);
    expect(await countBizA()).toEqual(before);

    const accepted = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Stocked item', quantity: 2, unitPrice: 100, productId: ID.prodNullWithStock }],
        }),
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.items[0].quantity).toBe(2);
    expect(accepted.body.items[0].productId).toBe(ID.prodNullWithStock);
  });

  it('untracked products (null with 0 own stock despite planted foreign row, AND explicit untracked with own stock) accept 1.5', async () => {
    for (const productId of [ID.prodNullNoStock, ID.prodUntrackedWithStock]) {
      const res = await asA(
        agent()
          .post(`/commerce/businesses/${ID.bizA}/invoices`)
          .send({
            contactId: ID.contactA,
            items: [{ description: 'Untracked item', quantity: 1.5, unitPrice: 100, productId }],
          }),
      );
      expect(res.status, productId).toBe(201);
      expect(res.body.items[0].quantity).toBe(1.5);
      expect(res.body.items[0].productId).toBe(productId);
      expect(res.body.total).toBe(150);
    }
  });

  it('cross-tenant productId returns 404 with zero writes', async () => {
    const before = await countBizA();
    const res = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Foreign prod', quantity: 1.5, unitPrice: 100, productId: ID.prodBizB }],
        }),
    );
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Product not found');
    expect(await countBizA()).toEqual(before);
  });
});

describe('P108 DECIMALS-SERVER: 4. All document write paths (Quote, Convert, Invoice update, Duplicate, Credit Note, Recurring)', () => {
  it('quote create (2.5), quote update (2.5), quote convert (2.5), and tracked-product refusals on each', async () => {
    // Tracked refusal on quote create
    const beforeCreate = await countBizA();
    const badCreate = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        }),
    );
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.message).toBe(TRACKED_MSG);
    expect(await countBizA()).toEqual(beforeCreate);

    // Quote create 2.5
    const qCreate = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Advisory', quantity: 2.5, unitPrice: 100 }],
        }),
    );
    expect(qCreate.status).toBe(201);
    expect(qCreate.body.items[0].quantity).toBe(2.5);
    expect(qCreate.body.total).toBe(250);
    const quoteId = qCreate.body.id as string;

    // Quote update refusal on tracked product (leaves items unchanged)
    const badUpdate = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}`)
        .send({
          items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        }),
    );
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.message).toBe(TRACKED_MSG);

    // Quote update 2.5
    const qUpdate = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}`)
        .send({
          items: [{ description: 'Advisory updated', quantity: 2.5, unitPrice: 80 }],
        }),
    );
    expect(qUpdate.status).toBe(200);
    expect(qUpdate.body.items[0].quantity).toBe(2.5);
    expect(qUpdate.body.total).toBe(200);

    // Accept quote & convert -> invoice preserves 2.5
    await db.quote.update({ where: { id: quoteId }, data: { status: 'SENT' } });
    await db.quote.update({ where: { id: quoteId }, data: { status: 'ACCEPTED' } });
    const conv = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes/${quoteId}/convert`)
        .send({}),
    );
    expect(conv.status).toBe(201);
    expect(conv.body.items[0].quantity).toBe(2.5);
    expect(conv.body.total).toBe(200);

    // Convert re-check: quote created while product was untracked, then product becomes tracked -> 400 + 0 invoices
    const qFlip = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Flipping prod', quantity: 1.5, unitPrice: 100, productId: ID.prodFlipsTracked }],
        }),
    );
    expect(qFlip.status).toBe(201);
    const flipQuoteId = qFlip.body.id as string;
    await db.quote.update({ where: { id: flipQuoteId }, data: { status: 'ACCEPTED' } });
    await db.product.update({ where: { id: ID.prodFlipsTracked }, data: { inventoryMode: 'tracked' } });

    const beforeConv = await countBizA();
    const badConv = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes/${flipQuoteId}/convert`)
        .send({}),
    );
    expect(badConv.status).toBe(400);
    expect(badConv.body.message).toBe(TRACKED_MSG);
    expect(await countBizA()).toEqual(beforeConv);
  });

  it('invoice update (2.5, tracked refusal 400, 3-decimal refusal 400) and duplicate-via-create (2.5)', async () => {
    const created = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Initial', quantity: 1, unitPrice: 100 }],
        }),
    );
    expect(created.status).toBe(201);
    const invoiceId = created.body.id as string;

    // PATCH with 2.5 succeeds
    const patched = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`)
        .send({
          items: [{ description: 'Updated hrs', quantity: 2.5, unitPrice: 100 }],
        }),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.items[0].quantity).toBe(2.5);
    expect(patched.body.total).toBe(250);

    // PATCH with 1.5 on tracked product -> 400, existing items untouched
    const badTracked = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`)
        .send({
          items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        }),
    );
    expect(badTracked.status).toBe(400);
    expect(badTracked.body.message).toBe(TRACKED_MSG);

    // PATCH with 1.555 -> 400, existing items untouched
    const badDecimals = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/invoices/${invoiceId}`)
        .send({
          items: [{ description: 'Too precise', quantity: 1.555, unitPrice: 100 }],
        }),
    );
    expect(badDecimals.status).toBe(400);

    const stillStored = await db.invoiceItem.findMany({ where: { invoiceId } });
    expect(stillStored).toHaveLength(1);
    expect(stillStored[0].quantity).toBe(2.5);

    // Duplicate-via-create: copy items from the fractional invoice into a new POST
    const dup = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: stillStored.map((it: any) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            ...(it.productId ? { productId: it.productId } : {}),
          })),
        }),
    );
    expect(dup.status).toBe(201);
    expect(dup.body.items[0].quantity).toBe(2.5);
    expect(dup.body.total).toBe(250);
  });

  it('credit note create & update accept 2.5, refuse 1.5 on tracked product (400), 1.555 (400), and foreign productId (404)', async () => {
    const inv = await commerceSvc.createInvoice({
      businessId: ID.bizA,
      contactId: ID.contactA,
      items: [{ description: 'Base service', quantity: 5, unitPrice: 100 }],
    });
    await db.invoice.update({ where: { id: inv.id }, data: { status: 'SENT' } });

    const beforeBad = await countBizA();
    await expect(
      creditNoteSvc.create(ID.bizA, {
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-BAD-TRK`,
        amount: 150,
        items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, amount: 150, productId: ID.prodTrackedExplicit }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      creditNoteSvc.create(ID.bizA, {
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-BAD-DEC`,
        amount: 100,
        items: [{ description: 'Too precise', quantity: 1.555, unitPrice: 100, amount: 100 }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      creditNoteSvc.create(ID.bizA, {
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-BAD-FOR`,
        amount: 100,
        items: [{ description: 'Foreign', quantity: 1.5, unitPrice: 100, amount: 100, productId: ID.prodBizB }],
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await countBizA()).toEqual(beforeBad);

    const cn = await creditNoteSvc.create(ID.bizA, {
      invoiceId: inv.id,
      creditNoteNumber: `${P}CN-OK-1`,
      amount: 250,
      items: [{ description: 'Credit 2.5 hrs', quantity: 2.5, unitPrice: 100, amount: 250 }],
    });
    expect(Array.isArray(cn.items)).toBe(true);
    expect((cn.items as any[])[0].quantity).toBe(2.5);

    // Update refusal on tracked product
    await expect(
      creditNoteSvc.update(ID.bizA, cn.id, {
        items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, amount: 150, productId: ID.prodTrackedExplicit }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recurring schedule create/update + processRecurringInvoices preserves 2.5 and refuses 1.5 on tracked product', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    // Create refused on tracked product with 1.5 -> 400, 0 writes
    const beforeBad = await countBizA();
    const badRec = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/recurring-invoices`)
        .send({
          contactId: ID.contactA,
          name: 'Bad tracked recurring',
          frequency: 'MONTHLY',
          amount: 150,
          startDate: pastDate,
          nextRunDate: pastDate,
          metadata: {
            items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
          },
        }),
    );
    expect(badRec.status).toBe(400);
    expect(badRec.body.message).toBe(TRACKED_MSG);
    expect(await countBizA()).toEqual(beforeBad);

    // Create valid fractional recurring schedule -> 201
    const okRec = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/recurring-invoices`)
        .send({
          contactId: ID.contactA,
          name: 'Fractional retainer',
          frequency: 'MONTHLY',
          amount: 250,
          startDate: pastDate,
          nextRunDate: pastDate,
          metadata: {
            items: [{ description: 'Retainer hrs', quantity: 2.5, unitPrice: 100 }],
          },
        }),
    );
    expect(okRec.status).toBe(201);
    const scheduleId = okRec.body.id as string;

    // PATCH update refused on tracked product with 1.5
    const badPatch = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/recurring-invoices/${scheduleId}`)
        .send({
          metadata: {
            items: [{ description: 'Tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
          },
        }),
    );
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.message).toBe(TRACKED_MSG);

    // Run scheduler -> generates SENT invoice with quantity 2.5, total 250
    const generated = await recurringRunner.processRecurringInvoices();
    const match = generated.find((g: any) => g.recurringId === scheduleId);
    expect(match).toBeTruthy();

    const genInv = await db.invoice.findUnique({
      where: { id: match.invoiceId },
      include: { items: true },
    });
    expect(genInv.status).toBe('SENT');
    expect(genInv.total).toBe(250);
    expect(genInv.subtotal).toBe(250);
    expect(genInv.items).toHaveLength(1);
    expect(genInv.items[0].quantity).toBe(2.5);
    expect(genInv.items[0].total).toBe(250);

    // Cancel first schedule so it doesn't interfere, then test schedule whose product flips to tracked before run
    await db.recurringInvoice.update({ where: { id: scheduleId }, data: { status: 'CANCELLED' } });

    const flipRec = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/recurring-invoices`)
        .send({
          contactId: ID.contactA,
          name: 'Flipping tracked recurring',
          frequency: 'MONTHLY',
          amount: 150,
          startDate: pastDate,
          nextRunDate: pastDate,
          metadata: {
            items: [{ description: 'Flipping item', quantity: 1.5, unitPrice: 100, productId: ID.prodFlipsTrackedRec }],
          },
        }),
    );
    expect(flipRec.status).toBe(201);
    const flipRecId = flipRec.body.id as string;
    await db.product.update({ where: { id: ID.prodFlipsTrackedRec }, data: { inventoryMode: 'tracked' } });

    const invCountBefore = await db.invoice.count({ where: { businessId: ID.bizA } });
    const flipRun = await recurringRunner.processRecurringInvoices();
    expect(flipRun.find((g: any) => g.recurringId === flipRecId)).toBeUndefined();
    expect(await db.invoice.count({ where: { businessId: ID.bizA } })).toBe(invCountBefore);
    const failedSchedule = await db.recurringInvoice.findUnique({ where: { id: flipRecId } });
    expect(failedSchedule.failureCount).toBeGreaterThanOrEqual(1);
    expect(failedSchedule.lastError).toContain(TRACKED_MSG);
    await db.recurringInvoice.update({ where: { id: flipRecId }, data: { status: 'CANCELLED' } });
  });
});

describe('P108 DECIMALS-SERVER: 5. KEY commerce_create_invoice & commerce_create_quote', () => {
  it('tool registry declares items.items.properties with quantity: number and productId: string', () => {
    for (const toolName of ['commerce_create_invoice', 'commerce_create_quote']) {
      const tool = getToolByNameFn(toolName);
      expect(tool, toolName).toBeTruthy();
      const itemSchema = tool.parameters.properties.items.items;
      expect(itemSchema.properties?.quantity?.type, `${toolName} quantity type`).toBe('number');
      expect(itemSchema.properties?.unitPrice?.type, `${toolName} unitPrice type`).toBe('number');
      expect(itemSchema.properties?.description?.type, `${toolName} description type`).toBe('string');
      expect(itemSchema.properties?.productId?.type, `${toolName} productId type`).toBe('string');
    }
  });

  it('commerce_create_invoice & commerce_create_quote accept 2.5 and refuse 1.5 on tracked productId with zero writes', async () => {
    const action = { userId: ID.ownerA, surface: 'chat' };

    // Invoice 2.5 succeeds
    const invRes = await keyDispatcher.executeToolAction(
      ID.bizA,
      'commerce_create_invoice',
      {
        contactId: ID.contactA,
        items: [{ description: 'KEY consulting', quantity: 2.5, unitPrice: 100 }],
      },
      action,
    );
    expect(invRes.invoice.total).toBe(250);
    expect(invRes.invoice.items[0].quantity).toBe(2.5);

    // Invoice 1.5 on tracked productId refused with zero writes
    const beforeInvBad = await countBizA();
    await expect(
      keyDispatcher.executeToolAction(
        ID.bizA,
        'commerce_create_invoice',
        {
          contactId: ID.contactA,
          items: [{ description: 'KEY tracked', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        },
        action,
      ),
    ).rejects.toThrow(TRACKED_MSG);
    expect(await countBizA()).toEqual(beforeInvBad);

    // Quote 2.5 succeeds
    const qtRes = await keyDispatcher.executeToolAction(
      ID.bizA,
      'commerce_create_quote',
      {
        contactId: ID.contactA,
        items: [{ description: 'KEY quote hrs', quantity: 2.5, unitPrice: 100 }],
      },
      action,
    );
    expect(qtRes.quote.total).toBe(250);
    expect(qtRes.quote.items[0].quantity).toBe(2.5);

    // Quote 1.5 on tracked productId refused with zero writes
    const beforeQtBad = await countBizA();
    await expect(
      keyDispatcher.executeToolAction(
        ID.bizA,
        'commerce_create_quote',
        {
          contactId: ID.contactA,
          items: [{ description: 'KEY tracked qt', quantity: 1.5, unitPrice: 100, productId: ID.prodTrackedExplicit }],
        },
        action,
      ),
    ).rejects.toThrow(TRACKED_MSG);
    expect(await countBizA()).toEqual(beforeQtBad);
  });
});

describe('P108 DECIMALS-SERVER: 6. R1 review regressions (scientific-notation floats & recurring MAX_DOCUMENT_AMOUNT)', () => {
  it('R1-SEC-01 / R1-COR-01: quantity 1e-7 (0.0000001) on POST invoices and POST quotes returns 400 (never 500) with zero DB writes', async () => {
    const before = await countBizA();

    const invRes = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/invoices`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Sci notation inv', quantity: 1e-7, unitPrice: 100 }],
        }),
    );
    expect(invRes.status).toBe(400);
    expect(invRes.body.code).toBe('BAD_REQUEST');

    const qtRes = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/quotes`)
        .send({
          contactId: ID.contactA,
          items: [{ description: 'Sci notation quote', quantity: 1e-7, unitPrice: 100 }],
        }),
    );
    expect(qtRes.status).toBe(400);
    expect(qtRes.body.code).toBe('BAD_REQUEST');

    expect(await countBizA()).toEqual(before);
  });

  it('R1-SEC-02: recurring schedule create & update with metadata.items subtotal exceeding MAX_DOCUMENT_AMOUNT returns 400 with zero DB writes', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const overflowItems = [{ description: 'Ledger overflow', quantity: 1_000_000, unitPrice: 999_999_999_999 }];

    const beforeCreate = await countBizA();
    const badCreate = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/recurring-invoices`)
        .send({
          contactId: ID.contactA,
          name: 'Overflow recurring',
          frequency: 'MONTHLY',
          amount: 100,
          startDate: pastDate,
          nextRunDate: pastDate,
          metadata: { items: overflowItems },
        }),
    );
    expect(badCreate.status).toBe(400);
    expect(await countBizA()).toEqual(beforeCreate);

    const okCreate = await asA(
      agent()
        .post(`/commerce/businesses/${ID.bizA}/recurring-invoices`)
        .send({
          contactId: ID.contactA,
          name: 'Valid recurring for overflow update check',
          frequency: 'MONTHLY',
          amount: 100,
          startDate: pastDate,
          nextRunDate: pastDate,
          metadata: { items: [{ description: 'Normal', quantity: 1, unitPrice: 100 }] },
        }),
    );
    expect(okCreate.status).toBe(201);
    const scheduleId = okCreate.body.id as string;

    const badUpdate = await asA(
      agent()
        .patch(`/commerce/businesses/${ID.bizA}/recurring-invoices/${scheduleId}`)
        .send({ metadata: { items: overflowItems } }),
    );
    expect(badUpdate.status).toBe(400);

    await db.recurringInvoice.update({ where: { id: scheduleId }, data: { status: 'CANCELLED' } });
  });
});
