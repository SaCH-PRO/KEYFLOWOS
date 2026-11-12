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
 *
 * REVIEW REPAIRS (V1-84 review ST-1..ST-5; RED at df41de0b, GREEN after):
 *   RV-01 POST momentum recommendations/:id/draft read body.contactId's PRIVATE
 *         contact (name into the reply, its notes into the AI prompt): now the
 *         recommendation and the contact must both be ones the caller may open.
 *   RV-02 PATCH sales-rep also needs the PATCH crm contacts/:id edit right
 *         (crm_edit 'none' 403, 'owned' on another's contact 403). The earlier
 *         control that let STAFF_OWNED (crm 'read', edit 'none') write is
 *         replaced: that caller is now refused 403, and an editor proves 200.
 *   RV-03 GET momentum recommendations listed the hidden contact (name, email,
 *         score); its action/snooze/dismiss wrote it. Both now follow V1-08.
 *   RV-04 GET marketplace orders/:orderId/cross-links named the hidden linked
 *         contact: `contact` is now null for a caller who may not open it.
 *   RV-05 GET people-flow segments and GET conversion sales-reps/:repId/pipeline
 *         named the hidden contact: those entries are now dropped.
 * The AI provider is never reached: AiUsageService.callAi is a recording stub
 * that throws, so MomentumAiService answers its fallback draft.
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
  // Review repairs (RV-01..RV-05).
  staffEditor: `${P}staffEditor`, // STAFF of bizA, crm: write + crm_edit: owned (crm_view 'all' by default)
  cEditor: `${P}cEditor`,         // TEAM, owned by staffEditor
  recPriv: `${P}recPriv`,         // momentum recommendation on cPriv
  recTeam: `${P}recTeam`,         // momentum recommendation on cTeam
};

// Markers that must never reach a refused caller.
const PRIV_REF_CODE = 'V84E-PRIV-REF-9c1d';
const PRIV_ORDER_NUMBER = `${P}ORD-PRIV-4471`;
const PRIV_NAME = 'V84ePrivateCustomer';
const PRIV_EMAIL = `${P}priv@test.local`;
const PRIV_REP = `${P}rep_original`;
const PRIV_NOTE = 'V84E-SECRET-NOTE-6f2a';
const TEAM_REF_CODE = 'V84E-TEAM-REF-2b7e';
const TEAM_ORDER_NUMBER = `${P}ORD-TEAM-5512`;
const TEAM_REP = `${P}rep_team_original`;
const EDITOR_REP = `${P}rep_editor_original`;

