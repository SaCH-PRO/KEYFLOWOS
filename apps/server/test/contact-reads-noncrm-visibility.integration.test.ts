/**
 * V1-84 (FOLLOW3-D5-CONTACT-READS-NONCRM): contact-keyed routes outside the CRM
 * controllers apply the caller's CRM record visibility (REAL database).
 *
 * The V1-08 rule (crm-permissions.helper.ts assertContactVisible) gates GET
 * crm/businesses/:b/contacts/:c and its 14 sibling reads: a member who may not
 * open a contact gets the 404 'Contact not found' an unknown id gets, before
 * any collaborator runs. Six contact-keyed routes in other modules took no
 * caller and checked the tenant only, so a STAFF member with crm_view 'owned'
 * read (or, for sales-rep, wrote) the owner's PRIVATE contact through them:
 *
 *   NC-01 GET   marketplace/businesses/:b/contacts/:c/order-history
 *   NC-02 GET   conversion/businesses/:b/contacts/:c/referral-stats
 *   NC-03 GET   people-flow/businesses/:b/contacts/:c/health
 *   NC-04 GET   momentum/businesses/:b/contacts/:c
 *   NC-05 GET   momentum/businesses/:b/contacts/:c/history
 *   NC-06 PATCH conversion/businesses/:b/contacts/:c/sales-rep
 *
 * Module scope is not added (these modules have no canonical scope yet); only
 * record visibility is.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, the user,
 * business, membership and contact rows, AuthGuard, BusinessGuard,
 * CrmRateLimitGuard, the four controllers and the services each route calls
 * (CommerceIntegrationService, ReferralRewardService, SalesTeamService,
 * RelationshipHealthService, ClientMomentumService) are real against
 * DATABASE_URL. Those services are wrapped in call-through spies only, so
 * "no service call before the visibility check" is observed. Collaborators the
 * six routes never reach are empty stubs. Identity is attached from an
 * `x-test-user` header for seeded v84e_ users, as the Supabase-verifying
 * AuthMiddleware would after token verification.
 *
 * Every seeded row carries the `v84e_` prefix (or lives under a v84e_ tenant)
 * and is hard-deleted with sqlLikePrefix() in beforeAll and afterAll. No
 * $transaction wrapping.
 *
 * RED-BEFORE (bb6b86d4): NC-01..NC-06 answer 200 for STAFF_OWNED on the
 * PRIVATE contact and the service is called with its id: order-history returns
 * its order, referral-stats its referral code and referred count, momentum its
 * score row, history its snapshot; PATCH sales-rep rewrites its sales rep.
 * people-flow health answers an empty 200 (computeHealth returns null for every
 * contact, see the characterization case). Unknown ids answered 500
 * (order-history, PATCH sales-rep) or an empty 200. The controls pass before
 * and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84e_';
const ID = {
  owner: `${P}owner`,           // OWNER of bizA
  staffOwned: `${P}staffOwned`, // STAFF of bizA, crm: read + crm_view: owned
  other: `${P}other`,           // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`,           // PRIVATE, owned by owner
  cTeam: `${P}cTeam`,           // TEAM, owned by staffOwned
  cReferredByPriv: `${P}cRefPriv`, // referred by cPriv
  cReferredByTeam: `${P}cRefTeam`, // referred by cTeam
  orderPriv: `${P}ordPriv`,
  orderTeam: `${P}ordTeam`,
};

// Markers that must never reach a refused caller.
const PRIV_REF_CODE = 'V84E-PRIV-REF-9c1d';
const PRIV_ORDER_NUMBER = `${P}ORD-PRIV-4471`;
const PRIV_NAME = 'V84ePrivateCustomer';
const PRIV_REP = `${P}rep_original`;
const TEAM_REF_CODE = 'V84E-TEAM-REF-2b7e';
const TEAM_ORDER_NUMBER = `${P}ORD-TEAM-5512`;
const TEAM_REP = `${P}rep_team_original`;

let db: any;
let app: any;
const svc: Record<string, any> = {};
const spies: Record<string, any> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_momentum_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_momentum WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Route = { id: string; label: string; method: 'get' | 'patch'; url: (b: string, c: string) => string; spy: string; body?: unknown };

const ROUTES: Route[] = [
  { id: 'NC-01', label: 'order-history', method: 'get', url: (b, c) => `/marketplace/businesses/${b}/contacts/${c}/order-history`, spy: 'orderHistory' },
  { id: 'NC-02', label: 'referral-stats', method: 'get', url: (b, c) => `/conversion/businesses/${b}/contacts/${c}/referral-stats`, spy: 'referralStats' },
  { id: 'NC-03', label: 'people-flow health', method: 'get', url: (b, c) => `/people-flow/businesses/${b}/contacts/${c}/health`, spy: 'health' },
  { id: 'NC-04', label: 'momentum', method: 'get', url: (b, c) => `/momentum/businesses/${b}/contacts/${c}`, spy: 'momentum' },
  { id: 'NC-05', label: 'momentum history', method: 'get', url: (b, c) => `/momentum/businesses/${b}/contacts/${c}/history`, spy: 'momentumHistory' },
  { id: 'NC-06', label: 'PATCH sales-rep', method: 'patch', url: (b, c) => `/conversion/businesses/${b}/contacts/${c}/sales-rep`, spy: 'setSalesRep', body: { salesRepId: `${P}rep_by_staff` } },
];
const route = (id: string) => ROUTES.find((r) => r.id === id)!;

function send(r: Route, actor: string, contactId: string, businessId = ID.bizA, body?: unknown) {
  const req = r.method === 'get'
    ? request(app.getHttpServer()).get(r.url(businessId, contactId))
    : request(app.getHttpServer()).patch(r.url(businessId, contactId)).send((body ?? r.body) as object);
  return req.set('x-test-user', actor);
}

function json(v: unknown): unknown {
  return v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/** A response body as JSON; Nest answers a null handler result with an empty 200 body. */
