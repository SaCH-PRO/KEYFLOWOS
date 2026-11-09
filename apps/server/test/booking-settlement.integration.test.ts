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
 *   S-04b SEC-V28-1  an invoice-number collision is retried; a persistent database failure answers
 *                    the fixed sentence, never Prisma's text, paths or column names (aligned by V1-43:
 *                    the retry is the allocator's P2002 retry, met through a real held collision)
 *   S-05c CR-V28-1   the final paid while the deposit is still owed (SENT or DRAFT) is not PAID
 *   S-07c SEC-V28-3  a refunded deposit (reopened to SENT under D-14) forfeits nothing, is not
 *                    restored as DEPOSIT_PAID on reinstatement, and is owed again on its own invoice
 *   S-07d SEC-V28-2  the forfeit row names the member who cancelled; a call with no member is SYSTEM
 *
 * Trial-I integration review (V1-28 with the D-14 refund convention), red at b1852b46:
 *   S-07e F1/REG-3   a deposit part-refunded under D-14 (reopened to PARTIALLY_PAID, net 15)
 *                    forfeits the 15 it still holds on a cancel; CONTROL: a part payment on a
 *                    deposit still owed (never refunded) holds nothing and forfeits nothing
 *
 * Trial-N integration review (deposit: V1-28 x D-14), red at 42190801:
 *   S-09  N1-SEC  a payment row tagged with another business on the deposit invoice is not the
 *                 deposit's money (M31): it neither makes an owed deposit forfeit nor erases what a
 *                 paid one holds (the cancel forfeits 25; the final nets 25)
 *   S-10  N2-SEC  a cancel racing another status write: the forfeit lands only on a booking that is
 *                 still CANCELLED, and a booking written back to a live status from a forfeit takes
 *                 the status its invoices state (from the row as written), so it is never live with
 *                 DEPOSIT_FORFEITED and still reaches PAID
 *   S-11  N3-SEC/N2-CR  a D-14 refund that moves an invoice (invoice.reopened, invoice.payment_recorded)
 *                 re-derives Booking.paymentStatus, backwards too; a forfeit (D-26) is never overwritten
 *   S-12  N4-SEC  a refund on a deposit never settled (part paid) does not make it hold money
 *   S-13  N1-CR   a deposit paid then part-credited (D-28 PARTIALLY_CREDITED) is not owed: the paid
 *                 final makes the booking PAID
 *
 * Trial-N repair round 2 (deposit recheck), red at f5bbd543:
 *   S-14  RC-DEP-1  refund and repayment churn never makes a part payment held: a deposit holds money
 *                 only once paid in full since it last stood at nothing received (D-14 reopens a
 *                 fully refunded one to SENT, owed afresh); a cancel forfeits nothing
 *   S-15  RC-DEP-2  the invoice reconcile, InvoiceWorkflowService.getBalance and mark-paid read the
 *                 invoice's own-tenant payment rows (M31): a foreign row neither settles a deposit
 *                 (then forfeit through its PAID status) nor reopens one, nor stands in for the
 *                 money mark-paid records
 *   S-16  RC-DEP-3  a re-derivation racing a payment or refund leaves the booking as its invoices
 *                 state it: the listener reads and writes under the booking row lock
 *
 * Trial-N repair round 2 (deposit recheck, still open after round 1), red at f161dd85:
 *   S-17  F1  the customer's pay page intent (recordPublicPaymentIntent) decides refuse (409) and cap
 *             from the deposit's own-tenant payment rows: a row of another business neither answers
 *             'already paid' nor shrinks or inflates the amount it records
 *   S-18  F3  a refund of the deposit never lands between the forfeit's read of the deposit and its
 *             write: one in flight when the cancel decides is seen (no forfeit, UNPAID); S-18b: one
 *             issued right after that read waits for the forfeit (which then stands, D-26)
 *   S-19  F4  a refund landing right after the reinstatement's read of the deposit is not lost: the
 *             booking brought back from a forfeit ends UNPAID, not DEPOSIT_PAID with nothing held
 *   TODO  CR-V28-3   the storefront passes the token link into the confirmation (book/[slug]/page.tsx)
 *
 * V1-84 (FOLLOW3-D18-CANCEL-INITIATOR, CR-V28-4, D-65): the cancel says who cancelled; only a
 * customer cancel forfeits a paid deposit. Red at the FOLLOW3-A10 head:
 *   CI-01  a direct updateBookingStatus(..., 'CANCELLED') (KEY bookings_cancel_booking, undo, saga
 *          compensation, the cortex adapter) is business-initiated: nothing forfeit, DEPOSIT_PAID kept
 *   CI-01b CONTROL (source check) those four callers cancel with three arguments (the default)
 *   CI-02  the route with cancelledBy BUSINESS forfeits nothing
 *   CI-03  cancelledBy CUSTOMER forfeits as S-07 and S-07e (25, or 15 part-refunded), naming the member
 *   CI-04  any other cancelledBy answers 400 and writes nothing (route and direct call)
 *   CI-05  CONTROL: the route with no cancelledBy is a customer cancel (D-65), as today
 *   S-07d  a direct call now forfeits nothing (was: forfeit, actor SYSTEM); a direct CUSTOMER cancel
 *          names SYSTEM; the route half sends CUSTOMER. S-07, S-07c, S-07e send CUSTOMER; S-10's
 *          in-race direct cancel names CUSTOMER.
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
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
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

/**
 * The operator's status route. `extra` carries the rest of the body, the
 * cancel's initiator (V1-84, `cancelledBy`) among it; a case that sends none
 * is an operator cancel without one (D-65: a customer cancel).
 */
function setStatus(bookingId: string, status: string, extra: Record<string, unknown> = {}) {
  return agent()
    .post(`/bookings/businesses/${ID.biz}/bookings/${bookingId}/status`)
    .set(HEADER, ID.owner)
    .send({ status, ...extra });
}
const CUSTOMER_CANCEL = { cancelledBy: 'CUSTOMER' };

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

/**
 * Hand every emitted event of these names for this invoice to the real
 * BookingPaymentStatusListener's handlers that subscribe to it (@OnEvent
 * metadata), as the bus would. A name no handler subscribes to reaches nothing.
 */
async function deliverToPaymentStatusListener(invoiceId: string, names: string[]) {
  const proto = Object.getPrototypeOf(paymentStatusListener);
  const handlers = Object.getOwnPropertyNames(proto)
    .map((key) => ({ key, events: ((Reflect.getMetadata(EVENT_LISTENER_METADATA, proto[key]) ?? []) as Array<{ event: string }>).map((m) => m.event) }))
    .filter((h) => h.events.length > 0);
  for (const e of emitted.filter((x) => names.includes(x.name) && x.payload?.invoice?.id === invoiceId)) {
    for (const h of handlers.filter((x) => x.events.includes(e.name))) await paymentStatusListener[h.key](e.payload);
  }
}

