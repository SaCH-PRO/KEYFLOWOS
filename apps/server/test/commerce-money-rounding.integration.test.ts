/**
 * V1-22-DM-MONEY-CENTS — cents-safe money arithmetic at the write and balance
 * boundaries (REAL database, REAL ledger posting, REAL invoice workflow).
 *
 * M23 / CF-54; owner ruling D-13: integer-cents arithmetic at every write and
 * balance boundary on the EXISTING Float columns (no migration; the Decimal
 * migration DM-005 is staged later).
 *
 * At the base (claude/elegant-curie-7azpsb f5c93ba0) CommerceService computed
 * document amounts as raw floats (createInvoice, updateInvoice, createQuote,
 * updateQuote, convertQuoteToInvoice): items 0.1 and 0.2 at 12.5% tax stored
 * subtotal 0.30000000000000004 and total 0.3375, and issuing that invoice
 * posted 0.3375 to accounts receivable, so the 0.34 the customer paid left
 * AR at -0.0025. The payment responses and the payment list summed the rows as
 * floats: after 33.33 x 3 on 100.00 the response said remaining
 * 0.010000000000005116, and after the closing 0.01 the list said paid
 * 99.99999999999999, remaining 1.4e-14.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the base):
 *
 *   W1 RED-BEFORE POST invoice, items 0.1 + 0.2 at 12.5% -> subtotal 0.30, tax 0.04, total 0.34; reload == response
 *   W2 RED-BEFORE PATCH invoice items 7 x 0.145 at 10%   -> line 1.02, subtotal 1.02, tax 0.10, total 1.12; reload == response
 *   W3 RED-BEFORE PATCH invoice tax/discount only         -> recomputed in cents from the stored subtotal
 *   W4 RED-BEFORE POST / PATCH quote                      -> cents, reload == response
 *   W5 RED-BEFORE convert an ACCEPTED quote with legacy unrounded line totals -> a cents invoice
 *   W6 property: 12 seeded random item lists through POST -> subtotal + tax - discount == total in cents; reload == response
 *   B1 RED-BEFORE 33.33 x 3 then 0.01 on 100.00          -> remaining 0.01 then PAID, remaining 0, not overpaid;
 *                                                          list, detail and workflow balance agree to the cent
 *   L1 RED-BEFORE LEDGER (ACCRUAL): posted Decimal amounts equal the rounded document amounts; AR per invoice nets to
 *                 zero after full payment; debits == credits per invoice
 *   L2 LEDGER control: the B1 invoice's AR nets to zero after 33.33 x 3 + 0.01
 *   E1 existing rows (legacy unrounded Floats) keep their statuses on reconcile, including (V1-22 review
 *      CR-V22-1) rows whose two cent readings differ: 8.36 + 12.5% stored 9.405 and paid 9.40 by the base
 *      mark-paid stays PAID with nothing due (HEAD be6195d6 read 0.01 due and reconciled it to PARTIALLY_PAID);
 *      8.44 + 12.5% stored 9.495 and paid 9.50 (its decimal reading) is PAID and not overpaid; 0.3375 paid
 *      0.33 stays PARTIALLY_PAID (the band is the two readings, not the floor cent). Prisma stores a float
 *      written through a model with 15 significant digits (0.40499999999999997 is stored and read back as
 *      0.405), so on a stored row the decimal reading is the higher one
 *   E2 RED-BEFORE (HEAD) a legacy 9.405 invoice with 9.00 paid: recording 0.40 (the base's remaining) through
 *      the route settles it: PAID, response / list / detail / payment-link remaining 0, audit overPaid 0
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed), CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v22-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. EventEmitter2, the contact timeline
 * (CrmService), TimelineService, the stats cache and the AI / Gmail / Drive
 * services are stubs off the boundary; ExpensePostingService (COGS) is a
 * no-op stub (no product lines here).
 *
 * Fixtures: prefix `v22a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping. Rows the server creates get server ids under the
 * prefixed business and are deleted through it.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v22a_';
const HEADER = 'x-v22-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  quoteAccepted: `${P}quoteAccepted`,
  legPaid0375: `${P}legPaid0375`,
  legPartial: `${P}legPartial`,
  legPaidThree: `${P}legPaidThree`,
  legSent: `${P}legSent`,
  legPaidTenths: `${P}legPaidTenths`,
  legPaidHalfDown: `${P}legPaidHalfDown`,
  legPaidHalfTop: `${P}legPaidHalfTop`,
  legPartialBand: `${P}legPartialBand`,
  legPartialDiv: `${P}legPartialDiv`,
};

let db: any;
let app: any;
let redis: any;
let workflow: InvoiceWorkflowService;
let commerce: any;

const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};
const contactEvents: any[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
function as(req: request.Test) {
  return req.set(HEADER, ID.owner);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Invoice numbers default to INV-<ms>, unique per tenant (M22, V1-43): space the creates. */
