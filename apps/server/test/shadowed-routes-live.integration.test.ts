/**
 * R0-13f-ROUTE-SHADOWING-SIBLINGS — six routes that were dead behind a
 * parameterised sibling are declared first and reach their own handlers, and
 * each newly reachable handler is proven guarded, scoped and tenant-bound,
 * against a REAL database.
 *
 * R0-13e's static guard (apps/server/src/core/config/route-shadowing.spec.ts)
 * found them: Nest registers a controller's handlers in declaration order and
 * Express answers with the first pattern that matches, so each request below
 * was answered by the sibling with the literal segment as an id, and the
 * handler it names had never run over HTTP:
 *
 *   GET  /businesses/:businessId/approvals/pending-for-me
 *        answered by getById as approval 'pending-for-me' (404). The web calls
 *        it: fetchPendingApprovalsForMe (apps/web/src/lib/api/approvals.ts),
 *        on app/approvals/page.tsx and app/operations/page.tsx, which swallow
 *        the 404 into an empty "waiting on me" list.
 *   POST /command/businesses/:businessId/items/bulk/complete
 *   POST /command/businesses/:businessId/items/bulk/dismiss
 *        answered by complete / dismiss as item 'bulk' (404). The web has
 *        bulkCompleteCommands / bulkDismissCommands (apps/web/src/lib/api/command.ts);
 *        no screen calls them yet.
 *   POST /crm/businesses/:businessId/deals/bulk/move-stage
 *        answered by moveStage as deal 'bulk' (404). The web calls it:
 *        bulkMoveDealStage (apps/web/src/lib/client.ts) from
 *        app/crm/deals/deals-board-view.tsx (drag of a multi-selection) and
 *        app/crm/deals/deals-list-view.tsx (bulk move), so bulk moves failed.
 *   GET  /procurement/businesses/:businessId/suppliers
 *   GET  /procurement/businesses/:businessId/stats
 *        answered by get as procurement request 'suppliers' / 'stats' (404).
 *        The web calls them: fetchProcurementSuppliers from
 *        app/procurement/suppliers/page.tsx and app/procurement/[requestId]/page.tsx
 *        (vendor picker), fetchProcurementStats from app/procurement/page.tsx.
 *
 * What each handler was checked for before it went live (the cases below):
 *   - guards: every guard of the single-item sibling that answered it, read
 *     statically in route-shadowing.spec.ts and proven here: an
 *     unauthenticated caller gets 401 and a user who is no member of the path
 *     business 403 on every route; the bulk deal move needs the single move's
 *     crm 'write' (a crm 'read' member 403). The approvals, command and
 *     procurement siblings require membership only, and so do these.
 *   - tenant binding: each reads the tenant from the path and scopes every id
 *     to it. Another tenant's command item is refused exactly like an unknown
 *     id (the bulk is all-or-nothing); another tenant's deal is skipped with
 *     the same per-id result an unknown id gets (bulkMoveStage delegates each
 *     id to moveStage, the single move's own tenant check, reused, not
 *     rewritten; deals carry no record visibility beyond the tenant on either
 *     path); another tenant's stage moves nothing; pending-for-me, suppliers
 *     and stats never read another tenant's rows.
 *   - input: the bulk bodies are typed DTOs the global ValidationPipe
 *     whitelists. The deal bulk DTO (BulkMoveStageDto) checked only IsArray,
 *     so a Prisma filter object as a deal id reached moveStage's findFirst
 *     (`{ id: { not: '' } }` matches a deal of the tenant); the handler now
 *     takes BulkMoveDealsStageDto (crm-deals.controller.ts), which adds the
 *     string rule per id. vitest's esbuild emits no decorator metadata, so the
 *     suite applies the bulk handlers' parameter types tsc emits, and one case
 *     per controller reads them from the source as tsc compiles it.
 *
 * Review repairs (R0-13f review, two cases at the end):
 *   - bulkMoveStage returns each id's error message in its 201 body, so a deal
 *     id or stageId holding a NUL byte or an unpaired surrogate (text Postgres
 *     or Prisma refuses) sent Prisma's raw error, with the server source path
 *     and a code frame, to the caller. BulkMoveDealsStageDto now refuses such
 *     text per id and in stageId with 400 before any deal moves.
 *   - the approvals siblings (get, approve, reject, delegate, cancel,
 *     escalate) looked a request up by id alone, so a member of any business
 *     could read or escalate another tenant's request through their own
 *     business's path. ApprovalController now answers another tenant's request
 *     exactly like an unknown id before any service call.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business, membership, approval, command item, deal, stage, contact,
 * procurement request and supplier connection rows, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, RateLimitGuard (on a real Redis at REDIS_URL),
 * CrmRateLimitGuard, the global ValidationPipe and GlobalHttpExceptionFilter,
 * ApprovalController, CommandController, CrmDealsController,
 * ProcurementController, ApprovalRequestService, CommandService,
 * CrmDealsService, CrmTimelineService (its ContactEvent rows are real) and
 * ProcurementService are real against DATABASE_URL. The stand-ins: identity
 * attachment (a test middleware reads `x-test-user` and attaches the seeded
 * user row as AuthMiddleware would), TimelineService (a recorder: the unified
 * ledger side channel), RealtimeService (a recorder), NotificationsService,
 * the command generator and scheduler, the deal forecast and velocity
 * services, EvidenceService, TaskAssignmentService and the KEY approval
 * orchestrator (no case reaches them). The app trusts the proxy header as
 * app-bootstrap.ts does and every request carries its own x-forwarded-for
 * address, so the real rate limits run without capping the case count.
 *
 * Requires DATABASE_URL and REDIS_URL. Every seeded row carries the `k13f_`
 * prefix and is hard-deleted by raw SQL in beforeAll and afterAll. No
 * $transaction wrapping. Cases tagged NEGATIVE CONTROL are the pre-fix failing
 * controls; cases tagged refusal pass before and after (the sibling that
 * answered the route carried the same guard). The case list is bound by
 * scripts/proof-admission/manifests/shadowed-routes-live.json
 * (allowAdditionalCases false).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k13f_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  crmWrite: `${P}crmWrite`, // STAFF of bizA, crm: write
  crmRead: `${P}crmRead`, // STAFF of bizA, crm: read
  approver: `${P}approver`, // STAFF of bizA and of bizB (role default scopes)
  outsider: `${P}outsider`, // OWNER of bizB, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};
const UNKNOWN = `${P}unknown`;
/** A Prisma filter object: matches any row of the tenant if it reaches a where clause as an id. */
const FILTER_ID = { not: '' };

