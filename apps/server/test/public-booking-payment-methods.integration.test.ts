/**
 * V1-64 (SWP-BOOKING-PAYMENT-GATE, BUG-037 server half) — a public booking
 * names only a payment method the business can take, against a REAL database
 * and REAL Redis, through the real route, guards, pipe and filter.
 *
 * At 5c17e7b4 POST /bookings/public/businesses/:businessId had no payment
 * method at all: the global ValidationPipe (whitelist) dropped `paymentMethod`
 * from the body, so a booking naming PAYPAL at a TTD business with no PayPal
 * was written (201, PENDING / UNPAID) and the customer was told "Payment:
 * PayPal" with nothing paid and no way to pay.
 *
 * The rule is the storefront checkout's (storefront-checkout-methods.ts;
 * owner rulings D-138, D-106, D-105, D-69, D-18): a public booking may name no
 * method, CASH, MANUAL, or a method the storefront gateway list
 * (PaymentsService.getStorefrontGateways, what GET /site/storefront/public/
 * :slug/gateways answers) offers for the business in its own currency:
 *   - PayPal / Stripe only with the business's OWN complete credentials; the
 *     platform env never stands in and is never mixed in (D-138);
 *   - PayPal only in a currency PayPal supports (D-106), WiPay only with the
 *     business's own merchant pair and for TTD (D-105, D-69).
 * A known method the business does not offer is 400 PAYMENT_METHOD_NOT_OFFERED;
 * a method no checkout takes is 400 PAYMENT_METHOD_UNSUPPORTED; either way
 * nothing is written (no booking, contact, invoice or storefront event).
 *
 * Side fix: POST /bookings/businesses/:businessId/services (the deprecated
 * pass-through to the catalog) answered 500 for a body it cannot store (for
 * example `durationMins` in place of `duration`); it answers 400.
 *
 * Cases (RED = fails at 5c17e7b4; CONTROL = green there, kept):
 *   PM-01 RED      TTD business, no PayPal: PAYPAL -> 400 PAYMENT_METHOD_NOT_OFFERED, nothing
 *                  written (RED-BEFORE: 201, a PENDING booking)
 *   PM-02 CONTROL  the same business: CASH -> 201; no method -> 201; MANUAL -> 201; ' cash ' -> 201
 *   PM-03 RED      the method is read trimmed and upper-cased: ' paypal ' is PAYPAL -> 400
 *   PM-04 RED      a method no checkout takes (BITCOIN) -> 400 PAYMENT_METHOD_UNSUPPORTED, nothing written
 *   PM-05 RED      a method that is not a string (number, object, array) -> 400, nothing written
 *   PM-06 RED/CTL  D-138: USD business with its own complete PayPal pair: PAYPAL -> 201; with only
 *                  a client id, or none, and the PLATFORM's PayPal env set: 400, nothing written
 *   PM-07 RED      D-106: TTD business WITH its own PayPal pair: PAYPAL -> 400 (PayPal takes no TTD)
 *   PM-08 RED/CTL  D-105 / D-69: WIPAY -> 201 for a TTD business with its own WiPay pair; 400 with
 *                  no pair, with the key alone, with WiPay's public sandbox key, and for a USD
 *                  business holding a pair
 *   PM-09 RED/CTL  D-138: STRIPE -> 201 with the business's own complete Stripe set; 400 with a
 *                  partial set and the platform's Stripe env set
 *   PM-10 RED      tenancy: another business's credentials never count. A TTD business with no
 *                  PayPal naming the slug of a store that has PayPal is still refused, and the
 *                  store that has PayPal is untouched
 *   PM-11 RED      parity: for every seeded business and every provider, the booking is accepted
 *                  exactly when PaymentsService.getStorefrontGateways lists the provider
 *   PM-12 CONTROL  a closed store and an unknown business answer the same for PAYPAL as for CASH
 *                  (the refusal says nothing about a closed store's payment settings)
 *   PM-13 RED      the refusal carries no credential, key or setting value
 *   PM-14 RED      review SEC-BPG-1 / COR-BPG-6 (RED at 24e946e8): a provider method is taken only
 *                  through the store's own share link. Without storefrontSlug, or with a slug that
 *                  is not this business's, PAYPAL / STRIPE / WIPAY are refused even where the
 *                  business offers them, with the same body a business that does not offer them
 *                  answers, so the route is no read of a business's payment settings by id; a
 *                  business with no slug takes no provider method; CASH and no method need no slug
 *   PM-15 RED      review SEC-BPG-3: BookingsService.publicCreateBooking itself refuses an unknown
 *                  and an unoffered method for a caller that is not the controller (green at
 *                  24e946e8, pinned), and a method that is not a string (RED at 24e946e8: read as
 *                  no method and booked); nothing written
 *   SV-01 RED      POST services with durationMins in place of duration -> 400 (RED-BEFORE: 500), no row
 *   SV-02 RED      POST services with a zero / negative / string / oversized duration,
 *                  a negative or string price, a blank or missing name, a non-string description or
 *                  sourceProductId, or no body -> 400, no row
 *   SV-04 RED      review SEC-BPG-2 / COR-BPG-3 (RED at 24e946e8): a NUL character in the name, the
 *                  description or sourceProductId (Postgres text refuses it: 500) -> 400, no row
 *                  (a fractional duration is not in SV-02: the route answers 201 and stores the whole
 *                  minutes, at 5c17e7b4 and now; measured, left as it is)
 *   SV-03 CONTROL  a valid body -> 201 and the row; another business's owner -> 403; anonymous -> 401
 *
 * Fixture prefix v64g_ (registered in test/helpers/fixture-prefixes.json);
 * rows are hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and
 * afterAll. No provider is called: the gate only reads settings.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64g_';
const HEADER = 'x-test-user-id';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

/** Every credential value seeded here carries this, so a leak is one string search. */
const CANARY = 'V64G_SECRET_';

