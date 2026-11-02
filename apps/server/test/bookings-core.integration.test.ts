/**
 * V1-06-BK-BASELINE-PARITY — bookings core against a REAL database.
 *
 * M40 / M41 (BK-01 + BK-06). The core booking tests were mock-only
 * (test/bookings.service.test.ts, src/modules/bookings/booking-overlap.spec.ts),
 * and the staff-facing create was weaker than the public one:
 *
 *   POST /bookings/businesses/:businessId          (in-app, AuthGuard + BusinessGuard + PlanLimitGuard)
 *     - wrote whatever contactId / staffId / serviceId it was handed: another
 *       business's contact or staff member was booked into this business
 *       (bookings.service.ts createBooking, assertSlotFree only);
 *     - applied no lead time, no business hours and no staff availability;
 *     - required staffId in the DTO (400) although the service books the
 *       service itself as the resource when there is no staff member.
 *
 *   POST /bookings/public/businesses/:businessId   (public widget) applies all of
 *     those rules, with these messages, which the in-app path must now return:
 *       lead time        "This service requires at least N minutes advance notice."
 *       staff day        "The selected staff member is not available on this day."
 *       staff hours      "The selected time is outside this staff member's available hours."
 *       closed day       "This business is closed on the selected day."
 *       business hours   "The selected time is outside business hours."
 *
 * Cases:
 *   CONTROL (green at the base, kept as regression controls): in-app create
 *   persists; an overlapping create for the same staff member is refused; a
 *   public create for an invoiceTiming BOOKING service links a DRAFT invoice;
 *   /slots omits taken, closed and lead-time times; reschedule refuses
 *   CANCELLED and COMPLETED; business B cannot read, update or change the status
 *   of A's booking; COMPLETED auto-invoices once.
 *   LEDGER: that auto-invoice is DRAFT with no posting, and posts AR exactly once
 *   when it is issued (ACCRUAL).
 *   RED-BEFORE (fail at the base): foreign contactId / staffId / serviceId is a
 *   404; hours, closed day, lead time and staff availability are refused with
 *   the public path's message (each case asks the public path the same question
 *   and compares); a create without staffId succeeds with the service as the
 *   resource.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * PlanLimitGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this suite's
 * own key namespace), HoneypotGuard, BookingsController, BookingsService,
 * CommerceService (invoice creation), InvoiceWorkflowService and the real ledger
 * chain (RevenuePostingService, PostingService, ChartOfAccountsSeederService)
 * read and write real rows behind the production GlobalHttpExceptionFilter and
 * ValidationPipe. Identity attachment is the one stand-in: a test middleware
 * reads `x-v06a-user` and attaches the seeded user row as AuthMiddleware would.
 * Collaborators off the boundary are stubs: the event bus, the contact
 * timeline (CrmService.logContactEvent), the public path's contact resolution
 * (CrmService.findOrCreateContact upserts one prefixed contact), revenue
 * attribution, storefront events, email, plan limits (always allowed) and the
 * Google calendar.
 *
 * Fixtures: prefix `v06a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 * Times are LOCAL wall-clock times in January 2030. The service reads hours
 * and weekdays in Business.timezone (V1-16), so businesses A, B and C carry the
 * server's own zone and those wall-clock times mean the same thing to both;
 * the CR-1 case gives a business another zone on purpose.
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

const P = 'v06a_';
const HEADER = 'x-v06a-user';

// This suite's public rate-limit keys live under its own namespace.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactLedger: `${P}contactLedger`,
  contactPub: `${P}contactPub`,
  contactB: `${P}contactB`,
  staffFree: `${P}staffFree`, // A, no availability rows: business hours apply
  staffAvail: `${P}staffAvail`, // A, works Mondays 09:00-13:00 only
  staffB: `${P}staffB`,
  staffBAvail: `${P}staffBAvail`, // B, works Mondays 09:00-10:00 (review ST-1)
  // review repairs
  staffUser: `${P}staffUser`, // STAFF of A with crm_view 'owned' (ST-4)
  contactPrivate: `${P}contactPrivate`, // A, owned by ownerA, PRIVATE
  contactStaffOwned: `${P}contactStaffOwned`, // A, owned by staffUser
  orgA: `${P}orgA`,
  orgB: `${P}orgB`,
  bizC: `${P}bizC`, // owned by ownerA; a day row without open/close (CR-2)
  contactC: `${P}contactC`,
  svcC: `${P}svcC`,
  svc: `${P}svc`,
  svcLead: `${P}svcLead`,
  svcBooking: `${P}svcBooking`,
  svcSlots: `${P}svcSlots`,
  svcSlotsLead: `${P}svcSlotsLead`,
  svcNoStaff: `${P}svcNoStaff`,
  svcNoStaff2: `${P}svcNoStaff2`,
  svcLedger: `${P}svcLedger`,
  svcB: `${P}svcB`,
  // seeded bookings
  bkOccupied: `${P}bkOccupied`,
  bkSlotTaken: `${P}bkSlotTaken`,
  bkCancelled: `${P}bkCancelled`,
  bkCompleted: `${P}bkCompleted`,
  bkTenantA: `${P}bkTenantA`,
  bkLedger: `${P}bkLedger`,
  // V1-16 CR-1: a Port_of_Spain (UTC-4) business, read on a UTC server.
  bizTz: `${P}bizTz`,
  contactTz: `${P}contactTz`,
  svcTz: `${P}svcTz`,
  svcTz2: `${P}svcTz2`,
};

/** The zone this process reads local times in; businesses A, B and C carry it. */
const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Twenty years: every 2030 time is inside it. */
const LONG_LEAD_MINS = 20 * 365 * 24 * 60;

