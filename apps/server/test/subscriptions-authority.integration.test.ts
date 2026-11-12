/**
 * R0-08 / R0-08c-SUBSCRIPTION-AUTHORITY — plan changes are OWNER only and
 * audited. REAL database.
 *
 * RED-BEFORE (the R0 working branch at 8b8cf715, reproduced by the R0-08
 * security review, finding ST-R008-1): every mutating route of
 * SubscriptionsController had only AuthGuard and BusinessGuard, and
 * BusinessGuard admits any member. A STAFF member whose permissionScopes are
 * all 'none' POSTed /subscriptions/businesses/:id/record-payment
 * {plan:'KEYFLOW',currency:'USD',method:'manual'} and got 201: the tenant moved
 * to the top plan with a COMPLETED manual SubscriptionPayment and no money
 * moving; POST .../cancel as the same member got 201; neither wrote an audit
 * row. R0-08 made /app/settings/billing the one-click destination of every
 * plan-limit prompt any member sees, so the hole was one click away.
 *
 * THE RULE (consistent with owner ruling D-11, business profile edits are
 * OWNER only): /trial, /activate, /cancel, /checkout and /record-payment are
 * allowed for the business owner — an OWNER membership or the distinguished
 * owner (Business.ownerId), the rule IdentityService.assertBusinessOwner
 * applies — and for SUPER_ADMIN (the platform bypass BusinessGuard already
 * grants). Every other member gets 403 {code:'SUBSCRIPTION_OWNER_ONLY'} and
 * nothing is written. Each successful call writes exactly one
 * team_activity_logs row naming the acting user (the mechanism identity and
 * onboarding already use). Read routes keep today's membership rule.
 *
 * OPEN POLICY QUESTION, not decided here (D-33): an owner's self-declared
 * manual payment, and /activate with any gateway string, still activate a paid
 * plan with no money moving. Whether manual recording should instead create a
 * PENDING payment that platform staff confirm is a new owner decision. [O04]
 * pins today's answer so a change to it is deliberate.
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real SubscriptionsController, SubscriptionsService, PrismaService,
 * AuthGuard and BusinessGuard against the database at DATABASE_URL, and the
 * production GlobalHttpExceptionFilter, so a refusal has the body shape the web
 * client parses. The one stand-in is identity attachment: a test middleware
 * reads `x-test-user`, loads that seeded User row and attaches
 * `{ id, email, role }` as AuthMiddleware does after token verification.
 *
 * FIXTURES: every row has the `k08c_` prefix (registered in
 * test/helpers/fixture-prefixes.json) or belongs to a k08c_ business, and is
 * hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k08c_';
const ID = {
  owner: `${P}owner`,             // ownerId + OWNER membership of bizFree and bizPaid
  staffNone: `${P}staffNone`,     // STAFF of bizFree and bizPaid, every scope 'none' (the review's reproduction)
  staff: `${P}staff`,             // STAFF, role-default scopes
  admin: `${P}admin`,             // ADMIN, role-default scopes (settings: admin)
  adminAll: `${P}adminAll`,       // ADMIN, every scope 'admin'
  ownerB: `${P}ownerB`,           // OWNER of bizB only
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizC, no membership row
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership
  nonMember: `${P}nonMember`,     // no membership anywhere
  bizFree: `${P}bizFree`,         // no subscription: the trial target
  bizPaid: `${P}bizPaid`,         // an ACTIVE FLOW subscription: the cancel, activate, checkout, record-payment target
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
};
const USERS = [ID.owner, ID.staffNone, ID.staff, ID.admin, ID.adminAll, ID.ownerB, ID.legacyOwner, ID.superAdmin, ID.nonMember];
const emailOf = (id: string) => `${id}@k08c.test.local`;
const SEEDED_SUB = `${P}sub_paid_flow`;
const OWNER_ONLY = 'SUBSCRIPTION_OWNER_ONLY';

/** The five mutating routes, each aimed at a business state on which the owner's call succeeds. */
const MUTATIONS = [
  { route: 'trial', businessId: ID.bizFree, body: { plan: 'KEYFLOW', currency: 'USD' } },
  { route: 'activate', businessId: ID.bizPaid, body: { plan: 'KEYFLOW', currency: 'USD', gateway: 'manual' } },
  { route: 'cancel', businessId: ID.bizPaid, body: {} },
  { route: 'checkout', businessId: ID.bizPaid, body: { plan: 'KEYFLOW', currency: 'USD', gateway: 'wipay' } },
  { route: 'record-payment', businessId: ID.bizPaid, body: { plan: 'KEYFLOW', currency: 'USD', method: 'manual' } },
] as const;

