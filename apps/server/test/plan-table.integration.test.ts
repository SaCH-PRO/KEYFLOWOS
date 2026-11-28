/**
 * V1-66 (PLAN-TABLE) — One plan and feature table: every advertised limit is
 * enforced or removed; FREE lets a habit form; plan copy carries no autopilot,
 * unlimited AI, or dormant features (owner rulings D-160 `plans`, D-161
 * `plancopy`, D-162 `paykeyflow`, D-155 `quicksale`). REAL database.
 *
 * FIXTURES: every row carries the `v66f_` prefix (registered in
 * test/helpers/fixture-prefixes.json as `V1-66 (PLAN-TABLE)`) or belongs to a
 * `v66f_` business, and is hard-deleted with `LIKE ${sqlLikePrefix(P)}` in
 * beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66f_';
const ID = {
  owner: `${P}owner`,
  superAdminOutsider: `${P}superAdminOut`,
  bizProducts: `${P}bizProducts`,
  bizStaff: `${P}bizStaff`,
  bizStaffRace: `${P}bizStaffRace`,
  bizBookings: `${P}bizBookings`,
  bizRecurring: `${P}bizRecurring`,
  bizInvoices: `${P}bizInvoices`,
  bizOtherTenant: `${P}bizOther`,
  bizCopy: `${P}bizCopy`,
  contactRecurring: `${P}contactRec`,
  contactInvoices: `${P}contactInv`,
  contactBookings: `${P}contactBkg`,
  serviceBookings: `${P}svcBkg`,
  staffBookings: `${P}staffBkg`,
};

let db: any;
let app: any;
let subscriptionsService: any;

async function cleanFixtures() {
  const stmts = [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscription_payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ];
  for (const sql of stmts) {
    await db.$executeRawUnsafe(sql);
  }
}

async function seedBusiness(businessId: string, slugSuffix: string, name: string) {
  await db.business.create({
    data: { id: businessId, name, slug: `${P}${slugSuffix}`, ownerId: ID.owner },
  });
  await db.membership.create({
    data: { userId: ID.owner, businessId, role: 'OWNER' },
  });
}

async function activatePlan(businessId: string, plan: 'FLOW' | 'KEYFLOW') {
  const res = await request(app.getHttpServer())
    .post(`/subscriptions/businesses/${businessId}/record-payment`)
    .set('x-test-user', ID.owner)
    .send({ plan, currency: 'USD', method: 'manual', reference: `${P}ref-${plan}` });
  expect(res.status, `activate ${plan}: ${JSON.stringify(res.body)}`).toBe(201);
}

async function cancelPlan(businessId: string) {
  const res = await request(app.getHttpServer())
    .post(`/subscriptions/businesses/${businessId}/cancel`)
    .set('x-test-user', ID.owner)
    .send({});
  expect(res.status, `cancel plan: ${JSON.stringify(res.body)}`).toBe(201);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');

  const { SubscriptionsController } = await import('../src/modules/subscriptions/subscriptions.controller');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');

  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { CatalogController } = await import('../src/modules/catalog/catalog.controller');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { RecurringInvoiceController } = await import('../src/modules/commerce/recurring-invoice.controller');
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');

  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');

  const eventStub = { emit: () => true, emitAsync: async () => [] };
  const redisStub = {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    incr: async () => 1,
    expire: async () => 1,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [
      SubscriptionsController,
      BookingsController,
      CatalogController,
      CommerceController,
      RecurringInvoiceController,
    ],
    providers: [
      PrismaService,
      SubscriptionsService,
      PlanLimitGuard,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redisStub },
      BookingsService,
      CommerceService,
      RecurringInvoiceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ResilientEmitterService, useValue: eventStub },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      CatalogService,
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined, logStorefrontEvent: async () => undefined, backstitchVisitor: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: BookingWaitlistService, useValue: {} },
      { provide: CalendarService, useValue: { syncBookingToCalendar: async () => null } },
      { provide: BookingOptimizerService, useValue: {} },
    ],
  }).compile();

  subscriptionsService = moduleRef.get(SubscriptionsService);

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const userId = req.headers['x-test-user'];
    if (typeof userId === 'string' && userId.length > 0) {
      db.user
        .findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } })
        .then((u: any) => {
          if (u) req.user = u;
          next();
        })
        .catch(next);
      return;
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanFixtures();

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@example.test`, name: 'Plan Owner', role: 'USER' },
      { id: ID.superAdminOutsider, email: `${P}sa-outsider@example.test`, name: 'SA Outsider', role: 'SUPER_ADMIN' },
    ],
  });

  await seedBusiness(ID.bizProducts, 'products-slug', 'V66F Products');
  await seedBusiness(ID.bizStaff, 'staff-slug', 'V66F Staff');
  await seedBusiness(ID.bizStaffRace, 'staff-race-slug', 'V66F Staff Race');
  await seedBusiness(ID.bizBookings, 'bookings-slug', 'V66F Bookings');
  await seedBusiness(ID.bizRecurring, 'recurring-slug', 'V66F Recurring');
  await seedBusiness(ID.bizInvoices, 'invoices-slug', 'V66F Invoices');
  await seedBusiness(ID.bizOtherTenant, 'other-slug', 'V66F Other Tenant');
  await seedBusiness(ID.bizCopy, 'copy-slug', 'V66F Copy');

  await db.contact.createMany({
    data: [
      { id: ID.contactRecurring, businessId: ID.bizRecurring, firstName: 'Rec', lastName: 'Client', email: `${P}rec@example.test` },
      { id: ID.contactInvoices, businessId: ID.bizInvoices, firstName: 'Inv', lastName: 'Client', email: `${P}inv@example.test` },
      { id: ID.contactBookings, businessId: ID.bizBookings, firstName: 'Bkg', lastName: 'Client', email: `${P}bkg@example.test` },
    ],
  });

  await db.service.create({
    data: { id: ID.serviceBookings, businessId: ID.bizBookings, name: 'Consultation', duration: 30, price: 100 },
  });
  await db.staffMember.create({
    data: { id: ID.staffBookings, businessId: ID.bizBookings, name: 'Lead Stylist' },
  });
}, 60000);

afterAll(async () => {
  try {
    if (app) await app.close();
  } finally {
    if (db) await cleanFixtures();
  }
}, 30000);

describe('V1-66 PLAN-TABLE (D-160, D-161, D-162, D-155)', () => {
  it('PT-01: FREE allows 25 products and refuses the 26th on both /commerce and canonical /catalog doors; upgrading to FLOW admits the 26th', async () => {
    const rows = Array.from({ length: 24 }, (_, idx) => ({
      id: `${P}prod_${idx + 1}`,
      businessId: ID.bizProducts,
      name: `Product ${idx + 1}`,
      price: 50,
      currency: 'TTD',
      category: 'PRODUCT',
    }));
    await db.product.createMany({ data: rows });

    const ok25 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 25', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(ok25.status, `25th product on FREE: ${JSON.stringify(ok25.body)}`).toBe(201);

    const refused26Commerce = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 26', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(refused26Commerce.status, `26th product via /commerce: ${JSON.stringify(refused26Commerce.body)}`).toBe(403);
    expect(refused26Commerce.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'products',
        current: 25,
        limit: 25,
        upgradeTo: 'FLOW',
      },
    });

    // R1-COR-01: canonical /catalog door enforces the exact same products cap.
    const refused26Catalog = await request(app.getHttpServer())
      .post(`/catalog/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 26 Catalog', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(refused26Catalog.status, `26th product via /catalog: ${JSON.stringify(refused26Catalog.body)}`).toBe(403);
    expect(refused26Catalog.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'products',
        current: 25,
        limit: 25,
        upgradeTo: 'FLOW',
      },
    });

    await activatePlan(ID.bizProducts, 'FLOW');
    const ok26 = await request(app.getHttpServer())
      .post(`/catalog/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 26 Paid', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(ok26.status, `26th product on FLOW via /catalog: ${JSON.stringify(ok26.body)}`).toBe(201);
  });

  it('PT-02: FREE allows 1 staff seat (soft-delete frees seat; concurrent creates serialize); FLOW allows 5 and refuses 6th', async () => {
    const first = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizStaff}/staff`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Seat 1' });
    expect(first.status, `1st staff on FREE: ${JSON.stringify(first.body)}`).toBe(201);

    const second = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizStaff}/staff`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Seat 2' });
    expect(second.status, `2nd staff on FREE: ${JSON.stringify(second.body)}`).toBe(403);
    expect(second.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'staff',
        current: 1,
        limit: 1,
        upgradeTo: 'FLOW',
      },
    });

    // Soft-deleting Seat 1 frees the single FREE seat for replacement.
    const del = await request(app.getHttpServer())
      .delete(`/bookings/businesses/${ID.bizStaff}/staff/${first.body.id}`)
      .set('x-test-user', ID.owner);
    expect(del.status).toBe(200);

    const replacement = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizStaff}/staff`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Seat 1 Replacement' });
    expect(replacement.status, `replacement staff after delete: ${JSON.stringify(replacement.body)}`).toBe(201);

    // SEC-PT-2: two concurrent createStaff requests on FREE at 0/1 serialize under advisory lock.
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/bookings/businesses/${ID.bizStaffRace}/staff`)
        .set('x-test-user', ID.owner)
        .send({ name: 'Concurrent A' }),
      request(app.getHttpServer())
        .post(`/bookings/businesses/${ID.bizStaffRace}/staff`)
        .set('x-test-user', ID.owner)
        .send({ name: 'Concurrent B' }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses, `concurrent FREE createStaff statuses: ${JSON.stringify([r1.body, r2.body])}`).toEqual([201, 403]);
    expect(await db.staffMember.count({ where: { businessId: ID.bizStaffRace, deletedAt: null } })).toBe(1);

    await activatePlan(ID.bizStaff, 'FLOW');
    for (let i = 2; i <= 5; i++) {
      const ok = await request(app.getHttpServer())
        .post(`/bookings/businesses/${ID.bizStaff}/staff`)
        .set('x-test-user', ID.owner)
        .send({ name: `Seat ${i}` });
      expect(ok.status, `staff ${i} on FLOW: ${JSON.stringify(ok.body)}`).toBe(201);
    }

    const sixth = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizStaff}/staff`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Seat 6' });
    expect(sixth.status, `6th staff on FLOW: ${JSON.stringify(sixth.body)}`).toBe(403);
    expect(sixth.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'staff',
        current: 5,
        limit: 5,
        upgradeTo: 'KEYFLOW',
      },
    });
  });

  it('PT-03: FREE allows 25 monthly bookings via HTTP and refuses the 26th; FLOW admits the 26th', async () => {
    const base = new Date();
    const bookingRows = Array.from({ length: 24 }, (_, idx) => {
      const start = new Date(base.getTime() + (idx + 1) * 3_600_000);
      const end = new Date(start.getTime() + 1_800_000);
      return {
        id: `${P}bkg_${idx + 1}`,
        businessId: ID.bizBookings,
        contactId: ID.contactBookings,
        serviceId: ID.serviceBookings,
        staffId: ID.staffBookings,
        startTime: start,
        endTime: end,
        status: 'CONFIRMED',
      };
    });
    await db.booking.createMany({ data: bookingRows });

    const start25 = new Date(base.getTime() + 48 * 3_600_000);
    const end25 = new Date(start25.getTime() + 1_800_000);
    const ok25 = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizBookings}`)
      .set('x-test-user', ID.owner)
      .send({
        contactId: ID.contactBookings,
        serviceId: ID.serviceBookings,
        staffId: ID.staffBookings,
        startTime: start25.toISOString(),
        endTime: end25.toISOString(),
      });
    expect(ok25.status, `25th booking on FREE: ${JSON.stringify(ok25.body)}`).toBe(201);

    const start26 = new Date(base.getTime() + 72 * 3_600_000);
    const end26 = new Date(start26.getTime() + 1_800_000);
    const refused26 = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizBookings}`)
      .set('x-test-user', ID.owner)
      .send({
        contactId: ID.contactBookings,
        serviceId: ID.serviceBookings,
        staffId: ID.staffBookings,
        startTime: start26.toISOString(),
        endTime: end26.toISOString(),
      });
    expect(refused26.status, `26th booking on FREE: ${JSON.stringify(refused26.body)}`).toBe(403);
    expect(refused26.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'bookings',
        current: 25,
        limit: 25,
        upgradeTo: 'FLOW',
      },
    });

    await activatePlan(ID.bizBookings, 'FLOW');
    const ok26 = await request(app.getHttpServer())
      .post(`/bookings/businesses/${ID.bizBookings}`)
      .set('x-test-user', ID.owner)
      .send({
        contactId: ID.contactBookings,
        serviceId: ID.serviceBookings,
        staffId: ID.staffBookings,
        startTime: start26.toISOString(),
        endTime: end26.toISOString(),
      });
    expect(ok26.status, `26th booking on FLOW: ${JSON.stringify(ok26.body)}`).toBe(201);
  });

  it('PT-04: recurring invoices run D-46 before plan check, refuse FREE with readable copy, allow FLOW, and block downgraded reactivation', async () => {
    const nextRun = new Date(Date.now() + 86_400_000).toISOString();
    const body = {
      contactId: ID.contactRecurring,
      name: 'Monthly Retainer',
      frequency: 'MONTHLY',
      amount: 500,
      currency: 'TTD',
      startDate: nextRun,
      nextRunDate: nextRun,
    };

    // SEC-PT-1: non-member SUPER_ADMIN on FREE tenant MUST hit D-46 before plan limit (no plan-tier oracle).
    const saRefused = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices`)
      .set('x-test-user', ID.superAdminOutsider)
      .send(body);
    expect(saRefused.status, `non-member SUPER_ADMIN on FREE recurring-invoices: ${JSON.stringify(saRefused.body)}`).toBe(403);
    expect(saRefused.body.message).toBe('Not authorized to update this invoice');
    expect(saRefused.body.error).not.toBe('PLAN_LIMIT_REACHED');

    // R1-COR-02: FREE owner gets readable feature-locked message (no raw snake_case or "(0/0)").
    const refused = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices`)
      .set('x-test-user', ID.owner)
      .send(body);
    expect(refused.status, `recurring invoice on FREE: ${JSON.stringify(refused.body)}`).toBe(403);
    expect(refused.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: {
        resource: 'recurring_invoices',
        limit: 0,
        upgradeTo: 'FLOW',
      },
    });
    expect(refused.body.message).toMatch(/Recurring Invoices is not available on your current plan/i);
    expect(refused.body.message).not.toContain('recurring_invoices');
    expect(refused.body.message).not.toContain('(0/0)');
    expect(await db.recurringInvoice.count({ where: { businessId: ID.bizRecurring } })).toBe(0);

    await activatePlan(ID.bizRecurring, 'FLOW');
    const created = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices`)
      .set('x-test-user', ID.owner)
      .send(body);
    expect(created.status, `recurring invoice on FLOW: ${JSON.stringify(created.body)}`).toBe(201);
    const scheduleId = created.body.id;

    // Pause on FLOW, then downgrade back to FREE.
    const paused = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices/${scheduleId}/pause`)
      .set('x-test-user', ID.owner)
      .send({});
    expect(paused.status).toBe(201);

    await cancelPlan(ID.bizRecurring);

    // R1-COR-04: downgraded FREE tenant cannot resume or PATCH status=ACTIVE.
    const resumeRefused = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices/${scheduleId}/resume`)
      .set('x-test-user', ID.owner)
      .send({});
    expect(resumeRefused.status, `resume after downgrade: ${JSON.stringify(resumeRefused.body)}`).toBe(403);
    expect(resumeRefused.body.error).toBe('PLAN_LIMIT_REACHED');

    const patchActiveRefused = await request(app.getHttpServer())
      .patch(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices/${scheduleId}`)
      .set('x-test-user', ID.owner)
      .send({ status: 'ACTIVE' });
    expect(patchActiveRefused.status, `PATCH ACTIVE after downgrade: ${JSON.stringify(patchActiveRefused.body)}`).toBe(403);
    expect(patchActiveRefused.body.error).toBe('PLAN_LIMIT_REACHED');
  });

  it('PT-05: storefront orders and quick sales do not count toward FREE invoice cap; forged, cross-tenant, and STANDARD orders still count', async () => {
    // 2 real invoices seeded directly
    for (let i = 1; i <= 2; i++) {
      await db.invoice.create({
        data: {
          id: `${P}inv_real_${i}`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `${P}INV-REAL-${i}`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
      });
    }

    // Exempt: 2 STOREFRONT (INV- and legacy INV-ORD-) + 1 QUICK_SALE (INV-)
    // Non-exempt negative controls: 1 STANDARD marketplace order + 1 cross-tenant STOREFRONT order
    await db.marketplaceOrder.createMany({
      data: [
        {
          id: `${P}ord_sf1`,
          businessId: ID.bizInvoices,
          orderNumber: `${P}SF-1`,
          type: 'STOREFRONT',
          status: 'CONFIRMED',
          subtotal: 100,
          total: 100,
          currency: 'TTD',
          customerName: 'Buyer 1',
        },
        {
          id: `${P}ord_sf2`,
          businessId: ID.bizInvoices,
          orderNumber: `${P}SF-2`,
          type: 'STOREFRONT',
          status: 'CONFIRMED',
          subtotal: 100,
          total: 100,
          currency: 'TTD',
          customerName: 'Buyer 2',
        },
        {
          id: `${P}ord_qs1`,
          businessId: ID.bizInvoices,
          orderNumber: `${P}QS-1`,
          type: 'QUICK_SALE',
          status: 'COMPLETED',
          subtotal: 50,
          total: 50,
          currency: 'TTD',
          customerName: 'Walk-in',
        },
        {
          id: `${P}ord_std1`,
          businessId: ID.bizInvoices,
          orderNumber: `${P}STD-1`,
          type: 'STANDARD',
          status: 'CONFIRMED',
          subtotal: 100,
          total: 100,
          currency: 'TTD',
          customerName: 'Marketplace Buyer',
        },
        {
          id: `${P}ord_other_sf`,
          businessId: ID.bizOtherTenant,
          orderNumber: `${P}OTHER-SF`,
          type: 'STOREFRONT',
          status: 'CONFIRMED',
          subtotal: 100,
          total: 100,
          currency: 'TTD',
          customerName: 'Other Tenant Buyer',
        },
      ],
    });
    await db.invoice.createMany({
      data: [
        // 3 exempt order invoices
        {
          id: `${P}inv_sf1`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-${P}SF-1`,
          status: 'PAID',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
        {
          id: `${P}inv_sf2`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-ORD-${P}SF-2`,
          status: 'PAID',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
        {
          id: `${P}inv_qs1`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-${P}QS-1`,
          status: 'PAID',
          subtotal: 50,
          taxAmount: 0,
          total: 50,
          currency: 'TTD',
        },
        // 2 non-exempt negative controls: STANDARD order + cross-tenant STOREFRONT order
        {
          id: `${P}inv_std1`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-${P}STD-1`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
        {
          id: `${P}inv_cross_sf`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-${P}OTHER-SF`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
      ],
    });

    // Billable count = 2 real + 1 STANDARD + 1 cross-tenant = 4 (3 same-tenant STOREFRONT/QUICK_SALE excluded).
    const withOrders = await subscriptionsService.checkLimit(ID.bizInvoices, 'invoices');
    expect(withOrders, 'same-tenant store orders + quick sales excluded; STANDARD & cross-tenant counted').toMatchObject({
      allowed: true,
      current: 4,
      limit: 5,
    });

    // 5th billable invoice via HTTP succeeds (201); 6th is refused (403 PLAN_LIMIT_REACHED).
    const ok5 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizInvoices}/invoices`)
      .set('x-test-user', ID.owner)
      .send({
        contactId: ID.contactInvoices,
        currency: 'TTD',
        items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
      });
    expect(ok5.status, `5th billable invoice on FREE: ${JSON.stringify(ok5.body)}`).toBe(201);

    const refused6 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizInvoices}/invoices`)
      .set('x-test-user', ID.owner)
      .send({
        contactId: ID.contactInvoices,
        currency: 'TTD',
        items: [{ description: 'Service 6', quantity: 1, unitPrice: 100 }],
      });
    expect(refused6.status, `6th billable invoice on FREE: ${JSON.stringify(refused6.body)}`).toBe(403);
    expect(refused6.body).toMatchObject({
      error: 'PLAN_LIMIT_REACHED',
      details: { resource: 'invoices', current: 5, limit: 5, upgradeTo: 'FLOW' },
    });

    // Negative control: forged INV-QS-* and INV-ORD-* without matching order rows are counted.
    await db.invoice.createMany({
      data: [
        {
          id: `${P}inv_forged_ord`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-ORD-${P}FORGED`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
        {
          id: `${P}inv_forged_qs`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-QS-${P}FORGED`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
      ],
    });
    const afterForged = await subscriptionsService.checkLimit(ID.bizInvoices, 'invoices');
    expect(afterForged, 'forged INV-ORD-* and INV-QS-* must both count').toMatchObject({
      allowed: false,
      current: 7,
      limit: 5,
    });
  });

  it('PT-06: plan table and FREE/FLOW/KEYFLOW billing dashboards carry D-160/D-161 copy, limits, upgradeTo, and atLimit', async () => {
    const plansRes = await request(app.getHttpServer()).get('/subscriptions/plans');
    expect(plansRes.status).toBe(200);
    const plans: any[] = plansRes.body;
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));

    expect(byId.FREE.limits).toMatchObject({
      contacts: 50,
      invoicesPerMonth: 5,
      bookingsPerMonth: 25,
      staffMembers: 1,
      products: 25,
      aiCreditsPerMonth: 50,
      quotesEnabled: true,
      onlineStore: true,
      recurringInvoices: false,
      expenses: -1,
    });
    expect(byId.FLOW).toMatchObject({ priceUSD: 15, priceTTD: 99 });
    expect(byId.FLOW.limits.warehouses).toBe(3);
    expect(byId.KEYFLOW).toMatchObject({ name: 'KEY Assistant', priceUSD: 39, priceTTD: 249 });
    expect(byId.KEYFLOW.limits.warehouses).toBe(-1);
    expect(byId.KEYFLOW.tagline).toMatch(/KEY assistant/i);

    const expensesCheck = await subscriptionsService.checkLimit(ID.bizCopy, 'expenses');
    expect(expensesCheck).toMatchObject({ allowed: true, limit: -1 });

    const regRes = await request(app.getHttpServer()).get('/subscriptions/feature-registry');
    expect(regRes.status).toBe(200);
    const { features, categories } = regRes.body;

    const allCopy: string[] = [
      ...plans.flatMap((p) => [p.name, p.tagline, ...(p.features ?? [])]),
      ...features.flatMap((f: any) => [
        f.label,
        f.description,
        String(f.tiers?.FREE ?? ''),
        String(f.tiers?.FLOW ?? ''),
        String(f.tiers?.KEYFLOW ?? ''),
      ]),
      ...Object.values(categories as Record<string, { label: string }>).map((c) => c.label),
    ];

    for (const forbidden of [
      /autopilot/i,
      /unlimited\s+ai/i,
      /\bcommunity\b/i,
      /\beducation\b|masterclass/i,
      /\bmarketplace\b/i,
      /custom\s+branding/i,
      /10\s+expenses/i,
    ]) {
      const offenders = allCopy.filter((line) => forbidden.test(line));
      expect(offenders, `forbidden copy matching ${forbidden}`).toEqual([]);
    }

    expect(byId.FREE.features.some((f: string) => /WhatsApp sharing/i.test(f))).toBe(true);
    expect(byId.FREE.features.some((f: string) => /Online store/i.test(f))).toBe(true);
    expect(byId.KEYFLOW.features.some((f: string) => /fair[- ]use/i.test(f))).toBe(true);
    expect(features.some((f: any) => f.key === 'whatsapp_sharing')).toBe(true);
    expect(features.some((f: any) => f.key === 'online_store' && f.tiers.FREE === true)).toBe(true);
    expect(features.some((f: any) => f.key === 'quotes' && f.tiers.FREE === true)).toBe(true);

    // FREE billing dashboard: quotes/online_store/whatsapp_sharing enabled; recurring_invoices locked to FLOW; automations atLimit=true.
    const freeDash = await request(app.getHttpServer())
      .get(`/subscriptions/businesses/${ID.bizCopy}/billing-dashboard`)
      .set('x-test-user', ID.owner);
    expect(freeDash.status).toBe(200);
    expect(freeDash.body.featureAccess.find((f: any) => f.key === 'quotes')).toMatchObject({ hasAccess: true, availableFrom: 'FREE' });
    expect(freeDash.body.featureAccess.find((f: any) => f.key === 'online_store')).toMatchObject({ hasAccess: true, availableFrom: 'FREE' });
    expect(freeDash.body.featureAccess.find((f: any) => f.key === 'whatsapp_sharing')).toMatchObject({ hasAccess: true, availableFrom: 'FREE' });
    expect(freeDash.body.featureAccess.find((f: any) => f.key === 'recurring_invoices')).toMatchObject({ hasAccess: false, availableFrom: 'FLOW' });
    expect(freeDash.body.resourceUsage.find((r: any) => r.key === 'automations')).toMatchObject({ limit: 0, atLimit: true, upgradeTo: 'FLOW' });
    expect(freeDash.body.resourceUsage.find((r: any) => r.key === 'expenses')).toBeUndefined();

    // FLOW billing dashboard: already-unlimited invoices must have upgradeTo: null (R1-COR-03).
    await activatePlan(ID.bizCopy, 'FLOW');
    const flowDash = await request(app.getHttpServer())
      .get(`/subscriptions/businesses/${ID.bizCopy}/billing-dashboard`)
      .set('x-test-user', ID.owner);
    expect(flowDash.status).toBe(200);
    expect(flowDash.body.resourceUsage.find((r: any) => r.key === 'invoices')).toMatchObject({ limit: -1, isUnlimited: true, upgradeTo: null });
    expect(flowDash.body.resourceUsage.find((r: any) => r.key === 'ai_credits')).toMatchObject({ limit: 500, upgradeTo: 'KEYFLOW' });

    // KEYFLOW billing dashboard treats 'Fair use' AI credits as uncapped (-1) until ENTITLE-001.
    await activatePlan(ID.bizCopy, 'KEYFLOW');
    const dashRes = await request(app.getHttpServer())
      .get(`/subscriptions/businesses/${ID.bizCopy}/billing-dashboard`)
      .set('x-test-user', ID.owner);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.aiUsage.isUnlimited).toBe(true);
    const aiResource = dashRes.body.resourceUsage.find((r: any) => r.key === 'ai_credits');
    expect(aiResource).toMatchObject({ limit: -1, isUnlimited: true, upgradeTo: null });
  });
});
