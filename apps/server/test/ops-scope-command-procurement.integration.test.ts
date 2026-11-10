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
 *
 * FOLLOW3-D15-PROCUREMENT-BOUND-WRITES (V1-84) extends this suite (same prefix).
 * ProcurementService itself binds the business on every write: each write is an
 * updateMany where { id, businessId } that refuses (NotFound) unless it moved
 * exactly one row, so a direct service call made with no TenantInterceptor armed
 * (the KEY staff bridge) cannot move another business's request (OPS-11, OPS-12).
 * Approve and reject stop writing approvedAt, approvedByUserId, rejectedAt,
 * rejectedByUserId and rejectionReason, which the ProcurementRequest model does
 * not have (they answered 500 to every caller: the former KNOWN_HANDLER_FAILURE),
 * and record the decision in the audit trail, one BusinessEvent naming the
 * member who decided (D-08: BusinessEvent is the audit trail, Activity the feed),
 * beside the Activity feed row (OPS-13..OPS-15). With the writes bound, the three
 * vendor transitions rejoin CANONICAL_MODULE_TOOLS.operations at write (OPS-10).
 * ProcurementService writes the business_events row itself, in the same
 * transaction as the status, and fans it out on the EventEmitter2 bus once
 * committed (a recorder here, `bus`); writableState() includes business_events
 * and the bus, so every "nothing written" comparison also proves a refused or
 * failed call wrote no audit row and announced none.
 *
 * The review repairs (OPS-16..OPS-19): an update naming no field answers the
 * request (SEC-D15-1 / CR-D15-1); PATCH cannot set APPROVED or REJECTED
 * (SEC-D15-3); a decision is a compare-and-set on the status it read, 409 when
 * another landed first (SEC-D15-2); a failed audit insert rolls the decision
 * back, 503 (SEC-D15-4).
 *
 * W7-OPS-AUDIT-ACTOR (FOLLOW8, Release 0 exit) extends this suite (same prefix)
 * and turns the OPS-T04 todo into a live case: the controllers hand the member
 * to CommandService and ProcurementService, and every feed row the two write for
 * a member names them (actorType USER, actorId the member), the command item
 * approve, complete and dismiss and the procurement acknowledge, fulfill and
 * invoice rows the review named (SEC-R013g-4) included.
 *
 * Its review repair (SEC-W7OAA-1, OPS-20..OPS-22): those rows named the member
 * but recorded moves that should not happen, since acknowledge, fulfill and
 * invoice checked no status (a DRAFT request could be invoiced, a replay wrote a
 * second row, an acknowledge after the invoice moved the request back). Each is
 * now a compare-and-set on the step before it, as a decision is (SEC-D15-2), so
 * the route table seeds each at that step.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
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
/** The EventEmitter2 bus: the audit trail's 'business_event.created' fan-out (to the KEY flows bridge) lands here. */
const bus = {
  emitted: [] as Array<{ event: string; payload: any }>,
  emit(event: string, payload: unknown) {
    bus.emitted.push({ event, payload });
    return true;
  },
};

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
const controllers: Record<string, any> = {};
/** The real ProcurementService of the app under test, for the direct (no request, no tenant armed) calls. */
let procurementService: any;
/** The real CommandService of the app under test (W7-OPS-AUDIT-ACTOR: the bulk writes, whose member comes from TenantInterceptor's context). */
let commandService: any;
let NotFound: any;
let Conflict: any;
let ServiceUnavailable: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function seedProcurementRequest(businessId: string, opts: { supplier?: string; status?: string } = {}) {
  seq += 1;
  return db.procurementRequest.create({
    data: {
      id: `${P}pr_${seq}`,
      businessId,
      status: opts.status ?? 'DRAFT',
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
const preq = async (biz: string, suffix: string, opts?: { supplier?: string; status?: string }) =>
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
  // W7-OPS-AUDIT-ACTOR review SEC-W7OAA-1 (D-40): each vendor transition moves a request only from the
  // step before it (OPS-20), so each is seeded at that step and an admitted caller's call is a real move
  { key: 'ProcurementController.acknowledgeVendor', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/acknowledge', { status: 'PO_ISSUED' }) }) },
  { key: 'ProcurementController.markFulfilled', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/fulfill', { status: 'VENDOR_ACKNOWLEDGED' }) }) },
  { key: 'ProcurementController.markInvoiced', verb: 'post', level: 'write', build: async (b) => ({ url: await preq(b, '/invoice', { status: 'FULFILLED' }) }) },
];

/** The census's one named exception (see the header): open to every member of the business. */
const COCKPIT_ROUTES: RouteCase[] = [
  { key: 'BusinessCommandCenterController.snapshot', verb: 'get', level: 'open', build: async (b) => ({ url: `/business-command-center/businesses/${b}/snapshot` }) },
];

const GATED_ROUTES = [...COMMAND_ROUTES, ...PROCUREMENT_ROUTES];
const ALL_ROUTES = [...GATED_ROUTES, ...COCKPIT_ROUTES];

/**
 * Routes the gate admits whose handler fails for every caller. R0-13g found
 * procurement approve and reject here (500 to every caller, OWNER included):
 * ProcurementService.updateStatus wrote approvedAt, approvedByUserId,
 * rejectedAt, rejectedByUserId and rejectionReason, which the
 * ProcurementRequest model (packages/db/prisma/schema.prisma) does not have.
 * FOLLOW3-D15 (V1-84) fixed the service: both answer 201 now (OPS-05, OPS-06,
 * OPS-13, OPS-14), so the map is empty and any new entry is a regression to
 * explain.
 */
const KNOWN_HANDLER_FAILURE: Record<string, number> = {};

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
    // FOLLOW3-D15: approve and reject write the audit row; a refused or failed call writes none
    businessEvents: await rows('business_events'),
    timeline: timeline.events.length,
    realtime: realtime.emits.length,
    notifications: notifications.created.length,
    bus: bus.emitted.length,
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
  NotFound = (await import('@nestjs/common')).NotFoundException;
  Conflict = (await import('@nestjs/common')).ConflictException;
  ServiceUnavailable = (await import('@nestjs/common')).ServiceUnavailableException;
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
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
      { provide: EventEmitter2, useValue: bus },
    ],
  }).compile();
  procurementService = moduleRef.get(ProcurementService);
  commandService = moduleRef.get(CommandService);

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

  it("[OPS-05] operations 'write' reaches every command-centre and procurement route (GET 200, PATCH and DELETE 200, POST 201; procurement approve and reject 201 since FOLLOW3-D15, RED-BEFORE 500): the gate refuses on scope, not on role", async () => {
    const built = await buildAll(GATED_ROUTES);
    const { statuses, bodies } = await sendAll(built, ID.opsWrite);
    expect(statuses, JSON.stringify(Object.fromEntries(Object.entries(bodies).filter(([k]) => statuses[k] >= 300)))).toEqual(
      expectedAll(GATED_ROUTES, admittedStatus),
    );
    expect(bodies['ProcurementController.issuePO']).toMatchObject({ status: 'PO_ISSUED', purchaseOrder: { businessId: ID.bizA, supplierConnectionId: SUPPLIER.a } });
    expect(bodies['ProcurementController.submit']).toMatchObject({ status: 'SUBMITTED', businessId: ID.bizA });
    expect(bodies['CommandController.complete']).toMatchObject({ status: 'COMPLETED', businessId: ID.bizA });
    // FOLLOW3-D15: approve and reject decide the request (they answered 500 before)
    expect(bodies['ProcurementController.approve']).toMatchObject({ status: 'APPROVED', businessId: ID.bizA });
    expect(bodies['ProcurementController.reject']).toMatchObject({ status: 'REJECTED', businessId: ID.bizA });
  }, HEAVY_CASE_MS);

  it('[OPS-06] OWNER and ADMIN (role defaults, operations admin) keep every route, the cockpit snapshot included (procurement approve and reject 201 since FOLLOW3-D15, RED-BEFORE 500)', async () => {
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

  it("[OPS-10] review SEC-R013g-1 / CR-1: KEY reaches a command or procurement tool only where HTTP admits the same member: the position envelope (JobRolePolicyService.envelopeForPosition, bounded by the holder's real membership row) gives no command_* or procurement_* tool to the members the gate refuses and only the read tools to operations read; the legacy 'procurement' family key reaches none of them. RED-BEFORE FOLLOW3-D15 (PR-03): the three procurement vendor transitions, whose service writes now bind the business, are operations write: an operations:write envelope reaches them, operations:read and the members HTTP refuses do not", async () => {
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
    // FOLLOW3-D15: bare-id writes before; ProcurementService now updates them where { id, businessId }
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
      if (httpLevel === 'write') expect(reached, userId).toEqual(expect.arrayContaining([...READS, ...BARE_ID]));
      // FOLLOW3-D15 (PR-03): the vendor transitions only where HTTP gives write
      for (const t of BARE_ID) expect(reached.includes(t), `${userId} ${t}`).toBe(httpLevel === 'write');
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
    expect(TOOLS.filter((t) => reaches(job({ operations: 'write' }), t))).toEqual(TOOLS.filter((t) => t !== 'procurement_issue_po'));
    expect(TOOLS.filter((t) => reaches(job({ operations: 'admin' }), t))).toEqual(TOOLS);
    for (const t of BARE_ID) {
      expect(reaches(job({ operations: 'write' }), t), `operations:write ${t}`).toBe(true);
      expect(reaches(job({ operations: 'read' }), t), `operations:read ${t}`).toBe(false);
    }

    // The reviewed tables say so (job-role-tool-families.spec.ts derives them from the route decorators):
    // every command and procurement tool, the three vendor transitions included, is operations at its route level.
    for (const t of BARE_ID) expect(GOVERNED_UNGRANTED[t], t).toBeUndefined();
    for (const t of TOOLS) expect(CANONICAL_MODULE_TOOLS.operations[t], t).toBe(ROUTE_LEVEL[t]);
  });

  // [OPS-T03] (review SEC-R013g-3: KEY reached CommandService.create for any member) is done in two
  // halves: member chat in FOLLOW3-D16-KEY-CHAT-OPS-SCOPE (test/key-chat-ops-scope.integration.test.ts)
  // and POST /ai/businesses/:id/key/command do/auto/draft in FOLLOW3-D9-DOITFORME-SCOPE
  // (test/key-do-it-for-me-scope.integration.test.ts: no item is filed below operations write).

  // W7-OPS-AUDIT-ACTOR closes [OPS-T04] (review SEC-R013g-4). The rows are the Activity feed rows
  // (D-08) CommandService and ProcurementService write through TimelineService, the recorder here.
  // The single-item routes are sent over HTTP; the bulk routes take their member from
  // TenantInterceptor's context (ambientActor, FOLLOW3-D10), which this harness does not arm (see
  // OPS-09), so their rows are proven on the real CommandService called with the member.
  it("[OPS-T04] review SEC-R013g-4 (W7-OPS-AUDIT-ACTOR, D-40): the feed rows name the member who acted. RED-BEFORE: command item approve, complete and dismiss recorded actorType USER with no actorId, procurement acknowledge, fulfill and invoice recorded neither. Sent by a STAFF member with operations write and by the OWNER, each of those six routes writes exactly one row naming that member (actorType USER, actorId the member), and so does every other route that writes a row for a member: command create, PATCH, snooze, execute, assign, reopen and DELETE, procurement submit; bulk complete, dismiss and delete name the member they are called with", async () => {
    const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    type ActorCase = { label: string; verb: Verb; url: string; body?: unknown; entityId?: string; action: string; status: number };
    const commandCase = async (label: string, verb: Verb, suffix: string, action: string, body?: unknown): Promise<ActorCase> => {
      const ci = await seedCommandItem(ID.bizA);
      return { label, verb, url: `${cmd(ID.bizA)}/items/${ci.id}${suffix}`, body, entityId: ci.id, action, status: okStatus(verb) };
    };
    // review SEC-W7OAA-1: a vendor transition is seeded at the step it moves the request from (OPS-20)
    const procurementCase = async (label: string, suffix: string, action: string, status = 'DRAFT'): Promise<ActorCase> => {
      const row = await seedProcurementRequest(ID.bizA, { supplier: SUPPLIER.a, status });
      return { label, verb: 'post', url: `${proc(ID.bizA)}/${row.id}${suffix}`, entityId: row.id, action, status: 201 };
    };

    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const actor of [ID.opsWrite, ID.owner]) {
      const cases: ActorCase[] = [
        // the six the review named
        await commandCase('command approve', 'post', '/approve', 'approve'),
        await commandCase('command complete', 'post', '/complete', 'complete'),
        await commandCase('command dismiss', 'post', '/dismiss', 'dismiss'),
        await procurementCase('procurement acknowledge', '/acknowledge', 'request.vendor_acknowledged', 'PO_ISSUED'),
        await procurementCase('procurement fulfill', '/fulfill', 'request.fulfilled', 'VENDOR_ACKNOWLEDGED'),
        await procurementCase('procurement invoice', '/invoice', 'request.invoiced', 'FULFILLED'),
        // every other row the two services write for a member
        {
          label: 'command create', verb: 'post', url: `${cmd(ID.bizA)}/items`, action: 'create', status: 201,
          body: { sourceModule: 'k13o', title: `${P}created by a member`, category: 'WORK', actionType: 'k13o_check' },
        },
        await commandCase('command PATCH', 'patch', '', 'update', { title: `${P}renamed by a member` }),
        await commandCase('command snooze', 'post', '/snooze', 'snooze', { until: future() }),
        await commandCase('command execute', 'post', '/execute', 'execute', { result: { k13o: true } }),
        await commandCase('command assign', 'post', '/assign', 'assign', { ownerType: 'USER', ownerId: ID.owner }),
        await commandCase('command reopen', 'post', '/reopen', 'reopen'),
        await commandCase('command DELETE', 'delete', '', 'delete'),
        await procurementCase('procurement submit', '/submit', 'request.submitted'),
      ];
      for (const c of cases) {
        const from = timeline.events.length;
        const res = await send(c.verb, c.url, actor, c.body);
        const entityId = c.entityId ?? res.body?.id;
        outcomes[`${actor} ${c.label}`] = [
          res.status,
          timeline.events.slice(from).map((e) => ({ action: e.action, entityId: e.entityId, actorType: e.actorType, actorId: e.actorId })),
        ];
        expected[`${actor} ${c.label}`] = [c.status, [{ action: c.action, entityId, actorType: 'USER', actorId: actor }]];
      }

      // bulk complete, dismiss and delete: the member the controller hands the service (ambientActor) is on every row
      for (const [method, action] of [['bulkComplete', 'complete'], ['bulkDismiss', 'dismiss'], ['bulkDelete', 'delete']] as const) {
        const ids = [(await seedCommandItem(ID.bizA)).id, (await seedCommandItem(ID.bizA)).id];
        const from = timeline.events.length;
        const result = await commandService[method](ID.bizA, ids, actor);
        // one row per item, in the order the service read them (no order is asked for): compared by item id
        outcomes[`${actor} ${method}`] = [
          result,
          timeline.events.slice(from)
            .map((e) => ({ action: e.action, entityId: e.entityId as string, actorType: e.actorType, actorId: e.actorId }))
            .sort((a, b) => a.entityId.localeCompare(b.entityId)),
        ];
        expected[`${actor} ${method}`] = [
          { count: 2 },
          [...ids].sort((a, b) => a.localeCompare(b)).map((entityId) => ({ action, entityId, actorType: 'USER', actorId: actor })),
        ];
      }
    }
    expect(outcomes).toEqual(expected);
  }, HEAVY_CASE_MS);

  it.todo(
    "[OPS-T01] the cockpit snapshot (GET business-command-center/businesses/:id/snapshot) under operations 'read' — not done: release0-journey.integration.test.ts step 5 (an R0 exit proof, outside this packet's write set) pins a STAFF member with no operations key reading it 200, V1-47 projects each tile by the member's own scopes, and the snapshot reads no command item or procurement row; whether D-40 covers it is referred to the owner",
  );

  it.todo(
    '[OPS-T02] the web hides the procurement nav entry and disables the command-item actions for a member without operations — not done: the entry points are apps/web/src/lib/nav-config.ts, components/layout/desktop-sidebar.tsx and mobile-drawer.tsx, components/command/command-card*.tsx and app/app/command-center/page.tsx (V1-25), all outside this packet\'s write set; apps/web/src/lib/module-access.ts holds the decision helpers they would call',
  );
});

/** One procurement request as a whole row (to_jsonb text): what "byte-identical" compares. */
async function requestRow(id: string): Promise<string | undefined> {
  const rows = await db.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM procurement_requests t WHERE id = $1', id);
  return rows[0]?.row;
}

/** The audit trail (business_events) rows about one procurement request. */
async function auditRows(subjectId: string) {
  return db.businessEvent.findMany({ where: { subjectId }, orderBy: { createdAt: 'asc' } });
}

/** bizB's request carried to PO_ISSUED with its own supplier, so every transition would be a real change. */
async function foreignPoIssued() {
  const row = await seedProcurementRequest(ID.bizB, { supplier: SUPPLIER.b });
  await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'PO_ISSUED' } });
  return row.id as string;
}