/** The members of the owner's businesses who are not the owner. */
const NON_OWNER_MEMBERS = [
  { id: ID.staffNone, label: 'STAFF (every scope none)' },
  { id: ID.staff, label: 'STAFF (role defaults)' },
  { id: ID.admin, label: 'ADMIN (role defaults)' },
  { id: ID.adminAll, label: 'ADMIN (every scope admin)' },
];

let db: any;
let app: any;
let prismaService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscription_payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/**
 * Everything a plan change can write for one business, exactly as Postgres
 * stores it: its subscriptions, its subscription payments and its audit rows.
 * "Nothing written" means this text is byte-identical.
 */
async function billingStateText(businessId: string): Promise<string> {
  const subs = await db.$queryRawUnsafe(
    'SELECT row_to_json(s)::text AS j FROM subscriptions s WHERE s.business_id = $1 ORDER BY s.id', businessId);
  const payments = await db.$queryRawUnsafe(
    'SELECT row_to_json(p)::text AS j FROM subscription_payments p WHERE p.business_id = $1 ORDER BY p.id', businessId);
  const audit = await db.$queryRawUnsafe(
    'SELECT row_to_json(a)::text AS j FROM team_activity_logs a WHERE a.business_id = $1 ORDER BY a.id', businessId);
  return JSON.stringify({
    subscriptions: subs.map((r: { j: string }) => r.j),
    payments: payments.map((r: { j: string }) => r.j),
    audit: audit.map((r: { j: string }) => r.j),
  });
}

