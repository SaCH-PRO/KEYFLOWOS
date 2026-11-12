/**
 * FOLLOW3-B5-EMAIL-LINE-TOTALS (V1-82; VL-09; owner ruling D-13: cents at every
 * boundary) — the invoice, reminder, receipt and quote emails print the stored
 * line totals and cent-rounded figures (REAL database, REAL ledger chain).
 *
 * V1-22 stores every line as lineAmount(quantity, unitPrice): the exact decimal
 * product rounded half away from zero to cents (7 x 0.145 = 1.02, 3 x 1.115 =
 * 3.35, subtotal 4.37). The customer emails did not print it. The invoice
 * template printed fmt(it.unitPrice) and fmt(it.unitPrice * it.quantity), fmt
 * being toFixed(2) on the binary float, and InvoiceEmailData.items carried no
 * total; every builder (CommerceController.buildInvoiceEmailContext, used by
 * send-email, send-reminder and resend-receipt, and InvoiceReceiptListener on
 * invoice.paid) passed only quantity and unitPrice. The quote template printed
 * formatCurrency(item.quantity * item.unitPrice) the same way. So the customer
 * read L7 TT$0.14 / TT$1.01 and L3 TT$1.11 / TT$3.34 (lines summing to 4.35)
 * above a Subtotal of TT$4.37.
 *
 * Contract pinned here:
 *   EM-01  POST .../invoices (L7 7 x 0.145, L3 3 x 1.115), then POST .../send-email: the rows print
 *          L7 unit TT$0.15, line TT$1.02 and L3 unit TT$1.12, line TT$3.35; the printed lines sum
 *          to the printed Subtotal TT$4.37 = Total = the intro amount
 *   EM-02  POST .../send-reminder {channel:'email'}: the same rows; lines = Subtotal = Total =
 *          Balance due TT$4.37
 *   EM-03  a payment of 4.37 (POST .../payments) emits invoice.paid; the real InvoiceReceiptListener's
 *          receipt prints the same rows; lines = Subtotal = Total = Paid TT$4.37
 *   EM-04  a single line 7 x 0.145: line = Subtotal = Total = TT$1.02
 *   EM-05  a quote with the same two lines, POST .../quotes/:id/send-email: TT$1.02 and TT$3.35,
 *          the stored quote item totals
 *   EM-06  control: whole-cent lines 2 x 10.10 and 3 x 0.33 print TT$20.20 and TT$0.99 (unchanged)
 *   EM-07  legacy: an item whose stored total is the float 1.015 (the pre-V1-22 float product of
 *          7 x 0.145), written by SQL, prints TT$1.02 (half away from zero on its decimal value)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed: the plan allows
 * invoices), CommerceController, CommerceService, InvoiceWorkflowService,
 * InvoiceReceiptBuilderService, RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService and InvoiceReceiptListener read and write real
 * rows behind the production GlobalHttpExceptionFilter, ValidationPipe and
 * TenantInterceptor. Identity attachment is the one stand-in: a test middleware
 * reads `x-v82e-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * The Gmail service records every email it is handed (htmlBody included) and
 * sends nothing. The event bus is a recording stub: the invoice.paid payload
 * the payment emits is handed to the real InvoiceReceiptListener (EM-03). The
 * contact timeline, TimelineService, stats cache and the AI / Drive services
 * are stubs off the boundary; ExpensePostingService (COGS on PAID) is a no-op
 * stub (no invoice with product lines is paid here).
 *
 * Fixtures: prefix `v82e_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping. Rows the server creates get
 * server ids under the prefixed business and are deleted through it.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v82e_';
const HEADER = 'x-v82e-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz_ttd`,
  contact: `${P}contact`,
};
const CONTACT_EMAIL = `${P}customer@test.local`;

let db: any;
let app: any;
let redis: any;
let receiptListener: any; // the real InvoiceReceiptListener

/** The Gmail boundary: every email is recorded; nothing is sent. */
const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
const gmailStub = {
  sendEmail: async (args: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    sentEmails.push(args);
    return { messageId: `${P}msg_${sentEmails.length}` };
  },
};

/** The event bus: records every emit with its payload (EM-03 hands invoice.paid to the real listener). */
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

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
/** A printed amount ('TT$4.37') in integer cents. */
const printedCents = (s: string | null | undefined) => Math.round(Number(String(s ?? '').replace(/^-?TT\$/, '').replace(/,/g, '')) * 100);

type Line = { description: string; quantity: number; unitPrice: number };
const L7: Line = { description: 'V82E L7', quantity: 7, unitPrice: 0.145 };
const L3: Line = { description: 'V82E L3', quantity: 3, unitPrice: 1.115 };

