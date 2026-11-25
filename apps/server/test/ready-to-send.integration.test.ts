/**
 * READY-TO-SEND (P0 wedge-first; D-82, D-263):
 *   - GET /commerce/businesses/:businessId/ready-to-send
 *     Returns overdue invoices and bookings starting in the next 24h not yet
 *     reminded, each with plain-word prefilled WhatsApp text, E.164 phone,
 *     tokenized link (no bare /pay/<id>), and whether Gmail auto-email applies.
 *     Filtered by the member's module read scopes (revenue:read for invoices,
 *     bookings:read for bookings).
 *   - POST /commerce/businesses/:businessId/ready-to-send/invoice/:id/mark-sent
 *     Requires revenue:write (403 otherwise); records an Activity row (no
 *     migration) so the invoice leaves today's Ready-to-Send queue.
 *   - POST /commerce/businesses/:businessId/ready-to-send/booking/:id/mark-sent
 *     Requires bookings:write (403 otherwise); stamps Booking.reminderSentAt so
 *     the booking leaves the Ready-to-Send queue.
 *   - BookingsService.processBookingReminders() runs scheduled email reminders
 *     ONLY for businesses with Gmail connected (D-82).
 *
 * Fixtures: prefix `v65e_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65e_';
const HEADER = 'x-test-user';

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  staffBookReadOnly: `${P}staff_book_r`,
  staffRevReadOnly: `${P}staff_rev_r`,
  staffBothReadOnly: `${P}staff_both_r`,
  staffBookWriteOnly: `${P}staff_book_w`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  contactInvA: `${P}ct_inv_a`,
  contactBookA: `${P}ct_book_a`,
  contactB: `${P}ct_b`,
  serviceA: `${P}svc_a`,
  serviceB: `${P}svc_b`,
  invOverdueA: `${P}inv_overdue_a`,
  invSentFutureA: `${P}inv_sent_a`,
  invPaidA: `${P}inv_paid_a`,
  invOverdueB: `${P}inv_overdue_b`,
  bookTomorrowA: `${P}book_tomorrow_a`,
  bookLaterA: `${P}book_later_a`,
  bookRemindedA: `${P}book_reminded_a`,
  bookCancelledA: `${P}book_cancelled_a`,
  bookSoonA: `${P}book_soon_a`,
  bookSoonB: `${P}book_soon_b`,
};

let db: any;
let app: any;
let bookingsService: any;
let readyToSendService: any;
const sendEmailSpy = vi.fn(async () => ({ id: 'sent_mock' }));

async function cleanup() {
  for (const sql of [
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { db: prismaClient } = await import('@keyflow/db');
  db = prismaClient;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ReadyToSendController } = await import('../src/modules/commerce/ready-to-send.controller');
  const { ReadyToSendService } = await import('../src/modules/commerce/ready-to-send.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    controllers: [ReadyToSendController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ReadyToSendService,
      CommerceService,
      BookingsService,
      { provide: TransactionalEmailService, useValue: { send: sendEmailSpy } },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => null } },
      { provide: SubscriptionsService, useValue: {} },
      { provide: InvoiceWorkflowService, useValue: {} },
      { provide: CommerceStatsService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: RevenuePostingService, useValue: {} },
      { provide: RevenueAttributionService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER] as string | undefined;
    if (uid) {
      const user = await db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, role: true } });
      if (user) req.user = user;
    }
    next();
  });
  await app.init();
  bookingsService = app.get(BookingsService);
  readyToSendService = app.get(ReadyToSendService);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' },
      { id: ID.staffBookReadOnly, email: `${P}book_r@test.local`, role: 'USER' },
      { id: ID.staffRevReadOnly, email: `${P}rev_r@test.local`, role: 'USER' },
      { id: ID.staffBothReadOnly, email: `${P}both_r@test.local`, role: 'USER' },
      { id: ID.staffBookWriteOnly, email: `${P}book_w@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      {
        id: ID.bizA,
        name: 'V65E Island Studio',
        slug: `${P}island-studio`,
        ownerId: ID.ownerA,
        country: 'TT',
        currency: 'TTD',
        bookingReminderMins: 60,
        gmailEmail: null,
        gmailRefreshToken: null,
      },
      {
        id: ID.bizB,
        name: 'V65E Connected Salon',
        slug: `${P}connected-salon`,
        ownerId: ID.ownerB,
        country: 'TT',
        currency: 'TTD',
        bookingReminderMins: 60,
        gmailEmail: 'salon@v65e.test',
        gmailRefreshToken: 'enc:mock-refresh-token',
      },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${ID.ownerA}_m`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${ID.ownerB}_m`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      {
        id: `${ID.staffBookReadOnly}_m`,
        userId: ID.staffBookReadOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'read', revenue: 'none' },
      },
      {
        id: `${ID.staffRevReadOnly}_m`,
        userId: ID.staffRevReadOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', bookings: 'none' },
      },
      {
        id: `${ID.staffBothReadOnly}_m`,
        userId: ID.staffBothReadOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', bookings: 'read' },
      },
      {
        id: `${ID.staffBookWriteOnly}_m`,
        userId: ID.staffBookWriteOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'write', revenue: 'none' },
      },
    ],
  });

  await db.contact.createMany({
    data: [
      {
        id: ID.contactInvA,
        businessId: ID.bizA,
        firstName: 'Kerry',
        lastName: 'Joseph',
        email: `${P}kerry@test.local`,
        phone: '868-555-0142',
      },
      {
        id: ID.contactBookA,
        businessId: ID.bizA,
        firstName: 'Maya',
        lastName: 'Persad',
        email: `${P}maya@test.local`,
        phone: '868-555-0188',
      },
      {
        id: ID.contactB,
        businessId: ID.bizB,
        firstName: 'Devon',
        lastName: 'Charles',
        email: `${P}devon@test.local`,
        phone: '868-555-0199',
      },
    ],
  });

  await db.service.createMany({
    data: [
      { id: ID.serviceA, businessId: ID.bizA, name: 'Deep Tissue Massage', duration: 60, price: 350 },
      { id: ID.serviceB, businessId: ID.bizB, name: 'Keratin Treatment', duration: 60, price: 400 },
    ],
  });

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const in36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const in60m = new Date(now.getTime() + 60 * 60 * 1000);

  await db.invoice.createMany({
    data: [
      {
        id: ID.invOverdueA,
        businessId: ID.bizA,
        contactId: ID.contactInvA,
        invoiceNumber: `${P}INV-1001`,
        status: 'OVERDUE',
        total: 250,
        subtotal: 250,
        currency: 'TTD',
        dueDate: yesterday,
      },
      {
        id: ID.invSentFutureA,
        businessId: ID.bizA,
        contactId: ID.contactInvA,
        invoiceNumber: `${P}INV-1002`,
        status: 'SENT',
        total: 180,
        subtotal: 180,
        currency: 'TTD',
        dueDate: nextWeek,
      },
      {
        id: ID.invPaidA,
        businessId: ID.bizA,
        contactId: ID.contactInvA,
        invoiceNumber: `${P}INV-1003`,
        status: 'PAID',
        total: 90,
        subtotal: 90,
        currency: 'TTD',
        dueDate: yesterday,
        paidAt: yesterday,
      },
      {
        id: ID.invOverdueB,
        businessId: ID.bizB,
        contactId: ID.contactB,
        invoiceNumber: `${P}INV-2001`,
        status: 'OVERDUE',
        total: 500,
        subtotal: 500,
        currency: 'TTD',
        dueDate: yesterday,
      },
    ],
  });

  await db.booking.createMany({
    data: [
      {
        id: ID.bookTomorrowA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: in12h,
        endTime: new Date(in12h.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
      {
        id: ID.bookLaterA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: in36h,
        endTime: new Date(in36h.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
      {
        id: ID.bookRemindedA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: in12h,
        endTime: new Date(in12h.getTime() + 60 * 60 * 1000),
        reminderSentAt: yesterday,
      },
      {
        id: ID.bookCancelledA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CANCELLED',
        startTime: in12h,
        endTime: new Date(in12h.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
      {
        id: ID.bookSoonA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: in60m,
        endTime: new Date(in60m.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
      {
        id: ID.bookSoonB,
        businessId: ID.bizB,
        contactId: ID.contactB,
        serviceId: ID.serviceB,
        status: 'CONFIRMED',
        startTime: in60m,
        endTime: new Date(in60m.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
    ],
  });
}, 30_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

beforeEach(() => {
  sendEmailSpy.mockClear();
});

const getReady = (bizId: string, userId: string) =>
  request(app.getHttpServer())
    .get(`/commerce/businesses/${bizId}/ready-to-send`)
    .set(HEADER, userId);

const postMarkSent = (bizId: string, kind: string, itemId: string, userId: string) =>
  request(app.getHttpServer())
    .post(`/commerce/businesses/${bizId}/ready-to-send/${kind}/${itemId}/mark-sent`)
    .set(HEADER, userId);

describe('READY-TO-SEND (P0 wedge-first; D-82, D-263; real Postgres)', () => {
  it('RTS-01: returns overdue invoice and next-24h unreminded bookings with plain WhatsApp text, E.164 phone, tokenized link (no bare /pay/<id>), and gmailConnected: false without calling any provider', async () => {
    const res = await getReady(ID.bizA, ID.ownerA).expect(200);
    expect(res.body.gmailConnected).toBe(false);
    expect(sendEmailSpy).not.toHaveBeenCalled();

    const items: any[] = res.body.items;
    const invRow = items.find((i) => i.kind === 'invoice' && i.id === ID.invOverdueA);
    const bookRow = items.find((i) => i.kind === 'booking' && i.id === ID.bookTomorrowA);

    expect(invRow).toBeDefined();
    expect(invRow.e164Phone).toBe('+18685550142');
    expect(invRow.link).toMatch(/\/public\/invoice\/[A-Za-z0-9_-]+$/);
    expect(invRow.link).not.toContain(ID.invOverdueA);
    expect(invRow.messageText).toContain(`${P}INV-1001`);
    expect(invRow.messageText).toContain(invRow.link);
    expect(invRow.whatsappUrl).toMatch(/^https:\/\/wa\.me\/18685550142\?text=/);
    expect(invRow.willAutoEmail).toBe(false);

    expect(bookRow).toBeDefined();
    expect(bookRow.e164Phone).toBe('+18685550188');
    expect(bookRow.link).toContain(`/book/${P}island-studio`);
    expect(bookRow.messageText).toContain('Deep Tissue Massage');
    expect(bookRow.whatsappUrl).toMatch(/^https:\/\/wa\.me\/18685550188\?text=/);
    expect(bookRow.willAutoEmail).toBe(false);

    // Non-overdue, paid, >24h, already-reminded, cancelled, and other-tenant rows excluded.
    const returnedIds = new Set(items.map((i) => i.id));
    expect(returnedIds.has(ID.invSentFutureA)).toBe(false);
    expect(returnedIds.has(ID.invPaidA)).toBe(false);
    expect(returnedIds.has(ID.bookLaterA)).toBe(false);
    expect(returnedIds.has(ID.bookRemindedA)).toBe(false);
    expect(returnedIds.has(ID.bookCancelledA)).toBe(false);
    expect(returnedIds.has(ID.invOverdueB)).toBe(false);
    expect(returnedIds.has(ID.bookSoonB)).toBe(false);
  });

  it('RTS-02: scope filtering on GET and 403 enforcement on mark-sent without write access (nothing stamped)', async () => {
    // revenue:none + bookings:read sees only bookings, no invoices.
    const bookOnly = await getReady(ID.bizA, ID.staffBookReadOnly).expect(200);
    expect(bookOnly.body.items.some((i: any) => i.kind === 'invoice')).toBe(false);
    expect(bookOnly.body.items.some((i: any) => i.id === ID.bookTomorrowA)).toBe(true);
    expect(JSON.stringify(bookOnly.body)).not.toContain(`${P}INV-1001`);

    // revenue:read + bookings:none sees only invoices, no bookings.
    const revOnly = await getReady(ID.bizA, ID.staffRevReadOnly).expect(200);
    expect(revOnly.body.items.some((i: any) => i.kind === 'booking')).toBe(false);
    expect(revOnly.body.items.some((i: any) => i.id === ID.invOverdueA)).toBe(true);

    // Read-only member gets 403 on both mark-sent routes with nothing stamped.
    await postMarkSent(ID.bizA, 'invoice', ID.invOverdueA, ID.staffBothReadOnly).expect(403);
    await postMarkSent(ID.bizA, 'booking', ID.bookTomorrowA, ID.staffBothReadOnly).expect(403);

    // bookings:write + revenue:none gets 403 on invoice mark-sent.
    await postMarkSent(ID.bizA, 'invoice', ID.invOverdueA, ID.staffBookWriteOnly).expect(403);

    const bookAfter = await db.booking.findUnique({ where: { id: ID.bookTomorrowA } });
    expect(bookAfter.reminderSentAt).toBeNull();
    const invActs = await db.activity.findMany({
      where: { businessId: ID.bizA, entityType: 'invoice', entityId: ID.invOverdueA },
    });
    expect(invActs).toHaveLength(0);
  });

  it('RTS-03: tenant isolation refuses cross-business mark-sent with 404 and stamps nothing on the other business', async () => {
    await postMarkSent(ID.bizA, 'invoice', ID.invOverdueB, ID.ownerA).expect(404);
    await postMarkSent(ID.bizA, 'booking', ID.bookSoonB, ID.ownerA).expect(404);

    const bookB = await db.booking.findUnique({ where: { id: ID.bookSoonB } });
    expect(bookB.reminderSentAt).toBeNull();
  });

  it('RTS-04: marking booking and invoice sent stamps reminderSentAt / Activity row, removes them from Ready-to-Send, and makes zero provider calls', async () => {
    // bookings:write member marks booking sent.
    await postMarkSent(ID.bizA, 'booking', ID.bookTomorrowA, ID.staffBookWriteOnly).expect(201);
    const bookAfter = await db.booking.findUnique({ where: { id: ID.bookTomorrowA } });
    expect(bookAfter.reminderSentAt).not.toBeNull();

    // owner marks overdue invoice sent.
    await postMarkSent(ID.bizA, 'invoice', ID.invOverdueA, ID.ownerA).expect(201);
    const invActs = await db.activity.findMany({
      where: {
        businessId: ID.bizA,
        entityType: 'invoice',
        entityId: ID.invOverdueA,
        type: 'invoice.ready_to_send_marked',
      },
    });
    expect(invActs).toHaveLength(1);
    expect(invActs[0].actorId).toBe(ID.ownerA);

    // Both removed from Ready-to-Send list; zero provider emails sent.
    const afterList = await getReady(ID.bizA, ID.ownerA).expect(200);
    const remainingIds = new Set(afterList.body.items.map((i: any) => i.id));
    expect(remainingIds.has(ID.bookTomorrowA)).toBe(false);
    expect(remainingIds.has(ID.invOverdueA)).toBe(false);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('RTS-05 (D-82): Gmail-connected business reports willAutoEmail: true and scheduled booking reminders run ONLY for Gmail-connected businesses', async () => {
    const bizBList = await getReady(ID.bizB, ID.ownerB).expect(200);
    expect(bizBList.body.gmailConnected).toBe(true);
    const invB = bizBList.body.items.find((i: any) => i.id === ID.invOverdueB);
    const bookB = bizBList.body.items.find((i: any) => i.id === ID.bookSoonB);
    expect(invB?.willAutoEmail).toBe(false);
    expect(bookB?.willAutoEmail).toBe(true);

    // Run scheduled reminder loop directly: must email bizB (Gmail connected) and skip bizA (no Gmail).
    await (bookingsService as any).processBookingReminders();

    const sentBookingIds = sendEmailSpy.mock.calls.map((c: any[]) => c[0]?.templateData?.bookingId);
    expect(sentBookingIds).toContain(ID.bookSoonB);
    expect(sentBookingIds).not.toContain(ID.bookSoonA);

    const soonA = await db.booking.findUnique({ where: { id: ID.bookSoonA } });
    const soonB = await db.booking.findUnique({ where: { id: ID.bookSoonB } });
    expect(soonA.reminderSentAt).toBeNull();
    expect(soonB.reminderSentAt).not.toBeNull();
  });

  it('RTS-06: controlled clock advances the 24h booking window and daily invoice suppressions; non-remindable statuses return 409; invalid whatsappNumber falls back to phone', async () => {
    // Non-remindable invoice (PAID) and booking (CANCELLED) return 409 Conflict with nothing stamped.
    await postMarkSent(ID.bizA, 'invoice', ID.invPaidA, ID.ownerA).expect(409);
    await postMarkSent(ID.bizA, 'booking', ID.bookCancelledA, ID.ownerA).expect(409);
    const cancelledAfter = await db.booking.findUnique({ where: { id: ID.bookCancelledA } });
    expect(cancelledAfter.reminderSentAt).toBeNull();

    // Malformed whatsappNumber falls back to valid E.164 phone.
    await db.contact.update({
      where: { id: ID.contactInvA },
      data: { whatsappNumber: 'not-a-phone' },
    });

    // Advance controlled clock by 24h + 1m (so invOverdueA marked sent today reappears tomorrow,
    // and bookLaterA at +36h is now within the 24h window).
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
    const futureList = await readyToSendService.listDue(
      ID.bizA,
      { id: ID.ownerA, role: 'USER' },
      { now: tomorrow },
    );

    const invTomorrow = futureList.items.find((i: any) => i.kind === 'invoice' && i.id === ID.invOverdueA);
    const bookLater = futureList.items.find((i: any) => i.kind === 'booking' && i.id === ID.bookLaterA);
    expect(invTomorrow).toBeDefined();
    expect(invTomorrow.e164Phone).toBe('+18685550142');
    expect(bookLater).toBeDefined();
  });
});
