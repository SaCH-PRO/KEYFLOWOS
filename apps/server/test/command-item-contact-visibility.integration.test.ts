/**
 * FOLLOW3-D10-COMMAND-ITEM-CONTACT-VIS (V1-84): command-centre items owned by a
 * contact are listed, read and acted on only by members who can open that
 * contact, against a REAL database.
 *
 * V1-09b closed the KEY side of doItForMe (GET key/commands projects what a
 * member may see) and handed off the CommandItem read surface. generateDoItForMe
 * (key-command.service.ts) writes one CommandItem per action with ownerType
 * 'CONTACT', ownerId set to the contact and a title naming it ('Follow up:
 * <name>'). Before this packet every CommandController route passed businessId
 * only, and CommandService.findMany, findDue and findOne filtered by businessId
 * (plus the client's own ownerId/ownerType filters): a STAFF member whose CRM
 * view is 'owned' listed, read and completed the items of the OWNER's PRIVATE
 * contact, whose GET contacts/:contactId answers that member 404.
 *
 * The rule applied is the contact detail route's (assertContactVisible: the
 * tenant predicate, deletedAt null and visibilityClause from resolveCrmAccess),
 * read through CommandItem.ownerId when ownerType is 'CONTACT'. An item the
 * member may not open answers exactly as an unknown id: absent from the list
 * and the due list, 404 on items/:id and on every single-item mutation, and a
 * bulk call that names it is refused whole, as for an unknown id. Items with no
 * owner, or whose ownerType is not 'CONTACT', are untouched by the rule, and
 * the OWNER (visibilityClause null) sees everything.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership, contact, contact share and command item
 * rows, AuthGuard, BusinessGuard, ModuleScopeGuard, the global ValidationPipe,
 * GlobalHttpExceptionFilter and TenantInterceptor (global in app.module.ts as
 * APP_INTERCEPTOR; the bulk routes read their actor from the context it binds),
 * CommandController and CommandService are real against DATABASE_URL. The
 * stand-ins are recorders behind the guards: identity
 * attachment (a test middleware reads `x-test-user` and attaches the seeded user
 * row as AuthMiddleware would), TimelineService, RealtimeService,
 * NotificationsService, and the command generator and scheduler (a scan would
 * be AI and cross-module traffic).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v84j_` prefix and is
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll. No
 * $transaction wrapping. Cases tagged RED-BEFORE fail on the unmodified
 * controller and service; CTL cases are controls that pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Each case sends a dozen or more real-database requests.
vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84j_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, role defaults (visibilityClause null)
  staffOwned: `${P}staffOwned`, // STAFF { operations: read, crm: read, crm_view: owned } (CI-01)
  staffAll: `${P}staffAll`, // STAFF { operations: read, crm: read } (view-all default: TEAM yes, another member's PRIVATE no)
  writerOwned: `${P}writerOwned`, // STAFF { operations: write, crm_view: owned } (CI-02)
  writerShared: `${P}writerShared`, // STAFF { operations: write, crm: read, crm_view: owned } with a ContactShare on cPriv
  bizA: `${P}bizA`,
  cPriv: `${P}cPriv`, // PRIVATE, owned by the OWNER, shared with writerShared only
  cTeam: `${P}cTeam`, // TEAM, owned by staffOwned (in their book; view-all members see TEAM)
  iPriv: `${P}iPriv`, // ownerType CONTACT -> cPriv
  iTeam: `${P}iTeam`, // ownerType CONTACT -> cTeam
  iNone: `${P}iNone`, // no owner
  iUser: `${P}iUser`, // ownerType USER -> the OWNER
  unknown: `${P}nope`, // no such item
};
const READ_MODULE = `${P}read`;
const PRIVATE_NAME = 'Priya Privatecontact';
const TEAM_NAME = 'Theo Teamcontact';

// ---- recorders behind the guards --------------------------------------------
const timeline = {
  events: [] as Array<Record<string, unknown>>,
  async recordEvent(e: Record<string, unknown>) {
    timeline.events.push(e);
    return undefined;
  },
};
const realtime = {
  emits: [] as Array<Record<string, unknown>>,
  emit(e: Record<string, unknown>) {
    realtime.emits.push(e);
  },
};
const notifications = {
  created: [] as Array<Record<string, unknown>>,
  async create(n: Record<string, unknown>) {
    notifications.created.push(n);
    return n;
  },
};
const generator = { async generateForBusiness() { return { created: 0 }; } };
const scheduler = { async getLastScanTime() { return null; }, async shouldAutoScan() { return false; } };

let db: any;
let app: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'patch' | 'delete';
const cmd = `/command/businesses/${P}bizA`;

function send(verb: Verb, url: string, actor: string, body?: unknown) {
  const r = (request(app.getHttpServer()) as any)[verb](url).set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

type Owner = 'priv' | 'team' | 'none' | 'user';
const OWNERS: Record<Owner, { ownerType: string | null; ownerId: string | null; name: string }> = {
  priv: { ownerType: 'CONTACT', ownerId: ID.cPriv, name: PRIVATE_NAME },
  team: { ownerType: 'CONTACT', ownerId: ID.cTeam, name: TEAM_NAME },
  none: { ownerType: null, ownerId: null, name: 'the week' },
  user: { ownerType: 'USER', ownerId: ID.owner, name: 'the owner' },
};

let seq = 0;
/** A doItForMe-shaped item ('Follow up: <name>'), an obligation due in two days so items/due answers it too. */
async function seedItem(owner: Owner, opts: { id?: string; sourceModule?: string } = {}) {
  seq += 1;
  const id = opts.id ?? `${P}ci_${seq}`;
  const o = OWNERS[owner];
  return db.commandItem.create({
    data: {
      id,
      businessId: ID.bizA,
      sourceModule: opts.sourceModule ?? `${P}write`,
      sourceType: 'do_it_for_me',
      sourceId: id,
      title: `Follow up: ${o.name}`,
      description: `Reason for ${o.name}`,
      category: 'PEOPLE',
      actionType: 'follow_up',
      status: 'OPEN',
      kind: 'OBLIGATION',
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      ownerType: o.ownerType,
      ownerId: o.ownerId,
      recommendedBy: 'KEY',
      executableByKey: true,
    },
  });
}