/** POST a DRAFT invoice. Invoice numbers default to INV-<ms>, unique per tenant (V1-43): space the creates. */
async function createInvoice(items: Line[]) {
  await sleep(3);
  const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices`)).send({ contactId: ID.contact, items, currency: 'TTD' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.status).toBe('DRAFT');
  return res.body as { id: string; subtotal: number; total: number; invoiceNumber: string };
}

/** POST .../send-email (DRAFT -> SENT); the one email it hands Gmail. */
async function sendInvoiceEmail(invoiceId: string): Promise<string> {
  sentEmails.length = 0;
  const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${invoiceId}/send-email`)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(sentEmails, 'one invoice email').toHaveLength(1);
  expect(sentEmails[0].to).toBe(CONTACT_EMAIL);
  return sentEmails[0].htmlBody;
}

/** The stored line totals of a document, in input order. */
async function storedLineTotals(table: 'invoice_items' | 'quote_items', fk: 'invoice_id' | 'quote_id', id: string) {
  const rows: Array<{ description: string; total: number }> = await db.$queryRawUnsafe(
    `SELECT description, total FROM ${table} WHERE ${fk} = $1 ORDER BY description DESC`,
    id,
  );
  return Object.fromEntries(rows.map((r) => [r.description, Number(r.total)]));
}

/** The item rows of an email's line table: description, quantity, unit price and line total as printed. */
function printedRows(html: string): Array<{ description: string; quantity: string; unit: string; line: string }> {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].trim());
    return { description: cells[0], quantity: cells[1], unit: cells[2], line: cells[3] };
  });
}

/** A footer figure ('Subtotal', 'Total', 'Paid', 'Balance due') as printed, or null when the row is absent. */
function printedFooter(html: string, label: string): string | null {
  const m = html.match(new RegExp(`>\\s*${label}\\s*</td>\\s*<td[^>]*>\\s*(-?TT\\$[\\d.,]+)\\s*<`));
  return m ? m[1] : null;
}

/** The two-line document (L7 + L3) as the customer must read it: stored lines, and lines summing to the subtotal. */
function expectTwoLineDocument(html: string) {
  const rows = printedRows(html);
  expect.soft(rows.map((r) => [r.description, r.quantity, r.unit, r.line])).toEqual([
    ['V82E L7', '7', 'TT$0.15', 'TT$1.02'],
    ['V82E L3', '3', 'TT$1.12', 'TT$3.35'],
  ]);
  const subtotal = printedFooter(html, 'Subtotal');
  expect.soft(subtotal).toBe('TT$4.37');
  expect.soft(
    rows.reduce((s, r) => s + printedCents(r.line), 0),
    `the printed lines (${rows.map((r) => r.line).join(' + ')}) sum to the printed Subtotal ${subtotal}`,
  ).toBe(printedCents(subtotal));
  expect.soft(printedFooter(html, 'Total')).toBe('TT$4.37');
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
  const { InvoiceReceiptListener } = await import('../src/modules/commerce/invoice-receipt.listener');
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
      // The invoice.paid receipt under test, over the real CommerceService.
      InvoiceReceiptListener,
      // Real ledger chain: issuing and paying post real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      // The plan answer: invoices are within the plan.
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      // The Gmail boundary: records htmlBody, sends nothing.
      { provide: GmailService, useValue: gmailStub },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  receiptListener = moduleRef.get(InvoiceReceiptListener);

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

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V82E TTD', slug: `${P}ttd`, ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V82E', lastName: 'Customer', email: CONTACT_EMAIL } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  sentEmails.length = 0;
  emitted.length = 0;
});

