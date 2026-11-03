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

  it.todo('chaser.service.ts and capacity-insight.service.ts tell a caller to log the outcome of a call log whose contact they can no longer open (review CR-2 dead-end; those services are outside FOLLOW3-D4-CALL-LOG-VIS\'s write set, follow-up packet)');
});

// Review ST-2 (residual, not fixed here): the KEY write tools reach the call logs and contacts the
// HTTP routes now hide. call_log_outcome (completeCall), call_schedule_followup
// (createFollowUpTask), call_generate_script and call_create_task run with no acting member, and
// JobRolePolicyService grants them to non-OWNER crm:write holders (crm_view 'owned' included) while
// it withholds crm_update_contact from the same holders. The fix is in job-role-policy.service.ts
// (CRM_ROW_VISIBILITY_TOOLS) or a dispatcher that passes the actor (flow-orchestrator.service.ts),
// both outside this packet's write set.
describe('CL-05 KEY call-log write tools (review ST-2, follow-up packet)', () => {
  it.todo("KEY call_log_outcome, call_schedule_followup, call_generate_script and call_create_task apply the acting member's CRM record visibility, or are withheld from members whose visibility is restricted (job-role-policy.service.ts / flow-orchestrator.service.ts)");
});

describe('CONTROLS: what a member may open behaves as before', () => {
  it('OWNER lists and opens every call log: PRIVATE, TEAM, shared, contactless', async () => {
    const res = await as(ID.owner).get(calls).expect(200);
    const ids = res.body.items.map((c: any) => c.id);
    for (const id of [ID.clPriv, ID.clTeam, ID.clNone, ID.clMine, ID.clShared]) {
      expect(ids, id).toContain(id);
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