/** The whole row as Postgres stores it (null when absent): what "row unchanged" compares. */
async function rowOf(id: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM command_items t WHERE id = $1', id);
  return rows[0]?.row ?? null;
}

const recorded = () => ({ timeline: timeline.events.length, realtime: realtime.emits.length, notifications: notifications.created.length });

/** A refusal's body without the per-request fields (path, timestamp, correlation id). */
function refusal(res: { status: number; body: any }) {
  const { path: _path, timestamp: _ts, correlationId: _cid, ...rest } = res.body ?? {};
  return { httpStatus: res.status, ...rest };
}

const until = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

/** Every single-item mutation of CommandController, as one request against `id`. */
const SINGLE_MUTATIONS: Array<{ key: string; verb: Verb; suffix: string; body?: () => unknown }> = [
  { key: 'complete', verb: 'post', suffix: '/complete' },
  { key: 'dismiss', verb: 'post', suffix: '/dismiss' },
  { key: 'snooze', verb: 'post', suffix: '/snooze', body: () => ({ until: until() }) },
  { key: 'update', verb: 'patch', suffix: '', body: () => ({ title: `${P}renamed` }) },
  { key: 'approve', verb: 'post', suffix: '/approve' },
  { key: 'execute', verb: 'post', suffix: '/execute', body: () => ({ result: { v84j: true } }) },
  { key: 'discharge', verb: 'post', suffix: '/discharge', body: () => ({ dischargeRef: `${P}paid` }) },
  { key: 'assign', verb: 'post', suffix: '/assign', body: () => ({ ownerType: 'USER', ownerId: ID.writerOwned }) },
  { key: 'reopen', verb: 'post', suffix: '/reopen' },
  { key: 'delete', verb: 'delete', suffix: '' },
];
const RED_BEFORE_MUTATIONS = ['complete', 'dismiss', 'snooze'];
const okStatus = (verb: Verb) => (verb === 'post' ? 201 : 200);

