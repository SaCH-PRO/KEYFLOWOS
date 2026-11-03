/**
 * V1-28-BK-SETTLEMENT — a booking's money against a REAL database: the
 * completion invoice nets the deposit, the invoicing outcome is visible,
 * Booking.paymentStatus follows the invoices, invoice.paid confirms the booking
 * it pays for, and a customer cancel after a paid deposit forfeits it (D-26).
 *
 * M42 / CF-43 / BK-03. Defects at the V1-16 head:
 *
 *   RE-BILLED DEPOSIT. A service of 100 with a 25 deposit: the deposit invoice
 *   is drawn up at booking time, and completing the booking drew up a second
 *   invoice for the full 100 (autoGenerateInvoiceForCompletedBooking), so the
 *   customer was billed 125 for a 100 service. The "Create invoice" button
 *   (createInvoiceFromBooking) did the same.
 *   SWALLOWED FAILURE. An invoicing failure on completion was logged and
 *   swallowed: the response said nothing, and the operator could not tell a
 *   booking that was invoiced from one that was not.
 *   NO WRITER. Booking.paymentStatus (UNPAID | DEPOSIT_PAID | PAID) had no
 *   writer anywhere: every booking read UNPAID forever.
 *   DEAD CONFIRM HOOK. FlowListener.handleInvoicePaid tested
 *   payload.invoice.bookingId, a field no invoice.paid payload carries (the
 *   relation is invoice.booking, and a deposit's is Booking.depositInvoiceId),
 *   so paying never confirmed a booking.
 *   401 RECEIPT. Both booking confirmation pages opened
 *   /commerce/invoices/:id/receipt, the operator's authenticated receipt, for
 *   an anonymous customer.
 *
 * Cases (RED = fails at the V1-16 head; CONTROL = green there, kept):
 *   S-01 RED      100 with a paid 25 deposit: the final invoice is 75 and names the deposit invoice
 *   S-02 RED      deposit + final == price: PERCENT deposit with cents, unpaid deposit, no deposit
 *                 (CONTROL), a voided deposit (CONTROL), a deposit that covers the price (no final)
 *   S-03 RED      completing twice (in turn and at once) leaves ONE final invoice, both answers name it
 *   S-04 RED      an invoicing failure leaves the booking COMPLETED with an explicit invoiceError;
 *                 the Create-invoice button then draws up the netted invoice
 *   S-05 RED      paymentStatus: deposit PAID -> DEPOSIT_PAID, final PAID -> PAID, replays write
 *                 nothing, another tenant's event is ignored, an older event never downgrades
 *   S-06 RED      invoice.paid confirms the PENDING booking through the relation (deposit and
 *                 booking-time invoice); CONTROLS: a COMPLETED or CANCELLED booking is left alone,
 *                 another tenant's event confirms nothing
 *   S-07 RED      D-26: a cancel after a paid deposit records the forfeit on the booking
 *                 (DEPOSIT_FORFEITED), the deposit stays PAID, nothing is refunded or credited;
 *                 CONTROL: an unpaid deposit forfeits nothing; reinstating restores DEPOSIT_PAID
 *   S-08 RED      the public create answers the customer's token link (D-07) for its invoice, and
 *                 the confirmation pages link it instead of the authenticated receipt
 *   L-01 RED      LEDGER: deposit + final revenue postings sum to the price; cash likewise
 *   L-02 CONTROL  LEDGER: every FinancialTransaction of both tenants balances (debits = credits)
 *
 * V1-28 review repairs (red at the V1-28 head e8d1f172, green after):
 *   S-02b CR-V28-2   a credited deposit nets only what it still bills (FULLY_CREDITED: nothing)
 *   S-04  SEC-V28-1  the invoiceError is a fixed sentence plus a code, never the raw error text
 *   S-04b SEC-V28-1  an invoice-number collision (INV-<Date.now()>) is retried; a persistent database
 *                    failure answers the fixed sentence, never Prisma's text, paths or column names
 *   S-05c CR-V28-1   the final paid while the deposit is still owed (SENT or DRAFT) is not PAID
 *   S-07c SEC-V28-3  a refunded deposit (reopened to SENT under D-14) forfeits nothing, is not
 *                    restored as DEPOSIT_PAID on reinstatement, and is owed again on its own invoice
 *   S-07d SEC-V28-2  the forfeit row names the member who cancelled; a call with no member is SYSTEM
 *
 * Trial-I integration review (V1-28 with the D-14 refund convention), red at b1852b46:
 *   S-07e F1/REG-3   a deposit part-refunded under D-14 (reopened to PARTIALLY_PAID, net 15)
 *                    forfeits the 15 it still holds on a cancel; CONTROL: a part payment on a
 *                    deposit still owed (never refunded) holds nothing and forfeits nothing
 *   TODO  CR-V28-4   a business-initiated cancel forfeits nothing (needs a cancel-initiator input)
 *   TODO  CR-V28-3   the storefront passes the token link into the confirmation (book/[slug]/page.tsx)
 *
 * Nothing on the money path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * PlanLimitGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this suite's
 * own key namespace), HoneypotGuard, BookingsController, BookingsService,
 * CommerceService, InvoiceWorkflowService, RevenuePostingService,
 * PostingService, ChartOfAccountsSeederService and CatalogService read and
 * write real rows behind the production GlobalHttpExceptionFilter,
 * ValidationPipe and TenantInterceptor (APP_INTERCEPTOR, as in AppModule).
 * Identity attachment is the one stand-in: a test middleware
 * reads `x-v28a-user` and attaches the seeded user row as AuthMiddleware would.
 * EventEmitter2 is a recording bus: invoice.paid payloads the REAL workflow
 * emits are handed to the REAL BookingPaymentStatusListener and FlowListener
 * (the bus wiring itself is proven in booking-payment-status.listener.spec.ts).
 * Off the boundary: the contact timeline (recording stub), the public path's
 * contact resolution (find-or-create by email on real rows), COGS, stats
 * cache, revenue attribution, storefront events, email and the calendar.
 *
 * Fixtures: prefix `v28a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v28a_';
const HEADER = 'x-v28a-user';

const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  ownerB: `${P}ownerB`,
  biz: `${P}biz`, // ACCRUAL: an invoice is recognised when it is sent
  bizB: `${P}bizB`, // another tenant
  svcDep: `${P}svcDep`, // 100, FIXED deposit 25
  svcPct: `${P}svcPct`, // 99.99, PERCENT deposit 33 -> 33.00
  svcAll: `${P}svcAll`, // 100, PERCENT deposit 100 -> the deposit is the price
  svcNoDep: `${P}svcNoDep`, // 100, no deposit, invoiced on completion
  svcAtBooking: `${P}svcAtBooking`, // 60, no deposit, invoiced at booking
};

const WEB = path.resolve(__dirname, '../../web/src/app');
const WEB_PAGES = {
  orderConfirmation: path.join(WEB, 'book/[slug]/components/order-confirmation.tsx'),
  publicBook: path.join(WEB, 'public/book/page.tsx'),
};

let db: any;
let app: any;
let redis: any;
let prismaService: any;
let commerce: any;
let workflow: any;
let flowListener: any;
let bookingsService: any;
/** null at the V1-16 head: the listener does not exist there. */
let paymentStatusListener: any = null;