describe('invoice emails print the stored line totals (FOLLOW3-B5, VL-09, D-13)', () => {
  it('EM-01: POST .../send-email for L7 7 x 0.145 + L3 3 x 1.115 prints L7 TT$0.15 / TT$1.02 and L3 TT$1.12 / TT$3.35; the lines sum to the Subtotal TT$4.37 = Total', async () => {
    const inv = await createInvoice([L7, L3]);
    expect(await storedLineTotals('invoice_items', 'invoice_id', inv.id), 'V1-22 stored lines').toEqual({ 'V82E L7': 1.02, 'V82E L3': 3.35 });
    expect(inv.subtotal).toBe(4.37);
    expect(inv.total).toBe(4.37);

    const html = await sendInvoiceEmail(inv.id);
    expectTwoLineDocument(html);
    expect.soft(html).toContain(`for TT$4.37 below`);
  });

  it("EM-02: POST .../send-reminder {channel:'email'} prints the same stored rows; lines = Subtotal = Total = Balance due TT$4.37", async () => {
    const inv = await createInvoice([L7, L3]);
    await sendInvoiceEmail(inv.id);

    sentEmails.length = 0;
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv.id}/send-reminder`)).send({ channel: 'email' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(sentEmails, 'one reminder email').toHaveLength(1);
    const html = sentEmails[0].htmlBody;
    expectTwoLineDocument(html);
    expect.soft(printedFooter(html, 'Balance due')).toBe('TT$4.37');
    expect.soft(html).toContain('for TT$4.37 is awaiting payment');
  });

  it('EM-03: a payment of 4.37 emits invoice.paid; the real InvoiceReceiptListener receipt prints the same stored rows; lines = Subtotal = Total = Paid TT$4.37', async () => {
    const inv = await createInvoice([L7, L3]);
    await sendInvoiceEmail(inv.id);

    emitted.length = 0;
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv.id}/payments`)).send({ amount: 4.37, method: 'cash', reference: `${P}em03` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db.invoice.findUnique({ where: { id: inv.id } })).status).toBe('PAID');
    const paidEvent = emitted.find((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === inv.id);
    expect(paidEvent, 'the payment emitted invoice.paid').toBeTruthy();

    sentEmails.length = 0;
    await receiptListener.onInvoicePaid(paidEvent!.payload);
    expect(sentEmails, 'one receipt email').toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/^Receipt for Invoice #/);
    const html = sentEmails[0].htmlBody;
    expectTwoLineDocument(html);
    expect.soft(printedFooter(html, 'Paid')).toBe('TT$4.37');
    expect.soft(html).toContain('received your payment of TT$4.37');
  });

  it('EM-04: a single line 7 x 0.145 prints line = Subtotal = Total = TT$1.02', async () => {
    const inv = await createInvoice([L7]);
    expect(inv.total).toBe(1.02);
    const html = await sendInvoiceEmail(inv.id);
    const rows = printedRows(html);
    expect.soft(rows.map((r) => [r.description, r.unit, r.line])).toEqual([['V82E L7', 'TT$0.15', 'TT$1.02']]);
    expect.soft(printedFooter(html, 'Subtotal')).toBe('TT$1.02');
    expect.soft(printedFooter(html, 'Total')).toBe('TT$1.02');
  });

  it('EM-06 control: whole-cent lines 2 x 10.10 and 3 x 0.33 print TT$10.10 / TT$20.20 and TT$0.33 / TT$0.99, Subtotal TT$21.19 (unchanged)', async () => {
    const inv = await createInvoice([
      { description: 'V82E W1', quantity: 2, unitPrice: 10.1 },
      { description: 'V82E W2', quantity: 3, unitPrice: 0.33 },
    ]);
    const html = await sendInvoiceEmail(inv.id);
    expect(printedRows(html).map((r) => [r.description, r.quantity, r.unit, r.line])).toEqual([
      ['V82E W1', '2', 'TT$10.10', 'TT$20.20'],
      ['V82E W2', '3', 'TT$0.33', 'TT$0.99'],
    ]);
    expect(printedFooter(html, 'Subtotal')).toBe('TT$21.19');
    expect(printedFooter(html, 'Total')).toBe('TT$21.19');
  });

  it('EM-07 legacy: an item whose stored total is the float 1.015 (the pre-V1-22 product 7 x 0.145), written by SQL, prints TT$1.02', async () => {
    const inv = await createInvoice([L7]);
    // The row as the base wrote it before V1-22: the binary float product, not cents.
    expect(7 * 0.145).toBe(1.015);
    await db.$executeRawUnsafe(`UPDATE invoice_items SET total = $1 WHERE invoice_id = $2`, 7 * 0.145, inv.id);
    await db.$executeRawUnsafe(`UPDATE invoices SET subtotal = $1, total = $1 WHERE id = $2`, 7 * 0.145, inv.id);
    expect(await storedLineTotals('invoice_items', 'invoice_id', inv.id)).toEqual({ 'V82E L7': 1.015 });

    const html = await sendInvoiceEmail(inv.id);
    const rows = printedRows(html);
    expect.soft(rows.map((r) => [r.description, r.line])).toEqual([['V82E L7', 'TT$1.02']]);
    expect.soft(printedFooter(html, 'Subtotal')).toBe('TT$1.02');
    expect.soft(printedFooter(html, 'Total')).toBe('TT$1.02');
  });
});

describe('the quote email prints the stored quote line totals (FOLLOW3-B5)', () => {
  it('EM-05: a quote with L7 + L3, POST .../quotes/:id/send-email prints TT$1.02 and TT$3.35 from the stored quote item totals; lines = Subtotal = Total TT$4.37', async () => {
    await sleep(3);
    const created = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes`)).send({ contactId: ID.contact, items: [L7, L3], currency: 'TTD' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const quoteId = created.body.id as string;
    expect(await storedLineTotals('quote_items', 'quote_id', quoteId), 'V1-22 stored quote lines').toEqual({ 'V82E L7': 1.02, 'V82E L3': 3.35 });
    expect(created.body.subtotal).toBe(4.37);

    sentEmails.length = 0;
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes/${quoteId}/send-email`)).send({ recipientEmail: CONTACT_EMAIL });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(sentEmails, 'one quote email').toHaveLength(1);
    expectTwoLineDocument(sentEmails[0].htmlBody);
  });
});
