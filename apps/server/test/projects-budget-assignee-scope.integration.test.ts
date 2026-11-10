/**
 * W9-PROJECTS-SERVER (FOLLOW10): the two server follow-ups the PR #196 web port recorded as web
 * it.todo, on the real database.
 *
 *   SEC-W196-2  GET /projects/businesses/:bid/projects/:pid/budget had only AuthGuard and
 *               BusinessGuard and returned expenseCost, timeCost and totalCost, while the same
 *               tab's expense list (GET /expenses/businesses/:bid/expenses/by-project/:pid) needs
 *               expenses:read. A member refused that list read the project's spend through the
 *               budget card. The route now withholds the costs (null) from a member without
 *               expenses read, and the figures worked out from them (remainingBudget, percentUsed,
 *               status: with budgetAmount they give totalCost back), as D-100 withholds money
 *               signals with the amounts. The budget itself and the hours burn stay: they are the
 *               project's own fields, read on projects access.
 *               (was it.todo in apps/web/.../__tests__/project-budget-view.test.tsx)
 *   SEC-W196-3  GET /businesses/:bid/task-assignments/options (D-87: a member of the business or
 *               one of its booking staff) named a member who has no name by their email, and any
 *               member reads it, STAFF refused the team list (team:none) included. It no longer
 *               falls back to the email: a member is offered by their name, else their first and
 *               last name, else a neutral label that tells options apart by the end of their id.
 *               A stored name that is an email (account bootstrap writes the email as the name
 *               when none is given) is not a name. The list stays open to every member (gating it
 *               on team:read would take the assignee picker from STAFF, who may assign tasks).
 *               (was it.todo in apps/web/.../project-detail-tabs/__tests__/tasks-tab.test.tsx)
 *
 * Review repairs (W9-PROJECTS-SERVER repair):
 *   SEC-W9PS-1 / CR-W9PS-2  KEY's projects_get_budget called getProjectBudget with no viewer, so a
 *               member with projects read and no expenses read (whom the route above refuses the
 *               costs) passed the graph-action authority and read them through KEY. The dispatcher
 *               now passes the member KEY runs for, the viewer is required, and a call with no
 *               viewer or no member reads no costs (fails closed).
 *   SEC-W9PS-2  inviteTeamMember stores the email's local part as the placeholder's name, and
 *               adoption at sign-up keeps it: the options list showed it to every member. A name
 *               that is the member's email local part is not a name.
 *   SEC-W9PS-3  KEY's people_workload (TaskAssignmentService.workloadSummary) still named a member
 *               with no name by their email; it names members as the options list does.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * RateLimitGuard (real Redis at REDIS_URL), ProjectsService, TaskAssignmentService are real
 * against DATABASE_URL. The stand-ins: identity attachment from an `x-test-user` header (as the
 * Supabase-verifying AuthMiddleware would attach it), a recording EventEmitter2 and empty stubs
 * for the AI collaborators the budget and options paths never call.
 *
 * Fixtures: prefix `v95r_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by
 * raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v95r_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  admin: `${P}admin`, // ADMIN of bizA, no explicit scopes
  staffDefault: `${P}staffDefault`, // STAFF of bizA, role defaults (projects/expenses read, team none)
  staffNoExpenses: `${P}staffNoExpenses`, // STAFF of bizA, explicit { projects: read, expenses: none }
  staffProjectsOnly: `${P}staffProjectsOnly`, // STAFF of bizA, explicit { projects: write } (expenses absent = none)
  ownerNoMembership: `${P}ownerNoMembership`, // owner of bizC with no Membership row (BusinessGuard admits by ownerId)
  // Members of bizA the assignee options name.
  memberNamed: `${P}member_named`,
  memberNoName: `${P}member_7f3a`, // name null, no first/last name
  memberEmailName: `${P}member_9c2e`, // name is its own email (as account bootstrap writes it)
  memberFirstLast: `${P}member_first`, // name null, first and last name set
  memberLocalName: `${P}member_5d1b`, // name is its email's local part (an adopted invite keeps it)
  bizA: `${P}bizA`,
  bizC: `${P}bizC`,
  staffA: `${P}staffA`, // bizA booking staff
  projectA: `${P}projectA`,
  projectC: `${P}projectC`,
};

const EMAIL = {
  memberNoName: `${P}private.noname@test.local`,
  memberEmailName: `${P}private.emailname@test.local`,
  memberFirstLast: `${P}private.firstlast@test.local`,
  memberLocalName: `${P}lee.private@test.local`,
  // inviteTeamMember writes the placeholder (a generated id) under this address (SEC-W9PS-2)
  invited: `${P}jane.private@personal.example`,
};

/** What inviteTeamMember and adoption leave as the name: the email's local part. */
const LOCAL_PART = {
  memberLocalName: `${P}lee.private`,
  invited: `${P}jane.private`,
};

