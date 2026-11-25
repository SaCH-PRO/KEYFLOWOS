/**
 * V1-64 (SWP-SERVICE-DEPOSIT, BUG-048, Journeys B & F) — server half:
 * Real-Postgres + real HTTP integration proof that services persist and
 * validate deposit terms (`depositRequired`, `depositType`, `depositValue`),
 * bookings of those services bill the configured deposit invoice, and the
 * Presence overview `POPULAR_SERVICE_ADD_DEPOSIT` tip links to the service
 * editor (`/app/bookings?tab=catalog&serviceId=...`) and disappears once a
 * deposit is configured.
 *
 * Pre-allocated fixture prefix: `v64j_` (registered in
 * `apps/server/test/helpers/fixture-prefixes.json`, cleaned up with
 * `sqlLikePrefix(P)`).
 *
 * Cases:
 *   SDS-01: POST & PATCH `/catalog/businesses/:b/services` (and `/bookings/businesses/:b/services`)
 *           persist `depositRequired`, `depositType`, `depositValue` (PERCENT 25, FIXED 80,
 *           and disabling `depositRequired: false` clears depositType/depositValue).
 *   SDS-02: Validation rules — PERCENT must be 1..100, FIXED must be > 0 and <= price,
 *           missing/unknown depositType or non-finite value when depositRequired=true -> 400;
 *           PATCH lowering price below existing FIXED depositValue -> 400; boundary values
 *           PERCENT=1, PERCENT=100, FIXED===price succeed.
 *   SDS-03: Booking a service created with depositRequired=true, PERCENT 25 on price 200
 *           through BookingsService bills a DEPOSIT invoice for 50.00 (depositInvoiceId set,
 *           invoiceId null).
 *   SDS-04: PresenceOverviewService `POPULAR_SERVICE_ADD_DEPOSIT` card links to
 *           `/app/bookings?tab=catalog&serviceId=<id>` (not `/app/store?...`) when a popular
 *           service has no deposit, and stops appearing once the service is PATCHed with a deposit.
 *   SDS-05: Cross-tenant PATCH is denied (403) without mutating deposit fields;
 *           PUBLIC_SERVICE_SELECT continues excluding deposit terms (D-26/D-59/D-80 unchanged).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { db } from '@keyflow/db';
import { configureNestApp } from '../src/app-bootstrap';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { PublicRateLimitGuard } from '../src/core/guards/public-rate-limit.guard';
import { HoneypotGuard } from '../src/core/guards/honeypot.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { CatalogService, PUBLIC_SERVICE_SELECT } from '../src/modules/catalog/catalog.service';
import { BookingsController } from '../src/modules/bookings/bookings.controller';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { BookingWaitlistService } from '../src/modules/bookings/booking-waitlist.service';
import { CalendarService } from '../src/modules/bookings/calendar.service';
import { BookingOptimizerService } from '../src/modules/bookings/booking-optimizer.service';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { CommerceStatsService } from '../src/modules/commerce/commerce-stats.service';
import { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import { RevenueAttributionService } from '../src/modules/commerce/revenue-attribution.service';
import { RevenuePostingService } from '../src/modules/finance/revenue-posting.service';
import { PostingService } from '../src/modules/finance/posting.service';
import { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import { ExpensePostingService } from '../src/modules/finance/expense-posting.service';
import { TransactionalEmailService } from '../src/modules/notifications/transactional-email.service';
import { PublicEventsService } from '../src/modules/public-events/public-events.service';
import { TimelineService } from '../src/modules/timeline/timeline.service';
import { CrmService } from '../src/modules/crm/crm.service';
import { PresenceOverviewService } from '../src/modules/site/presence/presence-overview.service';
import { PresenceService } from '../src/modules/site/presence/presence.service';
import { RevenueActionService } from '../src/modules/commerce/revenue-action.service';
import { StoreOrderService } from '../src/modules/site/store-order.service';
import { PresenceStatsService } from '../src/modules/public-events/presence-stats.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

const P = 'v64j_';
const HEADER = 'x-v64j-user';

const ID = {
  owner: `${P}owner`,
  otherOwner: `${P}other_owner`,
  biz: `${P}biz`,
  bizOther: `${P}biz_other`,
  contact: `${P}contact`,
};

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM presence_daily_stats WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM public_events WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)})`);
  await db.$executeRawUnsafe(`DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`);
  await db.$executeRawUnsafe(`DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

describe('V1-64 (SWP-SERVICE-DEPOSIT, BUG-048) — server half', () => {
  let app: any;
  let redis: any;
  let presenceOverview: PresenceOverviewService;

  beforeAll(async () => {
    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.owner, email: `${P}owner@test.local`, name: 'v64j Owner', role: 'USER' },
        { id: ID.otherOwner, email: `${P}other@test.local`, name: 'v64j Other', role: 'USER' },
      ],
    });
    await db.business.createMany({
      data: [
        { id: ID.biz, name: 'v64j Studio', slug: `${P}studio`, ownerId: ID.owner, currency: 'TTD', storeEnabled: true },
        { id: ID.bizOther, name: 'v64j Other Biz', slug: `${P}other`, ownerId: ID.otherOwner, currency: 'TTD' },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}m_owner`, businessId: ID.biz, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_other`, businessId: ID.bizOther, userId: ID.otherOwner, role: 'OWNER' },
      ],
    });
    await db.contact.create({
      data: {
        id: ID.contact,
        businessId: ID.biz,
        firstName: 'Ada',
        lastName: 'Deposit',
        email: `${P}ada@test.local`,
      },
    });

    const IORedis = (await import('ioredis')).default;
    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

    const prismaStub = { client: db } as unknown as PrismaService;
    const offRoute = {};
    const crmStub = {
      findOrCreateContact: async () => ({ id: ID.contact, firstName: 'Ada', lastName: 'Deposit', email: `${P}ada@test.local` }),
      logContactEvent: async () => null,
    };

    const ref = await Test.createTestingModule({
      controllers: [CatalogController, BookingsController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PlanLimitGuard,
        PublicRateLimitGuard,
        HoneypotGuard,
        TeamAuditInterceptor,
        { provide: REDIS_CLIENT, useValue: redis },
        CatalogService,
        BookingsService,
        CommerceService,
        InvoiceWorkflowService,
        RevenuePostingService,
        PostingService,
        AccountingPeriodService,
        ChartOfAccountsSeederService,
        PresenceOverviewService,
        { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
        { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [] } },
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
        { provide: PresenceService, useValue: { getSectionCompleteness: async () => ({ total: 5, completed: 5, sections: [] }) } },
        { provide: RevenueActionService, useValue: offRoute },
        { provide: StoreOrderService, useValue: offRoute },
        { provide: PresenceStatsService, useValue: offRoute },
      ],
    }).compile();

    presenceOverview = ref.get(PresenceOverviewService);

    app = ref.createNestApplication();
    app.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const found = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (found) req.user = { id: found.id, email: found.email, role: found.role };
      }
      next();
    });
    configureNestApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (redis) await redis.quit().catch(() => undefined);
    await cleanup();
  });

  const createCatalogService = (body: Record<string, unknown>, user = ID.owner, biz = ID.biz) =>
    request(app.getHttpServer()).post(`/catalog/businesses/${biz}/services`).set(HEADER, user).send(body);

  const patchCatalogService = (serviceId: string, body: Record<string, unknown>, user = ID.owner, biz = ID.biz) =>
    request(app.getHttpServer()).patch(`/catalog/businesses/${biz}/services/${serviceId}`).set(HEADER, user).send(body);

  const createBookingsService = (body: Record<string, unknown>, user = ID.owner, biz = ID.biz) =>
    request(app.getHttpServer()).post(`/bookings/businesses/${biz}/services`).set(HEADER, user).send(body);

  const patchBookingsService = (serviceId: string, body: Record<string, unknown>, user = ID.owner, biz = ID.biz) =>
    request(app.getHttpServer()).patch(`/bookings/businesses/${biz}/services/${serviceId}`).set(HEADER, user).send(body);

  it('[SDS-01] RED-BEFORE: create & PATCH a service with depositRequired PERCENT 25 and FIXED 80 persists fields on both catalog and bookings routes, and toggling depositRequired false clears them', async () => {
    const created = await createCatalogService({
      name: `${P}Haircut`,
      duration: 60,
      price: 200,
      depositRequired: true,
      depositType: 'PERCENT',
      depositValue: 25,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.depositRequired).toBe(true);
    expect(created.body.depositType).toBe('PERCENT');
    expect(created.body.depositValue).toBe(25);

    const stored = await db.service.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.depositRequired).toBe(true);
    expect(stored.depositType).toBe('PERCENT');
    expect(stored.depositValue).toBe(25);

    // PATCH to FIXED 80
    const patchedFixed = await patchCatalogService(created.body.id, {
      depositRequired: true,
      depositType: 'FIXED',
      depositValue: 80,
    });
    expect(patchedFixed.status, JSON.stringify(patchedFixed.body)).toBe(200);
    expect(patchedFixed.body.depositRequired).toBe(true);
    expect(patchedFixed.body.depositType).toBe('FIXED');
    expect(patchedFixed.body.depositValue).toBe(80);

    // PATCH toggling off clears depositType & depositValue cleanly
    const patchedOff = await patchCatalogService(created.body.id, { depositRequired: false });
    expect(patchedOff.status, JSON.stringify(patchedOff.body)).toBe(200);
    expect(patchedOff.body.depositRequired).toBe(false);
    expect(patchedOff.body.depositType).toBeNull();
    expect(patchedOff.body.depositValue).toBeNull();

    // Deprecated /bookings/.../services passthrough persists too
    const viaBookings = await createBookingsService({
      name: `${P}Consult`,
      duration: 45,
      price: 150,
      depositRequired: true,
      depositType: 'PERCENT',
      depositValue: 20,
    });
    expect(viaBookings.status, JSON.stringify(viaBookings.body)).toBe(201);
    expect(viaBookings.body.depositRequired).toBe(true);
    expect(viaBookings.body.depositType).toBe('PERCENT');
    expect(viaBookings.body.depositValue).toBe(20);

    const viaBookingsPatch = await patchBookingsService(viaBookings.body.id, {
      depositRequired: true,
      depositType: 'FIXED',
      depositValue: 50,
    });
    expect(viaBookingsPatch.status, JSON.stringify(viaBookingsPatch.body)).toBe(200);
    expect(viaBookingsPatch.body.depositType).toBe('FIXED');
    expect(viaBookingsPatch.body.depositValue).toBe(50);
  });

  it('[SDS-02] RED-BEFORE: PERCENT outside 1..100, FIXED <= 0 or > price, missing/invalid depositType, and PATCH lowering price below FIXED deposit all return 400; exact boundaries succeed', async () => {
    const invalidCreates: Array<[string, Record<string, unknown>]> = [
      ['PERCENT 0', { name: `${P}inv1`, duration: 30, price: 200, depositRequired: true, depositType: 'PERCENT', depositValue: 0 }],
      ['PERCENT 101', { name: `${P}inv2`, duration: 30, price: 200, depositRequired: true, depositType: 'PERCENT', depositValue: 101 }],
      ['PERCENT -5', { name: `${P}inv3`, duration: 30, price: 200, depositRequired: true, depositType: 'PERCENT', depositValue: -5 }],
      ['FIXED 0', { name: `${P}inv4`, duration: 30, price: 200, depositRequired: true, depositType: 'FIXED', depositValue: 0 }],
      ['FIXED -10', { name: `${P}inv5`, duration: 30, price: 200, depositRequired: true, depositType: 'FIXED', depositValue: -10 }],
      ['FIXED above price', { name: `${P}inv6`, duration: 30, price: 200, depositRequired: true, depositType: 'FIXED', depositValue: 200.01 }],
      ['missing depositType', { name: `${P}inv7`, duration: 30, price: 200, depositRequired: true, depositValue: 25 }],
      ['missing depositValue', { name: `${P}inv8`, duration: 30, price: 200, depositRequired: true, depositType: 'PERCENT' }],
      ['unknown depositType', { name: `${P}inv9`, duration: 30, price: 200, depositRequired: true, depositType: 'FLAT', depositValue: 25 }],
      ['FIXED on free service', { name: `${P}inv10`, duration: 30, price: 0, depositRequired: true, depositType: 'FIXED', depositValue: 10 }],
    ];
    for (const [label, body] of invalidCreates) {
      const res = await createCatalogService(body);
      expect(res.status, `${label} must return 400, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(400);
    }

    // Exact valid boundaries: PERCENT=1, PERCENT=100, FIXED===price, and free service with depositRequired=false
    const pct1 = await createCatalogService({ name: `${P}b1`, duration: 30, price: 100, depositRequired: true, depositType: 'PERCENT', depositValue: 1 });
    expect(pct1.status, JSON.stringify(pct1.body)).toBe(201);
    const pct100 = await createCatalogService({ name: `${P}b2`, duration: 30, price: 100, depositRequired: true, depositType: 'PERCENT', depositValue: 100 });
    expect(pct100.status, JSON.stringify(pct100.body)).toBe(201);
    const fixedEq = await createCatalogService({ name: `${P}b3`, duration: 30, price: 120, depositRequired: true, depositType: 'FIXED', depositValue: 120 });
    expect(fixedEq.status, JSON.stringify(fixedEq.body)).toBe(201);
    const freeNoDep = await createCatalogService({ name: `${P}b4`, duration: 30, price: 0, depositRequired: false });
    expect(freeNoDep.status, JSON.stringify(freeNoDep.body)).toBe(201);

    // PATCH lowering price below existing FIXED depositValue -> 400 (stored price & deposit unchanged)
    const lowerPrice = await patchCatalogService(fixedEq.body.id, { price: 80 });
    expect(lowerPrice.status, JSON.stringify(lowerPrice.body)).toBe(400);
    const stillEq = await db.service.findUniqueOrThrow({ where: { id: fixedEq.body.id } });
    expect(stillEq.price).toBe(120);
    expect(stillEq.depositValue).toBe(120);

    // PATCH raising FIXED depositValue above price -> 400
    const raiseDep = await patchCatalogService(fixedEq.body.id, { depositValue: 150 });
    expect(raiseDep.status, JSON.stringify(raiseDep.body)).toBe(400);

    // COR-P69-1: partial PATCH updating only depositValue on an enabled service preserves depositRequired & depositType
    const partialPct = await patchCatalogService(pct1.body.id, { depositValue: 30 });
    expect(partialPct.status, JSON.stringify(partialPct.body)).toBe(200);
    expect(partialPct.body.depositRequired).toBe(true);
    expect(partialPct.body.depositType).toBe('PERCENT');
    expect(partialPct.body.depositValue).toBe(30);

    // COR-P69-1: partial PATCH toggling depositRequired: true without prior config -> 400
    const enableWithoutConfig = await patchCatalogService(freeNoDep.body.id, { depositRequired: true });
    expect(enableWithoutConfig.status, JSON.stringify(enableWithoutConfig.body)).toBe(400);

    // COR-P69-1: supplying depositType/depositValue while depositRequired is omitted & effectively false -> 400 (no silent discard)
    const createOmittedFlag = await createCatalogService({
      name: `${P}inv_omitted`,
      duration: 30,
      price: 200,
      depositType: 'PERCENT',
      depositValue: 25,
    });
    expect(createOmittedFlag.status, JSON.stringify(createOmittedFlag.body)).toBe(400);
    const patchOmittedFlag = await patchCatalogService(freeNoDep.body.id, {
      depositType: 'PERCENT',
      depositValue: 25,
    });
    expect(patchOmittedFlag.status, JSON.stringify(patchOmittedFlag.body)).toBe(400);

    // Explicit clearing with nulls when depositRequired is false stays valid
    const patchNulls = await patchCatalogService(freeNoDep.body.id, {
      depositType: null,
      depositValue: null,
    });
    expect(patchNulls.status, JSON.stringify(patchNulls.body)).toBe(200);

    // COR-P69-2: /bookings passthrough rejects malformed depositType/depositValue even when depositRequired is false
    const badBookingsType = await createBookingsService({
      name: `${P}inv_b_type`,
      duration: 30,
      price: 100,
      depositRequired: false,
      depositType: 'BOGUS',
    });
    expect(badBookingsType.status, JSON.stringify(badBookingsType.body)).toBe(400);
    const badBookingsVal = await patchBookingsService(freeNoDep.body.id, {
      depositRequired: false,
      depositValue: 'not-a-number',
    });
    expect(badBookingsVal.status, JSON.stringify(badBookingsVal.body)).toBe(400);
  });

  it('[SDS-03] RED-BEFORE: booking a service configured via API with PERCENT 25 on price 200 bills a 50.00 DEPOSIT invoice', async () => {
    const svcRes = await createCatalogService({
      name: `${P}DeepTissue`,
      duration: 60,
      price: 200,
      depositRequired: true,
      depositType: 'PERCENT',
      depositValue: 25,
    });
    expect(svcRes.status, JSON.stringify(svcRes.body)).toBe(201);

    const startTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    startTime.setUTCHours(14, 0, 0, 0);
    const bookRes = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.biz}`)
      .send({
        serviceId: svcRes.body.id,
        startTime: startTime.toISOString(),
        firstName: 'Ada',
        lastName: 'Deposit',
        email: `${P}ada@test.local`,
        phone: '+18685550164',
      });
    expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201);
    expect(bookRes.body.depositInvoiceId, 'booking must bill an up-front deposit invoice').toBeTruthy();

    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookRes.body.bookingId } });
    expect(booking.depositInvoiceId).toBe(bookRes.body.depositInvoiceId);
    expect(booking.invoiceId).toBeNull();

    const depInv = await db.invoice.findUniqueOrThrow({ where: { id: booking.depositInvoiceId! } });
    expect(Number(depInv.total)).toBe(50);
  });

  it('[SDS-04] RED-BEFORE: PresenceOverview POPULAR_SERVICE_ADD_DEPOSIT tip links to /app/bookings?tab=catalog&serviceId=<id> (never /app/store) and clears once a deposit is added', async () => {
    const svcRes = await createCatalogService({
      name: `${P}PopularMassage`,
      duration: 60,
      price: 180,
    });
    expect(svcRes.status, JSON.stringify(svcRes.body)).toBe(201);
    const svcId = svcRes.body.id as string;

    // Seed 4 booking_complete events for this service in PresenceDailyStat so it qualifies (count >= 3).
    const yesterday = new Date();
    yesterday.setUTCHours(0, 0, 0, 0);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await db.presenceDailyStat.create({
      data: {
        id: `${P}stat_pop_svc`,
        businessId: ID.biz,
        day: yesterday,
        dimension: 'service',
        dimKey: svcId,
        metric: 'booking_complete',
        count: 4,
        uniques: 4,
      },
    });

    const overviewBefore = await presenceOverview.getOverview(ID.biz, 30);
    const depositCard = overviewBefore.actionCards.find(
      (c) => c.key === 'POPULAR_SERVICE_ADD_DEPOSIT' && c.relatedId === svcId,
    );
    expect(depositCard, 'popular service without deposit must surface POPULAR_SERVICE_ADD_DEPOSIT').toBeDefined();
    expect(depositCard!.ctaHref).toBe(`/app/bookings?tab=catalog&serviceId=${encodeURIComponent(svcId)}`);
    expect(depositCard!.ctaHref).not.toContain('/app/store');

    // Configure deposit via PATCH -> tip must clear on next overview read.
    const patched = await patchCatalogService(svcId, {
      depositRequired: true,
      depositType: 'PERCENT',
      depositValue: 25,
    });
    expect(patched.status).toBe(200);

    const overviewAfter = await presenceOverview.getOverview(ID.biz, 30);
    const depositCardAfter = overviewAfter.actionCards.find(
      (c) => c.key === 'POPULAR_SERVICE_ADD_DEPOSIT' && c.relatedId === svcId,
    );
    expect(depositCardAfter, 'service with deposit configured must no longer show POPULAR_SERVICE_ADD_DEPOSIT').toBeUndefined();
  });

  it('[SDS-05] cross-tenant PATCH is refused (403) without mutating deposit fields; PUBLIC_SERVICE_SELECT still excludes deposit fields', async () => {
    const svcRes = await createCatalogService({
      name: `${P}TenantCheck`,
      duration: 30,
      price: 100,
    });
    expect(svcRes.status).toBe(201);

    const crossPatch = await patchCatalogService(
      svcRes.body.id,
      { depositRequired: true, depositType: 'PERCENT', depositValue: 50 },
      ID.otherOwner,
      ID.biz,
    );
    expect(crossPatch.status).toBe(403);

    const unchanged = await db.service.findUniqueOrThrow({ where: { id: svcRes.body.id } });
    expect(unchanged.depositRequired).toBe(false);
    expect(unchanged.depositType).toBeNull();
    expect(unchanged.depositValue).toBeNull();

    // D-26/D-59/D-80 unchanged: public projection stays free of deposit terms.
    expect('depositRequired' in PUBLIC_SERVICE_SELECT).toBe(false);
    expect('depositType' in PUBLIC_SERVICE_SELECT).toBe(false);
    expect('depositValue' in PUBLIC_SERVICE_SELECT).toBe(false);
  });
});