async function createInvoice(body: Record<string, unknown>) {
  await sleep(3);
  return as(agent().post(`/commerce/businesses/${ID.biz}/invoices`)).send({ contactId: ID.contact, ...body });
}
function issue(invoiceId: string) {
  return as(agent().patch(`/commerce/invoices/${invoiceId}/status/sent`)).send({ businessId: ID.biz, status: 'SENT' });
}
function pay(invoiceId: string, amount: number) {
  return as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${invoiceId}/payments`)).send({ amount, method: 'cash' });
}
function listPayments(invoiceId: string) {
  return as(agent().get(`/commerce/businesses/${ID.biz}/invoices/${invoiceId}/payments`));
}
function detail(invoiceId: string) {
  return as(agent().get(`/commerce/businesses/${ID.biz}/invoices/${invoiceId}`));
}

const AMOUNT_FIELDS = ['subtotal', 'taxRate', 'taxAmount', 'discountType', 'discountValue', 'discountAmount', 'total'] as const;
const cents = (v: number) => Math.round(v * 100);

/** The stored row (fresh read) carries exactly what the response said, field for field and line for line. */
async function expectReloadEqualsResponse(kind: 'invoice' | 'quote', body: any) {
  const row = kind === 'invoice'
    ? await db.invoice.findUnique({ where: { id: body.id }, include: { items: { orderBy: { id: 'asc' } } } })
    : await db.quote.findUnique({ where: { id: body.id }, include: { items: { orderBy: { id: 'asc' } } } });
  expect(row, `${kind} ${body.id} reload`).not.toBeNull();
  for (const f of AMOUNT_FIELDS) {
    expect(row[f], `${kind}.${f}: reload equals response`).toBe(body[f]);
  }
  const respItems = [...body.items].sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
  expect(row.items.map((i: any) => [i.id, i.quantity, i.unitPrice, i.total])).toEqual(
    respItems.map((i: any) => [i.id, i.quantity, i.unitPrice, i.total]),
  );
  return row;
}

/** Every figure is an exact cent value and subtotal + tax - discount == total in cents. */
function expectCentsIdentity(doc: any) {
  for (const v of [doc.subtotal, doc.taxAmount, doc.discountAmount, doc.total, ...doc.items.map((i: any) => i.total)]) {
    expect(cents(v) / 100, `${v} is a cent value`).toBe(v);
  }
  expect(cents(doc.subtotal) + cents(doc.taxAmount) - cents(doc.discountAmount)).toBe(cents(doc.total));
  expect(doc.items.reduce((s: number, i: any) => s + cents(i.total), 0)).toBe(cents(doc.subtotal));
}

/** All postings of an invoice: its own (Invoice source) and its payments' (Payment source), with entries and accounts. */
async function postingsOf(invoiceId: string) {
  const payments = await db.payment.findMany({ where: { invoiceId }, select: { id: true } });
  return db.financialTransaction.findMany({
    where: {
      businessId: ID.biz,
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        { sourceType: 'Payment', sourceId: { in: payments.map((p: any) => p.id) } },
      ],
    },
    include: { entries: { include: { account: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** The invoice's trial balance from its postings: per-account debit - credit, and total debits/credits, as Decimal strings. */
async function trialBalance(invoiceId: string) {
  const { Prisma } = await import('@prisma/client');
  const D = Prisma.Decimal;
  const txs = await postingsOf(invoiceId);
  let debit = new D(0);
  let credit = new D(0);
  const byKey = new Map<string, InstanceType<typeof D>>();
  for (const t of txs) {
    for (const e of t.entries) {
      debit = debit.plus(e.debit);
      credit = credit.plus(e.credit);
      const key = e.account.systemKey ?? e.account.id;
      byKey.set(key, (byKey.get(key) ?? new D(0)).plus(e.debit).minus(e.credit));
    }
  }
  return { txs, debit: debit.toString(), credit: credit.toString(), ar: (byKey.get('ACCOUNTS_RECEIVABLE') ?? new D(0)).toString() };
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
      { provide: CrmService, useValue: { logContactEvent: async (e: any) => { contactEvents.push(e); return null; } } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  workflow = moduleRef.get(InvoiceWorkflowService);
  commerce = moduleRef.get(CommerceService);

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
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  // ACCRUAL, so issuing an invoice posts accounts receivable (the ledger proof).
  await db.business.create({
    data: { id: ID.biz, name: 'V22A Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V22', lastName: 'Customer', email: `${P}c@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  // An ACCEPTED quote written before this packet: its line totals are the raw float products.
  await db.quote.create({
    data: {
      id: ID.quoteAccepted,
      quoteNumber: `${P}QT-1`,
      status: 'ACCEPTED',
      subtotal: 0.1 * 3 + 0.2,
      total: 0.1 * 3 + 0.2,
      currency: 'TTD',
      businessId: ID.biz,
      contactId: ID.contact,
      items: {
        create: [
          { id: `${ID.quoteAccepted}_i1`, description: 'V22 tenth x3', quantity: 3, unitPrice: 0.1, total: 0.1 * 3 },
          { id: `${ID.quoteAccepted}_i2`, description: 'V22 fifth', quantity: 1, unitPrice: 0.2, total: 0.2 },
        ],
      },
    },
  });

  // Existing rows written before this packet, with the unrounded Floats the old arithmetic stored.
  const legacy: Array<{ id: string; status: string; subtotal: number; taxRate?: number; taxAmount: number; total: number; payments: number[] }> = [
    { id: ID.legPaid0375, status: 'PAID', subtotal: 0.1 + 0.2, taxAmount: ((0.1 + 0.2) * 12.5) / 100, total: 0.1 + 0.2 + ((0.1 + 0.2) * 12.5) / 100, payments: [0.34] },
    { id: ID.legPartial, status: 'PARTIALLY_PAID', subtotal: 100, taxAmount: 0, total: 100, payments: [33.33, 33.33, 33.33] },
    { id: ID.legPaidThree, status: 'PAID', subtotal: 0.1 * 3, taxAmount: 0, total: 0.1 * 3, payments: [0.3] },
    { id: ID.legSent, status: 'SENT', subtotal: 10.05, taxAmount: (10.05 * 10) / 100, total: 10.05 + (10.05 * 10) / 100, payments: [] },
    { id: ID.legPaidTenths, status: 'PAID', subtotal: 1, taxAmount: 0, total: 1, payments: Array.from({ length: 10 }, () => 0.1) },
    // V1-22 review (CR-V22-1): rows where the base's Math.round(total * 100) and the decimal reading differ by a cent.
    // 9.405: the base read 9.40 and its mark-paid recorded 9.40 (decimal reading 9.41).
    { id: ID.legPaidHalfDown, status: 'PAID', subtotal: 8.36, taxRate: 12.5, taxAmount: (8.36 * 12.5) / 100, total: 8.36 + (8.36 * 12.5) / 100, payments: [9.4] },
    // 9.495: the base read 9.49 (and flagged 9.50 paid as overpaid); its decimal reading 9.50 settles it, not overpaid.
    { id: ID.legPaidHalfTop, status: 'PAID', subtotal: 8.44, taxRate: 12.5, taxAmount: (8.44 * 12.5) / 100, total: 8.44 + (8.44 * 12.5) / 100, payments: [9.5] },
    // 0.3375 reads 0.34 both ways: 0.33 left 0.01 due at the base and still does.
    { id: ID.legPartialBand, status: 'PARTIALLY_PAID', subtotal: 0.1 + 0.2, taxRate: 12.5, taxAmount: ((0.1 + 0.2) * 12.5) / 100, total: 0.1 + 0.2 + ((0.1 + 0.2) * 12.5) / 100, payments: [0.33] },
    { id: ID.legPartialDiv, status: 'PARTIALLY_PAID', subtotal: 8.36, taxRate: 12.5, taxAmount: (8.36 * 12.5) / 100, total: 8.36 + (8.36 * 12.5) / 100, payments: [9] },
  ];
  let n = 0;
  for (const l of legacy) {
    n += 1;
    await db.invoice.create({
      data: {
        id: l.id,
        invoiceNumber: `${P}LEG-${n}`,
        status: l.status,
        subtotal: l.subtotal,
        ...(l.taxRate != null ? { taxRate: l.taxRate } : {}),
        taxAmount: l.taxAmount,
        total: l.total,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        paidAt: l.status === 'PAID' ? new Date() : null,
        items: { create: [{ id: `${l.id}_i1`, description: `V22 legacy ${n}`, quantity: 1, unitPrice: l.subtotal, total: l.subtotal }] },
      },
    });
    let k = 0;
    for (const amount of l.payments) {
      k += 1;
      await db.payment.create({
        data: {
          id: `${l.id}_p${k}`,
          amount,
          currency: 'TTD',
          status: 'SUCCESSFUL',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `${P}pp_${l.id}_${k}`,
          businessId: ID.biz,
          invoiceId: l.id,
        },
      });
    }
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  emitted.length = 0;
  contactEvents.length = 0;
});

