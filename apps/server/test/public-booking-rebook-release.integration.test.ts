/**
 * P228 FU-PUBLIC-BOOKING-RELEASE-ON-REBOOK: real-DB PostgreSQL HTTP proof for
 * atomically releasing a customer's earlier unpaid PENDING public booking(s)
 * when the same customer rebooks (at a new slot or retrying the same slot),
 * with strict ownership, tenant, payment/settlement, credit-note, deposit,
 * input-bound, and atomic-rollback protection.
 *
 * REAL PostgreSQL database, REAL NestJS HTTP routes behind REAL
 * BookingsController, BookingsService, ValidationPipe (with explicit
 * design:paramtypes metadata for PublicCreateBookingDto), and
 * GlobalHttpExceptionFilter; lightweight real-DB CrmService and CommerceService
 * test doubles backing contacts, invoices, deposits, and E.164 phone matching.
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
  serviceA3Deposit: `${P}svc_a3_dep`,
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
let onBeforeContactHook: (() => Promise<void>) | null = null;

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM storefront_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { contactPhoneForStorage, phoneKeyReadsAs } = await import('../src/modules/crm/crm-data-quality.util');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  // Ensure ValidationPipe receives real DTO metadata under vitest/esbuild.
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, PublicCreateBookingDto],
    BookingsController.prototype,
    'publicCreateBooking',
  );

  const prismaStub = { client: db };

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: any) => {
      if (onBeforeContactHook) {
        const hook = onBeforeContactHook;
        onBeforeContactHook = null;
        await hook();
      }
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
      if (email) {
        const byEmail = await db.contact.findFirst({
          where: { businessId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
        });
        if (byEmail) return byEmail;
      }
      const parsedPhone = contactPhoneForStorage(input.phone, 'TT');
      if (parsedPhone.e164) {
        const contacts = await db.contact.findMany({
          where: { businessId, deletedAt: null },
        });
        const byPhone = contacts.find(
          (c) =>
            phoneKeyReadsAs(c.phoneNormalized, parsedPhone.e164!, 'TT') ||
            phoneKeyReadsAs(c.phone, parsedPhone.e164!, 'TT'),
        );
        if (byPhone) return byPhone;
      }
      return db.contact.create({
        data: {
          businessId,
          firstName: input.firstName ?? 'Guest',
          lastName: input.lastName ?? 'Customer',
          email,
          phone: parsedPhone.value ?? input.phone ?? null,
          phoneNormalized: parsedPhone.e164 ?? null,
        },
      });
    },
  };

  let invSeq = 0;
  const commerceStub = {
    computeServiceDeposit: (service: any) =>
      service?.depositRequired && typeof service?.depositValue === 'number' ? service.depositValue : 0,
    createInvoiceForService: async (
      businessId: string,
      contactId: string,
      service: any,
      options?: { kind?: 'FULL' | 'DEPOSIT'; amountOverride?: number },
    ) => {
      invSeq += 1;
      const total = options?.amountOverride ?? service.price;
      const inv = await db.invoice.create({
        data: {
          businessId,
          contactId,
          invoiceNumber: `${P}INV-${invSeq}`,
          status: 'DRAFT',
          subtotal: total,
          total,
          currency: service.currency || 'TTD',
        },
      });
      return { id: inv.id, total: inv.total, currency: inv.currency };
    },
    publicInvoiceUrl: async () => null,
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
        country: 'TT',
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
        country: 'TT',
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
        invoiceTiming: 'BOOKING',
      },
      {
        id: ID.serviceA2,
        businessId: ID.bizA,
        name: 'Blowout',
        duration: 60,
        price: 100,
        invoiceTiming: 'BOOKING',
      },
      {
        id: ID.serviceA3Deposit,
        businessId: ID.bizA,
        name: 'Coloring (Deposit)',
        duration: 60,
        price: 300,
        depositRequired: true,
        depositType: 'FIXED',
        depositValue: 50,
        invoiceTiming: 'COMPLETION',
      },
      {
        id: ID.serviceB1,
        businessId: ID.bizB,
        name: 'Foreign Cut',
        duration: 60,
        price: 150,
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
  it('[PBR-01] rebooking at a new time with replaceBookingId cancels earlier unpaid PENDING hold, withdraws draft invoice, frees old slot, and leaves unrelated Cash bookings intact', async () => {
    // Unrelated Cash/Manual PENDING booking that is NOT passed to replaceBookingId must remain PENDING.
    const unrelatedCash = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('09:00'),
        ...customerB,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('10:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const firstId = first.body.bookingId as string;
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

    expect(second.body.bookingId).toBeTruthy();
    expect(second.body.bookingId).not.toBe(firstId);

    // Earlier booking cancelled & its draft invoice soft-deleted
    const oldBooking = await db.booking.findUnique({ where: { id: firstId } });
    expect(oldBooking?.status).toBe('CANCELLED');
    const oldInv = await db.invoice.findUnique({ where: { id: firstInvId } });
    expect(oldInv?.deletedAt).not.toBeNull();

    // Unrelated Cash/Manual PENDING booking & its invoice are untouched (no age/auto-expiry)
    const cashRow = await db.booking.findUnique({ where: { id: unrelatedCash.body.bookingId } });
    expect(cashRow?.status).toBe('PENDING');
    const cashInv = await db.invoice.findUnique({ where: { id: unrelatedCash.body.invoiceId } });
    expect(cashInv?.deletedAt).toBeNull();

    // 10:00 is free again; 11:00 is now held
    const slotsAfter = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizA}/slots`)
      .query({ serviceId: ID.serviceA1, date: BOOK_DATE })
      .expect(200);
    expect(slotsAfter.body.slots).toContain(new Date(slotIso('10:00')).toISOString());
    expect(slotsAfter.body.slots).not.toContain(new Date(slotIso('11:00')).toISOString());
  });

  it('[PBR-02] retrying the SAME slot with replaceBookingId succeeds for exact email, case-insensitive email, and phone-only CRM contact via E.164 normalization', async () => {
    const initial = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('10:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);
    const prevId = initial.body.bookingId as string;

    // Case-insensitive email retry on the exact same 10:00 slot
    const retryUpper = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('10:00'),
        ...customerA,
        email: customerA.email.toUpperCase(),
        paymentMethod: 'CASH',
        replaceBookingId: prevId,
      })
      .expect(201);
    expect(retryUpper.body.bookingId).not.toBe(prevId);
    expect((await db.booking.findUnique({ where: { id: prevId } }))?.status).toBe('CANCELLED');

    // Phone-only pre-existing CRM contact (email: null, phone: '+18685550303') retries same slot with national format '868-555-0303'
    const phoneOnlyContact = await db.contact.create({
      data: {
        id: `${P}contact_phone_only`,
        businessId: ID.bizA,
        firstName: 'Phone',
        lastName: 'Only',
        email: null,
        phone: '+18685550303',
        phoneNormalized: '+18685550303',
      },
    });
    const phoneOnlyBooking = await db.booking.create({
      data: {
        id: `${P}bk_phone_only`,
        businessId: ID.bizA,
        contactId: phoneOnlyContact.id,
        serviceId: ID.serviceA2,
        startTime: new Date(slotIso('11:00')),
        endTime: new Date(slotIso('12:00')),
        status: 'PENDING',
        paymentStatus: 'UNPAID',
      },
    });

    const phoneRetry = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('11:00'),
        firstName: 'Phone',
        lastName: 'Only',
        email: `${P}phone_only_added@example.test`,
        phone: '868-555-0303',
        paymentMethod: 'CASH',
        replaceBookingId: phoneOnlyBooking.id,
      })
      .expect(201);
    expect(phoneRetry.body.bookingId).not.toBe(phoneOnlyBooking.id);
    expect((await db.booking.findUnique({ where: { id: phoneOnlyBooking.id } }))?.status).toBe('CANCELLED');
  });

  it('[PBR-03] multi-service rebook releases multiple holds via combined replaceBookingId + releaseBookingIds (with dedup), withdraws all draft invoices, and frees old slots', async () => {
    const hold1 = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('12:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const hold2 = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('12:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);

    const prev1 = hold1.body.bookingId as string;
    const prev2 = hold2.body.bookingId as string;
    const inv1 = hold1.body.invoiceId as string;
    const inv2 = hold2.body.invoiceId as string;

    const rebook = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('14:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: prev1,
        releaseBookingIds: [prev1, prev2],
      })
      .expect(201);
    expect(rebook.body.bookingId).toBeTruthy();

    const rows = await db.booking.findMany({ where: { id: { in: [prev1, prev2] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);

    const invRows = await db.invoice.findMany({ where: { id: { in: [inv1, inv2] } } });
    expect(invRows).toHaveLength(2);
    expect(invRows.every((r) => r.deletedAt !== null)).toBe(true);

    const slots1 = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizA}/slots`)
      .query({ serviceId: ID.serviceA1, date: BOOK_DATE })
      .expect(200);
    const slots2 = await request(app.getHttpServer())
      .get(`/bookings/public/businesses/${ID.bizA}/slots`)
      .query({ serviceId: ID.serviceA2, date: BOOK_DATE })
      .expect(200);
    expect(slots1.body.slots).toContain(new Date(slotIso('12:00')).toISOString());
    expect(slots2.body.slots).toContain(new Date(slotIso('12:00')).toISOString());
  });

  it('[PBR-04] security & tenancy: blocks cross-customer hijack, blocks attacker-email+victim-phone phone-fallback cancellation (R1-SEC-03), blocks cross-tenant release, and preserves hold+invoice on taken slot', async () => {
    const aBooking = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('14:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);
    const aBookingId = aBooking.body.bookingId as string;
    const aInvoiceId = aBooking.body.invoiceId as string;

    // 1. Customer B cannot hijack Customer A's 14:00 slot
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('14:00'),
        ...customerB,
        paymentMethod: 'CASH',
        replaceBookingId: aBookingId,
      })
      .expect(400);
    expect((await db.booking.findUnique({ where: { id: aBookingId } }))?.status).toBe('PENDING');

    // 2. R1-SEC-03: Attacker submits attacker@evil.test + Customer A's phone on a FREE slot;
    //    even though crmStub resolves Customer A via phone fallback, contradicting email blocks release!
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA1,
        startTime: slotIso('16:00'),
        firstName: 'Evil',
        lastName: 'Attacker',
        email: `${P}attacker@evil.test`,
        phone: customerA.phone,
        paymentMethod: 'CASH',
        replaceBookingId: aBookingId,
      })
      .expect(201);
    expect((await db.booking.findUnique({ where: { id: aBookingId } }))?.status).toBe('PENDING');
    expect((await db.invoice.findUnique({ where: { id: aInvoiceId } }))?.deletedAt).toBeNull();

    // 3. Customer B books 15:00; Customer A tries to rebook into 15:00 -> 400 and A's hold+invoice survive
    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('15:00'),
        ...customerB,
        paymentMethod: 'CASH',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA2,
        startTime: slotIso('15:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: aBookingId,
      })
      .expect(400);
    expect((await db.booking.findUnique({ where: { id: aBookingId } }))?.status).toBe('PENDING');
    expect((await db.invoice.findUnique({ where: { id: aInvoiceId } }))?.deletedAt).toBeNull();

    // 4. Foreign business booking cannot be released cross-tenant
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
        serviceId: ID.serviceA2,
        startTime: slotIso('13:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: bizBBooking.body.bookingId,
      })
      .expect(201);
    expect((await db.booking.findUnique({ where: { id: bizBBooking.body.bookingId } }))?.status).toBe('PENDING');
    expect((await db.invoice.findUnique({ where: { id: bizBBooking.body.invoiceId } }))?.deletedAt).toBeNull();
  });

  it('[PBR-05] payment, invoice-status, credit-note, and depositInvoice protection (R1-SEC-02, CR-P228-4)', async () => {
    const contactA = await db.contact.findFirstOrThrow({
      where: { businessId: ID.bizA, email: customerA.email },
    });

    // Helper: create a seeded PENDING/UNPAID booking with custom state and attempt release via rebook on serviceA3Deposit
    let slotHour = 9;
    const nextSlot = () => {
      const hh = String(slotHour).padStart(2, '0');
      slotHour += 1;
      return slotIso(`${hh}:00`);
    };

    const assertProtected = async (label: string, bkId: string, expectedStatus: string) => {
      const res = await request(app.getHttpServer())
        .post(`/bookings/public/businesses/${ID.bizA}`)
        .send({
          serviceId: ID.serviceA3Deposit,
          startTime: nextSlot(),
          ...customerA,
          paymentMethod: 'CASH',
          replaceBookingId: bkId,
        });
      expect(res.status, label).toBe(201);
      const after = await db.booking.findUnique({ where: { id: bkId } });
      expect(after?.status, label).toBe(expectedStatus);
      // Clean up the probe booking so serviceA3Deposit slots stay plentiful
      await db.booking.update({ where: { id: res.body.bookingId }, data: { status: 'CANCELLED' } });
      slotHour -= 1;
    };

    // 1. Deposit booking: unpaid DRAFT depositInvoice IS withdrawn on release
    const depHold = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA3Deposit,
        startTime: slotIso('16:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);
    expect(depHold.body.depositInvoiceId).toBeTruthy();

    const depRebook = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA3Deposit,
        startTime: slotIso('16:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: depHold.body.bookingId,
      })
      .expect(201);
    expect((await db.booking.findUnique({ where: { id: depHold.body.bookingId } }))?.status).toBe('CANCELLED');
    expect((await db.invoice.findUnique({ where: { id: depHold.body.depositInvoiceId } }))?.deletedAt).not.toBeNull();

    // 2. PAID depositInvoice protects booking even while booking.paymentStatus is still UNPAID
    await db.invoice.update({
      where: { id: depRebook.body.depositInvoiceId },
      data: { status: 'PAID' },
    });
    await assertProtected('PAID depositInvoice', depRebook.body.bookingId, 'PENDING');

    // 3. Booking statuses CONFIRMED and COMPLETED + paymentStatus PAID / DEPOSIT_PAID
    const makeSeed = async (
      suffix: string,
      bookingPatch: Record<string, unknown>,
      invoiceStatus?: string,
    ) => {
      let invId: string | null = null;
      if (invoiceStatus) {
        const inv = await db.invoice.create({
          data: {
            id: `${P}inv_${suffix}`,
            businessId: ID.bizA,
            contactId: contactA.id,
            invoiceNumber: `${P}SEED-${suffix}`,
            status: invoiceStatus as any,
            subtotal: 100,
            total: 100,
            currency: 'TTD',
          },
        });
        invId = inv.id;
      }
      const bk = await db.booking.create({
        data: {
          id: `${P}bk_${suffix}`,
          businessId: ID.bizA,
          contactId: contactA.id,
          serviceId: ID.serviceA1,
          startTime: new Date(`${BOOK_DATE}T20:00:00Z`),
          endTime: new Date(`${BOOK_DATE}T21:00:00Z`),
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          ...(invId ? { invoiceId: invId } : {}),
          ...bookingPatch,
        } as any,
      });
      return { bkId: bk.id, invId };
    };

    const confirmed = await makeSeed('confirmed', { status: 'CONFIRMED' });
    await assertProtected('CONFIRMED booking', confirmed.bkId, 'CONFIRMED');

    const completed = await makeSeed('completed', { status: 'COMPLETED' });
    await assertProtected('COMPLETED booking', completed.bkId, 'COMPLETED');

    const payPaid = await makeSeed('pay_paid', { paymentStatus: 'PAID' });
    await assertProtected('paymentStatus PAID', payPaid.bkId, 'PENDING');

    const payDep = await makeSeed('pay_dep', { paymentStatus: 'DEPOSIT_PAID' });
    await assertProtected('paymentStatus DEPOSIT_PAID', payDep.bkId, 'PENDING');

    // 4. All non-releasable invoice statuses while booking is still PENDING / UNPAID (async listener lag)
    for (const st of ['PAID', 'PARTIALLY_PAID', 'PARTIAL', 'PARTIALLY_CREDITED', 'FULLY_CREDITED', 'SENT']) {
      const s = await makeSeed(`inv_${st.toLowerCase()}`, {}, st);
      await assertProtected(`invoice.status=${st}`, s.bkId, 'PENDING');
    }

    // 5. Settled Payment(SUCCESSFUL) and pending Payment(PENDING) on a DRAFT invoice protect booking
    const pSucc = await makeSeed('pmt_succ', {}, 'DRAFT');
    await db.payment.create({
      data: {
        id: `${P}pmt_succ`,
        businessId: ID.bizA,
        invoiceId: pSucc.invId!,
        amount: 100,
        currency: 'TTD',
        method: 'STRIPE',
        status: 'SUCCESSFUL',
      },
    });
    await assertProtected('Payment SUCCESSFUL on DRAFT', pSucc.bkId, 'PENDING');

    const pPend = await makeSeed('pmt_pend', {}, 'DRAFT');
    await db.payment.create({
      data: {
        id: `${P}pmt_pend`,
        businessId: ID.bizA,
        invoiceId: pPend.invId!,
        amount: 100,
        currency: 'TTD',
        method: 'MANUAL',
        status: 'PENDING',
      },
    });
    await assertProtected('Payment PENDING claim on DRAFT', pPend.bkId, 'PENDING');

    // 6. APPLIED CreditNote on a DRAFT invoice protects booking (D-28/D-78)
    const cnSeed = await makeSeed('cn_applied', {}, 'DRAFT');
    await db.creditNote.create({
      data: {
        id: `${P}cn_applied`,
        businessId: ID.bizA,
        invoiceId: cnSeed.invId!,
        creditNoteNumber: `${P}CN-1`,
        amount: 100,
        currency: 'TTD',
        reason: 'Customer credit',
        status: 'APPLIED',
      },
    });
    await assertProtected('APPLIED CreditNote on DRAFT', cnSeed.bkId, 'PENDING');
  });

  it('[PBR-06] atomic claimSlot rollback: when slot is taken after early check (during claimSlot), both earlier hold cancellation and draft invoice withdrawal roll back', async () => {
    const hold = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA3Deposit,
        startTime: slotIso('13:00'),
        ...customerA,
        paymentMethod: 'CASH',
      })
      .expect(201);
    const holdId = hold.body.bookingId as string;
    const holdDepInvId = hold.body.depositInvoiceId as string;

    const contactB = await db.contact.findFirstOrThrow({
      where: { businessId: ID.bizA, email: customerB.email },
    });

    // Inject a concurrent rival booking for 14:00 AFTER early assertSlotFree passes,
    // right before claimSlot runs releaseRebookHoldsInTx + assertSlotFree(slot, tx).
    onBeforeContactHook = async () => {
      await db.booking.create({
        data: {
          id: `${P}bk_race_rival`,
          businessId: ID.bizA,
          contactId: contactB.id,
          serviceId: ID.serviceA3Deposit,
          startTime: new Date(slotIso('14:00')),
          endTime: new Date(slotIso('15:00')),
          status: 'PENDING',
          paymentStatus: 'UNPAID',
        },
      });
    };

    const clash = await request(app.getHttpServer())
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.serviceA3Deposit,
        startTime: slotIso('14:00'),
        ...customerA,
        paymentMethod: 'CASH',
        replaceBookingId: holdId,
      });
    expect(clash.status).toBe(400);

    // Earlier hold and its deposit DRAFT invoice MUST remain intact after tx rollback
    expect((await db.booking.findUnique({ where: { id: holdId } }))?.status).toBe('PENDING');
    expect((await db.invoice.findUnique({ where: { id: holdDepInvId } }))?.deletedAt).toBeNull();
  });

  it('[PBR-07] DTO & controller input bounds reject invalid or oversized replaceBookingId / releaseBookingIds with 400', async () => {
    const base = {
      serviceId: ID.serviceA3Deposit,
      startTime: slotIso('15:00'),
      ...customerA,
      paymentMethod: 'CASH',
    };

    const badPayloads = [
      { ...base, replaceBookingId: 12345 },
      { ...base, replaceBookingId: 'x'.repeat(201) },
      { ...base, releaseBookingIds: 'not-an-array' },
      { ...base, releaseBookingIds: [123] },
      { ...base, releaseBookingIds: ['x'.repeat(201)] },
      { ...base, releaseBookingIds: Array.from({ length: 11 }, (_, i) => `${P}id_${i}`) },
      // Combined replaceBookingId + 10 distinct releaseBookingIds = 11 -> 400
      {
        ...base,
        replaceBookingId: `${P}id_extra`,
        releaseBookingIds: Array.from({ length: 10 }, (_, i) => `${P}id_${i}`),
      },
    ];

    for (const payload of badPayloads) {
      const res = await request(app.getHttpServer())
        .post(`/bookings/public/businesses/${ID.bizA}`)
        .send(payload);
      expect(res.status).toBe(400);
    }
  });
});