/** The unified-ledger side channel of CommandService, ProcurementService and CrmTimelineService. */
const timeline = {
  events: [] as Array<Record<string, any>>,
  async recordEvent(e: Record<string, any>) {
    timeline.events.push(e);
    return undefined;
  },
};
const realtime = {
  emits: [] as Array<Record<string, any>>,
  emit(e: Record<string, any>) {
    realtime.emits.push(e);
  },
};

let db: any;
let app: any;
let redis: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension).
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM approval_steps WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM approval_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM procurement_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM supplier_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** RateLimitGuard's Redis keys for this suite's tenants (rate_limit:<ip>:<businessId>:<handler>). */
async function cleanupRedis() {
  if (!redis) return;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `rate_limit:*:${P}*`, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

let ipSeq = 0;
/** A distinct client address per request, so the real per-IP rate limits never cap the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.13.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

/** A request as `actor` (undefined: no identity attached, as an unauthenticated caller). */
function send(method: 'get' | 'post' | 'delete', url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[method](url).set('x-forwarded-for', nextIp());
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const pendingForMe = (actor: string | undefined, biz = ID.bizA) => send('get', `/businesses/${biz}/approvals/pending-for-me`, actor);
const bulkCommand = (verb: 'complete' | 'dismiss', actor: string | undefined, body: unknown, biz = ID.bizA) =>
  send('post', `/command/businesses/${biz}/items/bulk/${verb}`, actor, body);
const bulkMove = (actor: string | undefined, body: unknown, biz = ID.bizA) =>
  send('post', `/crm/businesses/${biz}/deals/bulk/move-stage`, actor, body);
const moveOne = (actor: string | undefined, dealId: string, stageId: string, biz = ID.bizA) =>
  send('post', `/crm/businesses/${biz}/deals/${dealId}/move-stage`, actor, { stageId });
const suppliers = (actor: string | undefined, biz = ID.bizA) => send('get', `/procurement/businesses/${biz}/suppliers`, actor);
const stats = (actor: string | undefined, biz = ID.bizA) => send('get', `/procurement/businesses/${biz}/stats`, actor);

/** The six routes, each sent by `actor` with a body naming a fresh bizA row where it takes one. */
async function allSix(actor: string | undefined) {
  const item = await seedCommandItem(ID.bizA);
  const deal = await seedDeal(ID.bizA);
  return {
    rows: { item, deal },
    responses: {
      pendingForMe: await pendingForMe(actor),
      bulkComplete: await bulkCommand('complete', actor, { ids: [item.id] }),
      bulkDismiss: await bulkCommand('dismiss', actor, { ids: [item.id] }),
      bulkMoveStage: await bulkMove(actor, { dealIds: [deal.id], stageId: STAGE.aWon }),
      suppliers: await suppliers(actor),
      stats: await stats(actor),
    },
  };
}

/** The error body with the per-request timestamp normalised. */
const normalisedError = (res: { text: string }) => res.text.replace(/"timestamp":"[^"]*"/, '"timestamp":"<t>"');

/**
 * The raw row, every column (updated_at included), read past the soft-delete
 * extension: "nothing written" compares it whole.
 */
async function rawRow(table: string, id: string): Promise<Record<string, any>> {
  const rows: Array<{ row: string }> = await db.$queryRawUnsafe(
    `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE t.id = $1`, id,
  );
  return JSON.parse(rows[0].row);
}

const STAGE = {
  aLead: `${P}st_a_lead`,
  aWon: `${P}st_a_won`,
  bLead: `${P}st_b_lead`,
  bWon: `${P}st_b_won`,
};
const CONTACT = { a: `${P}ct_a`, b: `${P}ct_b` };

let seq = 0;
async function seedCommandItem(businessId: string) {
  seq += 1;
  return db.commandItem.create({
    data: {
      id: `${P}ci_${seq}`,
      businessId,
      sourceModule: 'k13f',
      title: `${P}Item ${seq}`,
      category: 'WORK',
      actionType: 'k13f_check',
      status: 'OPEN',
    },
  });
}

async function seedDeal(businessId: string) {
  seq += 1;
  const isA = businessId === ID.bizA;
  return db.deal.create({
    data: {
      id: `${P}deal_${seq}`,
      businessId,
      contactId: isA ? CONTACT.a : CONTACT.b,
      title: `${P}Deal ${seq}`,
      stageId: isA ? STAGE.aLead : STAGE.bLead,
      status: 'OPEN',
    },
  });
}

/** An approval request with its steps, created `seq` seconds apart so the list order is fixed. */
async function seedApproval(opts: {
  id: string;
  businessId: string;
  status?: string;
  currentStep?: number;
  requesterId?: string;
  steps: Array<{ approverId: string; status?: string }>;
}) {
  seq += 1;
  await db.approvalRequest.create({
    data: {
      id: opts.id,
      businessId: opts.businessId,
      requestType: 'expense',
      requesterId: opts.requesterId ?? ID.owner,
      title: `${opts.id} title`,
      payload: { amount: 100 },
      status: opts.status ?? 'pending',
      currentStep: opts.currentStep ?? 0,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)),
    },
  });
  for (const [i, step] of opts.steps.entries()) {
    await db.approvalStep.create({
      data: { id: `${opts.id}_s${i}`, approvalRequestId: opts.id, stepOrder: i, approverId: step.approverId, status: step.status ?? 'pending' },
    });
  }
}