const emitted: Array<{ name: string; payload: any }> = [];
const eventBus = {
  emit: (name: string, payload: unknown) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

const contactEvents: Array<{ businessId: string; contactId: string; type: string; data?: any }> = [];
let contactSeq = 0;
const crmStub = {
  logContactEvent: async (e: any) => {
    contactEvents.push(e);
    return null;
  },
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
const nextSlot = () => new Date(Date.UTC(2030, 2, 4, 0, 0, 0) + (slotSeq++) * 60 * 60_000);

/** The public widget's create, anonymous. Each case books as its own customer. */
async function book(serviceId: string, who: string) {
  const res = await agent()
    .post(`/bookings/public/businesses/${ID.biz}`)
    .send({
      serviceId,
      startTime: nextSlot().toISOString(),
      firstName: 'Vee',
      lastName: who,
      email: `${P}${who}@test.local`,
      phone: '+18685550128',
    });
  expect(res.status, `public create: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body as {
    bookingId: string;
    invoiceId?: string;
    depositInvoiceId?: string;
    depositAmount: number;
    invoiceUrl?: string;
    depositInvoiceUrl?: string;
  };
}

function setStatus(bookingId: string, status: string) {
  return agent()
    .post(`/bookings/businesses/${ID.biz}/bookings/${bookingId}/status`)
    .set(HEADER, ID.owner)
    .send({ status });
}

function createInvoiceRoute(bookingId: string) {
  return agent().post(`/bookings/businesses/${ID.biz}/bookings/${bookingId}/create-invoice`).set(HEADER, ID.owner).send({});
}

const bookingRow = (id: string): Promise<any> => db.booking.findUnique({ where: { id } });
const invoiceRow = (id: string): Promise<any> => db.invoice.findUnique({ where: { id }, include: { items: true } });

/** The booking's invoices other than its deposit: what completion billed. */
async function finalInvoicesOf(bookingId: string): Promise<any[]> {
  const b = await bookingRow(bookingId);
  return db.invoice.findMany({
    where: { businessId: b.businessId, contactId: b.contactId, deletedAt: null, ...(b.depositInvoiceId ? { id: { not: b.depositInvoiceId } } : {}) },
    include: { items: true },
  });
}

/** Send (DRAFT -> SENT, which posts the accrual recognition) and record a cash payment through CommerceService. */
async function sendAndPay(invoiceId: string, amount: number) {
  const inv = await invoiceRow(invoiceId);
  if (inv.status === 'DRAFT') await workflow.transition(invoiceId, 'SENT');
  await commerce.recordPayment(invoiceId, ID.biz, { amount, method: 'cash' }, { actorId: ID.owner });
}

/** The invoice.paid payloads the real workflow emitted for this invoice. */
const paidEventsFor = (invoiceId: string) =>
  emitted.filter((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === invoiceId).map((e) => e.payload);

/** Hand the emitted invoice.paid payload(s) to the real listeners, as the bus would. */
async function deliverPaid(payload: any) {
  if (paymentStatusListener) await paymentStatusListener.onInvoicePaid(payload);
  await flowListener.handleInvoicePaid(payload);
}

async function settle(invoiceId: string, amount: number) {
  await sendAndPay(invoiceId, amount);
  const events = paidEventsFor(invoiceId);
  expect(events.length, `invoice.paid emitted for ${invoiceId}`).toBe(1);
  await deliverPaid(events[0]);
  return events[0];
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
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { FlowListener } = await import('../src/modules/flow/flow.listener');
  const { CreateBookingDto } = await import('../src/modules/bookings/dto/create-booking.dto');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');
  // V1-28 adds this file; at the V1-16 head it does not exist and the
  // paymentStatus cases fail on its absence instead of the suite failing to load.
  const listenerMod: any = await import('../src/modules/bookings/booking-payment-status.listener').catch(() => null);

  // The create handlers' parameter types as tsc emits them for the production
  // build (emitDecoratorMetadata), which vitest's esbuild transform does not.
  Reflect.defineMetadata('design:paramtypes', [String, CreateBookingDto, Object], BookingsController.prototype, 'createBooking');
  Reflect.defineMetadata('design:paramtypes', [String, PublicCreateBookingDto], BookingsController.prototype, 'publicCreateBooking');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      PrismaService,
      // The production global interceptor: it binds the authenticated member
      // and the guarded business for the request (the forfeit row's actor).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      AuthGuard,
      BusinessGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      BookingsService,
      CommerceService,
      InvoiceWorkflowService,
      // Real ledger chain: the proof is the rows it posts.
      RevenuePostingService,
      PostingService,
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
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
      { provide: BookingOptimizerService, useValue: {} },
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

  prismaService = moduleRef.get(PrismaService);
  commerce = moduleRef.get(CommerceService);
  workflow = moduleRef.get(InvoiceWorkflowService);
  bookingsService = moduleRef.get(BookingsService);
  // The real listeners, built over the module's real services. FlowListener's
  // copilot and email collaborators are not reached by handleInvoicePaid.
  flowListener = new FlowListener(bookingsService, prismaService, {} as any, {} as any, commerce);
  if (listenerMod?.BookingPaymentStatusListener) {
    paymentStatusListener = new listenerMod.BookingPaymentStatusListener(prismaService);
  }

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V28A Biz', ownerId: ID.owner, currency: 'TTD', timezone: 'UTC', accountingBasis: 'ACCRUAL' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V28A Biz B', ownerId: ID.ownerB, currency: 'TTD', timezone: 'UTC', accountingBasis: 'ACCRUAL' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  const service = (id: string, businessId: string, data: Record<string, unknown>) =>
    db.service.create({ data: { id, businessId, name: `Svc ${id.slice(P.length)}`, duration: 60, ...data } });
  await service(ID.svcDep, ID.biz, { price: 100, depositRequired: true, depositType: 'FIXED', depositValue: 25 });
  await service(ID.svcPct, ID.biz, { price: 99.99, depositRequired: true, depositType: 'PERCENT', depositValue: 33 });
  await service(ID.svcAll, ID.biz, { price: 100, depositRequired: true, depositType: 'PERCENT', depositValue: 100 });
  await service(ID.svcNoDep, ID.biz, { price: 100 });
  await service(ID.svcAtBooking, ID.biz, { price: 60, invoiceTiming: 'BOOKING' });
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
  emitted.length = 0;
  contactEvents.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('V1-28 the completion invoice nets the deposit (CF-43)', () => {
  it('S-01 RED-BEFORE: 100 with a paid 25 deposit -> the final invoice is 75 and names the deposit invoice', async () => {
    const b = await book(ID.svcDep, 's01');
    expect(b.depositInvoiceId).toBeTruthy();
    const deposit = await invoiceRow(b.depositInvoiceId!);
    expect(money(deposit.total)).toBe(25);
    await settle(deposit.id, 25);

    const res = await setStatus(b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('COMPLETED');

    const finals = await finalInvoicesOf(b.bookingId);
    expect(finals.map((i) => money(i.total)), 'final invoices drawn up on completion').toEqual([75]);
    const final = finals[0];
    expect(final.items.map((i: any) => money(i.total))).toEqual([75]);
    expect(final.items[0].description, 'the final invoice names the deposit invoice').toContain(deposit.invoiceNumber);
    expect((await bookingRow(b.bookingId)).invoiceId).toBe(final.id);
    expect(res.body.invoiceId, 'the response names the final invoice').toBe(final.id);
    expect(res.body.invoiceError).toBeNull();
    expect(res.body.invoicing).toMatchObject({ status: 'CREATED', invoiceId: final.id, amount: 75, depositInvoiceId: deposit.id, depositAmount: 25 });
    expect(money(Number(deposit.total) + Number(final.total)), 'deposit + final == price').toBe(100);
  });

  it('S-02 RED-BEFORE: deposit + final == price in every case (cents, unpaid deposit, voided deposit, no deposit, deposit covers the price)', async () => {
    type Case = { label: string; serviceId: string; price: number; prepare?: (b: any) => Promise<void>; expectFinal: number | null; countsDeposit: boolean };
    const cases: Case[] = [
      { label: 'PERCENT 33 of 99.99 (deposit 33.00), paid', serviceId: ID.svcPct, price: 99.99, prepare: async (b) => { await settle(b.depositInvoiceId, 33); }, expectFinal: 66.99, countsDeposit: true },
      { label: 'FIXED 25, deposit sent but unpaid', serviceId: ID.svcDep, price: 100, prepare: async (b) => { await workflow.transition(b.depositInvoiceId, 'SENT'); }, expectFinal: 75, countsDeposit: true },
      { label: 'FIXED 25, deposit voided (CONTROL)', serviceId: ID.svcDep, price: 100, prepare: async (b) => { await workflow.transition(b.depositInvoiceId, 'VOID'); }, expectFinal: 100, countsDeposit: false },
      { label: 'no deposit (CONTROL)', serviceId: ID.svcNoDep, price: 100, expectFinal: 100, countsDeposit: false },
      { label: 'PERCENT 100: the deposit is the price', serviceId: ID.svcAll, price: 100, prepare: async (b) => { await settle(b.depositInvoiceId, 100); }, expectFinal: null, countsDeposit: true },
    ];
    for (const c of cases) {
      const b: any = await book(c.serviceId, `s02_${c.serviceId.slice(P.length)}_${c.expectFinal}`);
      if (c.prepare) await c.prepare(b);
      const res = await setStatus(b.bookingId, 'COMPLETED');
      expect(res.status, `${c.label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.invoiceError ?? null, c.label).toBeNull();

      const finals = await finalInvoicesOf(b.bookingId);
      const deposit = b.depositInvoiceId ? await invoiceRow(b.depositInvoiceId) : null;
      const depositPart = c.countsDeposit && deposit ? Number(deposit.total) : 0;
      if (c.expectFinal === null) {
        expect(finals, `${c.label}: no final invoice`).toHaveLength(0);
        expect(res.body.invoicing?.status, c.label).toBe('NOT_REQUIRED');
        expect(money(depositPart), `${c.label}: the deposit alone is the price`).toBe(c.price);
      } else {
        expect(finals.map((i) => money(i.total)), c.label).toEqual([c.expectFinal]);
        expect(money(depositPart + Number(finals[0].total)), `${c.label}: deposit + final == price`).toBe(c.price);
      }
    }
  });

  it('S-02b CR-V28-2: a credited deposit nets only what it still bills (FULLY_CREDITED: nothing; an applied credit of 10: 15)', async () => {
    // FULLY_CREDITED, the status CreditNoteService.apply writes once the credits reach the total.
    const full = await book(ID.svcDep, 's02b_full');
    await settle(full.depositInvoiceId!, 25);
    await db.invoice.update({ where: { id: full.depositInvoiceId }, data: { status: 'FULLY_CREDITED' } });
    const r1 = await setStatus(full.bookingId, 'COMPLETED');
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect((await finalInvoicesOf(full.bookingId)).map((i) => money(i.total)), 'a fully credited deposit bills nothing').toEqual([100]);
    expect(r1.body.invoicing).toMatchObject({ status: 'CREATED', amount: 100, depositAmount: 0, depositInvoiceId: null });

    // An APPLIED credit note of 10 and PARTIALLY_CREDITED, as CreditNoteService.apply leaves them.
    const part = await book(ID.svcDep, 's02b_part');
    await settle(part.depositInvoiceId!, 25);
    await db.creditNote.create({
      data: { id: `${P}cn_part`, businessId: ID.biz, invoiceId: part.depositInvoiceId, creditNoteNumber: `${P}CN-1`, status: 'APPLIED', amount: 10, appliedAt: new Date() },
    });
    await db.invoice.update({ where: { id: part.depositInvoiceId }, data: { status: 'PARTIALLY_CREDITED' } });
    const r2 = await setStatus(part.bookingId, 'COMPLETED');
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const finals = await finalInvoicesOf(part.bookingId);
    expect(finals.map((i) => money(i.total)), 'the deposit still bills 15').toEqual([85]);
    expect(r2.body.invoicing).toMatchObject({ status: 'CREATED', amount: 85, depositAmount: 15, depositInvoiceId: part.depositInvoiceId });
  });

  it('S-03 RED-BEFORE: completing twice, in turn and at once, leaves ONE final invoice and both answers name it', async () => {
    const seq = await book(ID.svcDep, 's03_seq');
    const first = await setStatus(seq.bookingId, 'COMPLETED');
    const second = await setStatus(seq.bookingId, 'COMPLETED');
    const seqFinals = await finalInvoicesOf(seq.bookingId);
    expect(seqFinals.map((i) => money(i.total))).toEqual([75]);
    expect(first.body.invoicing).toMatchObject({ status: 'CREATED', invoiceId: seqFinals[0].id });
    expect(second.body.invoicing).toMatchObject({ status: 'EXISTING', invoiceId: seqFinals[0].id });
    expect(second.body.invoiceId).toBe(seqFinals[0].id);

    const par = await book(ID.svcDep, 's03_par');
    const both = await Promise.all([setStatus(par.bookingId, 'COMPLETED'), setStatus(par.bookingId, 'COMPLETED')]);
    const parFinals = await finalInvoicesOf(par.bookingId);
    expect(parFinals.map((i) => money(i.total)), `responses: ${both.map((r) => `${r.status} ${JSON.stringify(r.body.invoicing)}`).join(' | ')}`).toEqual([75]);
    for (const r of both) {
      expect(r.status).toBe(201);
      expect(r.body.invoiceError).toBeNull();
      expect(r.body.invoiceId).toBe(parFinals[0].id);
    }
    expect(both.map((r) => r.body.invoicing.status).sort()).toEqual(['CREATED', 'EXISTING']);
    expect((await bookingRow(par.bookingId)).invoiceId).toBe(parFinals[0].id);
  });

  it('S-04 RED-BEFORE: an invoicing failure leaves the booking COMPLETED with an explicit invoiceError; the Create-invoice button then draws up the netted invoice', async () => {
    const b = await book(ID.svcDep, 's04');
    vi.spyOn(commerce, 'createInvoiceForService').mockRejectedValueOnce(new Error('v28a injected invoice failure'));
    const res = await setStatus(b.bookingId, 'COMPLETED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(typeof res.body.invoiceError, 'invoiceError in the response').toBe('string');
    expect(res.body.invoiceError).toContain('its invoice could not be created');
    // SEC-V28-1: an unexpected error's own text is logged, never answered.
    expect(res.body.invoiceError).not.toContain('v28a injected invoice failure');
    expect(JSON.stringify(res.body.invoicing)).not.toContain('v28a injected invoice failure');
    expect(res.body.invoiceErrorCode).toBe('INVOICE_NOT_CREATED');
    expect(res.body.invoicing).toMatchObject({ status: 'FAILED', code: 'INVOICE_NOT_CREATED', error: res.body.invoiceError });
    expect(res.body.invoiceId ?? null).toBeNull();
    const row = await bookingRow(b.bookingId);
    expect(row.status).toBe('COMPLETED');
    expect(row.invoiceId).toBeNull();
    expect(await finalInvoicesOf(b.bookingId)).toHaveLength(0);

    vi.restoreAllMocks();
    const retry = await createInvoiceRoute(b.bookingId);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    const finals = await finalInvoicesOf(b.bookingId);
    expect(finals.map((i) => money(i.total)), 'the button nets the deposit too').toEqual([75]);
    expect(retry.body).toMatchObject({ invoiceId: finals[0].id, alreadyExisted: false });
    expect((await bookingRow(b.bookingId)).invoiceId).toBe(finals[0].id);
  });

  it('S-04b SEC-V28-1: an invoice-number collision is retried; a persistent database failure answers a fixed invoiceError, never the database text', async () => {
    // CommerceService numbers invoices INV-<Date.now()> under
    // @@unique([businessId, invoiceNumber]): an invoice already holding
    // INV-<T>, and Date.now() pinned to T while an attempt builds its row,
    // is the collision two completions in one millisecond meet.
    const T = 4102444800123;
    await db.contact.create({ data: { id: `${P}c_collide`, businessId: ID.biz, firstName: 'Col', lastName: 'Lide' } });
    await db.invoice.create({ data: { id: `${P}inv_collide`, businessId: ID.biz, contactId: `${P}c_collide`, invoiceNumber: `INV-${T}`, total: 1 } });
    const real = commerce.createInvoiceForService.bind(commerce);
    // The pin is held across the awaited call: since V1-37 the invoice number is
    // drawn after an awaited currency read, so a synchronous pin had already
    // been restored when Date.now() ran and the collision never happened.
    const pinned = async (...args: unknown[]) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(T);
      try {
        return await real(...args);
      } finally {
        now.mockRestore();
      }
    };

    // The first attempt collides; the retry draws the invoice up.
    const once = await book(ID.svcDep, 's04b_once');
    vi.spyOn(commerce, 'createInvoiceForService').mockImplementationOnce(pinned);
    const ok = await setStatus(once.bookingId, 'COMPLETED');
    vi.restoreAllMocks();
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invoiceError, JSON.stringify(ok.body.invoicing)).toBeNull();
    expect(ok.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75 });
    expect((await finalInvoicesOf(once.bookingId)).map((i) => money(i.total))).toEqual([75]);

    // Every attempt collides: FAILED, with a code and a sentence that carry
    // none of Prisma's text (invocation, server path, source, columns).
    const always = await book(ID.svcDep, 's04b_always');
    vi.spyOn(commerce, 'createInvoiceForService').mockImplementation(pinned);
    const res = await setStatus(always.bookingId, 'COMPLETED');
    vi.restoreAllMocks();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.invoicing).toMatchObject({ status: 'FAILED', code: 'INVOICE_NOT_CREATED' });
    expect(res.body.invoiceErrorCode).toBe('INVOICE_NOT_CREATED');
    expect(res.body.invoiceError).toContain('its invoice could not be created');
    const answered = `${res.body.invoiceError} ${JSON.stringify(res.body.invoicing)}`;
    for (const leak of [/prisma/i, /invocation/i, /Unique constraint/i, /invoice_number/, /business_id/, /commerce\.service/, /\/home\//, /\.ts:\d+/]) {
      expect(answered, `the answer discloses ${leak}`).not.toMatch(leak);
    }
    expect((await bookingRow(always.bookingId)).status).toBe('COMPLETED');
    expect(await finalInvoicesOf(always.bookingId)).toHaveLength(0);

    // A refusal meant for the caller (a 4xx HttpException) keeps its own words, as the global filter would answer it.
    const { BadRequestException } = await import('@nestjs/common');
    const refused = await book(ID.svcDep, 's04b_refused');
    vi.spyOn(commerce, 'createInvoiceForService').mockRejectedValueOnce(new BadRequestException('v28a contact has no billing address'));
    const r = await setStatus(refused.bookingId, 'COMPLETED');
    vi.restoreAllMocks();
    expect(r.body.invoiceError).toContain('v28a contact has no billing address');
    expect(r.body.invoiceErrorCode).toBe('INVOICE_NOT_CREATED');
  });
});