function bodyOf(res: { text?: string; body: unknown }): unknown {
  return res.text === '' || res.text === undefined ? null : json(res.body);
}

/** The answer a GET route gives today, from its real service called without HTTP. */
async function serviceAnswer(r: Route, contactId: string): Promise<unknown> {
  const call = async () => {
    switch (r.spy) {
      case 'orderHistory': return svc.commerce.getContactOrderHistory(ID.bizA, contactId);
      case 'referralStats': return svc.referral.getReferralStats(ID.bizA, contactId);
      case 'health': return svc.health.computeHealth(ID.bizA, contactId);
      case 'momentum': return svc.momentum.getContactMomentum(ID.bizA, contactId);
      case 'momentumHistory': return svc.momentum.getContactMomentumHistory(ID.bizA, contactId, 30);
      default: throw new Error(`no direct read for ${r.spy}`);
    }
  };
  const out = json(await call());
  for (const s of Object.values(spies)) s.mockClear();
  return out;
}

/** A refused response carries no record and none of the PRIVATE contact's data. */
function expectNoDisclosure(body: unknown) {
  const text = JSON.stringify(body ?? {});
  for (const marker of [PRIV_REF_CODE, PRIV_ORDER_NUMBER, PRIV_NAME, PRIV_REP, ID.orderPriv]) {
    expect(text).not.toContain(marker);
  }
  for (const key of ['contact', 'orders', 'referralCode', 'score', 'overallScore', 'contactName']) {
    expect(body).not.toHaveProperty(key);
  }
}

function expectNoServiceCall() {
  for (const [name, s] of Object.entries(spies)) {
    expect(s.mock.calls, `${name} was called`).toEqual([]);
  }
}