/** A method's text in a class source (two-space indented member, up to its closing brace). */
function memberText(src: string, name: string): string | null {
  const lines = src.split('\n');
  const sig = new RegExp(`^ {2}(?:public |private |protected )?(?:async )?${name}\\s*[(<]`);
  const s = lines.findIndex((l) => sig.test(l));
  if (s < 0) return null;
  let e = s + 1;
  while (e < lines.length && !/^ {2}\}\s*$/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}

describe('FOLLOW3-D15-PROCUREMENT-BOUND-WRITES (V1-84): ProcurementService binds the business on every write; approve and reject decide and are audited', () => {
  it("[OPS-11] RED-BEFORE PR-01: ProcurementService called directly (no HTTP request, no TenantInterceptor armed: how the KEY staff bridge calls it) with bizA's business id and bizB's request id refuses every write with NotFound, and bizB's row is byte-identical: update, submitForReview, updateStatus (approve and reject), selectVendor, issuePO, acknowledgeVendor, markFulfilled and markInvoiced; no purchase order, no audit row and no feed row is written", async () => {
    const CALLS: Array<[string, (id: string) => Promise<unknown>]> = [
      ['update', (id) => procurementService.update(ID.bizA, id, { status: 'APPROVED', internalNotes: `${P}moved` })],
      ['submitForReview', (id) => procurementService.submitForReview(ID.bizA, id)],
      ['updateStatus APPROVED', (id) => procurementService.updateStatus(ID.bizA, id, 'APPROVED', ID.owner)],
      ['updateStatus REJECTED', (id) => procurementService.updateStatus(ID.bizA, id, 'REJECTED', ID.owner, `${P}no`)],
      ['selectVendor', (id) => procurementService.selectVendor(ID.bizA, id, SUPPLIER.a)],
      ['issuePO', (id) => procurementService.issuePO(ID.bizA, id, ID.owner)],
      ['acknowledgeVendor', (id) => procurementService.acknowledgeVendor(ID.bizA, id)],
      ['markFulfilled', (id) => procurementService.markFulfilled(ID.bizA, id)],
      ['markInvoiced', (id) => procurementService.markInvoiced(ID.bizA, id)],
    ];
    const outcomes: Record<string, string> = {};
    const moved: string[] = [];
    const wrote: string[] = [];
    for (const [name, call] of CALLS) {
      const id = await foreignPoIssued();
      const rowBefore = await requestRow(id);
      const before = await writableState();
      try {
        const out = (await call(id)) as { status?: string; businessId?: string } | undefined;
        outcomes[name] = `resolved (${out?.businessId} ${out?.status})`;
      } catch (err) {
        outcomes[name] = err instanceof NotFound ? 'NotFound' : `${(err as Error).constructor.name}: ${(err as Error).message}`;
      }
      if ((await requestRow(id)) !== rowBefore) moved.push(name);
      if (JSON.stringify(await writableState()) !== JSON.stringify(before)) wrote.push(name);
    }
    expect({ outcomes, moved, wrote }).toEqual({ outcomes: Object.fromEntries(CALLS.map(([n]) => [n, 'NotFound'])), moved: [], wrote: [] });

    // anti-vacuity: with the request's own business the same three transitions do move it
    const own = await foreignPoIssued();
    expect(await procurementService.acknowledgeVendor(ID.bizB, own)).toMatchObject({ id: own, businessId: ID.bizB, status: 'VENDOR_ACKNOWLEDGED' });
    expect(await procurementService.markFulfilled(ID.bizB, own)).toMatchObject({ id: own, businessId: ID.bizB, status: 'FULFILLED' });
    expect(await procurementService.markInvoiced(ID.bizB, own)).toMatchObject({ id: own, businessId: ID.bizB, status: 'INVOICED' });
  }, HEAVY_CASE_MS);

  it('[OPS-12] RED-BEFORE PR-01: every write ProcurementService makes to a procurement request is an updateMany whose where names { id, businessId } and is refused (NotFound) unless it moved exactly one row; each of the eight writing methods writes through one; none writes approvedAt, approvedByUserId, rejectedAt, rejectedByUserId or rejectionReason, which the model does not have', () => {
    const src = readFileSync(path.join(__dirname, '../src/modules/procurement/procurement.service.ts'), 'utf8');
    // no write that finds the request by its bare id
    expect(src.match(/procurementRequest\.(update|upsert|delete|deleteMany)\(/g) ?? []).toEqual([]);
    const sites = [...src.matchAll(/procurementRequest\.updateMany\(/g)].map((m) => src.slice(m.index!, m.index! + 400));
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      // review SEC-D15-2: the one narrowing allowed beside the binding is the decision's compare-and-set on the status read
      expect(site).toMatch(/^procurementRequest\.updateMany\(\{\s*where: \{ id, businessId(?:, status: fromStatus)? \},/);
      expect(site).toMatch(/\bcount !== 1\)\s*throw new NotFoundException\(/);
    }
    // review SEC-D15-4: updateStatus writes the status and its audit row in one transaction, not beside a
    // fire-and-forget emit that swallows a failed insert
    const decide = memberText(src, 'updateStatus')!;
    expect(decide).toMatch(/\$transaction\(async \(tx\) => \{\s*const row = await this\.writeRequest\([^)]*client: tx \}\);\s*try \{\s*await tx\.businessEvent\.create\(/);
    expect(decide).not.toMatch(/\.emit\(\{/);
    // each writing method writes through such a site, itself or through an own-class helper
    const writesThrough = (body: string) =>
      body.includes('procurementRequest.updateMany(') ||
      [...body.matchAll(/this\.([a-zA-Z0-9_]+)\(/g)].some((m) => (memberText(src, m[1]) ?? '').includes('procurementRequest.updateMany('));
    for (const method of ['update', 'submitForReview', 'updateStatus', 'selectVendor', 'issuePO', 'acknowledgeVendor', 'markFulfilled', 'markInvoiced']) {
      const body = memberText(src, method);
      expect(body, method).not.toBeNull();
      expect(writesThrough(body!), method).toBe(true);
    }
    expect(src).not.toMatch(/\b(approvedAt|approvedByUserId|rejectedAt|rejectedByUserId|rejectionReason)\s*:/);
  });

  it("[OPS-13] RED-BEFORE PR-02: POST procurement/businesses/A/:id/approve (the OWNER, and a STAFF member with operations write) answers 201 with status APPROVED, the row is APPROVED, and exactly one BusinessEvent records the decision: business A, subject procurement_request :id, action approved, the approving member as the (human) actor, the status before and after; the Activity feed row is still written and names the approver", async () => {
    for (const actor of [ID.owner, ID.opsWrite]) {
      const row = await seedProcurementRequest(ID.bizA);
      await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
      const feedFrom = timeline.events.length;
      const busFrom = bus.emitted.length;
      const res = await send('post', `${proc(ID.bizA)}/${row.id}/approve`, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body, actor).toMatchObject({ id: row.id, businessId: ID.bizA, status: 'APPROVED' });
      expect((await db.procurementRequest.findUnique({ where: { id: row.id } })).status, actor).toBe('APPROVED');
      const audit = await auditRows(row.id);
      expect(audit, actor).toHaveLength(1);
      expect(audit[0], actor).toMatchObject({
        businessId: ID.bizA,
        eventType: 'procurement_request.approved',
        subjectType: 'procurement_request',
        subjectId: row.id,
        action: 'approved',
        actorType: 'human',
        actorId: actor,
        before: { status: 'SUBMITTED' },
        after: { status: 'APPROVED' },
      });
      const feed = timeline.events.slice(feedFrom).filter((e) => e.entityId === row.id);
      expect(feed, actor).toEqual([
        expect.objectContaining({ businessId: ID.bizA, module: 'procurement', action: 'request.approved', actorType: 'USER', actorId: actor }),
      ]);
      // the audit row reaches the bus once, as BusinessEventService.emit fans out every audit row
      expect(bus.emitted.slice(busFrom).filter((e) => e.payload?.subjectId === row.id).map((e) => [e.event, e.payload.eventType, e.payload.actorId]), actor)
        .toEqual([['business_event.created', 'procurement_request.approved', actor]]);
    }
  }, HEAVY_CASE_MS);

  it('[OPS-14] RED-BEFORE PR-02: POST procurement/businesses/A/:id/reject with a reason answers 201 with status REJECTED, and exactly one BusinessEvent records the decision with the reason in its metadata (action rejected, the rejecting member as actor); the Activity feed row is still written and carries the reason', async () => {
    const row = await seedProcurementRequest(ID.bizA);
    await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
    const reason = `${P}over budget this quarter`;
    const feedFrom = timeline.events.length;
    const res = await send('post', `${proc(ID.bizA)}/${row.id}/reject`, ID.owner, { reason });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ id: row.id, businessId: ID.bizA, status: 'REJECTED' });
    expect((await db.procurementRequest.findUnique({ where: { id: row.id } })).status).toBe('REJECTED');
    const audit = await auditRows(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      businessId: ID.bizA,
      eventType: 'procurement_request.rejected',
      subjectType: 'procurement_request',
      subjectId: row.id,
      action: 'rejected',
      actorType: 'human',
      actorId: ID.owner,
      before: { status: 'SUBMITTED' },
      after: { status: 'REJECTED' },
      metadata: { reason },
    });
    const feed = timeline.events.slice(feedFrom).filter((e) => e.entityId === row.id);
    expect(feed).toEqual([
      expect.objectContaining({ businessId: ID.bizA, action: 'request.rejected', actorType: 'USER', actorId: ID.owner, data: { status: 'REJECTED', reason } }),
    ]);
  });

  it("[OPS-15] a refused or failed approve or reject writes no BusinessEvent: refused by the gate (unauthenticated 401; STAFF operations read, no operations key, another tenant's owner 403) or failed (bizB's request through bizA's path, 404, as the OWNER), the request is unchanged and no audit, feed or other row is written", async () => {
    const own = await seedProcurementRequest(ID.bizA);
    await db.procurementRequest.update({ where: { id: own.id }, data: { status: 'SUBMITTED' } });
    const foreign = await foreignPoIssued();
    const cases: Array<[string, string | undefined, string, number]> = [];
    for (const verb of ['approve', 'reject']) {
      cases.push([`${verb} unauthenticated`, undefined, `${proc(ID.bizA)}/${own.id}/${verb}`, 401]);
      cases.push([`${verb} operations read`, ID.opsRead, `${proc(ID.bizA)}/${own.id}/${verb}`, 403]);
      cases.push([`${verb} no operations key`, ID.noOps, `${proc(ID.bizA)}/${own.id}/${verb}`, 403]);
      cases.push([`${verb} other tenant's owner`, ID.outsider, `${proc(ID.bizA)}/${own.id}/${verb}`, 403]);
      cases.push([`${verb} bizB's request via bizA`, ID.owner, `${proc(ID.bizA)}/${foreign}/${verb}`, 404]);
    }
    const before = await writableState();
    const rows = { own: await requestRow(own.id), foreign: await requestRow(foreign) };
    const statuses: Record<string, number> = {};
    for (const [label, actor, url] of cases) statuses[label] = (await send('post', url, actor, { reason: `${P}refused` })).status;
    expect(statuses).toEqual(Object.fromEntries(cases.map(([label, , , status]) => [label, status])));
    expect(await auditRows(own.id)).toEqual([]);
    expect(await auditRows(foreign)).toEqual([]);
    expect({ own: await requestRow(own.id), foreign: await requestRow(foreign) }).toEqual(rows);
    expect(await writableState()).toEqual(before);
  }, HEAVY_CASE_MS);

  it("[OPS-16] review SEC-D15-1 / CR-D15-1: an update that names no field answers the request as it is (200), not 'Request not found': PATCH {} and a PATCH whose only key the whitelist strips ({ notes }), as a STAFF member with operations write and as the OWNER, and the KEY procurement_update_request call that sends neither priority nor internalNotes; nothing is written. The business binding holds: the same empty update of bizB's request through bizA is still 404 / NotFound and bizB's row is byte-identical", async () => {
    const row = await seedProcurementRequest(ID.bizA);
    const foreign = await foreignPoIssued();
    const rows = { own: await requestRow(row.id), foreign: await requestRow(foreign) };
    const before = await writableState();
    const statuses: Record<string, number> = {};
    for (const actor of [ID.opsWrite, ID.owner]) {
      for (const [label, body] of [['{}', {}], ['{ notes }', { notes: `${P}stripped` }]] as const) {
        const res = await send('patch', `${proc(ID.bizA)}/${row.id}`, actor, body);
        statuses[`${actor} ${label}`] = res.status;
        expect(res.body, `${actor} ${label} ${JSON.stringify(res.body)}`).toMatchObject({ id: row.id, businessId: ID.bizA, status: 'DRAFT', priority: 'normal' });
      }
      statuses[`${actor} foreign {}`] = (await send('patch', `${proc(ID.bizA)}/${foreign}`, actor, {})).status;
    }
    expect(statuses).toEqual({
      [`${ID.opsWrite} {}`]: 200, [`${ID.opsWrite} { notes }`]: 200, [`${ID.opsWrite} foreign {}`]: 404,
      [`${ID.owner} {}`]: 200, [`${ID.owner} { notes }`]: 200, [`${ID.owner} foreign {}`]: 404,
    });
    // what FlowOrchestratorService's procurement_update_request passes when the model names neither field
    const keyShape = { priority: undefined, internalNotes: undefined };
    expect(await procurementService.update(ID.bizA, row.id, keyShape)).toMatchObject({ id: row.id, businessId: ID.bizA, status: 'DRAFT' });
    await expect(procurementService.update(ID.bizA, foreign, keyShape)).rejects.toBeInstanceOf(NotFound);
    expect({ own: await requestRow(row.id), foreign: await requestRow(foreign) }).toEqual(rows);
    expect(await writableState()).toEqual(before);
    // anti-vacuity: an update that names a field still writes it
    expect(await procurementService.update(ID.bizA, row.id, { internalNotes: `${P}noted` })).toMatchObject({ id: row.id, internalNotes: `${P}noted` });
  }, HEAVY_CASE_MS);

  it("[OPS-17] review SEC-D15-3: PATCH cannot decide a request: a body that sets status APPROVED or REJECTED (any case) answers 400 for a member with operations write and the OWNER, the request is byte-identical and no audit row is written; the decision is made only through approve and reject, which record it. A foreign request still answers 404 first, and a PATCH that sets any other status or field still writes", async () => {
    const row = await seedProcurementRequest(ID.bizA);
    await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
    const foreign = await foreignPoIssued();
    const rows = { own: await requestRow(row.id), foreign: await requestRow(foreign) };
    const before = await writableState();
    const DECISIONS = ['APPROVED', 'REJECTED', 'approved', 'Rejected'];
    const outcomes: Record<string, [number, string]> = {};
    for (const actor of [ID.opsWrite, ID.owner]) {
      for (const status of DECISIONS) {
        const res = await send('patch', `${proc(ID.bizA)}/${row.id}`, actor, { status, internalNotes: `${P}decided by edit` });
        outcomes[`${actor} ${status}`] = [res.status, res.body.message];
      }
      const res = await send('patch', `${proc(ID.bizA)}/${foreign}`, actor, { status: 'APPROVED' });
      outcomes[`${actor} foreign APPROVED`] = [res.status, res.body.message];
    }
    const refused = 'A request is approved or rejected through its approve and reject actions, which record the decision; PATCH cannot set that status';
    expect(outcomes).toEqual(Object.fromEntries([ID.opsWrite, ID.owner].flatMap((actor) => [
      ...DECISIONS.map((s) => [`${actor} ${s}`, [400, refused]]),
      [`${actor} foreign APPROVED`, [404, 'Request not found']],
    ])));
    await expect(procurementService.update(ID.bizA, row.id, { status: 'APPROVED' })).rejects.toThrow(refused);
    expect(await auditRows(row.id)).toEqual([]);
    expect({ own: await requestRow(row.id), foreign: await requestRow(foreign) }).toEqual(rows);
    expect(await writableState()).toEqual(before);
    // controls: another status and a plain field still write; approve still decides, and is audited
    expect((await send('patch', `${proc(ID.bizA)}/${row.id}`, ID.opsWrite, { status: 'DRAFT', priority: 'high' })).body).toMatchObject({ status: 'DRAFT', priority: 'high' });
    await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
    expect((await send('post', `${proc(ID.bizA)}/${row.id}/approve`, ID.opsWrite)).status).toBe(201);
    expect((await auditRows(row.id)).map((e: any) => e.eventType)).toEqual(['procurement_request.approved']);
  }, HEAVY_CASE_MS);

  it("[OPS-18] review SEC-D15-2: a decision is a compare-and-set on the status it read. When another decision lands between updateStatus's read and its write, the later one is refused (ConflictException, 409), writes no audit or feed row and leaves the first decision standing; and under real concurrency (approve and reject of the same SUBMITTED request at once, 10 times) every audit row records the status its own call wrote, the rows chain (the first starts at SUBMITTED, each starts where the previous ended), the request ends at the last row's status, and every call that wrote nothing was refused as a conflict", async () => {
    // (a) deterministic interleaving: the approve lands while the reject is between its read and its write
    const row = await seedProcurementRequest(ID.bizA);
    await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
    const svc = procurementService;
    const realGet = svc.get;
    svc.get = async function interleaved(businessId: string, id: string) {
      delete svc.get; // one interleaving only
      const seen = await realGet.call(svc, businessId, id);
      await svc.updateStatus(businessId, id, 'APPROVED', ID.owner);
      return seen;
    };
    const feedFrom = timeline.events.length;
    let outcome = 'resolved';
    try {
      await svc.updateStatus(ID.bizA, row.id, 'REJECTED', ID.opsWrite, `${P}too late`);
    } catch (err) {
      outcome = err instanceof Conflict ? 'Conflict' : `${(err as Error).constructor.name}: ${(err as Error).message}`;
    } finally {
      delete svc.get;
    }
    expect(outcome).toBe('Conflict');
    expect((await db.procurementRequest.findUnique({ where: { id: row.id } })).status).toBe('APPROVED');
    expect((await auditRows(row.id)).map((e: any) => [e.eventType, e.actorId, e.before, e.after])).toEqual([
      ['procurement_request.approved', ID.owner, { status: 'SUBMITTED' }, { status: 'APPROVED' }],
    ]);
    expect(timeline.events.slice(feedFrom).filter((e) => e.entityId === row.id).map((e) => e.action)).toEqual(['request.approved']);

    // (b) real concurrency: invariants that hold whatever the interleaving
    const DECIDED: Record<string, string> = { 'procurement_request.approved': 'APPROVED', 'procurement_request.rejected': 'REJECTED' };
    let raced = 0;
    for (let i = 0; i < 10; i += 1) {
      const r = await seedProcurementRequest(ID.bizA);
      await db.procurementRequest.update({ where: { id: r.id }, data: { status: 'SUBMITTED' } });
      const from = timeline.events.length;
      const settled = await Promise.allSettled([
        procurementService.updateStatus(ID.bizA, r.id, 'APPROVED', ID.owner),
        procurementService.updateStatus(ID.bizA, r.id, 'REJECTED', ID.opsWrite, `${P}no`),
      ]);
      const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      raced += failed.length;
      for (const f of failed) expect(f.reason, `pair ${i}: ${(f.reason as Error)?.message}`).toBeInstanceOf(Conflict);
      const audit = await auditRows(r.id);
      expect(audit.length, `pair ${i}`).toBe(settled.length - failed.length);
      let at = 'SUBMITTED';
      for (const e of audit) {
        expect([e.before, e.after], `pair ${i} ${e.eventType}`).toEqual([{ status: at }, { status: DECIDED[e.eventType] }]);
        at = DECIDED[e.eventType];
      }
      expect((await db.procurementRequest.findUnique({ where: { id: r.id } })).status, `pair ${i}`).toBe(at);
      expect(timeline.events.slice(from).filter((e) => e.entityId === r.id).length, `pair ${i} feed`).toBe(audit.length);
    }
    // anti-vacuity: the pairs did race (measured 10 of 10 on a shared machine; at the packet head 24 of 25 pairs wrote a contradicting row)
    expect(raced).toBeGreaterThan(0);
  }, HEAVY_CASE_MS);

  it("[OPS-19] review SEC-D15-4: a decision stands only with its audit row. When the audit insert fails (Postgres refuses a NUL character: a reject over HTTP whose reason holds one, and an approve called directly whose actor id holds one), the call answers 503 / ServiceUnavailableException, the request is byte-identical (still SUBMITTED) and no audit row, feed row or bus event is written; the same reject with a clean reason then decides it with exactly one audit row", async () => {
    const row = await seedProcurementRequest(ID.bizA);
    await db.procurementRequest.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
    const unchanged = await requestRow(row.id);
    const before = await writableState();
    const res = await send('post', `${proc(ID.bizA)}/${row.id}/reject`, ID.opsWrite, { reason: `${P}over\u0000budget` });
    expect([res.status, res.body.message]).toEqual([503, 'The audit trail is unavailable; the request was not decided']);
    await expect(procurementService.updateStatus(ID.bizA, row.id, 'APPROVED', `${ID.owner}\u0000`)).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(await requestRow(row.id)).toBe(unchanged);
    expect(await auditRows(row.id)).toEqual([]);
    expect(await writableState()).toEqual(before);
    // control: the insert succeeds, the decision stands with its row
    const ok = await send('post', `${proc(ID.bizA)}/${row.id}/reject`, ID.opsWrite, { reason: `${P}over budget` });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await auditRows(row.id)).map((e: any) => [e.eventType, e.actorId, e.metadata])).toEqual([
      ['procurement_request.rejected', ID.opsWrite, { reason: `${P}over budget` }],
    ]);
  }, HEAVY_CASE_MS);
});

/**
 * The vendor side of a request's life, in the order the request page (apps/web app/procurement/[requestId])
 * offers it: each transition moves a request only from the step before it (W7-OPS-AUDIT-ACTOR review
 * SEC-W7OAA-1, D-40).
 */
const VENDOR_STEPS = [
  { route: '/acknowledge', method: 'acknowledgeVendor', from: 'PO_ISSUED', to: 'VENDOR_ACKNOWLEDGED', action: 'request.vendor_acknowledged' },
  { route: '/fulfill', method: 'markFulfilled', from: 'VENDOR_ACKNOWLEDGED', to: 'FULFILLED', action: 'request.fulfilled' },
  { route: '/invoice', method: 'markInvoiced', from: 'FULFILLED', to: 'INVOICED', action: 'request.invoiced' },
] as const;
/** Every status a ProcurementRequest holds (packages/db/prisma/schema.prisma, ProcurementRequest.status). */
const REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PO_ISSUED', 'VENDOR_ACKNOWLEDGED', 'FULFILLED', 'INVOICED', 'COMPLETED'];

/** The feed rows (TimelineService recorder) about one request since `from`, as the claims compare them. */
const feedFor = (id: string, from: number) =>
  timeline.events.slice(from).filter((e) => e.entityId === id).map((e) => ({ action: e.action, actorType: e.actorType, actorId: e.actorId }));

describe('W7-OPS-AUDIT-ACTOR review SEC-W7OAA-1 (D-40): acknowledge, fulfill and invoice move a request only from the step before, once', () => {
  it("[OPS-20] RED-BEFORE: over HTTP each vendor transition answers 409 from every status but the step before it (acknowledge from PO_ISSUED, fulfill from VENDOR_ACKNOWLEDGED, invoice from FULFILLED: the order the request page offers them), for a STAFF member with operations write and for the OWNER, invoicing a DRAFT request with no PO and no vendor included; a refused call leaves the request byte-identical and writes no feed row or other row, and from the step before each answers 201, moves the request and writes one feed row naming the member", async () => {
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const actor of [ID.opsWrite, ID.owner]) {
      for (const step of VENDOR_STEPS) {
        for (const status of REQUEST_STATUSES) {
          const key = `${actor} ${step.route} from ${status}`;
          const row = await seedProcurementRequest(ID.bizA, { status });
          const unchanged = await requestRow(row.id);
          const before = await writableState();
          const feedFrom = timeline.events.length;
          const res = await send('post', `${proc(ID.bizA)}/${row.id}${step.route}`, actor);
          if (status === step.from) {
            outcomes[key] = [res.status, res.body?.status, feedFor(row.id, feedFrom)];
            expected[key] = [201, step.to, [{ action: step.action, actorType: 'USER', actorId: actor }]];
          } else {
            outcomes[key] = [res.status, (await requestRow(row.id)) === unchanged, JSON.stringify(await writableState()) === JSON.stringify(before)];
            expected[key] = [409, true, true];
          }
        }
      }
    }
    expect(outcomes).toEqual(expected);
    // the review's case answers why: invoicing a DRAFT request names the step it needs and the one it is at
    const draft = await seedProcurementRequest(ID.bizA);
    const res = await send('post', `${proc(ID.bizA)}/${draft.id}/invoice`, ID.opsWrite);
    expect([res.status, res.body.message]).toEqual([409, 'A request is marked invoiced only once it is FULFILLED; this one is DRAFT']);
  }, HEAVY_CASE_MS);

  it("[OPS-21] RED-BEFORE: the review's replay is refused. A PO_ISSUED request the STAFF member with operations write acknowledges, fulfills and invoices answers 201 to each and 409 to a replay of each, and the OWNER's acknowledge after the invoice answers 409: every refused call leaves the request byte-identical, the request ends INVOICED with the times its first calls stamped, and the feed holds exactly three rows for it, acknowledged, fulfilled and invoiced in that order, each naming the member", async () => {
    const row = await seedProcurementRequest(ID.bizA, { supplier: SUPPLIER.a, status: 'PO_ISSUED' });
    const url = (suffix: string) => `${proc(ID.bizA)}/${row.id}${suffix}`;
    const feedFrom = timeline.events.length;
    const outcomes: Array<[string, number, boolean?]> = [];
    for (const step of VENDOR_STEPS) {
      outcomes.push([step.route, (await send('post', url(step.route), ID.opsWrite)).status]);
      const moved = await requestRow(row.id);
      outcomes.push([`${step.route} replay`, (await send('post', url(step.route), ID.opsWrite)).status, (await requestRow(row.id)) === moved]);
    }
    const invoiced = await requestRow(row.id);
    outcomes.push(['/acknowledge after invoice (OWNER)', (await send('post', url('/acknowledge'), ID.owner)).status, (await requestRow(row.id)) === invoiced]);
    expect(outcomes).toEqual([
      ['/acknowledge', 201], ['/acknowledge replay', 409, true],
      ['/fulfill', 201], ['/fulfill replay', 409, true],
      ['/invoice', 201], ['/invoice replay', 409, true],
      ['/acknowledge after invoice (OWNER)', 409, true],
    ]);
    const final = await db.procurementRequest.findUnique({ where: { id: row.id } });
    expect(final.status).toBe('INVOICED');
    expect(final.vendorAcknowledgedAt <= final.fulfilledAt && final.fulfilledAt <= final.invoicedAt).toBe(true);
    expect(feedFor(row.id, feedFrom)).toEqual(VENDOR_STEPS.map((s) => ({ action: s.action, actorType: 'USER', actorId: ID.opsWrite })));
  }, HEAVY_CASE_MS);

  it("[OPS-22] the same holds for a caller that names no member (the KEY dispatcher's direct call, no TenantInterceptor armed): markInvoiced of a DRAFT request, markFulfilled of a PO_ISSUED one and acknowledgeVendor of an INVOICED one are refused (ConflictException) and write nothing; and each transition is a compare-and-set on the status it read, as a decision is (SEC-D15-2): when another acknowledge lands between a call's read and its write, the later call is refused (ConflictException), writes no feed row, and the first stands", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const [method, status] of [['markInvoiced', 'DRAFT'], ['markFulfilled', 'PO_ISSUED'], ['acknowledgeVendor', 'INVOICED']] as const) {
      const row = await seedProcurementRequest(ID.bizA, { status });
      const unchanged = await requestRow(row.id);
      const before = await writableState();
      let outcome = 'resolved';
      try {
        await procurementService[method](ID.bizA, row.id);
      } catch (err) {
        outcome = err instanceof Conflict ? 'Conflict' : `${(err as Error).constructor.name}: ${(err as Error).message}`;
      }
      outcomes[`${method} from ${status}`] = [outcome, (await requestRow(row.id)) === unchanged, JSON.stringify(await writableState()) === JSON.stringify(before)];
    }
    expect(outcomes).toEqual({
      'markInvoiced from DRAFT': ['Conflict', true, true],
      'markFulfilled from PO_ISSUED': ['Conflict', true, true],
      'acknowledgeVendor from INVOICED': ['Conflict', true, true],
    });

    // deterministic interleaving: the OWNER's acknowledge lands while the member's is between its read and its write
    const row = await seedProcurementRequest(ID.bizA, { status: 'PO_ISSUED' });
    const svc = procurementService;
    const realGet = svc.get;
    svc.get = async function interleaved(businessId: string, id: string) {
      delete svc.get; // one interleaving only
      const seen = await realGet.call(svc, businessId, id);
      await svc.acknowledgeVendor(businessId, id, ID.owner);
      return seen;
    };
    const feedFrom = timeline.events.length;
    let outcome = 'resolved';
    try {
      await svc.acknowledgeVendor(ID.bizA, row.id, ID.opsWrite);
    } catch (err) {
      outcome = err instanceof Conflict ? 'Conflict' : `${(err as Error).constructor.name}: ${(err as Error).message}`;
    } finally {
      delete svc.get;
    }
    expect(outcome).toBe('Conflict');
    expect((await db.procurementRequest.findUnique({ where: { id: row.id } })).status).toBe('VENDOR_ACKNOWLEDGED');
    expect(feedFor(row.id, feedFrom)).toEqual([{ action: 'request.vendor_acknowledged', actorType: 'USER', actorId: ID.owner }]);
  }, HEAVY_CASE_MS);
});
