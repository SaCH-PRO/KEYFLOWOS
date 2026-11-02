/**
 * R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT (owner ruling D-40) — the command-centre
 * item routes and the procurement routes require the existing 'operations'
 * module scope, against a REAL database.
 *
 * Before this packet every route of CommandController (/command/businesses/:id)
 * ran behind AuthGuard and BusinessGuard only, and every route of
 * ProcurementController (/procurement/businesses/:id) behind AuthGuard,
 * CrmRateLimitGuard and BusinessGuard: a business membership was the whole
 * check. CANONICAL_MODULES (core/authority/module-vocabulary.ts) has no key for
 * either, so a member whose scope map grants nothing on operations still listed,
 * created, completed, dismissed, approved and deleted command items, and
 * created, edited and submitted procurement requests and issued purchase
 * orders for them (procurement approve and reject reached their handler too,
 * which fails for every caller on a separate defect: KNOWN_HANDLER_FAILURE).
 * D-40 rules: gate them under the existing 'operations' module scope (OWNER and
 * ADMIN keep access), no new module key.
 *
 * The gate is the existing one: ModuleScopeGuard with @RequireModuleScope on
 * each handler (the guard reads the HANDLER's metadata only), 'read' for a GET
 * and 'write' for every mutation. The approvals (command item approve,
 * procurement approve, reject, issue-po and invoice) are at 'write', the level
 * the operations vocabulary already gives an approval: payroll runs/:id/approve,
 * data-inbox items/:id/approve and ai-approvals items/:id/resolve are all
 * operations 'write'; the only 'admin' route requirement in the server is team
 * role and permission changes. Approval TIER is a separate output
 * (module-vocabulary DEFAULT_APPROVAL_TIERS) and is not merged into the level.
 *
 * Role defaults (module-vocabulary ROLE_DEFAULT_SCOPES, used only when a
 * membership has no explicit map): OWNER and ADMIN operations 'admin', STAFF
 * operations 'read'. So after the gate a STAFF member on role defaults can read
 * both surfaces but not mutate them; a member whose explicit map has no
 * operations key (EXPLICIT_MAP_MISSING_KEY = none) or says 'none' is refused on
 * every route.
 *
 * The cockpit snapshot (business-command-center.controller.ts) is the census's
 * one named exception: it reads no command item and no procurement row (it
 * aggregates KEY proposals, genome, briefs and per-scope result tiles), V1-47
 * projects each tile by the member's own crm and revenue scopes, and
 * release0-journey.integration.test.ts (step 5, an R0 exit proof) pins a STAFF
 * member invited with { crm: 'read', crm_view: 'owned', revenue: 'none' } (no
 * operations key) reading it 200. Gating it would break that proof, so it stays
 * open to every member and is recorded as a todo for the owner (OPS-T01).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership, command item, procurement request, supplier
 * connection and purchase order rows, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, the global ValidationPipe and
 * GlobalHttpExceptionFilter, CommandController, ProcurementController,
 * BusinessCommandCenterController, CommandService and ProcurementService are
 * real against DATABASE_URL. The stand-ins are recorders behind the guards:
 * identity attachment (a test middleware reads `x-test-user` and attaches the
 * seeded user row as AuthMiddleware would), TimelineService, RealtimeService,
 * NotificationsService, the command generator and scheduler (a scan would be
 * AI and cross-module traffic) and BusinessCommandCenterService (its snapshot
 * fans out to a dozen services; the claim here is only whether the handler is
 * reached). The app trusts the proxy header as app-bootstrap.ts does and every
 * request carries its own x-forwarded-for address, so CrmRateLimitGuard's
 * per-address buckets never cap the case count.
 *
 * Requires DATABASE_URL. Every seeded row carries the `k13o_` prefix and is
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll. No
 * $transaction wrapping. Cases tagged RED-BEFORE fail on the unmodified
 * controllers; the others are controls that pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k13o_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit scope map (role default operations admin)
  admin: `${P}admin`, // ADMIN of bizA, no explicit scope map (role default operations admin)
  noOps: `${P}noOps`, // STAFF of bizA, explicit map with no operations key (crm read)
  opsNone: `${P}opsNone`, // STAFF of bizA, explicit operations: none
  opsRead: `${P}opsRead`, // STAFF of bizA, explicit operations: read
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (role default operations read)
  opsWrite: `${P}opsWrite`, // STAFF of bizA, explicit operations: write
  outsider: `${P}outsider`, // OWNER of bizB, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};
const SUPPLIER = { a: `${P}sup_a`, b: `${P}sup_b` };

// ---- recorders behind the guards --------------------------------------------
const reached: string[] = [];
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
const generator = {
  async generateForBusiness(businessId: string) {
    reached.push(`generator.generateForBusiness:${businessId}`);
    return { created: 0 };
  },
};
const scheduler = {
  async getLastScanTime(businessId: string) {
    reached.push(`scheduler.getLastScanTime:${businessId}`);
    return null;
  },
  async shouldAutoScan(businessId: string) {
    reached.push(`scheduler.shouldAutoScan:${businessId}`);
    return false;
  },
};
const cockpit = {
  async snapshot(businessId: string) {
    reached.push(`cockpit.snapshot:${businessId}`);
    return { businessId, generatedAt: new Date().toISOString() };
  },
};

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
const controllers: Record<string, any> = {};

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM procurement_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM supplier_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let ipSeq = 0;
/** A distinct client address per request, so CrmRateLimitGuard's per-address buckets never cap the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.31.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

type Verb = 'get' | 'post' | 'patch' | 'delete';

/** A request as `actor` (undefined: no identity attached, as an unauthenticated caller). */
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url).set('x-forwarded-for', nextIp());
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