describe('V1-28 Booking.paymentStatus follows the invoices (M42: no writer)', () => {
  it('S-05 RED-BEFORE: deposit PAID -> DEPOSIT_PAID, final PAID -> PAID; replays write nothing; another tenant is ignored; an older event never downgrades', async () => {
    expect(paymentStatusListener, 'BookingPaymentStatusListener exists (booking-payment-status.listener.ts)').toBeTruthy();
    const b = await book(ID.svcDep, 's05');
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');

    const depositPaid = await settle(b.depositInvoiceId!, 25);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');

    // Replay: nothing is written (updatedAt unchanged).
    const before = await bookingRow(b.bookingId);
    await paymentStatusListener.onInvoicePaid(depositPaid);
    const afterReplay = await bookingRow(b.bookingId);
    expect(afterReplay.paymentStatus).toBe('DEPOSIT_PAID');
    expect(afterReplay.updatedAt.getTime(), 'a replay writes nothing').toBe(before.updatedAt.getTime());

    // Another tenant: the same invoice under tenant B's id, or B's own copy of the payload, changes nothing here.
    const other = await book(ID.svcDep, 's05_other');
    await workflow.transition(other.depositInvoiceId!, 'SENT');
    const forged = { ...depositPaid, businessId: ID.bizB, invoice: { ...depositPaid.invoice, id: other.depositInvoiceId } };
    await paymentStatusListener.onInvoicePaid(forged);
    await paymentStatusListener.onInvoicePaid({ ...depositPaid, businessId: ID.bizB });
    expect((await bookingRow(other.bookingId)).paymentStatus, 'an unpaid invoice is not marked by an event').toBe('UNPAID');
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');

    // Final invoice paid -> PAID.
    const done = await setStatus(b.bookingId, 'COMPLETED');
    expect(done.status).toBe(201);
    const finalId = (await bookingRow(b.bookingId)).invoiceId;
    expect(finalId).toBeTruthy();
    await settle(finalId, 75);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('PAID');

    // The deposit's event delivered again, late: PAID stays PAID.
    await paymentStatusListener.onInvoicePaid(depositPaid);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('PAID');
  });

  it('S-05b RED-BEFORE: a booking-time invoice (no deposit) paid -> PAID', async () => {
    expect(paymentStatusListener, 'BookingPaymentStatusListener exists').toBeTruthy();
    const b = await book(ID.svcAtBooking, 's05b');
    expect(b.invoiceId).toBeTruthy();
    await settle(b.invoiceId!, 60);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('PAID');
  });

  it('S-05c CR-V28-1: the final invoice paid while the deposit is still owed (SENT, or DRAFT) is not PAID; the deposit paid too makes it PAID', async () => {
    for (const sendDeposit of [true, false]) {
      const label = sendDeposit ? 'deposit SENT' : 'deposit DRAFT';
      const b = await book(ID.svcDep, `s05c_${sendDeposit ? 'sent' : 'draft'}`);
      if (sendDeposit) await workflow.transition(b.depositInvoiceId!, 'SENT');
      expect((await setStatus(b.bookingId, 'COMPLETED')).status).toBe(201);
      const finalId = (await bookingRow(b.bookingId)).invoiceId;
      expect(money((await invoiceRow(finalId)).total), label).toBe(75);
      await settle(finalId, 75);
      expect((await invoiceRow(b.depositInvoiceId!)).status, label).toBe(sendDeposit ? 'SENT' : 'DRAFT');
      expect((await bookingRow(b.bookingId)).paymentStatus, `${label}: 25 of 100 is still owed`).not.toBe('PAID');
      expect((await bookingRow(b.bookingId)).paymentStatus, label).toBe('UNPAID');

      await settle(b.depositInvoiceId!, 25);
      expect((await bookingRow(b.bookingId)).paymentStatus, `${label}, then paid`).toBe('PAID');
    }
  });
});

