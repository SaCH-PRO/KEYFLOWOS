/**
 * P229 FU-SLOTS-OVERNIGHT-HOURS (D-311): real-DB PostgreSQL HTTP proof that
 * overnight opening hours (e.g., 18:00–02:00, 18:15–02:15, 18:00–00:00) work
 * consistently across GET /bookings/public/businesses/:id/slots,
 * POST /bookings/public/businesses/:id (publicCreateBooking), in-app
 * createBooking, and rescheduleBooking — including slots crossing midnight and
 * early-morning spillover on the following calendar day (even when the next
 * day itself is closed), while non-overnight days still refuse past-closing
 * and past-midnight bookings.
 *
 * Fixture prefix: `v92l_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92l_';

const ID = {
  ownerA: `${P}owner_a`,
  bizOvernight: `${P}biz_overnight`,
  bizOffset: `${P}biz_offset`,
  bizRegular: `${P}biz_regular`,
  svcOvernight: `${P}svc_overnight`,
  svcOffset: `${P}svc_offset`,
  svcRegular: `${P}svc_regular`,
};

/** Pick a future Friday (day 5) + Saturday (day 6) in America/Port_of_Spain (UTC-4, no DST). */
function nextFutureFriSat(): { fri: string; sat: string } {
  const d = new Date(Date.now() + 7 * 86_400_000);
  while (d.getUTCDay() !== 5) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const fri = d.toISOString().slice(0, 10);
  const next = new Date(d.getTime() + 86_400_000);
  const sat = next.toISOString().slice(0, 10);
  return { fri, sat };
}