const listIds = (body: any): string[] => (body?.items ?? []).map((i: any) => i.id).sort();

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CommandController } = await import('../src/modules/command/command.controller');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { CommandGeneratorService } = await import('../src/modules/command/command-generator.service');
  const { CommandSchedulerService } = await import('../src/modules/command/command-scheduler.service');
  const { BulkCommandItemsDto } = await import('../src/modules/command/dto/bulk-command-items.dto');
  const { ListCommandItemsDto } = await import('../src/modules/command/dto/list-command-items.dto');
  const { ListDueObligationsDto } = await import('../src/modules/command/dto/list-due-obligations.dto');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  // The parameter types tsc emits (emitDecoratorMetadata), which vitest's
  // esbuild transform does not: the query and bulk bodies validate and
  // transform through their DTOs as in production.
  for (const handler of ['bulkComplete', 'bulkDismiss', 'bulkDelete']) {
    Reflect.defineMetadata('design:paramtypes', [String, BulkCommandItemsDto], CommandController.prototype, handler);
  }
  Reflect.defineMetadata('design:paramtypes', [String, ListCommandItemsDto], CommandController.prototype, 'list');
  Reflect.defineMetadata('design:paramtypes', [String, ListDueObligationsDto], CommandController.prototype, 'due');

  const moduleRef = await Test.createTestingModule({
    controllers: [CommandController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CommandService,
      { provide: TimelineService, useValue: timeline },
      { provide: RealtimeService, useValue: realtime },
      { provide: NotificationsService, useValue: notifications },
      { provide: CommandGeneratorService, useValue: generator },
      { provide: CommandSchedulerService, useValue: scheduler },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v84j_ users. No guard is overridden.
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
  // As app.module.ts (APP_INTERCEPTOR): the guarded tenant and the member become the ambient context.
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenant, memberships ------------------------------------
  for (const id of [ID.owner, ID.staffOwned, ID.staffAll, ID.writerOwned, ID.writerShared]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84J Biz A', ownerId: ID.owner } });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, 'OWNER');
  await m(ID.staffOwned, 'STAFF', { operations: 'read', crm: 'read', crm_view: 'owned' });
  await m(ID.staffAll, 'STAFF', { operations: 'read', crm: 'read' });
  await m(ID.writerOwned, 'STAFF', { operations: 'write', crm_view: 'owned' });
  await m(ID.writerShared, 'STAFF', { operations: 'write', crm: 'read', crm_view: 'owned' });

  // ---- contacts ------------------------------------------------------------
  await db.contact.create({
    data: { id: ID.cPriv, businessId: ID.bizA, firstName: 'Priya', lastName: 'Privatecontact', visibility: 'PRIVATE', ownerId: ID.owner },
  });
  await db.contact.create({
    data: { id: ID.cTeam, businessId: ID.bizA, firstName: 'Theo', lastName: 'Teamcontact', visibility: 'TEAM', ownerId: ID.staffOwned },
  });
  await db.contactShare.create({
    data: { id: `${P}share`, businessId: ID.bizA, contactId: ID.cPriv, userId: ID.writerShared, createdBy: ID.owner },
  });

  // ---- the read fixture: one item per owner shape ------------------------
  await seedItem('priv', { id: ID.iPriv, sourceModule: READ_MODULE });
  await seedItem('team', { id: ID.iTeam, sourceModule: READ_MODULE });
  await seedItem('none', { id: ID.iNone, sourceModule: READ_MODULE });
  await seedItem('user', { id: ID.iUser, sourceModule: READ_MODULE });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture', () => {
  it('[CI-00] one OWNER and four STAFF members of bizA, a PRIVATE contact of the OWNER shared with one member only, a TEAM contact, and four read items: CONTACT -> PRIVATE, CONTACT -> TEAM, no owner, USER', async () => {
    const members = await db.membership.findMany({ where: { businessId: ID.bizA }, orderBy: { id: 'asc' } });
    expect(Object.fromEntries(members.map((r: any) => [r.userId.slice(P.length), [r.role, r.permissionScopes]]))).toEqual({
      owner: ['OWNER', null],
      staffOwned: ['STAFF', { operations: 'read', crm: 'read', crm_view: 'owned' }],
      staffAll: ['STAFF', { operations: 'read', crm: 'read' }],
      writerOwned: ['STAFF', { operations: 'write', crm_view: 'owned' }],
      writerShared: ['STAFF', { operations: 'write', crm: 'read', crm_view: 'owned' }],
    });
    const items = await db.commandItem.findMany({ where: { businessId: ID.bizA, sourceModule: READ_MODULE }, orderBy: { id: 'asc' } });
    expect(items.map((i: any) => [i.id, i.ownerType, i.ownerId, i.title])).toEqual([
      [ID.iNone, null, null, 'Follow up: the week'],
      [ID.iPriv, 'CONTACT', ID.cPriv, `Follow up: ${PRIVATE_NAME}`],
      [ID.iTeam, 'CONTACT', ID.cTeam, `Follow up: ${TEAM_NAME}`],
      [ID.iUser, 'USER', ID.owner, 'Follow up: the owner'],
    ]);
  });
});

describe('CI-01: reads of an item owned by a contact the member cannot open', () => {
  it("[CI-01a] RED-BEFORE: STAFF { operations: read, crm: read, crm_view: owned } lists the items of the contacts in their book and the items with no CONTACT owner, but not the item of the OWNER's PRIVATE contact; the total counts what is listed and the body never names the contact", async () => {
    const res = await send('get', `${cmd}/items?sourceModule=${READ_MODULE}&limit=100`, ID.staffOwned);
    expect(res.status).toBe(200);
    expect(listIds(res.body)).toEqual([ID.iNone, ID.iTeam, ID.iUser].sort());
    expect(res.body.total).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(res.body)).not.toContain(ID.cPriv);
  });

  it("[CI-01b] RED-BEFORE: GET items/:id of that item answers 404 exactly as an unknown id does, while the member's other items answer 200", async () => {
    const hidden = await send('get', `${cmd}/items/${ID.iPriv}`, ID.staffOwned);
    const unknown = await send('get', `${cmd}/items/${ID.unknown}`, ID.staffOwned);
    expect(unknown.status).toBe(404);
    expect(refusal(hidden)).toEqual(refusal(unknown));
    expect(JSON.stringify(hidden.body)).not.toContain(PRIVATE_NAME);
    for (const id of [ID.iTeam, ID.iNone, ID.iUser]) {
      const ok = await send('get', `${cmd}/items/${id}`, ID.staffOwned);
      expect(ok.status, id).toBe(200);
      expect(ok.body.id, id).toBe(id);
    }
  });

  it('[CI-01c] RED-BEFORE: GET items/due omits that obligation and keeps the others', async () => {
    const res = await send('get', `${cmd}/items/due?limit=500`, ID.staffOwned);
    expect(res.status).toBe(200);
    const ids = listIds(res.body);
    expect(ids).not.toContain(ID.iPriv);
    expect(ids).toEqual(expect.arrayContaining([ID.iNone, ID.iTeam, ID.iUser]));
    expect(res.body.total).toBe(res.body.items.length);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_NAME);
  });

  it("[CI-01d] RED-BEFORE: the client's own owner filters do not reach it: ?ownerType=CONTACT&ownerId=<the PRIVATE contact> answers an empty list", async () => {
    const res = await send('get', `${cmd}/items?ownerType=CONTACT&ownerId=${ID.cPriv}&limit=100`, ID.staffOwned);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0 });
  });

  it("[CI-01e] RED-BEFORE: a view-all STAFF member (crm read, no crm_view) sees the TEAM contact's item but not another member's PRIVATE contact's, on the list, the due list and items/:id", async () => {
    const list = await send('get', `${cmd}/items?sourceModule=${READ_MODULE}&limit=100`, ID.staffAll);
    expect(listIds(list.body)).toEqual([ID.iNone, ID.iTeam, ID.iUser].sort());
    expect(list.body.total).toBe(3);
    const due = await send('get', `${cmd}/items/due?limit=500`, ID.staffAll);
    expect(listIds(due.body)).not.toContain(ID.iPriv);
    expect(listIds(due.body)).toContain(ID.iTeam);
    expect((await send('get', `${cmd}/items/${ID.iPriv}`, ID.staffAll)).status).toBe(404);
    expect((await send('get', `${cmd}/items/${ID.iTeam}`, ID.staffAll)).status).toBe(200);
  });
});