/** A refund that moves an invoice (D-14) emits invoice.reopened (to SENT) or invoice.payment_recorded (to PARTIALLY_PAID). */
const REFUND_MOVES = ['invoice.reopened', 'invoice.payment_recorded'];

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
  // V1-84 adds the status route's body DTO; before it the route read
  // @Body('status') alone (a string, which the ValidationPipe skips).
  const statusDtoMod: any = await import('../src/modules/bookings/dto/update-booking-status.dto').catch(() => null);

  // The create handlers' parameter types as tsc emits them for the production
  // build (emitDecoratorMetadata), which vitest's esbuild transform does not.
  Reflect.defineMetadata('design:paramtypes', [String, CreateBookingDto, Object], BookingsController.prototype, 'createBooking');
  Reflect.defineMetadata('design:paramtypes', [String, PublicCreateBookingDto], BookingsController.prototype, 'publicCreateBooking');
  if (statusDtoMod?.UpdateBookingStatusDto) {
    Reflect.defineMetadata('design:paramtypes', [String, String, statusDtoMod.UpdateBookingStatusDto], BookingsController.prototype, 'updateBookingStatus');
  }

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
    // V1-43 (D-15): CommerceService draws the business's next number
    // (allocateDocumentNumber) under @@unique([businessId, invoiceNumber]) and
    // retries a collision itself (the retry that lived in issueFinalInvoice).
    // The collision is a real one: another connection inserts the number the
    // completion will draw and holds it uncommitted, so the completion's
    // insert waits on the unique index; once it commits, that insert fails
    // with P2002 and the allocator redraws the following number.
    const { allocateDocumentNumber } = await import('../src/modules/commerce/document-number');
    await db.contact.create({ data: { id: `${P}c_collide`, businessId: ID.biz, firstName: 'Col', lastName: 'Lide' } });

    // The first attempt collides; the retry draws the invoice up.
    const once = await book(ID.svcDep, 's04b_once');
    const held = await allocateDocumentNumber(db, ID.biz, 'invoice');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let inserted!: () => void;
    const ready = new Promise<void>((r) => { inserted = r; });
    const holder = db.$transaction(async (tx: any) => {
      await tx.invoice.create({ data: { id: `${P}inv_collide`, businessId: ID.biz, contactId: `${P}c_collide`, invoiceNumber: held, total: 1 } });
      inserted();
      await gate;
    }, { timeout: 60_000, maxWait: 10_000 });
    await Promise.race([ready, holder]);
    const pending = setStatus(once.bookingId, 'COMPLETED').then((r) => r);
    let blocked = false;
    try {
      for (const until = Date.now() + 5000; !blocked && Date.now() < until; ) {
        const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND starts_with(query, 'INSERT INTO "public"."invoices"')`,
        );
        blocked = rows[0].n > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      release();
      await holder;
    }
    const ok = await pending;
    expect(blocked, `the completion drew ${held} and waited on the unique index`).toBe(true);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invoiceError, JSON.stringify(ok.body.invoicing)).toBeNull();
    expect(ok.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75 });
    const finals = await finalInvoicesOf(once.bookingId);
    expect(finals.map((i) => money(i.total))).toEqual([75]);
    const following = `INV-${String(Number(held.slice(4)) + 1).padStart(4, '0')}`;
    expect(finals[0].invoiceNumber, 'the retry drew the following number').toBe(following);
    expect(ok.body.invoicing.invoiceNumber).toBe(following);

    // Every attempt collides: FAILED, with a code and a sentence that carry
    // none of Prisma's text (invocation, server path, source, columns). The
    // failure is Prisma's own P2002 from a real duplicate insert.
    let collision: unknown;
    try {
      await db.invoice.create({ data: { businessId: ID.biz, contactId: `${P}c_collide`, invoiceNumber: held, total: 1 } });
    } catch (err) {
      collision = err;
    }
    expect((collision as { code?: string } | undefined)?.code).toBe('P2002');
    const always = await book(ID.svcDep, 's04b_always');
    vi.spyOn(commerce, 'createInvoiceForService').mockRejectedValue(collision);
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
  // V1-84 (CR-V28-4, D-65): the route says who cancelled (cancelledBy), and
  // these cases send CUSTOMER; CI-01..CI-05 below prove the initiator.
  it('S-07 RED-BEFORE: the forfeit is recorded on the booking; the deposit stays PAID; nothing is refunded or credited', async () => {
    const b = await book(ID.svcDep, 's07');
    await settle(b.depositInvoiceId!, 25);
    const res = await setStatus(b.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
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
    await setStatus(b.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
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
    expect((await setStatus(b.bookingId, 'CANCELLED', CUSTOMER_CANCEL)).body.paymentStatus).toBe('DEPOSIT_FORFEITED');
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
    const cancel = await setStatus(early.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
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

    const res = await setStatus(b.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
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
    const cancel = await setStatus(owed.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(cancel.body.depositForfeit ?? null).toBeNull();
    expect((await bookingRow(owed.bookingId)).paymentStatus).toBe('UNPAID');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === owed.bookingId)).toHaveLength(0);
  });

  it('S-07d SEC-V28-2: the forfeit row names the member who cancelled; a direct call (KEY tool, undo, compensation) forfeits nothing (V1-84, D-65); a customer cancel with no member is SYSTEM', async () => {
    const viaRoute = await book(ID.svcDep, 's07d_route');
    await settle(viaRoute.depositInvoiceId!, 25);
    expect((await setStatus(viaRoute.bookingId, 'CANCELLED', CUSTOMER_CANCEL)).status).toBe(201);
    const [byOwner] = contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === viaRoute.bookingId);
    expect(byOwner).toMatchObject({ actorType: 'USER', actorId: ID.owner });

    // As flow-orchestrator's bookings_cancel_booking, undo and compensation call
    // it: a business-initiated cancel (D-65), so nothing is forfeit. Before
    // V1-84 this forfeit the 25 with actor SYSTEM (the defect CR-V28-4 named).
    const direct = await book(ID.svcDep, 's07d_direct');
    await settle(direct.depositInvoiceId!, 25);
    await bookingsService.updateBookingStatus(ID.biz, direct.bookingId, 'CANCELLED');
    expect(contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === direct.bookingId)).toHaveLength(0);
    expect((await bookingRow(direct.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');

    // A customer cancel recorded with no member's request behind it names SYSTEM, never a USER with no actor.
    const noMember = await book(ID.svcDep, 's07d_system');
    await settle(noMember.depositInvoiceId!, 25);
    await bookingsService.updateBookingStatus(ID.biz, noMember.bookingId, 'CANCELLED', 'CUSTOMER');
    const [bySystem] = contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === noMember.bookingId);
    expect(bySystem).toMatchObject({ actorType: 'SYSTEM' });
    expect((bySystem as any).actorId).toBeUndefined();
  });
});

describe('V1-84 CR-V28-4 / D-65: who cancelled decides the forfeit (only a customer cancel forfeits a paid deposit)', () => {
  const forfeitRows = (bookingId: string) => contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === bookingId);
  const cancelRows = (bookingId: string) => contactEvents.filter((e) => e.type === 'booking.cancelled' && e.data?.bookingId === bookingId);

  /** A booking whose 25 deposit is paid: CONFIRMED and DEPOSIT_PAID. */
  async function paidBooking(who: string) {
    const b = await book(ID.svcDep, who);
    await settle(b.depositInvoiceId!, 25);
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'DEPOSIT_PAID' });
    return b;
  }

  /** Cancelled, nothing forfeit: still DEPOSIT_PAID, no forfeit row, and the deposit, its payment rows and credit notes as paid (nothing moves, D-26). */
  async function expectCancelledNotForfeit(b: { bookingId: string; depositInvoiceId?: string }) {
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'DEPOSIT_PAID' });
    expect(forfeitRows(b.bookingId), 'no booking.deposit_forfeited row').toHaveLength(0);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PAID');
    const payments = await db.payment.findMany({ where: { invoiceId: b.depositInvoiceId } });
    expect(payments.map((p: any) => `${p.status} ${money(p.amount)}`)).toEqual(['SUCCESSFUL 25']);
    expect(await db.creditNote.count({ where: { invoiceId: b.depositInvoiceId } })).toBe(0);
  }

  it('CI-01 RED-BEFORE: a direct cancel (KEY bookings_cancel_booking, undo, saga compensation, the cortex adapter) is business-initiated: a paid deposit is not forfeit', async () => {
    const b = await paidBooking('ci01');
    const res = await bookingsService.updateBookingStatus(ID.biz, b.bookingId, 'CANCELLED');
    expect(res.status).toBe('CANCELLED');
    expect(res.paymentStatus).toBe('DEPOSIT_PAID');
    expect(res.depositForfeit ?? null).toBeNull();
    await expectCancelledNotForfeit(b);
    // The cancel itself is on the contact's timeline, saying who cancelled.
    expect(cancelRows(b.bookingId).map((e) => e.data)).toEqual([expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'BUSINESS' })]);

    // The same with the initiator named.
    const named = await paidBooking('ci01_named');
    await bookingsService.updateBookingStatus(ID.biz, named.bookingId, 'CANCELLED', 'BUSINESS');
    await expectCancelledNotForfeit(named);

    // Brought back, the deposit is still held for the booking, and the final invoice nets it: 75.
    const back = await setStatus(b.bookingId, 'CONFIRMED');
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    const done = await setStatus(b.bookingId, 'COMPLETED');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75, depositAmount: 25, depositInvoiceId: b.depositInvoiceId });
  });

  it('CI-01b CONTROL (source check): KEY bookings_cancel_booking, undo, saga compensation and the cortex adapter cancel through the service default (three arguments, no initiator)', () => {
    const SRC = path.resolve(__dirname, '../src/modules');
    const callers: Record<string, number> = {
      'ai/flow-orchestrator.service.ts': 1,
      'ai/undo.service.ts': 1,
      'key-cortex/key-cortex-compensation.service.ts': 2,
      'key-cortex/adapters/bookings-adapter.service.ts': 1,
    };
    const CALL = 'updateBookingStatus(';
    for (const [file, expected] of Object.entries(callers)) {
      const text = fs.readFileSync(path.join(SRC, file), 'utf8');
      const cancels: string[][] = [];
      for (let at = text.indexOf(CALL); at >= 0; at = text.indexOf(CALL, at + 1)) {
        // The call's argument list, split on its top-level commas.
        let depth = 0;
        let arg = '';
        const args: string[] = [];
        for (let i = at + CALL.length; i < text.length; i++) {
          const ch = text[i];
          if (ch === ')' && depth === 0) break;
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          if (ch === ')' || ch === ']' || ch === '}') depth--;
          if (ch === ',' && depth === 0) {
            args.push(arg.trim());
            arg = '';
          } else arg += ch;
        }
        if (arg.trim()) args.push(arg.trim());
        if (args.some((a) => /CANCELLED/.test(a))) cancels.push(args);
      }
      expect(cancels.length, `${file}: CANCELLED calls`).toBe(expected);
      for (const args of cancels) expect(args, `${file}: ${args.join(', ')}`).toHaveLength(3);
    }
  });

  it('CI-02 RED-BEFORE: the operator route with cancelledBy BUSINESS forfeits nothing', async () => {
    const b = await paidBooking('ci02');
    const res = await setStatus(b.bookingId, 'CANCELLED', { cancelledBy: 'BUSINESS' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.paymentStatus).toBe('DEPOSIT_PAID');
    expect(res.body.depositForfeit ?? null).toBeNull();
    await expectCancelledNotForfeit(b);
    expect(cancelRows(b.bookingId).map((e) => e.data)).toEqual([expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'BUSINESS' })]);

    // Cancelling again as the business still forfeits nothing.
    expect((await setStatus(b.bookingId, 'CANCELLED', { cancelledBy: 'BUSINESS' })).status).toBe(201);
    await expectCancelledNotForfeit(b);
  });

  it('CI-03: cancelledBy CUSTOMER forfeits what the deposit holds (25; 15 once part-refunded under D-14), naming the member who recorded it', async () => {
    const full = await paidBooking('ci03');
    const r1 = await setStatus(full.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(r1.body.depositForfeit).toMatchObject({ depositInvoiceId: full.depositInvoiceId, amount: 25 });
    expect((await bookingRow(full.bookingId)).paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(forfeitRows(full.bookingId)).toEqual([
      expect.objectContaining({ actorType: 'USER', actorId: ID.owner, data: expect.objectContaining({ depositInvoiceId: full.depositInvoiceId, amount: 25 }) }),
    ]);
    expect(cancelRows(full.bookingId).map((e) => e.data)).toEqual([expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'CUSTOMER' })]);
    // Nothing moves (D-26).
    expect((await invoiceRow(full.depositInvoiceId!)).status).toBe('PAID');
    expect(await db.creditNote.count({ where: { invoiceId: full.depositInvoiceId } })).toBe(0);

    const part = await book(ID.svcDep, 'ci03_part');
    await sendAndPay(part.depositInvoiceId!, 15);
    await settle(part.depositInvoiceId!, 10);
    const ten = await db.payment.findFirst({ where: { invoiceId: part.depositInvoiceId, status: 'SUCCESSFUL', amount: 10 } });
    await commerce.markPaymentRefunded(ten.id, ID.biz, 'goodwill', ID.owner);
    expect((await invoiceRow(part.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    const r2 = await setStatus(part.bookingId, 'CANCELLED', CUSTOMER_CANCEL);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(r2.body.depositForfeit).toMatchObject({ depositInvoiceId: part.depositInvoiceId, amount: 15 });
    expect(forfeitRows(part.bookingId)).toEqual([
      expect.objectContaining({ actorType: 'USER', actorId: ID.owner, data: expect.objectContaining({ amount: 15 }) }),
    ]);
  });

  it('CI-04 RED-BEFORE: an initiator other than CUSTOMER or BUSINESS answers 400 and writes nothing (route and direct call)', async () => {
    const b = await paidBooking('ci04');
    for (const cancelledBy of ['OTHER', 'customer', 'SYSTEM', '', 7, ['CUSTOMER']]) {
      const res = await setStatus(b.bookingId, 'CANCELLED', { cancelledBy });
      expect(res.status, `cancelledBy ${JSON.stringify(cancelledBy)}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    // Not a cancel either: the body is refused whole.
    const notCancel = await setStatus(b.bookingId, 'COMPLETED', { cancelledBy: 'OTHER' });
    expect(notCancel.status, JSON.stringify(notCancel.body)).toBe(400);
    await expect(bookingsService.updateBookingStatus(ID.biz, b.bookingId, 'CANCELLED', 'OTHER')).rejects.toMatchObject({ status: 400 });

    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'DEPOSIT_PAID' });
    expect(forfeitRows(b.bookingId)).toHaveLength(0);
    expect(cancelRows(b.bookingId)).toHaveLength(0);
    expect(await finalInvoicesOf(b.bookingId), 'no completion invoice').toHaveLength(0);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PAID');
  });

  it('CI-05 CONTROL (D-65): the operator route without an initiator is a customer cancel: the paid deposit is forfeit, as today, naming the member', async () => {
    const b = await paidBooking('ci05');
    const res = await setStatus(b.bookingId, 'CANCELLED');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(res.body.depositForfeit).toMatchObject({ depositInvoiceId: b.depositInvoiceId, amount: 25 });
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(forfeitRows(b.bookingId)).toEqual([expect.objectContaining({ actorType: 'USER', actorId: ID.owner, data: expect.objectContaining({ amount: 25 }) })]);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PAID');
  });
});