const { fri: FRI_DATE, sat: SAT_DATE } = nextFutureFriSat();
const isoAt = (ymd: string, hhmm: string) => `${ymd}T${hhmm}:00-04:00`;

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;
let bookingsService: import('../src/modules/bookings/bookings.service').BookingsService;

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM storefront_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  Reflect.defineMetadata(
    'design:paramtypes',
    [String, PublicCreateBookingDto],
    BookingsController.prototype,
    'publicCreateBooking',
  );

  const prismaStub = { client: db };
  const crmStub = {
    findOrCreateContact: async (businessId: string, input: any) => {
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
      if (email) {
        const existing = await db.contact.findFirst({
          where: { businessId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
        });
        if (existing) return existing;
      }
      return db.contact.create({
        data: {
          businessId,
          firstName: input.firstName ?? 'Night',
          lastName: input.lastName ?? 'Owl',
          email,
          phone: input.phone ?? null,
        },
      });
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      BookingsService,
      { provide: CatalogService, useValue: { assertPublicStore: async () => undefined } },
      { provide: CalendarService, useValue: {} },
      { provide: BookingOptimizerService, useValue: {} },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CrmService, useValue: crmStub },
      {
        provide: CommerceService,
        useValue: { computeServiceDeposit: () => 0, publicInvoiceUrl: async () => null },
      },
      {
        provide: SubscriptionsService,
        useValue: { checkLimit: async () => ({ allowed: true, current: 0, limit: -1 }) },
      },
      {
        provide: PublicEventsService,
        useValue: { backstitchVisitor: async () => undefined, logStorefrontEvent: async () => undefined },
      },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: TimelineService, useValue: { logEvent: async () => undefined } },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TenantInterceptor,
    ],
  })
    .overrideGuard(PublicRateLimitGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(HoneypotGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PlanLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication();
  bookingsService = moduleRef.get(BookingsService);
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.create({
    data: { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'Night Club Owner' },
  });

  await db.business.createMany({
    data: [
      {
        id: ID.bizOvernight,
        name: 'Overnight Lounge',
        slug: `${P}overnight`,
        ownerId: ID.ownerA,
        currency: 'TTD',
        timezone: 'America/Port_of_Spain',
        storeEnabled: true,
        businessHours: {
          fri: { open: '18:00', close: '02:00', closed: false },
          sat: { closed: true },
        },
        metaData: { cashEnabled: true },
      },
      {
        id: ID.bizOffset,
        name: 'Offset Overnight Bar',
        slug: `${P}offset`,
        ownerId: ID.ownerA,
        currency: 'TTD',
        timezone: 'America/Port_of_Spain',
        storeEnabled: true,
        businessHours: {
          fri: { open: '18:15', close: '02:15', closed: false },
          sat: { closed: true },
        },
        metaData: { cashEnabled: true },
      },
      {
        id: ID.bizRegular,
        name: 'Daytime Salon',
        slug: `${P}regular`,
        ownerId: ID.ownerA,
        currency: 'TTD',
        timezone: 'America/Port_of_Spain',
        storeEnabled: true,
        businessHours: {
          fri: { open: '09:00', close: '23:00', closed: false },
          sat: { closed: true },
        },
        metaData: { cashEnabled: true },
      },
    ],
  });

  await db.service.createMany({
    data: [
      {
        id: ID.svcOvernight,
        businessId: ID.bizOvernight,
        name: 'VIP Table',
        duration: 60,
        price: 0,
      },
      {
        id: ID.svcOffset,
        businessId: ID.bizOffset,
        name: 'Late Tasting',
        duration: 60,
        price: 0,
      },
      {
        id: ID.svcRegular,
        businessId: ID.bizRegular,
        name: 'Standard Cut',
        duration: 60,
        price: 0,
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

const guest = {
  firstName: 'Nadia',
  lastName: 'Night',
  email: `${P}nadia@test.local`,
  phone: '+18685550929',
};

describe('P229 FU-SLOTS-OVERNIGHT-HOURS (D-311, v92l_)', () => {
  it('[SOH-01] RED-BEFORE: Friday 18:00-02:00 offers 18:00..23:30 on Friday and 00:00..01:00 spillover on closed Saturday, never 09:00-17:00 fallback', async () => {
    const friSlots = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOvernight}/slots`)
      .query({ serviceId: ID.svcOvernight, date: FRI_DATE })
      .expect(200);

    expect(friSlots.body.slots).toContain(new Date(isoAt(FRI_DATE, '18:00')).toISOString());
    expect(friSlots.body.slots).toContain(new Date(isoAt(FRI_DATE, '23:30')).toISOString());
    expect(friSlots.body.slots).not.toContain(new Date(isoAt(FRI_DATE, '09:00')).toISOString());
    expect(friSlots.body.slots).not.toContain(new Date(isoAt(FRI_DATE, '17:30')).toISOString());

    // Saturday itself is closed, yet Friday's 18:00-02:00 spillover offers 00:00, 00:30, 01:00 (not 01:30 since 60m ends 02:30 > 02:00)
    const satSlots = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOvernight}/slots`)
      .query({ serviceId: ID.svcOvernight, date: SAT_DATE })
      .expect(200);

    expect(satSlots.body.slots).toEqual([
      new Date(isoAt(SAT_DATE, '00:00')).toISOString(),
      new Date(isoAt(SAT_DATE, '00:30')).toISOString(),
      new Date(isoAt(SAT_DATE, '01:00')).toISOString(),
    ]);
  });

  it('[SOH-02] RED-BEFORE: publicCreateBooking and rescheduleBooking accept Friday 23:30 (crosses midnight) and Saturday 00:30 spillover, and reject 01:30 & daytime 10:00', async () => {
    // 1. Friday 23:30 (60m -> ends Saturday 00:30 <= 02:00) accepted
    const friLate = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(FRI_DATE, '23:30'),
        ...guest,
        paymentMethod: 'CASH',
      });
    expect(friLate.status).toBe(201);
    const bkId = friLate.body.bookingId as string;

    // 2. Reschedule onto Saturday 00:30 (within Friday's 18:00-02:00 spillover, even though Saturday is closed)
    const moved = await bookingsService.rescheduleBooking(
      ID.bizOvernight,
      bkId,
      new Date(isoAt(SAT_DATE, '00:30')),
    );
    expect(new Date(moved.startTime).toISOString()).toBe(new Date(isoAt(SAT_DATE, '00:30')).toISOString());

    // 3. Reschedule onto Saturday 01:30 (ends 02:30 > 02:00) rejected
    await expect(
      bookingsService.rescheduleBooking(ID.bizOvernight, bkId, new Date(isoAt(SAT_DATE, '01:30'))),
    ).rejects.toThrow();

    // 4. Public booking at Saturday 01:00 (ends 02:00) accepted, while 01:30 and Friday 10:00 rejected
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(SAT_DATE, '01:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(SAT_DATE, '01:30'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOvernight}`)
      .send({
        serviceId: ID.svcOvernight,
        startTime: isoAt(FRI_DATE, '10:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);
  });

  it('[SOH-03] RED-BEFORE: offset overnight shift 18:15-02:15 preserves 30-min grid across midnight (00:15, 00:45, 01:15) and non-overnight days still refuse past-closing/midnight', async () => {
    const satOffset = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizOffset}/slots`)
      .query({ serviceId: ID.svcOffset, date: SAT_DATE })
      .expect(200);

    expect(satOffset.body.slots).toEqual([
      new Date(isoAt(SAT_DATE, '00:15')).toISOString(),
      new Date(isoAt(SAT_DATE, '00:45')).toISOString(),
      new Date(isoAt(SAT_DATE, '01:15')).toISOString(),
    ]);

    // On-grid Saturday 00:15 accepted, off-grid Saturday 00:00 rejected (400)
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOffset}`)
      .send({
        serviceId: ID.svcOffset,
        startTime: isoAt(SAT_DATE, '00:15'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizOffset}`)
      .send({
        serviceId: ID.svcOffset,
        startTime: isoAt(SAT_DATE, '00:00'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);

    // Control: regular non-overnight Friday 09:00-23:00 still refuses 22:30 (ends 23:30 > 23:00) and closed Saturday 00:30
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizRegular}`)
      .send({
        serviceId: ID.svcRegular,
        startTime: isoAt(FRI_DATE, '22:30'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizRegular}`)
      .send({
        serviceId: ID.svcRegular,
        startTime: isoAt(SAT_DATE, '00:30'),
        ...guest,
        paymentMethod: 'CASH',
      })
      .expect(400);
  });
});
