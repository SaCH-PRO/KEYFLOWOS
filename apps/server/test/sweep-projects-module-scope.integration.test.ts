/**
 * SWEEP-P0-SCOPES (browser sweep 2026-11-13, BUG-014 major) — projects honour the projects module
 * scope, against a REAL database through the HTTP routes.
 *
 * BUG-014 (re-checked 2026-11-13): a STAFF member with projects 'read' created a project (POST 201)
 * and deleted the owner's project (DELETE 200). ProjectsController ran AuthGuard and BusinessGuard
 * only (class level), with no ModuleScopeGuard and no @RequireModuleScope on any of its routes, so a
 * business membership was the whole check; only plan approve and delete checked projects:write in
 * the service (D-85).
 *
 * The rule: every ProjectsController route runs AuthGuard, BusinessGuard, then ModuleScopeGuard, and
 * requires the projects module on its handler: read for a GET, write for every other route
 * (POST .../events/:eventId/analyze-impact included: it writes no project row but spends the
 * business's metered AI credits, review SEC-5), except the two plan doors owner ruling D-85
 * governs (POST .../plans/:planId/approve and DELETE .../plans/:planId: OWNER/ADMIN or
 * projects:write, ProjectsService.assertMayGovernPlans), which name no module on the handler so
 * the guard cannot refuse an OWNER or ADMIN whose explicit map holds projects below write (review
 * CR-2). Role defaults (module-vocabulary ROLE_DEFAULT_SCOPES, only when a membership has no
 * explicit map): OWNER and ADMIN projects admin, STAFF read; a key absent from an explicit map is
 * none.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, ProjectsController, ProjectsService, ProjectPlannerService
 * (plan CRUD), ProjectPlanExecutorService, TimelineService and EvidenceService are real against
 * DATABASE_URL. The stand-ins: identity attachment from an `x-test-user` header (as AuthMiddleware
 * attaches it), an EventEmitter2 that records, and empty stubs for the AI collaborators no case
 * reaches.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99j_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99j_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map
  admin: `${P}admin`, // ADMIN of bizA, no explicit map
  staffRead: `${P}staffRead`, // STAFF of bizA, no explicit map (projects read by role default): the sweep member
  staffReadExplicit: `${P}staffReadExplicit`, // STAFF of bizA, explicit projects 'read'
  staffNone: `${P}staffNone`, // STAFF of bizA, explicit projects 'none'
  staffNoKey: `${P}staffNoKey`, // STAFF of bizA, explicit map without a projects key (none)
  staffWrite: `${P}staffWrite`, // STAFF of bizA, explicit projects 'write'
  adminExplicitRead: `${P}adminExplicitRead`, // ADMIN of bizA, explicit {projects: read, crm: admin, settings: admin} (D-85 admits the ADMIN)
  outsider: `${P}outsider`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  ownerProject: `${P}ownerProject`,
};

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
let ProjectsControllerClass: any;
const aiUsage = { callAi: vi.fn(async () => { throw new Error('the metered AI call is not under test'); }) };

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_deliverables WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_milestones WHERE project_id IN (SELECT id FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM project_plan_events WHERE plan_id IN (SELECT id FROM project_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM project_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_templates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string, body?: unknown) {
  const r = (request(app.getHttpServer()) as any)[verb](url).set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const base = (biz: string = ID.bizA) => `/projects/businesses/${biz}`;

let seq = 0;
async function seedProject(biz: string = ID.bizA) {
  seq += 1;
  return db.project.create({ data: { id: `${P}p_${seq}`, businessId: biz, name: `${P}Project ${seq}` } });
}
async function seedTask(projectId: string, biz: string = ID.bizA) {
  seq += 1;
  return db.projectTask.create({ data: { id: `${P}t_${seq}`, projectId, businessId: biz, title: `${P}Task ${seq}` } });
}
async function seedTemplate(biz: string = ID.bizA) {
  seq += 1;
  return db.projectTemplate.create({ data: { id: `${P}tpl_${seq}`, businessId: biz, name: `${P}Template ${seq}`, taskTitles: ['a', 'b'] } });
}

/** Every row a projects write may touch (this suite's tenants), whole: what "nothing written" compares. */
async function writableState() {
  const rows = (table: string, where = `business_id LIKE ${sqlLikePrefix(P)}`) =>
    db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE ${where} ORDER BY id`);
  return {
    projects: await rows('projects'),
    tasks: await rows('project_tasks'),
    templates: await rows('project_templates'),
    deliverables: await rows('project_deliverables'),
    milestones: await rows('project_milestones', `project_id IN (SELECT id FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)})`),
  };
}

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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { ProjectsController } = await import('../src/modules/projects/projects.controller');
  ProjectsControllerClass = ProjectsController;
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { ProjectPlannerService } = await import('../src/modules/projects/project-planner.service');
  const { ProjectPlanExecutorService } = await import('../src/modules/projects/project-plan-executor.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { StrategicIntelligenceService } = await import('../src/modules/ai/strategic-intelligence.service');
  const { WorkloadAggregatorService } = await import('../src/modules/ai/workload-aggregator.service');

  Logger.overrideLogger(false);
  const emitter = { emit: () => true };

  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      scopeMod.ModuleScopeGuard,
      ProjectsService,
      ProjectPlannerService,
      ProjectPlanExecutorService,
      TimelineService,
      EvidenceService,
      { provide: EventEmitter2, useValue: emitter },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: BusinessEventService, useValue: { emit: async () => undefined } },
      // ProjectPlannerService.analyzeRearrangement's metered model call (SEC-5): recording, never reached by a refused case.
      { provide: AiUsageService, useValue: aiUsage },
      { provide: BlueprintService, useValue: {} },
      { provide: AiOversightService, useValue: {} },
      { provide: StrategicIntelligenceService, useValue: {} },
      { provide: WorkloadAggregatorService, useValue: {} },
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.admin, ID.staffRead, ID.staffReadExplicit, ID.staffNone, ID.staffNoKey, ID.staffWrite, ID.adminExplicitRead, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99J Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99J Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffRead, ID.bizA, 'STAFF');
  await m(ID.staffReadExplicit, ID.bizA, 'STAFF', { projects: 'read' });
  await m(ID.staffNone, ID.bizA, 'STAFF', { projects: 'none', crm: 'read' });
  await m(ID.staffNoKey, ID.bizA, 'STAFF', { crm: 'read' });
  await m(ID.staffWrite, ID.bizA, 'STAFF', { projects: 'write' });
  await m(ID.adminExplicitRead, ID.bizA, 'ADMIN', { projects: 'read', crm: 'admin', settings: 'admin' });
  await m(ID.outsider, ID.bizB, 'OWNER');

  await db.project.create({ data: { id: ID.ownerProject, businessId: ID.bizA, name: `${P}Owner project` } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

/** The plan doors owner ruling D-85 governs in ProjectsService.assertMayGovernPlans (OWNER/ADMIN or projects:write). */
const D85_PLAN_DOORS = ['ProjectsController.approvePlan', 'ProjectsController.deletePlan'];

describe('route census: projects.controller.ts', () => {
  it("[PRJ-C01] RED-BEFORE: every ProjectsController route runs AuthGuard, BusinessGuard, then ModuleScopeGuard, and requires 'projects' on its handler: read for a GET, write for every other route (analyze-impact included, SEC-5), none on the two D-85 plan doors (CR-2)", () => {
    const routes = census(ProjectsControllerClass);
    const problems: string[] = [];
    for (const r of routes) {
      for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
        if (!r.guards.includes(g)) problems.push(`${r.key} does not run ${g}`);
      }
      if (r.guards.indexOf('ModuleScopeGuard') >= 0 && r.guards.indexOf('ModuleScopeGuard') < r.guards.indexOf('BusinessGuard')) {
        problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
      }
      if (D85_PLAN_DOORS.includes(r.key)) {
        if (r.scope) problems.push(`${r.key} requires ${r.scope.module}:${r.scope.minLevel}; D-85 governs it (assertMayGovernPlans)`);
        continue;
      }
      const want = r.method === 'GET' ? 'read' : 'write';
      if (r.scope?.module !== 'projects' || r.scope?.minLevel !== want) {
        problems.push(`${r.key} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not projects:${want}`);
      }
    }
    expect(routes.length).toBe(35);
    expect(problems).toEqual([]);
  });
});

describe("BUG-014: a member with projects read cannot write projects", () => {
  it("[PRJ-01] RED-BEFORE: STAFF with projects read (role default or explicit) is refused 403 creating a project, and nothing is written", async () => {
    const before = await writableState();
    for (const actor of [ID.staffRead, ID.staffReadExplicit]) {
      const res = await send('post', base(), actor, { name: `${P}Jada project` });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/projects requires write access \(you have read\)/);
    }
    expect(await writableState()).toEqual(before);
  });

  it("[PRJ-02] RED-BEFORE: STAFF with projects read is refused 403 deleting the owner's project, and the project stays", async () => {
    const before = await writableState();
    const res = await send('delete', `${base()}/projects/${ID.ownerProject}`, ID.staffRead);
    expect(res.status).toBe(403);
    const stored = await db.$queryRawUnsafe(`SELECT deleted_at FROM projects WHERE id = '${ID.ownerProject}'`);
    expect(stored).toEqual([{ deleted_at: null }]);
    expect(await writableState()).toEqual(before);
  });

  it('[PRJ-03] RED-BEFORE: every other projects write (edit, tasks, milestones, deliverables, templates, create from template, plans) refuses a projects-read member with 403 and writes nothing', async () => {
    const project = await seedProject();
    const task = await seedTask(project.id);
    const tpl = await seedTemplate();
    const before = await writableState();
    const writes: Array<[Verb, string, unknown?]> = [
      ['patch', `${base()}/projects/${project.id}`, { name: `${P}renamed` }],
      ['post', `${base()}/projects/${project.id}/tasks`, { title: `${P}new task` }],
      ['patch', `${base()}/tasks/${task.id}`, { title: `${P}renamed task` }],
      ['patch', `${base()}/tasks/${task.id}/status`, { status: 'IN_PROGRESS' }],
      ['delete', `${base()}/tasks/${task.id}`],
      ['post', `${base()}/projects/${project.id}/tasks/reorder`, { updates: [{ taskId: task.id, status: 'TODO', position: 3 }] }],
      ['post', `${base()}/projects/${project.id}/milestones`, { title: `${P}milestone` }],
      ['post', `${base()}/projects/${project.id}/deliverables`, { title: `${P}deliverable` }],
      ['post', `${base()}/templates`, { name: `${P}tpl`, taskTitles: ['x'] }],
      ['delete', `${base()}/templates/${tpl.id}`],
      ['post', `${base()}/from-template/${tpl.id}`, { name: `${P}from tpl` }],
    ];
    for (const [verb, url, body] of writes) {
      const res = await send(verb, url, ID.staffRead, body);
      expect(res.status, `${verb.toUpperCase()} ${url}`).toBe(403);
    }
    expect(await writableState()).toEqual(before);
  });

  it('[PRJ-04] RED-BEFORE: a member whose explicit map says projects none (or has no projects key) is refused even the project list', async () => {
    for (const actor of [ID.staffNone, ID.staffNoKey]) {
      const res = await send('get', base(), actor);
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/projects requires read access \(you have none\)/);
    }
  });

  it('[PRJ-05] a projects-read member still reads: the list and a project answer 200', async () => {
    expect((await send('get', base(), ID.staffRead)).status).toBe(200);
    expect((await send('get', `${base()}/projects/${ID.ownerProject}`, ID.staffRead)).status).toBe(200);
  });

  it('[PRJ-06] projects write admits: a projects:write STAFF member, the OWNER and an ADMIN create a project, and the writer deletes one', async () => {
    for (const actor of [ID.staffWrite, ID.owner, ID.admin]) {
      const res = await send('post', base(), actor, { name: `${P}by ${actor}` });
      expect(res.status, actor).toBe(201);
    }
    const doomed = await seedProject();
    expect((await send('delete', `${base()}/projects/${doomed.id}`, ID.staffWrite)).status).toBe(200);
  });

  it("[PRJ-07] a member of another business is refused (BusinessGuard, unchanged)", async () => {
    expect((await send('delete', `${base()}/projects/${ID.ownerProject}`, ID.outsider)).status).toBe(403);
  });
});

describe('review CR-2: the D-85 plan doors admit OWNER/ADMIN or projects:write, as the ruling says', () => {
  let n = 0;
  async function draftPlan() {
    n += 1;
    const id = `${P}plan_${n}`;
    await db.projectPlan.create({ data: { id, businessId: ID.bizA, userIdea: `${P}idea ${n}`, status: 'draft' } as any });
    return id;
  }

  it('[PRJ-D85-01] RED-BEFORE: an ADMIN whose explicit map holds projects read approves a draft plan and deletes another (D-85: OWNER/ADMIN or projects:write)', async () => {
    const a = await draftPlan();
    const approve = await send('post', `${base()}/plans/${a}/approve`, ID.adminExplicitRead);
    expect([200, 201], JSON.stringify(approve.body)).toContain(approve.status);
    expect((await db.projectPlan.findUnique({ where: { id: a } })).status).not.toBe('draft');
    const b = await draftPlan();
    const del = await send('delete', `${base()}/plans/${b}`, ID.adminExplicitRead);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(await db.projectPlan.findUnique({ where: { id: b } })).toBeNull();
  });

  it('[PRJ-D85-02] a STAFF member with projects read (role default or explicit) is still refused 403 approving or deleting a plan (the D-85 service check), and the plan stays a draft', async () => {
    const a = await draftPlan();
    for (const actor of [ID.staffRead, ID.staffReadExplicit, ID.staffNone]) {
      const approve = await send('post', `${base()}/plans/${a}/approve`, actor);
      expect(approve.status, `${actor} approve`).toBe(403);
      const del = await send('delete', `${base()}/plans/${a}`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
    }
    expect((await db.projectPlan.findUnique({ where: { id: a } })).status).toBe('draft');
  });

  it('[PRJ-D85-03] a STAFF member with projects write deletes a draft plan; a member of another business is refused (BusinessGuard)', async () => {
    const a = await draftPlan();
    expect((await send('delete', `${base()}/plans/${a}`, ID.outsider)).status).toBe(403);
    expect((await send('delete', `${base()}/plans/${a}`, ID.staffWrite)).status).toBe(200);
  });
});

describe('review SEC-5: analyze-impact spends metered AI credits, so it needs projects write', () => {
  it('[PRJ-AI-01] RED-BEFORE: a STAFF member with projects read (ai none by role default) is refused 403 before the metered model call', async () => {
    aiUsage.callAi.mockClear();
    const res = await send('post', `${base()}/plans/${P}plan_any/events/${P}event_any/analyze-impact`, ID.staffRead, { newSortOrder: 2 });
    expect(res.status).toBe(403);
    expect(String(res.body?.message ?? '')).toMatch(/projects requires write access \(you have read\)/);
    expect(aiUsage.callAi).not.toHaveBeenCalled();
  });
});