async function salesRepOf(contactId: string): Promise<unknown> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT custom FROM contacts WHERE id = $1`, contactId);
  return (rows[0]?.custom ?? {}).salesRepId;
}

async function setSalesRepRaw(contactId: string, rep: string) {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT custom FROM contacts WHERE id = $1`, contactId);
  const custom = { ...(rows[0]?.custom ?? {}), salesRepId: rep };
  await db.$executeRawUnsafe(`UPDATE contacts SET custom = $1::jsonb WHERE id = $2`, JSON.stringify(custom), contactId);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { ConversionController } = await import('../src/modules/conversion/conversion.controller');
  const { UpsellService } = await import('../src/modules/conversion/upsell.service');
  const { ReferralRewardService } = await import('../src/modules/conversion/referral-reward.service');
  const { SalesTeamService } = await import('../src/modules/conversion/sales-team.service');
  const { LeadMagnetService } = await import('../src/modules/conversion/lead-magnet.service');
  const { MerchantSubscriptionService } = await import('../src/modules/conversion/merchant-subscription.service');
  const { PeopleFlowController } = await import('../src/modules/people-flow/people-flow.controller');
  const { PeopleOverviewService } = await import('../src/modules/people-flow/people-overview.service');
  const { RelationshipHealthService } = await import('../src/modules/people-flow/relationship-health.service');
  const { MomentumController } = await import('../src/modules/momentum/momentum.controller');
  const { ClientMomentumService } = await import('../src/modules/momentum/client-momentum.service');
  const { MomentumAiService } = await import('../src/modules/momentum/momentum-ai.service');
  const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController, ConversionController, PeopleFlowController, MomentumController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      // The services the six routes call: real, over the real database.
      CommerceIntegrationService,
      ReferralRewardService,
      SalesTeamService,
      RelationshipHealthService,
      ClientMomentumService,
      // Collaborators the six routes never reach.
      { provide: MarketplaceService, useValue: {} },
      { provide: CrmService, useValue: {} },
      { provide: ExpensesService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: UpsellService, useValue: {} },
      { provide: LeadMagnetService, useValue: {} },
      { provide: MerchantSubscriptionService, useValue: {} },
      { provide: PeopleOverviewService, useValue: {} },
      { provide: MomentumAiService, useValue: {} },
      { provide: AutopilotService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      // PublicRateLimitGuard (conversion's public lead-magnet route) is built
      // with the controller; no route this suite sends reaches it.
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  svc.commerce = moduleRef.get(CommerceIntegrationService);
  svc.referral = moduleRef.get(ReferralRewardService);
  svc.salesTeam = moduleRef.get(SalesTeamService);
  svc.health = moduleRef.get(RelationshipHealthService);
  svc.momentum = moduleRef.get(ClientMomentumService);
  spies.orderHistory = vi.spyOn(svc.commerce, 'getContactOrderHistory');
  spies.referralStats = vi.spyOn(svc.referral, 'getReferralStats');
  spies.setSalesRep = vi.spyOn(svc.salesTeam, 'setSalesRep');
  spies.health = vi.spyOn(svc.health, 'computeHealth');
  spies.momentum = vi.spyOn(svc.momentum, 'getContactMomentum');
  spies.momentumHistory = vi.spyOn(svc.momentum, 'getContactMomentumHistory');

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const id of [ID.owner, ID.staffOwned, ID.other]) {
    await db.user.create({ data: { id, email: `${P}u_${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84E Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84E Biz B', ownerId: ID.other } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned' });
  await m(ID.other, ID.bizB, 'OWNER');

  // ---- contacts ----------------------------------------------------------
  const recent = new Date(Date.now() - 3 * 86_400_000);
  await db.contact.create({ data: {
    id: ID.cPriv, businessId: ID.bizA, firstName: PRIV_NAME, email: `${P}priv@test.local`, status: 'CUSTOMER',
    visibility: 'PRIVATE', ownerId: ID.owner, lastInteractionAt: recent,
    custom: { referralCode: PRIV_REF_CODE, referralRewardsEarned: 3, referralRewardBalance: 30, salesRepId: PRIV_REP },
  } });
  await db.contact.create({ data: {
    id: ID.cTeam, businessId: ID.bizA, firstName: 'V84eTeamCustomer', email: `${P}team@test.local`, status: 'CUSTOMER',
    visibility: 'TEAM', ownerId: ID.staffOwned, lastInteractionAt: recent,
    custom: { referralCode: TEAM_REF_CODE, referralRewardsEarned: 1, referralRewardBalance: 10, salesRepId: TEAM_REP },
  } });
  await db.contact.create({ data: { id: ID.cReferredByPriv, businessId: ID.bizA, firstName: 'V84eRefPriv', visibility: 'TEAM', ownerId: ID.owner, custom: { referralSourceId: ID.cPriv } } });
  await db.contact.create({ data: { id: ID.cReferredByTeam, businessId: ID.bizA, firstName: 'V84eRefTeam', visibility: 'TEAM', ownerId: ID.owner, custom: { referralSourceId: ID.cTeam } } });

  // ---- a store order on each (linked by metadata.links.contactId) -------
  await db.marketplaceOrder.create({ data: {
    id: ID.orderPriv, businessId: ID.bizA, orderNumber: PRIV_ORDER_NUMBER, status: 'paid', customerName: PRIV_NAME,
    total: 125, subtotal: 125, metadata: { links: { contactId: ID.cPriv } },
  } });
  await db.marketplaceOrder.create({ data: {
    id: ID.orderTeam, businessId: ID.bizA, orderNumber: TEAM_ORDER_NUMBER, status: 'paid', customerName: 'V84eTeamCustomer',
    total: 80, subtotal: 80, metadata: { links: { contactId: ID.cTeam } },
  } });

  // ---- momentum and a snapshot on each ------------------------------------
  const snapDay = new Date(Date.now() - 2 * 86_400_000);
  snapDay.setUTCHours(0, 0, 0, 0);
  for (const [contactId, score] of [[ID.cPriv, 71], [ID.cTeam, 42]] as const) {
    await db.contactMomentum.create({ data: { id: `${contactId}_mom`, businessId: ID.bizA, contactId, score, previousScore: score - 5, trend: 'rising', recencyScore: 80, frequencyScore: 60, monetaryScore: 50, engagementScore: 40, tenureScore: 30 } });
    await db.contactMomentumSnapshot.create({ data: { id: `${contactId}_snap`, businessId: ID.bizA, contactId, score, trend: 'rising', recencyScore: 80, frequencyScore: 60, monetaryScore: 50, engagementScore: 40, tenureScore: 30, snapshotDate: snapDay } });
  }

  // ---- health inputs on each (a completed task and a note) --------------
  for (const contactId of [ID.cPriv, ID.cTeam]) {
    await db.contactTask.create({ data: { id: `${contactId}_task`, businessId: ID.bizA, contactId, title: `${P}follow up`, status: 'DONE' } });
    await db.contactNote.create({ data: { id: `${contactId}_note`, businessId: ID.bizA, contactId, body: `${P}note`, authorId: ID.owner } });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockClear();
});

describe('fixture sanity (real rows)', () => {
  it('seeded the memberships, contacts, orders, momentum rows and health inputs', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.contact.count({ where: { businessId: ID.bizA } })).toBe(4);
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.contactMomentum.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.contactMomentumSnapshot.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.contactTask.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await salesRepOf(ID.cPriv)).toBe(PRIV_REP);
  });

  it("the services hold the PRIVATE contact's data (so a 200 to a refused caller would disclose it)", async () => {
    const history: any = await serviceAnswer(route('NC-01'), ID.cPriv);
    expect(history.orders.map((o: any) => o.orderNumber)).toEqual([PRIV_ORDER_NUMBER]);
    const stats: any = await serviceAnswer(route('NC-02'), ID.cPriv);
    expect(stats).toMatchObject({ referralCode: PRIV_REF_CODE, referredCount: 1 });
    const momentum: any = await serviceAnswer(route('NC-04'), ID.cPriv);
    expect(momentum).toMatchObject({ contactId: ID.cPriv, score: 71 });
    const snaps: any = await serviceAnswer(route('NC-05'), ID.cPriv);
    expect(snaps.map((s: any) => s.score)).toEqual([71]);
  });

  it('characterization: RelationshipHealthService.computeHealth answers null for every contact at bb6b86d4', async () => {
    // Its findUnique selects no businessId, so `contact.businessId !== businessId`
    // holds for every row (relationship-health.service.ts:38-51, outside this
    // packet's write set). people-flow health therefore answers an empty 200
    // even for a visible contact with health inputs; NC-03's defect is that the
    // service runs on a contact the caller may not open, not what it returns.
    expect(await serviceAnswer(route('NC-03'), ID.cPriv)).toBeNull();
    expect(await serviceAnswer(route('NC-03'), ID.cTeam)).toBeNull();
  });
});

describe("STAFF_OWNED on the owner's PRIVATE contact answers 404 'Contact not found' before any service call", () => {
  for (const r of ROUTES.filter((x) => x.method === 'get')) {
    it(`${r.id}: GET ${r.label}`, async () => {
      const res = await send(r, ID.staffOwned, ID.cPriv);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contact not found');
      expectNoDisclosure(res.body);
      expectNoServiceCall();
    });
  }

  it('NC-06: PATCH sales-rep leaves the contact unchanged', async () => {
    const r = route('NC-06');
    try {
      const res = await send(r, ID.staffOwned, ID.cPriv);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contact not found');
      expectNoDisclosure(res.body);
      expectNoServiceCall();
      expect(await salesRepOf(ID.cPriv)).toBe(PRIV_REP);
    } finally {
      // Pre-fix the write lands; put the fixture back for the other cases.
      await setSalesRepRaw(ID.cPriv, PRIV_REP);
    }
  });

  it('a hidden contact and an absent id answer the same 404 on every route', async () => {
    for (const r of ROUTES) {
      const hidden = await send(r, ID.staffOwned, ID.cPriv);
      const absent = await send(r, ID.staffOwned, `${P}absent`);
      expect({ route: r.id, status: hidden.status, body: hidden.body }).toEqual({ route: r.id, status: absent.status, body: absent.body });
    }
    await setSalesRepRaw(ID.cPriv, PRIV_REP);
  });
});

describe('CONTROLS (pass before and after)', () => {
  for (const r of ROUTES.filter((x) => x.method === 'get')) {
    it(`STAFF_OWNED on the TEAM contact they own: ${r.id} ${r.label} answers 200 with the service's body`, async () => {
      const res = await send(r, ID.staffOwned, ID.cTeam);
      expect(res.status).toBe(200);
      expect(spies[r.spy].mock.calls.map((c: unknown[]) => c[1])).toEqual([ID.cTeam]);
      const expected = await serviceAnswer(r, ID.cTeam);
      expect(bodyOf(res)).toEqual(expected);
    });
  }

  it('STAFF_OWNED on the TEAM contact: the bodies carry its seeded data', async () => {
    const history = await send(route('NC-01'), ID.staffOwned, ID.cTeam);
    expect(history.body.orders.map((o: any) => o.orderNumber)).toEqual([TEAM_ORDER_NUMBER]);
    const stats = await send(route('NC-02'), ID.staffOwned, ID.cTeam);
    expect(stats.body).toMatchObject({ referralCode: TEAM_REF_CODE, referredCount: 1, rewardsEarned: 1 });
    const momentum = await send(route('NC-04'), ID.staffOwned, ID.cTeam);
    expect(momentum.body).toMatchObject({ contactId: ID.cTeam, score: 42 });
    const snaps = await send(route('NC-05'), ID.staffOwned, ID.cTeam);
    expect(snaps.body.map((s: any) => s.score)).toEqual([42]);
  });

  it('STAFF_OWNED on the TEAM contact: PATCH sales-rep answers 200 and the sales rep changes', async () => {
    try {
      const res = await send(route('NC-06'), ID.staffOwned, ID.cTeam, ID.bizA, { salesRepId: `${P}rep_team_new` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: true });
      expect(spies.setSalesRep.mock.calls).toEqual([[ID.bizA, ID.cTeam, `${P}rep_team_new`]]);
      expect(await salesRepOf(ID.cTeam)).toBe(`${P}rep_team_new`);
    } finally {
      await setSalesRepRaw(ID.cTeam, TEAM_REP);
    }
  });

  it('OWNER is unchanged: the PRIVATE contact answers 200 with its data on every read', async () => {
    for (const r of ROUTES.filter((x) => x.method === 'get')) {
      const res = await send(r, ID.owner, ID.cPriv);
      expect(res.status, r.id).toBe(200);
      const expected = await serviceAnswer(r, ID.cPriv);
      expect(bodyOf(res), r.id).toEqual(expected);
    }
    const history = await send(route('NC-01'), ID.owner, ID.cPriv);
    expect(history.body.orders.map((o: any) => o.orderNumber)).toEqual([PRIV_ORDER_NUMBER]);
    const stats = await send(route('NC-02'), ID.owner, ID.cPriv);
    expect(stats.body).toMatchObject({ referralCode: PRIV_REF_CODE, referredCount: 1 });
    const momentum = await send(route('NC-04'), ID.owner, ID.cPriv);
    expect(momentum.body).toMatchObject({ contactId: ID.cPriv, score: 71 });
  });

  it('OWNER is unchanged: PATCH sales-rep on the PRIVATE contact answers 200 and the rep changes', async () => {
    try {
      const res = await send(route('NC-06'), ID.owner, ID.cPriv, ID.bizA, { salesRepId: `${P}rep_by_owner` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: true });
      expect(await salesRepOf(ID.cPriv)).toBe(`${P}rep_by_owner`);
    } finally {
      await setSalesRepRaw(ID.cPriv, PRIV_REP);
    }
  });

  it('a bizB member gets 403 on every route for both contacts, with no service call', async () => {
    for (const r of ROUTES) {
      for (const contactId of [ID.cPriv, ID.cTeam]) {
        const res = await send(r, ID.other, contactId);
        expect(res.status, `${r.id} ${contactId}`).toBe(403);
        expectNoDisclosure(res.body);
      }
    }
    expectNoServiceCall();
    expect(await salesRepOf(ID.cPriv)).toBe(PRIV_REP);
    expect(await salesRepOf(ID.cTeam)).toBe(TEAM_REP);
  });
});

