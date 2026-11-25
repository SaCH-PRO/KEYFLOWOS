/**
 * READY-TO-SEND (P0 wedge-first; D-82, D-263):
 *   - GET /commerce/businesses/:businessId/ready-to-send
 *     Strictly read-only (never mints/mutates PaymentLink rows): returns overdue
 *     invoices (not yet marked sent today in Business.timezone) and bookings
 *     starting in the next 24h not yet reminded, each with plain-word prefilled
 *     WhatsApp text formatted in Business.timezone, E.164 phone, existing live
 *     tokenized link (no bare /pay/<id>), and honest willAutoEmail flag.
 *     Filtered by module read scopes (revenue:read / bookings:read, D-140 scoped
 *     OWNER bound) and nested contact tenancy / soft-delete / PRIVATE visibility.
 *   - POST /commerce/businesses/:businessId/ready-to-send/invoice/:id/mark-sent
 *     Requires revenue:write (403 otherwise); idempotently records an Activity
 *     row (no migration) so the invoice leaves today's Ready-to-Send queue.
 *   - POST /commerce/businesses/:businessId/ready-to-send/booking/:id/mark-sent
 *     Requires bookings:write (403 otherwise); idempotently stamps Booking.reminderSentAt.
 *   - BookingsService.processBookingReminders() AND FlowListener.handleBookingReminders()
 *     run scheduled email reminders ONLY for businesses with Gmail connected,
 *     bookingReminderMins > 0, and reminderSentAt: null (D-82).
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
const PENDING_SEND_EXPIRY = new Date('9999-12-31T23:59:59.999Z');

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  superAdmin: `${P}super_admin`,
  scopedOwnerA: `${P}scoped_owner_a`,
  staffBookReadOnly: `${P}staff_book_r`,
  staffRevReadOnly: `${P}staff_rev_r`,
  staffBothReadOnly: `${P}staff_both_r`,
  staffBookWriteOnly: `${P}staff_book_w`,
  staffNoScopes: `${P}staff_none`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  contactInvA: `${P}ct_inv_a`,
  contactBookA: `${P}ct_book_a`,
  contactDeletedA: `${P}ct_deleted_a`,
  contactPrivateA: `${P}ct_private_a`,
  contactB: `${P}ct_b`,
  serviceA: `${P}svc_a`,
  serviceB: `${P}svc_b`,
  invOverdueA: `${P}inv_overdue_a`,
  invOverdueNoLinkA: `${P}inv_nolink_a`,
  invOverduePendingLinkA: `${P}inv_pending_a`,
  invOverdueDeletedCtA: `${P}inv_delct_a`,
  invOverduePrivateCtA: `${P}inv_privct_a`,
  invSentFutureA: `${P}inv_sent_a`,
  invPaidA: `${P}inv_paid_a`,
  invOverdueB: `${P}inv_overdue_b`,
  linkOverdueA: `${P}link_overdue_a`,
  linkPendingA: `${P}link_pending_a`,
  bookTomorrowA: `${P}book_tomorrow_a`,
  bookLaterA: `${P}book_later_a`,
  bookRemindedA: `${P}book_reminded_a`,
  bookCancelledA: `${P}book_cancelled_a`,
  bookSoonA: `${P}book_soon_a`,
  bookSoonB: `${P}book_soon_b`,
  book24hFlowA: `${P}book_24h_a`,
  book24hFlowB: `${P}book_24h_b`,
};

const LIVE_TOKEN_A = 'v65eOpaqueLiveToken1234567890abcd';
const PENDING_TOKEN_A = 'v65ePendingSendToken1234567890abc';

let db: any;
let app: any;
let bookingsService: any;
let readyToSendService: any;
let flowListener: any;
const sendEmailSpy = vi.fn(async () => ({ id: 'sent_mock' }));

async function cleanup() {
  for (const sql of [
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { FlowListener } = await import('../src/modules/flow/flow.listener');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { FinancialCopilotService } = await import('../src/modules/commerce/financial-copilot.service');

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    controllers: [ReadyToSendController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ReadyToSendService,
      BookingsService,
      FlowListener,
      { provide: CommerceService, useValue: { automatedInvoiceUrl: async () => null } },
      { provide: FinancialCopilotService, useValue: {} },
      { provide: TransactionalEmailService, useValue: { send: sendEmailSpy } },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => null } },
      { provide: SubscriptionsService, useValue: {} },
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
  flowListener = app.get(FlowListener);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' },
      { id: ID.superAdmin, email: `${P}super@test.local`, role: 'SUPER_ADMIN' },
      { id: ID.scopedOwnerA, email: `${P}scoped_owner@test.local`, role: 'USER' },
      { id: ID.staffBookReadOnly, email: `${P}book_r@test.local`, role: 'USER' },
      { id: ID.staffRevReadOnly, email: `${P}rev_r@test.local`, role: 'USER' },
      { id: ID.staffBothReadOnly, email: `${P}both_r@test.local`, role: 'USER' },
      { id: ID.staffBookWriteOnly, email: `${P}book_w@test.local`, role: 'USER' },
      { id: ID.staffNoScopes, email: `${P}none@test.local`, role: 'USER' },
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
        timezone: 'America/Port_of_Spain',
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
        timezone: 'America/Port_of_Spain',
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
        id: `${ID.scopedOwnerA}_m`,
        userId: ID.scopedOwnerA,
        businessId: ID.bizA,
        role: 'OWNER',
        permissionScopes: { bookings: 'read', revenue: 'none' },
      },
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
        permissionScopes: { revenue: 'read', bookings: 'none', crm: 'none' },
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
      {
        id: `${ID.staffNoScopes}_m`,
        userId: ID.staffNoScopes,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'none', bookings: 'none' },
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
        visibility: 'TEAM',
      },
      {
        id: ID.contactBookA,
        businessId: ID.bizA,
        firstName: 'Maya',
        lastName: 'Persad',
        email: `${P}maya@test.local`,
        phone: '868-555-0188',
        visibility: 'TEAM',
      },
      {
        id: ID.contactDeletedA,
        businessId: ID.bizA,
        firstName: 'Trashed',
        lastName: 'Person',
        email: `${P}trashed@test.local`,
        phone: '868-555-0177',
        visibility: 'TEAM',
        deletedAt: new Date(),
      },
      {
        id: ID.contactPrivateA,
        businessId: ID.bizA,
        firstName: 'Secret',
        lastName: 'Vip',
        email: `${P}vip@test.local`,
        phone: '868-555-0166',
        visibility: 'PRIVATE',
        ownerId: ID.ownerA,
      },
      {
        id: ID.contactB,
        businessId: ID.bizB,
        firstName: 'Devon',
        lastName: 'Charles',
        email: `${P}devon@test.local`,
        phone: '868-555-0199',
        visibility: 'TEAM',
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
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
        id: ID.invOverdueNoLinkA,
        businessId: ID.bizA,
        contactId: ID.contactInvA,
        invoiceNumber: `${P}INV-1004`,
        status: 'OVERDUE',
        total: 120,
        subtotal: 120,
        currency: 'TTD',
        dueDate: yesterday,
      },
      {
        id: ID.invOverduePendingLinkA,
        businessId: ID.bizA,
        contactId: ID.contactInvA,
        invoiceNumber: `${P}INV-1005`,
        status: 'OVERDUE',
        total: 130,
        subtotal: 130,
        currency: 'TTD',
        dueDate: yesterday,
      },
      {
        id: ID.invOverdueDeletedCtA,
        businessId: ID.bizA,
        contactId: ID.contactDeletedA,
        invoiceNumber: `${P}INV-1006`,
        status: 'OVERDUE',
        total: 140,
        subtotal: 140,
        currency: 'TTD',
        dueDate: yesterday,
      },
      {
        id: ID.invOverduePrivateCtA,
        businessId: ID.bizA,
        contactId: ID.contactPrivateA,
        invoiceNumber: `${P}INV-1007`,
        status: 'OVERDUE',
        total: 150,
        subtotal: 150,
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

  await db.paymentLink.createMany({
    data: [
      {
        id: ID.linkOverdueA,
        businessId: ID.bizA,
        invoiceId: ID.invOverdueA,
        token: LIVE_TOKEN_A,
        active: true,
        expiresAt: null,
      },
      {
        id: ID.linkPendingA,
        businessId: ID.bizA,
        invoiceId: ID.invOverduePendingLinkA,
        token: PENDING_TOKEN_A,
        active: true,
        expiresAt: PENDING_SEND_EXPIRY,
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
      {
        id: ID.book24hFlowA,
        businessId: ID.bizA,
        contactId: ID.contactBookA,
        serviceId: ID.serviceA,
        status: 'CONFIRMED',
        startTime: in24h,
        endTime: new Date(in24h.getTime() + 60 * 60 * 1000),
        reminderSentAt: null,
      },
      {
        id: ID.book24hFlowB,
        businessId: ID.bizB,
        contactId: ID.contactB,
        serviceId: ID.serviceB,
        status: 'CONFIRMED',
        startTime: in24h,
        endTime: new Date(in24h.getTime() + 60 * 60 * 1000),
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
  it('RTS-01: returns overdue invoice and next-24h unreminded bookings with plain WhatsApp text in Business.timezone, E.164 phone, existing tokenized link (no bare /pay/<id>), and zero provider calls', async () => {
    const res = await getReady(ID.bizA, ID.ownerA).expect(200);
    expect(res.body.gmailConnected).toBe(false);
    expect(sendEmailSpy).not.toHaveBeenCalled();

    const items: any[] = res.body.items;
    const invRow = items.find((i) => i.kind === 'invoice' && i.id === ID.invOverdueA);
    const bookRow = items.find((i) => i.kind === 'booking' && i.id === ID.bookTomorrowA);

    expect(invRow).toBeDefined();
    expect(invRow.e164Phone).toBe('+18685550142');
    expect(invRow.link).toMatch(new RegExp(`/public/invoice/${LIVE_TOKEN_A}$`));
    expect(invRow.link).not.toContain(ID.invOverdueA);
    expect(invRow.messageText).toContain(`${P}INV-1001`);
    expect(invRow.messageText).toContain(invRow.link);
    expect(invRow.whatsappUrl).toMatch(/^https:\/\/wa\.me\/18685550142\?text=/);
    expect(invRow.willAutoEmail).toBe(false);

    expect(bookRow).toBeDefined();
    expect(bookRow.e164Phone).toBe('+18685550188');
    expect(bookRow.link).toContain(`/book/${P}island-studio`);
    expect(bookRow.messageText).toContain('Deep Tissue Massage');
    // Formatted in America/Port_of_Spain, never misleadingly suffixed with UTC.
    expect(bookRow.messageText).not.toContain(' UTC');
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

  it('RTS-02: scope filtering on GET (including D-140 scoped OWNER and no-scope member) and 403 enforcement on mark-sent without write access (nothing stamped)', async () => {
    // revenue:none + bookings:read sees only bookings, no invoices.
    const bookOnly = await getReady(ID.bizA, ID.staffBookReadOnly).expect(200);
    expect(bookOnly.body.items.some((i: any) => i.kind === 'invoice')).toBe(false);
    expect(bookOnly.body.items.some((i: any) => i.id === ID.bookTomorrowA)).toBe(true);
    expect(JSON.stringify(bookOnly.body)).not.toContain(`${P}INV-1001`);

    // D-140: scoped OWNER with revenue:none sees no invoices.
    const scopedOwner = await getReady(ID.bizA, ID.scopedOwnerA).expect(200);
    expect(scopedOwner.body.items.some((i: any) => i.kind === 'invoice')).toBe(false);
    expect(scopedOwner.body.items.some((i: any) => i.id === ID.bookTomorrowA)).toBe(true);

    // revenue:none + bookings:none gets empty queue and does not leak gmailConnected.
    const noScopes = await getReady(ID.bizA, ID.staffNoScopes).expect(200);
    expect(noScopes.body.items).toEqual([]);
    expect(noScopes.body.counts).toEqual({ invoices: 0, bookings: 0, total: 0 });
    expect(noScopes.body.gmailConnected).toBe(false);

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

  it('RTS-04: marking booking and invoice sent is idempotent, stamps reminderSentAt / Activity row, removes them from Ready-to-Send, and makes zero provider calls', async () => {
    // bookings:write member marks booking sent; repeat call is idempotent.
    const firstBookMark = await postMarkSent(ID.bizA, 'booking', ID.bookTomorrowA, ID.staffBookWriteOnly).expect(201);
    const secondBookMark = await postMarkSent(ID.bizA, 'booking', ID.bookTomorrowA, ID.staffBookWriteOnly).expect(201);
    expect(secondBookMark.body.markedSentAt).toBe(firstBookMark.body.markedSentAt);

    const bookAfter = await db.booking.findUnique({ where: { id: ID.bookTomorrowA } });
    expect(bookAfter.reminderSentAt).not.toBeNull();

    // owner marks overdue invoice sent; repeat call on the same local day is idempotent.
    const firstInvMark = await postMarkSent(ID.bizA, 'invoice', ID.invOverdueA, ID.ownerA).expect(201);
    const secondInvMark = await postMarkSent(ID.bizA, 'invoice', ID.invOverdueA, ID.ownerA).expect(201);
    expect(secondInvMark.body.markedSentAt).toBe(firstInvMark.body.markedSentAt);

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

    // Deterministic check at the exact timestamp of mark-sent (no midnight-rollover race).
    const markTime = new Date(firstInvMark.body.markedSentAt);
    const afterList = await readyToSendService.listDue(
      ID.bizA,
      { id: ID.ownerA, role: 'USER' },
      { now: markTime },
    );
    const remainingIds = new Set(afterList.items.map((i: any) => i.id));
    expect(remainingIds.has(ID.bookTomorrowA)).toBe(false);
    expect(remainingIds.has(ID.invOverdueA)).toBe(false);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('RTS-05 (D-82): Gmail-connected business reports truthful willAutoEmail, and BOTH BookingsService and FlowListener scheduled reminders run ONLY for Gmail-connected businesses with reminderSentAt: null', async () => {
    const bizBList = await getReady(ID.bizB, ID.ownerB).expect(200);
    expect(bizBList.body.gmailConnected).toBe(true);
    const invB = bizBList.body.items.find((i: any) => i.id === ID.invOverdueB);
    const bookB = bizBList.body.items.find((i: any) => i.id === ID.bookSoonB);
    expect(invB?.willAutoEmail).toBe(false);
    expect(bookB?.willAutoEmail).toBe(true);

    // 1. BookingsService.processBookingReminders() emails bizB (Gmail connected) and skips bizA (no Gmail).
    await (bookingsService as any).processBookingReminders();

    const sentFromBookings = sendEmailSpy.mock.calls.map((c: any[]) => c[0]?.templateData?.bookingId);
    expect(sentFromBookings).toContain(ID.bookSoonB);
    expect(sentFromBookings).not.toContain(ID.bookSoonA);

    const soonA = await db.booking.findUnique({ where: { id: ID.bookSoonA } });
    const soonB = await db.booking.findUnique({ where: { id: ID.bookSoonB } });
    expect(soonA.reminderSentAt).toBeNull();
    expect(soonB.reminderSentAt).not.toBeNull();

    // 2. FlowListener.handleBookingReminders() ALSO emails ONLY bizB (24h window), skips bizA (no Gmail),
    // and stamps reminderSentAt so BookingsService will not send a duplicate later.
    sendEmailSpy.mockClear();
    await flowListener.handleBookingReminders();

    const sentFromFlow = sendEmailSpy.mock.calls.map((c: any[]) => c[0]?.templateData?.bookingId);
    expect(sentFromFlow).toContain(ID.book24hFlowB);
    expect(sentFromFlow).not.toContain(ID.book24hFlowA);

    const flowA = await db.booking.findUnique({ where: { id: ID.book24hFlowA } });
    const flowB = await db.booking.findUnique({ where: { id: ID.book24hFlowB } });
    expect(flowA.reminderSentAt).toBeNull();
    expect(flowB.reminderSentAt).not.toBeNull();
  });

  it('RTS-06: controlled clock honors Business.timezone day boundary (America/Port_of_Spain, not UTC midnight), 409 on non-remindable statuses, and malformed whatsappNumber fallback', async () => {
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

    // Controlled clock in America/Port_of_Spain (UTC-4):
    // Mark invOverdueNoLinkA sent at 2026-12-01T23:55:00Z (7:55 PM local AST).
    const markAt = new Date('2026-12-01T23:55:00.000Z');
    await readyToSendService.markInvoiceSent(ID.bizA, ID.invOverdueNoLinkA, ID.ownerA, { now: markAt });

    // At 2026-12-02T00:05:00Z (8:05 PM local AST — past UTC midnight, STILL same local day!):
    // invOverdueNoLinkA must remain suppressed.
    const sameLocalEvening = new Date('2026-12-02T00:05:00.000Z');
    const eveningList = await readyToSendService.listDue(
      ID.bizA,
      { id: ID.ownerA, role: 'USER' },
      { now: sameLocalEvening },
    );
    expect(eveningList.items.some((i: any) => i.id === ID.invOverdueNoLinkA)).toBe(false);

    // At 2026-12-02T04:05:00Z (12:05 AM next local day AST):
    // invOverdueNoLinkA must reappear, with fallback E.164 phone.
    const nextLocalMorning = new Date('2026-12-02T04:05:00.000Z');
    const morningList = await readyToSendService.listDue(
      ID.bizA,
      { id: ID.ownerA, role: 'USER' },
      { now: nextLocalMorning },
    );
    const invNextDay = morningList.items.find((i: any) => i.kind === 'invoice' && i.id === ID.invOverdueNoLinkA);
    expect(invNextDay).toBeDefined();
    expect(invNextDay.e164Phone).toBe('+18685550142');
  });

  it('RTS-07 (Security): GET ready-to-send never mints/mutates PaymentLink rows (for revenue:read staff or non-member SUPER_ADMIN), and suppresses soft-deleted and unshared PRIVATE contact PII', async () => {
    const linksBefore = await db.paymentLink.findMany({
      where: { businessId: ID.bizA },
      select: { id: true, token: true, expiresAt: true },
      orderBy: { id: 'asc' },
    });

    // Both revenue:read staff AND non-member SUPER_ADMIN call GET ready-to-send.
    const staffRes = await getReady(ID.bizA, ID.staffRevReadOnly).expect(200);
    await getReady(ID.bizA, ID.superAdmin).expect(200);

    // Zero new PaymentLink rows created; PENDING_SEND_EXPIRY link left untouched.
    const linksAfter = await db.paymentLink.findMany({
      where: { businessId: ID.bizA },
      select: { id: true, token: true, expiresAt: true },
      orderBy: { id: 'asc' },
    });
    expect(linksAfter).toEqual(linksBefore);

    // Invoice with no link returns link: null; invoice with PENDING_SEND_EXPIRY returns link: null.
    const noLinkRow = staffRes.body.items.find((i: any) => i.id === ID.invOverdueNoLinkA);
    const pendingLinkRow = staffRes.body.items.find((i: any) => i.id === ID.invOverduePendingLinkA);
    expect(noLinkRow?.link).toBeNull();
    expect(pendingLinkRow?.link).toBeNull();

    // Soft-deleted contact PII suppressed for everyone (including owner).
    const ownerRes = await getReady(ID.bizA, ID.ownerA).expect(200);
    const deletedCtRow = ownerRes.body.items.find((i: any) => i.id === ID.invOverdueDeletedCtA);
    expect(deletedCtRow).toBeDefined();
    expect(deletedCtRow.customerEmail).toBeNull();
    expect(deletedCtRow.e164Phone).toBeNull();
    expect(deletedCtRow.whatsappUrl).toBeNull();
    expect(deletedCtRow.customerName).toBe('there');

    // PRIVATE contact owned by ownerA: staffRevReadOnly (crm:none) gets PII withheld, ownerA sees it.
    const privForStaff = staffRes.body.items.find((i: any) => i.id === ID.invOverduePrivateCtA);
    expect(privForStaff).toBeDefined();
    expect(privForStaff.customerEmail).toBeNull();
    expect(privForStaff.e164Phone).toBeNull();
    expect(privForStaff.whatsappUrl).toBeNull();
    expect(privForStaff.customerName).toBe('there');
    expect(JSON.stringify(privForStaff)).not.toContain('8685550166');
    expect(JSON.stringify(privForStaff)).not.toContain('vip@test.local');

    const privForOwner = ownerRes.body.items.find((i: any) => i.id === ID.invOverduePrivateCtA);
    expect(privForOwner?.e164Phone).toBe('+18685550166');
  });
});