let db: any;
let app: any;
const svc: Record<string, any> = {};
const spies: Record<string, any> = {};
/** Every AiUsageService.callAi request (the stub records it, then throws). */
const aiCalls: any[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM momentum_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
      // The draft route's service (RV-01): real; its AI call is a recording
      // stub that throws, so no provider is reached and the fallback answers.
      MomentumAiService,
      {
        provide: AiUsageService,
        useValue: {
          callAi: async (req: unknown) => {
            aiCalls.push(req);
            throw new Error('no AI provider in this suite');
          },
        },
      },
      // Collaborators the routes this suite sends never reach.
      { provide: MarketplaceService, useValue: {} },
      { provide: CrmService, useValue: {} },
      { provide: ExpensesService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: UpsellService, useValue: {} },
      { provide: LeadMagnetService, useValue: {} },
      { provide: MerchantSubscriptionService, useValue: {} },
      { provide: PeopleOverviewService, useValue: {} },
      { provide: AutopilotService, useValue: {} },
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
  // Review repairs: the recommendation writes and the draft must not run for
  // a refused caller (the list routes call their service, then filter).
  svc.momentumAi = moduleRef.get(MomentumAiService);
  spies.draft = vi.spyOn(svc.momentumAi, 'generateDraft');
  spies.recAction = vi.spyOn(svc.momentum, 'actionRecommendation');
  spies.recSnooze = vi.spyOn(svc.momentum, 'snoozeRecommendation');
  spies.recDismiss = vi.spyOn(svc.momentum, 'dismissRecommendation');

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const id of [ID.owner, ID.staffOwned, ID.other, ID.staffEditor]) {
    await db.user.create({ data: { id, email: `${P}u_${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84E Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84E Biz B', ownerId: ID.other } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned' });
  await m(ID.other, ID.bizB, 'OWNER');
  await m(ID.staffEditor, ID.bizA, 'STAFF', { crm: 'write', crm_edit: 'owned' });

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

  // ---- review repairs (RV-01..RV-05) --------------------------------------
  // A TEAM contact the editor owns, a secret note on the PRIVATE contact, and a
  // pending momentum recommendation on the PRIVATE and on the TEAM contact.
  await db.contact.create({ data: {
    id: ID.cEditor, businessId: ID.bizA, firstName: 'V84eEditorCustomer', email: `${P}editor@test.local`, status: 'CUSTOMER',
    visibility: 'TEAM', ownerId: ID.staffEditor, lastInteractionAt: recent, custom: { salesRepId: EDITOR_REP },
  } });
  await db.contactNote.create({ data: { id: `${ID.cPriv}_secret`, businessId: ID.bizA, contactId: ID.cPriv, body: PRIV_NOTE, authorId: ID.owner } });
  await db.momentumRecommendation.create({ data: {
    id: ID.recPriv, businessId: ID.bizA, contactId: ID.cPriv, type: 'check_in', title: `Check in with ${PRIV_NAME}`,
    description: `${PRIV_NAME} has gone quiet`, priority: 'high', momentumScore: 71,
  } });
  await db.momentumRecommendation.create({ data: {
    id: ID.recTeam, businessId: ID.bizA, contactId: ID.cTeam, type: 'check_in', title: 'Check in with V84eTeamCustomer',
    description: 'V84eTeamCustomer has gone quiet', priority: 'medium', momentumScore: 42,
  } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockClear();
  aiCalls.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded the memberships, contacts, orders, momentum rows and health inputs', async () => {
    // owner, staffOwned and (review repairs) staffEditor; 4 contacts + cEditor.
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(3);
    expect(await db.contact.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await db.momentumRecommendation.count({ where: { businessId: ID.bizA } })).toBe(2);
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

  // RV-02 (review ST-2): this control answered 200 and wrote before the review
  // repairs. STAFF_OWNED holds crm 'read', so crm_edit 'none': the PATCH crm
  // contacts/:id edit rule refuses it 403, and so does this write now. The
  // 200-and-write path is proved for an editor in the RV-02 block below.
  it('STAFF_OWNED (crm read: crm_edit none) on the TEAM contact they own: PATCH sales-rep 403, nothing written', async () => {
    try {
      const res = await send(route('NC-06'), ID.staffOwned, ID.cTeam, ID.bizA, { salesRepId: `${P}rep_team_new` });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have permission to edit contacts');
      expect(spies.setSalesRep).not.toHaveBeenCalled();
      expect(await salesRepOf(ID.cTeam)).toBe(TEAM_REP);
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

// ---------------------------------------------------------------------------
// Review repairs (V1-84 review ST-1..ST-5). RED at df41de0b, GREEN after.
// ---------------------------------------------------------------------------

const hit = (method: 'get' | 'post' | 'patch', url: string, actor: string, body?: object) => {
  const req = request(app.getHttpServer())[method](url).set('x-test-user', actor);
  return body === undefined ? req : req.send(body);
};
const momentumUrl = (p: string) => `/momentum/businesses/${ID.bizA}${p}`;
const draftBody = (contactId?: string) => ({
  ...(contactId === undefined ? {} : { contactId }),
  contactName: 'Someone', type: 'check_in', description: 'catch up',
});

/** The contacts each restricted member may open in the fixture, by the V1-08 rule. */
const OPENS: Record<string, Set<string>> = {
  // crm_view 'owned': its own book only.
  [ID.staffOwned]: new Set([ID.cTeam]),
  // crm 'write' (crm_view 'all' by default): every TEAM row and its own, no PRIVATE row of another.
  [ID.staffEditor]: new Set([ID.cTeam, ID.cReferredByPriv, ID.cReferredByTeam, ID.cEditor]),
};
const RESTRICTED = [ID.staffOwned, ID.staffEditor];

async function recRow(id: string): Promise<{ status: string; draft_message: string | null }> {
  const rows: any[] = await db.$queryRawUnsafe(`SELECT status, draft_message FROM momentum_recommendations WHERE id = $1`, id);
  return rows[0];
}

async function resetRec(id: string) {
  await db.$executeRawUnsafe(
    `UPDATE momentum_recommendations SET status = 'pending', snoozed_until = NULL, actioned_at = NULL, dismissed_at = NULL,
       draft_message = NULL, draft_subject = NULL, suggested_channel = NULL WHERE id = $1`,
    id,
  );
}

function expectNoPrivateContact(body: unknown) {
  const text = JSON.stringify(body ?? {});
  for (const marker of [ID.cPriv, PRIV_NAME, PRIV_EMAIL, PRIV_NOTE, ID.recPriv]) {
    expect(text).not.toContain(marker);
  }
}

describe('RV-01 POST momentum recommendations/:id/draft applies record visibility (review ST-1)', () => {
  it("STAFF_OWNED naming the PRIVATE contact in body.contactId: 404 'Contact not found', no draft, no AI call", async () => {
    const res = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/draft`), ID.staffOwned, draftBody(ID.cPriv));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expectNoPrivateContact(res.body);
    expect(spies.draft).not.toHaveBeenCalled();
    expect(aiCalls).toEqual([]);
    expect(await recRow(ID.recTeam)).toEqual({ status: 'pending', draft_message: null });
    const absent = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/draft`), ID.staffOwned, draftBody(`${P}absent`));
    expect({ status: absent.status, body: absent.body }).toEqual({ status: res.status, body: res.body });
  });

  it('a missing or empty body.contactId answers the same 404 (an absent id would match any contact of the tenant)', async () => {
    for (const body of [draftBody(), draftBody('')]) {
      const res = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/draft`), ID.staffOwned, body);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contact not found');
      expectNoPrivateContact(res.body);
    }
    expect(spies.draft).not.toHaveBeenCalled();
    expect(aiCalls).toEqual([]);
  });

  it("the PRIVATE contact's recommendation (with a visible body.contactId): 404 'Recommendation not found', as for an absent id, nothing written", async () => {
    try {
      const hidden = await hit('post', momentumUrl(`/recommendations/${ID.recPriv}/draft`), ID.staffOwned, draftBody(ID.cTeam));
      const absent = await hit('post', momentumUrl(`/recommendations/${P}absentRec/draft`), ID.staffOwned, draftBody(ID.cTeam));
      expect(hidden.status).toBe(404);
      expect(hidden.body.message).toBe('Recommendation not found');
      expect({ status: absent.status, body: absent.body }).toEqual({ status: hidden.status, body: hidden.body });
      expect(spies.draft).not.toHaveBeenCalled();
      expect(aiCalls).toEqual([]);
      expect(await recRow(ID.recPriv)).toEqual({ status: 'pending', draft_message: null });
    } finally {
      await resetRec(ID.recPriv);
    }
  });

  it('STAFF_EDITOR (crm_view all) naming the PRIVATE contact of another: 404 as well', async () => {
    const res = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/draft`), ID.staffEditor, draftBody(ID.cPriv));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(spies.draft).not.toHaveBeenCalled();
    expect(aiCalls).toEqual([]);
  });

  it('CONTROL: STAFF_OWNED on the TEAM recommendation and contact gets the draft; the prompt carries no PRIVATE note', async () => {
    const res = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/draft`), ID.staffOwned, draftBody(ID.cTeam));
    expect(res.status).toBe(201);
    expect(res.body.message).toContain('V84eTeamCustomer');
    expect(spies.draft.mock.calls).toEqual([[ID.bizA, expect.objectContaining({ recommendationId: ID.recTeam, contactId: ID.cTeam })]]);
    expect(aiCalls).toHaveLength(1);
    expect(JSON.stringify(aiCalls)).toContain(`${P}note`);
    expectNoPrivateContact(aiCalls);
  });

  it('CONTROL: OWNER is unchanged: the PRIVATE recommendation and contact draft as before', async () => {
    const res = await hit('post', momentumUrl(`/recommendations/${ID.recPriv}/draft`), ID.owner, draftBody(ID.cPriv));
    expect(res.status).toBe(201);
    expect(res.body.message).toContain(PRIV_NAME);
    expect(JSON.stringify(aiCalls)).toContain(PRIV_NOTE);
  });
});