describe('V1-28 invoice.paid confirms the booking it pays for (M42: dead hook)', () => {
  it('S-06 RED-BEFORE: a paid deposit confirms the PENDING booking through Booking.depositInvoiceId', async () => {
    const b = await book(ID.svcDep, 's06');
    expect((await bookingRow(b.bookingId)).status).toBe('PENDING');
    await settle(b.depositInvoiceId!, 25);
    expect((await bookingRow(b.bookingId)).status).toBe('CONFIRMED');
    expect(emitted.filter((e) => e.name === 'booking.confirmed' && e.payload?.booking?.id === b.bookingId)).toHaveLength(1);
  });

  it('S-06b RED-BEFORE: a paid booking-time invoice confirms the PENDING booking through invoice.booking', async () => {
    const b = await book(ID.svcAtBooking, 's06b');
    const event = await settle(b.invoiceId!, 60);
    expect(event.invoice.booking?.id, 'the relation the payload carries').toBe(b.bookingId);
    expect((await bookingRow(b.bookingId)).status).toBe('CONFIRMED');
  });

  it('S-06c CONTROL: a COMPLETED booking whose final invoice is paid stays COMPLETED; a CANCELLED booking whose deposit is paid stays CANCELLED; another tenant confirms nothing', async () => {
    const done = await book(ID.svcNoDep, 's06c_done');
    expect((await setStatus(done.bookingId, 'COMPLETED')).status).toBe(201);
    const finalId = (await bookingRow(done.bookingId)).invoiceId;
    await settle(finalId, 100);
    expect((await bookingRow(done.bookingId)).status).toBe('COMPLETED');

    const cancelled = await book(ID.svcDep, 's06c_cancel');
    expect((await setStatus(cancelled.bookingId, 'CANCELLED')).status).toBe(201);
    await settle(cancelled.depositInvoiceId!, 25);
    expect((await bookingRow(cancelled.bookingId)).status).toBe('CANCELLED');

    const pending = await book(ID.svcDep, 's06c_tenant');
    await sendAndPay(pending.depositInvoiceId!, 25);
    const [event] = paidEventsFor(pending.depositInvoiceId!);
    await flowListener.handleInvoicePaid({ ...event, businessId: ID.bizB });
    expect((await bookingRow(pending.bookingId)).status, 'an event naming another tenant confirms nothing').toBe('PENDING');
  });
});