const OWN_PAYPAL = { paypalClientId: `${CANARY}paypal_client`, paypalClientSecret: `${CANARY}paypal_secret` };
const OWN_STRIPE = {
  stripePublishableKey: `${CANARY}stripe_pk`,
  stripeSecretKey: `${CANARY}stripe_sk`,
  stripeWebhookSecret: `${CANARY}stripe_whsec`,
};
const OWN_WIPAY = { wipayApiKey: `${CANARY}wipay_key`, wipayAccountNumber: '4400000000' };

/** The businesses: [currency, settings]. Each is an open store with one bookable service. */
const BUSINESSES: Record<string, { currency: string; meta: Record<string, unknown> | null; storeEnabled?: boolean; noSlug?: boolean }> = {
  ttdBare: { currency: 'TTD', meta: null },
  ttdCashOnly: { currency: 'TTD', meta: { cashEnabled: true } },
  ttdPaypal: { currency: 'TTD', meta: { ...OWN_PAYPAL } },
  ttdWipay: { currency: 'TTD', meta: { ...OWN_WIPAY } },
  ttdWipayKeyOnly: { currency: 'TTD', meta: { wipayApiKey: OWN_WIPAY.wipayApiKey } },
  ttdWipaySandbox: { currency: 'TTD', meta: { wipayApiKey: '123', wipayAccountNumber: '4400000000' } },
  usdBare: { currency: 'USD', meta: null },
  usdPaypal: { currency: 'USD', meta: { ...OWN_PAYPAL } },
  usdPaypalIdOnly: { currency: 'USD', meta: { paypalClientId: OWN_PAYPAL.paypalClientId } },
  usdPaypalBlankSecret: { currency: 'USD', meta: { paypalClientId: OWN_PAYPAL.paypalClientId, paypalClientSecret: '   ' } },
  usdWipay: { currency: 'USD', meta: { ...OWN_WIPAY } },
  usdStripe: { currency: 'USD', meta: { ...OWN_STRIPE } },
  usdStripePartial: { currency: 'USD', meta: { stripePublishableKey: OWN_STRIPE.stripePublishableKey, stripeSecretKey: OWN_STRIPE.stripeSecretKey } },
  usdAll: { currency: 'USD', meta: { ...OWN_PAYPAL, ...OWN_STRIPE, ...OWN_WIPAY } },
  ttdClosed: { currency: 'TTD', meta: null, storeEnabled: false },
  // Every provider configured, but no slug: no share link, so no storefront gateway list (PM-14).
  usdAllNoSlug: { currency: 'USD', meta: { ...OWN_PAYPAL, ...OWN_STRIPE }, noSlug: true },
  ttdWipayNoSlug: { currency: 'TTD', meta: { ...OWN_WIPAY }, noSlug: true },
};
type Biz = keyof typeof BUSINESSES;