describe('V1-22 document amounts at the write boundary (real rows)', () => {
  it('W1 RED-BEFORE: POST invoice, items 0.1 and 0.2 at 12.5% tax: stored subtotal 0.30 and total 0.34; a reload equals the response', async () => {
    const res = await createInvoice({
      items: [
        { description: 'V22 tenth', quantity: 1, unitPrice: 0.1 },
        { description: 'V22 fifth', quantity: 1, unitPrice: 0.2 },
      ],
      taxRate: 12.5,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ subtotal: 0.3, taxRate: 12.5, taxAmount: 0.04, discountAmount: 0, total: 0.34 });
    expect(res.body.items.map((i: any) => i.total).sort()).toEqual([0.1, 0.2]);
    const row = await expectReloadEqualsResponse('invoice', res.body);
    expect(row.subtotal).toBe(0.3);
    expect(row.total).toBe(0.34);
    expectCentsIdentity(row);
  });

  it('W2 RED-BEFORE: PATCH invoice items 7 x 0.145 at 10% tax: line 1.02, subtotal 1.02, tax 0.10, total 1.12; reload equals response', async () => {
    const created = await createInvoice({ items: [{ description: 'V22 start', quantity: 1, unitPrice: 5 }] });
    expect(created.status).toBe(201);
    const res = await as(agent().patch(`/commerce/businesses/${ID.biz}/invoices/${created.body.id}`)).send({
      items: [{ description: 'V22 seven', quantity: 7, unitPrice: 0.145 }],
      taxRate: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ subtotal: 1.02, taxAmount: 0.1, discountAmount: 0, total: 1.12 });
    expect(res.body.items.map((i: any) => i.total)).toEqual([1.02]);
    expectCentsIdentity(await expectReloadEqualsResponse('invoice', res.body));
  });

  it('W3 RED-BEFORE: PATCH invoice tax and discount only: recomputed in cents from the stored subtotal', async () => {
    const created = await createInvoice({
      items: [
        { description: 'V22 tenth', quantity: 1, unitPrice: 0.1 },
        { description: 'V22 fifth', quantity: 1, unitPrice: 0.2 },
      ],
    });
    expect(created.status).toBe(201);
    const res = await as(agent().patch(`/commerce/businesses/${ID.biz}/invoices/${created.body.id}`)).send({
      taxRate: 12.5,
      discountType: 'PERCENT',
      discountValue: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // tax 0.0375 -> 0.04, discount 0.03, total 0.30 + 0.04 - 0.03
    expect(res.body).toMatchObject({ subtotal: 0.3, taxAmount: 0.04, discountAmount: 0.03, total: 0.31 });
    expectCentsIdentity(await expectReloadEqualsResponse('invoice', res.body));
  });

  it('W4 RED-BEFORE: POST and PATCH quote store cents; a reload equals the response', async () => {
    const created = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes`)).send({
      contactId: ID.contact,
      items: [
        { description: 'V22 tenth', quantity: 1, unitPrice: 0.1 },
        { description: 'V22 fifth', quantity: 1, unitPrice: 0.2 },
      ],
      taxRate: 12.5,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ subtotal: 0.3, taxAmount: 0.04, discountAmount: 0, total: 0.34 });
    expectCentsIdentity(await expectReloadEqualsResponse('quote', created.body));

    const updated = await as(agent().patch(`/commerce/businesses/${ID.biz}/quotes/${created.body.id}`)).send({
      items: [{ description: 'V22 seven', quantity: 7, unitPrice: 0.145 }],
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    // line 1.015 -> 1.02; tax 12.5% of 1.02 = 0.1275 -> 0.13; total 1.15
    expect(updated.body).toMatchObject({ subtotal: 1.02, taxAmount: 0.13, discountAmount: 0, total: 1.15 });
    expectCentsIdentity(await expectReloadEqualsResponse('quote', updated.body));
  });

  it('W5 RED-BEFORE: converting an ACCEPTED quote with legacy unrounded line totals stores a cents invoice', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes/${ID.quoteAccepted}/convert`)).send({ taxRate: 12.5 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // lines 0.30000000000000004 -> 0.30 and 0.20; subtotal 0.50; tax 0.0625 -> 0.06; total 0.56
    expect(res.body).toMatchObject({ subtotal: 0.5, taxAmount: 0.06, discountAmount: 0, total: 0.56 });
    expect(res.body.items.map((i: any) => i.total).sort()).toEqual([0.2, 0.3]);
    expectCentsIdentity(await expectReloadEqualsResponse('invoice', res.body));
  });

  it('W6 property: seeded random item lists through POST: subtotal + tax - discount == total exactly in cents; reload equals response', async () => {
    let seed = 0x22_0022;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let run = 0; run < 12; run++) {
      const items = Array.from({ length: int(1, 5) }, (_, k) => ({
        description: `V22 prop ${run}.${k}`,
        quantity: int(1, 9),
        unitPrice: int(0, 999_999) / 1000,
      }));
      const taxRate = [0, 12.5, 7, 8.25, int(0, 100_000) / 1000][int(0, 4)];
      const subtotalCents = items.reduce((s, i) => s + Math.floor((2 * i.quantity * Math.round(i.unitPrice * 1000) + 10) / 20), 0);
      const discount = int(0, 2) === 0
        ? {}
        : int(0, 1) === 0
          ? { discountType: 'PERCENT', discountValue: int(0, 10_000) / 100 }
          : { discountType: 'FIXED', discountValue: int(0, subtotalCents) / 100 };
      const res = await createInvoice({ items, taxRate, ...discount });
      const ctx = JSON.stringify({ run, items, taxRate, discount, body: res.body });
      expect(res.status, ctx).toBe(201);
      expect(cents(res.body.subtotal), ctx).toBe(subtotalCents);
      const row = await expectReloadEqualsResponse('invoice', res.body);
      expectCentsIdentity(row);
    }
  });
});

describe('V1-22 balance boundary: 33.33 x 3 then 0.01 on 100.00 (real rows)', () => {
  let invoiceId: string;

  it('B1 RED-BEFORE: remaining is exactly 0.01 after three payments of 33.33, then PAID, remaining 0, not overpaid; list, detail and balance agree', async () => {
    const created = await createInvoice({ items: [{ description: 'V22 hundred', quantity: 1, unitPrice: 100 }] });
    expect(created.status).toBe(201);
    invoiceId = created.body.id;
    expect((await issue(invoiceId)).status).toBe(200);

    for (let k = 1; k <= 3; k++) {
      const r = await pay(invoiceId, 33.33);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.paidAmount).toBe([33.33, 66.66, 99.99][k - 1]);
      expect(r.body.remaining).toBe([66.67, 33.34, 0.01][k - 1]);
      expect(r.body.invoice.status).toBe('PARTIALLY_PAID');
    }
    const mid = await listPayments(invoiceId);
    expect(mid.status).toBe(200);
    expect(mid.body).toMatchObject({ paidAmount: 99.99, remaining: 0.01, invoiceTotal: 100 });

    const last = await pay(invoiceId, 0.01);
    expect(last.status, JSON.stringify(last.body)).toBe(201);
    expect(last.body).toMatchObject({ paidAmount: 100, remaining: 0 });
    expect(last.body.invoice.status).toBe('PAID');
    const audit = contactEvents.filter((e) => e.type === 'invoice.payment_recorded' && e.data?.invoiceId === invoiceId);
    expect(audit.at(-1)?.data).toMatchObject({ totalPaid: 100, newStatus: 'PAID', overPaid: 0 });
    expect(emitted.filter((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === invoiceId)).toHaveLength(1);

    const list = await listPayments(invoiceId);
    expect(list.body).toMatchObject({ paidAmount: 100, remaining: 0, invoiceTotal: 100 });
    const det = await detail(invoiceId);
    expect(det.status).toBe(200);
    expect(det.body).toMatchObject({ status: 'PAID', paidAmount: 100, remaining: 0 });
    expect(await workflow.getBalance(invoiceId)).toEqual({
      total: 100, paid: 100, refunded: 0, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false,
    });
    const reconciled = await workflow.reconcileFromPayments(invoiceId);
    expect(reconciled).toMatchObject({ status: 'PAID', changed: false });
  });

  it('L2 LEDGER control: the invoice posted AR 100.00 and the four payments cleared it to zero; debits == credits', async () => {
    expect(invoiceId).toBeTruthy();
    const tb = await trialBalance(invoiceId);
    expect(tb.txs).toHaveLength(5);
    expect(tb.ar).toBe('0');
    expect(tb.debit).toBe(tb.credit);
    expect(tb.debit).toBe('200');
  });
});

describe('V1-22 LEDGER (ACCRUAL): posted amounts equal the rounded document amounts', () => {
  it('L1 RED-BEFORE: 0.1 + 0.2 at 12.5% posts AR 0.34 on issue; paying 0.34 settles it; AR per invoice nets to zero', async () => {
    const created = await createInvoice({
      items: [
        { description: 'V22 tenth', quantity: 1, unitPrice: 0.1 },
        { description: 'V22 fifth', quantity: 1, unitPrice: 0.2 },
      ],
      taxRate: 12.5,
    });
    expect(created.status).toBe(201);
    const invoiceId = created.body.id;
    const issued = await issue(invoiceId);
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    const [finalized] = await postingsOf(invoiceId);
    expect(finalized.sourceType).toBe('Invoice');
    expect(finalized.amount.toString()).toBe('0.34');
    const ar = finalized.entries.filter((e: any) => e.account.systemKey === 'ACCOUNTS_RECEIVABLE');
    expect(ar.map((e: any) => [e.debit.toString(), e.credit.toString()])).toEqual([['0.34', '0']]);
    const revenueCredit = finalized.entries.reduce((s: number, e: any) => s + cents(Number(e.credit)), 0);
    expect(revenueCredit).toBe(34);

    const paid = await pay(invoiceId, 0.34);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body).toMatchObject({ paidAmount: 0.34, remaining: 0 });
    expect(paid.body.invoice.status).toBe('PAID');

    const tb = await trialBalance(invoiceId);
    expect(tb.txs).toHaveLength(2);
    const payment = tb.txs.find((t: any) => t.sourceType === 'Payment');
    expect(payment.amount.toString()).toBe('0.34');
    expect(tb.ar, 'AR for the invoice nets to zero after full payment').toBe('0');
    expect(tb.debit).toBe(tb.credit);
    expect(tb.debit).toBe('0.68');
  });
});