/** The project's money: 2 h at the project rate 150 (timeCost 300) and two expenses 777 + 23 (expenseCost 800). */
const BUDGET_AMOUNT = 5000;
const TIME_COST = 300;
const EXPENSE_COST = 800;
const TOTAL_COST = TIME_COST + EXPENSE_COST;

let db: any;
let app: any;
let redis: any;
/** The real KEY dispatcher (FlowOrchestratorService.executeToolAction) over this suite's real services. */
let dispatcher: any;
let projectsSvc: any;
let prismaSvc: any;
/** The User row inviteTeamMember created for EMAIL.invited (SEC-W9PS-2). */
let invitedId: string;

async function cleanup() {
  for (const sql of [
    `DELETE FROM time_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_milestones WHERE project_id IN (SELECT id FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    // the invited placeholder has a generated id; its address carries the prefix
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
  if (redis) {
    try {
      const keys: string[] = await redis.keys(`rate_limit:*:${P}*`);
      if (keys.length > 0) await redis.del(...keys);
    } catch { /* best-effort */ }
  }
}

function get(actor: string, url: string) {
  return request(app.getHttpServer()).get(url).set('x-test-user', actor);
}

const budgetUrl = (biz: string = ID.bizA, project: string = ID.projectA) => `/projects/businesses/${biz}/projects/${project}/budget`;
const optionsUrl = (biz: string = ID.bizA) => `/businesses/${biz}/task-assignments/options`;

const COST_FIELDS = ['expenseCost', 'timeCost', 'totalCost', 'remainingBudget', 'percentUsed', 'status'] as const;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const IORedis = (await import('ioredis')).default;
  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { ProjectsController } = await import('../src/modules/projects/projects.controller');
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { ProjectPlannerService } = await import('../src/modules/projects/project-planner.service');
  const { ProjectPlanExecutorService } = await import('../src/modules/projects/project-plan-executor.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentController } = await import('../src/modules/task-assignments/task-assignment.controller');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { TaskAssignmentRecommenderService } = await import('../src/modules/task-assignments/task-assignment-recommender.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { StrategicIntelligenceService } = await import('../src/modules/ai/strategic-intelligence.service');
  const { WorkloadAggregatorService } = await import('../src/modules/ai/workload-aggregator.service');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectsController, TaskAssignmentController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      ProjectsService,
      ProjectPlannerService,
      ProjectPlanExecutorService,
      TimelineService,
      EvidenceService,
      TaskAssignmentService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: BusinessEventService, useValue: { emit: async () => undefined } },
      // Not called by the budget and options paths under test.
      { provide: TaskAssignmentRecommenderService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: BlueprintService, useValue: {} },
      { provide: AiOversightService, useValue: {} },
      { provide: StrategicIntelligenceService, useValue: {} },
      { provide: WorkloadAggregatorService, useValue: {} },
    ],
  }).compile();

  // TaskAssignmentController's constructor names its services by type only (no @Inject), which
  // vitest's esbuild transform gives Nest no metadata for; the built server (tsc) wires them. Hand
  // the controller the real services the module compiled. Its guards are resolved by Nest as usual.
  const taskAssignments = moduleRef.get(TaskAssignmentController) as any;
  taskAssignments.service ??= moduleRef.get(TaskAssignmentService);
  taskAssignments.recommender ??= moduleRef.get(TaskAssignmentRecommenderService);

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
  await app.init();

  // The real KEY dispatcher, as call-log-visibility.integration.test.ts builds it: its lazy
  // collaborators resolve to this module's real services.
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  prismaSvc = moduleRef.get(PrismaService);
  projectsSvc = moduleRef.get(ProjectsService);
  const taskAssignmentSvc = moduleRef.get(TaskAssignmentService);
  dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma: prismaSvc,
    moduleRef: {
      get: (token: unknown) => (token === ProjectsService ? projectsSvc : token === TaskAssignmentService ? taskAssignmentSvc : undefined),
    },
  });

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.admin, ID.staffDefault, ID.staffNoExpenses, ID.staffProjectsOnly, ID.ownerNoMembership]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: `V95R ${id.slice(P.length)}`, role: 'USER' } });
  }
  await db.user.create({ data: { id: ID.memberNamed, email: `${P}member.named@test.local`, name: 'V95R Ada Member', role: 'USER' } });
  await db.user.create({ data: { id: ID.memberNoName, email: EMAIL.memberNoName, name: null, role: 'USER' } });
  await db.user.create({ data: { id: ID.memberEmailName, email: EMAIL.memberEmailName, name: EMAIL.memberEmailName, role: 'USER' } });
  await db.user.create({
    data: { id: ID.memberFirstLast, email: EMAIL.memberFirstLast, name: null, firstName: 'Grace', lastName: 'Hopper', role: 'USER' },
  });

  await db.user.create({ data: { id: ID.memberLocalName, email: EMAIL.memberLocalName, name: LOCAL_PART.memberLocalName, role: 'USER' } });

  await db.business.create({ data: { id: ID.bizA, name: 'V95R Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizC, name: 'V95R Biz C', ownerId: ID.ownerNoMembership } });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.staffNoExpenses, 'STAFF', { projects: 'read', expenses: 'none', team: 'none' });
  await m(ID.staffProjectsOnly, 'STAFF', { projects: 'write' });
  for (const member of [ID.memberNamed, ID.memberNoName, ID.memberEmailName, ID.memberFirstLast, ID.memberLocalName]) await m(member, 'STAFF');

  // SEC-W9PS-2: an invitation not yet accepted, through the real IdentityService.inviteTeamMember
  // (its BlueprintService and DefaultTriggersService are not called by an invite).
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const identity = new IdentityService(moduleRef.get(PrismaService), {} as never, {} as never);
  invitedId = (await identity.inviteTeamMember(ID.bizA, EMAIL.invited, 'STAFF', ID.owner)).userId;

  await db.staffMember.create({ data: { id: ID.staffA, businessId: ID.bizA, name: 'V95R Sam Staff' } });

  for (const [project, biz] of [[ID.projectA, ID.bizA], [ID.projectC, ID.bizC]] as const) {
    await db.project.create({
      data: { id: project, businessId: biz, name: `V95R ${project}`, budgetAmount: BUDGET_AMOUNT, budgetHours: 40, hourlyRate: 150 },
    });
    await db.projectTask.create({ data: { id: `${project}_t1`, projectId: project, businessId: biz, title: 'V95R task', trackedHours: 10 } });
    await db.timeEntry.create({
      data: {
        id: `${project}_te1`,
        businessId: biz,
        projectId: project,
        userId: biz === ID.bizA ? ID.owner : ID.ownerNoMembership,
        startTime: new Date('2026-11-01T09:00:00Z'),
        endTime: new Date('2026-11-01T11:00:00Z'),
        durationMinutes: 120,
        billable: true,
        billed: false,
      },
    });
    await db.expense.create({ data: { id: `${project}_ex1`, businessId: biz, projectId: project, description: 'V95R materials', amount: 777 } });
    await db.expense.create({ data: { id: `${project}_ex2`, businessId: biz, projectId: project, description: 'V95R delivery', amount: 23 } });
  }
});

afterAll(async () => {
  await app?.close();
  await cleanup();
  if (redis) await redis.quit();
});

// ─── SEC-W196-2: the budget's costs need expenses read ───────────────────────

describe('SEC-W196-2 (W9-PROJECTS-SERVER, D-100 withholding rule): GET .../projects/:pid/budget serves its costs only to a member who reads expenses', () => {
  it.each([
    ['the OWNER', ID.owner],
    ['an ADMIN (role defaults)', ID.admin],
    ['a STAFF member on role defaults (expenses: read)', ID.staffDefault],
  ])('%s is served the costs and what follows from them', async (_who, actor) => {
    const res = await get(actor, budgetUrl());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projectId: ID.projectA,
      budgetAmount: BUDGET_AMOUNT,
      budgetHours: 40,
      trackedHours: 10,
      percentHoursUsed: 25,
      timeCost: TIME_COST,
      expenseCost: EXPENSE_COST,
      totalCost: TOTAL_COST,
      remainingBudget: BUDGET_AMOUNT - TOTAL_COST,
      percentUsed: Math.round((TOTAL_COST / BUDGET_AMOUNT) * 100),
      status: 'HEALTHY',
    });
  });

  it('the business owner with no Membership row (BusinessGuard admits them by Business.ownerId) is served the costs', async () => {
    const res = await get(ID.ownerNoMembership, budgetUrl(ID.bizC, ID.projectC));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: ID.projectC, expenseCost: EXPENSE_COST, timeCost: TIME_COST, totalCost: TOTAL_COST });
  });

  it.each([
    ['a STAFF member with expenses: none in an explicit scope map', ID.staffNoExpenses],
    ['a STAFF member whose explicit scope map has no expenses key (none)', ID.staffProjectsOnly],
  ])('SEC-W196-2 (was it.todo): %s is served the budget and hours burn with expenseCost, timeCost and totalCost withheld (null), and the figures worked out from them withheld too', async (_who, actor) => {
    const res = await get(actor, budgetUrl());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projectId: ID.projectA,
      budgetAmount: BUDGET_AMOUNT,
      budgetHours: 40,
      trackedHours: 10,
      percentHoursUsed: 25,
    });
    for (const field of COST_FIELDS) expect(res.body[field], field).toBeNull();
    // No cost figure is anywhere in the answer, under any key.
    const text = JSON.stringify(res.body);
    for (const figure of [TIME_COST, EXPENSE_COST, TOTAL_COST, 777, BUDGET_AMOUNT - TOTAL_COST, Math.round((TOTAL_COST / BUDGET_AMOUNT) * 100)]) {
      expect(text).not.toMatch(new RegExp(`:${figure}(?![0-9])`));
    }
  });

  it('the member refused the costs is the member the project expense list refuses (expenses:read), so the web shows the card to exactly those it answers', async () => {
    const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
    const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
    const { Reflector } = await import('@nestjs/core');
    const reflector = new Reflector();
    const handler = (ExpensesController.prototype as any).getExpensesByProject;
    expect(reflector.get(MODULE_SCOPE_KEY, handler)).toEqual({ module: 'expenses', minLevel: 'read' });
    const prisma = app.get((await import('../src/core/prisma/prisma.service')).PrismaService);
    const guard = new ModuleScopeGuard(prisma, reflector);
    const ctx = (userId: string) => ({
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: userId, role: 'USER' }, params: { businessId: ID.bizA, projectId: ID.projectA } }) }),
    }) as any;
    for (const actor of [ID.owner, ID.admin, ID.staffDefault]) {
      await expect(guard.canActivate(ctx(actor))).resolves.toBe(true);
      expect((await get(actor, budgetUrl())).body.totalCost).toBe(TOTAL_COST);
    }
    for (const actor of [ID.staffNoExpenses, ID.staffProjectsOnly]) {
      await expect(guard.canActivate(ctx(actor))).rejects.toThrow(/expenses requires read/);
      expect((await get(actor, budgetUrl())).body.totalCost).toBeNull();
    }
  });

  it('another business\'s project is still 404, whatever the member reads', async () => {
    expect((await get(ID.owner, budgetUrl(ID.bizA, ID.projectC))).status).toBe(404);
    expect((await get(ID.staffNoExpenses, budgetUrl(ID.bizA, ID.projectC))).status).toBe(404);
  });
});

// ─── SEC-W196-3: the assignee options never name a member by their email ─────

describe('SEC-W196-3 (W9-PROJECTS-SERVER, D-87): GET .../task-assignments/options does not fall back to a member\'s email', () => {
  const userOption = (body: any[], id: string) => body.find((o) => o.type === 'User' && o.id === id);

  it('SEC-W196-3 (was it.todo): a member with no name is offered under a neutral label, never their email, to a STAFF member refused the team list (team: none)', async () => {
    const res = await get(ID.staffNoExpenses, optionsUrl());
    expect(res.status).toBe(200);
    expect(userOption(res.body, ID.memberNoName)).toEqual({ type: 'User', id: ID.memberNoName, name: 'Unnamed member (…7f3a)' });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL.memberNoName);
  });

  it('SEC-W196-3: a member whose stored name is their email (as account bootstrap writes it) is not offered by that email', async () => {
    const res = await get(ID.staffDefault, optionsUrl());
    expect(res.status).toBe(200);
    expect(userOption(res.body, ID.memberEmailName)).toEqual({ type: 'User', id: ID.memberEmailName, name: 'Unnamed member (…9c2e)' });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL.memberEmailName);
  });

  it('SEC-W196-3: a member with a first and last name but no display name is offered by that name', async () => {
    const res = await get(ID.staffDefault, optionsUrl());
    expect(res.status).toBe(200);
    expect(userOption(res.body, ID.memberFirstLast)).toEqual({ type: 'User', id: ID.memberFirstLast, name: 'Grace Hopper' });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL.memberFirstLast);
  });

  it('SEC-W196-3: no option carries an email address, whoever reads the list (OWNER included)', async () => {
    for (const actor of [ID.owner, ID.admin, ID.staffDefault, ID.staffNoExpenses]) {
      const res = await get(actor, optionsUrl());
      expect(res.status).toBe(200);
      for (const option of res.body) {
        expect(Object.keys(option).sort()).toEqual(['id', 'name', 'type']);
        expect(option.name).not.toMatch(/@/);
      }
    }
  });

  it('D-87 as built: named members and booking staff keep their names; the list stays open to every member', async () => {
    const res = await get(ID.staffNoExpenses, optionsUrl());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      { type: 'User', id: ID.memberNamed, name: 'V95R Ada Member' },
      { type: 'User', id: ID.owner, name: 'V95R owner' },
      { type: 'StaffMember', id: ID.staffA, name: 'V95R Sam Staff' },
    ]));
  });

  it('a non-member is refused the list (BusinessGuard)', async () => {
    expect((await get(ID.ownerNoMembership, optionsUrl())).status).toBe(403);
  });
});

// ─── Review repairs: the sibling doors (KEY) and the email's local part ──────

const KEY_BUDGET_KEPT = { projectId: ID.projectA, budgetAmount: BUDGET_AMOUNT, budgetHours: 40, trackedHours: 10, percentHoursUsed: 25 };

/** KEY's projects_get_budget through the real dispatcher, for the surface and member `action` names. */
async function keyBudget(action: Record<string, unknown> | undefined) {
  const result = await dispatcher.executeToolByName(ID.bizA, 'projects_get_budget', { projectId: ID.projectA }, action);
  return result.budget;
}

describe('SEC-W9PS-1 / CR-W9PS-2 (W9-PROJECTS-SERVER repair, D-100 withholding rule): KEY\'s projects_get_budget serves the costs only when the member KEY runs for reads expenses, as the route does', () => {
  it('SEC-W9PS-1: a member with projects read and expenses none passes the graph-action authority for projects_get_budget, and KEY serves them the budget with the costs withheld (null) on every surface that carries them, as the route does', async () => {
    const { assertMayRunGraphAction } = await import('../src/modules/ai/graph-actions.controller');
    await expect(assertMayRunGraphAction(prismaSvc, ID.bizA, { id: ID.staffNoExpenses }, 'projects_get_budget', ID.staffNoExpenses)).resolves.toBeUndefined();
    const route = (await get(ID.staffNoExpenses, budgetUrl())).body;
    const cases: Array<Record<string, unknown>> = [
      { surface: 'GRAPH_ACTION', principalUserId: ID.staffNoExpenses },
      { surface: 'CHAT', principalUserId: ID.staffNoExpenses },
      { surface: 'CHAT_STREAM', principalUserId: ID.staffProjectsOnly },
      { surface: 'CORTEX_BRIDGE', onBehalfOfUserId: ID.staffNoExpenses },
      { surface: 'PROPOSAL', onBehalfOfUserId: ID.staffProjectsOnly },
      { surface: 'PRO_AUTO_MONITOR', onBehalfOfUserId: ID.staffNoExpenses },
    ];
    for (const action of cases) {
      const label = `${String(action.surface)} ${String(action.principalUserId ?? action.onBehalfOfUserId)}`;
      const budget = await keyBudget(action);
      expect(budget, label).toMatchObject(KEY_BUDGET_KEPT);
      for (const field of COST_FIELDS) expect(budget[field], `${label} ${field}`).toBeNull();
      if (action.principalUserId === ID.staffNoExpenses) expect(budget, label).toEqual(route);
    }
  });

  it('SEC-W9PS-1: the OWNER, an ADMIN and a STAFF member who reads expenses are served the costs through KEY, as the route serves them', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      [ID.owner, { surface: 'CHAT', principalUserId: ID.owner }],
      [ID.admin, { surface: 'GRAPH_ACTION', principalUserId: ID.admin }],
      [ID.staffDefault, { surface: 'PROPOSAL', onBehalfOfUserId: ID.staffDefault }],
    ];
    for (const [actor, action] of cases) {
      const budget = await keyBudget(action);
      expect(budget, actor).toMatchObject({ ...KEY_BUDGET_KEPT, timeCost: TIME_COST, expenseCost: EXPENSE_COST, totalCost: TOTAL_COST, status: 'HEALTHY' });
      expect(budget, actor).toEqual((await get(actor, budgetUrl())).body);
    }
  });

  it('SEC-W9PS-1: a KEY run with no member (an inbound conversation, a caller that declares nothing) reads no costs: it fails closed', async () => {
    for (const action of [{ surface: 'INBOUND_CONVERSATION' }, { surface: 'PHONE_STREAM' }, undefined]) {
      const budget = await keyBudget(action);
      expect(budget, String(action?.surface)).toMatchObject(KEY_BUDGET_KEPT);
      for (const field of COST_FIELDS) expect(budget[field], `${String(action?.surface)} ${field}`).toBeNull();
    }
  });

  it('SEC-W9PS-1: getProjectBudget called with no viewer (a new caller that forgets it) reads no costs: it fails closed', async () => {
    const budget = await projectsSvc.getProjectBudget(ID.projectA, ID.bizA);
    expect(budget).toMatchObject(KEY_BUDGET_KEPT);
    for (const field of COST_FIELDS) expect(budget[field], field).toBeNull();
  });
});

describe('SEC-W9PS-2 (W9-PROJECTS-SERVER repair, D-87): the options list does not show a member\'s email local part as their name', () => {
  const userOption = (body: any[], id: string) => body.find((o) => o.type === 'User' && o.id === id);

  it('SEC-W9PS-2: an invitation not yet accepted (inviteTeamMember stores the email\'s local part as the name) is offered under a neutral label to a STAFF member refused the team list (team: none)', async () => {
    const invited = await db.user.findUnique({ where: { id: invitedId }, select: { name: true, email: true } });
    expect(invited).toEqual({ name: LOCAL_PART.invited, email: EMAIL.invited }); // the premise
    const res = await get(ID.staffNoExpenses, optionsUrl());
    expect(res.status).toBe(200);
    expect(userOption(res.body, invitedId)).toEqual({ type: 'User', id: invitedId, name: `Unnamed member (…${invitedId.slice(-4)})` });
    expect(JSON.stringify(res.body)).not.toContain('jane.private');
  });

  it('SEC-W9PS-2: a signed-up member whose name is still their email\'s local part (adoption keeps the placeholder\'s name) is offered under a neutral label', async () => {
    const res = await get(ID.staffDefault, optionsUrl());
    expect(res.status).toBe(200);
    expect(userOption(res.body, ID.memberLocalName)).toEqual({ type: 'User', id: ID.memberLocalName, name: 'Unnamed member (…5d1b)' });
    expect(JSON.stringify(res.body)).not.toContain('lee.private');
  });
});

describe('SEC-W9PS-3 (W9-PROJECTS-SERVER repair, D-87): KEY\'s people_workload names members as the options list does, never by their email', () => {
  it('SEC-W9PS-3: KEY people_workload for a STAFF member with team none names a member with no name, one named by their email and one named by its local part under the neutral label, and carries no email', async () => {
    const summary = await dispatcher.executeToolByName(ID.bizA, 'people_workload', {}, { surface: 'CHAT', principalUserId: ID.staffNoExpenses });
    const person = (id: string) => summary.people.find((p: any) => p.assignableType === 'User' && p.assignableId === id);
    expect(person(ID.memberNoName)?.name).toBe('Unnamed member (…7f3a)');
    expect(person(ID.memberEmailName)?.name).toBe('Unnamed member (…9c2e)');
    expect(person(ID.memberLocalName)?.name).toBe('Unnamed member (…5d1b)');
    expect(person(invitedId)?.name).toBe(`Unnamed member (…${invitedId.slice(-4)})`);
    expect(person(ID.memberFirstLast)?.name).toBe('Grace Hopper');
    expect(person(ID.memberNamed)?.name).toBe('V95R Ada Member');
    const text = JSON.stringify(summary);
    for (const email of Object.values(EMAIL)) expect(text).not.toContain(email);
    for (const local of Object.values(LOCAL_PART)) expect(text).not.toContain(local);
    for (const p of summary.people) expect(p.name).not.toMatch(/@/);
  });

  it('SEC-W9PS-3: the workload and the options list name every member alike', async () => {
    const summary = await dispatcher.executeToolByName(ID.bizA, 'people_workload', {}, { surface: 'CHAT', principalUserId: ID.staffNoExpenses });
    const options = (await get(ID.staffNoExpenses, optionsUrl())).body as Array<{ type: string; id: string; name: string }>;
    const workloadNames = Object.fromEntries(
      summary.people.filter((p: any) => p.assignableType === 'User').map((p: any) => [p.assignableId, p.name]),
    );
    const optionNames = Object.fromEntries(options.filter((o) => o.type === 'User').map((o) => [o.id, o.name]));
    expect(workloadNames).toEqual(optionNames);
  });
});