describe('Trial-N integration review: the deposit rule under D-14 (V1-28 x V1-29)', () => {
  const forfeitRowsOf = (bookingId: string) => contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === bookingId);
  /** A payment row tagged with ANOTHER business on an invoice of this one: Payment has no FK to Business (M31). No known writer does this today. */
  let foreignSeq = 0;
  const foreignRow = (invoiceId: string, amount: number, status: string) =>
    db.payment.create({
      data: { amount, currency: 'TTD', status, provider: 'cash', method: 'cash', providerPaymentId: `${P}foreign_${++foreignSeq}`, businessId: ID.bizB, invoiceId },
    });
  const refundSuccessful = async (invoiceId: string, amount?: number) => {
    const payment = await db.payment.findFirst({ where: { invoiceId, businessId: ID.biz, status: 'SUCCESSFUL', ...(amount === undefined ? {} : { amount }) } });
    return commerce.markPaymentRefunded(payment.id, ID.biz, 'goodwill', ID.owner);
  };

  it('S-09 N1-SEC: a payment row of another business on the deposit invoice is not its money: no forfeit on an owed deposit; a paid one still forfeits and nets its 25', async () => {
    // An owed deposit (SENT) carrying another tenant's SUCCESSFUL 25: nothing is held, nothing is forfeit.
    const owed = await book(ID.svcDep, 's09_owed');
    await workflow.transition(owed.depositInvoiceId!, 'SENT');
    await foreignRow(owed.depositInvoiceId!, 25, 'SUCCESSFUL');
    const c1 = await setStatus(owed.bookingId, 'CANCELLED');
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.depositForfeit ?? null, "another tenant's row is not a paid deposit").toBeNull();
    expect((await bookingRow(owed.bookingId)).paymentStatus).toBe('UNPAID');
    expect(forfeitRowsOf(owed.bookingId)).toHaveLength(0);

    // A paid deposit carrying another tenant's negative REFUNDED 25: it still holds its 25.
    const paid = await book(ID.svcDep, 's09_paid');
    await settle(paid.depositInvoiceId!, 25);
    await foreignRow(paid.depositInvoiceId!, -25, 'REFUNDED');
    const c2 = await setStatus(paid.bookingId, 'CANCELLED');
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
    expect(c2.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(c2.body.depositForfeit).toMatchObject({ depositInvoiceId: paid.depositInvoiceId, amount: 25 });
    expect(forfeitRowsOf(paid.bookingId).map((e) => e.data.amount)).toEqual([25]);

    // ...and the final invoice nets it: 75, not 100.
    const done = await book(ID.svcDep, 's09_done');
    await settle(done.depositInvoiceId!, 25);
    await foreignRow(done.depositInvoiceId!, -25, 'REFUNDED');
    const r = await setStatus(done.bookingId, 'COMPLETED');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.invoicing).toMatchObject({ status: 'CREATED', amount: 75, depositAmount: 25, depositInvoiceId: done.depositInvoiceId });
    expect((await finalInvoicesOf(done.bookingId)).map((i) => money(i.total))).toEqual([75]);
  });

  it('S-10 N2-SEC: a cancel racing another status write never leaves a live booking DEPOSIT_FORFEITED, and the booking still reaches PAID', async () => {
    const svc = bookingsService as any;
    // (a) A cancel commits (status, then forfeit) between a PENDING write's read and its write.
    const b = await book(ID.svcDep, 's10');
    await settle(b.depositInvoiceId!, 25);
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'DEPOSIT_PAID' });
    const writeBookingStatus = svc.writeBookingStatus;
    let raced = false;
    vi.spyOn(svc, 'writeBookingStatus').mockImplementation(async (...args: any[]) => {
      if (!raced && args[1] === 'PENDING') {
        raced = true;
        // A customer cancel: a direct call names it (V1-84); with none it is the business's, which forfeits nothing.
        const cancel = await svc.updateBookingStatus(ID.biz, b.bookingId, 'CANCELLED', 'CUSTOMER');
        expect(cancel.paymentStatus, 'the cancel in between forfeits the deposit').toBe('DEPOSIT_FORFEITED');
      }
      return writeBookingStatus.apply(svc, args);
    });
    const back = await setStatus(b.bookingId, 'PENDING');
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(raced).toBe(true);
    vi.restoreAllMocks();
    expect(back.body.paymentStatus, 'written back to a live status, it takes what its invoices state').toBe('DEPOSIT_PAID');
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'PENDING', paymentStatus: 'DEPOSIT_PAID' });
    expect((await setStatus(b.bookingId, 'COMPLETED')).status).toBe(201);
    const finalId = (await bookingRow(b.bookingId)).invoiceId;
    expect(money((await invoiceRow(finalId)).total)).toBe(75);
    await settle(finalId, 75);
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID' });

    // (b) A reinstatement commits between a cancel's status write and its forfeit: nothing is forfeit on the live booking.
    const c = await book(ID.svcDep, 's10_rev');
    await settle(c.depositInvoiceId!, 25);
    const forfeitPaidDeposit = svc.forfeitPaidDeposit;
    vi.spyOn(svc, 'forfeitPaidDeposit').mockImplementationOnce(async (...args: any[]) => {
      const reinstated = await svc.updateBookingStatus(ID.biz, c.bookingId, 'CONFIRMED');
      expect(reinstated.status).toBe('CONFIRMED');
      return forfeitPaidDeposit.apply(svc, args);
    });
    const cancel = await setStatus(c.bookingId, 'CANCELLED');
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    vi.restoreAllMocks();
    expect(cancel.body.depositForfeit ?? null, 'the booking was live again when the forfeit was due').toBeNull();
    expect(await bookingRow(c.bookingId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'DEPOSIT_PAID' });
    expect(forfeitRowsOf(c.bookingId)).toHaveLength(0);
  });

  it('S-11 N3-SEC/N2-CR: a D-14 refund that moves an invoice re-derives Booking.paymentStatus (backwards too); a forfeit is never overwritten', async () => {
    // A full refund of the deposit reopens it to SENT (invoice.reopened): DEPOSIT_PAID -> UNPAID; a cancel then forfeits nothing.
    const b = await book(ID.svcDep, 's11');
    await settle(b.depositInvoiceId!, 25);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    await refundSuccessful(b.depositInvoiceId!);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('SENT');
    await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(b.bookingId)).paymentStatus, 'nothing is held after the refund').toBe('UNPAID');
    const cancel = await setStatus(b.bookingId, 'CANCELLED');
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(cancel.body.depositForfeit ?? null).toBeNull();
    expect(cancel.body.paymentStatus).toBe('UNPAID');
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');

    // PAID, then 25 of the final refunded (PARTIALLY_PAID, invoice.payment_recorded): PAID -> DEPOSIT_PAID.
    const p = await book(ID.svcDep, 's11_paid');
    await settle(p.depositInvoiceId!, 25);
    expect((await setStatus(p.bookingId, 'COMPLETED')).status).toBe(201);
    const finalId = (await bookingRow(p.bookingId)).invoiceId;
    await sendAndPay(finalId, 50);
    await settle(finalId, 25);
    expect((await bookingRow(p.bookingId)).paymentStatus).toBe('PAID');
    emitted.length = 0;
    await refundSuccessful(finalId, 25);
    expect((await invoiceRow(finalId)).status).toBe('PARTIALLY_PAID');
    await deliverToPaymentStatusListener(finalId, REFUND_MOVES);
    expect((await bookingRow(p.bookingId)).paymentStatus, 'the final is owed 25 again; the deposit is held').toBe('DEPOSIT_PAID');

    // CONTROL: a forfeit (D-26) is not overwritten by the owner's refund of it.
    const f = await book(ID.svcDep, 's11_forfeit');
    await settle(f.depositInvoiceId!, 25);
    expect((await setStatus(f.bookingId, 'CANCELLED')).body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    await refundSuccessful(f.depositInvoiceId!);
    await deliverToPaymentStatusListener(f.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(f.bookingId)).paymentStatus).toBe('DEPOSIT_FORFEITED');
  });

  it('S-12 N4-SEC: a refund on a deposit never settled (10 of 25 received, 4 refunded) does not make it hold money: a cancel forfeits nothing', async () => {
    const b = await book(ID.svcDep, 's12');
    await sendAndPay(b.depositInvoiceId!, 6);
    await sendAndPay(b.depositInvoiceId!, 4);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await refundSuccessful(b.depositInvoiceId!, 4);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');
    const cancel = await setStatus(b.bookingId, 'CANCELLED');
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(cancel.body.depositForfeit ?? null, 'a part payment on a deposit still owed is not held, refund or not').toBeNull();
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');
    expect(forfeitRowsOf(b.bookingId)).toHaveLength(0);
  });

  it('S-13 N1-CR: a deposit paid in full then part-credited (D-28 PARTIALLY_CREDITED) is not owed: the final paid makes the booking PAID', async () => {
    const b = await book(ID.svcDep, 's13');
    await settle(b.depositInvoiceId!, 25);
    // The rows CreditNoteService.apply leaves (as S-02b): its own door cannot reach a real invoice yet (V1-44-DM-CREDIT-NOTE).
    await db.creditNote.create({
      data: { id: `${P}cn_s13`, businessId: ID.biz, invoiceId: b.depositInvoiceId, creditNoteNumber: `${P}CN-S13`, status: 'APPLIED', amount: 10, appliedAt: new Date() },
    });
    await db.invoice.update({ where: { id: b.depositInvoiceId }, data: { status: 'PARTIALLY_CREDITED' } });
    const done = await setStatus(b.bookingId, 'COMPLETED');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.invoicing).toMatchObject({ status: 'CREATED', amount: 85, depositAmount: 15, depositInvoiceId: b.depositInvoiceId });
    const finalId = (await bookingRow(b.bookingId)).invoiceId;
    await settle(finalId, 85);
    expect((await bookingRow(b.bookingId)).paymentStatus, '25 received for the 15 the deposit bills, and the 85 final paid').toBe('PAID');
  });
});