describe('CI-02: actions on an item owned by a contact the member cannot open', () => {
  it('[CI-02a] RED-BEFORE: STAFF { operations: write, crm_view: owned } cannot complete, dismiss or snooze it: 404 as for an unknown id, the row unchanged, nothing recorded', async () => {
    for (const r of SINGLE_MUTATIONS.filter((x) => RED_BEFORE_MUTATIONS.includes(x.key))) {
      const item = await seedItem('priv');
      const before = await rowOf(item.id);
      const rec = recorded();
      const res = await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.writerOwned, r.body?.());
      const unknown = await send(r.verb, `${cmd}/items/${ID.unknown}${r.suffix}`, ID.writerOwned, r.body?.());
      expect(unknown.status, r.key).toBe(404);
      expect(refusal(res), r.key).toEqual(refusal(unknown));
      expect(await rowOf(item.id), r.key).toBe(before);
      expect(recorded(), r.key).toEqual(rec);
    }
  });

  it('[CI-02b] RED-BEFORE: every other single-item mutation (PATCH, approve, execute, discharge, assign, reopen, DELETE) answers 404 too, with the row unchanged and nothing recorded', async () => {
    for (const r of SINGLE_MUTATIONS.filter((x) => !RED_BEFORE_MUTATIONS.includes(x.key))) {
      const item = await seedItem('priv');
      const before = await rowOf(item.id);
      const rec = recorded();
      const res = await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.writerOwned, r.body?.());
      const unknown = await send(r.verb, `${cmd}/items/${ID.unknown}${r.suffix}`, ID.writerOwned, r.body?.());
      expect(unknown.status, r.key).toBe(404);
      expect(refusal(res), r.key).toEqual(refusal(unknown));
      expect(await rowOf(item.id), r.key).toBe(before);
      expect(recorded(), r.key).toEqual(rec);
    }
  });

  it('[CI-02c] RED-BEFORE: a bulk complete, dismiss or delete that names it beside a visible item is refused whole, exactly as one naming an unknown id: 404, both rows unchanged, nothing recorded', async () => {
    for (const action of ['complete', 'dismiss', 'delete']) {
      const visible = await seedItem('none');
      const hidden = await seedItem('priv');
      const before = [await rowOf(visible.id), await rowOf(hidden.id)];
      const rec = recorded();
      const res = await send('post', `${cmd}/items/bulk/${action}`, ID.writerOwned, { ids: [visible.id, hidden.id] });
      const unknown = await send('post', `${cmd}/items/bulk/${action}`, ID.writerOwned, { ids: [visible.id, ID.unknown] });
      expect(unknown.status, action).toBe(404);
      expect(refusal(res), action).toEqual(refusal(unknown));
      expect([await rowOf(visible.id), await rowOf(hidden.id)], action).toEqual(before);
      expect(recorded(), action).toEqual(rec);
    }
  });
});

