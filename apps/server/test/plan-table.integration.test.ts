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
  bizProducts: `${P}bizProducts`,
  bizStaff: `${P}bizStaff`,
  bizBookings: `${P}bizBookings`,
  bizRecurring: `${P}bizRecurring`,
  bizInvoices: `${P}bizInvoices`,
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

  await db.user.create({
    data: { id: ID.owner, email: `${P}owner@example.test`, name: 'Plan Owner', role: 'USER' },
  });

  await seedBusiness(ID.bizProducts, 'products-slug', 'V66F Products');
  await seedBusiness(ID.bizStaff, 'staff-slug', 'V66F Staff');
  await seedBusiness(ID.bizBookings, 'bookings-slug', 'V66F Bookings');
  await seedBusiness(ID.bizRecurring, 'recurring-slug', 'V66F Recurring');
  await seedBusiness(ID.bizInvoices, 'invoices-slug', 'V66F Invoices');
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
  if (app) await app.close();
  if (db) await cleanFixtures();
}, 30000);

describe('V1-66 PLAN-TABLE (D-160, D-161, D-162, D-155)', () => {
  it('PT-01: FREE allows 25 products and refuses the 26th with PLAN_LIMIT_REACHED; upgrading to FLOW admits the 26th', async () => {
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

    const refused26 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 26', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(refused26.status, `26th product on FREE: ${JSON.stringify(refused26.body)}`).toBe(403);
    expect(refused26.body).toMatchObject({
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
      .post(`/commerce/businesses/${ID.bizProducts}/products`)
      .set('x-test-user', ID.owner)
      .send({ name: 'Product 26 Paid', price: 50, currency: 'TTD', category: 'PRODUCT' });
    expect(ok26.status, `26th product on FLOW: ${JSON.stringify(ok26.body)}`).toBe(201);
  });

  it('PT-02: FREE allows 1 staff seat and refuses the 2nd; FLOW allows up to 5 and refuses the 6th', async () => {
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

  it('PT-03: FREE allows 25 monthly bookings and refuses the 26th', async () => {
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

    const before25 = await subscriptionsService.checkLimit(ID.bizBookings, 'bookings');
    expect(before25).toMatchObject({ allowed: true, current: 24, limit: 25, upgradeTo: 'FLOW' });

    const start25 = new Date(base.getTime() + 48 * 3_600_000);
    const end25 = new Date(start25.getTime() + 1_800_000);
    await db.booking.create({
      data: {
        id: `${P}bkg_25`,
        businessId: ID.bizBookings,
        contactId: ID.contactBookings,
        serviceId: ID.serviceBookings,
        staffId: ID.staffBookings,
        startTime: start25,
        endTime: end25,
        status: 'CONFIRMED',
      },
    });

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
  });

  it('PT-04: recurring invoices are refused on FREE and allowed on FLOW', async () => {
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
    expect(await db.recurringInvoice.count({ where: { businessId: ID.bizRecurring } })).toBe(0);

    await activatePlan(ID.bizRecurring, 'FLOW');
    const created = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizRecurring}/recurring-invoices`)
      .set('x-test-user', ID.owner)
      .send(body);
    expect(created.status, `recurring invoice on FLOW: ${JSON.stringify(created.body)}`).toBe(201);
  });

  it('PT-05: storefront orders and quick sales do not count toward the FREE monthly invoice cap; forged INV-ORD-* still counts', async () => {
    // 4 real invoices
    for (let i = 1; i <= 4; i++) {
      await db.invoice.create({
        data: {
          id: `${P}inv_real_${i}`,
          businessId: ID.bizInvoices,
          contactId: ID.contactInvoices,
          invoiceNumber: `INV-REAL-${i}`,
          status: 'SENT',
          subtotal: 100,
          taxAmount: 0,
          total: 100,
          currency: 'TTD',
        },
      });
    }

    // 1 STOREFRONT order with INV-<orderNumber> + 1 STOREFRONT order with INV-ORD-<orderNumber>
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
      ],
    });
    await db.invoice.createMany({
      data: [
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
      ],
    });

    const withOrders = await subscriptionsService.checkLimit(ID.bizInvoices, 'invoices');
    expect(withOrders, 'store orders + quick sales must not count toward invoice cap').toMatchObject({
      allowed: true,
      current: 4,
      limit: 5,
    });

    // Negative control: forged INV-ORD-* with no matching marketplace_orders row DOES count as the 5th invoice.
    await db.invoice.create({
      data: {
        id: `${P}inv_forged`,
        businessId: ID.bizInvoices,
        contactId: ID.contactInvoices,
        invoiceNumber: `INV-ORD-${P}FORGED`,
        status: 'SENT',
        subtotal: 100,
        taxAmount: 0,
        total: 100,
        currency: 'TTD',
      },
    });

    const atCap = await subscriptionsService.checkLimit(ID.bizInvoices, 'invoices');
    expect(atCap, 'forged INV-ORD-* must count and exhaust the FREE cap').toMatchObject({
      allowed: false,
      current: 5,
      limit: 5,
    });
  });

  it('PT-06: plan table and billing dashboard carry D-160/D-161 copy with no autopilot, unlimited AI, or dormant features', async () => {
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
    expect(byId.KEYFLOW.name).toBe('KEY Assistant');
    expect(byId.KEYFLOW.priceUSD).toBe(39);
    expect(byId.KEYFLOW.tagline).toMatch(/KEY assistant/i);

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

    // KEYFLOW billing dashboard treats 'Fair use' AI credits as uncapped (-1) until ENTITLE-001.
    await activatePlan(ID.bizCopy, 'KEYFLOW');
    const dashRes = await request(app.getHttpServer())
      .get(`/subscriptions/businesses/${ID.bizCopy}/billing-dashboard`)
      .set('x-test-user', ID.owner);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.aiUsage.isUnlimited).toBe(true);
    const aiResource = dashRes.body.resourceUsage.find((r: any) => r.key === 'ai_credits');
    expect(aiResource).toMatchObject({ limit: -1, isUnlimited: true });
  });
});
