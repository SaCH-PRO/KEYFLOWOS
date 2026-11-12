/**
 * V1-84 (FOLLOW3-D4-CALL-LOG-VIS): call-log routes apply the caller's CRM record
 * visibility through the call log's contact, and a call log's caller is a member
 * of the business (REAL database).
 *
 * V1-54 review ST-2 handed this off: CallTaskController runs AuthGuard,
 * BusinessGuard, RateLimitGuard and ModuleScopeGuard at crm read or write and
 * nothing else, so a member whom GET contacts/:contactId refuses (404) for
 * another member's PRIVATE contact (V1-08) still listed, opened, edited,
 * completed, followed up, deleted and scripted the call logs on that contact,
 * and created new ones on it through POST calls and from-next-action. The rule
 * applied now is V1-08's (resolveCrmAccess + visibilityClause, through
 * CallLog.contactId): a call log on a contact the member may not open answers
 * as an unknown call log, a list leaves it out, and a write naming such a
 * contact answers as an unknown contact. A call log with no contact is the
 * business's, as before.
 *
 * V1-54 review ST-4: CallLogService.createCallLog stored any callerId, and the
 * KEY tool call_create_task hands it the model's args.callerId. It now refuses
 * a callerId that is not a member user of the business, in the service, so the
 * KEY path is covered without flow-orchestrator.service.ts (V1-43's write set).
 *
 * Nothing on the authorization boundary is mocked: PrismaService, the user,
 * business, membership, contact, share and call-log rows, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, RateLimitGuard (real Redis at REDIS_URL),
 * CallTaskController and CallLogService are real against DATABASE_URL. The
 * stand-ins: identity attachment (a test middleware loads the seeded user named
 * by `x-test-user` and attaches `{ id, email, role }`, as AuthMiddleware does
 * after token verification), the event emitter (a recorder) and
 * CallScriptService (a recorder: the real one calls an AI provider).
 * CallTaskController's constructor carries no @Inject and vitest emits no
 * decorator metadata, so the module's real CallLogService and the recorder are
 * handed to it after compile, as crm.e2e.test.ts does.
 *
 * Fixtures: prefix `v84d_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84d_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staffOwned: `${P}staffOwned`, // STAFF of bizA: crm write, crm_view 'owned' (my book)
  staffAll: `${P}staffAll`, // STAFF of bizA: crm write (view-all default)
  ownerB: `${P}ownerB`, // OWNER of bizB only
  superA: `${P}superA`, // SUPER_ADMIN, no membership in bizA (review ST-1/CR-1)
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`, // PRIVATE, owned by owner, next action: call
  cTeam: `${P}cTeam`, // TEAM, owned by owner, next action: call
  cMine: `${P}cMine`, // TEAM, owned by staffOwned
  cShared: `${P}cShared`, // PRIVATE, owned by owner, shared with staffOwned
  clPriv: `${P}clPriv`, // on cPriv, scheduled today
  clTeam: `${P}clTeam`, // on cTeam, scheduled today
  clNone: `${P}clNone`, // no contact, scheduled today
  clMine: `${P}clMine`, // on cMine
  clShared: `${P}clShared`, // on cShared
};
const SECRET = 'v84d-private-call-notes-5e1c';
const HIDDEN_FROM_OWNED = [ID.clPriv, ID.clTeam];

let db: any;
let app: any;
let redis: any;
let callLogs: any; // the module's real CallLogService
let prismaSvc: any; // the module's real PrismaService (the KEY dispatcher's, CL-05, CL-06)
let scriptsStub: any; // the CallScriptService recorder (the KEY dispatcher's too, CL-05)
const emitted: Array<[string, any]> = [];
const scriptCalls: Array<[string, string, string]> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM call_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`rate_limit:*:${ID.bizA}:*`);
  if (keys.length) await redis.del(...keys);
}

function as(actor: string) {
  const agent = request(app.getHttpServer());
  const withUser = (r: any) => r.set('x-test-user', actor);
  return {
    get: (url: string) => withUser(agent.get(url)),
    post: (url: string, body: Record<string, unknown> = {}) => withUser(agent.post(url)).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => withUser(agent.patch(url)).send(body),
    delete: (url: string) => withUser(agent.delete(url)),
  };
}

const calls = `/businesses/${P}bizA/calls`;

function today(hour = 12) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** A fresh open call log on `contactId` (or none), so a write case owns its row. */
async function freshCall(tag: string, contactId: string | null) {
  return db.callLog.create({
    data: { id: `${P}${tag}`, businessId: ID.bizA, contactId, callerId: ID.owner, notes: 'before', evidenceIds: [] },
  });
}