function post(actor: string | null, businessId: string, route: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).post(`/subscriptions/businesses/${businessId}/${route}`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

function get(actor: string, businessId: string, route: string) {
  return request(app.getHttpServer()).get(`/subscriptions/businesses/${businessId}/${route}`).set('x-test-user', actor);
}

/** A refused plan change: the status, the code when given, and the business's billing state byte-identical. */
async function expectRefused(
  actor: string | null,
  m: { route: string; businessId: string; body: Record<string, unknown> },
  status: number,
  label: string,
  code?: string,
) {
  const before = await billingStateText(m.businessId);
  const res = await post(actor, m.businessId, m.route, m.body);
  expect(res.status, `${label} POST /${m.route}: ${res.status} ${JSON.stringify(res.body)}`).toBe(status);
  if (code) {
    expect(res.body.code, `${label} POST /${m.route}`).toBe(code);
    expect(res.body.message, `${label} POST /${m.route}`).toBe('Only the business owner can change the plan.');
  }
  for (const key of ['id', 'plan', 'status', 'checkoutReady', 'amount']) expect(res.body).not.toHaveProperty(key);
  expect(await billingStateText(m.businessId), `${label} POST /${m.route}: nothing written`).toBe(before);
}

async function auditRows(businessId: string) {
  return db.teamActivityLog.findMany({ where: { businessId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Runs `act` and returns the audit rows it added for `businessId`. */
async function newAuditRows(businessId: string, act: () => Promise<void>) {
  const before = new Set((await auditRows(businessId)).map((r: { id: string }) => r.id));
  await act();
  return (await auditRows(businessId)).filter((r: { id: string }) => !before.has(r.id));
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { SubscriptionsController } = await import('../src/modules/subscriptions/subscriptions.controller');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CANONICAL_MODULES } = await import('../src/core/authority/module-vocabulary');

  const moduleRef = await Test.createTestingModule({
    controllers: [SubscriptionsController],
    providers: [PrismaService, AuthGuard, BusinessGuard, SubscriptionsService],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();
  prismaService = moduleRef.get(PrismaService);

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizFree, name: `${P}bizFree-name`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizPaid, name: `${P}bizPaid-name`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}bizB-name`, ownerId: ID.ownerB } });
  await db.business.create({ data: { id: ID.bizC, name: `${P}bizC-name`, ownerId: ID.legacyOwner } });

  const allNone = Object.fromEntries(CANONICAL_MODULES.map((m: string) => [m, 'none']));
  const allAdmin = Object.fromEntries(CANONICAL_MODULES.map((m: string) => [m, 'admin']));
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [];
  for (const businessId of [ID.bizFree, ID.bizPaid]) {
    memberships.push(
      { userId: ID.owner, businessId, role: 'OWNER' },
      { userId: ID.staffNone, businessId, role: 'STAFF', permissionScopes: allNone },
      { userId: ID.staff, businessId, role: 'STAFF' },
      { userId: ID.admin, businessId, role: 'ADMIN' },
      { userId: ID.adminAll, businessId, role: 'ADMIN', permissionScopes: allAdmin },
    );
  }
  memberships.push({ userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' });
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  await db.subscription.create({
    data: {
      id: SEEDED_SUB, businessId: ID.bizPaid, plan: 'FLOW', status: 'ACTIVE', currency: 'TTD', priceMonthly: 99,
      gateway: 'wipay', currentPeriodStart: new Date(), currentPeriodEnd: periodEnd,
    },
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-08c fixture sanity (real rows)', () => {
  it('[R0-08c-X01] seeded four tenants, nine users and eleven memberships; bizPaid has one ACTIVE FLOW subscription and nothing else is billed or audited', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(11);
    expect(await db.membership.count({ where: { businessId: ID.bizC } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    const subs = await db.subscription.findMany({ where: { businessId: { startsWith: P } } });
    expect(subs.map((s: { id: string; plan: string; status: string }) => [s.id, s.plan, s.status])).toEqual([[SEEDED_SUB, 'FLOW', 'ACTIVE']]);
    expect(await db.subscriptionPayment.count({ where: { businessId: { startsWith: P } } })).toBe(0);
    expect(await db.teamActivityLog.count({ where: { businessId: { startsWith: P } } })).toBe(0);
    const staffNone = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.staffNone, businessId: ID.bizPaid } } });
    expect(Object.values(staffNone.permissionScopes as Record<string, string>).every((v) => v === 'none')).toBe(true);
    expect(prismaService.client).toBe(db);
  });
});

describe('R0-08c a member who is not the owner cannot change the plan (ST-R008-1)', () => {
  it("[R0-08c-R01] RED-BEFORE: the review's reproduction — a STAFF member with every scope 'none' POSTs record-payment {plan:'KEYFLOW',currency:'USD',method:'manual'}: 403 SUBSCRIPTION_OWNER_ONLY, no Subscription change, no SubscriptionPayment row, no audit row", async () => {
    await expectRefused(ID.staffNone, MUTATIONS[4], 403, 'STAFF (every scope none)', OWNER_ONLY);
    expect(await db.subscriptionPayment.count({ where: { businessId: ID.bizPaid } })).toBe(0);
    const sub = await db.subscription.findUnique({ where: { id: SEEDED_SUB } });
    expect([sub.plan, sub.status, sub.cancelledAt]).toEqual(['FLOW', 'ACTIVE', null]);
  });

  it("[R0-08c-R02] RED-BEFORE: the same member POSTs cancel: 403 SUBSCRIPTION_OWNER_ONLY and the ACTIVE FLOW subscription stays active", async () => {
    await expectRefused(ID.staffNone, MUTATIONS[2], 403, 'STAFF (every scope none)', OWNER_ONLY);
    const sub = await db.subscription.findUnique({ where: { id: SEEDED_SUB } });
    expect([sub.plan, sub.status, sub.cancelledAt]).toEqual(['FLOW', 'ACTIVE', null]);
  });

  MUTATIONS.forEach((m, i) => {
    it(`[R0-08c-M0${i + 1}] RED-BEFORE: POST /${m.route} is refused for STAFF (every scope none), STAFF (role defaults), ADMIN (role defaults) and ADMIN (every scope admin): 403 SUBSCRIPTION_OWNER_ONLY, nothing written`, async () => {
      for (const member of NON_OWNER_MEMBERS) {
        await expectRefused(member.id, m, 403, member.label, OWNER_ONLY);
      }
    });
  });

  it("[R0-08c-C01] the OWNER of B on A's path is refused on every mutating route (403, BusinessGuard) and nothing is written", async () => {
    for (const m of MUTATIONS) await expectRefused(ID.ownerB, m, 403, "owner of B on A's path");
  });

  it('[R0-08c-C02] an unauthenticated request is refused on every mutating route (401) and nothing is written', async () => {
    for (const m of MUTATIONS) await expectRefused(null, m, 401, 'no identity');
  });
});

describe('R0-08c read routes keep the membership rule', () => {
  it("[R0-08c-G01] pinned: a STAFF member with every scope 'none' still reads current, billing-dashboard, history, check-limit and payments (200)", async () => {
    for (const route of ['current', 'billing-dashboard', 'history', 'check-limit/contacts', 'payments']) {
      const res = await get(ID.staffNone, ID.bizPaid, route);
      expect(res.status, `GET /${route}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const current = await get(ID.staffNone, ID.bizPaid, 'current');
    expect(current.body).toMatchObject({ plan: 'FLOW', status: 'ACTIVE' });
  });

  it('[R0-08c-G02] pinned: a non-member is refused the read routes (403, BusinessGuard)', async () => {
    for (const route of ['current', 'billing-dashboard', 'history', 'check-limit/contacts', 'payments']) {
      const res = await get(ID.nonMember, ID.bizPaid, route);
      expect(res.status, `GET /${route}: ${JSON.stringify(res.body)}`).toBe(403);
    }
  });
});

describe('R0-08c the owner changes the plan, and every change is audited against the acting user', () => {
  it('[R0-08c-O01] positive control: the OWNER starts a trial (201 TRIALING) and exactly one audit row names the owner', async () => {
    let body: any;
    const rows = await newAuditRows(ID.bizFree, async () => {
      const res = await post(ID.owner, ID.bizFree, 'trial', { plan: 'FLOW', currency: 'TTD' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      body = res.body;
    });
    expect(body).toMatchObject({ businessId: ID.bizFree, plan: 'FLOW', status: 'TRIALING' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: ID.bizFree, userId: ID.owner, module: 'billing', action: 'subscription_trial_started',
      entityType: 'subscription', entityId: body.id,
    });
  });

  it('[R0-08c-O02] positive control: the OWNER opens a checkout (201 checkoutReady); no Subscription row changes and exactly one audit row names the owner', async () => {
    const subsBefore = JSON.stringify(await db.subscription.findMany({ where: { businessId: ID.bizPaid }, orderBy: { id: 'asc' } }));
    let body: any;
    const rows = await newAuditRows(ID.bizPaid, async () => {
      const res = await post(ID.owner, ID.bizPaid, 'checkout', { plan: 'KEYFLOW', currency: 'USD', gateway: 'wipay' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      body = res.body;
    });
    expect(body).toMatchObject({ plan: 'KEYFLOW', currency: 'USD', gateway: 'wipay', checkoutReady: true });
    expect(JSON.stringify(await db.subscription.findMany({ where: { businessId: ID.bizPaid }, orderBy: { id: 'asc' } }))).toBe(subsBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.bizPaid, userId: ID.owner, module: 'billing', action: 'subscription_checkout_started' });
  });

  it('[R0-08c-O03] positive control: the OWNER activates KEYFLOW (201 ACTIVE), the FLOW subscription is cancelled, and exactly one audit row names the owner', async () => {
    let body: any;
    const rows = await newAuditRows(ID.bizPaid, async () => {
      const res = await post(ID.owner, ID.bizPaid, 'activate', { plan: 'KEYFLOW', currency: 'USD', gateway: 'manual' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      body = res.body;
    });
    expect(body).toMatchObject({ businessId: ID.bizPaid, plan: 'KEYFLOW', status: 'ACTIVE' });
    const seeded = await db.subscription.findUnique({ where: { id: SEEDED_SUB } });
    expect(seeded.status).toBe('CANCELLED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: ID.bizPaid, userId: ID.owner, module: 'billing', action: 'subscription_activated',
      entityType: 'subscription', entityId: body.id,
    });
  });

  it('[R0-08c-O04] positive control, pinned for open question D-33: the OWNER records a manual payment (201 ACTIVE FLOW) with one COMPLETED manual SubscriptionPayment, and exactly one audit row names the owner', async () => {
    const paymentsBefore = await db.subscriptionPayment.count({ where: { businessId: ID.bizPaid } });
    let body: any;
    const rows = await newAuditRows(ID.bizPaid, async () => {
      const res = await post(ID.owner, ID.bizPaid, 'record-payment', { plan: 'FLOW', currency: 'USD', method: 'manual', reference: `${P}ref-1` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      body = res.body;
    });
    expect(body).toMatchObject({ businessId: ID.bizPaid, plan: 'FLOW', status: 'ACTIVE', currency: 'USD' });
    const payments = await db.subscriptionPayment.findMany({ where: { businessId: ID.bizPaid } });
    expect(payments).toHaveLength(paymentsBefore + 1);
    expect(payments[payments.length - 1]).toMatchObject({
      subscriptionId: body.id, method: 'manual', status: 'COMPLETED', currency: 'USD', amount: 15, reference: `${P}ref-1`,
    });
    expect(await db.subscription.count({ where: { businessId: ID.bizPaid, status: { in: ['ACTIVE', 'TRIALING'] } } })).toBe(1);
    expect(rows, 'one row for the whole payment-and-activation, not one per step').toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: ID.bizPaid, userId: ID.owner, module: 'billing', action: 'subscription_payment_recorded',
      entityType: 'subscription', entityId: body.id,
    });
  });

  it('[R0-08c-O05] positive control: the OWNER cancels (201), no subscription stays active, and exactly one audit row names the owner', async () => {
    const active = await db.subscription.findFirst({ where: { businessId: ID.bizPaid, status: 'ACTIVE' } });
    const rows = await newAuditRows(ID.bizPaid, async () => {
      const res = await post(ID.owner, ID.bizPaid, 'cancel', {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
    expect(await db.subscription.count({ where: { businessId: ID.bizPaid, status: { in: ['ACTIVE', 'TRIALING'] } } })).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: ID.bizPaid, userId: ID.owner, module: 'billing', action: 'subscription_cancelled',
      entityType: 'subscription', entityId: active.id,
    });
  });

  it("[R0-08c-O06] owner ruling D-104 (W10-OWNER-MEMBERSHIP; was pinned: records a payment): the distinguished owner (Business.ownerId) with no membership row is refused (403 'No access to this business'): no subscription written and no audit row", async () => {
    const subscriptionsBefore = await db.subscription.findMany({ where: { businessId: ID.bizC }, orderBy: { id: 'asc' } });
    const rows = await newAuditRows(ID.bizC, async () => {
      const res = await post(ID.legacyOwner, ID.bizC, 'record-payment', { plan: 'KEYFLOW', currency: 'TTD', method: 'bank_transfer' });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    });
    expect(rows).toEqual([]);
    expect(await db.subscription.findMany({ where: { businessId: ID.bizC }, orderBy: { id: 'asc' } })).toEqual(subscriptionsBefore);
  });

  it("[R0-08c-O07] pinned: a SUPER_ADMIN with no membership keeps the platform bypass and cancels the owner's trial (201), audited against the super admin", async () => {
    const rows = await newAuditRows(ID.bizFree, async () => {
      const res = await post(ID.superAdmin, ID.bizFree, 'cancel', {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
    expect(await db.subscription.count({ where: { businessId: ID.bizFree, status: { in: ['ACTIVE', 'TRIALING'] } } })).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.bizFree, userId: ID.superAdmin, module: 'billing', action: 'subscription_cancelled' });
  });

  it('[R0-08c-O08] after the owner changed the plan, a STAFF member is still refused (403 SUBSCRIPTION_OWNER_ONLY, nothing written)', async () => {
    await expectRefused(ID.staffNone, { route: 'trial', businessId: ID.bizPaid, body: { plan: 'FLOW' } }, 403, 'STAFF (every scope none)', OWNER_ONLY);
  });
});

/**
 * Review finding ST-R008c-1: plan changes were atomic but not serialized.
 * Under READ COMMITTED each concurrent record-payment or activate cancelled
 * only the rows its own snapshot saw and added an ACTIVE row, startTrial's
 * existing-subscription check ran outside any transaction, and cancel cancelled
 * one findFirst row. The review's probe (4 parallel owner record-payments)
 * left 4 ACTIVE subscriptions with every audit row saying
 * replacedSubscriptions:1, and after a 201 cancel GET /current still reported
 * KEYFLOW ACTIVE. Each plan change now takes pg_advisory_xact_lock keyed on the
 * business first. These cases run on their own k08c_ businesses, seeded here.
 */
describe('R0-08c concurrent plan changes for one business are serialized (ST-R008c-1)', () => {
  const RACE = {
    bizPay: `${P}bizRacePay`,     // ACTIVE FLOW: parallel record-payments
    bizTrial: `${P}bizRaceTrial`, // no subscription: parallel trial starts
    bizMix: `${P}bizRaceMix`,     // ACTIVE FLOW: parallel activate and record-payment
    bizDup: `${P}bizRaceDup`,     // three live rows, the state the pre-lock race left behind
  };
  const SEED = {
    pay: `${P}sub_race_pay_flow`,
    mix: `${P}sub_race_mix_flow`,
    dupA: `${P}sub_dup_a_keyflow`,
    dupB: `${P}sub_dup_b_keyflow`,
    dupC: `${P}sub_dup_c_trial`,
  };
  const N = 5;
  // The races run in well under a second; the budget covers a loaded shared machine.
  const RACE_TIMEOUT_MS = 30_000;
  const live = (businessId: string) =>
    db.subscription.findMany({
      where: { businessId, status: { in: ['ACTIVE', 'TRIALING'] } },
      select: { id: true, plan: true, status: true },
    });

  beforeAll(async () => {
    for (const id of Object.values(RACE)) {
      await db.business.create({ data: { id, name: `${id}-name`, ownerId: ID.owner } });
      await db.membership.create({ data: { id: `${P}m_owner_${id.slice(P.length)}`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    }
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const base = { status: 'ACTIVE', currency: 'TTD', gateway: 'wipay', currentPeriodStart: new Date(), currentPeriodEnd: periodEnd };
    await db.subscription.create({ data: { ...base, id: SEED.pay, businessId: RACE.bizPay, plan: 'FLOW', priceMonthly: 99 } });
    await db.subscription.create({ data: { ...base, id: SEED.mix, businessId: RACE.bizMix, plan: 'FLOW', priceMonthly: 99 } });
    const t = Date.now();
    await db.subscription.create({ data: { ...base, id: SEED.dupA, businessId: RACE.bizDup, plan: 'KEYFLOW', priceMonthly: 299, createdAt: new Date(t - 3000) } });
    await db.subscription.create({ data: { ...base, id: SEED.dupB, businessId: RACE.bizDup, plan: 'KEYFLOW', priceMonthly: 299, createdAt: new Date(t - 2000) } });
    await db.subscription.create({
      data: {
        ...base, id: SEED.dupC, businessId: RACE.bizDup, plan: 'FLOW', priceMonthly: 99, status: 'TRIALING',
        trialEndsAt: periodEnd, createdAt: new Date(t - 1000),
      },
    });
  }, 60_000);

  /**
   * The audit chain of serialized activations: over all the rows, the replaced
   * ids are the starting live rows plus every created subscription except the
   * one left live, each exactly once.
   */
  function expectReplacementChain(rows: any[], startIds: string[], createdIds: string[], liveId: string) {
    const replaced = rows.flatMap((r) => r.meta.replacedSubscriptionIds as string[]);
    expect([...replaced].sort()).toEqual([...startIds, ...createdIds.filter((id) => id !== liveId)].sort());
    for (const r of rows) expect(r.meta.replacedSubscriptions, r.id).toBe((r.meta.replacedSubscriptionIds as string[]).length);
  }

  it(`[R0-08c-K01] RED-BEFORE: the review's probe — ${N} parallel OWNER record-payments {plan:'KEYFLOW',currency:'USD',method:'manual'} all answer 201 and leave exactly one live subscription; each audit row lists the one subscription it replaced; one cancel then leaves the business on Free`, async () => {
    const results = await Promise.all(Array.from({ length: N }, () =>
      post(ID.owner, RACE.bizPay, 'record-payment', { plan: 'KEYFLOW', currency: 'USD', method: 'manual' })));
    expect(results.map((r) => r.status), JSON.stringify(results.map((r) => r.body))).toEqual(Array(N).fill(201));
    const createdIds = results.map((r) => r.body.id as string);

    const after = await live(RACE.bizPay);
    expect(after, 'one live subscription').toHaveLength(1);
    expect(after[0]).toMatchObject({ plan: 'KEYFLOW', status: 'ACTIVE' });
    expect(createdIds).toContain(after[0].id);
    const payments = await db.subscriptionPayment.findMany({ where: { businessId: RACE.bizPay } });
    expect(payments.map((p: { status: string }) => p.status)).toEqual(Array(N).fill('COMPLETED'));

    const rows = (await auditRows(RACE.bizPay)).filter((r: { action: string }) => r.action === 'subscription_payment_recorded');
    expect(rows).toHaveLength(N);
    for (const r of rows) expect(r.meta.replacedSubscriptionIds, r.id).toHaveLength(1);
    expectReplacementChain(rows, [SEED.pay], createdIds, after[0].id);

    const cancel = await post(ID.owner, RACE.bizPay, 'cancel', {});
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(await live(RACE.bizPay)).toEqual([]);
    const current = await get(ID.owner, RACE.bizPay, 'current');
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ plan: 'FREE', status: 'ACTIVE', subscription: null });
  }, RACE_TIMEOUT_MS);

  it(`[R0-08c-K02] RED-BEFORE: ${N} parallel OWNER trial starts on a business with no subscription: exactly one 201 TRIALING, the rest 400 'Business already has an active subscription', one TRIALING row and one audit row`, async () => {
    const results = await Promise.all(Array.from({ length: N }, () =>
      post(ID.owner, RACE.bizTrial, 'trial', { plan: 'KEYFLOW', currency: 'USD' })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([201, ...Array(N - 1).fill(400)]);
    for (const r of results.filter((x) => x.status === 400)) {
      expect(r.body.message).toBe('Business already has an active subscription');
    }
    const winner = results.find((r) => r.status === 201)!;
    expect(await live(RACE.bizTrial)).toEqual([{ id: winner.body.id, plan: 'KEYFLOW', status: 'TRIALING' }]);
    const rows = await auditRows(RACE.bizTrial);
    expect(rows.map((r: { action: string; entityId: string }) => [r.action, r.entityId])).toEqual([['subscription_trial_started', winner.body.id]]);
  }, RACE_TIMEOUT_MS);

  it(`[R0-08c-K03] RED-BEFORE: ${N} parallel OWNER activates interleaved with ${N} parallel OWNER record-payments leave exactly one live subscription, and the audit rows form one replacement chain`, async () => {
    const calls = Array.from({ length: N }, () => [
      post(ID.owner, RACE.bizMix, 'activate', { plan: 'KEYFLOW', currency: 'USD', gateway: 'manual' }),
      post(ID.owner, RACE.bizMix, 'record-payment', { plan: 'FLOW', currency: 'TTD', method: 'bank_transfer' }),
    ]).flat();
    const results = await Promise.all(calls);
    expect(results.map((r) => r.status), JSON.stringify(results.map((r) => r.body))).toEqual(Array(2 * N).fill(201));
    const createdIds = results.map((r) => r.body.id as string);

    const after = await live(RACE.bizMix);
    expect(after, 'one live subscription').toHaveLength(1);
    expect(createdIds).toContain(after[0].id);
    const rows = (await auditRows(RACE.bizMix)).filter((r: { action: string }) =>
      ['subscription_activated', 'subscription_payment_recorded'].includes(r.action));
    expect(rows).toHaveLength(2 * N);
    for (const r of rows) expect(r.meta.replacedSubscriptionIds, r.id).toHaveLength(1);
    expectReplacementChain(rows, [SEED.mix], createdIds, after[0].id);
  }, RACE_TIMEOUT_MS);

  it('[R0-08c-K04] RED-BEFORE: on a business left with two ACTIVE KEYFLOW rows and a TRIALING FLOW row, one OWNER cancel cancels all three, its audit row names the newest paid row and lists every cancelled id, and GET /current reports Free', async () => {
    const before = await get(ID.owner, RACE.bizDup, 'current');
    expect(before.body).toMatchObject({ plan: 'FLOW', status: 'TRIALING' });
    const rows = await newAuditRows(RACE.bizDup, async () => {
      const res = await post(ID.owner, RACE.bizDup, 'cancel', {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
    expect(await live(RACE.bizDup)).toEqual([]);
    const subs = await db.subscription.findMany({ where: { businessId: RACE.bizDup }, orderBy: { id: 'asc' } });
    expect(subs).toHaveLength(3);
    for (const s of subs) {
      expect(s.status, s.id).toBe('CANCELLED');
      expect(s.cancelledAt, s.id).not.toBeNull();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ID.owner, action: 'subscription_cancelled', entityId: SEED.dupC, title: 'Cancelled the FLOW plan' });
    expect(rows[0].meta).toMatchObject({ plan: 'FLOW', previousStatus: 'TRIALING', cancelledSubscriptionIds: [SEED.dupA, SEED.dupB, SEED.dupC] });
    const current = await get(ID.owner, RACE.bizDup, 'current');
    expect(current.body).toMatchObject({ plan: 'FREE', status: 'ACTIVE', subscription: null });

    const again = await post(ID.owner, RACE.bizDup, 'cancel', {});
    expect(again.status, 'nothing left to cancel').toBe(404);
  }, RACE_TIMEOUT_MS);
});
