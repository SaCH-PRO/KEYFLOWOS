/**
 * FU-AI-APPROVALS-MONEY-SIGHT (P0; D-100, D-234, D-238): the AI approval items answer each member only what they may
 * read, and are acted on only at the matching write level (REAL database).
 *
 * The leak (found by the FU-INSIGHTS-SIGHT acceptance review): the approval list, the item by id and the stats
 * (AiApprovalsController, @RequireModuleScope('operations')) were gated by operations read only, while every writer of
 * an item (createApprovalItem from Flow chat, plan steps, drive and message intake; the stale-quote listener) puts
 * money amounts and expenses into its title, description and inputPayload. A member with operations read and no
 * revenue read was handed the amounts; one with no expenses read, the expenses. The same items reached the action
 * queue (GET actions/businesses/:b/queue) and the approver's notification, and were approved or rejected at
 * operations write alone.
 *
 * WHAT IS REAL: PrismaService and the Prisma client at DATABASE_URL, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, AiApprovalsController, AiApprovalsService, AiOversightService (resolveApproval,
 * resolveApprovalsBatch, createApprovalItem and its routing tail, getPendingApprovals), GraphActionsController and the
 * PlannerService and AiExecutionLogService reads it makes; the users, businesses, memberships and ai_approval_items
 * rows. Identity attachment is a test middleware (x-test-user, seeded v72a_ users only). Stand-ins: the approval
 * router (resolveApprover answers the route the case names; notifyApprover records what would be sent, no provider is
 * reached), the execution log and memory signal sinks of AiOversightService, and the graph controller's other
 * collaborators.
 *
 * Every seeded row carries the `v72a_` prefix (or a v72a_ business id) and is hard-deleted by raw SQL with
 * sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72a_';

const ID = {
  owner: `${P}owner`, // OWNER of bizA (role defaults: admin everywhere)
  ownerMap: `${P}ownerMap`, // OWNER of bizA bound by an explicit map with revenue none (D-140)
  opsOnly: `${P}opsOnly`, // STAFF: operations write, crm write; no revenue, no expenses
  revRead: `${P}revRead`, // + revenue read
  revWrite: `${P}revWrite`, // + revenue write
  bothRead: `${P}bothRead`, // revenue write, expenses read
  bothWrite: `${P}bothWrite`, // revenue write, expenses write
  other: `${P}other`, // OWNER of bizB only
  superNM: `${P}superNM`, // SUPER_ADMIN, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // list / get / stats items (pending)
  iMoney: `${P}iMoney`,
  iRent: `${P}iRent`,
  iPlain: `${P}iPlain`,
  iUnknown: `${P}iUnknown`,
  iPayload: `${P}iPayload`,
  iApprovedMoney: `${P}iApprovedMoney`, // approved today
  iForeign: `${P}iForeign`, // bizB
  // resolve items
  rMoney1: `${P}rMoney1`,
  rMoney2: `${P}rMoney2`,
  rMoney3: `${P}rMoney3`,
  rRent1: `${P}rRent1`,
  rRent2: `${P}rRent2`,
  rRent3: `${P}rRent3`,
  rOwner: `${P}rOwner`,
  rOwnerMap: `${P}rOwnerMap`,
  rSuper: `${P}rSuper`,
  rPlain: `${P}rPlain`,
  rDefer: `${P}rDefer`,
  bMoney: `${P}bMoney`,
  bPlain: `${P}bPlain`,
} as const;

const MONEY = { toolName: 'crm_add_note', module: 'crm', title: 'Follow up with Acme', description: 'Acme owes TTD 4,000 on invoice INV-7', inputPayload: { amount: 4000, contact: 'Acme' } };
const RENT = { toolName: 'crm_create_task', module: 'crm', title: 'Ask the landlord about the rent renewal', description: 'Lease ends next month', inputPayload: { note: 'landlord' } };
const PLAIN = { toolName: 'crm_create_task', module: 'crm', title: 'Call Jane about the meeting', description: 'Schedule a call', inputPayload: { contact: 'Jane' } };
const UNKNOWN = { toolName: 'mystery_tool', module: 'autopilot', title: 'Run delegation loop', description: 'Autopilot wants to run a loop', inputPayload: {} };
const PAYLOAD = {
  toolName: 'message_intake_action', module: 'communications', title: 'Message intake: reply to Bob', description: 'KEY proposes a reply',
  inputPayload: { plan: { actions: [{ type: 'reply', payload: { total: 523.5 } }] } },
};

let app: any;
let db: any;
let oversight: any;
const notified: Array<{ route: any; item: any }> = [];
let routeFor: (businessId: string) => Promise<any> = async () => ({ method: 'unresolved' });

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_approval_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function http() {
  return request(app.getHttpServer());
}
function as(actor: string | null, req: any) {
  return actor ? req.set('x-test-user', actor) : req;
}
const list = (actor: string, query = '', biz: string = ID.bizA) => as(actor, http().get(`/ai-approvals/businesses/${biz}/items?status=pending${query}`));
const getItem = (actor: string, id: string, biz: string = ID.bizA) => as(actor, http().get(`/ai-approvals/businesses/${biz}/items/${id}`));
const stats = (actor: string, biz: string = ID.bizA) => as(actor, http().get(`/ai-approvals/businesses/${biz}/stats`));
const resolve = (actor: string, id: string, resolution = 'approved', biz: string = ID.bizA) =>
  as(actor, http().post(`/ai-approvals/businesses/${biz}/items/${id}/resolve`).send({ resolution }));
const bulk = (actor: string, ids: string[], resolution = 'approved') =>
  as(actor, http().post(`/ai-approvals/businesses/${ID.bizA}/items/bulk-resolve`).send({ ids, resolution }));
const queue = (actor: string) => as(actor, http().get(`/actions/businesses/${ID.bizA}/queue`));

async function statusOf(id: string): Promise<string | null> {
  const row = await db.aiApprovalItem.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

async function seedItem(id: string, content: Record<string, unknown>, extra: Record<string, unknown> = {}, businessId: string = ID.bizA) {
  await db.aiApprovalItem.create({ data: { id, businessId, riskTier: 1, status: 'pending', ...content, ...extra } });
}

const ids = (res: any): string[] => (res.body.items ?? []).map((i: any) => i.id);

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiApprovalsController } = await import('../src/modules/ai/ai-approvals.controller');
  const { AiApprovalsService } = await import('../src/modules/ai/ai-approvals.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');

  const routing = {
    resolveApprover: async (businessId: string) => routeFor(businessId),
    resolveOwner: async () => null,
    notifyApprover: async (_b: string, route: any, item: any) => {
      notified.push({ route, item });
      return { sent: true };
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AiApprovalsController, GraphActionsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      {
        provide: AiOversightService,
        inject: [PrismaService],
        useFactory: (prisma: any) =>
          new (AiOversightService as any)(
            prisma,
            { log: async () => undefined },
            { recordApprovalSignal: async () => undefined },
            {},
            routing,
            {},
          ),
      },
      AiApprovalsService,
      { provide: BusinessGraphService, useValue: { getSnapshot: async () => ({}) } },
      { provide: IntentParserService, useValue: {} },
      {
        provide: PlannerService,
        inject: [PrismaService],
        useFactory: (prisma: any) => new (PlannerService as any)(prisma, {}, {}, {}, {}, {}),
      },
      { provide: FlowOrchestratorService, useValue: {} },
      AiExecutionLogService,
      { provide: WorkspaceRecommendationsService, useValue: {} },
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
  oversight = moduleRef.get(AiOversightService);

  await cleanup();

  for (const id of [ID.owner, ID.ownerMap, ID.opsOnly, ID.revRead, ID.revWrite, ID.bothRead, ID.bothWrite, ID.other]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.user.create({ data: { id: ID.superNM, email: `${P}superNM@test.local`, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72a Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72a Biz B', ownerId: ID.other } });
  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes, maxApprovalTier: 4 } });
  const ops = { operations: 'write', crm: 'write' };
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.ownerMap, ID.bizA, 'OWNER', { operations: 'admin', crm: 'admin', revenue: 'none', expenses: 'none' });
  await m(ID.opsOnly, ID.bizA, 'STAFF', ops);
  await m(ID.revRead, ID.bizA, 'STAFF', { ...ops, revenue: 'read' });
  await m(ID.revWrite, ID.bizA, 'STAFF', { ...ops, revenue: 'write' });
  await m(ID.bothRead, ID.bizA, 'STAFF', { ...ops, revenue: 'write', expenses: 'read' });
  await m(ID.bothWrite, ID.bizA, 'STAFF', { ...ops, revenue: 'write', expenses: 'write' });
  await m(ID.other, ID.bizB, 'OWNER');

  // The list items are the opsOnly member's own (the action queue shows a member only their own).
  await seedItem(ID.iMoney, MONEY, { userId: ID.opsOnly, riskTier: 3 });
  await seedItem(ID.iRent, RENT, { userId: ID.opsOnly, riskTier: 3 });
  await seedItem(ID.iPlain, PLAIN, { userId: ID.opsOnly, riskTier: 3 });
  await seedItem(ID.iUnknown, UNKNOWN, { riskTier: 3 });
  await seedItem(ID.iPayload, PAYLOAD, { riskTier: 3 });
  await seedItem(ID.iApprovedMoney, MONEY, { status: 'approved', resolution: 'approved', resolvedAt: new Date() });
  await seedItem(ID.iForeign, MONEY, {}, ID.bizB);
  for (const id of [ID.rMoney1, ID.rMoney2, ID.rMoney3, ID.rOwner, ID.rOwnerMap, ID.rSuper, ID.bMoney]) await seedItem(id, MONEY, { riskTier: 0 });
  for (const id of [ID.rRent1, ID.rRent2, ID.rRent3]) await seedItem(id, RENT, { riskTier: 0 });
  for (const id of [ID.rPlain, ID.bPlain]) await seedItem(id, PLAIN, { riskTier: 0 });
  await seedItem(ID.rDefer, MONEY, { riskTier: 0 });
}, 60_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: the approval list (GET .../items)', () => {
  it('SIGHT-01: a member with operations read and no revenue or expenses read is handed only the item that states neither', async () => {
    const res = await list(ID.opsOnly, '&limit=100');
    expect(res.status).toBe(200);
    const got = ids(res);
    expect(got).toContain(ID.iPlain);
    for (const hidden of [ID.iMoney, ID.iRent, ID.iUnknown, ID.iPayload, ID.rMoney1, ID.rRent1]) expect(got).not.toContain(hidden);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('4,000');
    expect(body).not.toContain('4000');
    expect(body).not.toContain('landlord');
    expect(body).not.toContain('523.5');
  });

  it('SIGHT-02: revenue read without expenses read: money items, not expense items, not unclassified ones', async () => {
    const got = ids(await list(ID.revRead, '&limit=100'));
    expect(got).toEqual(expect.arrayContaining([ID.iMoney, ID.iPlain]));
    expect(got).not.toContain(ID.iRent);
    expect(got).not.toContain(ID.iUnknown);
  });

  it('SIGHT-03: revenue and expenses read: every item, the unclassified one included', async () => {
    const got = ids(await list(ID.bothRead, '&limit=100'));
    expect(got).toEqual(expect.arrayContaining([ID.iMoney, ID.iRent, ID.iPlain, ID.iUnknown, ID.iPayload]));
  });

  it('SIGHT-04: owner parity: the OWNER on role defaults is handed every item; an OWNER bound by revenue none is not', async () => {
    const all = ids(await list(ID.owner, '&limit=100'));
    expect(all).toEqual(expect.arrayContaining([ID.iMoney, ID.iRent, ID.iPlain, ID.iUnknown, ID.iPayload]));
    const bound = ids(await list(ID.ownerMap, '&limit=100'));
    expect(bound).toContain(ID.iPlain);
    expect(bound).not.toContain(ID.iMoney);
    expect(bound).not.toContain(ID.iRent);
  });

  it('SIGHT-05: a SUPER_ADMIN who is no member holds no sight: no money item', async () => {
    const res = await list(ID.superNM, '&limit=100');
    expect(res.status).toBe(200);
    expect(ids(res)).not.toContain(ID.iMoney);
    expect(JSON.stringify(res.body)).not.toContain('4,000');
  });

  it('SIGHT-06: search is no oracle: a search for a hidden figure answers nothing', async () => {
    const res = await list(ID.opsOnly, `&search=${encodeURIComponent('4,000')}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([]);
  });

  it('SIGHT-07: paging walks the visible items only, each once, and ends', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const res: any = await list(ID.opsOnly, `&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...ids(res));
      if (!res.body.hasMore) break;
      cursor = res.body.nextCursor;
    }
    const whole = ids(await list(ID.opsOnly, '&limit=100'));
    expect(seen).toEqual(whole);
    expect(seen).not.toContain(ID.iMoney);
  });
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: the item by id (GET .../items/:id)', () => {
  it('GET-01: a hidden item is answered exactly as an item of another business', async () => {
    const hidden = await getItem(ID.opsOnly, ID.iMoney);
    const foreign = await getItem(ID.opsOnly, ID.iForeign);
    expect(hidden.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(hidden.body).toEqual(foreign.body);
    expect(JSON.stringify(hidden.body)).not.toContain('4,000');
  });

  it('GET-02: a member with the sight is handed the item', async () => {
    const res = await getItem(ID.revRead, ID.iMoney);
    expect(res.status).toBe(200);
    expect(res.body.description).toContain('4,000');
  });
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: the stats (GET .../stats)', () => {
  it('STATS-01: counts only the items the member may read', async () => {
    const visiblePending = ids(await list(ID.opsOnly, '&limit=100')).length;
    const res = await stats(ID.opsOnly);
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(visiblePending);
    expect(res.body.approvedToday).toBe(0);
    const byModule = (res.body.byModule as Array<{ count: number }>).reduce((n, r) => n + r.count, 0);
    expect(byModule).toBe(visiblePending);
  });

  it('STATS-02: owner parity: the OWNER counts every item', async () => {
    const res = await stats(ID.owner);
    expect(res.status).toBe(200);
    expect(res.body.approvedToday).toBeGreaterThanOrEqual(1);
    expect(res.body.pending).toBeGreaterThan((await stats(ID.opsOnly)).body.pending);
  });
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: acting on an item (POST .../resolve, .../bulk-resolve)', () => {
  it('RES-01: a member who may not read the item is answered as for another business, and it stays pending', async () => {
    const hidden = await resolve(ID.opsOnly, ID.rMoney1);
    const foreign = await resolve(ID.opsOnly, ID.iForeign);
    expect(hidden.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(hidden.body.message.replace(ID.rMoney1, 'X')).toBe(foreign.body.message.replace(ID.iForeign, 'X'));
    expect(await statusOf(ID.rMoney1)).toBe('pending');
  });

  it('RES-02: revenue read but not write: 403, and it stays pending', async () => {
    const res = await resolve(ID.revRead, ID.rMoney2);
    expect(res.status).toBe(403);
    expect(await statusOf(ID.rMoney2)).toBe('pending');
  });

  it('RES-03: revenue write approves a money item', async () => {
    const res = await resolve(ID.revWrite, ID.rMoney3);
    expect(res.status).toBe(201);
    expect(await statusOf(ID.rMoney3)).toBe('approved');
  });

  it('RES-04: an expense item: hidden without expenses read (404), 403 at expenses read, approved at expenses write', async () => {
    expect((await resolve(ID.revWrite, ID.rRent1)).status).toBe(404);
    expect(await statusOf(ID.rRent1)).toBe('pending');
    expect((await resolve(ID.bothRead, ID.rRent2, 'rejected')).status).toBe(403);
    expect(await statusOf(ID.rRent2)).toBe('pending');
    expect((await resolve(ID.bothWrite, ID.rRent3, 'rejected')).status).toBe(201);
    expect(await statusOf(ID.rRent3)).toBe('rejected');
  });

  it('RES-05: owner parity: the OWNER acts; an OWNER bound by revenue none and a memberless SUPER_ADMIN do not', async () => {
    expect((await resolve(ID.owner, ID.rOwner)).status).toBe(201);
    expect(await statusOf(ID.rOwner)).toBe('approved');
    expect((await resolve(ID.ownerMap, ID.rOwnerMap)).status).toBe(404);
    expect(await statusOf(ID.rOwnerMap)).toBe('pending');
    expect((await resolve(ID.superNM, ID.rSuper)).status).toBe(404);
    expect(await statusOf(ID.rSuper)).toBe('pending');
  });

  it('RES-06: an item that states nothing is still acted on at operations write (no change)', async () => {
    const res = await resolve(ID.opsOnly, ID.rPlain);
    expect(res.status).toBe(201);
    expect(await statusOf(ID.rPlain)).toBe('approved');
  });

  it('RES-07: deferring a money item is acting on it: refused without revenue write', async () => {
    expect((await resolve(ID.revRead, ID.rDefer, 'deferred')).status).toBe(403);
    expect(await statusOf(ID.rDefer)).toBe('pending');
  });

  it('BULK-01: bulk resolve acts only on the items the member may act on', async () => {
    const res = await bulk(ID.opsOnly, [ID.bMoney, ID.bPlain]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ succeeded: 1, failed: 1, total: 2 });
    expect(await statusOf(ID.bMoney)).toBe('pending');
    expect(await statusOf(ID.bPlain)).toBe('approved');
  });
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: the action queue (GET actions/businesses/:b/queue)', () => {
  it('QUEUE-01: the member is handed their own pending items only within their sight', async () => {
    const res = await queue(ID.opsOnly);
    expect(res.status).toBe(200);
    const pending = (res.body.items ?? res.body.queue ?? res.body ?? []) as any[];
    const all = JSON.stringify(res.body);
    expect(all).toContain(ID.iPlain);
    expect(all).not.toContain(ID.iMoney);
    expect(all).not.toContain('4,000');
    expect(all).not.toContain('landlord');
    expect(Array.isArray(pending) || typeof pending === 'object').toBe(true);
  });

  it('QUEUE-02: owner parity: the OWNER is handed the money item', async () => {
    const res = await queue(ID.owner);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(ID.iMoney);
  });
});

describe('FU-AI-APPROVALS-MONEY-SIGHT: the approver notification (createApprovalItem -> notifyApprover)', () => {
  async function notifiedFor(approverUserId: string, membershipId: string) {
    routeFor = async () => ({
      approverAssignmentId: null, approverMembershipId: membershipId, approverUserId, displayName: 'x', channel: 'email',
      contactPhone: null, contactEmail: `${approverUserId}@test.local`, method: 'delegation_rule', reason: 'v72a',
    });
    const before = notified.length;
    const item = await oversight.createApprovalItem(ID.bizA, { ...MONEY, toolName: 'crm_add_note' });
    for (let i = 0; i < 100 && notified.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    expect(notified.length).toBe(before + 1);
    return { item, sent: notified[notified.length - 1].item };
  }

  it('NOTIFY-01: an approver without revenue read is sent no figure and no title', async () => {
    const { sent } = await notifiedFor(ID.opsOnly, `${P}m_opsOnly_bizA`);
    const text = JSON.stringify(sent);
    expect(text).not.toContain('4,000');
    expect(text).not.toContain('Acme');
  });

  it('NOTIFY-02: an approver with the sight is sent the item as before', async () => {
    const { sent } = await notifiedFor(ID.revRead, `${P}m_revRead_bizA`);
    expect(sent.title).toBe(MONEY.title);
    expect(sent.description).toBe(MONEY.description);
  });
});