const bizId = (b: Biz) => `${P}biz_${b}`;
const ownerId = (b: Biz) => `${P}owner_${b}`;
const svcId = (b: Biz) => `${P}svc_${b}`;
const slugOf = (b: Biz) => `${P}store-${String(b).toLowerCase()}`;
const UNKNOWN_BIZ = `${P}biz_nosuch`;

/** The platform's own provider env, set for the D-138 cases and restored after each test. */
const PLATFORM_ENV = {
  PAYPAL_CLIENT_ID: `${CANARY}platform_paypal_client`,
  PAYPAL_CLIENT_SECRET: `${CANARY}platform_paypal_secret`,
  STRIPE_PUBLISHABLE_KEY: `${CANARY}platform_stripe_pk`,
  STRIPE_SECRET_KEY: `${CANARY}platform_stripe_sk`,
  STRIPE_WEBHOOK_SECRET: `${CANARY}platform_stripe_whsec`,
  WIPAY_API_KEY: `${CANARY}platform_wipay_key`,
  WIPAY_ACCOUNT_NUMBER: '4400000001',
};
const savedEnv: Record<string, string | undefined> = {};
function setPlatformEnv() {
  for (const [k, v] of Object.entries(PLATFORM_ENV)) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}
function restorePlatformEnv() {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
    delete savedEnv[k];
  }
}

/** A start time well in the future, distinct per booking so no slot collides. */
let slot = 0;
const nextStart = () => new Date(Date.UTC(2032, 0, 1, 0, 0, 0, 0) + slot++ * 3 * 3600_000);

let db: any;
let app: any;
let redis: any;
let payments: any;
let bookingsService: any;

