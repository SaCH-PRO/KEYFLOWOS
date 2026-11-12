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
 * read through every column by which an item names a contact (review
 * ST-D10-2): ownerId when ownerType is 'CONTACT', contactId (message intake,
 * REBOOK), owedToId when owedToType is 'CONTACT' (REBOOK) and entityId when
 * entityType is 'contact' (finance SLOW_PAYER). An item the member may not
 * open answers exactly as an unknown id: absent from the list and the due
 * list, 404 on items/:id and on every single-item mutation, and a bulk call
 * that names it is refused whole, as for an unknown id. Items that name no
 * contact are untouched by the rule, and the OWNER (visibilityClause null)
 * sees everything. The rule holds however many contacts a business's items
 * name (review CR-1, CI-04), and the business-wide channels (timeline,
 * notifications, realtime) carry neither the title nor the description of an
 * item that names a contact (review ST-D10-1, CI-05).
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
  // CI-04: a second business whose items name more contacts than one findMany returns
  bizS: `${P}bizS`,
  ownerS: `${P}ownerS`, // OWNER of bizS
  staffS: `${P}staffS`, // STAFF { operations: write, crm: read, crm_view: owned } of bizS
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
let commandService: any;
let prismaSvc: any; // the module's real PrismaService (the KEY dispatcher's, KEY-01)
let CONTACT_ITEM_LABEL: string;

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
  const commandModule = await import('../src/modules/command/command.service');
  const { CommandService } = commandModule;
  CONTACT_ITEM_LABEL = commandModule.CONTACT_ITEM_LABEL;
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
  commandService = moduleRef.get(CommandService);
  prismaSvc = moduleRef.get(PrismaService);

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