let seq = 0;
async function seedCommandItem(businessId: string, kind: 'SUGGESTION' | 'OBLIGATION' = 'SUGGESTION') {
  seq += 1;
  return db.commandItem.create({
    data: {
      id: `${P}ci_${seq}`,
      businessId,
      sourceModule: 'k13o',
      title: `${P}Item ${seq}`,
      category: 'WORK',
      actionType: 'k13o_check',
      status: 'OPEN',
      kind,
      dueAt: kind === 'OBLIGATION' ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) : undefined,
    },
  });
}

async function seedProcurementRequest(businessId: string, opts: { supplier?: string } = {}) {
  seq += 1;
  return db.procurementRequest.create({
    data: {
      id: `${P}pr_${seq}`,
      businessId,
      status: 'DRAFT',
      priority: 'normal',
      userPrompt: `${P}need ${seq}`,
      interpretedNeed: { category: 'k13o' },
      estimatedBudget: { min: 0, max: 250 },
      supplierConnectionId: opts.supplier ?? null,
    },
  });
}

/**
 * Every route of the three controllers, keyed `<Controller>.<handler>`, with
 * the level D-40 requires and how to build one request to it. `build` seeds
 * what the route acts on (a fresh row per call) and returns the url and body.
 */
interface RouteCase {
  key: string;
  verb: Verb;
  level: 'read' | 'write' | 'open';
  build: (biz: string) => Promise<{ url: string; body?: unknown }>;
}

const cmd = (biz: string) => `/command/businesses/${biz}`;
const proc = (biz: string) => `/procurement/businesses/${biz}`;
const item = async (biz: string, suffix: string, kind?: 'SUGGESTION' | 'OBLIGATION') =>
  `${cmd(biz)}/items/${(await seedCommandItem(biz, kind)).id}${suffix}`;
const preq = async (biz: string, suffix: string, opts?: { supplier?: string }) =>
  `${proc(biz)}/${(await seedProcurementRequest(biz, opts)).id}${suffix}`;
const supplierOf = (biz: string) => (biz === ID.bizA ? SUPPLIER.a : SUPPLIER.b);