describe('V1-22 existing rows keep their statuses', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    [ID.legPaid0375, 'PAID', { total: 0.34, paid: 0.34, remaining: 0, isFullyPaid: true, isOverpaid: false }],
    [ID.legPartial, 'PARTIALLY_PAID', { total: 100, paid: 99.99, remaining: 0.01, isFullyPaid: false, isOverpaid: false }],
    [ID.legPaidThree, 'PAID', { total: 0.3, paid: 0.3, remaining: 0, isFullyPaid: true, isOverpaid: false }],
    [ID.legSent, 'SENT', { total: 11.06, paid: 0, remaining: 11.06, isFullyPaid: false, isOverpaid: false }],
    [ID.legPaidTenths, 'PAID', { total: 1, paid: 1, remaining: 0, isFullyPaid: true, isOverpaid: false }],
    // CR-V22-1 RED-BEFORE (HEAD be6195d6: remaining 0.01, isFullyPaid false, reconciled to PARTIALLY_PAID)
    [ID.legPaidHalfDown, 'PAID', { total: 9.41, paid: 9.4, remaining: 0, isFullyPaid: true, isOverpaid: false }],
    // control: the top of the band is not an overpayment
    [ID.legPaidHalfTop, 'PAID', { total: 9.5, paid: 9.5, remaining: 0, isFullyPaid: true, isOverpaid: false }],
    [ID.legPartialBand, 'PARTIALLY_PAID', { total: 0.34, paid: 0.33, remaining: 0.01, isFullyPaid: false, isOverpaid: false }],
  ];
  for (const [id, status, balance] of cases) {
    it(`E1 ${id.slice(P.length)} (${status}): a reconcile keeps ${status} and writes nothing`, async () => {
      const before = await db.invoice.findUnique({ where: { id } });
      const r = await workflow.reconcileFromPayments(id);
      expect(r).toMatchObject({ status, changed: false, balance });
      const after = await db.invoice.findUnique({ where: { id } });
      expect(after.status).toBe(status);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.total).toBe(before.total);
    });
  }
});