describe('Trial-N repair round 2: the deposit recheck (RC-DEP-1, RC-DEP-2, RC-DEP-3)', () => {
  const forfeitRowsOf = (bookingId: string) => contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === bookingId);
  /** A payment row tagged with ANOTHER business on an invoice of this one: Payment has no FK to Business (M31). No known writer does this today. */
  let foreignSeq = 0;
  const foreignRow = (invoiceId: string, amount: number, status: string) =>
    db.payment.create({
      data: { amount, currency: 'TTD', status, provider: 'cash', method: 'cash', providerPaymentId: `${P}r2_foreign_${++foreignSeq}`, businessId: ID.bizB, invoiceId },
    });
  /** The business's own payment rows on the invoice, oldest first. */
  const ownRows = async (invoiceId: string) =>
    (await db.payment.findMany({ where: { invoiceId, businessId: ID.biz }, orderBy: { createdAt: 'asc' } })).map((p: any) => `${p.status} ${money(p.amount)}`);
  /** The manual refund (D-14) of the business's own SUCCESSFUL payment of `amount` on the invoice. */
  const refundPayment = async (invoiceId: string, amount: number) => {
    const payment = await db.payment.findFirst({ where: { invoiceId, businessId: ID.biz, status: 'SUCCESSFUL', amount }, orderBy: { createdAt: 'desc' } });
    return commerce.markPaymentRefunded(payment.id, ID.biz, 'goodwill', ID.owner);
  };
  const eventsOf = (name: string, invoiceId: string) => emitted.filter((e) => e.name === name && e.payload?.invoice?.id === invoiceId);

  it('S-14 RC-DEP-1: refund and repayment churn never makes a part payment on a deposit held: a cancel forfeits nothing; CONTROL: one paid in full and never refunded back to nothing forfeits its net', async () => {
    // Probe R1: 20 of 25 received, refunded (SENT), 10 received (PARTIALLY_PAID): 30 received in all, never paid in full.
    const a = await book(ID.svcDep, 's14_churn');
    await sendAndPay(a.depositInvoiceId!, 20);
    await refundPayment(a.depositInvoiceId!, 20);
    expect((await invoiceRow(a.depositInvoiceId!)).status).toBe('SENT');
    await sendAndPay(a.depositInvoiceId!, 10);
    expect((await invoiceRow(a.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await deliverToPaymentStatusListener(a.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(a.bookingId)).paymentStatus, '10 of 25 is a part payment on a deposit still owed').toBe('UNPAID');
    const c1 = await setStatus(a.bookingId, 'CANCELLED');
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.depositForfeit ?? null, 'nothing is held, so nothing is forfeit').toBeNull();
    expect(c1.body.paymentStatus).toBe('UNPAID');
    expect(forfeitRowsOf(a.bookingId)).toHaveLength(0);

    // Paid in full, refunded in full (D-14: back to SENT, paidAt cleared, owed afresh), then 10 received: a part payment again.
    const b = await book(ID.svcDep, 's14_reopened');
    await settle(b.depositInvoiceId!, 25);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    await refundPayment(b.depositInvoiceId!, 25);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('SENT');
    await sendAndPay(b.depositInvoiceId!, 10);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');
    const c2 = await setStatus(b.bookingId, 'CANCELLED');
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
    expect(c2.body.depositForfeit ?? null).toBeNull();
    expect(forfeitRowsOf(b.bookingId)).toHaveLength(0);

    // CONTROL: paid in full (24 + 1), the 24 refunded (net 1: never back to nothing), 9 received: it holds 10 and a cancel forfeits 10.
    const c = await book(ID.svcDep, 's14_control');
    await sendAndPay(c.depositInvoiceId!, 24);
    await settle(c.depositInvoiceId!, 1);
    await refundPayment(c.depositInvoiceId!, 24);
    expect((await invoiceRow(c.depositInvoiceId!)).status).toBe('PARTIALLY_PAID');
    await sendAndPay(c.depositInvoiceId!, 9);
    await deliverToPaymentStatusListener(c.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(c.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    const c3 = await setStatus(c.bookingId, 'CANCELLED');
    expect(c3.status, JSON.stringify(c3.body)).toBe(201);
    expect(c3.body.paymentStatus).toBe('DEPOSIT_FORFEITED');
    expect(c3.body.depositForfeit).toMatchObject({ depositInvoiceId: c.depositInvoiceId, amount: 10 });
    expect(forfeitRowsOf(c.bookingId).map((e) => e.data.amount)).toEqual([10]);
  });

  it("S-15 RC-DEP-2: the reconcile, the invoice balance and mark-paid read the deposit's own-tenant rows only: a foreign row neither settles nor reopens it, nor stands in for the money mark-paid records", async () => {
    // (a) Another business's SUCCESSFUL 25 on an owed deposit, then 1 received: PARTIALLY_PAID, not PAID; nothing held, nothing forfeit.
    const a = await book(ID.svcDep, 's15_settle');
    await workflow.transition(a.depositInvoiceId!, 'SENT');
    await foreignRow(a.depositInvoiceId!, 25, 'SUCCESSFUL');
    await commerce.recordPayment(a.depositInvoiceId!, ID.biz, { amount: 1, method: 'cash' }, { actorId: ID.owner });
    expect((await invoiceRow(a.depositInvoiceId!)).status, "another tenant's row does not settle the deposit").toBe('PARTIALLY_PAID');
    expect(paidEventsFor(a.depositInvoiceId!), 'no invoice.paid for 1 of 25').toHaveLength(0);
    expect(await workflow.getBalance(a.depositInvoiceId!)).toMatchObject({ paid: 1, net: 1, remaining: 24, isFullyPaid: false });
    await deliverToPaymentStatusListener(a.depositInvoiceId!, REFUND_MOVES);
    const c1 = await setStatus(a.bookingId, 'CANCELLED');
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.depositForfeit ?? null, 'the business received 1: nothing is forfeit').toBeNull();
    expect((await bookingRow(a.bookingId)).paymentStatus).toBe('UNPAID');
    expect(forfeitRowsOf(a.bookingId)).toHaveLength(0);

    // (b) Own 20 + 5 received (PAID), another business's negative REFUNDED 25, then own 5 refunded: PARTIALLY_PAID holding 20, not reopened to SENT.
    const b = await book(ID.svcDep, 's15_reopen');
    await sendAndPay(b.depositInvoiceId!, 20);
    await settle(b.depositInvoiceId!, 5);
    await foreignRow(b.depositInvoiceId!, -25, 'REFUNDED');
    await refundPayment(b.depositInvoiceId!, 5);
    const reopened = await invoiceRow(b.depositInvoiceId!);
    expect(reopened.status, "another tenant's refund row does not reopen the deposit").toBe('PARTIALLY_PAID');
    expect(eventsOf('invoice.reopened', b.depositInvoiceId!)).toHaveLength(0);
    expect(await workflow.getBalance(b.depositInvoiceId!)).toMatchObject({ paid: 25, refunded: 5, net: 20, remaining: 5 });
    await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    const c2 = await setStatus(b.bookingId, 'CANCELLED');
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
    expect(c2.body.depositForfeit).toMatchObject({ depositInvoiceId: b.depositInvoiceId, amount: 20 });

    // (c) Mark-paid on an owed deposit carrying another business's SUCCESSFUL 25: it records the 25 owed as the business's own payment.
    const m = await book(ID.svcDep, 's15_markpaid');
    await workflow.transition(m.depositInvoiceId!, 'SENT');
    await foreignRow(m.depositInvoiceId!, 25, 'SUCCESSFUL');
    const marked = await commerce.markInvoicePaid(m.depositInvoiceId!, ID.owner, ID.biz);
    expect(marked.status).toBe('PAID');
    expect(await ownRows(m.depositInvoiceId!), 'the money mark-paid says arrived is recorded on the business').toEqual(['SUCCESSFUL 25']);
    expect(await workflow.getBalance(m.depositInvoiceId!)).toMatchObject({ paid: 25, net: 25, remaining: 0, isFullyPaid: true });
  });

  /**
   * Holds the booking row lock (SELECT ... FOR UPDATE) in a transaction of the
   * test's own until release(): a stand-in for "a write is in flight", so the
   * order the listener's reads and writes land in is the test's, not the
   * scheduler's.
   */
  async function holdBookingLock(bookingId: string) {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let ready!: (pid: number) => void;
    const locked = new Promise<number>((r) => (ready = r));
    const done = db.$transaction(
      async (tx: any) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
        ready(Number(pid));
        await released;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    const pid = await Promise.race([
      locked,
      done.then(() => {
        throw new Error('the lock transaction ended before it held the lock');
      }),
    ]);
    return {
      pid,
      release: async () => {
        release();
        await done;
      },
    };
  }

  /** Sessions of this database waiting behind `pid`, directly or behind one that is. */
  async function waitersBehind(pid: number): Promise<number> {
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
      `WITH w AS (SELECT a.pid, pg_blocking_pids(a.pid) AS b FROM pg_stat_activity a WHERE a.datname = current_database() AND a.wait_event_type = 'Lock')
       SELECT count(*)::int AS n FROM w WHERE $1::int = ANY(w.b) OR EXISTS (SELECT 1 FROM w w2 WHERE w2.pid = ANY(w.b) AND $1::int = ANY(w2.b))`,
      pid,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Until `n` sessions wait behind `pid`, or `stop()` says the call it waits for finished without waiting. */
  async function untilWaiting(pid: number, n: number, stop: () => boolean = () => false) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (stop() || (await waitersBehind(pid)) >= n) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`fewer than ${n} session(s) waited behind the test's booking lock`);
  }

  it('S-16 RC-DEP-3: a re-derivation racing a payment or refund of the deposit leaves the booking as its invoices state it (the backward write the recheck found, and its forward mirror)', async () => {
    const listener = paymentStatusListener;
    const failures = vi.spyOn((listener as any).logger, 'error');

    // (a) The recheck's probe: the refund's re-derivation reads the deposit SENT; the deposit is paid again and its
    // invoice.paid handled (DEPOSIT_PAID already: nothing to write) before that re-derivation's write lands.
    const a = await book(ID.svcDep, 's16_back');
    await settle(a.depositInvoiceId!, 25);
    expect((await bookingRow(a.bookingId)).paymentStatus).toBe('DEPOSIT_PAID');
    await refundPayment(a.depositInvoiceId!, 25);
    const [reopen] = eventsOf('invoice.reopened', a.depositInvoiceId!);
    expect(reopen, 'the full refund reopened the deposit (D-14)').toBeDefined();
    const lockA = await holdBookingLock(a.bookingId);
    const rederiveA = listener.onInvoiceRefundMoved(reopen.payload);
    await untilWaiting(lockA.pid, 1);
    emitted.length = 0;
    await sendAndPay(a.depositInvoiceId!, 25);
    const [paidAgain] = paidEventsFor(a.depositInvoiceId!);
    let appliedA = false;
    const applyA = listener.onInvoicePaid(paidAgain).finally(() => {
      appliedA = true;
    });
    await untilWaiting(lockA.pid, 2, () => appliedA);
    await lockA.release();
    await Promise.all([rederiveA, applyA]);
    expect((await invoiceRow(a.depositInvoiceId!)).status).toBe('PAID');
    expect((await bookingRow(a.bookingId)).paymentStatus, 'the deposit is paid again, so it is held').toBe('DEPOSIT_PAID');

    // (b) The mirror: a payment's invoice.paid reads the deposit PAID; the deposit is refunded in full and the
    // refund's re-derivation handled (UNPAID already: nothing to write) before that invoice.paid's write lands.
    const b = await book(ID.svcDep, 's16_fwd');
    await workflow.transition(b.depositInvoiceId!, 'SENT');
    emitted.length = 0;
    await sendAndPay(b.depositInvoiceId!, 25);
    const [paidB] = paidEventsFor(b.depositInvoiceId!);
    expect((await bookingRow(b.bookingId)).paymentStatus).toBe('UNPAID');
    const lockB = await holdBookingLock(b.bookingId);
    const applyB = listener.onInvoicePaid(paidB);
    await untilWaiting(lockB.pid, 1);
    await refundPayment(b.depositInvoiceId!, 25);
    const [reopenB] = eventsOf('invoice.reopened', b.depositInvoiceId!);
    let rederivedB = false;
    const rederiveB = listener.onInvoiceRefundMoved(reopenB.payload).finally(() => {
      rederivedB = true;
    });
    await untilWaiting(lockB.pid, 2, () => rederivedB);
    await lockB.release();
    await Promise.all([applyB, rederiveB]);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('SENT');
    expect((await bookingRow(b.bookingId)).paymentStatus, 'refunded in full: nothing is held').toBe('UNPAID');

    expect(failures, 'no derivation failed (a lock timeout would be logged here)').not.toHaveBeenCalled();
  });
});

describe('Trial-N repair round 2: the deposit recheck, still open after round 1 (F1, F3, F4)', () => {
  const forfeitRowsOf = (bookingId: string) => contactEvents.filter((e) => e.type === 'booking.deposit_forfeited' && e.data?.bookingId === bookingId);
  /** A payment row tagged with ANOTHER business on an invoice of this one: Payment has no FK to Business (M31). No known writer does this today. */
  let foreignSeq = 0;
  const foreignRow = (invoiceId: string, amount: number, status: string) =>
    db.payment.create({
      data: { amount, currency: 'TTD', status, provider: 'cash', method: 'cash', providerPaymentId: `${P}r2b_foreign_${++foreignSeq}`, businessId: ID.bizB, invoiceId },
    });
  /** The manual refund (D-14) of the business's own SUCCESSFUL payment of `amount` on the invoice. */
  const refundPayment = async (invoiceId: string, amount: number) => {
    const payment = await db.payment.findFirst({ where: { invoiceId, businessId: ID.biz, status: 'SUCCESSFUL', amount }, orderBy: { createdAt: 'desc' } });
    return commerce.markPaymentRefunded(payment.id, ID.biz, 'goodwill', ID.owner);
  };
  const eventsOf = (name: string, invoiceId: string) => emitted.filter((e) => e.name === name && e.payload?.invoice?.id === invoiceId);
  /** The customer's PENDING intents on the invoice, as the business's own rows. */
  const intentsOf = async (invoiceId: string) =>
    (await db.payment.findMany({ where: { invoiceId, businessId: ID.biz, status: 'PENDING' }, orderBy: { createdAt: 'asc' } })).map((p: any) => `${p.method} ${money(p.amount)}`);

  /**
   * Runs `hook` once, right after the first read of the deposit invoice with
   * the settlement select (an invoice findFirst by the deposit's id selecting
   * its payment rows), whether the service reads through the client or through
   * a transaction it opens on the client: PrismaService.client is a proxy for
   * the call, so the hook lands between a settlement decision's read and its
   * write, wherever the service takes that read. restore() puts the client back.
   */
  function afterDepositRead(depositInvoiceId: string, hook: () => Promise<void>) {
    const real = prismaService.client;
    let fired = false;
    const bind = (target: any, prop: PropertyKey) => {
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    };
    const delegate = (target: any) =>
      new Proxy(target, {
        get(t, prop) {
          if (prop !== 'findFirst') return bind(t, prop);
          return async (args: any) => {
            const result = await t.findFirst(args);
            if (!fired && args?.where?.id === depositInvoiceId && args?.select?.payments) {
              fired = true;
              await hook();
            }
            return result;
          };
        },
      });
    const client = (target: any): any =>
      new Proxy(target, {
        get(t, prop) {
          if (prop === 'invoice') return delegate(t.invoice);
          if (prop === '$transaction') {
            return (arg: any, options?: any) =>
              typeof arg === 'function' ? t.$transaction((tx: any) => arg(client(tx)), options) : t.$transaction(arg, options);
          }
          return bind(t, prop);
        },
      });
    prismaService.client = client(real);
    return {
      fired: () => fired,
      restore: () => {
        prismaService.client = real;
      },
    };
  }

  /** Sessions of this database waiting on a lock (behind `pid` when given). */
  async function lockWaiters(pid?: number): Promise<number> {
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity a
        WHERE a.datname = current_database() AND a.wait_event_type = 'Lock' AND ($1::int IS NULL OR $1::int = ANY(pg_blocking_pids(a.pid)))`,
      pid ?? null,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Until a session waits on a lock (behind `pid` when given), or `stop()` says the call it waits for got through without waiting. */
  async function untilLockWait(stop: () => boolean, pid?: number) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (stop() || (await lockWaiters(pid)) > 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('nothing waited on a lock and the call did not get through');
  }

  it('S-17 F1: the pay page intent decides refuse and cap from the deposit\'s own-tenant rows: a foreign row neither answers "already paid" nor moves the amount it records', async () => {
    // The recheck's probe: an owed deposit carrying another business's SUCCESSFUL 25. The business received nothing.
    const a = await book(ID.svcDep, 's17_refuse');
    await workflow.transition(a.depositInvoiceId!, 'SENT');
    await foreignRow(a.depositInvoiceId!, 25, 'SUCCESSFUL');
    expect(await workflow.getBalance(a.depositInvoiceId!)).toMatchObject({ paid: 0, remaining: 25 });
    await expect(commerce.recordPublicPaymentIntent(a.depositInvoiceId!, 'bank_transfer', 25), 'the deposit is owed in full').resolves.toMatchObject({ success: true, method: 'bank_transfer' });
    expect(await intentsOf(a.depositInvoiceId!)).toEqual(['bank_transfer 25']);

    // Own 5 received, another business's SUCCESSFUL 10: 20 is owed, so an intent of 25 records 20, not 10.
    const b = await book(ID.svcDep, 's17_cap');
    await sendAndPay(b.depositInvoiceId!, 5);
    await foreignRow(b.depositInvoiceId!, 10, 'SUCCESSFUL');
    await commerce.recordPublicPaymentIntent(b.depositInvoiceId!, 'bank_transfer', 25);
    expect(await intentsOf(b.depositInvoiceId!), 'capped at what the business is still owed').toEqual(['bank_transfer 20']);

    // Own 20 received, another business's negative REFUNDED 10: 5 is owed, so an intent of 25 records 5, not 15.
    const c = await book(ID.svcDep, 's17_inflate');
    await sendAndPay(c.depositInvoiceId!, 20);
    await foreignRow(c.depositInvoiceId!, -10, 'REFUNDED');
    await commerce.recordPublicPaymentIntent(c.depositInvoiceId!, 'cash', 25);
    expect(await intentsOf(c.depositInvoiceId!), "another business's refund row is not money returned").toEqual(['cash 5']);

    // CONTROL: own rows only. 20 of 25 received caps an intent at 5; paid in full answers 409.
    const d = await book(ID.svcDep, 's17_control');
    await sendAndPay(d.depositInvoiceId!, 20);
    await commerce.recordPublicPaymentIntent(d.depositInvoiceId!, 'check', 25);
    expect(await intentsOf(d.depositInvoiceId!)).toEqual(['check 5']);
    await sendAndPay(d.depositInvoiceId!, 5);
    await expect(commerce.recordPublicPaymentIntent(d.depositInvoiceId!, 'cash', 1)).rejects.toThrow('Invoice is already paid');
  });

  it('S-18 F3: a refund of the deposit in flight when the cancel decides the forfeit is seen: the forfeit reads the deposit after it commits (no forfeit, UNPAID)', async () => {
    const posting = (commerce as any).revenuePosting;

    // The owner's full refund is in flight when the cancel decides: it holds the deposit's invoice lock with its
    // row written (gated in its posting step). The forfeit's read is followed by the refund's commit.
    const a = await book(ID.svcDep, 's18_inflight');
    await settle(a.depositInvoiceId!, 25);
    expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'DEPOSIT_PAID' });
    const onPaymentRefunded = posting.onPaymentRefunded;
    let openGate!: () => void;
    const gate = new Promise<void>((r) => (openGate = r));
    let refundPid!: (pid: number) => void;
    const refundHolding = new Promise<number>((r) => (refundPid = r));
    vi.spyOn(posting, 'onPaymentRefunded').mockImplementationOnce(async (...args: any[]) => {
      const [{ pid }] = await args[1].tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      refundPid(Number(pid));
      await gate;
      return onPaymentRefunded.apply(posting, args);
    });
    const refundA = refundPayment(a.depositInvoiceId!, 25);
    const pid = await refundHolding;
    const armedA = afterDepositRead(a.depositInvoiceId!, async () => {
      openGate();
      await refundA;
    });
    let cancelledA = false;
    const cancelA = setStatus(a.bookingId, 'CANCELLED').then((r: any) => {
      cancelledA = true;
      return r;
    });
    // Read without a lock, the forfeit's read gets through and the hook opens the gate; read under the deposit's
    // invoice lock, it waits behind the refund, and the gate opens then.
    try {
      await untilLockWait(() => armedA.fired() || cancelledA, pid);
      openGate();
      const resA = await cancelA;
      await refundA;
      expect(resA.status, JSON.stringify(resA.body)).toBe(201);
      expect(resA.body.depositForfeit ?? null, 'the refund committed before the forfeit was written: nothing is held').toBeNull();
    } finally {
      openGate();
      armedA.restore();
    }
    expect((await invoiceRow(a.depositInvoiceId!)).status, 'refunded in full: reopened (D-14)').toBe('SENT');
    await deliverToPaymentStatusListener(a.depositInvoiceId!, REFUND_MOVES);
    expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    expect(forfeitRowsOf(a.bookingId)).toHaveLength(0);
  });

  it('S-18b F3: a refund issued right after the forfeit\'s read of the deposit waits for the forfeit, so what is forfeit was held when recorded; the owner\'s refund then follows it (D-26)', async () => {
    const listener = paymentStatusListener;
    const failures = vi.spyOn((listener as any).logger, 'error');
    // Probe X2: the real refund (and its re-derivation) right after the forfeit's read of the deposit. The refund
    // is no longer between the read and the write: it waits for the forfeit, so what is forfeit was held when it was
    // recorded, and the owner's refund then follows it (a forfeit is never overwritten, D-26).
    const b = await book(ID.svcDep, 's18_after');
    await settle(b.depositInvoiceId!, 25);
    emitted.length = 0;
    let refundB: Promise<any> | null = null;
    let refundedB = false;
    let refundLandedInside: boolean | null = null;
    const armedB = afterDepositRead(b.depositInvoiceId!, async () => {
      refundB = refundPayment(b.depositInvoiceId!, 25).finally(() => {
        refundedB = true;
      });
      await untilLockWait(() => refundedB);
      refundLandedInside = refundedB;
      if (refundedB) await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    });
    let resB: any;
    try {
      resB = await setStatus(b.bookingId, 'CANCELLED');
      await refundB;
    } finally {
      armedB.restore();
    }
    expect(armedB.fired()).toBe(true);
    expect(resB.status, JSON.stringify(resB.body)).toBe(201);
    expect(refundLandedInside, 'the refund committed between the forfeit\'s read and its write').toBe(false);
    expect(resB.body.depositForfeit).toMatchObject({ depositInvoiceId: b.depositInvoiceId, amount: 25 });
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('SENT');
    await deliverToPaymentStatusListener(b.depositInvoiceId!, REFUND_MOVES);
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'DEPOSIT_FORFEITED' });
    expect(forfeitRowsOf(b.bookingId).map((e) => e.data.amount)).toEqual([25]);

    expect(failures, 'no derivation failed').not.toHaveBeenCalled();
  });

  it('S-19 F4: a refund landing right after the reinstatement\'s read of the deposit is not lost: the booking brought back from a forfeit ends UNPAID, not DEPOSIT_PAID with nothing held', async () => {
    const listener = paymentStatusListener;
    const failures = vi.spyOn((listener as any).logger, 'error');
    // Probe X3: settled 25, cancelled (forfeit 25). The owner's full refund (D-14: SENT) and its re-derivation run
    // right after the reinstatement's read of the deposit; the re-derivation then finds the booking still forfeit.
    const b = await book(ID.svcDep, 's19');
    await settle(b.depositInvoiceId!, 25);
    const cancel = await setStatus(b.bookingId, 'CANCELLED');
    expect(cancel.body.depositForfeit).toMatchObject({ amount: 25 });
    emitted.length = 0;
    let rederive: Promise<any> | null = null;
    let rederived = false;
    const armed = afterDepositRead(b.depositInvoiceId!, async () => {
      await refundPayment(b.depositInvoiceId!, 25);
      const [reopen] = eventsOf('invoice.reopened', b.depositInvoiceId!);
      expect(reopen, 'the full refund reopened the deposit (D-14)').toBeDefined();
      rederive = listener.onInvoiceRefundMoved(reopen.payload).finally(() => {
        rederived = true;
      });
      await untilLockWait(() => rederived);
    });
    let back: any;
    try {
      back = await setStatus(b.bookingId, 'CONFIRMED');
      await rederive;
    } finally {
      armed.restore();
    }
    expect(armed.fired()).toBe(true);
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await invoiceRow(b.depositInvoiceId!)).status).toBe('SENT');
    expect(await bookingRow(b.bookingId), 'refunded in full: nothing is held for the booking').toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' });
    expect(failures, 'no derivation failed').not.toHaveBeenCalled();
  });
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