const COMMAND_ROUTES: RouteCase[] = [
  { key: 'CommandController.list', verb: 'get', level: 'read', build: async (b) => ({ url: `${cmd(b)}/items` }) },
  { key: 'CommandController.due', verb: 'get', level: 'read', build: async (b) => ({ url: `${cmd(b)}/items/due` }) },
  { key: 'CommandController.getOne', verb: 'get', level: 'read', build: async (b) => ({ url: await item(b, '') }) },
  {
    key: 'CommandController.create', verb: 'post', level: 'write',
    build: async (b) => ({ url: `${cmd(b)}/items`, body: { sourceModule: 'k13o', title: `${P}created`, category: 'WORK', actionType: 'k13o_check' } }),
  },
  { key: 'CommandController.update', verb: 'patch', level: 'write', build: async (b) => ({ url: await item(b, ''), body: { title: `${P}renamed` } }) },
  { key: 'CommandController.bulkComplete', verb: 'post', level: 'write', build: async (b) => ({ url: `${cmd(b)}/items/bulk/complete`, body: { ids: [(await seedCommandItem(b)).id] } }) },
  { key: 'CommandController.bulkDismiss', verb: 'post', level: 'write', build: async (b) => ({ url: `${cmd(b)}/items/bulk/dismiss`, body: { ids: [(await seedCommandItem(b)).id] } }) },
  { key: 'CommandController.bulkDelete', verb: 'post', level: 'write', build: async (b) => ({ url: `${cmd(b)}/items/bulk/delete`, body: { ids: [(await seedCommandItem(b)).id] } }) },
  { key: 'CommandController.dismiss', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/dismiss') }) },
  {
    key: 'CommandController.snooze', verb: 'post', level: 'write',
    build: async (b) => ({ url: await item(b, '/snooze'), body: { until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() } }),
  },
  { key: 'CommandController.approve', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/approve') }) },
  { key: 'CommandController.execute', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/execute'), body: { result: { k13o: true } } }) },
  { key: 'CommandController.complete', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/complete') }) },
  { key: 'CommandController.discharge', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/discharge', 'OBLIGATION'), body: { dischargeRef: `${P}paid` } }) },
  { key: 'CommandController.assign', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/assign'), body: { ownerType: 'USER', ownerId: ID.owner } }) },
  { key: 'CommandController.reopen', verb: 'post', level: 'write', build: async (b) => ({ url: await item(b, '/reopen') }) },
  { key: 'CommandController.delete', verb: 'delete', level: 'write', build: async (b) => ({ url: await item(b, '') }) },
  { key: 'CommandController.generate', verb: 'post', level: 'write', build: async (b) => ({ url: `${cmd(b)}/generate` }) },
  { key: 'CommandController.summary', verb: 'get', level: 'read', build: async (b) => ({ url: `${cmd(b)}/summary` }) },
  { key: 'CommandController.lastScan', verb: 'get', level: 'read', build: async (b) => ({ url: `${cmd(b)}/last-scan` }) },
  { key: 'CommandController.autoScan', verb: 'post', level: 'write', build: async (b) => ({ url: `${cmd(b)}/auto-scan` }) },
];

const PROCUREMENT_ROUTES: RouteCase[] = [
  { key: 'ProcurementController.list', verb: 'get', level: 'read', build: async (b) => ({ url: proc(b) }) },
  { key: 'ProcurementController.create', verb: 'post', level: 'write', build: async (b) => ({ url: proc(b), body: { userPrompt: `${P}need printer paper`, priority: 'normal' } }) },
  { key: 'ProcurementController.listSuppliers', verb: 'get', level: 'read', build: async (b) => ({ url: `${proc(b)}/suppliers` }) },
  { key: 'ProcurementController.stats', verb: 'get', level: 'read', build: async (b) => ({ url: `${proc(b)}/stats` }) },
  { key: 'ProcurementController.get', verb: 'get', level: 'read', build: async (b) => ({ url: await preq(b, '') }) },
  { key: 'ProcurementController.update', verb: 'patch', level: 'write', build: async (b) => ({ url: await preq(b, ''), body: { internalNotes: `${P}note` } }) },
  { key: 'ProcurementController.submit', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/submit') }) },
  { key: 'ProcurementController.approve', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/approve') }) },
  { key: 'ProcurementController.reject', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/reject'), body: { reason: `${P}not now` } }) },
  { key: 'ProcurementController.selectVendor', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/vendor'), body: { supplierConnectionId: supplierOf(b) } }) },
  { key: 'ProcurementController.issuePO', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/issue-po', { supplier: supplierOf(b) }) }) },
  { key: 'ProcurementController.acknowledgeVendor', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/acknowledge') }) },
  { key: 'ProcurementController.markFulfilled', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/fulfill') }) },
  { key: 'ProcurementController.markInvoiced', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/invoice') }) },
];

/** The census's one named exception (see the header): open to every member of the business. */
const COCKPIT_ROUTES: RouteCase[] = [
  { key: 'BusinessCommandCenterController.snapshot', verb: 'get', level: 'open', build: async (b) => ({ url: `/business-command-center/businesses/${b}/snapshot` }) },
];

const GATED_ROUTES = [...COMMAND_ROUTES, ...PROCUREMENT_ROUTES];
const ALL_ROUTES = [...GATED_ROUTES, ...COCKPIT_ROUTES];

/**
 * Found while proving this packet, outside its write set: procurement approve
 * and reject answer 500 to every caller the gate admits, OWNER included,
 * before and after D-40. ProcurementService.updateStatus writes approvedAt,
 * approvedByUserId, rejectedAt, rejectedByUserId and rejectionReason, and the
 * ProcurementRequest model (packages/db/prisma/schema.prisma) has none of them,
 * so Prisma refuses the update and the row is unchanged. The positive controls
 * pin that answer (the handler ran: a refused caller gets 401 or 403 instead);
 * a fix of the service or the schema flips these two entries to 201.
 */
const KNOWN_HANDLER_FAILURE: Record<string, number> = {
  'ProcurementController.approve': 500,
  'ProcurementController.reject': 500,
};

/**
 * Review CR-2: a case that seeds and sends every route for one or more actors makes up to ~70
 * real-database requests, which took 3.2-5.0 s on a shared machine against vitest's default
 * 5 s budget (and a timed-out case left requests in flight that reset the next case). These
 * cases name their own budget, as the other integration suites do.
 */
const HEAVY_CASE_MS = 60_000;

const okStatus = (verb: Verb) => (verb === 'post' ? 201 : 200);
/** What a caller the gate admits gets: the handler's own answer. */
const admittedStatus = (r: RouteCase) => KNOWN_HANDLER_FAILURE[r.key] ?? okStatus(r.verb);

/** Build every route's request first (seeding its rows), so state can be captured between building and sending. */
async function buildAll(routes: RouteCase[], biz = ID.bizA) {
  const out: Array<RouteCase & { url: string; body?: unknown }> = [];
  for (const r of routes) out.push({ ...r, ...(await r.build(biz)) });
  return out;
}

/** Send each built request as `actor`; answer `{ key: status }` and keep the bodies for the message checks. */
async function sendAll(built: Array<RouteCase & { url: string; body?: unknown }>, actor: string | undefined) {
  const statuses: Record<string, number> = {};
  const bodies: Record<string, any> = {};
  for (const r of built) {
    const res = await send(r.verb, r.url, actor, r.body);
    statuses[r.key] = res.status;
    bodies[r.key] = res.body;
  }
  return { statuses, bodies };
}

/** Every row these routes may write (both tenants), whole, plus every recorder: what "nothing written" compares. */
async function writableState() {
  const rows = async (table: string) =>
    db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
  return {
    commandItems: await rows('command_items'),
    procurementRequests: await rows('procurement_requests'),
    purchaseOrders: await rows('purchase_orders'),
    supplierConnections: await rows('supplier_connections'),
    timeline: timeline.events.length,
    realtime: realtime.emits.length,
    notifications: notifications.created.length,
    reached: [...reached],
  };
}

const expectedAll = (routes: RouteCase[], status: (r: RouteCase) => number) =>
  Object.fromEntries(routes.map((r) => [r.key, status(r)]));

/** The routes found on a controller class through Nest's own metadata, with the guard chain and handler scope. */
function census(cls: any) {
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const fn = cls.prototype[name];
      const routePath = Reflect.getMetadata(PATH_METADATA, fn);
      if (routePath === undefined) return [];
      const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      return [{
        key: `${cls.name}.${name}`,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)] as string,
        path: routePath as string,
        guards: [...classGuards, ...methodGuards].map((g) => g.name as string),
        scope: Reflect.getMetadata(MODULE_SCOPE_KEY, fn) as { module: string; minLevel: string } | undefined,
      }];
    });
}

/** What D-40 requires of one route found by census(): the problems, or [] when it complies. */
function censusProblems(r: ReturnType<typeof census>[number]): string[] {
  const problems: string[] = [];
  const at = (g: string) => r.guards.indexOf(g);
  for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
    if (at(g) < 0) problems.push(`${r.key} (${r.method} ${r.path}) does not run behind ${g}`);
  }
  if (at('ModuleScopeGuard') >= 0 && at('ModuleScopeGuard') < at('BusinessGuard')) {
    problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
  }
  const want = { module: 'operations', minLevel: r.method === 'GET' ? 'read' : 'write' };
  if (r.scope?.module !== want.module || r.scope?.minLevel !== want.minLevel) {
    problems.push(`${r.key} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not operations:${want.minLevel}`);
  }
  return problems;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { ModuleScopeGuard } = scopeMod;
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { CommandController } = await import('../src/modules/command/command.controller');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { CommandGeneratorService } = await import('../src/modules/command/command-generator.service');
  const { CommandSchedulerService } = await import('../src/modules/command/command-scheduler.service');
  const { BulkCommandItemsDto } = await import('../src/modules/command/dto/bulk-command-items.dto');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { ProcurementController } = await import('../src/modules/procurement/procurement.controller');
  const { ProcurementService } = await import('../src/modules/procurement/procurement.service');
  const { BusinessCommandCenterController } = await import('../src/modules/business-command-center/business-command-center.controller');
  const { BusinessCommandCenterService } = await import('../src/modules/business-command-center/business-command-center.service');
  Object.assign(controllers, { CommandController, ProcurementController, BusinessCommandCenterController });

  // The parameter types tsc emits (emitDecoratorMetadata), which vitest's
  // esbuild transform does not: the bulk bodies validate as BulkCommandItemsDto
  // as in production, and ProcurementController (no @Inject on its
  // constructor) gets its service, as shadowed-routes-live does.
  for (const handler of ['bulkComplete', 'bulkDismiss', 'bulkDelete']) {
    Reflect.defineMetadata('design:paramtypes', [String, BulkCommandItemsDto], CommandController.prototype, handler);
  }
  Reflect.defineMetadata('design:paramtypes', [ProcurementService], ProcurementController);

  // ---- the real HTTP path (wired before any row is seeded) ----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CommandController, ProcurementController, BusinessCommandCenterController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      CommandService,
      ProcurementService,
      { provide: TimelineService, useValue: timeline },
      { provide: RealtimeService, useValue: realtime },
      { provide: NotificationsService, useValue: notifications },
      { provide: CommandGeneratorService, useValue: generator },
      { provide: CommandSchedulerService, useValue: scheduler },
      { provide: BusinessCommandCenterService, useValue: cockpit },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only, for seeded k13o_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
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

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships -----------------------------------
  for (const id of [ID.owner, ID.admin, ID.noOps, ID.opsNone, ID.opsRead, ID.staffDefault, ID.opsWrite, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13O Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'K13O Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.noOps, ID.bizA, 'STAFF', { crm: 'read' });
  await m(ID.opsNone, ID.bizA, 'STAFF', { crm: 'read', operations: 'none' });
  await m(ID.opsRead, ID.bizA, 'STAFF', { operations: 'read' });
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.opsWrite, ID.bizA, 'STAFF', { operations: 'write' });
  await m(ID.outsider, ID.bizB, 'OWNER');

  // ---- supplier connections (one active per tenant) ------------------------
  for (const [id, businessId] of [[SUPPLIER.a, ID.bizA], [SUPPLIER.b, ID.bizB]] as const) {
    await db.supplierConnection.create({
      data: { id, businessId, providerType: 'manual', displayName: `${id} Supplies`, isActive: true, syncCapabilities: [] },
    });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('route census: command.controller.ts, procurement.controller.ts and business-command-center.controller.ts', () => {
  it("[OPS-C01] RED-BEFORE: every CommandController and ProcurementController route runs behind AuthGuard, BusinessGuard and then ModuleScopeGuard and requires 'operations' on its handler: read for a GET, write for every mutation (approve, reject, issue-po and invoice included)", () => {
    const routes = [...census(controllers.CommandController), ...census(controllers.ProcurementController)];
    expect(routes.length).toBe(GATED_ROUTES.length);
    expect(routes.flatMap(censusProblems)).toEqual([]);
  });

  it('[OPS-C02] the census is complete: the routes Nest finds on the three controllers are exactly the routes this suite sends over HTTP, at the level the table names; a route added to any of them fails here until it is listed (and refused below to a member without operations)', () => {
    const found = [
      ...census(controllers.CommandController),
      ...census(controllers.ProcurementController),
      ...census(controllers.BusinessCommandCenterController),
    ];
    expect(found.map((r) => r.key).sort()).toEqual(ALL_ROUTES.map((r) => r.key).sort());
    for (const r of found) {
      const row = ALL_ROUTES.find((x) => x.key === r.key)!;
      expect(r.method.toLowerCase(), r.key).toBe(row.verb);
      expect(row.level, r.key).toBe(r.key.startsWith('BusinessCommandCenterController.') ? 'open' : r.method === 'GET' ? 'read' : 'write');
    }
  });

  it('[OPS-C03] the cockpit snapshot is the named exception: it runs behind AuthGuard, BusinessGuard and ModuleScopeGuard with no module requirement; any other route on business-command-center.controller.ts must carry operations like the rest', () => {
    const routes = census(controllers.BusinessCommandCenterController);
    const snapshot = routes.find((r) => r.key === 'BusinessCommandCenterController.snapshot');
    expect(snapshot).toMatchObject({ method: 'GET', path: 'snapshot', scope: undefined });
    expect(snapshot!.guards).toEqual(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']);
    expect(routes.filter((r) => r !== snapshot).flatMap(censusProblems)).toEqual([]);
  });

  it('[OPS-C04] the census reader sees class and method guards and the handler scope, and flags an undecorated route (anti-vacuity)', async () => {
    const { Controller, Get, Post, UseGuards } = await import('@nestjs/common');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard, RequireModuleScope } = await import('../src/core/auth/module-scope.guard');
    @Controller('x/businesses/:businessId')
    @UseGuards(AuthGuard, BusinessGuard)
    class Synthetic {
      @UseGuards(ModuleScopeGuard) @RequireModuleScope('operations', 'read') @Get('a') a() {}
      @UseGuards(ModuleScopeGuard) @RequireModuleScope('operations', 'read') @Post('b') b() {}
      @UseGuards(ModuleScopeGuard) @Post('c') c() {}
      @Get('d') d() {}
      @UseGuards(ModuleScopeGuard) @RequireModuleScope('crm', 'write') @Post('e') e() {}
    }
    const routes = census(Synthetic);
    expect(routes.map((r) => r.key)).toEqual(['Synthetic.a', 'Synthetic.b', 'Synthetic.c', 'Synthetic.d', 'Synthetic.e']);
    expect(routes[0]).toEqual({
      key: 'Synthetic.a', method: 'GET', path: 'a',
      guards: ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard'],
      scope: { module: 'operations', minLevel: 'read' },
    });
    expect(Object.fromEntries(routes.map((r) => [r.key, censusProblems(r).length]))).toEqual({
      'Synthetic.a': 0, 'Synthetic.b': 1, 'Synthetic.c': 1, 'Synthetic.d': 2, 'Synthetic.e': 1,
    });
  });
});

describe('the operations gate over HTTP (real guards, real rows)', () => {
  it('[OPS-01] fixture: seven bizA members (OWNER and ADMIN on role defaults, STAFF with no operations key, operations none, read, role default and write) and bizB with its own owner, one active supplier connection each', async () => {
    const rows = await db.membership.findMany({ where: { businessId: ID.bizA }, orderBy: { id: 'asc' } });
    expect(Object.fromEntries(rows.map((r: any) => [r.userId.slice(P.length), [r.role, r.permissionScopes]]))).toEqual({
      owner: ['OWNER', null],
      admin: ['ADMIN', null],
      noOps: ['STAFF', { crm: 'read' }],
      opsNone: ['STAFF', { crm: 'read', operations: 'none' }],
      opsRead: ['STAFF', { operations: 'read' }],
      staffDefault: ['STAFF', null],
      opsWrite: ['STAFF', { operations: 'write' }],
    });
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.supplierConnection.count({ where: { businessId: { in: [ID.bizA, ID.bizB] }, isActive: true } })).toBe(2);
  });

  it("[OPS-02] RED-BEFORE: a STAFF member whose scope map has no operations key, and one whose map says operations 'none', gets 403 (operations requires read or write) on every command-centre item route (items list, due, read, create, PATCH, bulk complete, dismiss and delete, dismiss, snooze, approve, execute, complete, discharge, assign, reopen, DELETE, generate, summary, last-scan, auto-scan) and nothing is written", async () => {
    for (const actor of [ID.noOps, ID.opsNone]) {
      const built = await buildAll(COMMAND_ROUTES);
      const before = await writableState();
      const { statuses, bodies } = await sendAll(built, actor);
      expect(statuses, actor).toEqual(expectedAll(COMMAND_ROUTES, () => 403));
      for (const r of COMMAND_ROUTES) {
        expect(bodies[r.key].message, `${actor} ${r.key}`).toBe(`Insufficient permissions: operations requires ${r.level} access (you have none)`);
      }
      expect(await writableState(), `${actor}: nothing written`).toEqual(before);
    }
  }, HEAVY_CASE_MS);

  it("[OPS-03] RED-BEFORE: the same two members get 403 on every procurement route (list, create, suppliers, stats, read, PATCH, submit, approve, reject, vendor, issue-po, acknowledge, fulfill, invoice) and nothing is written: no request changes, no purchase order is issued", async () => {
    for (const actor of [ID.noOps, ID.opsNone]) {
      const built = await buildAll(PROCUREMENT_ROUTES);
      const before = await writableState();
      const { statuses, bodies } = await sendAll(built, actor);
      expect(statuses, actor).toEqual(expectedAll(PROCUREMENT_ROUTES, () => 403));
      for (const r of PROCUREMENT_ROUTES) {
        expect(bodies[r.key].message, `${actor} ${r.key}`).toBe(`Insufficient permissions: operations requires ${r.level} access (you have none)`);
      }
      expect(await writableState(), `${actor}: nothing written`).toEqual(before);
    }
  }, HEAVY_CASE_MS);

  it("[OPS-04] RED-BEFORE: operations 'read' (an explicit grant, and a STAFF member on role defaults) lists and reads every command-centre and procurement GET (200) but every mutation answers 403 (operations requires write, you have read) and nothing is written", async () => {
    for (const actor of [ID.opsRead, ID.staffDefault]) {
      const built = await buildAll(GATED_ROUTES);
      const before = await writableState();
      const { statuses, bodies } = await sendAll(built, actor);
      expect(statuses, actor).toEqual(expectedAll(GATED_ROUTES, (r) => (r.level === 'read' ? 200 : 403)));
      for (const r of GATED_ROUTES.filter((x) => x.level === 'write')) {
        expect(bodies[r.key].message, `${actor} ${r.key}`).toBe('Insufficient permissions: operations requires write access (you have read)');
      }
      // The reads are reads: rows and recorders as they were, apart from the scheduler's last-scan lookups.
      const after = await writableState();
      expect({ ...after, reached: after.reached.slice(before.reached.length).filter((r) => !r.startsWith('scheduler.')) }, actor)
        .toEqual({ ...before, reached: [] });
    }
  }, HEAVY_CASE_MS);

  it("[OPS-05] operations 'write' reaches every command-centre and procurement route (GET 200, PATCH and DELETE 200, POST 201; procurement approve and reject 500, KNOWN_HANDLER_FAILURE): the gate refuses on scope, not on role", async () => {
    const built = await buildAll(GATED_ROUTES);
    const { statuses, bodies } = await sendAll(built, ID.opsWrite);
    expect(statuses, JSON.stringify(Object.fromEntries(Object.entries(bodies).filter(([k]) => statuses[k] >= 300)))).toEqual(
      expectedAll(GATED_ROUTES, admittedStatus),
    );
    expect(bodies['ProcurementController.issuePO']).toMatchObject({ status: 'PO_ISSUED', purchaseOrder: { businessId: ID.bizA, supplierConnectionId: SUPPLIER.a } });
    expect(bodies['ProcurementController.submit']).toMatchObject({ status: 'SUBMITTED', businessId: ID.bizA });
    expect(bodies['CommandController.complete']).toMatchObject({ status: 'COMPLETED', businessId: ID.bizA });
  }, HEAVY_CASE_MS);

  it('[OPS-06] OWNER and ADMIN (role defaults, operations admin) keep every route, the cockpit snapshot included (procurement approve and reject 500, KNOWN_HANDLER_FAILURE)', async () => {
    for (const actor of [ID.owner, ID.admin]) {
      const built = await buildAll(ALL_ROUTES);
      const { statuses, bodies } = await sendAll(built, actor);
      expect(statuses, `${actor} ${JSON.stringify(Object.fromEntries(Object.entries(bodies).filter(([k]) => statuses[k] >= 300)))}`).toEqual(
        expectedAll(ALL_ROUTES, admittedStatus),
      );
    }
  }, HEAVY_CASE_MS);

  it("[OPS-07] refusal: an unauthenticated caller gets 401 and another tenant's owner 403 on every route of the three controllers, and nothing is written", async () => {
    const built = await buildAll(ALL_ROUTES);
    const before = await writableState();
    expect((await sendAll(built, undefined)).statuses).toEqual(expectedAll(ALL_ROUTES, () => 401));
    expect((await sendAll(built, ID.outsider)).statuses).toEqual(expectedAll(ALL_ROUTES, () => 403));
    expect(await writableState()).toEqual(before);
  }, HEAVY_CASE_MS);

  it("[OPS-08] the cockpit snapshot stays open to a member without operations (the census's named exception): the STAFF member with no operations key and the one with operations 'none' read it 200, as release0-journey's step 5 STAFF member does", async () => {
    for (const actor of [ID.noOps, ID.opsNone]) {
      const res = await send('get', `/business-command-center/businesses/${ID.bizA}/snapshot`, actor);
      expect(res.status, actor).toBe(200);
      expect(res.body.businessId).toBe(ID.bizA);
    }
  });

  it("[OPS-09] review SEC-R013g-2: a member of bizA the gate admits (STAFF operations write, and the OWNER) who sends another tenant's command item or procurement request id through bizA's own path gets 404 on every route that takes an id (the single-item routes, the bulk bodies, PATCH, submit, approve, reject, vendor, issue-po, acknowledge, fulfill, invoice) and bizB's rows are unchanged. This harness arms no TenantInterceptor, so the route's own binding is what is proven: acknowledge, fulfill and invoice look the request up in the path business before the transition, as submit and vendor do", async () => {
    // A request bizB has carried to PO_ISSUED, so each procurement transition would be a real change.
    const foreignRequest = async (suffix: string) => {
      const row = await seedProcurementRequest(ID.bizB, { supplier: SUPPLIER.b });
      await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'PO_ISSUED' } });
      return `${proc(ID.bizB)}/${row.id}${suffix}`;
    };
    const FOREIGN_BUILD: Record<string, () => Promise<{ url: string; body?: unknown }>> = {
      'ProcurementController.acknowledgeVendor': async () => ({ url: await foreignRequest('/acknowledge') }),
      'ProcurementController.markFulfilled': async () => ({ url: await foreignRequest('/fulfill') }),
      'ProcurementController.markInvoiced': async () => ({ url: await foreignRequest('/invoice') }),
    };
    const byId = (built: { url: string; body?: unknown }) =>
      built.url.includes(`${P}ci_`) || built.url.includes(`${P}pr_`) || Array.isArray((built.body as { ids?: unknown } | undefined)?.ids);
    for (const actor of [ID.opsWrite, ID.owner]) {
      const built: Array<RouteCase & { url: string; body?: unknown }> = [];
      for (const r of GATED_ROUTES) {
        // bizB's row, sent through bizA's path
        const b = FOREIGN_BUILD[r.key] ? await FOREIGN_BUILD[r.key]() : await r.build(ID.bizB);
        const url = b.url.replace(`/businesses/${ID.bizB}`, `/businesses/${ID.bizA}`);
        if (byId({ url, body: b.body })) built.push({ ...r, url, body: b.body });
      }
      // anti-vacuity: 14 command item routes (3 of them by body ids) and 10 procurement request routes take an id
      expect(built.length, actor).toBe(24);
      for (const r of built) {
        expect(r.url.startsWith(`/command/businesses/${ID.bizA}/`) || r.url.startsWith(`/procurement/businesses/${ID.bizA}/`), r.key).toBe(true);
      }
      const before = await writableState();
      const { statuses } = await sendAll(built, actor);
      expect(statuses, actor).toEqual(Object.fromEntries(built.map((r) => [r.key, 404])));
      expect(await writableState(), `${actor}: bizB unchanged, nothing written`).toEqual(before);
    }
  }, HEAVY_CASE_MS);

  it("[OPS-10] review SEC-R013g-1 / CR-1: KEY reaches a command or procurement tool only where HTTP admits the same member: the position envelope (JobRolePolicyService.envelopeForPosition, bounded by the holder's real membership row) gives no command_* or procurement_* tool to the members the gate refuses and only the read tools to operations read; the legacy 'procurement' family key reaches none of them; the three bare-id procurement transitions are reached by no key", async () => {
    const { JobRolePolicyService, CANONICAL_MODULE_TOOLS, GOVERNED_UNGRANTED } = await import('../src/modules/structure/job-role-policy.service');
    const { FLOW_TOOLS } = await import('../src/modules/ai/flow-tool-registry');
    const policy = new JobRolePolicyService();
    const tier = new Map(FLOW_TOOLS.map((t) => [t.name, t.riskTier as number]));
    // both envelope checks AiOversightService.evaluate applies: allowed, and within the tier cap
    const reaches = (env: ReturnType<typeof policy.envelopeForJobRole>, tool: string) =>
      policy.isToolAllowed(env, tool) && tier.get(tool)! <= env.maxRiskTier;
    const TOOLS = FLOW_TOOLS.map((t) => t.name).filter((n) => n.startsWith('command_') || n.startsWith('procurement_')).sort();
    // the route each tool's work sits behind, at the level D-40 gives it
    const ROUTE_LEVEL: Record<string, 'read' | 'write'> = {
      command_list_due_obligations: 'read',
      command_discharge_obligation: 'write',
      procurement_list_requests: 'read',
      procurement_get_request: 'read',
      procurement_list_suppliers: 'read',
      procurement_get_stats: 'read',
      procurement_create_request: 'write',
      procurement_update_request: 'write',
      procurement_submit_for_review: 'write',
      procurement_select_vendor: 'write',
      procurement_issue_po: 'write',
      procurement_acknowledge_vendor: 'write',
      procurement_mark_fulfilled: 'write',
      procurement_mark_invoiced: 'write',
    };
    expect(TOOLS).toEqual(Object.keys(ROUTE_LEVEL).sort());
    const BARE_ID = ['procurement_acknowledge_vendor', 'procurement_mark_fulfilled', 'procurement_mark_invoiced'];
    const READS = TOOLS.filter((t) => ROUTE_LEVEL[t] === 'read');

    // What OPS-02..OPS-06 prove HTTP gives each bizA member on these routes.
    const HTTP_LEVEL: Record<string, 'none' | 'read' | 'write'> = {
      [ID.noOps]: 'none',
      [ID.opsNone]: 'none',
      [ID.opsRead]: 'read',
      [ID.staffDefault]: 'read',
      [ID.opsWrite]: 'write',
      [ID.owner]: 'write',
      [ID.admin]: 'write',
    };
    const rank = { none: 0, read: 1, write: 2 } as const;
    // A position whose JobRole grants everything these tools could want, the legacy family key
    // included, held by each member: the holder's membership row (read from the database) bounds it.
    const broad = { id: `${P}jr`, name: 'K13O broad', permissions: { operations: 'admin', procurement: 'admin', crm: 'read' } };
    for (const [userId, httpLevel] of Object.entries(HTTP_LEVEL)) {
      const m = await db.membership.findFirst({ where: { userId, businessId: ID.bizA }, include: { user: true } });
      const env = policy.envelopeForPosition({ businessId: ID.bizA, userId, membershipId: m.id, jobRole: broad as any, membership: m });
      const reached = TOOLS.filter((t) => reaches(env, t));
      // K2: never a tool whose route HTTP refuses this member
      for (const t of reached) {
        expect(rank[httpLevel], `${userId} reaches ${t} over KEY but HTTP gives ${httpLevel}`).toBeGreaterThanOrEqual(rank[ROUTE_LEVEL[t]]);
      }
      if (httpLevel === 'none') expect(reached, userId).toEqual([]);
      if (httpLevel === 'read') expect(reached, userId).toEqual(READS);
      if (httpLevel === 'write') expect(reached, userId).toEqual(expect.arrayContaining(READS));
      for (const t of BARE_ID) expect(reached, `${userId} ${t}`).not.toContain(t);
    }

    // The reviewer's probes: a legacy JobRole and holder map with procurement but no operations key
    // (HTTP answers 403 on every procurement route, OPS-03), membership-backed and contact-only.
    const legacy = { id: `${P}jr_legacy`, name: 'K13O legacy', permissions: { procurement: 'write', crm: 'read' } };
    const legacyHolder = { userId: ID.noOps, businessId: ID.bizA, role: 'STAFF', permissionScopes: { procurement: 'write', crm: 'read' }, user: {} };
    const membershipBacked = policy.envelopeForPosition({
      businessId: ID.bizA, userId: ID.noOps, membershipId: `${P}m_legacy`, jobRole: legacy as any, membership: legacyHolder as any,
    });
    const contactOnly = policy.envelopeForPosition({ businessId: ID.bizA, jobRole: { ...legacy, permissions: { procurement: 'admin' } } as any });
    expect(TOOLS.filter((t) => reaches(membershipBacked, t))).toEqual([]);
    expect(TOOLS.filter((t) => reaches(contactOnly, t))).toEqual([]);
    // ...and the governing key reaches them at its level and tier (issue-po is tier 3: admin)
    const job = (permissions: Record<string, string>) => policy.envelopeForJobRole({ id: `${P}jr_ops`, name: 'K13O ops', permissions: permissions as any });
    expect(TOOLS.filter((t) => reaches(job({ operations: 'read' }), t))).toEqual(READS);
    expect(TOOLS.filter((t) => reaches(job({ operations: 'write' }), t))).toEqual(TOOLS.filter((t) => !BARE_ID.includes(t) && t !== 'procurement_issue_po'));
    expect(TOOLS.filter((t) => reaches(job({ operations: 'admin' }), t))).toEqual(TOOLS.filter((t) => !BARE_ID.includes(t)));

    // The reviewed tables say so (job-role-tool-families.spec.ts derives them from the route decorators).
    for (const t of BARE_ID) expect(GOVERNED_UNGRANTED[t], t).toMatch(/bare id/);
    for (const t of TOOLS.filter((x) => !BARE_ID.includes(x))) expect(CANONICAL_MODULE_TOOLS.operations[t], t).toBe(ROUTE_LEVEL[t]);
  });

  it.todo(
    "[OPS-T03] review SEC-R013g-3: KEY chat (POST /ai/businesses/:id/flow/chat) selects tools by the crew detected from the message (FlowOrchestratorService.selectToolsForRequest; RoleEngine ROLE_BASELINE_TOOLS gives every crew command_list_due_obligations and command_discharge_obligation, the operations crew procurement_*) with no member module scope, and POST /ai/businesses/:id/key/command (do, draft) reaches CommandService.create for any member — not done: pre-existing, in role-engine.service.ts, flow-orchestrator.service.ts and ai.controller.ts, outside this packet's write set; D-40 over KEY chat needs its own packet",
  );

  it.todo(
    "[OPS-T04] review SEC-R013g-4: the audit rows name the member who acted (command item approve, complete and dismiss record actorType USER with no actorId; procurement acknowledge, fulfill and invoice record neither) — not done: CommandService.approve/complete/dismiss and ProcurementService.acknowledgeVendor/markFulfilled/markInvoiced take no actor, so the controllers cannot pass one, and both services are outside this packet's write set",
  );

  it.todo(
    "[OPS-T01] the cockpit snapshot (GET business-command-center/businesses/:id/snapshot) under operations 'read' — not done: release0-journey.integration.test.ts step 5 (an R0 exit proof, outside this packet's write set) pins a STAFF member with no operations key reading it 200, V1-47 projects each tile by the member's own scopes, and the snapshot reads no command item or procurement row; whether D-40 covers it is referred to the owner",
  );

  it.todo(
    '[OPS-T02] the web hides the procurement nav entry and disables the command-item actions for a member without operations — not done: the entry points are apps/web/src/lib/nav-config.ts, components/layout/desktop-sidebar.tsx and mobile-drawer.tsx, components/command/command-card*.tsx and app/app/command-center/page.tsx (V1-25), all outside this packet\'s write set; apps/web/src/lib/module-access.ts holds the decision helpers they would call',
  );
});