/** Every command-item and deal row of both tenants, and the contact events: what the six routes may write. */
async function writableState() {
  const [items, deals, events] = await Promise.all([
    db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM command_items t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`),
    db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM deals t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`),
    db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`),
  ]);
  return { items, deals, events, timeline: timeline.events.length, realtime: realtime.emits.length };
}

/** The constructor/handler parameter types tsc emits for `handler` of `cls` in `file` (emitDecoratorMetadata). */
async function emittedParamTypes(file: string, cls: string, handler: string) {
  const ts = await import('typescript');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
  const emitted = ts.transpileModule(source, {
    compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const end = emitted.indexOf(`], ${cls}.prototype, "${handler}", null)`);
  expect(end, `${cls}.${handler} not found in the emitted ${file}`).toBeGreaterThan(0);
  const decorators = emitted.slice(emitted.lastIndexOf('__decorate([', end), end);
  // Without type information transpileModule emits an imported class guarded,
  // `typeof (_a = typeof mod_1.Name !== "undefined" && mod_1.Name) === "function" ? _a : Object`;
  // the full build emits `mod_1.Name`. Both name the class Name.
  return decorators
    .match(/design:paramtypes", \[([^\]]*)\]/)?.[1]
    ?.replace(/typeof \(_\w+ = typeof [\w$]+\.([\w$]+) !== "undefined" && [\w$]+\.\1\) === "function" \? _\w+ : Object/g, '$1')
    .replace(/\b[\w$]+_1\.([\w$]+)/g, '$1');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { ApprovalController } = await import('../src/modules/approvals/approval.controller');
  const { ApprovalRequestService } = await import('../src/modules/approvals/approval-request.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { CommandController } = await import('../src/modules/command/command.controller');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { CommandGeneratorService } = await import('../src/modules/command/command-generator.service');
  const { CommandSchedulerService } = await import('../src/modules/command/command-scheduler.service');
  const { BulkCommandItemsDto } = await import('../src/modules/command/dto/bulk-command-items.dto');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmDealsController, BulkMoveDealsStageDto } = await import('../src/modules/crm/crm-deals.controller');
  const { CrmDealsService } = await import('../src/modules/crm/crm-deals.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { WonLostReasonService } = await import('../src/modules/crm/won-lost-reason.service');
  const { DealForecastService } = await import('../src/modules/crm/deal-forecast.service');
  const { DealVelocityService } = await import('../src/modules/crm/deal-velocity.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { ProcurementController } = await import('../src/modules/procurement/procurement.controller');
  const { ProcurementService } = await import('../src/modules/procurement/procurement.service');

  // The parameter types tsc emits for the bulk handlers (emitDecoratorMetadata,
  // the production build), which vitest's esbuild transform does not: without
  // them the global ValidationPipe has no class to validate the body against.
  // The validation cases read each list from the source as tsc compiles it.
  // ApprovalController has no @Inject on its constructor parameter, so its
  // constructor type is applied the same way.
  Reflect.defineMetadata('design:paramtypes', [String, BulkCommandItemsDto], CommandController.prototype, 'bulkComplete');
  Reflect.defineMetadata('design:paramtypes', [String, BulkCommandItemsDto], CommandController.prototype, 'bulkDismiss');
  Reflect.defineMetadata('design:paramtypes', [String, BulkMoveDealsStageDto, Object], CrmDealsController.prototype, 'bulkMoveStage');
  Reflect.defineMetadata('design:paramtypes', [ApprovalRequestService], ApprovalController);
  Reflect.defineMetadata('design:paramtypes', [ProcurementService], ProcurementController);

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });

  // ---- the real HTTP path (wired before any row is seeded) ----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [ApprovalController, CommandController, CrmDealsController, ProcurementController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      RateLimitGuard,
      CrmRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      ApprovalRequestService,
      // Reached only by createRequest's shadow migration, which no case calls.
      { provide: KeyCortexApprovalOrchestratorService, useValue: {} },
      CommandService,
      { provide: TimelineService, useValue: timeline },
      { provide: RealtimeService, useValue: realtime },
      { provide: NotificationsService, useValue: {} },
      { provide: CommandGeneratorService, useValue: {} },
      { provide: CommandSchedulerService, useValue: {} },
      CrmDealsService,
      CrmTimelineService,
      WonLostReasonService,
      { provide: DealForecastService, useValue: {} },
      { provide: DealVelocityService, useValue: {} },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      ProcurementService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only, for seeded k13f_ users. No guard is overridden.
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
  await cleanupRedis();

  // ---- identities, tenants, memberships -----------------------------------
  for (const [id, email] of [
    [ID.owner, `${P}owner@test.local`],
    [ID.crmWrite, `${P}crmWrite@test.local`],
    [ID.crmRead, `${P}crmRead@test.local`],
    [ID.approver, `${P}approver@test.local`],
    [ID.outsider, `${P}outsider@test.local`],
  ]) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13F Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'K13F Biz B', ownerId: ID.outsider } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_crmWrite`, userId: ID.crmWrite, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_crmRead`, userId: ID.crmRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' } } });
  await db.membership.create({ data: { id: `${P}m_approver_a`, userId: ID.approver, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({ data: { id: `${P}m_approver_b`, userId: ID.approver, businessId: ID.bizB, role: 'STAFF' } });
  await db.membership.create({ data: { id: `${P}m_outsider_b`, userId: ID.outsider, businessId: ID.bizB, role: 'OWNER' } });

  // ---- deal stages and contacts (one pipeline per tenant) -----------------
  for (const [id, businessId, slug, category, position] of [
    [STAGE.aLead, ID.bizA, `${P}lead`, 'OPEN', 0],
    [STAGE.aWon, ID.bizA, `${P}won`, 'WON', 1],
    [STAGE.bLead, ID.bizB, `${P}lead`, 'OPEN', 0],
    [STAGE.bWon, ID.bizB, `${P}won`, 'WON', 1],
  ] as const) {
    await db.dealStage.create({ data: { id, businessId, name: slug, slug, category, position } });
  }
  await db.contact.create({ data: { id: CONTACT.a, businessId: ID.bizA, firstName: `${P}Ana`, lastName: 'Buyer' } });
  await db.contact.create({ data: { id: CONTACT.b, businessId: ID.bizB, firstName: `${P}Ben`, lastName: 'Buyer' } });

  // ---- approvals ------------------------------------------------------------
  // bizA: A1 waits on the approver now; A2 waited on them at step 0 and now
  // waits on crmWrite; A3 is resolved; A4 waits on the owner. bizB: B1 waits on
  // the approver (a member of both tenants).
  await seedApproval({ id: `${P}ar_a1`, businessId: ID.bizA, steps: [{ approverId: ID.approver }] });
  await seedApproval({
    id: `${P}ar_a2`, businessId: ID.bizA, currentStep: 1,
    steps: [{ approverId: ID.approver, status: 'approved' }, { approverId: ID.crmWrite }],
  });
  await seedApproval({ id: `${P}ar_a3`, businessId: ID.bizA, status: 'approved', steps: [{ approverId: ID.approver }] });
  await seedApproval({ id: `${P}ar_a4`, businessId: ID.bizA, steps: [{ approverId: ID.owner }] });
  await seedApproval({ id: `${P}ar_b1`, businessId: ID.bizB, steps: [{ approverId: ID.approver }] });

  // ---- procurement ----------------------------------------------------------
  for (const [id, businessId, displayName, isActive] of [
    [`${P}sup_a_beta`, ID.bizA, `${P}Beta Supplies`, true],
    [`${P}sup_a_alpha`, ID.bizA, `${P}Alpha Supplies`, true],
    [`${P}sup_a_gone`, ID.bizA, `${P}Gone Supplies`, false],
    [`${P}sup_b_foreign`, ID.bizB, `${P}Foreign Supplies`, true],
  ] as const) {
    await db.supplierConnection.create({
      data: { id, businessId, providerType: 'manual', displayName, isActive, syncCapabilities: [], accountMeta: { region: 'k13f-region' } },
    });
  }
  for (const [id, businessId, status, priority, category, max] of [
    [`${P}pr_a1`, ID.bizA, 'DRAFT', 'high', 'branding', 1000],
    [`${P}pr_a2`, ID.bizA, 'SUBMITTED', 'low', 'branding', 3000],
    [`${P}pr_a3`, ID.bizA, 'SUBMITTED', 'high', 'crm', null],
    [`${P}pr_b1`, ID.bizB, 'SUBMITTED', 'urgent', 'storefront', 900000],
    [`${P}pr_b2`, ID.bizB, 'APPROVED', 'urgent', 'storefront', 900000],
  ] as const) {
    await db.procurementRequest.create({
      data: {
        id, businessId, status, priority, userPrompt: `${P}need ${id}`,
        interpretedNeed: { category },
        estimatedBudget: max === null ? undefined : { min: 0, max },
      },
    });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  await cleanupRedis();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('seeded two tenants with their members and rows; each single-item sibling answers its own bizA row 200 and refuses the outsider 403', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(4);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.outsider } })).toBe(0);
    const item = await seedCommandItem(ID.bizA);
    const deal = await seedDeal(ID.bizA);
    const siblings = [
      `/businesses/${ID.bizA}/approvals/${P}ar_a1`,
      `/command/businesses/${ID.bizA}/items/${item.id}`,
      `/crm/businesses/${ID.bizA}/deals/${deal.id}`,
      `/procurement/businesses/${ID.bizA}/${P}pr_a1`,
    ];
    for (const url of siblings) {
      const res = await send('get', url, ID.owner);
      expect(res.status, `${url} ${res.text.slice(0, 200)}`).toBe(200);
      expect(res.body.id, url).toBe(url.split('/').pop());
      expect((await send('get', url, ID.outsider)).status, url).toBe(403);
    }
  });
});

describe('R0-13f: each formerly shadowed route reaches its own handler over HTTP, not its parameterised sibling', () => {
  it("NEGATIVE CONTROL: GET approvals/pending-for-me answers getPendingForUser's list, the requests whose current step waits on the caller in this business (with their steps), not getById's 404 for approval 'pending-for-me'", async () => {
    const cases: Array<[string, string[]]> = [
      [ID.approver, [`${P}ar_a1`]],
      [ID.crmWrite, [`${P}ar_a2`]],
      [ID.owner, [`${P}ar_a4`]],
      [ID.crmRead, []],
    ];
    for (const [actor, ids] of cases) {
      const res = await pendingForMe(actor);
      expect(res.status, `${actor} ${res.text.slice(0, 200)}`).toBe(200);
      expect(Array.isArray(res.body), actor).toBe(true);
      expect(res.body.map((r: any) => r.id), actor).toEqual(ids);
    }
    const [a2] = (await pendingForMe(ID.crmWrite)).body;
    expect(a2).toMatchObject({ businessId: ID.bizA, status: 'pending', currentStep: 1 });
    expect(a2.steps.map((s: any) => [s.stepOrder, s.approverId, s.status])).toEqual([
      [0, ID.approver, 'approved'],
      [1, ID.crmWrite, 'pending'],
    ]);
  });

  it("NEGATIVE CONTROL: POST command items/bulk/complete completes the named items of the path business and answers bulkComplete's { count }, recording one 'complete' timeline event per item, not complete's 404 for item 'bulk'", async () => {
    const one = await seedCommandItem(ID.bizA);
    const two = await seedCommandItem(ID.bizA);
    const untouched = await seedCommandItem(ID.bizA);
    const before = timeline.events.length;
    const res = await bulkCommand('complete', ID.owner, { ids: [one.id, two.id] });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({ count: 2 });
    for (const id of [one.id, two.id]) {
      const row = await rawRow('command_items', id);
      expect(row.status, id).toBe('COMPLETED');
      expect(row.completed_at, id).not.toBeNull();
    }
    expect((await rawRow('command_items', untouched.id)).status).toBe('OPEN');
    const events = timeline.events.slice(before);
    expect(events.map((e) => [e.action, e.entityId]).sort()).toEqual([['complete', one.id], ['complete', two.id]].sort());
    expect(events.every((e) => e.businessId === ID.bizA)).toBe(true);
    expect(realtime.emits.at(-1)).toMatchObject({ businessId: ID.bizA, type: 'command.bulk_completed', payload: { count: 2 } });
  });

  it("NEGATIVE CONTROL: POST command items/bulk/dismiss dismisses the named items of the path business and answers bulkDismiss's { count }, not dismiss's 404 for item 'bulk'", async () => {
    const one = await seedCommandItem(ID.bizA);
    const res = await bulkCommand('dismiss', ID.owner, { ids: [one.id] });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({ count: 1 });
    const row = await rawRow('command_items', one.id);
    expect(row.status).toBe('DISMISSED');
    expect(row.dismissed_at).not.toBeNull();
    expect(timeline.events.at(-1)).toMatchObject({ businessId: ID.bizA, action: 'dismiss', entityId: one.id });
  });

  it("NEGATIVE CONTROL: POST deals/bulk/move-stage moves each named deal through moveStage and answers bulkMoveStage's { moved, failed, results } (what the deals board and list send and read), recording the stage change as the caller, not moveStage's 404 for deal 'bulk'", async () => {
    const one = await seedDeal(ID.bizA);
    const two = await seedDeal(ID.bizA);
    const res = await bulkMove(ID.crmWrite, { dealIds: [one.id, two.id], stageId: STAGE.aWon });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({
      moved: 2,
      failed: 0,
      results: [
        { id: one.id, ok: true, stageId: STAGE.aWon, status: 'WON' },
        { id: two.id, ok: true, stageId: STAGE.aWon, status: 'WON' },
      ],
    });
    for (const id of [one.id, two.id]) {
      const row = await rawRow('deals', id);
      expect(row.stage_id, id).toBe(STAGE.aWon);
      expect(row.status, id).toBe('WON');
      expect(row.won_at, id).not.toBeNull();
    }
    const events = await db.contactEvent.findMany({ where: { businessId: ID.bizA, contactId: CONTACT.a, type: 'deal.stage_changed' } });
    const moved = events.filter((e: any) => [one.id, two.id].includes(e.data?.dealId));
    expect(moved).toHaveLength(2);
    for (const e of moved) expect({ actorType: e.actorType, actorId: e.actorId }).toEqual({ actorType: 'USER', actorId: ID.crmWrite });
  });

  it("NEGATIVE CONTROL: GET procurement suppliers answers listSuppliers' active supplier connections of the business by display name, with only the listed fields (no credentials or account metadata), not get's 404 for request 'suppliers'", async () => {
    const res = await suppliers(ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body.map((s: any) => s.id)).toEqual([`${P}sup_a_alpha`, `${P}sup_a_beta`]);
    for (const s of res.body) {
      expect(Object.keys(s).sort()).toEqual(['connectionHealth', 'displayName', 'id', 'lastSyncAt', 'providerType']);
    }
    expect(res.text).not.toContain('k13f-region');
  });

  it("NEGATIVE CONTROL: GET procurement stats answers getStats' counts of the business's requests, not get's 404 for request 'stats'", async () => {
    const res = await stats(ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      total: 3,
      byStatus: { DRAFT: 1, SUBMITTED: 2 },
      byPriority: { high: 2, low: 1 },
      byCategory: { branding: 2, crm: 1 },
      averageBudget: 2000,
      totalBudget: 4000,
      pendingApprovals: 2,
    });
  });
});

describe('R0-13f: the newly reachable handlers are bound to the path tenant', () => {
  it("NEGATIVE CONTROL: pending-for-me lists only the path business's requests: a member of both tenants whose current step waits in each sees only bizA's under bizA and only bizB's under bizB", async () => {
    const underA = await pendingForMe(ID.approver, ID.bizA);
    const underB = await pendingForMe(ID.approver, ID.bizB);
    expect(underA.status, underA.text).toBe(200);
    expect(underB.status, underB.text).toBe(200);
    expect(underA.body.map((r: any) => r.id)).toEqual([`${P}ar_a1`]);
    expect(underB.body.map((r: any) => r.id)).toEqual([`${P}ar_b1`]);
    expect(underA.body.every((r: any) => r.businessId === ID.bizA)).toBe(true);
    expect(underA.text).not.toContain(`${P}ar_b1`);
  });

  it("NEGATIVE CONTROL: command bulk complete and dismiss naming another tenant's item are refused exactly like an unknown id (404, byte-identical), alone and next to an own item, writing neither item and recording no event; the own item alone is then completed or dismissed", async () => {
    for (const verb of ['complete', 'dismiss'] as const) {
      const own = await seedCommandItem(ID.bizA);
      const foreign = await seedCommandItem(ID.bizB);
      const ownBefore = await rawRow('command_items', own.id);
      const foreignBefore = await rawRow('command_items', foreign.id);
      const eventsBefore = timeline.events.length;
      const emitsBefore = realtime.emits.length;
      for (const [ids, unknownIds] of [
        [[foreign.id], [UNKNOWN]],
        [[own.id, foreign.id], [own.id, UNKNOWN]],
      ]) {
        const refused = await bulkCommand(verb, ID.owner, { ids });
        const absent = await bulkCommand(verb, ID.owner, { ids: unknownIds });
        expect(refused.status, `${verb} ${refused.text}`).toBe(404);
        expect(refused.body).toMatchObject({ statusCode: 404, message: 'One or more command items not found' });
        expect(normalisedError(refused)).toBe(normalisedError(absent));
        expect(refused.text).not.toContain(foreign.title);
      }
      expect(await rawRow('command_items', own.id)).toEqual(ownBefore);
      expect(await rawRow('command_items', foreign.id)).toEqual(foreignBefore);
      expect(timeline.events.length).toBe(eventsBefore);
      expect(realtime.emits.length).toBe(emitsBefore);

      const res = await bulkCommand(verb, ID.owner, { ids: [own.id] });
      expect(res.status, res.text).toBe(201);
      expect(res.body).toEqual({ count: 1 });
      expect((await rawRow('command_items', own.id)).status).toBe(verb === 'complete' ? 'COMPLETED' : 'DISMISSED');
      expect(await rawRow('command_items', foreign.id)).toEqual(foreignBefore);
    }
  });

  it("NEGATIVE CONTROL: deals bulk move-stage skips another tenant's deal exactly like an unknown id (the same per-id result) and moves only the path business's deal; the foreign deal's row and its contact's events are unchanged", async () => {
    const own = await seedDeal(ID.bizA);
    const foreign = await seedDeal(ID.bizB);
    const foreignBefore = await rawRow('deals', foreign.id);
    const foreignEvents = await db.contactEvent.count({ where: { businessId: ID.bizB } });
    const res = await bulkMove(ID.owner, { dealIds: [own.id, foreign.id, UNKNOWN], stageId: STAGE.aWon });
    expect(res.status, res.text).toBe(201);
    expect(res.body.moved).toBe(1);
    expect(res.body.failed).toBe(2);
    const [ownResult, foreignResult, unknownResult] = res.body.results;
    expect(ownResult).toEqual({ id: own.id, ok: true, stageId: STAGE.aWon, status: 'WON' });
    expect(foreignResult).toEqual({ id: foreign.id, ok: false, error: 'Deal not found' });
    expect({ ...foreignResult, id: '<id>' }).toEqual({ ...unknownResult, id: '<id>' });
    expect(res.text).not.toContain(foreign.title);
    expect(await rawRow('deals', foreign.id)).toEqual(foreignBefore);
    expect(await db.contactEvent.count({ where: { businessId: ID.bizB } })).toBe(foreignEvents);
    expect(await db.contactEvent.count({ where: { contactId: CONTACT.b } })).toBe(0);
    expect((await rawRow('deals', own.id)).stage_id).toBe(STAGE.aWon);
  });

  it("NEGATIVE CONTROL: deals bulk move-stage to another tenant's stage moves nothing and answers exactly as for an unknown stage", async () => {
    const deal = await seedDeal(ID.bizA);
    const before = await rawRow('deals', deal.id);
    const foreignStage = await bulkMove(ID.owner, { dealIds: [deal.id], stageId: STAGE.bWon });
    const unknownStage = await bulkMove(ID.owner, { dealIds: [deal.id], stageId: UNKNOWN });
    expect(foreignStage.status, foreignStage.text).toBe(201);
    expect(foreignStage.body).toEqual({ moved: 0, failed: 1, results: [{ id: deal.id, ok: false, error: 'Invalid stageId' }] });
    expect(foreignStage.text).toBe(unknownStage.text);
    expect(await rawRow('deals', deal.id)).toEqual(before);
    // The same deal does move to its own tenant's stage.
    expect((await bulkMove(ID.owner, { dealIds: [deal.id], stageId: STAGE.aWon })).body.moved).toBe(1);
  });

  it('NEGATIVE CONTROL: procurement suppliers and stats read only the path business: another tenant\'s connections and requests are neither listed nor counted, an inactive connection is left out, and bizB\'s own answer holds only bizB\'s rows', async () => {
    const listA = await suppliers(ID.owner, ID.bizA);
    const statsA = await stats(ID.owner, ID.bizA);
    const listB = await suppliers(ID.outsider, ID.bizB);
    const statsB = await stats(ID.outsider, ID.bizB);
    for (const res of [listA, statsA, listB, statsB]) expect(res.status, res.text).toBe(200);
    expect(listA.text).not.toContain(`${P}sup_b_foreign`);
    expect(listA.text).not.toContain(`${P}sup_a_gone`);
    expect(listB.body.map((s: any) => s.id)).toEqual([`${P}sup_b_foreign`]);
    expect(statsA.body.total).toBe(3);
    expect(statsA.body.byPriority).not.toHaveProperty('urgent');
    expect(statsA.body.byCategory).not.toHaveProperty('storefront');
    expect(statsB.body).toMatchObject({ total: 2, byStatus: { SUBMITTED: 1, APPROVED: 1 }, totalBudget: 1800000, pendingApprovals: 1 });
  });
});

describe("R0-13f: the newly reachable handlers carry at least their single-item sibling's guards", () => {
  it('refusal: an unauthenticated caller gets 401 on each of the six routes, as on its sibling, and nothing is written', async () => {
    const before = await writableState();
    const { rows, responses } = await allSix(undefined);
    const after = await writableState();
    for (const [route, res] of Object.entries(responses)) {
      expect(res.status, `${route} ${res.text}`).toBe(401);
      expect(res.body, route).toMatchObject({ statusCode: 401, message: 'Authentication required' });
    }
    // Only the two rows allSix seeded are new, and they are as seeded.
    expect((after.items as unknown[]).length).toBe((before.items as unknown[]).length + 1);
    expect((after.deals as unknown[]).length).toBe((before.deals as unknown[]).length + 1);
    expect((await rawRow('command_items', rows.item.id)).status).toBe('OPEN');
    expect((await rawRow('deals', rows.deal.id)).stage_id).toBe(STAGE.aLead);
    expect({ events: after.events, timeline: after.timeline, realtime: after.realtime }).toEqual({
      events: before.events, timeline: before.timeline, realtime: before.realtime,
    });
  });

  it('refusal: a user with no membership in the path business (another tenant\'s owner) gets 403 on each of the six routes, as on its sibling, and nothing is written', async () => {
    const before = await writableState();
    const { rows, responses } = await allSix(ID.outsider);
    const after = await writableState();
    for (const [route, res] of Object.entries(responses)) {
      expect(res.status, `${route} ${res.text}`).toBe(403);
      expect(res.body, route).toMatchObject({ statusCode: 403, message: 'No access to this business' });
      expect(res.text, route).not.toContain(P + 'ar_a');
      expect(res.text, route).not.toContain(P + 'sup_a');
    }
    expect((await rawRow('command_items', rows.item.id)).status).toBe('OPEN');
    expect((await rawRow('deals', rows.deal.id)).stage_id).toBe(STAGE.aLead);
    expect({ events: after.events, timeline: after.timeline, realtime: after.realtime }).toEqual({
      events: before.events, timeline: before.timeline, realtime: before.realtime,
    });
  });

  it("NEGATIVE CONTROL: a crm 'read' member gets the single move's 403 (crm requires write) on deals bulk move-stage and nothing moves, while a crm 'write' member's same request moves the deal", async () => {
    const deal = await seedDeal(ID.bizA);
    const before = await rawRow('deals', deal.id);
    const single = await moveOne(ID.crmRead, deal.id, STAGE.aWon);
    const bulk = await bulkMove(ID.crmRead, { dealIds: [deal.id], stageId: STAGE.aWon });
    for (const res of [single, bulk]) {
      expect(res.status, res.text).toBe(403);
      expect(res.body.message).toBe('Insufficient permissions: crm requires write access (you have read)');
    }
    expect(await rawRow('deals', deal.id)).toEqual(before);
    const allowed = await bulkMove(ID.crmWrite, { dealIds: [deal.id], stageId: STAGE.aWon });
    expect(allowed.status, allowed.text).toBe(201);
    expect(allowed.body).toMatchObject({ moved: 1, failed: 0 });
    expect((await rawRow('deals', deal.id)).stage_id).toBe(STAGE.aWon);
  });
});

describe('R0-13f: the newly reachable bodies are validated', () => {
  it('NEGATIVE CONTROL: deals bulk move-stage validates its body as BulkMoveDealsStageDto: tsc emits it as the body\'s parameter type (the type this suite applies); a Prisma filter object, a number or null as a deal id, a non-array dealIds and a non-string stageId answer 400 and move nothing, where BulkMoveStageDto, the DTO the handler had, let the filter object through', async () => {
    const { CrmDealsController, BulkMoveDealsStageDto } = await import('../src/modules/crm/crm-deals.controller');
    const { BulkMoveStageDto } = await import('../src/modules/crm/dto/deal.dto');
    const { ValidationPipe } = await import('@nestjs/common');
    expect(await emittedParamTypes('modules/crm/crm-deals.controller.ts', 'CrmDealsController', 'bulkMoveStage')).toBe('String, BulkMoveDealsStageDto, Object');
    expect(typeof BulkMoveDealsStageDto).toBe('function');
    expect(Reflect.getMetadata('design:paramtypes', CrmDealsController.prototype, 'bulkMoveStage')).toEqual([String, BulkMoveDealsStageDto, Object]);

    // The DTO the handler had checked only that dealIds is an array.
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const meta = (metatype: unknown) => ({ type: 'body' as const, metatype: metatype as any, data: undefined });
    await expect(pipe.transform({ dealIds: [FILTER_ID], stageId: STAGE.aWon }, meta(BulkMoveStageDto))).resolves.toBeDefined();
    const refusedByPipe = await pipe.transform({ dealIds: [FILTER_ID], stageId: STAGE.aWon }, meta(BulkMoveDealsStageDto)).then(
      () => undefined,
      (err: any) => err?.getStatus?.(),
    );
    expect(refusedByPipe, 'BulkMoveDealsStageDto refuses a filter object as a deal id').toBe(400);

    const deal = await seedDeal(ID.bizA);
    const before = await writableState();
    const malformed: unknown[] = [
      { dealIds: [FILTER_ID], stageId: STAGE.aWon },
      { dealIds: [deal.id, FILTER_ID], stageId: STAGE.aWon },
      { dealIds: [123], stageId: STAGE.aWon },
      { dealIds: [null], stageId: STAGE.aWon },
      { dealIds: deal.id, stageId: STAGE.aWon },
      { dealIds: [deal.id], stageId: FILTER_ID },
      { dealIds: [deal.id], stageId: 7 },
      { dealIds: [deal.id] },
    ];
    for (const body of malformed) {
      const label = JSON.stringify(body);
      const res = await bulkMove(ID.owner, body);
      expect(res.status, `${label} ${res.text}`).toBe(400);
      expect(res.body, label).toMatchObject({ statusCode: 400 });
      expect(res.text, label).not.toContain('Prisma');
    }
    expect(await writableState()).toEqual(before);
    expect((await rawRow('deals', deal.id)).stage_id).toBe(STAGE.aLead);
  });

  it('NEGATIVE CONTROL: command bulk complete and dismiss validate their body as BulkCommandItemsDto (tsc emits it as the body\'s parameter type): an empty, non-array or non-string ids, a Prisma filter object included, answers 400 and writes nothing', async () => {
    const { CommandController } = await import('../src/modules/command/command.controller');
    const { BulkCommandItemsDto } = await import('../src/modules/command/dto/bulk-command-items.dto');
    for (const handler of ['bulkComplete', 'bulkDismiss']) {
      expect(await emittedParamTypes('modules/command/command.controller.ts', 'CommandController', handler), handler).toBe('String, BulkCommandItemsDto');
      expect(Reflect.getMetadata('design:paramtypes', CommandController.prototype, handler), handler).toEqual([String, BulkCommandItemsDto]);
    }
    const item = await seedCommandItem(ID.bizA);
    const before = await writableState();
    const malformed: unknown[] = [{ ids: [] }, { ids: item.id }, { ids: [123] }, { ids: [FILTER_ID] }, { ids: [item.id, FILTER_ID] }, {}];
    for (const verb of ['complete', 'dismiss'] as const) {
      for (const body of malformed) {
        const label = `${verb} ${JSON.stringify(body)}`;
        const res = await bulkCommand(verb, ID.owner, body);
        expect(res.status, `${label} ${res.text}`).toBe(400);
        expect(res.body, label).toMatchObject({ statusCode: 400 });
        expect(res.text, label).not.toContain('Prisma');
      }
    }
    expect(await writableState()).toEqual(before);
    expect((await rawRow('command_items', item.id)).status).toBe('OPEN');
  });

  it("NEGATIVE CONTROL: deals bulk move-stage refuses a deal id or stageId the database cannot compare (a NUL byte, an unpaired surrogate) with 400 before any deal moves, alone and next to an own deal, where bulkMoveStage's per-id catch answered 201 with Prisma's raw error (server source path, code frame, PostgresError); a well-formed id still gets its per-id result", async () => {
    const deal = await seedDeal(ID.bizA);
    const before = await writableState();
    // Postgres refuses NUL in text (22021); Prisma refuses a lone surrogate
    // before the query is sent. Both threw out of moveStage's findFirst, and
    // bulkMoveStage returned err.message per id.
    const unrepresentable = ['x\u0000y', `${P}deal\u0000`, '\ud800', `${P}deal\udc00x`];
    const bodies: unknown[] = [];
    for (const bad of unrepresentable) {
      bodies.push({ dealIds: [bad], stageId: STAGE.aWon });
      bodies.push({ dealIds: [deal.id, bad], stageId: STAGE.aWon });
      bodies.push({ dealIds: [deal.id], stageId: bad });
    }
    const leaks = ['Prisma', 'invocation', 'PostgresError', 'ConnectorError', 'findFirst', 'crm-deals.service', '.ts:', '22021', path.resolve(__dirname, '..')];
    for (const body of bodies) {
      const label = JSON.stringify(body);
      const res = await bulkMove(ID.owner, body);
      expect(res.status, `${label} ${res.text}`).toBe(400);
      expect(res.body, label).toMatchObject({ statusCode: 400 });
      for (const leak of leaks) expect(res.text, `${label} carries ${leak}`).not.toContain(leak);
    }
    expect(await writableState()).toEqual(before);
    expect((await rawRow('deals', deal.id)).stage_id).toBe(STAGE.aLead);

    // Only text the database cannot hold is refused: an unknown id, a control
    // character other than NUL and a paired surrogate reach moveStage and get
    // the unknown id's per-id result, and the own deal next to them moves.
    const wellFormed = [UNKNOWN, `${P}deal\u0001`, `${P}deal😀`];
    const res = await bulkMove(ID.owner, { dealIds: [deal.id, ...wellFormed], stageId: STAGE.aWon });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({
      moved: 1,
      failed: wellFormed.length,
      results: [
        { id: deal.id, ok: true, stageId: STAGE.aWon, status: 'WON' },
        ...wellFormed.map((id) => ({ id, ok: false, error: 'Deal not found' })),
      ],
    });
  });
});

describe('R0-13f: the approval siblings of pending-for-me are bound to the path tenant', () => {
  /** The request row and its steps, every column, read past the soft-delete extension. */
  async function approvalState(id: string) {
    const steps: Array<{ row: string }> = await db.$queryRawUnsafe(
      `SELECT to_jsonb(t)::text AS row FROM approval_steps t WHERE t.approval_request_id = $1 ORDER BY t.id`, id,
    );
    return { request: await rawRow('approval_requests', id), steps: steps.map((s) => JSON.parse(s.row)) };
  }

  /** The seven per-request calls, each on `approvalId` under `biz` as `actor`. */
  const perRequest = (approvalId: string, biz: string, actor: string) => {
    const base = `/businesses/${biz}/approvals/${approvalId}`;
    return {
      getById: () => send('get', base, actor),
      approve: () => send('post', `${base}/approve`, actor, { decision: 'approve' }),
      reject: () => send('post', `${base}/reject`, actor, { decision: 'reject' }),
      delegate: () => send('post', `${base}/delegate`, actor, { delegatedTo: ID.crmWrite }),
      cancel: () => send('delete', base, actor),
      escalate: () => send('post', `${base}/escalate`, actor, { reason: 'k13f' }),
    };
  };

  it("NEGATIVE CONTROL: get, approve, reject, delegate, cancel and escalate of another tenant's approval request, through a business the caller is a member of, are refused exactly like an unknown id (404, byte-identical but for the id in the path), write nothing and emit nothing; the same calls through the request's own business still answer", async () => {
    const emitter = app.get((await import('@nestjs/event-emitter')).EventEmitter2);
    const emitted: string[] = [];
    const listener = (event: string | string[]) => { emitted.push(String(event)); };
    emitter.onAny(listener);
    try {
      // bizA's request waiting on the approver (a member of both tenants), who
      // also requested it, so every verb's own actor check would pass.
      const foreign = `${P}ar_x_foreign`;
      await seedApproval({ id: foreign, businessId: ID.bizA, requesterId: ID.approver, steps: [{ approverId: ID.approver }] });
      const foreignBefore = await approvalState(foreign);
      const verbs = ['getById', 'approve', 'reject', 'delegate', 'cancel', 'escalate'] as const;
      // The approver through bizB, and bizB's owner (no bizA membership,
      // getById and escalate need no actor of the request).
      for (const [actor, names] of [
        [ID.approver, verbs],
        [ID.outsider, ['getById', 'escalate'] as const],
      ] as const) {
        const refusedCalls = perRequest(foreign, ID.bizB, actor);
        const absentCalls = perRequest(UNKNOWN, ID.bizB, actor);
        for (const verb of names) {
          const refused = await refusedCalls[verb]();
          const absent = await absentCalls[verb]();
          expect(refused.status, `${actor} ${verb} ${refused.text}`).toBe(404);
          expect(refused.body, `${actor} ${verb}`).toMatchObject({ statusCode: 404, message: 'Approval request not found' });
          expect(normalisedError(refused).split(foreign).join(UNKNOWN), `${actor} ${verb}`).toBe(normalisedError(absent));
          expect(refused.text, `${actor} ${verb}`).not.toContain(`${foreign} title`);
          expect(refused.text, `${actor} ${verb}`).not.toContain(ID.bizA);
        }
      }
      expect(await approvalState(foreign)).toEqual(foreignBefore);
      expect(emitted).toEqual([]);

      // Through bizA, the request's own business, each verb still runs.
      const own = perRequest(foreign, ID.bizA, ID.approver);
      const read = await own.getById();
      expect(read.status, read.text).toBe(200);
      expect(read.body).toMatchObject({ id: foreign, businessId: ID.bizA, status: 'pending' });
      const approved = await own.approve();
      expect(approved.status, approved.text).toBe(201);
      expect(approved.body).toMatchObject({ id: foreign, status: 'approved' });

      const verbsOwn: Array<[keyof ReturnType<typeof perRequest>, number, Record<string, unknown>]> = [
        ['reject', 201, { status: 'rejected' }],
        ['delegate', 201, { status: 'pending' }],
        ['cancel', 200, { status: 'cancelled' }],
        ['escalate', 201, { status: 'escalated' }],
      ];
      for (const [verb, status, shape] of verbsOwn) {
        const id = `${P}ar_x_own_${verb}`;
        await seedApproval({ id, businessId: ID.bizA, requesterId: ID.approver, steps: [{ approverId: ID.approver }] });
        const res = await perRequest(id, ID.bizA, ID.approver)[verb]();
        expect(res.status, `${verb} ${res.text}`).toBe(status);
        expect(res.body, verb).toMatchObject({ id, ...shape });
      }
      expect((await approvalState(`${P}ar_x_own_delegate`)).steps[0]).toMatchObject({ status: 'delegated', delegated_to: ID.crmWrite });
      // The listener saw the own-business writes, so its silence above was no blind spot.
      expect(emitted).toEqual(expect.arrayContaining(['approval.step_approved', 'approval.cancelled', 'approval.escalated']));
    } finally {
      emitter.offAny(listener);
    }
  });
});
