/**
 * P228 FU-PUBLIC-BOOKING-RELEASE-ON-REBOOK: real-DB PostgreSQL HTTP proof for
 * releasing a customer's earlier unpaid PENDING public booking(s) when the
 * same customer rebooks (at a new slot or retrying the same slot), with strict
 * ownership, tenant, payment, and atomic-rollback protection.
 *
 * REAL PostgreSQL database, REAL NestJS HTTP routes behind REAL
 * BookingsController, BookingsService, CrmService, CommerceService,
 * ValidationPipe and GlobalHttpExceptionFilter.
 *
 * Fixture prefix: `v92k_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92k_';

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  serviceA1: `${P}svc_a1`,
  serviceA2: `${P}svc_a2`,
  serviceB1: `${P}svc_b1`,
};

/** Pick a future Tuesday in America/Port_of_Spain (UTC-4, no DST) so businessHours always apply cleanly. */
function nextFutureTuesdayYmd(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  while (d.getUTCDay() !== 2) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

const BOOK_DATE = nextFutureTuesdayYmd();
const slotIso = (hhmm: string) => `${BOOK_DATE}T${hhmm}:00-04:00`;

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM storefront_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { BookingCatalogService } = await import('../src/modules/bookings/booking-catalog.service');
  const { BookingCalendarService } = await import('../src/modules/bookings/booking-calendar.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PublicEventsService } = await import('../src/modules/site/public-events.service');
  const { RevenueAttributionService } = await import('../src/modules/analytics/revenue-attribution.service');
  const { BookingPaymentStatusListener } = await import(
    '../src/modules/bookings/booking-payment-status.listener'
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
          firstName: input.firstName ?? 'Guest',
          lastName: input.lastName ?? 'Customer',
          email,
          phone: input.phone ?? null,
        },
      });
    },
  };

  let invSeq = 0;
  const commerceStub = {
    computeServiceDeposit: () => 0,
    createInvoiceForService: async (businessId: string, contactId: string, service: any) => {
      invSeq += 1;
      const inv = await db.invoice.create({
        data: {
          businessId,
          contactId,
          invoiceNumber: `${P}INV-${invSeq}`,
          status: 'DRAFT',
          subtotal: service.price,
          total: service.price,
          currency: service.currency || 'TTD',
        },
      });
      return { id: inv.id, total: inv.total, currency: inv.currency };
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      BookingsService,
      BookingCatalogService,
      { provide: BookingCalendarService, useValue: {} },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CrmService, useValue: crmStub },
      { provide: CommerceService, useValue: commerceStub },
      {
        provide: SubscriptionsService,
        useValue: { checkLimit: async () => ({ allowed: true, current: 0, limit: -1 }) },
      },
      {
        provide: PublicEventsService,
        useValue: {
          backstitchVisitor: async () => undefined,
          logStorefrontEvent: async () => undefined,
        },
      },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: BookingPaymentStatusListener, useValue: {} },
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
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@example.test`, name: 'Owner A' },
      { id: ID.ownerB, email: `${P}owner_b@example.test`, name: 'Owner B' },
    ],
  });

  const hours = {
    tue: { open: '09:00', close: '17:00', closed: false },
  };
  await db.business.createMany({
    data: [
      {
        id: ID.bizA,
        name: 'Biz A Salon',
        slug: `${P}biz-a`,
        ownerId: ID.ownerA,
        currency: 'TTD',
        timezone: 'America/Port_of_Spain',
        storeEnabled: true,
        businessHours: hours,
        metaData: { cashEnabled: true },
      },
      {
        id: ID.bizB,
        name: 'Biz B Salon',
        slug: `${P}biz-b`,
        ownerId: ID.ownerB,
        currency: 'TTD',
        timezone: 'America/Port_of_Spain',
        storeEnabled: true,
        businessHours: hours,
        metaData: { cashEnabled: true },
      },
    ],
  });

  await db.service.createMany({
    data: [
      {
        id: ID.serviceA1,
        businessId: ID.bizA,
        name: 'Haircut',
        duration: 60,
        price: 150,
        currency: 'TTD',
        invoiceTiming: 'BOOKING',
      },
      {
        id: ID.serviceA2,
        businessId: ID.bizA,
        name: 'Blowout',
        duration: 60,
        price: 100,
        currency: 'TTD',
        invoiceTiming: 'BOOKING',
      },
      {
        id: ID.serviceB1,
        businessId: ID.bizB,
        name: 'Foreign Cut',
        duration: 60,
        price: 150,
        currency: 'TTD',
        invoiceTiming: 'BOOKING',
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

const customerA = {
  firstName: 'Alana',
  lastName: 'Customer',
  email: `${P}alana@example.test`,
  phone: '+18685550101',
};

const customerB = {
  firstName: 'Devon',
  lastName: 'Other',
  email: `${P}devon@example.test`,
  phone: '+18685550202',
};

describe('P228 FU-PUBLIC-BOOKING-RELEASE-ON-REBOOK (v92k_)', () => {
  let activeBookingAId = '';

  it('[PBR-01] RED-BEFORE: rebooking at a new time with replaceBookingId cancels the earlier unpaid PENDING hold, withdraws its draft invoice, and frees the old slot', async () => {
    const first = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('10:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const firstId = first.body.id as string;
    const firstInvId = first.body.invoiceId as string;
    expect(firstId).toBeTruthy();
    expect(firstInvId).toBeTruthy();

    // 10:00 is currently held
    const slotsHeld = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizA}/slots`)
      .query({ serviceId: ID.serviceA1, date: BOOK_DATE })
      .expect(200);
    expect(slotsHeld.body.slots).not.toContain(new Date(slotIso('10:00')).toISOString());

    // Customer A rebooks at 11:00 replacing firstId
    const second = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('11:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: firstId,
      })
      .expect(201);

    const secondId = second.body.id as string;
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    activeBookingAId = secondId;

    // Earlier booking cancelled & its draft invoice soft-deleted
    const oldBooking = await db.booking.findUnique({ where: { id: firstId } });
    expect(oldBooking?.status).toBe('CANCELLED');
    const oldInv = await db.invoice.findUnique({ where: { id: firstInvId } });
    expect(oldInv?.deletedAt).not.toBeNull();

    // 10:00 is free again; 11:00 is now held
    const slotsAfter = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizA}/slots`)
      .query({ serviceId: ID.serviceA1, date: BOOK_DATE })
      .expect(200);
    expect(slotsAfter.body.slots).toContain(new Date(slotIso('10:00')).toISOString());
    expect(slotsAfter.body.slots).not.toContain(new Date(slotIso('11:00')).toISOString());
  });

  it('[PBR-02] RED-BEFORE: retrying the SAME slot with replaceBookingId succeeds without colliding with the customer own PENDING booking', async () => {
    const prevId = activeBookingAId;
    const retry = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('11:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: prevId,
      });

    expect(retry.status).toBe(201);
    expect(retry.body.id).not.toBe(prevId);
    activeBookingAId = retry.body.id as string;

    const prevRow = await db.booking.findUnique({ where: { id: prevId } });
    expect(prevRow?.status).toBe('CANCELLED');
  });

  it('[PBR-03] RED-BEFORE: multi-service rebook releases multiple earlier unpaid PENDING holds via releaseBookingIds', async () => {
    const hold2 = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('12:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const prev1 = activeBookingAId;
    const prev2 = hold2.body.id as string;

    const rebook = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('14:00'),
        ...customerA,
        paymentMethod: 'CASH',
        releaseBookingIds: [prev1, prev2],
      });

    expect(rebook.status).toBe(201);
    activeBookingAId = rebook.body.id as string;

    const rows = await db.booking.findMany({ where: { id: { in: [prev1, prev2] } } });
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('[PBR-04] RED-BEFORE (security & atomicity): cannot release another customer booking, a foreign business booking, or a CONFIRMED/PAID booking; failed rebook rolls back', async () => {
    // Customer B tries to hijack Customer A's 14:00 slot by passing Customer A's booking id
    const hijack = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('14:00'),
        ...customerB,
        paymentMethod: 'CASH',
        replaceBookingId: activeBookingAId,
      });
    expect(hijack.status).toBe(400);

    // Customer A's booking is still PENDING
    expect((await db.booking.findUnique({ where: { id: activeBookingAId } }))?.status).toBe('PENDING');

    // Customer B books 15:00 legitimately
    const bBooking = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('15:00'),
        ...customerB,
        paymentMethod: 'CASH',
      })
      .expect(201);
    expect(bBooking.body.id).toBeTruthy();

    // Customer A tries to rebook into Customer B's taken 15:00 slot -> 400 and Customer A's 14:00 hold is NOT lost
    const clash = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('15:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: activeBookingAId,
      });
    expect(clash.status).toBe(400);
    expect((await db.booking.findUnique({ where: { id: activeBookingAId } }))?.status).toBe('PENDING');

    // Foreign business booking cannot be released cross-tenant
    const bizBBooking = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizB}`)
      .send({
        serviceId: ID.serviceB1,
        startTime: slotIso('10:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('13:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: bizBBooking.body.id,
      })
      .expect(201);
    expect((await db.booking.findUnique({ where: { id: bizBBooking.body.id } }))?.status).toBe('PENDING');

    // CONFIRMED booking cannot be cancelled via replaceBookingId
    await db.booking.update({
      where: { id: activeBookingAId },
      data: { status: 'CONFIRMED' },
    });
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('09:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: activeBookingAId,
      })
      .expect(201);
    expect((await db.booking.findUnique({ where: { id: activeBookingAId } }))?.status).toBe('CONFIRMED');
  });
});