describe('V1-28 D-26: a cancel after a paid deposit forfeits it', () => {
  // D-26 rules on a CUSTOMER cancel. The server has no customer-cancel route:
  // the operator's status route (here) records every cancel, so these cases
  // prove the forfeit on a cancel recorded there, not on a customer's own.
  it('S-07 RED-BEFORE: the forfeit is recorded on the booking; the deposit stays PAID; nothing is refunded or credited', async () => {
    const b = await book(ID.svcDep, 's07');
    await settle(b.depositInvoiceId!, 25);
    const res = await setStatus(b.bookingId, 'CANCELLED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(res.body.depositForfeit).toMatchObject({ depositInvoiceId: b.depositInvoiceId, amount: 25 });

    const row = await bookingRow(b.bookingId);
    expect(row.status).toBe('CANCELLED');
    expect(row.paymentStatus, 'the forfeit, visible on the booking').toBe('DEPOSIT_FORFEITED');
    const deposit = await invoiceRow(b.depositInvoiceId!);
    expect(deposit.status, 'nothing moves automatically').toBe('PAID');
    const payments = await db.payment.findMany({ where: { invoiceId: b.depositInvoiceId } });
    expect(payments.map((p: any) => `${p.status} ${money(p.amount)}`)).toEqual(['SUCCESSFUL 25']);
    expect(await db.creditNote.count({ where: { invoiceId: b.depositInvoiceId } })).toBe(0);
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === b.bookingId)).toHaveLength(1);

    // Cancelling again records nothing new.
    await setStatus(b.bookingId, 'CANCELLED');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === b.bookingId)).toHaveLength(1);

    // Reinstated, the deposit is held for the booking again.
    const back = await setStatus(b.bookingId, 'CONFIRMED');
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
  });

  it('S-07b CONTROL: a cancel with the deposit unpaid forfeits nothing', async () => {
    const b = await book(ID.svcDep, 's07b');
    await workflow.transition(b.depositInvoiceId!, 'SENT');
    const res = await setStatus(b.bookingId, 'CANCELLED');
    expect(res.status).toBe(201);
    expect(res.body.depositForfeit ?? null).toBeNull();
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited')).toHaveLength(0);
  });

  it('S-07c SEC-V28-3: a refunded deposit (reopened to SENT under D-14) is not money held: not restored on reinstatement, owed again on its own invoice (the final nets it once), not forfeit', async () => {
    const refundDeposit = async (depositInvoiceId: string) => {
      const payment = await db.payment.findFirst({ where: { invoiceId: depositInvoiceId, status: 'SUCCESSFUL' } });
      await commerce.markPaymentRefunded(payment.id, ID.biz, 'goodwill', ID.owner);
      // D-14 (V1-29): a fully refunded invoice returns to SENT with paidAt cleared.
      const refunded = await invoiceRow(depositInvoiceId);
      expect(refunded.status, 'a full refund reopens the deposit invoice (D-14)').toBe('SENT');
      expect(refunded.paidAt).toBeNull();
    };

    // Forfeited, then refunded by hand (D-26), then reinstated and completed.
    const b = await book(ID.svcDep, 's07c');
    await settle(b.depositInvoiceId!, 25);
    expect((await setStatus(b.bookingId, 'CANCELLED')).body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    await refundDeposit(b.depositInvoiceId!);
    const back = await setStatus(b.bookingId, 'CONFIRMED');
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await bookingRow(b.bookingId)).paymentStatus, 'nothing is held for the booking').toBe('UNPAID');
    const done = await setStatus(b.bookingId, 'COMPLETED');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    // D-14: the fully refunded deposit invoice is open again (SENT) and owed on
    // its own invoice, so the final invoice nets it and the two together bill
    // the price once: 25 (reopened deposit) + 75 (final) = 100. Nothing held
    // is counted, nothing is forfeit, and nothing is billed twice.
    expect((await finalInvoicesOf(b.bookingId)).map((i) => money(i.total)), 'the final nets the reopened deposit').toEqual([75]);
    expect(done.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75, depositAmount: 25, depositInvoiceId: b.depositInvoiceId });
    const reopened = await invoiceRow(b.depositInvoiceId!);
    expect(reopened.status).toBe('SENT');
    expect(money(reopened.total) + 75, 'deposit + final == price').toBe(100);

    // Refunded before the cancel: there is nothing to forfeit.
    const early = await book(ID.svcDep, 's07c_early');
    await settle(early.depositInvoiceId!, 25);
    await refundDeposit(early.depositInvoiceId!);
    const cancel = await setStatus(early.bookingId, 'CANCELLED');
    expect(cancel.status).toBe(201);
    expect(cancel.body.depositForfeit ?? null).toBeNull();
    expect((await bookingRow(early.bookingId)).paymentStatus).not.toBe('DEPOSIT_FORFEITED');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === early.bookingId)).toHaveLength(0);
  });

  it('S-07e F1/REG-3: a deposit part-refunded under D-14 (PARTIALLY_PAID, net 15) forfeits the 15 it holds; a part payment on an owed deposit forfeits nothing', async () => {
    const b = await book(ID.svcDep, 's07e');
    await sendAndPay(b.depositInvoiceId!, 15);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await settle(b.depositInvoiceId!, 10);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    const ten = await db.payment.findFirst({ where: { invoiceId: b.depositInvoiceId, status: 'SUCCESSFUL', amount: 10 } });
    await commerce.markPaymentRefunded(ten.id, ID.biz, 'goodwill', ID.owner);
    expect((await invoiceRow(b.depositInvoiceId!)).status, 'a partial refund reopens the deposit (D-14)').toBe('PARTIALLY_PAID');

    const res = await setStatus(b.bookingId, 'CANCELLED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(res.body.depositForfeit).toMatchObject({ depositInvoiceId: b.depositInvoiceId, amount: 15 });
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_FORFEITED');
    const rows = contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === b.bookingId);
    expect(rows.map((e) => e.data.amount)).toEqual([15]);
    // Nothing moves automatically (D-26): the deposit keeps its status and rows.
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    const payments = await db.payment.findMany({ where: { invoiceId: b.depositInvoiceId }, orderBy: { createdAt: 'asc' } });
    expect(payments.map((p: any) => `${p.status} ${money(p.amount)}`)).toEqual(['SUCCESSFUL 15', 'SUCCESSFUL 10', 'REFUNDED -10']);

    // CONTROL: a part payment on a deposit still owed, never refunded, is not held for the booking.
    const owed = await book(ID.svcDep, 's07e_owed');
    await sendAndPay(owed.depositInvoiceId!, 10);
    expect((await invoiceRow(owed.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    const cancel = await setStatus(owed.bookingId, 'CANCELLED');
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(cancel.body.depositForfeit ?? null).toBeNull();
    expect((await bookingRow(owed.bookingId)).paymentStatus).toBe('UNPAID');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === owed.bookingId)).toHaveLength(0);
  });

  it('S-07d SEC-V28-2: the forfeit row names the member who cancelled; a call with no member (KEY tool, undo, compensation) is SYSTEM', async () => {
    const viaRoute = await book(ID.svcDep, 's07d_route');
    await settle(viaRoute.depositInvoiceId!, 25);
    expect((await setStatus(viaRoute.bookingId, 'CANCELLED')).status).toBe(201);
    const [byOwner] = contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === viaRoute.bookingId);
    expect(byOwner).toMatchObject({ actorType: 'USER', actorId: ID.owner });

    // As flow-orchestrator's bookings_cancel_booking, undo and compensation call it.
    const direct = await book(ID.svcDep, 's07d_direct');
    await settle(direct.depositInvoiceId!, 25);
    await bookingsService.updateBookingStatus(ID.biz, direct.bookingId, 'CANCELLED');
    const [bySystem] = contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === direct.bookingId);
    expect(bySystem).toMatchObject({ actorType: 'SYSTEM' });
    expect((bySystem as any).actorId).toBeUndefined();
  });

  it.todo(
    'CR-V28-4: a cancel the BUSINESS initiates (operator, KEY bookings_cancel_booking, undo, saga compensation) forfeits nothing; ' +
      'needs a cancel-initiator input on the status route (bookings.controller.ts) and its callers, all outside the V1-28 write set',
  );
});

