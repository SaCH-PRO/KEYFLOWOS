/**
 * V1-88 PR196-ATTRIB-CURRENCY: the storefront booking's revenue attribution row
 * is written in the business currency (D-13), against a REAL database.
 *
 * PR #196 feature F2c. BookingsService.publicCreateBooking records one
 * revenue_attributions row per public booking (revenueType BOOKING, the
 * service price, recognised at create time for the growth dashboards). It
 * passed the literal `currency: 'TTD'`, so a USD business's storefront
 * bookings were attributed as TTD revenue, while the invoice the same booking
 * drew up was USD (CommerceService.documentCurrency, V1-37). D-13: one currency
 * per business, documents default to it. The row must carry
 * normalizeCurrency(business.currency), falling back to 'TTD' only when the
 * business has none, as documentCurrency does. PR #196 read a Service.currency
 * column that does not exist and did not normalise (review MC-10); neither is
 * ported.
 *
 * Cases:
 *   RED-BEFORE (fail on the unmodified service):
 *     - a public booking on a USD business: the attribution row is USD, at the
 *       service price, for that booking, contact and business; the booking and
 *       the response are otherwise unchanged;
 *     - a business currency stored as ' usd ' is recorded as 'USD';
 *     - an invoiceTiming BOOKING service on a USD business: the booking's
 *       invoice and its attribution row carry the same currency.
 *   CONTROL (green before and after):
 *     - a TTD business stays TTD;
 *     - a business with a blank currency falls back to 'TTD';
 *     - a USD business's booking writes no attribution row in another business.
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), HoneypotGuard,
 * BookingsController, BookingsService, RevenueAttributionService (the writer
 * under test) and CommerceService (invoice creation) read and write real rows
 * behind the production GlobalHttpExceptionFilter and ValidationPipe. The
 * public route is anonymous, so no identity is attached. Collaborators off the
 * boundary are stubs: the event bus, the public path's contact resolution
 * (CrmService.findOrCreateContact upserts one prefixed contact per business),
 * storefront events, email, plan limits (always allowed) and the calendar.
 *
 * Fixtures: prefix `v88a_` (registered in test/helpers/fixture-prefixes.json);
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

const P = 'v88a_';

// This suite's public rate-limit keys live under its own namespace.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerUsd: `${P}ownerUsd`,
  ownerTtd: `${P}ownerTtd`,
  ownerLower: `${P}ownerLower`,
  ownerBlank: `${P}ownerBlank`,
  bizUsd: `${P}bizUsd`,
  bizTtd: `${P}bizTtd`,
  bizLower: `${P}bizLower`, // currency stored as ' usd '
  bizBlank: `${P}bizBlank`, // currency stored as ''
  svcUsd: `${P}svcUsd`, // COMPLETION timing (the default): no invoice at create
  svcUsdBooking: `${P}svcUsdBooking`, // BOOKING timing: a DRAFT invoice at create
  svcTtd: `${P}svcTtd`,
  svcLower: `${P}svcLower`,
  svcBlank: `${P}svcBlank`,
};

/** A start time well in the future, distinct per case so no slot collides. */
const at = (day: number, hour: number) => new Date(Date.UTC(2031, 2, day, hour, 0, 0, 0));

let db: any;
let app: any;
let redis: any;

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

