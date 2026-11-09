/**
 * V1-81 (FOLLOW3-A10-DEPOSIT-CURRENCY) — a booking's final invoice never nets a
 * deposit billed in another currency (owner ruling D-59), against a REAL
 * database.
 *
 * D-13 is one currency per business with integer cents. The final invoice of a
 * completed booking is drawn up in the business currency
 * (CommerceService.createInvoiceForService, documentCurrency), and
 * BookingsService.issueFinalInvoice subtracted what the booking's live deposit
 * invoice covers (depositPosition) from the service price without comparing
 * the two currencies. A DRAFT deposit may be PATCHed to any D-13 currency (USD
 * on a TTD business), and the business currency may change between booking
 * and completion, so a deposit of 25 USD was netted as 25 TTD.
 *
 * D-59: when the live deposit is in another currency than the final invoice,
 * the final invoice is refused (409 DEPOSIT_CURRENCY_MISMATCH), nothing is
 * written, and the operator settles by hand. Completion keeps V1-28's contract:
 * the booking is COMPLETED and its answer carries the invoicing outcome
 * (FAILED, code DEPOSIT_CURRENCY_MISMATCH, a sentence naming both currencies);
 * the Create-invoice button (POST create-invoice) answers 409 with that code.
 * Review CR-A10-1: D-59's text says completion refuses with 409 and writes
 * nothing; the shipped envelope keeps V1-28's contract above (completion
 * never fails on its invoicing), to be reconciled in BUILD-MAP-001's D-59 row.
 *
 * Cases (RED = fails at 9f09d6c8; CONTROL = green there, kept):
 *   DC-01 RED      TTD business, service 100 with a 25 deposit; the DRAFT deposit is PATCHed to
 *                  USD through the real commerce route, sent and paid 25: completing the booking
 *                  draws up no final invoice (RED-BEFORE: a TTD final of 75 naming the USD deposit,
 *                  depositAmount 25), answers invoicing FAILED / DEPOSIT_CURRENCY_MISMATCH naming
 *                  USD and TTD, leaves Booking.invoiceId null and posts nothing; the Create-invoice
 *                  button then answers 409 with the same code and writes nothing
 *   DC-02 RED      the Create-invoice button on a booking whose USD deposit is paid: 409
 *                  DEPOSIT_CURRENCY_MISMATCH naming both currencies, nothing written
 *   DC-03 RED      a USD deposit SENT but unpaid (still owed on its own invoice, so it would be
 *                  netted): completion refuses the same way
 *   DC-04 RED      the business currency changes after booking (TTD deposit, business now USD):
 *                  completion refuses (the final would be USD), nothing written
 *   DC-05 CONTROL  a same-currency deposit nets exactly as before: final 75 TTD naming the
 *                  deposit, deposit + final == price
 *   DC-06 CONTROL  a voided USD deposit is not live and nets nothing: the final bills the full
 *                  100 TTD
 *   DC-07 CONTROL  D-26: a customer cancel after the USD deposit was paid forfeits 25 USD, in the
 *                  deposit's own currency, as before
 *   DC-08 RED      review SEC-A10-1, RED at 11e3e491: a TTD final nets the DRAFT TTD deposit
 *                  (the button finds it again, CONTROL), then the deposit is PATCHed to USD: the
 *                  button answered 201 alreadyExisted naming the USD deposit; it answers 409
 *                  DEPOSIT_CURRENCY_MISMATCH (finalInvoiceId in details), nothing written; once
 *                  the final is voided it nets nothing and the button finds it again
 *   DC-09 RED      review SEC-A10-1, RED at 11e3e491: the button draws the 75 TTD final before
 *                  completion, then the DRAFT final is PATCHed to USD: completion answered
 *                  EXISTING; it answers FAILED / DEPOSIT_CURRENCY_MISMATCH and the button 409,
 *                  nothing written. (The commerce PATCH itself still accepts both switches: a
 *                  follow-up outside this packet's write set.)
 *
 * Nothing on the money path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard, PublicRateLimitGuard (real Redis at
 * REDIS_URL, this suite's own key namespace), HoneypotGuard, BookingsController,
 * CommerceController, BookingsService, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService and CatalogService read and write real rows
 * behind the production GlobalHttpExceptionFilter, ValidationPipe and
 * TenantInterceptor. Identity attachment is the one stand-in: a test middleware
 * reads `x-v81j-user` and attaches the seeded user row as AuthMiddleware would.
 * Off the boundary (stubs): the event bus (recording), the contact timeline,
 * the public path's contact resolution (find-or-create by email on real rows),
 * COGS, stats cache, revenue attribution, storefront events, email, calendar
 * and the commerce controller's collaborators off the PATCH route.
 *
 * Fixtures: prefix `v81j_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81j_';
const HEADER = 'x-v81j-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`, // TTD, ACCRUAL
  bizSwitch: `${P}bizSwitch`, // TTD at booking, USD at completion (DC-04)
  svc: `${P}svc`, // 100, FIXED deposit 25
  svcSwitch: `${P}svcSwitch`, // 100, FIXED deposit 25, on bizSwitch
};

const MISMATCH = 'DEPOSIT_CURRENCY_MISMATCH';

let db: any;
let app: any;
let redis: any;
let commerce: any;
let workflow: any;

const eventBus = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

let contactSeq = 0;
const crmStub = {
  logContactEvent: async () => null,
  // The public path's find-or-create, on real rows: one contact per email.
  findOrCreateContact: async (businessId: string, input: { email?: string | null; firstName?: string | null; lastName?: string | null }) => {
    const found = await db.contact.findFirst({ where: { businessId, email: input.email ?? undefined } });
    if (found) return found;
    contactSeq += 1;
    return db.contact.create({
      data: { id: `${P}c${contactSeq}`, businessId, email: input.email, firstName: input.firstName, lastName: input.lastName },
    });
  },
};

async function cleanup() {
  const inv = `SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (${inv})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (${inv})`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (${inv})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

const money = (n: unknown) => Math.round(Number(n) * 100) / 100;

// Every booking gets its own hour, so no case meets another's slot.
let slotSeq = 0;
const nextSlot = () => new Date(Date.UTC(2030, 4, 6, 0, 0, 0) + (slotSeq++) * 60 * 60_000);

/** The public widget's create, anonymous. Each case books as its own customer. */
async function book(businessId: string, serviceId: string, who: string) {
  const res = await agent()
    .post(`/bookings/public/businesses/${businessId}`)
    .send({
      serviceId,
      startTime: nextSlot().toISOString(),
      firstName: 'Vee',
      lastName: who,
      email: `${P}${who}@test.local`,
      phone: '+18685550181',
    });
  expect(res.status, `public create: ${JSON.stringify(res.body)}`).toBe(201);
  expect(res.body.depositInvoiceId, 'the booking draws up its deposit invoice').toBeTruthy();
  return res.body as { bookingId: string; depositInvoiceId: string; depositAmount: number };
}