describe('V1-28 the confirmation pages link the token receipt (D-07)', () => {
  it('S-08 RED-BEFORE: the public create answers the customer\'s token link for its invoice', async () => {
    const dep = await book(ID.svcDep, 's08_dep');
    expect(typeof dep.depositInvoiceUrl, 'the answer carries the deposit invoice link').toBe('string');
    expect(dep.depositInvoiceUrl, 'deposit invoice link').toMatch(/\/public\/invoice\/[A-Za-z0-9_-]{20,}$/);
    const depToken = dep.depositInvoiceUrl!.split('/public/invoice/')[1];
    const depLink = await db.paymentLink.findUnique({ where: { token: depToken } });
    expect(depLink).toMatchObject({ invoiceId: dep.depositInvoiceId, businessId: ID.biz, active: true });

    const full = await book(ID.svcAtBooking, 's08_full');
    expect(full.invoiceUrl, 'booking-time invoice link').toMatch(/\/public\/invoice\/[A-Za-z0-9_-]{20,}$/);
    const fullLink = await db.paymentLink.findUnique({ where: { token: full.invoiceUrl!.split('/public/invoice/')[1] } });
    expect(fullLink).toMatchObject({ invoiceId: full.invoiceId, businessId: ID.biz });

    const free = await book(ID.svcNoDep, 's08_none');
    expect(free.invoiceUrl ?? null).toBeNull();
    expect(free.depositInvoiceUrl ?? null).toBeNull();
  });

  // A SOURCE check (CR-V28-3): it proves what these two files contain, not
  // what a customer sees. The storefront page that renders OrderConfirmation
  // does not pass invoiceUrl yet (todo below), so there the button is hidden.
  it('S-08b RED-BEFORE (source check): neither confirmation page opens the authenticated receipt; each opens only an invoiceUrl token link', () => {
    for (const [name, file] of Object.entries(WEB_PAGES)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(/commerce\/invoices\/\$\{[^}]+\}\/receipt/.test(src), `${name} opens /commerce/invoices/:id/receipt (401 for a customer)`).toBe(false);
      expect(/invoiceUrl/.test(src), `${name} reads the token link (invoiceUrl)`).toBe(true);
    }
    // public/book reads the link from the create answer itself.
    expect(fs.readFileSync(WEB_PAGES.publicBook, 'utf8')).toMatch(/data\?\.invoiceUrl \?\? data\?\.depositInvoiceUrl/);
  });

  it.todo(
    "CR-V28-3: the storefront /book/[slug] passes the create answer's invoiceUrl / depositInvoiceUrl into bookingResults, so its " +
      'confirmation shows the token invoice button; book/[slug]/page.tsx is outside the V1-28 write set (it pushes only {bookingId, invoiceId})',
  );
});