const crmCalls: string[] = [];
const storefrontEvents: string[] = [];
const eventStub = {
  emit: () => true,
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
    crmCalls.push(businessId);
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

/**
 * The store page's create, anonymous, through the real route and guards. The body carries the store's own slug, as
 * its share link's page sends it (a business without a slug sends none); `extra` is merged in and may replace it.
 */
async function publicBook(b: Biz | string, extra: Record<string, unknown> = {}, serviceBiz?: Biz) {
  await clearRateLimits(); // the route takes 10 a minute; every case here is one customer's one request
  const businessId = b in BUSINESSES ? bizId(b as Biz) : (b as string);
  const service = serviceBiz ?? (b in BUSINESSES ? (b as Biz) : 'ttdBare');
  return request(app.getHttpServer())
    .post(`/bookings/public/businesses/${encodeURIComponent(businessId)}`)
    .send({
      serviceId: svcId(service),
      startTime: nextStart().toISOString(),
      firstName: 'Pat',
      lastName: 'Public',
      email: `${P}public@test.local`,
      phone: '+18685550100',
      ...(b in BUSINESSES && !BUSINESSES[b as Biz].noSlug ? { storefrontSlug: slugOf(b as Biz) } : {}),
      ...extra,
    });
}

/** Everything a public booking writes for a business, counted. */
async function written(b: Biz) {
  const businessId = bizId(b);
  const [bookings, contacts, invoices] = await Promise.all([
    db.booking.count({ where: { businessId } }),
    db.contact.count({ where: { businessId } }),
    db.invoice.count({ where: { businessId } }),
  ]);
  return {
    bookings,
    contacts,
    invoices,
    crmCalls: crmCalls.filter((id) => id === businessId).length,
    storefrontEvents: storefrontEvents.filter((id) => id === businessId).length,
  };
}

/** A refused booking: 400 with the code, and nothing written for the business. */
async function expectRefused(b: Biz, extra: Record<string, unknown>, code: string | null) {
  const before = await written(b);
  const res = await publicBook(b, extra);
  expect(res.status, `${String(b)} ${JSON.stringify(extra.paymentMethod)}: ${JSON.stringify(res.body)}`).toBe(400);
  if (code) expect(res.body.code).toBe(code);
  expect(res.body.bookingId).toBeUndefined();
  expect(JSON.stringify(res.body)).not.toContain(CANARY);
  expect(await written(b)).toEqual(before);
  return res;
}

/** An accepted booking: 201 and exactly one more booking for the business. */
async function expectBooked(b: Biz, extra: Record<string, unknown>) {
  const before = await written(b);
  const res = await publicBook(b, extra);
  expect(res.status, `${String(b)} ${JSON.stringify(extra.paymentMethod)}: ${JSON.stringify(res.body)}`).toBe(201);
  expect(res.body.bookingId).toEqual(expect.any(String));
  const row = await db.booking.findUnique({ where: { id: res.body.bookingId } });
  expect(row.businessId).toBe(bizId(b));
  expect(row.status).toBe('PENDING');
  expect((await written(b)).bookings).toBe(before.bookings + 1);
  return res;
}

const asOwner = (b: Biz) => ({ [HEADER]: ownerId(b) });
function postService(b: Biz, body: unknown, headers: Record<string, string> = asOwner(b)) {
  const req = request(app.getHttpServer()).post(`/bookings/businesses/${bizId(b)}/services`).set(headers);
  return body === undefined ? req.send() : req.send(body as object);
}
const serviceCount = (b: Biz) => db.service.count({ where: { businessId: bizId(b) } });

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
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { PublicCreateBookingDto } = await import('../src/modules/bookings/dto/public-create-booking.dto');

  // The public create's parameter types as tsc emits them for the production
  // build (emitDecoratorMetadata), which vitest's esbuild transform does not:
  // without them the global ValidationPipe passes every body unchecked. The
  // services POST is left exactly as each build emits it.
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
      RevenueAttributionService,
      CommerceService,
      InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      CatalogService,
      // Real: the storefront gateway list the booking gate must agree with (PM-11). No connector is provided.
      PaymentsService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: crmStub },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      {
        provide: PublicEventsService,
        useValue: {
          logStorefrontEvent: async (e: { businessId: string }) => { storefrontEvents.push(e.businessId); },
          backstitchVisitor: async () => undefined,
        },
      },
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
  payments = moduleRef.get(PaymentsService);
  bookingsService = moduleRef.get(BookingsService);

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  for (const b of Object.keys(BUSINESSES) as Biz[]) {
    const { currency, meta, storeEnabled, noSlug } = BUSINESSES[b];
    await db.user.create({ data: { id: ownerId(b), email: `${P}${String(b).toLowerCase()}@test.local`, role: 'USER' } });
    await db.business.create({
      data: {
        id: bizId(b),
        name: `V64G ${String(b)}`,
        ...(noSlug ? {} : { slug: slugOf(b) }),
        ownerId: ownerId(b),
        currency,
        timezone: 'UTC',
        storeEnabled: storeEnabled ?? true,
        ...(meta ? { metaData: meta } : {}),
      },
    });
    await db.membership.create({ data: { id: `${P}m_${String(b)}`, userId: ownerId(b), businessId: bizId(b), role: 'OWNER' } });
    await db.service.create({ data: { id: svcId(b), businessId: bizId(b), name: `V64G Consult ${String(b)}`, duration: 60, price: 100 } });
  }
}, 120_000);

beforeEach(async () => {
  await clearRateLimits();
});

afterEach(() => {
  restorePlatformEnv();
});