/** One prefixed public contact per business, so the booking's contact is a real row of that tenant. */
const crmStub = {
  logContactEvent: async () => null,
  findOrCreateContact: async (businessId: string, input: { firstName?: string | null; lastName?: string | null; email?: string | null }) => {
    const id = `${P}contact_${businessId.slice(P.length)}`;
    return db.contact.upsert({
      where: { id },
      update: {},
      create: { id, businessId, firstName: input.firstName ?? 'Public', lastName: input.lastName ?? null, email: input.email ?? null },
    });
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

/** The public widget's create, anonymous, through the real route and guards. */
function publicCreate(businessId: string, serviceId: string, startTime: Date) {
  return request(app.getHttpServer())
    .post(`/bookings/public/businesses/${businessId}`)
    .send({
      serviceId,
      startTime: startTime.toISOString(),
      firstName: 'Pat',
      lastName: 'Public',
      email: `${P}public@test.local`,
      phone: '+18685550100',
    });
}

/** The BOOKING attribution row of a booking, read in its own business. */
function attributionOf(businessId: string, bookingId: string) {
  return db.revenueAttribution.findFirst({ where: { businessId, revenueType: 'BOOKING', revenueId: bookingId } });
}

async function seedBusiness(ownerId: string, businessId: string, name: string, currency: string) {
  await db.user.create({ data: { id: ownerId, email: `${P}${ownerId.slice(P.length)}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: businessId, name, ownerId, currency, timezone: 'UTC' } });
  await db.membership.create({ data: { id: `${P}m_${businessId.slice(P.length)}`, userId: ownerId, businessId, role: 'OWNER' } });
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

  // The create handlers' parameter types as tsc emits them for the production
  // build (emitDecoratorMetadata), which vitest's esbuild transform does not:
  // without them the global ValidationPipe passes every body unchecked.
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
      // The writer under test, real.
      RevenueAttributionService,
      // Invoice creation is real (the BOOKING-timing case compares currencies).
      CommerceService,
      InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      CatalogService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
      { provide: BookingOptimizerService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await seedBusiness(ID.ownerUsd, ID.bizUsd, 'V88A USD Biz', 'USD');
  await seedBusiness(ID.ownerTtd, ID.bizTtd, 'V88A TTD Biz', 'TTD');
  await seedBusiness(ID.ownerLower, ID.bizLower, 'V88A Lowercase Biz', ' usd ');
  await seedBusiness(ID.ownerBlank, ID.bizBlank, 'V88A Blank Biz', '');

  await db.service.create({ data: { id: ID.svcUsd, businessId: ID.bizUsd, name: 'USD Consult', duration: 60, price: 150 } });
  await db.service.create({
    data: { id: ID.svcUsdBooking, businessId: ID.bizUsd, name: 'USD Prepaid', duration: 60, price: 80, invoiceTiming: 'BOOKING' },
  });
  await db.service.create({ data: { id: ID.svcTtd, businessId: ID.bizTtd, name: 'TTD Consult', duration: 60, price: 300 } });
  await db.service.create({ data: { id: ID.svcLower, businessId: ID.bizLower, name: 'Lower Consult', duration: 30, price: 45.5 } });
  await db.service.create({ data: { id: ID.svcBlank, businessId: ID.bizBlank, name: 'Blank Consult', duration: 30, price: 60 } });
}, 60_000);

beforeEach(async () => {
  await clearRateLimits();
});

afterAll(async () => {
  try {
    if (db) await cleanup();
    if (redis) {
      await clearRateLimits();
      await redis.quit();
    }
    if (app) await app.close();
  } finally {
    if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
    else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  }
});

describe('V1-88 PR196-ATTRIB-CURRENCY: storefront booking attribution in the business currency (D-13)', () => {
  it('RED-BEFORE: a public booking on a USD business records its attribution row in USD, and nothing else about the booking changes', async () => {
    const start = at(3, 14);
    const res = await publicCreate(ID.bizUsd, ID.svcUsd, start);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    const bookingId: string = res.body.bookingId;
    expect(bookingId).toBeTruthy();
    // COMPLETION timing: no invoice and no deposit at create, as before.
    expect(res.body.invoiceId).toBeUndefined();
    expect(res.body.depositInvoiceId).toBeUndefined();
    expect(res.body.depositAmount).toBe(0);

    const booking = await db.booking.findFirst({ where: { id: bookingId } });
    expect(booking).toMatchObject({
      businessId: ID.bizUsd,
      serviceId: ID.svcUsd,
      contactId: `${P}contact_bizUsd`,
      invoiceId: null,
      depositInvoiceId: null,
    });
    expect(booking.startTime.toISOString()).toBe(start.toISOString());
    expect(booking.endTime.toISOString()).toBe(new Date(start.getTime() + 60 * 60_000).toISOString());

    const row = await attributionOf(ID.bizUsd, bookingId);
    expect(row, 'one BOOKING attribution row for the booking').toBeTruthy();
    expect(row.currency, 'the business currency, not the literal TTD').toBe('USD');
    expect(row).toMatchObject({
      businessId: ID.bizUsd,
      source: 'storefront',
      sourceDetail: 'public-booking',
      revenueType: 'BOOKING',
      revenueId: bookingId,
      contactId: `${P}contact_bizUsd`,
      amount: 150,
    });
    expect(row.occurredAt.toISOString()).toBe(booking.createdAt.toISOString());
  });

  it('RED-BEFORE: a business currency stored as " usd " is recorded normalised, as USD', async () => {
    const res = await publicCreate(ID.bizLower, ID.svcLower, at(4, 10));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await attributionOf(ID.bizLower, res.body.bookingId);
    expect(row, 'one BOOKING attribution row for the booking').toBeTruthy();
    expect(row.currency).toBe('USD');
    expect(row.amount).toBe(45.5);
  });

  it('RED-BEFORE: a BOOKING-timing service on a USD business: the invoice and the attribution row carry one currency', async () => {
    const res = await publicCreate(ID.bizUsd, ID.svcUsdBooking, at(5, 9));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invoiceId).toBeTruthy();
    const invoice = await db.invoice.findFirst({ where: { id: res.body.invoiceId, businessId: ID.bizUsd } });
    expect(invoice).toMatchObject({ status: 'DRAFT', currency: 'USD', total: 80 });
    const booking = await db.booking.findFirst({ where: { id: res.body.bookingId } });
    expect(booking.invoiceId).toBe(invoice.id);

    const row = await attributionOf(ID.bizUsd, res.body.bookingId);
    expect(row, 'one BOOKING attribution row for the booking').toBeTruthy();
    expect(row.amount).toBe(80);
    expect(row.currency, 'the attribution row is in the invoice currency').toBe(invoice.currency);
  });

  it('CONTROL: a TTD business stays TTD', async () => {
    const res = await publicCreate(ID.bizTtd, ID.svcTtd, at(6, 11));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await attributionOf(ID.bizTtd, res.body.bookingId);
    expect(row).toMatchObject({ businessId: ID.bizTtd, revenueType: 'BOOKING', currency: 'TTD', amount: 300 });
  });

  it('CONTROL: a business with a blank currency falls back to TTD, as its documents do', async () => {
    const res = await publicCreate(ID.bizBlank, ID.svcBlank, at(7, 11));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await attributionOf(ID.bizBlank, res.body.bookingId);
    expect(row).toMatchObject({ businessId: ID.bizBlank, revenueType: 'BOOKING', currency: 'TTD', amount: 60 });
  });

  it('CONTROL: the USD business booking writes its attribution row in its own business only', async () => {
    const res = await publicCreate(ID.bizUsd, ID.svcUsd, at(10, 15));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await db.revenueAttribution.findMany({ where: { revenueType: 'BOOKING', revenueId: res.body.bookingId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBe(ID.bizUsd);
  });
});