describe('V1-28 LEDGER', () => {
  it('L-01 RED-BEFORE: the deposit and final postings sum to the service price (revenue and cash), each balanced', async () => {
    const b = await book(ID.svcDep, 'l01');
    await settle(b.depositInvoiceId!, 25);
    expect((await setStatus(b.bookingId, 'COMPLETED')).status).toBe(201);
    const finalId = (await bookingRow(b.bookingId)).invoiceId;
    const final = await invoiceRow(finalId);
    await settle(finalId, Number(final.total));

    const invoiceIds = [b.depositInvoiceId!, finalId];
    const recognised = await db.financialTransaction.findMany({
      where: { businessId: ID.biz, sourceType: 'Invoice', sourceId: { in: invoiceIds } },
      include: { entries: { include: { account: true } } },
    });
    expect(recognised).toHaveLength(2);
    const revenue = recognised
      .flatMap((t: any) => t.entries)
      .filter((e: any) => String(e.account?.systemKey ?? '').startsWith('REVENUE'))
      .reduce((s: number, e: any) => s + Number(e.credit) - Number(e.debit), 0);
    expect(money(revenue), 'revenue recognised for the booking == price').toBe(100);

    const paymentIds = (await db.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } })).map((p: any) => p.id);
    const cash = await db.financialTransaction.findMany({
      where: { businessId: ID.biz, sourceType: 'Payment', sourceId: { in: paymentIds } },
      include: { entries: { include: { account: true } } },
    });
    const received = cash
      .flatMap((t: any) => t.entries)
      .filter((e: any) => ['CASH', 'BANK', 'PAYMENT_PROCESSOR'].includes(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit) - Number(e.credit), 0);
    expect(money(received), 'cash received for the booking == price').toBe(100);

    for (const t of [...recognised, ...cash]) {
      const d = t.entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
      const c = t.entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
      expect(money(d), `${t.externalRef}: debits = credits`).toBe(money(c));
    }
  });

  it('L-02 CONTROL: every FinancialTransaction of both tenants balances (debits = credits)', async () => {
    const txns = await db.financialTransaction.findMany({
      where: { businessId: { in: [ID.biz, ID.bizB] } },
      include: { entries: true },
    });
    expect(txns.length).toBeGreaterThan(0);
    for (const t of txns) {
      const d = t.entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
      const c = t.entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
      expect(money(d), `${t.externalRef}: debits = credits`).toBe(money(c));
    }
  });
});