describe('RV-02 PATCH conversion sales-rep follows the PATCH crm contacts/:id edit right (review ST-2)', () => {
  it('STAFF_EDITOR (crm_edit owned) on the TEAM contact they own: 200 and the sales rep changes', async () => {
    try {
      const res = await send(route('NC-06'), ID.staffEditor, ID.cEditor, ID.bizA, { salesRepId: `${P}rep_editor_new` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: true });
      expect(spies.setSalesRep.mock.calls).toEqual([[ID.bizA, ID.cEditor, `${P}rep_editor_new`]]);
      expect(await salesRepOf(ID.cEditor)).toBe(`${P}rep_editor_new`);
    } finally {
      await setSalesRepRaw(ID.cEditor, EDITOR_REP);
    }
  });

  it("STAFF_EDITOR on a TEAM contact they neither own nor share: 403 'You can only edit contacts you own', nothing written", async () => {
    try {
      const res = await send(route('NC-06'), ID.staffEditor, ID.cTeam, ID.bizA, { salesRepId: `${P}hijack` });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only edit contacts you own');
      expect(spies.setSalesRep).not.toHaveBeenCalled();
      expect(await salesRepOf(ID.cTeam)).toBe(TEAM_REP);
    } finally {
      await setSalesRepRaw(ID.cTeam, TEAM_REP);
    }
  });

  it("STAFF_EDITOR on the PRIVATE contact they cannot open: 404 'Contact not found' (as for an absent id), nothing written", async () => {
    try {
      const hidden = await send(route('NC-06'), ID.staffEditor, ID.cPriv, ID.bizA, { salesRepId: `${P}hijack` });
      const absent = await send(route('NC-06'), ID.staffEditor, `${P}absent`, ID.bizA, { salesRepId: `${P}hijack` });
      expect(hidden.status).toBe(404);
      expect(hidden.body.message).toBe('Contact not found');
      expect({ status: absent.status, body: absent.body }).toEqual({ status: hidden.status, body: hidden.body });
      expect(spies.setSalesRep).not.toHaveBeenCalled();
      expect(await salesRepOf(ID.cPriv)).toBe(PRIV_REP);
    } finally {
      await setSalesRepRaw(ID.cPriv, PRIV_REP);
    }
  });
});