function setStatus(businessId: string, bookingId: string, status: string) {
  return agent().post(`/bookings/businesses/${businessId}/bookings/${bookingId}/status`).set(HEADER, ID.owner).send({ status });
}

function createInvoiceRoute(businessId: string, bookingId: string) {
  return agent().post(`/bookings/businesses/${businessId}/bookings/${bookingId}/create-invoice`).set(HEADER, ID.owner).send({});
}

/** The real commerce PATCH route, as the operator's invoice editor sends it. */
function patchInvoice(businessId: string, invoiceId: string, body: Record<string, unknown>) {
  return agent().patch(`/commerce/businesses/${businessId}/invoices/${invoiceId}`).set(HEADER, ID.owner).send(body);
}

const bookingRow = (id: string): Promise<any> => db.booking.findUnique({ where: { id } });
const invoiceRow = (id: string): Promise<any> => db.invoice.findUnique({ where: { id }, include: { items: true } });

/** Every invoice of the booking's contact other than its deposit, withdrawn (soft-deleted) ones included. */
async function otherInvoicesOf(bookingId: string): Promise<any[]> {
  const b = await bookingRow(bookingId);
  return db.invoice.findMany({
    where: { businessId: b.businessId, contactId: b.contactId, id: { not: b.depositInvoiceId } },
    include: { items: true },
  });
}

const describeInvoices = (rows: any[]) =>
  rows.map((i) => `${money(i.total)} ${i.currency}${i.deletedAt ? ' (withdrawn)' : ''}: ${i.items.map((x: any) => x.description).join(' | ')}`);

async function ledgerCount(businessId: string) {
  const [transactions, entries] = await Promise.all([
    db.financialTransaction.count({ where: { businessId } }),
    db.ledgerEntry.count({ where: { businessId } }),
  ]);
  return { transactions, entries };
}