/** The parts of an error body that do not vary per request (timestamp, path, correlation id). */
function errorShape(body: any) {
  return { statusCode: body?.statusCode, code: body?.code, message: body?.message, error: body?.error };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { CallTaskController } = await import('../src/modules/call-tasks/call-task.controller');
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  const { CallScriptService } = await import('../src/modules/call-tasks/call-script.service');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const emitter = { emit: (name: string, payload: any) => { emitted.push([name, payload]); return true; } };
  const scripts = {
    generateScript: async (businessId: string, callId: string, contactId: string) => {
      scriptCalls.push([businessId, callId, contactId]);
      return { greeting: 'v84d-script', talkingPoints: [], ask: '', close: '', durationEstimate: 1 };
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [CallTaskController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      CallLogService,
      { provide: EventEmitter2, useValue: emitter },
      { provide: CallScriptService, useValue: scripts },
    ],
  }).compile();

  callLogs = moduleRef.get(CallLogService);
  prismaSvc = moduleRef.get(PrismaService);
  scriptsStub = scripts;
  const controller = moduleRef.get(CallTaskController) as any;
  controller.callLogs = callLogs;
  controller.callScripts = scripts;

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
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

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffOwned, email: `${P}staffOwned@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffAll, email: `${P}staffAll@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.superA, email: `${P}superA@test.local`, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V84D Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84D Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_staffOwned`, userId: ID.staffOwned, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned' } },
  });
  await db.membership.create({
    data: { id: `${P}m_staffAll`, userId: ID.staffAll, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  const due = new Date(Date.now() + 60 * 60 * 1000);
  const contact = (id: string, visibility: string, ownerId: string) =>
    db.contact.create({ data: { id, businessId: ID.bizA, firstName: 'V84D', lastName: id.slice(P.length), visibility, ownerId, nextActionType: 'call', nextActionAt: due } });
  await contact(ID.cPriv, 'PRIVATE', ID.owner);
  await contact(ID.cTeam, 'TEAM', ID.owner);
  await contact(ID.cMine, 'TEAM', ID.staffOwned);
  await contact(ID.cShared, 'PRIVATE', ID.owner);
  await db.contactShare.create({ data: { id: `${P}share`, businessId: ID.bizA, contactId: ID.cShared, userId: ID.staffOwned, createdBy: ID.owner } });

  const seeded = (id: string, contactId: string | null, extra: Record<string, unknown> = {}) =>
    db.callLog.create({ data: { id, businessId: ID.bizA, contactId, callerId: ID.owner, evidenceIds: [], ...extra } });
  await seeded(ID.clPriv, ID.cPriv, { notes: SECRET, script: SECRET, scheduledAt: today() });
  await seeded(ID.clTeam, ID.cTeam, { notes: 'team notes', scheduledAt: today() });
  await seeded(ID.clNone, null, { notes: 'contactless notes', scheduledAt: today() });
  await seeded(ID.clMine, ID.cMine, { notes: 'mine notes' });
  await seeded(ID.clShared, ID.cShared, { notes: 'shared notes' });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (redis) {
    await clearRateLimits().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
  if (app) await app.close();
});

beforeEach(() => {
  emitted.length = 0;
  scriptCalls.length = 0;
});

describe('CL-01 call-log reads leave out the call logs on contacts the member cannot open', () => {
  it("CL-01a GET calls: a crm_view 'owned' member's list has no call log on the owner's PRIVATE or TEAM contact, keeps their own, shared and contactless ones, and its total agrees", async () => {
    const res = await as(ID.staffOwned).get(calls).expect(200);
    const ids = res.body.items.map((c: any) => c.id);
    for (const hidden of HIDDEN_FROM_OWNED) expect(ids, hidden).not.toContain(hidden);
    for (const shown of [ID.clMine, ID.clShared, ID.clNone]) expect(ids, shown).toContain(shown);
    expect(res.body.total).toBe(res.body.items.length);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("CL-01b GET calls: a view-all member's list has no call log on another member's PRIVATE contact and keeps the TEAM and contactless ones", async () => {
    const res = await as(ID.staffAll).get(calls).expect(200);
    const ids = res.body.items.map((c: any) => c.id);
    expect(ids).not.toContain(ID.clPriv);
    expect(ids).not.toContain(ID.clShared); // PRIVATE, shared with staffOwned only
    for (const shown of [ID.clTeam, ID.clNone, ID.clMine]) expect(ids, shown).toContain(shown);
    expect(res.body.total).toBe(res.body.items.length);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('CL-01c GET calls?contactId= naming a hidden contact lists nothing', async () => {
    const res = await as(ID.staffOwned).get(`${calls}?contactId=${ID.cPriv}`).expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('CL-01d GET calls/:id on a hidden call log answers exactly as an unknown id, with no notes', async () => {
    const unknown = await as(ID.staffOwned).get(`${calls}/${P}nosuch`);
    expect(unknown.status).toBe(404);
    for (const [actor, id] of [[ID.staffOwned, ID.clPriv], [ID.staffOwned, ID.clTeam], [ID.staffAll, ID.clPriv]] as const) {
      const res = await as(actor).get(`${calls}/${id}`);
      expect(res.status, `${actor} ${id}`).toBe(404);
      expect(errorShape(res.body), `${actor} ${id}`).toEqual(errorShape(unknown.body));
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
  });

  it('CL-01e GET calls/scheduled/today leaves out the hidden call log, also when filtered by its caller', async () => {
    for (const url of [`${calls}/scheduled/today`, `${calls}/scheduled/today?callerId=${ID.owner}`]) {
      const res = await as(ID.staffAll).get(url).expect(200);
      const ids = res.body.map((c: any) => c.id);
      expect(ids, url).not.toContain(ID.clPriv);
      expect(ids, url).toEqual(expect.arrayContaining([ID.clTeam, ID.clNone]));
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
  });

  it('CL-01f POST calls/:id/generate-script on a hidden call log answers 404 and never reaches the script service', async () => {
    const res = await as(ID.staffAll).post(`${calls}/${ID.clPriv}/generate-script`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Call log not found');
    expect(scriptCalls).toEqual([]);
  });
});

describe('CL-02 call-log writes cannot reach a contact the member cannot open', () => {
  it('CL-02a PATCH, complete, follow-up and DELETE on a hidden call log answer 404 and leave the row unchanged, with no task and no event', async () => {
    for (const actor of [ID.staffOwned, ID.staffAll]) {
      const row = await freshCall(`w_${actor.slice(P.length)}`, ID.cPriv);
      const before = await db.callLog.findUnique({ where: { id: row.id } });
      const responses = [
        await as(actor).patch(`${calls}/${row.id}`, { notes: 'edited' }),
        await as(actor).post(`${calls}/${row.id}/complete`, { outcome: 'reached' }),
        await as(actor).post(`${calls}/${row.id}/follow-up`, { title: 'v84d follow up' }),
        await as(actor).delete(`${calls}/${row.id}`),
      ];
      expect(responses.map((r) => r.status), actor).toEqual([404, 404, 404, 404]);
      for (const r of responses) expect(r.body.message).toBe('Call log not found');
      expect(await db.callLog.findUnique({ where: { id: row.id } }), actor).toEqual(before);
      expect(await db.contactTask.count({ where: { callLogId: row.id } })).toBe(0);
      expect(emitted, actor).toEqual([]);
    }
  });

  it('CL-02b PATCH cannot move a visible call log onto a hidden contact', async () => {
    const row = await freshCall('move', null);
    const before = await db.callLog.findUnique({ where: { id: row.id } });
    const res = await as(ID.staffAll).patch(`${calls}/${row.id}`, { contactId: ID.cPriv });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(await db.callLog.findUnique({ where: { id: row.id } })).toEqual(before);
    expect(emitted).toEqual([]);
  });

  it('CL-02c POST calls naming a hidden contact answers 404 and writes no call log', async () => {
    const marker = `${P}post_hidden`;
    for (const actor of [ID.staffOwned, ID.staffAll]) {
      const res = await as(actor).post(calls, { businessId: ID.bizA, contactId: ID.cPriv, callerId: actor, notes: marker });
      expect(res.status, actor).toBe(404);
      expect(res.body.message).toBe('Contact not found');
    }
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('CL-02d POST contacts/:contactId/calls/from-next-action on a hidden contact answers 404 and writes no call log', async () => {
    const before = await db.callLog.count({ where: { contactId: ID.cPriv } });
    for (const actor of [ID.staffOwned, ID.staffAll]) {
      const res = await as(actor).post(`/businesses/${ID.bizA}/contacts/${ID.cPriv}/calls/from-next-action`, { autoGenerateScript: true });
      expect(res.status, actor).toBe(404);
      expect(res.body.message).toBe('Contact not found');
    }
    expect(await db.callLog.count({ where: { contactId: ID.cPriv } })).toBe(before);
    expect(scriptCalls).toEqual([]);
    expect(emitted).toEqual([]);
  });
});

describe('CL-03 a call log names a member of its business as its caller (the KEY call_create_task path)', () => {
  // The arguments FlowOrchestratorService hands createCallLog for call_create_task,
  // with the model-chosen callerId.
  const keyShape = (callerId: string) => ({
    businessId: ID.bizA,
    contactId: ID.cTeam,
    callerId,
    scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    script: null,
    notes: null,
  });

  it('CL-03a a callerId that is not a member user of the business is refused and no call log is written', async () => {
    for (const callerId of ['not_a_member', ID.ownerB]) {
      await expect(callLogs.createCallLog(keyShape(callerId)), callerId).rejects.toMatchObject({ status: 400 });
      expect(await db.callLog.count({ where: { callerId } }), callerId).toBe(0);
    }
    expect(emitted).toEqual([]);
  });

  it('CL-03b CONTROL: a member callerId is stored', async () => {
    const log = await callLogs.createCallLog(keyShape(ID.staffAll));
    const row = await db.callLog.findUnique({ where: { id: log.id } });
    expect(row).toMatchObject({ businessId: ID.bizA, contactId: ID.cTeam, callerId: ID.staffAll });
    expect(emitted.map(([name]) => name)).toEqual(['call_log.created']);
  });

  // Review ST-1 / CR-1: the member check ran in createCallLog only. createFromContactNextAction
  // stored any callerId, so a SUPER_ADMIN who is not a member was refused on POST calls but
  // stored as the caller through from-next-action. Over HTTP the refusal answered 400 naming a
  // body callerId the controller ignores; the session member is the caller there, so it is the
  // actor's refusal (403).
  it('CL-03c a non-member SUPER_ADMIN session is refused 403 as the caller on POST calls and from-next-action, and no call log is written', async () => {
    const responses = [
      await as(ID.superA).post(calls, { businessId: ID.bizA, contactId: ID.cTeam, callerId: ID.owner }),
      await as(ID.superA).post(`/businesses/${ID.bizA}/contacts/${ID.cTeam}/calls/from-next-action`, { autoGenerateScript: true }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Only a member of this business can be the caller of a call log');
    }
    expect(await db.callLog.count({ where: { callerId: ID.superA } })).toBe(0);
    expect(scriptCalls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('CL-03d createFromContactNextAction refuses a callerId that is not a member user of the business, and writes nothing', async () => {
    for (const callerId of ['not_a_member', ID.ownerB, ID.superA]) {
      await expect(callLogs.createFromContactNextAction(ID.bizA, ID.cTeam, callerId), callerId).rejects.toMatchObject({
        status: 400,
        message: 'callerId must belong to a member of this business',
      });
      expect(await db.callLog.count({ where: { callerId } }), callerId).toBe(0);
    }
    expect(emitted).toEqual([]);
  });
});

/**
 * Review CR-2 ruling: being a call log's caller grants no visibility of its contact. The V1-08
 * rule through CallLog.contactId stays the only rule (no caller exception, which would open the
 * contact's script, follow-up tasks and outcome to a member the contact's owner hid it from).
 * Instead no writer may assign a call to a member on a contact that member cannot open: the KEY
 * call_create_task path (createCallLog with a model-chosen callerId) and createFromContactNextAction
 * now refuse it. A call whose contact is hidden from its caller afterwards (the owner makes it
 * PRIVATE, the member's crm_view changes) is a documented dead-end for that caller: the OWNER and
 * the members who may open the contact still see and complete it.
 */
describe('CL-04 a call is assigned only to a member who may open its contact (review CR-2)', () => {
  const keyShape = (callerId: string, contactId: string) => ({
    businessId: ID.bizA,
    contactId,
    callerId,
    scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    script: null,
    notes: null,
  });

  it('CL-04a KEY call_create_task (createCallLog) refuses a member caller on a contact they cannot open, and writes nothing', async () => {
    for (const [callerId, contactId] of [[ID.staffOwned, ID.cTeam], [ID.staffOwned, ID.cPriv], [ID.staffAll, ID.cPriv], [ID.staffAll, ID.cShared]] as const) {
      await expect(callLogs.createCallLog(keyShape(callerId, contactId)), `${callerId} ${contactId}`).rejects.toMatchObject({
        status: 400,
        message: 'callerId must be a member who may open this contact',
      });
      expect(await db.callLog.count({ where: { callerId, contactId } }), `${callerId} ${contactId}`).toBe(0);
    }
    expect(emitted).toEqual([]);
  });

  it('CL-04b createFromContactNextAction refuses a member caller on a contact they cannot open, and writes nothing', async () => {
    for (const [callerId, contactId] of [[ID.staffOwned, ID.cTeam], [ID.staffAll, ID.cPriv]] as const) {
      await expect(callLogs.createFromContactNextAction(ID.bizA, contactId, callerId), `${callerId} ${contactId}`).rejects.toMatchObject({
        status: 400,
        message: 'callerId must be a member who may open this contact',
      });
      expect(await db.callLog.count({ where: { callerId, contactId } }), `${callerId} ${contactId}`).toBe(0);
    }
    expect(emitted).toEqual([]);
  });

  it('CL-04c CONTROL: a member caller on a contact they may open is stored (own, shared, contactless; OWNER on PRIVATE)', async () => {
    const stored = [
      await callLogs.createCallLog(keyShape(ID.staffOwned, ID.cMine)),
      await callLogs.createCallLog(keyShape(ID.staffOwned, ID.cShared)),
      await callLogs.createCallLog({ ...keyShape(ID.staffOwned, ID.cMine), contactId: undefined }),
      await callLogs.createCallLog(keyShape(ID.owner, ID.cPriv)),
      await callLogs.createFromContactNextAction(ID.bizA, ID.cMine, ID.staffOwned),
    ];
    expect(stored.map((l: any) => [l.callerId, l.contactId])).toEqual([
      [ID.staffOwned, ID.cMine],
      [ID.staffOwned, ID.cShared],
      [ID.staffOwned, null],
      [ID.owner, ID.cPriv],
      [ID.staffOwned, ID.cMine],
    ]);
  });

  it('CL-04d RULING: a call whose contact is made PRIVATE after it was assigned leaves its caller\'s view; the OWNER still opens and completes it', async () => {
    const cFlip = `${P}cFlip`;
    await db.contact.create({ data: { id: cFlip, businessId: ID.bizA, firstName: 'V84D', lastName: 'flip', visibility: 'TEAM', ownerId: ID.owner } });
    const clFlip = await db.callLog.create({
      data: { id: `${P}clFlip`, businessId: ID.bizA, contactId: cFlip, callerId: ID.staffAll, scheduledAt: today(13), notes: 'assigned', evidenceIds: [] },
    });
    await as(ID.staffAll).get(`${calls}/${clFlip.id}`).expect(200);

    await db.contact.update({ where: { id: cFlip }, data: { visibility: 'PRIVATE' } });

    await as(ID.staffAll).get(`${calls}/${clFlip.id}`).expect(404);
    await as(ID.staffAll).post(`${calls}/${clFlip.id}/complete`, { outcome: 'reached' }).expect(404);
    const mine = await as(ID.staffAll).get(`${calls}?callerId=${ID.staffAll}`).expect(200);
    expect(mine.body.items.map((c: any) => c.id)).not.toContain(clFlip.id);
    const day = await as(ID.staffAll).get(`${calls}/scheduled/today?callerId=${ID.staffAll}`).expect(200);
    expect(day.body.map((c: any) => c.id)).not.toContain(clFlip.id);

    await as(ID.owner).get(`${calls}/${clFlip.id}`).expect(200);
    await as(ID.owner).post(`${calls}/${clFlip.id}/complete`, { outcome: 'reached' }).expect(201);
  });

  /**
   * W9-CALL-LOG-DEADEND (review CR-2 dead-end, under the CR-2 ruling above): ChaserService's
   * 'unlogged_call' notice and CapacityInsightService's 'unlogged_calls' alert told a caller to log
   * the outcome of a call log whose contact they can no longer open, a call log every call-log route
   * answers them 404 for (CL-04d). Both now leave out the call logs whose contact the caller may not
   * open by the V1-08 rule the call-log routes apply through CallLog.contactId. A contactless call
   * log stays the business's, as on the routes, for a caller the routes admit (CL-04h, CL-04i: a
   * caller who is not a member, or whose crm level is below write, is chased for none).
   * The real services run over this suite's real PrismaService; the event emitter is a recorder and
   * the workload aggregator reports nobody overloaded.
   */
  const staleAt = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // >24h ago: unlogged
  const STALE = {
    // a contact the caller may not open
    privAll: `${P}stale_privAll`, // owner's PRIVATE contact, view-all caller
    teamOwned: `${P}stale_teamOwned`, // owner's TEAM contact, crm_view 'owned' caller
    sharedAll: `${P}stale_sharedAll`, // PRIVATE shared with staffOwned only, view-all caller
    gone: `${P}stale_gone`, // TEAM contact, caller no longer a member of bizA (bizB's owner)
    // a contact the caller may open (CONTROL)
    privOwner: `${P}stale_privOwner`,
    mineOwned: `${P}stale_mineOwned`,
    sharedOwned: `${P}stale_sharedOwned`,
    teamAll: `${P}stale_teamAll`,
    noneAll: `${P}stale_noneAll`,
  };
  const HIDDEN_FROM_CALLER = [STALE.privAll, STALE.teamOwned, STALE.sharedAll, STALE.gone];
  const OPEN_TO_CALLER: Array<[string, string]> = [
    [STALE.privOwner, ID.owner],
    [STALE.mineOwned, ID.staffOwned],
    [STALE.sharedOwned, ID.staffOwned],
    [STALE.teamAll, ID.staffAll],
    [STALE.noneAll, ID.staffAll],
  ];
  let staleSeeded = false;

  async function seedStale() {
    if (staleSeeded) return;
    const rows: Array<[string, string | null, string]> = [
      [STALE.privAll, ID.cPriv, ID.staffAll],
      [STALE.teamOwned, ID.cTeam, ID.staffOwned],
      [STALE.sharedAll, ID.cShared, ID.staffAll],
      [STALE.gone, ID.cTeam, ID.ownerB],
      [STALE.privOwner, ID.cPriv, ID.owner],
      [STALE.mineOwned, ID.cMine, ID.staffOwned],
      [STALE.sharedOwned, ID.cShared, ID.staffOwned],
      [STALE.teamAll, ID.cTeam, ID.staffAll],
      [STALE.noneAll, null, ID.staffAll],
    ];
    // Written directly: these are rows assigned before the contact was hidden from the caller (or
    // before the caller left), which the writers' caller check (CL-04a/b) no longer lets in.
    for (const [id, contactId, callerId] of rows) {
      await db.callLog.create({ data: { id, businessId: ID.bizA, contactId, callerId, scheduledAt: staleAt(), notes: 'unlogged', evidenceIds: [] } });
    }
    staleSeeded = true;
  }

  async function chaser() {
    const { ChaserService } = await import('../src/modules/ai/chaser.service');
    const events: Array<[string, any]> = [];
    const svc = new ChaserService(prismaSvc, { emit: (name: string, payload: any) => { events.push([name, payload]); return true; } } as any);
    return { svc, events };
  }

  async function capacity() {
    const { CapacityInsightService } = await import('../src/modules/ai/capacity-insight.service');
    const events: Array<[string, any]> = [];
    const workload = { getWorkloadForBusiness: async () => ({ overloaded: [] }) };
    const svc = new CapacityInsightService(
      prismaSvc,
      workload as any,
      { emit: (name: string, payload: any) => { events.push([name, payload]); return true; } } as any,
    );
    return { svc, events };
  }

  const ours = (ids: string[]) => ids.filter((id) => id.startsWith(`${P}stale_`));

  it("CL-04e chaser.service.ts no longer tells a caller to log the outcome of a call log whose contact they can no longer open (review CR-2 dead-end; W9-CALL-LOG-DEADEND, was it.todo)", async () => {
    await seedStale();
    const { svc, events } = await chaser();
    const notices = (await svc.chaseBusiness(ID.bizA)).filter((n: any) => n.type === 'unlogged_call');
    const chased = notices.filter((n: any) => ours([n.entityId]).length > 0);
    for (const hidden of HIDDEN_FROM_CALLER) {
      expect(chased.map((n: any) => n.entityId), hidden).not.toContain(hidden);
    }
    // CONTROL: the calls whose contact the caller may open are chased, to that caller
    expect(chased.map((n: any) => [n.entityId, n.recipientUserId]).sort()).toEqual([...OPEN_TO_CALLER].sort());
    const emittedIds = events.filter(([name, n]) => name === 'manager.chase_notice' && n.type === 'unlogged_call').map(([, n]) => n.entityId);
    for (const hidden of HIDDEN_FROM_CALLER) expect(emittedIds, hidden).not.toContain(hidden);
  });

  it("CL-04f capacity-insight.service.ts no longer counts or tells anyone to remind a caller to log the outcome of a call log whose contact the caller can no longer open (review CR-2 dead-end; W9-CALL-LOG-DEADEND, was it.todo)", async () => {
    await seedStale();
    const { svc } = await capacity();
    const alerts = (await svc.scanBusiness(ID.bizA)).filter((a: any) => a.type === 'unlogged_calls');
    const flagged = alerts.filter((a: any) => ours(a.affectedEntityIds).length > 0);
    const flaggedIds = flagged.flatMap((a: any) => a.affectedEntityIds);
    for (const hidden of HIDDEN_FROM_CALLER) expect(flaggedIds, hidden).not.toContain(hidden);
    // CONTROL: the calls whose contact the caller may open are still flagged, naming that caller
    expect(flagged.map((a: any) => [a.affectedEntityIds[0], a.affectedUserIds[0]]).sort()).toEqual([...OPEN_TO_CALLER].sort());
  });

  it('CL-04g RULING (review CR-2): a call whose contact is made PRIVATE after it was assigned stops being chased and flagged for its caller; while the caller may open it, it is chased (W9-CALL-LOG-DEADEND)', async () => {
    const cFlip = `${P}cFlip2`;
    const clFlip = `${P}flip2_call`;
    await db.contact.create({ data: { id: cFlip, businessId: ID.bizA, firstName: 'V84D', lastName: 'flip2', visibility: 'TEAM', ownerId: ID.owner } });
    await db.callLog.create({
      data: { id: clFlip, businessId: ID.bizA, contactId: cFlip, callerId: ID.staffAll, scheduledAt: staleAt(), notes: 'assigned', evidenceIds: [] },
    });
    const chasedIds = async () => ((await (await chaser()).svc.chaseBusiness(ID.bizA)) as any[])
      .filter((n) => n.type === 'unlogged_call' && n.entityId === clFlip)
      .map((n) => n.recipientUserId);
    const flaggedIds = async () => ((await (await capacity()).svc.scanBusiness(ID.bizA)) as any[])
      .filter((a) => a.type === 'unlogged_calls' && a.affectedEntityIds.includes(clFlip))
      .map((a) => a.affectedUserIds[0]);

    expect(await chasedIds()).toEqual([ID.staffAll]);
    expect(await flaggedIds()).toEqual([ID.staffAll]);

    await db.contact.update({ where: { id: cFlip }, data: { visibility: 'PRIVATE' } });
    await as(ID.staffAll).get(`${calls}/${clFlip}`).expect(404); // the dead-end the prompt pointed at

    expect(await chasedIds()).toEqual([]);
    expect(await flaggedIds()).toEqual([]);
  });

  /**
   * W9-CALL-LOG-DEADEND review repairs (SEC-W9CLD-1/CR-W9CLD-1, SEC-W9CLD-2/CR-W9CLD-2), under the
   * same CR-2 ruling: the chase is for the caller exactly as the call-log routes answer that caller.
   * Two refusals came before the contact rule and were not applied: a caller who is not a member of
   * the business (or a callerId that names no user, the legacy staff-member id) is refused 403 by
   * every call-log route, contactless call logs included; and ModuleScopeGuard refuses POST
   * calls/:id/complete, the outcome the notice asks for, to a member whose crm level, as the guard
   * computes it (an explicit scope map's crm key, a missing key being 'none'; otherwise the role
   * default), is below write. Rows here use a `dead_` id so CL-04e/f's exact `stale_` lists are
   * untouched.
   */
  const DEAD = {
    member: (tag: string) => `${P}dead_${tag}`,
    contact: (tag: string) => `${P}cDead_${tag}`,
  };

  async function chasedAndFlagged(ids: string[]) {
    const notices = ((await (await chaser()).svc.chaseBusiness(ID.bizA)) as any[])
      .filter((n) => n.type === 'unlogged_call' && ids.includes(n.entityId));
    const alerts = ((await (await capacity()).svc.scanBusiness(ID.bizA)) as any[])
      .filter((a) => a.type === 'unlogged_calls' && a.affectedEntityIds.some((id: string) => ids.includes(id)));
    return {
      chased: notices.map((n) => [n.entityId, n.recipientUserId]).sort(),
      flagged: alerts.map((a) => [a.affectedEntityIds[0], a.affectedUserIds[0]]).sort(),
    };
  }

  it('CL-04h RULING (review CR-2; SEC-W9CLD-1, CR-W9CLD-1): a caller who is not a member of the business, or a callerId that names no user, is not chased or flagged for a contactless call log either; every call-log route answers that caller 403 (W9-CALL-LOG-DEADEND)', async () => {
    await clearRateLimits();
    const goneNone = `${P}dead_goneNone`; // contactless, caller is bizB's owner only
    const staffRecord = `${P}dead_staffRecord`; // contactless, callerId a legacy staff-member id
    const ctlNone = `${P}dead_ctlNone`; // CONTROL: contactless, a crm write member of bizA
    for (const [id, callerId] of [[goneNone, ID.ownerB], [staffRecord, `${P}staffMemberRecord`], [ctlNone, ID.staffAll]]) {
      await db.callLog.create({ data: { id, businessId: ID.bizA, contactId: null, callerId, scheduledAt: staleAt(), notes: 'unlogged', evidenceIds: [] } });
    }

    const { chased, flagged } = await chasedAndFlagged([goneNone, staffRecord, ctlNone]);
    expect(chased).toEqual([[ctlNone, ID.staffAll]]);
    expect(flagged).toEqual([[ctlNone, ID.staffAll]]);

    // the dead-end the prompt pointed at: the non-member caller opens and completes nothing here
    await as(ID.ownerB).get(`${calls}/${goneNone}`).expect(403);
    await as(ID.ownerB).post(`${calls}/${goneNone}/complete`, { outcome: 'reached' }).expect(403);
    expect((await db.callLog.findUnique({ where: { id: goneNone } })).completedAt).toBeNull();
    await clearRateLimits();
  });

  it("CL-04i RULING (review CR-2; SEC-W9CLD-2, CR-W9CLD-2): a caller whose crm level is below write as ModuleScopeGuard computes it (crm 'none', an explicit scope map with no crm key, crm 'read', the STAFF role default) is not chased or flagged for a call log on their own contact or a contactless one; POST complete answers them 403, and a crm write member is still chased (W9-CALL-LOG-DEADEND)", async () => {
    await clearRateLimits();
    const below: Array<[string, Record<string, string> | null, number]> = [
      // [tag, permissionScopes, what GET calls/:id answers them]
      ['none', { crm: 'none' }, 403],
      ['nokey', { operations: 'write' }, 403],
      ['read', { crm: 'read' }, 200],
      ['dflt', null, 200],
    ];
    const ids: string[] = [];
    for (const [tag, permissionScopes] of below) {
      const userId = DEAD.member(tag);
      await db.user.create({ data: { id: userId, email: `${P}dead_${tag}@test.local`, role: 'USER' } });
      await db.membership.create({
        data: { id: `${P}m_dead_${tag}`, userId, businessId: ID.bizA, role: 'STAFF', ...(permissionScopes ? { permissionScopes } : {}) },
      });
      // a TEAM contact they own: their book, whatever their crm_view
      await db.contact.create({ data: { id: DEAD.contact(tag), businessId: ID.bizA, firstName: 'V84D', lastName: `dead ${tag}`, visibility: 'TEAM', ownerId: userId } });
      for (const [suffix, contactId] of [['own', DEAD.contact(tag)], ['none', null]] as const) {
        const id = `${P}dead_${tag}_${suffix}`;
        await db.callLog.create({ data: { id, businessId: ID.bizA, contactId, callerId: userId, scheduledAt: staleAt(), notes: 'unlogged', evidenceIds: [] } });
        ids.push(id);
      }
    }
    // CONTROL: a crm write member (staffAll) on a TEAM contact they may open and on no contact
    const ctl: Array<[string, string | null]> = [[`${P}dead_ctlWrite_team`, ID.cTeam], [`${P}dead_ctlWrite_none`, null]];
    for (const [id, contactId] of ctl) {
      await db.callLog.create({ data: { id, businessId: ID.bizA, contactId, callerId: ID.staffAll, scheduledAt: staleAt(), notes: 'unlogged', evidenceIds: [] } });
      ids.push(id);
    }

    const { chased, flagged } = await chasedAndFlagged(ids);
    const expected = ctl.map(([id]) => [id, ID.staffAll]).sort();
    expect(chased).toEqual(expected);
    expect(flagged).toEqual(expected);

    // the dead-end the prompt pointed at: each of them is refused the outcome it asks for
    for (const [tag, , getStatus] of below) {
      for (const suffix of ['own', 'none']) {
        const id = `${P}dead_${tag}_${suffix}`;
        await as(DEAD.member(tag)).get(`${calls}/${id}`).expect(getStatus);
        const res = await as(DEAD.member(tag)).post(`${calls}/${id}/complete`, { outcome: 'reached' });
        expect([res.status, res.body.message], `${tag} ${suffix}`).toEqual([
          403,
          `Insufficient permissions: crm requires write access (you have ${tag === 'read' || tag === 'dflt' ? 'read' : 'none'})`,
        ]);
        expect((await db.callLog.findUnique({ where: { id } })).completedAt, id).toBeNull();
      }
    }
    await clearRateLimits();
  });
});

// Review ST-2 (residual of V1-84): the KEY write tools reached the call logs and contacts the HTTP
// routes hide. call_log_outcome (completeCall), call_schedule_followup (createFollowUpTask) and
// call_generate_script ran with no acting member, and JobRolePolicyService grants them to non-OWNER
// crm:write holders (crm_view 'owned' included) while it withholds crm_update_contact from the same
// holders. W9-KEY-OBLIGATIONS-CALLS (owner rulings D-64, D-88: KEY acts as the member the command
// runs for): the dispatcher hands the call-log service that member as the viewer the routes take from
// the session, so a call log or contact the member may not open answers as an unknown one, exactly as
// the call-log routes answer that member. call_create_task already did (W7-CALL-TASK-CALLER, CL-06).
// A run with no member reads the business's call logs as before (no new authority rule here).

/**
 * KEY's dispatcher (FlowOrchestratorService.executeToolAction) over this suite's real PrismaService and CallLogService and the script recorder
 * (or `scripts`, a CallScriptService a case hands it: CL-05c's real one).
 */
async function keyDispatch(tool: string, args: Record<string, unknown>, action: Record<string, unknown>, scripts: unknown = scriptsStub) {
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  const { CallScriptService } = await import('../src/modules/call-tasks/call-script.service');
  const dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma: prismaSvc,
    moduleRef: { get: (token: unknown) => (token === CallLogService ? callLogs : token === CallScriptService ? scripts : undefined) },
  });
  return dispatcher.executeToolAction(ID.bizA, tool, args, action);
}

/** A KEY call's refusal as { status, message }, or null when the call resolved. */
const keyRefusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (err: any) => ({ status: typeof err?.getStatus === 'function' ? err.getStatus() : undefined, message: err?.message }),
  );

describe('CL-05 KEY call-log write tools (review ST-2, W9-KEY-OBLIGATIONS-CALLS)', () => {
  const unknownLog = `${P}noSuchCall`;
  const unknownContact = `${P}noSuchContact`;

  it("CL-05a KEY call_log_outcome, call_schedule_followup, call_generate_script and call_create_task apply the acting member's CRM record visibility: a call log or contact the member may not open answers exactly as an unknown one and as the call-log route answers that member, and nothing is written (D-64, D-88) (W9-KEY-OBLIGATIONS-CALLS, was it.todo)", async () => {
    const marker = `${P}key_cl05`;
    const cases: Array<[string, Record<string, unknown>, string]> = [
      // crm_view 'owned': the owner's PRIVATE and TEAM contacts are outside their book
      [ID.staffOwned, { surface: 'CHAT', principalUserId: ID.staffOwned }, ID.cPriv],
      [ID.staffOwned, { surface: 'CHAT', principalUserId: ID.staffOwned }, ID.cTeam],
      // view-all: another member's PRIVATE contact, also on a surface with no principal run for them
      [ID.staffAll, { surface: 'PROPOSAL', onBehalfOfUserId: ID.staffAll }, ID.cPriv],
      [ID.staffAll, { surface: 'CHAT', principalUserId: ID.staffAll }, ID.cShared],
    ];
    let n = 0;
    for (const [actor, action, contactId] of cases) {
      n += 1;
      const label = `${actor} ${String(action.surface)} ${contactId}`;
      const row = await freshCall(`k5_${n}`, contactId);
      const before = await db.callLog.findUnique({ where: { id: row.id } });

      // the call log's own tools: the hidden call log answers as an unknown call log, and as the route
      const onLog: Array<[string, Record<string, unknown>, (id: string) => Promise<any>]> = [
        ['call_log_outcome', { outcome: 'reached', notes: marker }, (id) => as(actor).post(`${calls}/${id}/complete`, { outcome: 'reached', notes: marker })],
        ['call_schedule_followup', { title: marker }, (id) => as(actor).post(`${calls}/${id}/follow-up`, { title: marker })],
        // cMine is a contact both members may open (staffOwned's own TEAM contact)
        ['call_generate_script', { contactId: ID.cMine }, (id) => as(actor).post(`${calls}/${id}/generate-script`)],
      ];
      for (const [tool, args, rest] of onLog) {
        const hidden = await keyRefusal(keyDispatch(tool, { ...args, callLogId: row.id }, action));
        const unknown = await keyRefusal(keyDispatch(tool, { ...args, callLogId: unknownLog }, action));
        expect(hidden, `${tool} ${label}`).toEqual({ status: 404, message: 'Call log not found' });
        expect(unknown, `${tool} ${label}`).toEqual(hidden);
        const res = await rest(row.id);
        expect([res.status, res.body.message], `${tool} ${label} route`).toEqual([hidden!.status, hidden!.message]);
      }

      // a script on a call log the member may open, for a contact they may not: as an unknown contact
      const hiddenContact = await keyRefusal(keyDispatch('call_generate_script', { callLogId: ID.clNone, contactId }, action));
      const unknownScript = await keyRefusal(keyDispatch('call_generate_script', { callLogId: ID.clNone, contactId: unknownContact }, action));
      expect(hiddenContact, `call_generate_script contact ${label}`).toEqual({ status: 404, message: 'Contact not found' });
      expect(unknownScript, `call_generate_script contact ${label}`).toEqual(hiddenContact);

      // call_create_task on the hidden contact: as an unknown contact (W7-CALL-TASK-CALLER, pinned here too)
      const create = await keyRefusal(keyDispatch('call_create_task', { contactId, notes: marker }, action));
      const createUnknown = await keyRefusal(keyDispatch('call_create_task', { contactId: unknownContact, notes: marker }, action));
      expect(create, `call_create_task ${label}`).toEqual({ status: 404, message: 'Contact not found' });
      expect(createUnknown, `call_create_task ${label}`).toEqual(create);

      expect(await db.callLog.findUnique({ where: { id: row.id } }), label).toEqual(before);
      expect(await db.contactTask.count({ where: { callLogId: row.id } }), label).toBe(0);
    }
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(0);
    expect(await db.contactTask.count({ where: { businessId: ID.bizA, title: marker } })).toBe(0);
    expect(scriptCalls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('CL-05b CONTROL: on call logs and contacts the member may open the KEY call-log tools complete, follow up and script as before, and the OWNER acts on a PRIVATE contact\'s call log (W9-KEY-OBLIGATIONS-CALLS)', async () => {
    const owned = { surface: 'CHAT', principalUserId: ID.staffOwned };
    const mine = await freshCall('k5_mine', ID.cMine);
    const shared = await freshCall('k5_shared', ID.cShared);
    const none = await freshCall('k5_none', null);
    const team = await freshCall('k5_team', ID.cTeam);
    const priv = await freshCall('k5_priv', ID.cPriv);

    const outcome = await keyDispatch('call_log_outcome', { callLogId: mine.id, outcome: 'reached' }, owned);
    expect(outcome).toMatchObject({ callLogId: mine.id, outcome: 'reached' });
    expect(await keyDispatch('call_log_outcome', { callLogId: none.id, outcome: 'no_answer' }, owned)).toMatchObject({ callLogId: none.id, outcome: 'no_answer' });
    const followUp = await keyDispatch('call_schedule_followup', { callLogId: shared.id, title: 'v84d key shared follow up' }, owned);
    expect(await db.contactTask.findUnique({ where: { id: followUp.taskId } })).toMatchObject({ contactId: ID.cShared, callLogId: shared.id });
    const script = await keyDispatch('call_generate_script', { callLogId: mine.id, contactId: ID.cMine }, owned);
    expect(script).toMatchObject({ callLogId: mine.id, greeting: 'v84d-script' });

    // a view-all member run for on a surface with no principal: the TEAM contact's call log
    const teamFollowUp = await keyDispatch('call_schedule_followup', { callLogId: team.id, title: 'v84d key team follow up' }, { surface: 'PROPOSAL', onBehalfOfUserId: ID.staffAll });
    expect(await db.contactTask.findUnique({ where: { id: teamFollowUp.taskId } })).toMatchObject({ contactId: ID.cTeam, callLogId: team.id });

    // the OWNER opens every contact
    expect(await keyDispatch('call_log_outcome', { callLogId: priv.id, outcome: 'reached' }, { surface: 'CHAT', principalUserId: ID.owner })).toMatchObject({ callLogId: priv.id, outcome: 'reached' });

    expect(scriptCalls).toEqual([[ID.bizA, mine.id, ID.cMine]]);
    expect(emitted.map(([name]) => name)).toEqual([
      'call_log.completed',
      'call_log.completed',
      'call_log.follow_up_created',
      'call_log.follow_up_created',
      'call_log.completed',
    ]);
    for (const id of [mine.id, none.id, priv.id]) expect((await db.callLog.findUnique({ where: { id } }))?.completedAt, id).not.toBeNull();
  });

  // Review SEC-W9KOC-1, SEC-W9KOC-2: an execute_custom_logic inner call reaches the dispatcher through
  // executeToolByName, which skips validateToolInput, so a snippet could leave contactId out or hand
  // a Prisma filter as callLogId / contactId. The member's check then passed on one row (a missing
  // contact is no check; findFirst answers the visible row a filter matches) while the service read or
  // wrote another (contact.findFirst with id undefined; completeCall's updateMany over the filter).
  it("CL-05c KEY call-log tools refuse a callLogId or contactId that is missing or not a string, before any lookup and in the chat path's validateToolInput words, so an execute_custom_logic inner call cannot pass the member's check on one row and script or complete another (review SEC-W9KOC-1, SEC-W9KOC-2; D-64, D-88) (W9-KEY-OBLIGATIONS-CALLS)", async () => {
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { CallScriptService } = await import('../src/modules/call-tasks/call-script.service');
    // the real CallScriptService over a model gateway that records each prompt, so a contact that
    // reached a prompt is seen (the recorder stands in for the service, not for its contact read)
    const prompts: string[] = [];
    const gateway = {
      complete: async (req: any) => {
        prompts.push(String(req.messages?.[1]?.content ?? ''));
        return { content: JSON.stringify({ greeting: 'v84d-real-script', talkingPoints: ['x'], ask: 'a', close: 'c', durationEstimate: 1 }) };
      },
    };
    const realScripts = new CallScriptService(prismaSvc, gateway as any);
    const marker = `${P}key_cl05c`;
    const visible = await freshCall('k5c_visible', ID.cMine); // staffOwned's own contact
    const hidden = await freshCall('k5c_hidden', ID.cPriv); // the owner's PRIVATE contact
    const none = await freshCall('k5c_none', null);
    const rows = [visible.id, hidden.id, none.id];
    const snapshot = () => db.callLog.findMany({ where: { id: { in: rows } }, orderBy: { id: 'asc' } });
    const before = await snapshot();

    /** What the chat path answers the same arguments (validateToolInput runs before executeToolAction there). */
    const chatAnswer = (tool: string, args: Record<string, unknown>) => {
      try {
        (Object.create(FlowOrchestratorService.prototype) as any).validateToolInput(tool, { ...args });
        return null;
      } catch (err: any) {
        return { status: undefined, message: err?.message };
      }
    };

    const filter = { in: [visible.id, hidden.id] };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      // SEC-W9KOC-1: no contactId was no contact check, and contact.findFirst({ id: undefined }) read any contact
      ['call_generate_script', { callLogId: none.id }, 'Missing required fields for call_generate_script: contactId'],
      // SEC-W9KOC-1: the visible contact passed the check, the hidden one reached the prompt
      ['call_generate_script', { callLogId: none.id, contactId: { in: [ID.cPriv, ID.cMine] } }, 'Field "contactId" for call_generate_script must be a string'],
      ['call_generate_script', { callLogId: filter, contactId: ID.cMine }, 'Field "callLogId" for call_generate_script must be a string'],
      // SEC-W9KOC-2: the visible call log passed the check, updateMany completed the hidden one too
      ['call_log_outcome', { callLogId: filter, outcome: 'reached', notes: marker }, 'Field "callLogId" for call_log_outcome must be a string'],
      ['call_log_outcome', { callLogId: { not: '' }, outcome: 'reached', notes: marker }, 'Field "callLogId" for call_log_outcome must be a string'],
      ['call_log_outcome', { outcome: 'reached', notes: marker }, 'Missing required fields for call_log_outcome: callLogId'],
      ['call_schedule_followup', { callLogId: filter, title: marker }, 'Field "callLogId" for call_schedule_followup must be a string'],
      ['call_schedule_followup', { title: marker }, 'Missing required fields for call_schedule_followup: callLogId'],
    ];
    const runs: Array<Record<string, unknown>> = [
      { surface: 'CUSTOM_LOGIC', onBehalfOfUserId: ID.staffOwned }, // staffOwned's snippet (crm_view 'owned'): the review's case
      { surface: 'CHAT', principalUserId: ID.staffOwned },
      { surface: 'CUSTOM_LOGIC', onBehalfOfUserId: null }, // a run with no member: the arguments are malformed there too
    ];
    for (const action of runs) {
      for (const [tool, args, message] of cases) {
        const label = `${tool} ${JSON.stringify(args)} ${JSON.stringify(action)}`;
        const refusal = await keyRefusal(keyDispatch(tool, args, action, realScripts));
        expect(refusal, label).toEqual({ status: undefined, message });
        expect(refusal, `${label} as the chat path`).toEqual(chatAnswer(tool, args));
      }
    }

    // nothing was scripted, completed or followed up, and no contact reached a model prompt
    expect(prompts).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await db.contactTask.count({ where: { callLogId: { in: rows } } })).toBe(0);
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(0);
    expect(emitted).toEqual([]);

    // CONTROL: string ids of rows the member may open run as before on the inner-call surface, and only
    // those rows: the script names the member's own contact, and the outcome completes that call log alone
    const snippet = { surface: 'CUSTOM_LOGIC', onBehalfOfUserId: ID.staffOwned };
    expect(await keyDispatch('call_generate_script', { callLogId: none.id, contactId: ID.cMine }, snippet, realScripts))
      .toMatchObject({ callLogId: none.id, greeting: 'v84d-real-script' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('V84D cMine');
    expect(prompts[0]).not.toContain('cPriv');
    expect(await keyDispatch('call_log_outcome', { callLogId: visible.id, outcome: 'reached', notes: marker }, snippet))
      .toMatchObject({ callLogId: visible.id, outcome: 'reached' });
    expect((await db.callLog.findUnique({ where: { id: visible.id } }))?.completedAt).not.toBeNull();
    expect(await db.callLog.findUnique({ where: { id: hidden.id } })).toEqual(before.find((r: any) => r.id === hidden.id));
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(1);
  });
});

/**
 * W7-CALL-TASK-CALLER review SEC-W7CTC-1 (owner rulings D-73, D-88; V1-54): KEY call_create_task
 * records the member the command runs for as the caller, so that member is the actor, as the session
 * member is on POST calls. The dispatcher used to hand createCallLog that member as a callerId another
 * writer chose (no session), so a member who may not open a contact got 400 'callerId must be a
 * member who may open this contact' for an existing hidden contact and 404 'Contact not found' for an
 * id that names no contact: KEY told a restricted member that a hidden contact exists, in words about
 * a callerId the model no longer controls. It now hands the member as the session (their User row's
 * role), and KEY answers what POST calls answers the same member. The real FlowOrchestratorService
 * dispatcher (executeToolAction) runs over this suite's real PrismaService and CallLogService.
 */
describe('CL-06 KEY call_create_task answers the member it runs for as POST calls answers them (review SEC-W7CTC-1, D-73, D-88)', () => {
  const unknownContact = `${P}doesNotExist`;

  async function keyCallCreateTask(action: Record<string, unknown>, contactId: string, marker: string) {
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
    const dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: prismaSvc,
      moduleRef: { get: (token: unknown) => (token === CallLogService ? callLogs : undefined) },
    });
    // the model names the OWNER as the caller: it is not read (W7-CALL-TASK-CALLER)
    return dispatcher.executeToolAction(ID.bizA, 'call_create_task', { contactId, callerId: ID.owner, notes: marker }, action);
  }

  /** The refusal as { status, message }, or null when the call resolved. */
  const refusalOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: any) => ({ status: typeof err?.getStatus === 'function' ? err.getStatus() : undefined, message: err?.message }),
    );

  it("CL-06a a member's KEY call_create_task on a contact they cannot open answers 404 'Contact not found' exactly as an unknown contact and as POST calls, and writes nothing", async () => {
    const marker = `${P}key_hidden`;
    const cases: Array<[string, Record<string, unknown>, string]> = [
      // crm_view 'owned': the owner's PRIVATE and TEAM contacts are outside their book
      [ID.staffOwned, { surface: 'CHAT', principalUserId: ID.staffOwned }, ID.cPriv],
      [ID.staffOwned, { surface: 'CHAT', principalUserId: ID.staffOwned }, ID.cTeam],
      // view-all: another member's PRIVATE contact, on a surface with no principal run for them
      [ID.staffAll, { surface: 'PROPOSAL', onBehalfOfUserId: ID.staffAll }, ID.cPriv],
      [ID.staffAll, { surface: 'CHAT', principalUserId: ID.staffAll }, ID.cShared],
    ];
    for (const [actor, action, contactId] of cases) {
      const label = `${actor} ${String(action.surface)} ${contactId}`;
      const hidden = await refusalOf(keyCallCreateTask(action, contactId, marker));
      const unknown = await refusalOf(keyCallCreateTask(action, unknownContact, marker));
      expect(hidden, label).toEqual({ status: 404, message: 'Contact not found' });
      expect(unknown, label).toEqual(hidden);
      // POST calls answers the same member the same way
      const rest = await as(actor).post(calls, { businessId: ID.bizA, contactId, callerId: actor, notes: marker });
      expect([rest.status, rest.body.message], label).toEqual([hidden!.status, hidden!.message]);
    }
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('CL-06b a non-member SUPER_ADMIN principal is refused 403 as the caller, as POST calls refuses them (CL-03c, D-46), and nothing is written', async () => {
    const marker = `${P}key_super`;
    const key = await refusalOf(keyCallCreateTask({ surface: 'CHAT', principalUserId: ID.superA }, ID.cTeam, marker));
    expect(key).toEqual({ status: 403, message: 'Only a member of this business can be the caller of a call log' });
    const rest = await as(ID.superA).post(calls, { businessId: ID.bizA, contactId: ID.cTeam, callerId: ID.owner, notes: marker });
    expect([rest.status, rest.body.message]).toEqual([key!.status, key!.message]);
    expect(await db.callLog.count({ where: { businessId: ID.bizA, notes: marker } })).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('CL-06c CONTROL: on a contact the member may open the call log is written with that member as the caller, whatever callerId the model sent', async () => {
    const marker = `${P}key_control`;
    const stored = [
      await keyCallCreateTask({ surface: 'CHAT', principalUserId: ID.staffOwned }, ID.cMine, marker),
      await keyCallCreateTask({ surface: 'PROPOSAL', onBehalfOfUserId: ID.staffOwned }, ID.cShared, marker),
      await keyCallCreateTask({ surface: 'CHAT', principalUserId: ID.staffAll }, ID.cTeam, marker),
    ];
    expect(stored.map((out: any) => [out.callerId, out.contactId])).toEqual([
      [ID.staffOwned, ID.cMine],
      [ID.staffOwned, ID.cShared],
      [ID.staffAll, ID.cTeam],
    ]);
    const rows = await db.callLog.findMany({ where: { businessId: ID.bizA, notes: marker }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r: any) => [r.callerId, r.contactId]).sort()).toEqual(
      [[ID.staffAll, ID.cTeam], [ID.staffOwned, ID.cMine], [ID.staffOwned, ID.cShared]].sort(),
    );
  });
});

describe('CONTROLS: what a member may open behaves as before', () => {
  /**
   * W10-CALLLOG-LIST: by this case the cases above have left 48 more call logs in bizA (53 in all:
   * 33 with a scheduledAt, 20 without), more than the 50 that one page of GET calls holds. The list
   * orders by scheduledAt alone, nulls last, so which 17 of the 20 call logs with no scheduledAt
   * reached the first page (clMine and clShared are two of the 20) followed the rows' physical
   * order in call_logs, which the full run's concurrent writers and vacuums change: clMine fell off
   * the page. limit and offset cannot be sent over HTTP here (this app has no ValidationPipe, so
   * they reach Prisma as strings; ListCallsQueryDto has no @Type(() => Number)), so the OWNER's
   * whole list is checked by its total against the business's call logs, and each call log on a
   * list that holds all of it on one page: its contact's, and for the contactless one the call logs
   * scheduled at its exact time.
   */
  it('OWNER lists and opens every call log: PRIVATE, TEAM, shared, contactless', async () => {
    // the OWNER's list leaves nothing out: its total is every call log of the business
    const res = await as(ID.owner).get(calls).expect(200);
    const inBiz = await db.callLog.count({ where: { businessId: ID.bizA } });
    expect(res.body.total).toBe(inBiz);
    expect(res.body.items).toHaveLength(Math.min(inBiz, 50));

    const noneAt: Date = (await db.callLog.findUnique({ where: { id: ID.clNone } })).scheduledAt;
    const at = encodeURIComponent(noneAt.toISOString());
    const lists: Array<[string, string, Record<string, unknown>]> = [
      [ID.clPriv, `contactId=${ID.cPriv}`, { contactId: ID.cPriv }],
      [ID.clTeam, `contactId=${ID.cTeam}`, { contactId: ID.cTeam }],
      [ID.clNone, `fromDate=${at}&toDate=${at}`, { scheduledAt: noneAt }],
      [ID.clMine, `contactId=${ID.cMine}`, { contactId: ID.cMine }],
      [ID.clShared, `contactId=${ID.cShared}`, { contactId: ID.cShared }],
    ];
    for (const [id, query, where] of lists) {
      const list = await as(ID.owner).get(`${calls}?${query}`).expect(200);
      // the whole list is on this page, and it is every call log of the business it selects
      expect(list.body.total, query).toBe(list.body.items.length);
      expect(list.body.total, query).toBe(await db.callLog.count({ where: { businessId: ID.bizA, ...where } }));
      expect(list.body.items.map((c: any) => c.id), id).toContain(id);
      await as(ID.owner).get(`${calls}/${id}`).expect(200);
    }
    const day = await as(ID.owner).get(`${calls}/scheduled/today`).expect(200);
    expect(day.body.map((c: any) => c.id)).toEqual(expect.arrayContaining([ID.clPriv, ID.clTeam, ID.clNone]));
  });

  it('OWNER writes on a PRIVATE-contact call log: PATCH, follow-up, complete, and DELETE of another', async () => {
    const row = await freshCall('owner_w', ID.cPriv);
    await as(ID.owner).patch(`${calls}/${row.id}`, { notes: 'owner edit' }).expect(200);
    await as(ID.owner).post(`${calls}/${row.id}/follow-up`, { title: 'v84d owner follow up' }).expect(201);
    await as(ID.owner).post(`${calls}/${row.id}/complete`, { outcome: 'reached' }).expect(201);
    const del = await freshCall('owner_d', ID.cPriv);
    await as(ID.owner).delete(`${calls}/${del.id}`).expect(200);
    expect(await db.callLog.findUnique({ where: { id: del.id } })).toBeNull();
    const created = await as(ID.owner).post(calls, { businessId: ID.bizA, contactId: ID.cPriv, callerId: ID.owner }).expect(201);
    expect(created.body).toMatchObject({ contactId: ID.cPriv, callerId: ID.owner });
  });

  it("crm_view 'owned': the member's own contact, a PRIVATE contact shared with them and a contactless call log stay open", async () => {
    for (const id of [ID.clMine, ID.clShared, ID.clNone]) {
      await as(ID.staffOwned).get(`${calls}/${id}`).expect(200);
    }
  });

  it('a view-all crm write member reads and writes TEAM-contact and contactless call logs as before', async () => {
    await as(ID.staffAll).get(`${calls}/${ID.clTeam}`).expect(200);
    await as(ID.staffAll).get(`${calls}/${ID.clNone}`).expect(200);

    const team = await freshCall('team_w', ID.cTeam);
    await as(ID.staffAll).patch(`${calls}/${team.id}`, { notes: 'team edit' }).expect(200);
    await as(ID.staffAll).post(`${calls}/${team.id}/follow-up`, { title: 'v84d team follow up' }).expect(201);
    await as(ID.staffAll).post(`${calls}/${team.id}/complete`, { outcome: 'reached' }).expect(201);
    await as(ID.staffAll).post(`${calls}/${ID.clTeam}/generate-script`).expect(201);
    expect(scriptCalls).toEqual([[ID.bizA, ID.clTeam, ID.cTeam]]);

    const none = await freshCall('none_w', null);
    await as(ID.staffAll).patch(`${calls}/${none.id}`, { notes: 'contactless edit' }).expect(200);
    const fu = await as(ID.staffAll).post(`${calls}/${none.id}/follow-up`, { title: 'v84d contactless' });
    expect(fu.status).toBe(400);
    await as(ID.staffAll).post(`${calls}/${none.id}/complete`, { outcome: 'no_answer' }).expect(201);
    const del = await freshCall('none_d', null);
    await as(ID.staffAll).delete(`${calls}/${del.id}`).expect(200);

    const created = await as(ID.staffAll).post(calls, { businessId: ID.bizA, contactId: ID.cTeam, callerId: ID.staffAll }).expect(201);
    expect(created.body).toMatchObject({ contactId: ID.cTeam, callerId: ID.staffAll });
    const contactless = await as(ID.staffAll).post(calls, { businessId: ID.bizA, callerId: ID.staffAll }).expect(201);
    expect(contactless.body).toMatchObject({ contactId: null, callerId: ID.staffAll });
    const fromNext = await as(ID.staffAll).post(`/businesses/${ID.bizA}/contacts/${ID.cTeam}/calls/from-next-action`).expect(201);
    expect(fromNext.body).toMatchObject({ contactId: ID.cTeam, callerId: ID.staffAll });
  });
});