// The cleanup removes every row the file wrote, the CI-05 scale fixture's 33,000 command items
// included; on CI's container Postgres that outlasts vitest's 10s default hook timeout. Same
// budget as the seeding hook above.
afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 120_000);

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
  it('[CTL-01] items that name no contact (no owner, or ownerType USER, and no contactId, owedTo or contact entity) are untouched: the CI-02 member completes, dismisses and snoozes them, runs every other single-item mutation on them, and bulk-completes, dismisses and deletes them', async () => {
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

// ---- review repairs (ST-D10-2, CR-1, ST-D10-1, ST-D10-3/CR-2) -------------------

const DAY = 24 * 60 * 60 * 1000;
const SHAPES_MODULE = `${P}shapes`;

/** Every column by which an item names a contact, as the test reads the rule (CommandService keeps its own copy). */
function namedContacts(i: any): string[] {
  const isContact = (t: string | null) => (t ?? '').toUpperCase() === 'CONTACT';
  return [
    isContact(i.ownerType) ? i.ownerId : null,
    i.contactId,
    isContact(i.owedToType) ? i.owedToId : null,
    isContact(i.entityType) ? i.entityId : null,
  ].filter((id: string | null) => !!id);
}

async function seedShape(id: string, data: Record<string, unknown>) {
  return db.commandItem.create({
    data: {
      id,
      businessId: ID.bizA,
      sourceModule: SHAPES_MODULE,
      sourceType: 'shape',
      sourceId: id,
      category: 'PEOPLE',
      actionType: 'shape',
      status: 'OPEN',
      ...data,
    },
  });
}

/** The writers that name a contact other than through ownerType 'CONTACT' (review ST-D10-2). */
const SHAPE = {
  // message-intake-orchestrator.service.ts create_command: ownerType KEY, ownerId = contactId = the contact
  intake: `${P}sh_intake`,
  // bookings.service.ts raiseRebookObligation: a REBOOK obligation owed to the contact
  rebook: `${P}sh_rebook`,
  // finance-intelligence.service.ts SLOW_PAYER mirror: entityType 'contact'
  slow: `${P}sh_slow`,
  // the same shapes on the TEAM contact (in staffOwned's book; view-all members see TEAM)
  teamIntake: `${P}sh_tintake`,
  teamRebook: `${P}sh_trebook`,
};
const HIDDEN_SHAPES = [SHAPE.intake, SHAPE.rebook, SHAPE.slow];

describe('CI-03 (review ST-D10-2): items that name the contact through contactId, owedTo or a contact entity follow the same rule', () => {
  beforeAll(async () => {
    const due = new Date(Date.now() + 2 * DAY);
    await seedShape(SHAPE.intake, { ownerType: 'KEY', ownerId: ID.cPriv, contactId: ID.cPriv, title: `Reply to ${PRIVATE_NAME}`, recommendedBy: 'KEY', executableByKey: true });
    await seedShape(SHAPE.rebook, {
      kind: 'OBLIGATION', actionType: 'REBOOK', category: 'SALES', dueAt: due, title: `Rebook ${PRIVATE_NAME} for Haircut`,
      owedToType: 'CONTACT', owedToId: ID.cPriv, owedToLabel: PRIVATE_NAME, contactId: ID.cPriv, entityType: 'booking', entityId: `${P}bk1`,
    });
    await seedShape(SHAPE.slow, {
      sourceType: 'contact', sourceId: ID.cPriv, actionType: 'FIN8_SLOW_PAYER', category: 'MONEY', title: `Slow payer: ${PRIVATE_NAME}`,
      description: `${PRIVATE_NAME} has 5 invoices more than 30 days overdue.`, entityType: 'contact', entityId: ID.cPriv,
    });
    await seedShape(SHAPE.teamIntake, { ownerType: 'KEY', ownerId: ID.cTeam, contactId: ID.cTeam, title: `Reply to ${TEAM_NAME}` });
    await seedShape(SHAPE.teamRebook, {
      kind: 'OBLIGATION', actionType: 'REBOOK', category: 'SALES', dueAt: due, title: `Rebook ${TEAM_NAME} for Haircut`,
      owedToType: 'CONTACT', owedToId: ID.cTeam, owedToLabel: TEAM_NAME, contactId: ID.cTeam,
    });
  });

  it("[CI-03a] STAFF crm_view owned: the PRIVATE contact's intake, REBOOK and slow-payer items are off the list, the due list and items/:id (404 as an unknown id); the TEAM contact's stay", async () => {
    const list = await send('get', `${cmd}/items?sourceModule=${SHAPES_MODULE}&limit=100`, ID.staffOwned);
    expect(list.status).toBe(200);
    expect(listIds(list.body)).toEqual([SHAPE.teamIntake, SHAPE.teamRebook].sort());
    expect(list.body.total).toBe(2);
    expect(JSON.stringify(list.body)).not.toContain(PRIVATE_NAME);
    const due = await send('get', `${cmd}/items/due?limit=500`, ID.staffOwned);
    expect(listIds(due.body)).toContain(SHAPE.teamRebook);
    for (const id of HIDDEN_SHAPES) expect(listIds(due.body), id).not.toContain(id);
    expect(JSON.stringify(due.body)).not.toContain(PRIVATE_NAME);
    const unknown = await send('get', `${cmd}/items/${ID.unknown}`, ID.staffOwned);
    for (const id of HIDDEN_SHAPES) {
      const res = await send('get', `${cmd}/items/${id}`, ID.staffOwned);
      expect(refusal(res), id).toEqual(refusal(unknown));
    }
    for (const id of [SHAPE.teamIntake, SHAPE.teamRebook]) {
      expect((await send('get', `${cmd}/items/${id}`, ID.staffOwned)).status, id).toBe(200);
    }
  });

  it('[CI-03b] STAFF { operations: write, crm_view: owned } cannot complete, dismiss, discharge or bulk-dismiss them: 404 as an unknown id, rows unchanged, nothing recorded', async () => {
    for (const [id, suffix, body] of [
      [SHAPE.intake, '/complete', undefined],
      [SHAPE.slow, '/dismiss', undefined],
      [SHAPE.rebook, '/discharge', { dischargeRef: `${P}paid` }],
    ] as Array<[string, string, unknown]>) {
      const before = await rowOf(id);
      const rec = recorded();
      const res = await send('post', `${cmd}/items/${id}${suffix}`, ID.writerOwned, body);
      const unknown = await send('post', `${cmd}/items/${ID.unknown}${suffix}`, ID.writerOwned, body);
      expect(unknown.status, id).toBe(404);
      expect(refusal(res), id).toEqual(refusal(unknown));
      expect(await rowOf(id), id).toBe(before);
      expect(recorded(), id).toEqual(rec);
    }
    const visible = await seedItem('none');
    const before = [await rowOf(visible.id), await rowOf(SHAPE.slow)];
    const res = await send('post', `${cmd}/items/bulk/dismiss`, ID.writerOwned, { ids: [visible.id, SHAPE.slow] });
    expect(res.status).toBe(404);
    expect([await rowOf(visible.id), await rowOf(SHAPE.slow)]).toEqual(before);
  });

  it('[CI-03c] controls: the OWNER and the member the contact is shared with see them; a view-all member sees the TEAM ones only', async () => {
    const all = Object.values(SHAPE).sort();
    expect(listIds((await send('get', `${cmd}/items?sourceModule=${SHAPES_MODULE}&limit=100`, ID.owner)).body)).toEqual(all);
    expect(listIds((await send('get', `${cmd}/items?sourceModule=${SHAPES_MODULE}&limit=100`, ID.writerShared)).body)).toEqual([...HIDDEN_SHAPES].sort());
    expect(listIds((await send('get', `${cmd}/items?sourceModule=${SHAPES_MODULE}&limit=100`, ID.staffAll)).body)).toEqual([SHAPE.teamIntake, SHAPE.teamRebook].sort());
    expect((await send('get', `${cmd}/items/${SHAPE.slow}`, ID.writerShared)).status).toBe(200);
  });

  it("[CI-03d] parity: for each restricted member the list (whole business, and filtered by status and category) and the due list are the OWNER's minus exactly the items that name a contact the member cannot open, in the same order rule", async () => {
    const cannotOpen: Record<string, string[]> = {
      [ID.staffOwned]: [ID.cPriv],
      [ID.staffAll]: [ID.cPriv],
      [ID.writerOwned]: [ID.cPriv, ID.cTeam],
      [ID.writerShared]: [ID.cTeam],
    };
    const key = (i: any) => [i.priority, i.urgency, Date.parse(i.createdAt)];
    for (const query of ['', '&status=OPEN', '&category=PEOPLE']) {
      const owner = await send('get', `${cmd}/items?limit=1000${query}`, ID.owner);
      expect(owner.body.total).toBe(owner.body.items.length);
      for (const [member, hiddenContacts] of Object.entries(cannotOpen)) {
        const res = await send('get', `${cmd}/items?limit=1000${query}`, member);
        const expected = owner.body.items.filter((i: any) => !namedContacts(i).some((c) => hiddenContacts.includes(c)));
        expect(listIds(res.body), `${member} ${query}`).toEqual(listIds({ items: expected }));
        expect(res.body.total, `${member} ${query}`).toBe(expected.length);
        for (let k = 1; k < res.body.items.length; k++) {
          const [a, b] = [key(res.body.items[k - 1]), key(res.body.items[k])];
          const ordered = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
          expect(ordered, `${member} ${query} order at ${k}`).toBe(true);
        }
      }
    }
    const ownerDue = await send('get', `${cmd}/items/due?limit=500`, ID.owner);
    for (const [member, hiddenContacts] of Object.entries(cannotOpen)) {
      const due = await send('get', `${cmd}/items/due?limit=500`, member);
      const expected = ownerDue.body.items.filter((i: any) => !namedContacts(i).some((c) => hiddenContacts.includes(c)));
      expect(listIds(due.body), member).toEqual(listIds({ items: expected }));
      expect(due.body.total, member).toBe(expected.length);
      expect(due.body.overdueCount, member).toBe(expected.filter((i: any) => i.overdue).length);
      // dueAt ascending, then priority descending
      for (let k = 1; k < due.body.items.length; k++) {
        const [a, b] = [due.body.items[k - 1], due.body.items[k]];
        const ordered = Date.parse(a.dueAt) < Date.parse(b.dueAt) || (a.dueAt === b.dueAt && a.priority >= b.priority);
        expect(ordered, `${member} due order at ${k}`).toBe(true);
      }
    }
  });
});

describe('CI-04 (review CR-1): the rule holds however many contacts the items name', () => {
  // Above the 1000 rows one findMany returns (packages/db defaultTakeExtension) and
  // the 32767 values a Prisma notIn list may carry.
  const N = 33_000;
  const HISTORIC = 500;
  const cmdS = `/command/businesses/${ID.bizS}`;
  const open = `${P}iS_open`;
  const done = `${P}iS_done`;

  beforeAll(async () => {
    for (const id of [ID.ownerS, ID.staffS]) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
    }
    await db.business.create({ data: { id: ID.bizS, name: 'V84J Biz S', ownerId: ID.ownerS } });
    await db.membership.create({ data: { id: `${P}m_ownerS`, userId: ID.ownerS, businessId: ID.bizS, role: 'OWNER' } });
    await db.membership.create({
      data: { id: `${P}m_staffS`, userId: ID.staffS, businessId: ID.bizS, role: 'STAFF', permissionScopes: { operations: 'write', crm: 'read', crm_view: 'owned' } },
    });
    // N PRIVATE contacts of the OWNER, each named by one open obligation (ownerType CONTACT); the
    // first HISTORIC also by a COMPLETED item (contactId): status does not decide what is checked.
    await db.$executeRawUnsafe(`INSERT INTO contacts (id, business_id, visibility, owner_id, first_name, updated_at)
      SELECT '${P}cs_' || g, '${ID.bizS}', 'PRIVATE', '${ID.ownerS}', 'Hidden' || g, now() FROM generate_series(1, ${N}) g`);
    await db.$executeRawUnsafe(`INSERT INTO command_items (id, business_id, source_module, title, category, action_type, updated_at, owner_type, owner_id, kind, due_at)
      SELECT '${P}is_' || g, '${ID.bizS}', '${P}scale', 'Follow up: Hidden' || g, 'PEOPLE', 'follow_up', now(), 'CONTACT', '${P}cs_' || g, 'OBLIGATION',
        (now() AT TIME ZONE 'UTC') + interval '1 day' FROM generate_series(1, ${N}) g`);
    await db.$executeRawUnsafe(`INSERT INTO command_items (id, business_id, source_module, title, category, action_type, updated_at, status, contact_id)
      SELECT '${P}ih_' || g, '${ID.bizS}', '${P}scale', 'Followed up: Hidden' || g, 'PEOPLE', 'follow_up', now(), 'COMPLETED', '${P}cs_' || g
      FROM generate_series(1, ${HISTORIC}) g`);
    // what the member may see: one open obligation and one completed item, naming no contact
    await db.commandItem.create({
      data: { id: open, businessId: ID.bizS, sourceModule: `${P}scale`, sourceType: 'v', sourceId: open, title: 'Weekly review', category: 'WORK', actionType: 'review', kind: 'OBLIGATION', dueAt: new Date(Date.now() + DAY), priority: 10 },
    });
    await db.commandItem.create({
      data: { id: done, businessId: ID.bizS, sourceModule: `${P}scale`, sourceType: 'v', sourceId: done, title: 'Last review', category: 'WORK', actionType: 'review', status: 'COMPLETED', priority: 10 },
    });
  }, 120_000);

  it(`[CI-04a] STAFF crm_view owned, ${N} hidden contacts named by ${N + HISTORIC} items: the list, the filtered lists and the due list hold only the items that name no contact, totals to match; the OWNER sees all`, async () => {
    const list = await send('get', `${cmdS}/items?limit=10`, ID.staffS);
    expect(list.status).toBe(200);
    expect(listIds(list.body)).toEqual([done, open].sort());
    expect(list.body.total).toBe(2);
    const completed = await send('get', `${cmdS}/items?status=COMPLETED&limit=10`, ID.staffS);
    expect(listIds(completed.body)).toEqual([done]);
    expect(completed.body.total).toBe(1);
    const owned = await send('get', `${cmdS}/items?ownerType=CONTACT&ownerId=${P}cs_${N}&limit=10`, ID.staffS);
    expect(owned.body).toEqual({ items: [], total: 0 });
    const due = await send('get', `${cmdS}/items/due?limit=10`, ID.staffS);
    expect(due.status).toBe(200);
    expect(listIds(due.body)).toEqual([open]);
    expect(due.body.total).toBe(1);
    const owner = await send('get', `${cmdS}/items?limit=10`, ID.ownerS);
    expect(owner.body.total).toBe(N + HISTORIC + 2);
    expect((await send('get', `${cmdS}/items/due?limit=10`, ID.ownerS)).body.total).toBe(10);
  }, 120_000);

  it('[CI-04b] and on the single-item and bulk routes: the last hidden item answers 404 and a bulk call naming it is refused whole', async () => {
    expect((await send('get', `${cmdS}/items/${P}is_${N}`, ID.staffS)).status).toBe(404);
    expect((await send('get', `${cmdS}/items/${P}ih_${HISTORIC}`, ID.staffS)).status).toBe(404);
    const before = await rowOf(open);
    const bulk = await send('post', `${cmdS}/items/bulk/complete`, ID.staffS, { ids: [open, `${P}is_${N}`] });
    expect(bulk.status).toBe(404);
    expect(await rowOf(open)).toBe(before);
    expect((await send('get', `${cmdS}/items/${P}is_${N}`, ID.ownerS)).status).toBe(200);
  }, 120_000);
});

describe('CI-05 (review ST-D10-1): the business-wide channels carry neither the title nor the description of an item that names a contact', () => {
  /** What the timeline, realtime and notification recorders received since `mark`. */
  const since = (mark: ReturnType<typeof recorded>) => ({
    timeline: timeline.events.slice(mark.timeline),
    realtime: realtime.emits.slice(mark.realtime),
    notifications: notifications.created.slice(mark.notifications),
  });
  const leaks = (channels: unknown) => {
    const text = JSON.stringify(channels);
    return ['Priya', 'Privatecontact', 'balance of 9000'].filter((s) => text.includes(s));
  };

  it('[CI-05a] the doItForMe call key-command.service.ts makes (ownerType CONTACT, priority 80) and the message-intake one (contactId) are announced as an item for a contact, with no description; the notification keeps the item id', async () => {
    const mark = recorded();
    const item = await commandService.create(ID.bizA, {
      title: `Collect: ${PRIVATE_NAME}`, description: 'Suggested: Hi Priya, your balance of 9000 is due', category: 'MONEY', actionType: 'invoice_reminder',
      sourceModule: `${P}chan`, sourceType: 'do_it_for_me', sourceId: `${P}chan1`, ownerType: 'CONTACT', ownerId: ID.cPriv, priority: 80, recommendedBy: 'KEY', executableByKey: true,
    });
    const intake = await commandService.create(ID.bizA, {
      title: `Reply to ${PRIVATE_NAME}`, description: 'Priya asked about her order', category: 'PEOPLE', actionType: 'respond',
      sourceModule: `${P}chan`, sourceType: 'message_intake', sourceId: `${P}chan2`, ownerType: 'KEY', ownerId: ID.cPriv, contactId: ID.cPriv, priority: 60, requiresApproval: true,
    });
    const got = since(mark);
    expect(leaks(got)).toEqual([]);
    expect(got.timeline.map((e: any) => [e.entityId, e.title, e.detail])).toEqual([
      [item.id, CONTACT_ITEM_LABEL, undefined],
      [intake.id, CONTACT_ITEM_LABEL, undefined],
    ]);
    expect(got.realtime.map((e: any) => [e.type, e.payload.id, e.payload.title])).toEqual([
      ['command.created', item.id, CONTACT_ITEM_LABEL],
      ['command.created', intake.id, CONTACT_ITEM_LABEL],
    ]);
    expect(got.notifications.map((n: any) => [n.title, n.body, n.data.commandId])).toEqual([
      [`High priority: ${CONTACT_ITEM_LABEL}`, undefined, item.id],
      [`Approval required: ${CONTACT_ITEM_LABEL}`, undefined, intake.id],
    ]);
    // the item itself keeps its title for those who may open it
    expect((await send('get', `${cmd}/items/${item.id}`, ID.owner)).body.title).toBe(`Collect: ${PRIVATE_NAME}`);
  });

  it('[CI-05b] every single-item mutation and every bulk call by the OWNER on such items records and emits the label, never the title', async () => {
    const mark = recorded();
    for (const r of SINGLE_MUTATIONS) {
      const item = await seedItem('priv');
      const res = await send(r.verb, `${cmd}/items/${item.id}${r.suffix}`, ID.owner, r.body?.());
      expect(res.status, r.key).toBe(okStatus(r.verb));
    }
    for (const action of ['complete', 'dismiss', 'delete']) {
      const ids = [
        (await seedShape(`${P}chb_${action}_1`, { contactId: ID.cPriv, title: `Call ${PRIVATE_NAME}` })).id,
        (await seedShape(`${P}chb_${action}_2`, { entityType: 'contact', entityId: ID.cPriv, title: `Slow payer: ${PRIVATE_NAME}` })).id,
      ];
      expect((await send('post', `${cmd}/items/bulk/${action}`, ID.owner, { ids })).status, action).toBe(201);
    }
    // assigning an item that named no contact to the contact announces the label too
    const plain = await seedItem('none');
    await db.commandItem.update({ where: { id: plain.id }, data: { title: `Visit ${PRIVATE_NAME}` } });
    expect((await send('post', `${cmd}/items/${plain.id}/assign`, ID.owner, { ownerType: 'CONTACT', ownerId: ID.cPriv })).status).toBe(201);
    const got = since(mark);
    expect(leaks(got)).toEqual([]);
    // every single-item mutation but discharge (which records no timeline event), two per bulk call, and the assign
    expect(got.timeline.length).toBe(SINGLE_MUTATIONS.length - 1 + 6 + 1);
    for (const e of got.timeline as any[]) expect(e.title, e.action).toMatch(new RegExp(`^[A-Z][a-z]+: ${CONTACT_ITEM_LABEL}$`));
    for (const e of got.realtime as any[]) if ('title' in e.payload) expect(e.payload.title, e.type).toBe(CONTACT_ITEM_LABEL);
    expect(got.realtime.map((e: any) => e.type).sort()).toEqual(
      ['command.assigned', 'command.assigned', 'command.bulk_completed', 'command.bulk_dismissed', 'command.completed', 'command.updated'].sort(),
    );
  });

  it('[CI-05c] control: an item that names no contact is announced with its title and description, as before', async () => {
    const mark = recorded();
    const item = await commandService.create(ID.bizA, {
      title: `${P}Weekly review`, description: 'Look at the week', category: 'WORK', actionType: 'review',
      sourceModule: `${P}chan`, sourceType: 'plain', sourceId: `${P}chan3`, priority: 80,
    });
    expect((await send('post', `${cmd}/items/${item.id}/complete`, ID.owner)).status).toBe(201);
    const got = since(mark);
    expect(got.timeline.map((e: any) => [e.title, e.detail ?? null])).toEqual([
      [`${P}Weekly review`, 'Look at the week'],
      [`Completed: ${P}Weekly review`, null],
    ]);
    expect(got.notifications.map((n: any) => [n.title, n.body])).toEqual([[`High priority: ${P}Weekly review`, 'Look at the week']]);
    expect(got.realtime.map((e: any) => e.payload.title)).toEqual([`${P}Weekly review`, `${P}Weekly review`]);
  });
});

/**
 * KEY path (review ST-D10-3, CR-2), closed by W9-KEY-OBLIGATIONS-CALLS (owner ruling D-88: KEY acts
 * as the member the command runs for). command_list_due_obligations and command_discharge_obligation
 * called findDue and discharge without the requesting member, so through KEY a crm_view 'owned' member
 * listed and discharged the obligations GET items/due and POST items/:id/discharge withhold from them.
 * The dispatcher now hands CommandService the member (the surface's principal, or the member a surface
 * with no principal runs for), so the FOLLOW3-D10 rule applies to them as on the routes. The real
 * FlowOrchestratorService dispatcher (executeToolAction) runs over this suite's real PrismaService and
 * CommandService.
 */
describe('KEY path (review ST-D10-3, CR-2; W9-KEY-OBLIGATIONS-CALLS, D-88)', () => {
  async function keyRun(tool: string, args: Record<string, unknown>, action: Record<string, unknown>) {
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { CommandService } = await import('../src/modules/command/command.service');
    const dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: prismaSvc,
      moduleRef: { get: (token: unknown) => (token === CommandService ? commandService : undefined) },
    });
    return dispatcher.executeToolAction(ID.bizA, tool, args, action);
  }

  /** A KEY call's refusal as { status, message }, or null when the call resolved. */
  const keyRefusal = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: any) => ({ status: typeof err?.getStatus === 'function' ? err.getStatus() : undefined, message: err?.message }),
    );

  const chat = (member: string) => ({ surface: 'CHAT', principalUserId: member });
  const runFor = (member: string) => ({ surface: 'PROPOSAL', onBehalfOfUserId: member });

  it("[KEY-01] command_list_due_obligations and command_discharge_obligation act with the requesting member's CRM visibility: through KEY a crm_view owned member's due list leaves out the obligation of a contact they cannot open, exactly as GET items/due does, and discharging it answers as an unknown id with the row unchanged and nothing recorded (D-88) (W9-KEY-OBLIGATIONS-CALLS, was it.todo)", async () => {
    // the due list, for each restricted member, on a member's chat and on a surface run for them
    for (const member of [ID.staffOwned, ID.writerOwned, ID.staffAll]) {
      for (const action of [chat(member), runFor(member)]) {
        const label = `${member} ${action.surface}`;
        const key = await keyRun('command_list_due_obligations', { limit: 500 }, action);
        const rest = await send('get', `${cmd}/items/due?limit=500`, member);
        expect(rest.status, label).toBe(200);
        expect(listIds(key), label).not.toContain(ID.iPriv);
        expect(listIds(key), label).toEqual(listIds(rest.body));
        expect(key.total, label).toBe(rest.body.total);
        expect(key.overdueCount, label).toBe(rest.body.overdueCount);
        // no listed obligation names the PRIVATE contact through any column (an item CI-05b's assign
        // moved off the contact keeps its old title but names no contact: the routes list it too)
        for (const i of key.items) expect(namedContacts(i), `${label} ${i.id}`).not.toContain(ID.cPriv);
      }
    }

    // discharge: the member who may write operations, on both surfaces
    for (const action of [chat(ID.writerOwned), runFor(ID.writerOwned)]) {
      const label = String(action.surface);
      const item = await seedItem('priv');
      const before = await rowOf(item.id);
      const rec = recorded();
      const hidden = await keyRefusal(keyRun('command_discharge_obligation', { obligationId: item.id, dischargeRef: `${P}key` }, action));
      const unknown = await keyRefusal(keyRun('command_discharge_obligation', { obligationId: ID.unknown, dischargeRef: `${P}key` }, action));
      expect(hidden, label).toEqual({ status: 404, message: 'Command item not found' });
      expect(unknown, label).toEqual(hidden);
      // POST items/:id/discharge answers the same member the same way
      const rest = await send('post', `${cmd}/items/${item.id}/discharge`, ID.writerOwned, { dischargeRef: `${P}paid` });
      expect([rest.status, rest.body.message], label).toEqual([hidden!.status, hidden!.message]);
      expect(await rowOf(item.id), label).toBe(before);
      expect(recorded(), label).toEqual(rec);
    }
  });

  it('[KEY-01b] CONTROL: through KEY the OWNER and the member the contact is shared with list and discharge that obligation, and a restricted member discharges one that names no contact (W9-KEY-OBLIGATIONS-CALLS)', async () => {
    for (const member of [ID.owner, ID.writerShared]) {
      const due = await keyRun('command_list_due_obligations', { limit: 500 }, chat(member));
      expect(listIds(due), member).toContain(ID.iPriv);
      const item = await seedItem('priv');
      const out = await keyRun('command_discharge_obligation', { obligationId: item.id, dischargeRef: `${P}key` }, chat(member));
      expect(out, member).toMatchObject({ id: item.id, alreadyDischarged: false });
      expect((await db.commandItem.findUnique({ where: { id: item.id } })).dischargeRef, member).toBe(`${P}key`);
    }
    const plain = await seedItem('none');
    const out = await keyRun('command_discharge_obligation', { obligationId: plain.id }, runFor(ID.writerOwned));
    expect(out).toMatchObject({ id: plain.id, alreadyDischarged: false });
    expect((await db.commandItem.findUnique({ where: { id: plain.id } })).dischargedAt).not.toBeNull();
  });
});