/** PATCH the booking's DRAFT deposit invoice to USD through the real commerce route. */
async function depositToUsd(businessId: string, depositInvoiceId: string) {
  const res = await patchInvoice(businessId, depositInvoiceId, { currency: 'USD' });
  expect(res.status, `PATCH deposit currency: ${JSON.stringify(res.body)}`).toBe(200);
  const row = await invoiceRow(depositInvoiceId);
  expect(row.status).toBe('DRAFT');
  expect(row.currency).toBe('USD');
  expect(money(row.total)).toBe(25);
}

/** Send (DRAFT -> SENT, which posts the accrual recognition) and record a cash payment through CommerceService. */
async function sendAndPay(businessId: string, invoiceId: string, amount: number) {
  const inv = await invoiceRow(invoiceId);
  if (inv.status === 'DRAFT') await workflow.transition(invoiceId, 'SENT');
  await commerce.recordPayment(invoiceId, businessId, { amount, method: 'cash' }, { actorId: ID.owner });
  expect((await invoiceRow(invoiceId)).status).toBe('PAID');
}

/** The refusal of a final invoice against a deposit in another currency: nothing is written. */
async function expectRefusedAndUnwritten(
  label: string,
  businessId: string,
  bookingId: string,
  before: { transactions: number; entries: number },
) {
  expect(describeInvoices(await otherInvoicesOf(bookingId)), `${label}: no final invoice nets the deposit across currencies`).toEqual([]);
  expect((await bookingRow(bookingId)).invoiceId, `${label}: Booking.invoiceId stays null`).toBeNull();
  expect(await ledgerCount(businessId), `${label}: nothing is posted`).toEqual(before);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
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
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CreateBookingDto } = await import('../src/modules/bookings/dto/create-booking.dto');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');

  // The create handlers' parameter types as tsc emits them for the production
  // build (emitDecoratorMetadata), which vitest's esbuild transform does not.
  Reflect.defineMetadata('design:paramtypes', [String, CreateBookingDto, Object], BookingsController.prototype, 'createBooking');
  Reflect.defineMetadata('design:paramtypes', [String, PublicCreateBookingDto], BookingsController.prototype, 'publicCreateBooking');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const offRoute = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController, CommerceController],
    providers: [
      PrismaService,
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      BookingsService,
      CommerceService,
      InvoiceWorkflowService,
      // Real ledger chain: "nothing is posted" is read from the rows it writes.
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      CatalogService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventBus },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: BookingWaitlistService, useValue: offRoute },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
      { provide: BookingOptimizerService, useValue: offRoute },
      // CommerceController's collaborators off the PATCH invoice route.
      { provide: InvoiceReceiptBuilderService, useValue: offRoute },
      { provide: GmailService, useValue: offRoute },
      { provide: CommerceVisionService, useValue: offRoute },
      { provide: StoreReadinessService, useValue: offRoute },
      { provide: PaymentEvidenceService, useValue: offRoute },
      { provide: TimeEntryService, useValue: offRoute },
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
  await app.init();

  commerce = moduleRef.get(CommerceService);
  workflow = moduleRef.get(InvoiceWorkflowService);

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  for (const businessId of [ID.biz, ID.bizSwitch]) {
    await db.business.create({ data: { id: businessId, name: `V81J ${businessId.slice(P.length)}`, ownerId: ID.owner, currency: 'TTD', timezone: 'UTC', accountingBasis: 'ACCRUAL' } });
    await db.membership.create({ data: { id: `${P}m_${businessId.slice(P.length)}`, userId: ID.owner, businessId, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(businessId);
  }
  const deposit25 = { duration: 60, price: 100, depositRequired: true, depositType: 'FIXED', depositValue: 25 };
  await db.service.create({ data: { id: ID.svc, businessId: ID.biz, name: 'V81J Svc', ...deposit25 } });
  await db.service.create({ data: { id: ID.svcSwitch, businessId: ID.bizSwitch, name: 'V81J Svc Switch', ...deposit25 } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

beforeEach(async () => {
  await clearRateLimits();
});

describe('V1-81 (FOLLOW3-A10, D-59) a final invoice never nets a deposit billed in another currency', () => {
  it('DC-01 RED-BEFORE: a paid USD deposit on a TTD business -> completion draws up no final invoice, answers DEPOSIT_CURRENCY_MISMATCH naming both currencies, posts nothing; Create invoice then answers 409', async () => {
    const b = await book(ID.biz, ID.svc, 'dc01');
    await depositToUsd(ID.biz, b.depositInvoiceId);
    await sendAndPay(ID.biz, b.depositInvoiceId, 25);
    const before = await ledgerCount(ID.biz);

    const res = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status, 'V1-28: the booking is completed whatever its invoicing').toBe('COMPLETED');
    expect((await bookingRow(b.bookingId)).status).toBe('COMPLETED');

    await expectRefusedAndUnwritten('completion', ID.biz, b.bookingId, before);
    expect(res.body.invoicing, 'the completion answer carries the refusal').toMatchObject({ status: 'FAILED', invoiceId: null, code: MISMATCH });
    expect(res.body.invoicing.error, 'the sentence names the deposit currency').toContain('USD');
    expect(res.body.invoicing.error, 'the sentence names the final invoice currency').toContain('TTD');
    expect(res.body.invoiceErrorCode).toBe(MISMATCH);
    expect(res.body.invoiceError).toBe(res.body.invoicing.error);
    expect(res.body.invoiceId ?? null).toBeNull();

    // The operator's Create-invoice button after the refused completion.
    const button = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(button.status, JSON.stringify(button.body)).toBe(409);
    expect(button.body.code).toBe(MISMATCH);
    expect(button.body.message).toContain('USD');
    expect(button.body.message).toContain('TTD');
    await expectRefusedAndUnwritten('create-invoice after completion', ID.biz, b.bookingId, before);

    // The deposit itself is untouched: still PAID 25 USD.
    const deposit = await invoiceRow(b.depositInvoiceId);
    expect({ status: deposit.status, currency: deposit.currency, total: money(deposit.total) }).toEqual({ status: 'PAID', currency: 'USD', total: 25 });
  });

  it('DC-02 RED-BEFORE: the Create-invoice button on a booking whose USD deposit is paid -> 409 DEPOSIT_CURRENCY_MISMATCH, nothing written', async () => {
    const b = await book(ID.biz, ID.svc, 'dc02');
    await depositToUsd(ID.biz, b.depositInvoiceId);
    await sendAndPay(ID.biz, b.depositInvoiceId, 25);
    const before = await ledgerCount(ID.biz);

    const res = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe(MISMATCH);
    expect(res.body.message).toContain('USD');
    expect(res.body.message).toContain('TTD');
    expect(res.body.details, 'the refusal names both currencies as fields').toMatchObject({ depositCurrency: 'USD', invoiceCurrency: 'TTD', depositInvoiceId: b.depositInvoiceId });
    await expectRefusedAndUnwritten('create-invoice', ID.biz, b.bookingId, before);
  });

  it('DC-03 RED-BEFORE: a USD deposit sent but unpaid (still owed, so it would be netted) -> completion refuses the same way', async () => {
    const b = await book(ID.biz, ID.svc, 'dc03');
    await depositToUsd(ID.biz, b.depositInvoiceId);
    await workflow.transition(b.depositInvoiceId, 'SENT');
    const before = await ledgerCount(ID.biz);

    const res = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectRefusedAndUnwritten('completion (unpaid deposit)', ID.biz, b.bookingId, before);
    expect(res.body.invoicing).toMatchObject({ status: 'FAILED', invoiceId: null, code: MISMATCH });
    expect(res.body.invoiceErrorCode).toBe(MISMATCH);
  });

  it('DC-04 RED-BEFORE: the business currency changes after booking (TTD deposit, business now USD) -> completion refuses, nothing written', async () => {
    const b = await book(ID.bizSwitch, ID.svcSwitch, 'dc04');
    expect((await invoiceRow(b.depositInvoiceId)).currency).toBe('TTD');
    await sendAndPay(ID.bizSwitch, b.depositInvoiceId, 25);
    await db.business.update({ where: { id: ID.bizSwitch }, data: { currency: 'USD' } });
    try {
      const before = await ledgerCount(ID.bizSwitch);
      const res = await setStatus(ID.bizSwitch, b.bookingId, 'COMPLETED');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await expectRefusedAndUnwritten('completion (business currency changed)', ID.bizSwitch, b.bookingId, before);
      expect(res.body.invoicing).toMatchObject({ status: 'FAILED', invoiceId: null, code: MISMATCH });
      expect(res.body.invoicing.error).toContain('TTD');
      expect(res.body.invoicing.error).toContain('USD');

      const button = await createInvoiceRoute(ID.bizSwitch, b.bookingId);
      expect(button.status, JSON.stringify(button.body)).toBe(409);
      expect(button.body.details).toMatchObject({ depositCurrency: 'TTD', invoiceCurrency: 'USD' });
      await expectRefusedAndUnwritten('create-invoice (business currency changed)', ID.bizSwitch, b.bookingId, before);
    } finally {
      await db.business.update({ where: { id: ID.bizSwitch }, data: { currency: 'TTD' } });
    }
  });

  it('DC-05 CONTROL: a same-currency deposit nets exactly as before (final 75 TTD naming the deposit, deposit + final == price)', async () => {
    const b = await book(ID.biz, ID.svc, 'dc05');
    // Restating the business currency on the DRAFT deposit is no change.
    const restated = await patchInvoice(ID.biz, b.depositInvoiceId, { currency: 'TTD' });
    expect(restated.status, JSON.stringify(restated.body)).toBe(200);
    await sendAndPay(ID.biz, b.depositInvoiceId, 25);
    const deposit = await invoiceRow(b.depositInvoiceId);
    expect(deposit.currency).toBe('TTD');

    const res = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const finals = await otherInvoicesOf(b.bookingId);
    expect(finals.map((i) => `${money(i.total)} ${i.currency}`)).toEqual(['75 TTD']);
    const final = finals[0];
    expect(final.deletedAt).toBeNull();
    expect(final.items[0].description, 'the final invoice names the deposit invoice').toContain(deposit.invoiceNumber);
    expect((await bookingRow(b.bookingId)).invoiceId).toBe(final.id);
    expect(res.body.invoiceError).toBeNull();
    expect(res.body.invoiceErrorCode).toBeNull();
    expect(res.body.invoicing).toMatchObject({ status: 'CREATED', invoiceId: final.id, amount: 75, depositInvoiceId: deposit.id, depositAmount: 25 });
    expect(money(Number(deposit.total) + Number(final.total)), 'deposit + final == price').toBe(100);
  });

  it('DC-06 CONTROL: a voided USD deposit is not live and nets nothing -> the final bills the full 100 TTD', async () => {
    const b = await book(ID.biz, ID.svc, 'dc06');
    await depositToUsd(ID.biz, b.depositInvoiceId);
    await workflow.transition(b.depositInvoiceId, 'VOID');

    const res = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const finals = await otherInvoicesOf(b.bookingId);
    expect(finals.map((i) => `${money(i.total)} ${i.currency}`)).toEqual(['100 TTD']);
    expect(res.body.invoicing).toMatchObject({ status: 'CREATED', amount: 100, depositInvoiceId: null, depositAmount: 0 });
    expect((await bookingRow(b.bookingId)).invoiceId).toBe(finals[0].id);
  });

  it('DC-07 CONTROL (D-26): a customer cancel after the USD deposit was paid forfeits 25 USD, in the deposit currency', async () => {
    const b = await book(ID.biz, ID.svc, 'dc07');
    await depositToUsd(ID.biz, b.depositInvoiceId);
    await sendAndPay(ID.biz, b.depositInvoiceId, 25);
    const deposit = await invoiceRow(b.depositInvoiceId);

    const res = await setStatus(ID.biz, b.bookingId, 'CANCELLED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.depositForfeit).toEqual({ depositInvoiceId: deposit.id, invoiceNumber: deposit.invoiceNumber, amount: 25, currency: 'USD' });
    const row = await bookingRow(b.bookingId);
    expect({ status: row.status, paymentStatus: row.paymentStatus, invoiceId: row.invoiceId }).toEqual({ status: 'CANCELLED', paymentStatus: 'DEPOSIT_FORFEITED', invoiceId: null });
    const after = await invoiceRow(b.depositInvoiceId);
    expect({ status: after.status, currency: after.currency }, 'the deposit invoice keeps its status and currency').toEqual({ status: 'PAID', currency: 'USD' });
  });

  it('DC-08 RED-BEFORE (review SEC-A10-1): the DRAFT deposit is PATCHed to USD after a TTD final netted it -> Create invoice answers 409 DEPOSIT_CURRENCY_MISMATCH, not alreadyExisted; nothing written', async () => {
    const b = await book(ID.biz, ID.svc, 'dc08');
    const deposit = await invoiceRow(b.depositInvoiceId);
    expect({ status: deposit.status, currency: deposit.currency }).toEqual({ status: 'DRAFT', currency: 'TTD' });

    const done = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75, depositInvoiceId: deposit.id, depositAmount: 25 });
    const finalId = done.body.invoicing.invoiceId as string;

    // CONTROL: a same-currency pairing is found again, unchanged (the EXISTING answer).
    const again = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toMatchObject({ invoiceId: finalId, alreadyExisted: true, amount: 75, depositInvoiceId: deposit.id });

    // The commerce PATCH still accepts the switch on the DRAFT deposit (the
    // commerce-side re-check is a follow-up outside this packet's write set).
    await depositToUsd(ID.biz, b.depositInvoiceId);
    const before = await ledgerCount(ID.biz);

    const res = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(res.status, `RED-BEFORE: 201 alreadyExisted netting a USD deposit: ${JSON.stringify(res.body)}`).toBe(409);
    expect(res.body.code).toBe(MISMATCH);
    expect(res.body.message).toContain('USD');
    expect(res.body.message).toContain('TTD');
    expect(res.body.details).toMatchObject({ depositInvoiceId: deposit.id, depositCurrency: 'USD', invoiceCurrency: 'TTD', finalInvoiceId: finalId });

    const final = await invoiceRow(finalId);
    expect({ total: money(final.total), currency: final.currency, status: final.status, deletedAt: final.deletedAt }, 'the final invoice is untouched').toEqual({ total: 75, currency: 'TTD', status: 'DRAFT', deletedAt: null });
    expect((await bookingRow(b.bookingId)).invoiceId, 'Booking.invoiceId keeps the final invoice').toBe(finalId);
    expect(await ledgerCount(ID.biz), 'nothing is posted').toEqual(before);

    // A voided final nets nothing: the button finds it again, no refusal.
    await workflow.transition(finalId, 'VOID');
    const afterVoid = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(afterVoid.status, JSON.stringify(afterVoid.body)).toBe(201);
    expect(afterVoid.body).toMatchObject({ invoiceId: finalId, alreadyExisted: true });
  });

  it('DC-09 RED-BEFORE (review SEC-A10-1): the DRAFT final is PATCHed to USD after it netted a TTD deposit -> completion answers DEPOSIT_CURRENCY_MISMATCH and Create invoice 409; nothing written', async () => {
    const b = await book(ID.biz, ID.svc, 'dc09');
    const deposit = await invoiceRow(b.depositInvoiceId);

    // The Create-invoice button before completion draws the 75 TTD final.
    const drawn = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(201);
    expect(drawn.body).toMatchObject({ alreadyExisted: false, amount: 75, depositInvoiceId: deposit.id });
    const finalId = drawn.body.invoiceId as string;

    const patched = await patchInvoice(ID.biz, finalId, { currency: 'USD' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await invoiceRow(finalId)).currency).toBe('USD');
    const before = await ledgerCount(ID.biz);

    const res = await setStatus(ID.biz, b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status, 'V1-28: the booking is completed whatever its invoicing').toBe('COMPLETED');
    expect(res.body.invoicing, `RED-BEFORE: EXISTING netting a TTD deposit on a USD final: ${JSON.stringify(res.body.invoicing)}`).toMatchObject({ status: 'FAILED', invoiceId: null, code: MISMATCH });
    expect(res.body.invoicing.error).toContain('USD');
    expect(res.body.invoicing.error).toContain('TTD');
    expect(res.body.invoiceErrorCode).toBe(MISMATCH);

    const button = await createInvoiceRoute(ID.biz, b.bookingId);
    expect(button.status, JSON.stringify(button.body)).toBe(409);
    expect(button.body.code).toBe(MISMATCH);
    expect(button.body.details).toMatchObject({ depositInvoiceId: deposit.id, depositCurrency: 'TTD', invoiceCurrency: 'USD', finalInvoiceId: finalId });

    const final = await invoiceRow(finalId);
    expect({ total: money(final.total), currency: final.currency, status: final.status, deletedAt: final.deletedAt }, 'the final invoice is untouched').toEqual({ total: 75, currency: 'USD', status: 'DRAFT', deletedAt: null });
    expect((await bookingRow(b.bookingId)).invoiceId, 'Booking.invoiceId keeps the final invoice').toBe(finalId);
    expect(await ledgerCount(ID.biz), 'nothing is posted').toEqual(before);
  });
});