describe('RV-03 momentum recommendations follow record visibility (review ST-3)', () => {
  it("GET recommendations: a restricted member sees the TEAM contact's recommendation, never the PRIVATE one", async () => {
    for (const actor of RESTRICTED) {
      const res = await hit('get', momentumUrl('/recommendations'), actor);
      expect(res.status, actor).toBe(200);
      expect(res.body.map((r: any) => r.id), actor).toEqual([ID.recTeam]);
      expectNoPrivateContact(res.body);
    }
  });

  it("GET recommendations?limit=1: the limit counts only what the member may see (the PRIVATE 'high' one sorts first)", async () => {
    const res = await hit('get', momentumUrl('/recommendations?limit=1'), ID.staffOwned);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).toEqual([ID.recTeam]);
  });

  it('CONTROL: OWNER is unchanged: the service answer, PRIVATE recommendation included', async () => {
    const res = await hit('get', momentumUrl('/recommendations'), ID.owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(await svc.momentum.getDailyRecommendations(ID.bizA, 5)));
    expect(res.body.map((r: any) => r.id)).toEqual([ID.recPriv, ID.recTeam]);
    expect(res.body[0]).toMatchObject({ momentumScore: 71, contact: { firstName: PRIV_NAME, email: PRIV_EMAIL } });
  });

  for (const [verb, spy] of [['action', 'recAction'], ['snooze', 'recSnooze'], ['dismiss', 'recDismiss']] as const) {
    it(`POST recommendations/:id/${verb} on the PRIVATE contact's recommendation: 404 'Recommendation not found' (as for an absent id), row unchanged`, async () => {
      try {
        for (const actor of RESTRICTED) {
          const hidden = await hit('post', momentumUrl(`/recommendations/${ID.recPriv}/${verb}`), actor, { days: 3 });
          const absent = await hit('post', momentumUrl(`/recommendations/${P}absentRec/${verb}`), actor, { days: 3 });
          expect(hidden.status, actor).toBe(404);
          expect(hidden.body.message, actor).toBe('Recommendation not found');
          expect({ status: absent.status, body: absent.body }).toEqual({ status: hidden.status, body: hidden.body });
          expectNoPrivateContact(hidden.body);
        }
        expect(spies[spy]).not.toHaveBeenCalled();
        expect((await recRow(ID.recPriv)).status).toBe('pending');
      } finally {
        await resetRec(ID.recPriv);
      }
    });
  }

  it("CONTROL: STAFF_OWNED snoozes the TEAM contact's recommendation: 201 and the row is snoozed", async () => {
    try {
      const res = await hit('post', momentumUrl(`/recommendations/${ID.recTeam}/snooze`), ID.staffOwned, { days: 3 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: ID.recTeam, status: 'snoozed' });
      expect((await recRow(ID.recTeam)).status).toBe('snoozed');
    } finally {
      await resetRec(ID.recTeam);
    }
  });
});