describe('V1-22 review CR-V22-1: a legacy total the base settled shows nothing due on every surface (real rows)', () => {
  it('E1b RED-BEFORE (HEAD be6195d6): the PAID 9.405 row paid 9.40: operator detail, payment list and payment-link balance say 0 due', async () => {
    const id = ID.legPaidHalfDown;
    expect((await db.invoice.findUnique({ where: { id } })).total).toBe(9.405);
    const det = await detail(id);
    expect(det.status, JSON.stringify(det.body)).toBe(200);
    expect(det.body).toMatchObject({ status: 'PAID', paidAmount: 9.4, remaining: 0 });
    const list = await listPayments(id);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ paidAmount: 9.4, remaining: 0 });
    expect(await commerce.getPaymentLinkBalance(id, ID.biz)).toMatchObject({ amountPaid: 9.4, amountDue: 0 });
  });

  it('E2 RED-BEFORE (HEAD be6195d6): a legacy 9.405 invoice with 9.00 paid is settled by 0.40, the base remaining: PAID, 0 due everywhere, not overpaid', async () => {
    const id = ID.legPartialDiv;
    const before = await workflow.getBalance(id);
    expect(before).toMatchObject({ total: 9.41, paid: 9, remaining: 0.41, isFullyPaid: false });

    const r = await pay(id, 0.4);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ paidAmount: 9.4, remaining: 0 });
    expect(r.body.invoice.status).toBe('PAID');
    const audit = contactEvents.filter((e) => e.type === 'invoice.payment_recorded' && e.data?.invoiceId === id);
    expect(audit.at(-1)?.data).toMatchObject({ amount: 0.4, totalPaid: 9.4, newStatus: 'PAID', overPaid: 0 });
    expect(emitted.filter((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === id)).toHaveLength(1);

    expect((await listPayments(id)).body).toMatchObject({ paidAmount: 9.4, remaining: 0 });
    expect((await detail(id)).body).toMatchObject({ status: 'PAID', paidAmount: 9.4, remaining: 0 });
    expect(await commerce.getPaymentLinkBalance(id, ID.biz)).toMatchObject({ amountPaid: 9.4, amountDue: 0 });
    expect(await workflow.getBalance(id)).toEqual({
      total: 9.41, paid: 9.4, refunded: 0, net: 9.4, remaining: 0, isFullyPaid: true, isOverpaid: false,
    });
    expect(await workflow.reconcileFromPayments(id)).toMatchObject({ status: 'PAID', changed: false });
  });
});