afterAll(async () => {
  restorePlatformEnv();
  try { await cleanup(); } catch { /* best-effort */ }
  try { if (redis) { await clearRateLimits(); await redis.quit(); } } catch { /* best-effort */ }
  try { await app?.close(); } catch { /* best-effort */ }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

// ---------------------------------------------------------------------------
describe('V1-64 POST /bookings/public/businesses/:businessId — the payment method a public booking names', () => {
  it('PM-01 RED-BEFORE: a TTD business with no PayPal refuses PAYPAL with 400 PAYMENT_METHOD_NOT_OFFERED and writes nothing', async () => {
    const res = await expectRefused('ttdBare', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    expect(res.body.message).toMatch(/paypal/i);
    await expectRefused('ttdCashOnly', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
  });

  it('PM-02 CONTROL: the same business books with CASH, with MANUAL, with no method and with a lower-case padded " cash "', async () => {
    await expectBooked('ttdBare', { paymentMethod: 'CASH' });
    await expectBooked('ttdBare', { paymentMethod: 'MANUAL' });
    await expectBooked('ttdBare', {});
    await expectBooked('ttdBare', { paymentMethod: ' cash ' });
    await expectBooked('ttdBare', { paymentMethod: '' });
    await expectBooked('ttdBare', { paymentMethod: '   ' });
  });

  it('PM-03 RED-BEFORE: the method is read trimmed and upper-cased, so " paypal " and "PayPal" are refused as PAYPAL', async () => {
    await expectRefused('ttdBare', { paymentMethod: ' paypal ' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdBare', { paymentMethod: 'PayPal' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdBare', { paymentMethod: '\tstripe\n' }, 'PAYMENT_METHOD_NOT_OFFERED');
  });

  it('PM-04 RED-BEFORE: a method no checkout takes is refused with 400 PAYMENT_METHOD_UNSUPPORTED and writes nothing', async () => {
    await expectRefused('ttdBare', { paymentMethod: 'BITCOIN' }, 'PAYMENT_METHOD_UNSUPPORTED');
    await expectRefused('usdAll', { paymentMethod: 'PAYPAL,CASH' }, 'PAYMENT_METHOD_UNSUPPORTED');
    await expectRefused('usdAll', { paymentMethod: 'bank transfer' }, 'PAYMENT_METHOD_UNSUPPORTED');
  });

  it('PM-05 RED-BEFORE: a method that is not a string is refused with 400 and writes nothing', async () => {
    await expectRefused('ttdBare', { paymentMethod: 7 }, null);
    await expectRefused('ttdBare', { paymentMethod: { method: 'PAYPAL' } }, null);
    await expectRefused('ttdBare', { paymentMethod: ['PAYPAL'] }, null);
    await expectRefused('ttdBare', { paymentMethod: true }, null);
    await expectRefused('usdPaypal', { paymentMethod: ['CASH'] }, null);
    await expectRefused('ttdBare', { paymentMethod: 'P'.repeat(500) }, null);
  });

  it('PM-06 D-138: PAYPAL books only with the business\'s own complete PayPal pair; the platform\'s PayPal never stands in', async () => {
    await expectBooked('usdPaypal', { paymentMethod: 'PAYPAL' });
    await expectBooked('usdPaypal', { paymentMethod: 'paypal' });
    await expectRefused('usdBare', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');

    setPlatformEnv();
    await expectRefused('usdBare', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdPaypalIdOnly', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdPaypalBlankSecret', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdStripe', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectBooked('usdPaypal', { paymentMethod: 'PAYPAL' });
  });

  it('PM-07 RED-BEFORE (D-106): a TTD business holding its own PayPal pair still refuses PAYPAL, which takes no TTD', async () => {
    await expectRefused('ttdPaypal', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectBooked('ttdPaypal', { paymentMethod: 'CASH' });
  });

  it('PM-08 D-105 / D-69: WIPAY books only for a TTD business with its own WiPay pair', async () => {
    await expectBooked('ttdWipay', { paymentMethod: 'WIPAY' });
    await expectRefused('ttdBare', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdWipayKeyOnly', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdWipaySandbox', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdWipay', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');

    setPlatformEnv();
    await expectRefused('ttdBare', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdWipayKeyOnly', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');
  });

  it('PM-09 D-138: STRIPE books only with the business\'s own complete Stripe set; the platform\'s Stripe never stands in', async () => {
    await expectBooked('usdStripe', { paymentMethod: 'STRIPE' });
    await expectRefused('usdBare', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdStripePartial', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');

    setPlatformEnv();
    await expectRefused('usdBare', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdStripePartial', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdPaypal', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');
  });

  it('PM-10 RED-BEFORE (tenancy): another store\'s credentials never count for the business being booked', async () => {
    const other = await written('usdPaypal');
    // The slug of a store that takes PayPal, sent to a business that does not.
    await expectRefused('usdBare', { paymentMethod: 'PAYPAL', storefrontSlug: slugOf('usdPaypal') }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdBare', { paymentMethod: 'PAYPAL', storefrontSlug: slugOf('usdAll') }, 'PAYMENT_METHOD_NOT_OFFERED');
    expect(await written('usdPaypal')).toEqual(other);

    // The service of a store that takes PayPal, sent to a business that does not: the method is refused first.
    const before = await written('usdBare');
    const res = await publicBook('usdBare', { paymentMethod: 'PAYPAL' }, 'usdPaypal');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await written('usdBare')).toEqual(before);
    expect(await written('usdPaypal')).toEqual(other);
  });

  it('PM-11 RED-BEFORE (parity): a provider method books exactly when the storefront gateway list offers it', async () => {
    const open = (Object.keys(BUSINESSES) as Biz[]).filter((b) => BUSINESSES[b].storeEnabled !== false);
    const disagreements: string[] = [];
    let offeredSomewhere = 0;
    for (const env of ['bare', 'platform'] as const) {
      if (env === 'platform') setPlatformEnv();
      for (const b of open) {
        // The list is the one GET /site/storefront/public/:slug/gateways answers: a business with no slug has none.
        const listed: string[] = BUSINESSES[b].noSlug
          ? []
          : (await payments.getStorefrontGateways(bizId(b))).map((g: { id: string }) => g.id.toUpperCase());
        for (const method of ['WIPAY', 'PAYPAL', 'STRIPE']) {
          const before = await written(b);
          const res = await publicBook(b, { paymentMethod: method });
          const offered = listed.includes(method);
          if (offered) offeredSomewhere++;
          const after = await written(b);
          const ok = offered
            ? res.status === 201 && after.bookings === before.bookings + 1
            : res.status === 400 && res.body.code === 'PAYMENT_METHOD_NOT_OFFERED' && JSON.stringify(after) === JSON.stringify(before);
          if (!ok) disagreements.push(`${env} ${String(b)} ${method}: listed=${offered} status=${res.status} code=${res.body?.code}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(offeredSomewhere).toBeGreaterThan(0); // the list offers something, so both sides of the rule ran
  }, 120_000);

  it('PM-12 CONTROL: a closed store and an unknown business answer PAYPAL exactly as they answer CASH', async () => {
    const before = await written('ttdClosed');
    const closedCash = await publicBook('ttdClosed', { paymentMethod: 'CASH' });
    const closedPaypal = await publicBook('ttdClosed', { paymentMethod: 'PAYPAL' });
    expect(closedCash.status).toBe(400);
    expect(closedCash.body.message).toBe('This store is currently unavailable.');
    expect({ status: closedPaypal.status, code: closedPaypal.body.code, message: closedPaypal.body.message }).toEqual({
      status: closedCash.status,
      code: closedCash.body.code,
      message: closedCash.body.message,
    });
    expect(await written('ttdClosed')).toEqual(before);

    const unknownCash = await publicBook(UNKNOWN_BIZ, { paymentMethod: 'CASH' });
    const unknownPaypal = await publicBook(UNKNOWN_BIZ, { paymentMethod: 'PAYPAL' });
    expect(unknownCash.status).toBeGreaterThanOrEqual(400);
    expect({ status: unknownPaypal.status, code: unknownPaypal.body.code, message: unknownPaypal.body.message }).toEqual({
      status: unknownCash.status,
      code: unknownCash.body.code,
      message: unknownCash.body.message,
    });
    expect(await db.booking.count({ where: { businessId: UNKNOWN_BIZ } })).toBe(0);
  });

  it('PM-13 RED-BEFORE: a refusal names the method and the reason only, never a key, a secret or a setting value', async () => {
    setPlatformEnv();
    for (const [b, method] of [
      ['usdPaypalIdOnly', 'PAYPAL'],
      ['usdStripePartial', 'STRIPE'],
      ['ttdWipayKeyOnly', 'WIPAY'],
      ['ttdPaypal', 'PAYPAL'],
      ['usdWipay', 'WIPAY'],
    ] as Array<[Biz, string]>) {
      const res = await expectRefused(b, { paymentMethod: method }, 'PAYMENT_METHOD_NOT_OFFERED');
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain('4400000000');
      expect(Object.keys(res.body).sort()).toEqual(expect.arrayContaining(['code', 'message', 'statusCode']));
      expect(res.body.metaData).toBeUndefined();
      expect(res.body.gateways).toBeUndefined();
    }
  });

  it('PM-14 RED-BEFORE (review SEC-BPG-1): a provider method is taken only with the business\'s own storefront slug, and the refusal is the same whatever the business holds', async () => {
    const shape = (res: any) => ({ status: res.status, code: res.body.code, message: res.body.message });
    for (const [has, lacks, method] of [
      ['usdAll', 'usdBare', 'PAYPAL'],
      ['usdAll', 'usdBare', 'STRIPE'],
      ['ttdWipay', 'ttdBare', 'WIPAY'],
    ] as Array<[Biz, Biz, string]>) {
      // What a business that does NOT offer the method answers through its own link.
      const reference = shape(await expectRefused(lacks, { paymentMethod: method }, 'PAYMENT_METHOD_NOT_OFFERED'));
      // A business that offers it, asked by id alone, by another store's slug, by a near-miss of its own slug.
      for (const slug of [undefined, null, '', slugOf(lacks), slugOf('usdPaypal'), slugOf(has).toUpperCase(), `${slugOf(has)}x`, bizId(has)]) {
        const res = await expectRefused(has, { paymentMethod: method, storefrontSlug: slug }, 'PAYMENT_METHOD_NOT_OFFERED');
        expect(shape(res), `${String(has)} ${method} slug=${JSON.stringify(slug)}`).toEqual(reference);
      }
      // And a business that does not offer it answers the same without a slug.
      expect(shape(await expectRefused(lacks, { paymentMethod: method, storefrontSlug: undefined }, 'PAYMENT_METHOD_NOT_OFFERED'))).toEqual(reference);
      // Through its own link the method books.
      await expectBooked(has, { paymentMethod: method });
    }

    // A business with no slug has no share link and no gateway list: no provider method, whatever it holds or is sent.
    await expectRefused('usdAllNoSlug', { paymentMethod: 'PAYPAL' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdAllNoSlug', { paymentMethod: 'STRIPE' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdAllNoSlug', { paymentMethod: 'PAYPAL', storefrontSlug: slugOf('usdAll') }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('usdAllNoSlug', { paymentMethod: 'PAYPAL', storefrontSlug: '' }, 'PAYMENT_METHOD_NOT_OFFERED');
    await expectRefused('ttdWipayNoSlug', { paymentMethod: 'WIPAY' }, 'PAYMENT_METHOD_NOT_OFFERED');

    // CASH, MANUAL and no method need no slug, as before.
    await expectBooked('usdAll', { paymentMethod: 'CASH', storefrontSlug: undefined });
    await expectBooked('usdAll', { storefrontSlug: undefined });
    await expectBooked('usdAllNoSlug', { paymentMethod: 'CASH' });
    await expectBooked('usdAllNoSlug', { paymentMethod: 'MANUAL' });
    await expectBooked('usdAllNoSlug', {});
  }, 120_000);

  it('PM-15 RED-BEFORE (review SEC-BPG-3): the service itself refuses an unknown, an unoffered and a non-string method for a caller that is not the controller', async () => {
    const direct = (b: Biz, paymentMethod: unknown, storefrontSlug: string | null = slugOf(b)) =>
      bookingsService.publicCreateBooking({
        businessId: bizId(b),
        serviceId: svcId(b),
        startTime: nextStart(),
        contact: { firstName: 'Pat', lastName: 'Public', email: `${P}public@test.local`, phone: '+18685550100' },
        storefrontSlug,
        paymentMethod,
      });
    for (const [b, method, code] of [
      ['usdAll', 'BITCOIN', 'PAYMENT_METHOD_UNSUPPORTED'],
      ['usdAll', ' bitcoin ', 'PAYMENT_METHOD_UNSUPPORTED'],
      ['ttdBare', 'PAYPAL', 'PAYMENT_METHOD_NOT_OFFERED'],
      ['ttdBare', ' paypal ', 'PAYMENT_METHOD_NOT_OFFERED'],
      ['usdBare', 'STRIPE', 'PAYMENT_METHOD_NOT_OFFERED'],
      ['usdWipay', 'WIPAY', 'PAYMENT_METHOD_NOT_OFFERED'],
    ] as Array<[Biz, string, string]>) {
      const before = await written(b);
      const error: any = await direct(b, method).then(() => null, (e: unknown) => e);
      expect(error, `${String(b)} ${method}`).not.toBeNull();
      expect(error.getStatus?.()).toBe(400);
      expect(error.getResponse?.().code).toBe(code);
      expect(await written(b)).toEqual(before);
    }
    // A method that is not a string is never a provider method the service would start: refused, nothing written.
    for (const method of [7, ['PAYPAL'], { method: 'PAYPAL' }, true]) {
      const before = await written('usdAll');
      const error: any = await direct('usdAll', method).then(() => null, (e: unknown) => e);
      expect(error, JSON.stringify(method)).not.toBeNull();
      expect(error.getStatus?.()).toBe(400);
      expect(await written('usdAll')).toEqual(before);
    }
    const booked = await direct('usdAll', 'PAYPAL');
    expect(booked.bookingId).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
describe('V1-64 POST /bookings/businesses/:businessId/services — a body the catalog cannot store is a 400', () => {
  it('SV-01 RED-BEFORE: durationMins in place of duration is 400 (was 500) and writes no service', async () => {
    const before = await serviceCount('ttdBare');
    const res = await postService('ttdBare', { name: 'V64G Haircut', durationMins: 30, price: 50 });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(String(res.body.message)).toMatch(/duration/i);
    expect(await serviceCount('ttdBare')).toBe(before);
  });

  it('SV-02 RED-BEFORE: every body the service table cannot hold is 400 and writes no service', async () => {
    const before = await serviceCount('ttdBare');
    const ok = { name: 'V64G Haircut', duration: 30, price: 50 };
    const bad: Array<[string, unknown]> = [
      ['duration 0', { ...ok, duration: 0 }],
      ['duration -5', { ...ok, duration: -5 }],
      ['duration "30"', { ...ok, duration: '30' }],
      ['duration null', { ...ok, duration: null }],
      ['duration beyond int4', { ...ok, duration: 2147483648 }],
      ['price -1', { ...ok, price: -1 }],
      ['price "50"', { ...ok, price: '50' }],
      ['price missing', { name: ok.name, duration: 30 }],
      ['price null', { ...ok, price: null }],
      ['name missing', { duration: 30, price: 50 }],
      ['name blank', { ...ok, name: '   ' }],
      ['name a number', { ...ok, name: 7 }],
      ['description a number', { ...ok, description: 7 }],
      ['description an object', { ...ok, description: { text: 'x' } }],
      ['sourceProductId an object', { ...ok, sourceProductId: { id: 'x' } }],
      ['an empty body', {}],
      ['no body', undefined],
      ['an array body', [ok]],
    ];
    const wrong: string[] = [];
    for (const [label, body] of bad) {
      const res = await postService('ttdBare', body);
      if (res.status !== 400) wrong.push(`${label}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(await serviceCount('ttdBare')).toBe(before);
  });

  it('SV-04 RED-BEFORE (review SEC-BPG-2): a NUL character in a text field is 400 (was 500) and writes no service', async () => {
    const before = await serviceCount('ttdBare');
    const ok = { name: 'V64G Haircut', duration: 30, price: 50 };
    const wrong: string[] = [];
    for (const [label, body] of [
      ['name', { ...ok, name: 'V64G Hair\u0000cut' }],
      ['description', { ...ok, description: 'Wash\u0000 and cut' }],
      ['sourceProductId', { ...ok, sourceProductId: 'prod\u0000' }],
    ] as Array<[string, unknown]>) {
      const res = await postService('ttdBare', body);
      if (res.status !== 400) wrong.push(`${label}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(await serviceCount('ttdBare')).toBe(before);
  });

  it('SV-03 CONTROL: a valid body creates the service; another business\'s owner is 403 and an anonymous caller 401', async () => {
    const before = await serviceCount('ttdBare');
    const res = await postService('ttdBare', { name: 'V64G Haircut', duration: 30, price: 50, description: 'Wash and cut' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ name: 'V64G Haircut', duration: 30, price: 50, description: 'Wash and cut', businessId: bizId('ttdBare') });
    const free = await postService('ttdBare', { name: 'V64G Free consult', duration: 15, price: 0 });
    expect(free.status, JSON.stringify(free.body)).toBe(201);
    expect(await serviceCount('ttdBare')).toBe(before + 2);

    const cross = await postService('ttdBare', { name: 'V64G Intruder', duration: 30, price: 50 }, asOwner('usdBare'));
    expect(cross.status).toBe(403);
    const crossBad = await postService('ttdBare', { name: 'V64G Intruder', durationMins: 30, price: 50 }, asOwner('usdBare'));
    expect(crossBad.status).toBe(403);
    const anonymous = await postService('ttdBare', { name: 'V64G Intruder', duration: 30, price: 50 }, {});
    expect(anonymous.status).toBe(401);
    expect(await serviceCount('ttdBare')).toBe(before + 2);
  });
});