describe('RV-04 GET marketplace orders/:orderId/cross-links names only a contact the caller may open (review ST-4)', () => {
  const crossLinks = (orderId: string) => `/marketplace/businesses/${ID.bizA}/orders/${orderId}/cross-links`;

  it("a restricted member gets the PRIVATE contact's order with `contact` null, the rest unchanged", async () => {
    const service: any = json(await svc.commerce.getOrderCrossLinks(ID.bizA, ID.orderPriv));
    expect(service.contact).toMatchObject({ id: ID.cPriv, firstName: PRIV_NAME, email: PRIV_EMAIL });
    for (const actor of RESTRICTED) {
      const res = await hit('get', crossLinks(ID.orderPriv), actor);
      expect(res.status, actor).toBe(200);
      expect(res.body, actor).toEqual({ ...service, contact: null });
      for (const marker of [ID.cPriv, PRIV_NAME, PRIV_EMAIL]) expect(JSON.stringify(res.body)).not.toContain(marker);
    }
  });

  it('CONTROL: STAFF_OWNED on the TEAM contact\'s order and OWNER on the PRIVATE one get the service answer', async () => {
    const team = await hit('get', crossLinks(ID.orderTeam), ID.staffOwned);
    expect(team.status).toBe(200);
    expect(team.body).toEqual(json(await svc.commerce.getOrderCrossLinks(ID.bizA, ID.orderTeam)));
    expect(team.body.contact).toMatchObject({ id: ID.cTeam });
    const owner = await hit('get', crossLinks(ID.orderPriv), ID.owner);
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual(json(await svc.commerce.getOrderCrossLinks(ID.bizA, ID.orderPriv)));
    expect(owner.body.contact).toMatchObject({ id: ID.cPriv, firstName: PRIV_NAME });
  });
});

describe('RV-05 GET people-flow segments and conversion sales-reps/:repId/pipeline name only openable contacts (review ST-5)', () => {
  it('segments: a restricted member gets the service answer with only the contacts they may open', async () => {
    const service: any[] = json(await svc.health.listSegments(ID.bizA)) as any[];
    expect(JSON.stringify(service)).toContain(PRIV_NAME);
    for (const actor of RESTRICTED) {
      const res = await hit('get', `/people-flow/businesses/${ID.bizA}/segments`, actor);
      expect(res.status, actor).toBe(200);
      const expected = service.map((s) => ({ ...s, contacts: s.contacts.filter((c: any) => OPENS[actor].has(c.id)) }));
      expect(res.body, actor).toEqual(expected);
      expectNoPrivateContact(res.body);
    }
  });

  it('CONTROL: segments: OWNER gets the service answer, the PRIVATE contact included', async () => {
    const res = await hit('get', `/people-flow/businesses/${ID.bizA}/segments`, ID.owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(await svc.health.listSegments(ID.bizA)));
    expect(JSON.stringify(res.body)).toContain(PRIV_NAME);
  });

  it("pipeline: the PRIVATE contact's rep shows a restricted member nothing; OWNER the contact", async () => {
    const pipeline = (rep: string) => `/conversion/businesses/${ID.bizA}/sales-reps/${rep}/pipeline`;
    for (const actor of RESTRICTED) {
      const res = await hit('get', pipeline(PRIV_REP), actor);
      expect(res.status, actor).toBe(200);
      expect(res.body, actor).toEqual([]);
    }
    const owner = await hit('get', pipeline(PRIV_REP), ID.owner);
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual(json(await svc.salesTeam.getRepPipeline(ID.bizA, PRIV_REP)));
    expect(owner.body.map((e: any) => e.id)).toEqual([ID.cPriv]);
  });

  it("CONTROL: pipeline: the TEAM contact's rep shows STAFF_OWNED the service answer", async () => {
    const res = await hit('get', `/conversion/businesses/${ID.bizA}/sales-reps/${TEAM_REP}/pipeline`, ID.staffOwned);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(await svc.salesTeam.getRepPipeline(ID.bizA, TEAM_REP)));
    expect(res.body.map((e: any) => e.id)).toEqual([ID.cTeam]);
  });
});