/** A local wall-clock time in January 2030. 2030-01-07 is a Monday. */
const at = (day: number, hour: number, minute = 0) => new Date(2030, 0, day, hour, minute, 0, 0);
const SUN = 6;
const MON = 7;
const TUE = 8;
const WED = 9;
const THU = 10;
const FRI = 11;
const plusMins = (d: Date, mins: number) => new Date(d.getTime() + mins * 60_000);

const WEEKDAY = { open: '09:00', close: '17:00', closed: false };
const CLOSED = { open: '00:00', close: '00:00', closed: true };
const HOURS_A = { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY, sat: CLOSED, sun: CLOSED };

const MSG = {
  taken: 'That time slot has already been booked. Please choose another.',
  closed: 'This business is closed on the selected day.',
  hours: 'The selected time is outside business hours.',
  lead: `This service requires at least ${LONG_LEAD_MINS} minutes advance notice.`,
  staffDay: 'The selected staff member is not available on this day.',
  staffHours: "The selected time is outside this staff member's available hours.",
  reschedule: 'Cannot reschedule a cancelled or completed booking',
  endBeforeStart: 'The end time must be after the start time.',
};

let db: any;
let app: any;
let redis: any;
let invoiceWorkflow: any;

const emitted: string[] = [];
const eventStub = {
  emit: (name: string) => {
    emitted.push(name);
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

/**
 * Off the boundary: the contact timeline and the public path's contact
 * resolution. findOrCreateContact upserts one prefixed contact in the business
 * so the public booking's contact FK is a real row of that tenant.
 */
const crmStub = {
  logContactEvent: async () => null,
  // One public contact per business, so a public booking in another fixture
  // business never points at A's contact.
  findOrCreateContact: async (businessId: string, input: { firstName?: string | null; lastName?: string | null; email?: string | null }) => {
    const id = businessId === ID.bizA ? ID.contactPub : `${ID.contactPub}_${businessId.slice(P.length)}`;
    return db.contact.upsert({
      where: { id },
      update: {},
      create: { id, businessId, firstName: input.firstName ?? 'Public', lastName: input.lastName ?? null, email: input.email ?? null },
    });
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM availabilities WHERE staff_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The in-app create, through the real route and guards. */
function inAppCreate(actor: string, businessId: string, body: Record<string, unknown>) {
  return agent().post(`/bookings/businesses/${businessId}`).set(HEADER, actor).send(body);
}

/** The public widget's create for business A (or `businessId`), anonymous. */
function publicCreate(body: { serviceId: string; staffId?: string; startTime: Date; orgUnitId?: string; businessId?: string }) {
  return agent()
    .post(`/bookings/public/businesses/${body.businessId ?? ID.bizA}`)
    .send({
      serviceId: body.serviceId,
      ...(body.staffId ? { staffId: body.staffId } : {}),
      ...(body.orgUnitId ? { orgUnitId: body.orgUnitId } : {}),
      startTime: body.startTime.toISOString(),
      firstName: 'Pat',
      lastName: 'Public',
      email: `${P}public@test.local`,
      phone: '+18685550100',
    });
}

function slots(serviceId: string, date: string) {
  return agent().get(`/bookings/public/businesses/${ID.bizA}/slots`).query({ serviceId, date });
}

function bookingRow(id: string) {
  return db.booking.findFirst({ where: { id } });
}

/** In-app body for business A: contact A, the 60-minute service, the given staff and start. */
function body(start: Date, over: Record<string, unknown> = {}) {
  return {
    contactId: ID.contactA,
    serviceId: ID.svc,
    staffId: ID.staffFree,
    startTime: start.toISOString(),
    endTime: plusMins(start, 60).toISOString(),
    ...over,
  };
}

async function bookingsAt(businessId: string, start: Date) {
  return db.booking.count({ where: { businessId, startTime: start } });
}

/**
 * The in-app answer must be the public path's answer: same status, same
 * message, and neither writes a booking.
 */
async function expectParity(
  label: string,
  input: { serviceId: string; staffId?: string; start: Date },
  message: string,
) {
  const before = await bookingsAt(ID.bizA, input.start);
  // The public path first, so an in-app write (at the base) cannot turn the
  // public answer into "already booked".
  const pub = await publicCreate({ serviceId: input.serviceId, staffId: input.staffId, startTime: input.start });
  const inApp = await inAppCreate(ID.ownerA, ID.bizA, body(input.start, { serviceId: input.serviceId, staffId: input.staffId }));
  expect(pub.status, `${label}: public path`).toBe(400);
  expect(pub.body.message, `${label}: public path`).toBe(message);
  expect(inApp.status, `${label}: in-app path (${inApp.body?.message ?? inApp.body?.id})`).toBe(400);
  expect(inApp.body.message, `${label}: in-app message must be the public one`).toBe(pub.body.message);
  expect(await bookingsAt(ID.bizA, input.start), `${label}: no booking written`).toBe(before);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
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
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CreateBookingDto } = await import('../src/modules/bookings/dto/create-booking.dto');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');

  // The two create handlers' parameter types as tsc emits them for the
  // production build (emitDecoratorMetadata), which vitest's esbuild transform
  // does not: without them the global ValidationPipe has no metatype and passes
  // every body unchecked. A control case below reads the same list from what
  // tsc emits for bookings.controller.ts.
  // createBooking's third parameter is the @Req() request (the actor, V1-06
  // review ST-4); pipes do not run on it.
  Reflect.defineMetadata('design:paramtypes', [String, CreateBookingDto, Object], BookingsController.prototype, 'createBooking');
  Reflect.defineMetadata('design:paramtypes', [String, PublicCreateBookingDto], BookingsController.prototype, 'publicCreateBooking');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      PlanLimitGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      BookingsService,
      // Invoice creation and the ledger chain are real.
      CommerceService,
      InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
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
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  invoiceWorkflow = moduleRef.get(InvoiceWorkflowService);

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  // ---- two tenants. A has weekday hours 09:00-17:00 and accrual books. ----
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V06A Biz A', ownerId: ID.ownerA, currency: 'TTD', timezone: SERVER_TZ, businessHours: HOURS_A, accountingBasis: 'ACCRUAL' },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V06A Biz B', ownerId: ID.ownerB, currency: 'TTD', timezone: SERVER_TZ } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);

  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ana', lastName: 'Client' } });
  await db.contact.create({ data: { id: ID.contactLedger, businessId: ID.bizA, firstName: 'Lee', lastName: 'Ledger' } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Bea', lastName: 'Other' } });

  await db.staffMember.create({ data: { id: ID.staffFree, businessId: ID.bizA, name: 'Free Staff' } });
  await db.staffMember.create({ data: { id: ID.staffAvail, businessId: ID.bizA, name: 'Monday Staff' } });
  await db.staffMember.create({ data: { id: ID.staffB, businessId: ID.bizB, name: 'Other Staff' } });
  await db.availability.create({ data: { id: `${P}av_mon`, staffId: ID.staffAvail, dayOfWeek: 1, startTime: '09:00', endTime: '13:00' } });

  // ---- review repairs (ST-1..ST-4, CR-2) ----
  // B's staff member with availability rows: the schedule lookup is scoped to
  // the booking's business, so for A it finds none and falls through to A's hours.
  await db.staffMember.create({ data: { id: ID.staffBAvail, businessId: ID.bizB, name: `${P}B-secret-staff-name` } });
  await db.availability.create({ data: { id: `${P}av_b_mon`, staffId: ID.staffBAvail, dayOfWeek: 1, startTime: '09:00', endTime: '10:00' } });
  await db.orgUnit.create({ data: { id: ID.orgA, businessId: ID.bizA, name: `${P}A-branch` } });
  await db.orgUnit.create({ data: { id: ID.orgB, businessId: ID.bizB, name: `${P}B-secret-branch` } });
  // A STAFF member of A whose CRM view is "my book" only.
  await db.user.create({ data: { id: ID.staffUser, email: `${P}staffUser@test.local`, role: 'USER' } });
  await db.membership.create({
    data: { id: `${P}m_staffUser`, userId: ID.staffUser, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', crm_view: 'owned' } },
  });
  await db.contact.create({
    data: {
      id: ID.contactPrivate, businessId: ID.bizA, firstName: 'Priv', lastName: 'Ate', ownerId: ID.ownerA, visibility: 'PRIVATE',
      email: `${P}secret@test.local`, phone: '+18685559999',
    },
  });
  await db.contact.create({ data: { id: ID.contactStaffOwned, businessId: ID.bizA, firstName: 'Sam', lastName: 'Mine', ownerId: ID.staffUser } });
  // C: a Monday row that is open but carries no open/close times.
  await db.business.create({
    data: { id: ID.bizC, name: 'V06A Biz C', ownerId: ID.ownerA, currency: 'TTD', timezone: SERVER_TZ, businessHours: { mon: { closed: false } } },
  });
  await db.membership.create({ data: { id: `${P}m_ownerA_C`, userId: ID.ownerA, businessId: ID.bizC, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactC, businessId: ID.bizC, firstName: 'Cid', lastName: 'Client' } });
  // V1-16 CR-1: weekdays 09:00-17:00 in Port_of_Spain (UTC-4 all year).
  await db.business.create({
    data: { id: ID.bizTz, name: 'V06A Biz Tz', ownerId: ID.ownerA, currency: 'TTD', timezone: 'America/Port_of_Spain', businessHours: HOURS_A },
  });
  await db.membership.create({ data: { id: `${P}m_ownerA_Tz`, userId: ID.ownerA, businessId: ID.bizTz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactTz, businessId: ID.bizTz, firstName: 'Tia', lastName: 'Client' } });

  // The lead time of svcSlotsLead ends between 11:30 and 12:00 on FRI, so the
  // picker must drop every earlier slot and keep 12:00 onward.
  const slotsLeadMins = Math.floor((at(FRI, 12).getTime() - Date.now()) / 60_000) - 1;
  const service = (id: string, businessId: string, extra: Record<string, unknown> = {}) =>
    db.service.create({ data: { id, businessId, name: id.slice(P.length), duration: 60, price: 0, ...extra } });
  await service(ID.svc, ID.bizA, { price: 100 });
  await service(ID.svcLead, ID.bizA, { leadTimeMins: LONG_LEAD_MINS });
  await service(ID.svcBooking, ID.bizA, { price: 80, invoiceTiming: 'BOOKING' });
  await service(ID.svcSlots, ID.bizA);
  await service(ID.svcSlotsLead, ID.bizA, { leadTimeMins: slotsLeadMins });
  await service(ID.svcNoStaff, ID.bizA);
  await service(ID.svcNoStaff2, ID.bizA);
  await service(ID.svcLedger, ID.bizA, { price: 100 });
  await service(ID.svcB, ID.bizB);
  await service(ID.svcC, ID.bizC);
  await service(ID.svcTz, ID.bizTz);
  await service(ID.svcTz2, ID.bizTz);

  // ---- seeded bookings (written directly: they are the state, not the act) ----
  const seed = (id: string, data: Record<string, unknown>) =>
    db.booking.create({ data: { id, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.svc, ...data } });
  await seed(ID.bkOccupied, { staffId: ID.staffFree, startTime: at(TUE, 15), endTime: at(TUE, 16), status: 'CONFIRMED' });
  await seed(ID.bkSlotTaken, { serviceId: ID.svcSlots, startTime: at(THU, 10), endTime: at(THU, 11), status: 'CONFIRMED' });
  await seed(ID.bkCancelled, { staffId: ID.staffFree, startTime: at(MON, 14), endTime: at(MON, 15), status: 'CANCELLED' });
  await seed(ID.bkCompleted, { staffId: ID.staffFree, startTime: at(MON, 15), endTime: at(MON, 16), status: 'COMPLETED' });
  await seed(ID.bkTenantA, { staffId: ID.staffFree, startTime: at(WED, 14), endTime: at(WED, 15), status: 'CONFIRMED', location: `${P}original-location` });
  await seed(ID.bkLedger, {
    contactId: ID.contactLedger, serviceId: ID.svcLedger, staffId: ID.staffFree, startTime: at(WED, 15), endTime: at(WED, 16), status: 'CONFIRMED',
  });
}, 120_000);

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

describe('V1-06 bookings core: regression controls (green at the base)', () => {
  it('CONTROL: both create bodies are validated against their DTOs, with the parameter types tsc emits', async () => {
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(path.resolve(__dirname, '../src/modules/bookings/bookings.controller.ts'), 'utf8');
    const emitted = ts.transpileModule(source, {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    for (const [handler, expected] of [['createBooking', 'String, CreateBookingDto, Object'], ['publicCreateBooking', 'String, PublicCreateBookingDto']]) {
      const end = emitted.indexOf(`], BookingsController.prototype, "${handler}", null)`);
      expect(end, handler).toBeGreaterThan(0);
      const decorators = emitted.slice(emitted.lastIndexOf('__decorate([', end), end);
      // A single-file transpile cannot see that the imported DTO is a class, so
      // it emits a guarded reference to it; reduce that to the class name.
      const types = decorators
        .match(/design:paramtypes", \[([^\]]*)\]/)?.[1]
        ?.replace(/typeof \(_\w+ = typeof \w+\.(\w+) !== "undefined" && \w+\.\1\) === "function" \? _\w+ : Object/g, '$1');
      expect(types, handler).toBe(expected);
    }

    // The pipe is live in this harness: a malformed time is a 400 on both paths.
    const inApp = await inAppCreate(ID.ownerA, ID.bizA, body(at(MON, 9), { startTime: 'next tuesday' }));
    expect(inApp.status).toBe(400);
    expect(inApp.body.message).toEqual(['startTime must be a valid ISO 8601 date string']);
    const pub = await agent().post(`/bookings/public/businesses/${ID.bizA}`).send({ serviceId: ID.svc, startTime: 'next tuesday' });
    expect(pub.status).toBe(400);
    expect(pub.body.message).toContain('startTime must be a valid ISO 8601 date string');
  }, 30_000); // loading the TypeScript compiler alone can pass 5 s on a loaded machine

  it('CONTROL: an in-app create persists the booking in the business', async () => {
    const start = at(MON, 10);
    const res = await inAppCreate(ID.ownerA, ID.bizA, body(start));
    expect(res.status, res.body?.message ?? res.body?.id).toBe(201);
    const row = await bookingRow(res.body.id);
    expect(row).toMatchObject({
      businessId: ID.bizA,
      contactId: ID.contactA,
      serviceId: ID.svc,
      staffId: ID.staffFree,
      status: 'PENDING',
      deletedAt: null,
    });
    expect(row.startTime.getTime()).toBe(start.getTime());
    expect(row.endTime.getTime()).toBe(plusMins(start, 60).getTime());
  });

  it('CONTROL: an overlapping in-app create for the same staff member is refused', async () => {
    const start = at(TUE, 15, 30); // bkOccupied holds staffFree 15:00-16:00
    const res = await inAppCreate(ID.ownerA, ID.bizA, body(start));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(MSG.taken);
    expect(await bookingsAt(ID.bizA, start)).toBe(0);
  });

  it('CONTROL: a public create for an invoiceTiming BOOKING service links a DRAFT invoice', async () => {
    const start = at(WED, 9);
    const res = await publicCreate({ serviceId: ID.svcBooking, startTime: start });
    expect(res.status, res.body?.message ?? res.body?.id).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.invoiceId).toEqual(expect.any(String));
    const row = await bookingRow(res.body.bookingId);
    expect(row).toMatchObject({ businessId: ID.bizA, serviceId: ID.svcBooking, contactId: ID.contactPub, invoiceId: res.body.invoiceId });
    const invoice = await db.invoice.findFirst({ where: { id: res.body.invoiceId } });
    expect(invoice).toMatchObject({ businessId: ID.bizA, contactId: ID.contactPub, status: 'DRAFT' });
    expect(Number(invoice.total)).toBe(80);
  });

  it('CONTROL: /slots omits taken, closed and lead-time times', async () => {
    const iso = (d: Date) => d.toISOString();

    const taken = await slots(ID.svcSlots, '2030-01-10');
    expect(taken.status).toBe(200);
    // bkSlotTaken holds svcSlots 10:00-11:00: 09:30, 10:00 and 10:30 overlap it.
    expect(taken.body.slots).toContain(iso(at(THU, 9)));
    expect(taken.body.slots).toContain(iso(at(THU, 11)));
    for (const t of [at(THU, 9, 30), at(THU, 10), at(THU, 10, 30)]) expect(taken.body.slots).not.toContain(iso(t));
    expect(taken.body.slots[taken.body.slots.length - 1]).toBe(iso(at(THU, 16)));

    const closed = await slots(ID.svcSlots, '2030-01-06');
    expect(closed.status).toBe(200);
    expect(closed.body.slots).toEqual([]);

    const lead = await slots(ID.svcSlotsLead, '2030-01-11');
    expect(lead.status).toBe(200);
    expect(lead.body.slots[0]).toBe(iso(at(FRI, 12)));
    for (const t of [at(FRI, 9), at(FRI, 11, 30)]) expect(lead.body.slots).not.toContain(iso(t));
  });

  it('CONTROL: reschedule refuses a CANCELLED and a COMPLETED booking', async () => {
    for (const id of [ID.bkCancelled, ID.bkCompleted]) {
      const before = await bookingRow(id);
      const res = await agent()
        .post(`/bookings/businesses/${ID.bizA}/bookings/${id}/reschedule`)
        .set(HEADER, ID.ownerA)
        .send({ startTime: at(TUE, 10).toISOString() });
      expect(res.status, id).toBe(400);
      expect(res.body.message, id).toBe(MSG.reschedule);
      const after = await bookingRow(id);
      expect(after.startTime.getTime(), id).toBe(before.startTime.getTime());
      expect(after.status, id).toBe(before.status);
    }
  });

  it("CONTROL: business B cannot read, update or change the status of A's booking", async () => {
    const asB = (req: any) => req.set(HEADER, ID.ownerB);

    // Read: A's list is refused at the guard; B's own list does not carry it.
    expect((await asB(agent().get(`/bookings/businesses/${ID.bizA}`))).status).toBe(403);
    const ownList = await asB(agent().get(`/bookings/businesses/${ID.bizB}`));
    expect(ownList.status).toBe(200);
    expect(JSON.stringify(ownList.body)).not.toContain(ID.bkTenantA);

    // Update: on A's route the guard refuses; on B's route the lookup is
    // tenant-scoped (updateBookingLocation answers 400 'Booking not found').
    expect((await asB(agent().patch(`/bookings/businesses/${ID.bizA}/bookings/${ID.bkTenantA}`)).send({ location: `${P}moved` })).status).toBe(403);
    const patchViaB = await asB(agent().patch(`/bookings/businesses/${ID.bizB}/bookings/${ID.bkTenantA}`)).send({ location: `${P}moved` });
    expect(patchViaB.status).toBe(400);
    expect(patchViaB.body.message).toBe('Booking not found');

    // Status: guard refusal on A's route, 404 on B's.
    expect((await asB(agent().post(`/bookings/businesses/${ID.bizA}/bookings/${ID.bkTenantA}/status`)).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await asB(agent().post(`/bookings/businesses/${ID.bizB}/bookings/${ID.bkTenantA}/status`)).send({ status: 'CANCELLED' })).status).toBe(404);

    const row = await bookingRow(ID.bkTenantA);
    expect(row).toMatchObject({ businessId: ID.bizA, status: 'CONFIRMED', location: `${P}original-location` });
  });

  it('CONTROL + LEDGER: COMPLETED auto-invoices once; the DRAFT posts nothing, and AR posts once on issue (ACCRUAL)', async () => {
    const complete = () =>
      agent().post(`/bookings/businesses/${ID.bizA}/bookings/${ID.bkLedger}/status`).set(HEADER, ID.ownerA).send({ status: 'COMPLETED' });

    const first = await complete();
    expect(first.status, first.body?.message).toBe(201);
    const afterFirst = await bookingRow(ID.bkLedger);
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.invoiceId).toEqual(expect.any(String));

    const second = await complete();
    expect(second.status).toBe(201);
    const afterSecond = await bookingRow(ID.bkLedger);
    expect(afterSecond.invoiceId).toBe(afterFirst.invoiceId);
    const invoices = await db.invoice.findMany({ where: { businessId: ID.bizA, contactId: ID.contactLedger } });
    expect(invoices.map((i: any) => i.id)).toEqual([afterFirst.invoiceId]);
    expect(invoices[0].status).toBe('DRAFT');
    expect(Number(invoices[0].total)).toBe(100);

    const postings = () =>
      db.financialTransaction.findMany({
        where: { businessId: ID.bizA, sourceType: 'Invoice', sourceId: afterFirst.invoiceId },
        include: { entries: { include: { account: true } } },
      });
    expect(await postings(), 'a DRAFT invoice posts nothing').toEqual([]);

    await invoiceWorkflow.transition(afterFirst.invoiceId, 'SENT', { sentAt: new Date() });
    const posted = await postings();
    expect(posted).toHaveLength(1);
    const ar = posted[0].entries.filter((e: any) => e.account.systemKey === 'ACCOUNTS_RECEIVABLE');
    expect(ar).toHaveLength(1);
    expect(Number(ar[0].debit)).toBe(100);
    expect(Number(ar[0].credit)).toBe(0);
  });
});

describe('V1-06 in-app create parity (RED at the base)', () => {
  it("RED-BEFORE: another business's contactId is a 404 and writes nothing", async () => {
    const start = at(MON, 12);
    const res = await inAppCreate(ID.ownerA, ID.bizA, body(start, { contactId: ID.contactB }));
    expect(res.status, res.body?.message ?? res.body?.id).toBe(404);
    expect(await db.booking.count({ where: { contactId: ID.contactB } })).toBe(0);
  });

  it("RED-BEFORE: another business's staffId is a 404 and writes nothing", async () => {
    const start = at(MON, 12);
    const res = await inAppCreate(ID.ownerA, ID.bizA, body(start, { staffId: ID.staffB }));
    expect(res.status, res.body?.message ?? res.body?.id).toBe(404);
    expect(await db.booking.count({ where: { staffId: ID.staffB } })).toBe(0);
  });

  it("RED-BEFORE: another business's serviceId is a 404 and writes nothing", async () => {
    const start = at(MON, 13);
    const res = await inAppCreate(ID.ownerA, ID.bizA, body(start, { serviceId: ID.svcB }));
    expect(res.status, res.body?.message ?? res.body?.id).toBe(404);
    expect(await db.booking.count({ where: { serviceId: ID.svcB } })).toBe(0);
  });

  it('RED-BEFORE: a time outside business hours gets the public message', async () => {
    await expectParity('before opening', { serviceId: ID.svc, staffId: ID.staffFree, start: at(MON, 7) }, MSG.hours);
  });

  it('RED-BEFORE: a closed day gets the public message', async () => {
    await expectParity('Sunday', { serviceId: ID.svc, staffId: ID.staffFree, start: at(SUN, 10) }, MSG.closed);
  });

  it('RED-BEFORE: a time inside the lead time gets the public message', async () => {
    await expectParity('lead time', { serviceId: ID.svcLead, staffId: ID.staffFree, start: at(TUE, 11) }, MSG.lead);
  });

  it("RED-BEFORE: a time outside the staff member's hours gets the public message", async () => {
    // staffAvail works Mondays 09:00-13:00; 14:00 is inside business hours, so
    // only the staff schedule refuses it.
    await expectParity('staff hours', { serviceId: ID.svc, staffId: ID.staffAvail, start: at(MON, 14) }, MSG.staffHours);
  });

  it('RED-BEFORE: a day the staff member does not work gets the public message', async () => {
    await expectParity('staff day', { serviceId: ID.svc, staffId: ID.staffAvail, start: at(TUE, 10) }, MSG.staffDay);
  });

  it('RED-BEFORE: a create without staffId succeeds, with the service as the resource', async () => {
    const start = at(FRI, 10);
    const { staffId: _none, ...noStaff } = body(start, { serviceId: ID.svcNoStaff });
    const res = await inAppCreate(ID.ownerA, ID.bizA, noStaff);
    expect(res.status, res.body?.message ?? res.body?.id).toBe(201);
    const row = await bookingRow(res.body.id);
    expect(row).toMatchObject({ businessId: ID.bizA, serviceId: ID.svcNoStaff, staffId: null });

    // The same service half an hour later overlaps: the service is the resource.
    const { staffId: _none2, ...overlap } = body(at(FRI, 10, 30), { serviceId: ID.svcNoStaff });
    const clash = await inAppCreate(ID.ownerA, ID.bizA, overlap);
    expect(clash.status).toBe(400);
    expect(clash.body.message).toBe(MSG.taken);

    // Another service at that time is another resource.
    const { staffId: _none3, ...other } = body(at(FRI, 10, 30), { serviceId: ID.svcNoStaff2 });
    const otherRes = await inAppCreate(ID.ownerA, ID.bizA, other);
    expect(otherRes.status, otherRes.body?.message).toBe(201);
  });
});

/**
 * Review repairs (ST-1..ST-4, CR-2). Each case below failed at the packet head
 * 60749f65; the comment on each names what it observed there.
 */
describe('V1-06 review repairs', () => {
  // The public create allows 10 a minute per caller; the cases above use most.
  beforeEach(clearRateLimits);

  it("ST-1: the public path refuses another business's staff member (404) and writes nothing, as the in-app path does", async () => {
    // At 60749f65: public 201, the row held businessId=A and B's staffId.
    for (const staffId of [ID.staffBAvail, ID.staffB]) {
      const pub = await publicCreate({ serviceId: ID.svc, staffId, startTime: at(TUE, 12) });
      expect(pub.status, `${staffId}: public (${pub.body?.message ?? pub.body?.bookingId})`).toBe(404);
      expect(pub.body.message).toBe('Staff member not found');
      expect(JSON.stringify(pub.body)).not.toContain('B-secret-staff-name');

      const inApp = await inAppCreate(ID.ownerA, ID.bizA, body(at(TUE, 12), { staffId }));
      expect(inApp.status, `${staffId}: in-app`).toBe(404);
      expect(inApp.body.message).toBe(pub.body.message);
      expect(await db.booking.count({ where: { staffId } }), `${staffId}: no booking written`).toBe(0);
    }

    // A's list carries no foreign staff member.
    const list = await agent().get(`/bookings/businesses/${ID.bizA}`).set(HEADER, ID.ownerA);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('B-secret-staff-name');
  });

  it('ST-2: an in-app end at or before the start is refused with 400 and writes nothing', async () => {
    // At 60749f65: Thu 16:30 -> Thu 09:00 without staff was 201 (the hours
    // check added a negative duration).
    const cases: Array<[string, Record<string, unknown>, Date]> = [
      ['end before start, no staff', { serviceId: ID.svcNoStaff2, staffId: undefined, endTime: at(THU, 9).toISOString() }, at(THU, 16, 30)],
      ['end equal to start', { endTime: at(THU, 11).toISOString() }, at(THU, 11)],
    ];
    for (const [label, over, start] of cases) {
      const res = await inAppCreate(ID.ownerA, ID.bizA, body(start, over));
      expect(res.status, `${label} (${res.body?.message ?? res.body?.id})`).toBe(400);
      expect(res.body.message, label).toBe(MSG.endBeforeStart);
      expect(await bookingsAt(ID.bizA, start), `${label}: no booking written`).toBe(0);
    }
  });

  it('ST-2: an in-app booking spanning several days is held to every day it covers', async () => {
    // At 60749f65: staffAvail (Mondays 09:00-13:00) Mon 10:00 -> Wed 10:00 was
    // 201, because the staff check read only the time of day of the end.
    const staffSpan = await inAppCreate(ID.ownerA, ID.bizA, body(at(MON, 10), { staffId: ID.staffAvail, endTime: at(WED, 10).toISOString() }));
    expect(staffSpan.status, staffSpan.body?.message ?? staffSpan.body?.id).toBe(400);
    expect(staffSpan.body.message).toBe(MSG.staffHours);
    expect(await db.booking.count({ where: { staffId: ID.staffAvail } })).toBe(0);

    // Control: business hours already measured the span (start + length), so
    // Mon 11:00 -> Tue 11:00 was refused at 60749f65 too; it stays refused now
    // that the staff check measures the same way. A service as the resource,
    // so no booking of staffFree's is in the way.
    const hoursSpan = await inAppCreate(
      ID.ownerA,
      ID.bizA,
      body(at(MON, 11), { serviceId: ID.svcNoStaff, staffId: undefined, endTime: at(TUE, 11).toISOString() }),
    );
    expect(hoursSpan.status, hoursSpan.body?.message ?? hoursSpan.body?.id).toBe(400);
    expect(hoursSpan.body.message).toBe(MSG.hours);
    expect(await bookingsAt(ID.bizA, at(MON, 11))).toBe(0);

    // A same-day booking longer than the service, inside hours, is still the
    // caller's choice (the web form sends its own end time).
    const longer = await inAppCreate(ID.ownerA, ID.bizA, body(at(THU, 9), { endTime: at(THU, 10, 30).toISOString() }));
    expect(longer.status, longer.body?.message ?? longer.body?.id).toBe(201);
  });

  it("ST-3: another business's orgUnitId is a 404 on both create paths and writes nothing; A's own is kept", async () => {
    // At 60749f65: in-app 201 with orgUnitId=orgB, and A's list showed B's
    // org-unit name.
    const inApp = await inAppCreate(ID.ownerA, ID.bizA, body(at(FRI, 13), { orgUnitId: ID.orgB }));
    expect(inApp.status, inApp.body?.message ?? inApp.body?.id).toBe(404);
    expect(inApp.body.message).toBe('Org unit not found');

    const pub = await publicCreate({ serviceId: ID.svc, startTime: at(FRI, 14), orgUnitId: ID.orgB });
    expect(pub.status, pub.body?.message ?? pub.body?.bookingId).toBe(404);
    expect(pub.body.message).toBe('Org unit not found');
    expect(await db.booking.count({ where: { orgUnitId: ID.orgB } })).toBe(0);

    const own = await inAppCreate(ID.ownerA, ID.bizA, body(at(FRI, 13), { orgUnitId: ID.orgA }));
    expect(own.status, own.body?.message ?? own.body?.id).toBe(201);
    expect((await bookingRow(own.body.id)).orgUnitId).toBe(ID.orgA);

    const list = await agent().get(`/bookings/businesses/${ID.bizA}`).set(HEADER, ID.ownerA);
    expect(JSON.stringify(list.body)).not.toContain('B-secret-branch');
  });

  it('ST-4: a member cannot book a contact their CRM view hides; the refusal is a 404 that discloses nothing', async () => {
    // At 60749f65: the STAFF member (crm_view 'owned') booked ownerA's PRIVATE
    // contact with 201 and the body carried its email and phone.
    for (const contactId of [ID.contactPrivate, ID.contactA]) {
      const res = await inAppCreate(ID.staffUser, ID.bizA, body(at(THU, 12), { contactId }));
      expect(res.status, `${contactId} (${res.body?.message ?? res.body?.id})`).toBe(404);
      expect(res.body.message).toBe('Contact not found');
      expect(JSON.stringify(res.body)).not.toContain('secret@test.local');
      expect(JSON.stringify(res.body)).not.toContain('+18685559999');
    }
    expect(await bookingsAt(ID.bizA, at(THU, 12))).toBe(0);

    // The member's own contact is bookable.
    const own = await inAppCreate(ID.staffUser, ID.bizA, body(at(THU, 15), { contactId: ID.contactStaffOwned }));
    expect(own.status, own.body?.message ?? own.body?.id).toBe(201);
    expect((await bookingRow(own.body.id)).contactId).toBe(ID.contactStaffOwned);

    // The owner sees every contact, so the PRIVATE one is bookable for them.
    const owner = await inAppCreate(ID.ownerA, ID.bizA, body(at(THU, 12), { contactId: ID.contactPrivate }));
    expect(owner.status, owner.body?.message ?? owner.body?.id).toBe(201);
    expect((await bookingRow(owner.body.id)).contactId).toBe(ID.contactPrivate);
  });

  it('CR-2: a day row without open/close times does not crash either create path', async () => {
    // At 60749f65: in-app 500 (TypeError reading split of undefined); at the
    // base the in-app create was 201. The public path crashed at both.
    const { staffId: _none, ...inAppBody } = body(at(MON, 10), { contactId: ID.contactC, serviceId: ID.svcC });
    const inApp = await inAppCreate(ID.ownerA, ID.bizC, inAppBody);
    expect(inApp.status, inApp.body?.message ?? inApp.body?.id).toBe(201);
    expect(await bookingRow(inApp.body.id)).toMatchObject({ businessId: ID.bizC, contactId: ID.contactC });

    const pub = await publicCreate({ businessId: ID.bizC, serviceId: ID.svcC, startTime: at(MON, 12) });
    expect(pub.status, pub.body?.message ?? pub.body?.bookingId).toBe(201);
    expect(await bookingRow(pub.body.bookingId)).toMatchObject({ businessId: ID.bizC, serviceId: ID.svcC });
  });

  // CR-1 was disclosed here and left for V1-16: both create paths and
  // getAvailableSlots read hours and weekdays in the server's local time.
  // V1-16 moved all three to Business.timezone together (the picker's half is
  // in booking-concurrency.integration.test.ts), so a slot the picker offers is
  // never refused on submit.
  it('CR-1 (V1-16): in-app and public creates read business hours in Business.timezone, not the server timezone', async () => {
    // At the V1-06 head, with the server at UTC (production's TZ unset), bizTz's
    // 09:00-17:00 was read as 09:00Z-17:00Z: 13:00 local (17:00Z) was refused
    // as outside business hours and 08:00 local (12:00Z) was accepted.
    const previousTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // Monday 2030-01-07. Port_of_Spain is UTC-4 all year.
      const pub = await publicCreate({ businessId: ID.bizTz, serviceId: ID.svcTz, startTime: new Date('2030-01-07T17:00:00.000Z') }); // 13:00 local
      expect(pub.status, pub.body?.message ?? pub.body?.bookingId).toBe(201);
      const tzBody = (start: Date, over: Record<string, unknown> = {}) => ({
        ...body(start, { contactId: ID.contactTz, serviceId: ID.svcTz2, ...over }),
        staffId: undefined,
      });
      const inApp = await inAppCreate(ID.ownerA, ID.bizTz, tzBody(new Date('2030-01-07T20:00:00.000Z'))); // 16:00-17:00 local
      expect(inApp.status, inApp.body?.message ?? inApp.body?.id).toBe(201);
      expect(await bookingRow(inApp.body.id)).toMatchObject({ businessId: ID.bizTz, serviceId: ID.svcTz2 });

      // 08:00 local is before opening on both paths, with the public message.
      const early = new Date('2030-01-07T12:00:00.000Z');
      const earlyPub = await publicCreate({ businessId: ID.bizTz, serviceId: ID.svcTz, startTime: early });
      expect(earlyPub.status).toBe(400);
      expect(earlyPub.body.message).toBe(MSG.hours);
      const earlyInApp = await inAppCreate(ID.ownerA, ID.bizTz, tzBody(early));
      expect(earlyInApp.status).toBe(400);
      expect(earlyInApp.body.message).toBe(MSG.hours);

      // Saturday 2030-01-12 at 02:00Z is still Friday 22:00 local: closed by
      // the hour, not by the (UTC) weekday.
      const lateFriday = await inAppCreate(ID.ownerA, ID.bizTz, tzBody(new Date('2030-01-12T02:00:00.000Z')));
      expect(lateFriday.status).toBe(400);
      expect(lateFriday.body.message).toBe(MSG.hours);
      expect(await db.booking.count({ where: { businessId: ID.bizTz } }), 'only the two in-hours bookings').toBe(2);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });
});