describe('controls (pass before and after)', () => {
  it('[CTL-01] items with no owner, or whose ownerType is not CONTACT, are untouched: the CI-02 member completes, dismisses and snoozes them, runs every other single-item mutation on them, and bulk-completes, dismisses and deletes them', async () => {
    for (const owner of ['none', 'user'] as const) {
      for (const r of SINGLE_MUTATIONS) {
        const item = await seedItem(owner);
        const res = await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.writerOwned, r.body?.());
        expect(res.status, `${owner} ${r.key} ${JSON.stringify(res.body)}`).toBe(okStatus(r.verb));
      }
      for (const action of ['complete', 'dismiss', 'delete']) {
        const ids = [(await seedItem(owner)).id, (await seedItem(owner)).id];
        const res = await send('post', `${cmd}/items/bulk/${action}`, ID.writerOwned, { ids });
        expect(res.status, `${owner} bulk ${action}`).toBe(201);
        expect(res.body, `${owner} bulk ${action}`).toEqual({ count: 2 });
      }
    }
  });

  it('[CTL-02] the OWNER sees everything: every read item on the list (total 4), the PRIVATE item on the due list and on items/:id, and completes, dismisses, snoozes and bulk-completes items of that contact', async () => {
    const list = await send('get', `${cmd}/items?sourceModule=${READ_MODULE}&limit=100`, ID.owner);
    expect(listIds(list.body)).toEqual([ID.iNone, ID.iPriv, ID.iTeam, ID.iUser].sort());
    expect(list.body.total).toBe(4);
    expect(listIds((await send('get', `${cmd}/items/due?limit=500`, ID.owner)).body)).toContain(ID.iPriv);
    const one = await send('get', `${cmd}/items/${ID.iPriv}`, ID.owner);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: ID.iPriv, title: `Follow up: ${PRIVATE_NAME}` });
    for (const r of SINGLE_MUTATIONS.filter((x) => RED_BEFORE_MUTATIONS.includes(x.key))) {
      const item = await seedItem('priv');
      expect((await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.owner, r.body?.())).status, r.key).toBe(201);
    }
    const ids = [(await seedItem('priv')).id, (await seedItem('none')).id];
    const bulk = await send('post', `${cmd}/items/bulk/complete`, ID.owner, { ids });
    expect(bulk.status).toBe(201);
    expect(bulk.body).toEqual({ count: 2 });
  });

  it('[CTL-03] a member who can open the contact (crm_view owned, with a ContactShare on it) lists it, reads it and acts on it: the rule is per contact, not per role', async () => {
    const list = await send('get', `${cmd}/items?sourceModule=${READ_MODULE}&limit=100`, ID.writerShared);
    expect(listIds(list.body)).toEqual(expect.arrayContaining([ID.iNone, ID.iPriv, ID.iUser]));
    expect(listIds((await send('get', `${cmd}/items/due?limit=500`, ID.writerShared)).body)).toContain(ID.iPriv);
    expect((await send('get', `${cmd}/items/${ID.iPriv}`, ID.writerShared)).status).toBe(200);
    for (const r of SINGLE_MUTATIONS.filter((x) => RED_BEFORE_MUTATIONS.includes(x.key))) {
      const item = await seedItem('priv');
      expect((await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.writerShared, r.body?.())).status, r.key).toBe(201);
    }
    const ids = [(await seedItem('priv')).id, (await seedItem('none')).id];
    const bulk = await send('post', `${cmd}/items/bulk/dismiss`, ID.writerShared, { ids });
    expect(bulk.status).toBe(201);
    expect(bulk.body).toEqual({ count: 2 });
  });
});
