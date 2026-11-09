/**
 * PR196-PROJECTS-SERVER (V1-88): project tasks and plans on the real database.
 *
 * Proves, through the real HTTP path of ProjectsController, the PR #196 review
 * defects that are also in our tree and the owner rulings of 2026-11-09:
 *
 *   WPD-08  PATCH .../tasks/:taskId/status wrote status and isCompleted
 *           directly: no evidence gate (evidenceRequired), no
 *           project_task.completed, no actor. A status change now goes
 *           through updateTask's door: the gate, the completion event and the
 *           actor (the events carry it, the feed records it). The bulk
 *           reorder route is a status change too and goes through the same
 *           door, and refuses the whole batch before writing any of it.
 *   WPD-09  addTask/updateTask resolved the assignee by id alone (findUnique,
 *           no business) and wrote the task and a TaskAssignment for any
 *           string, with assignedBy 'system'. D-87: the assignee is a member of
 *           the business or one of its booking staff; anything else is 404
 *           and nothing is written. The assignment names the member who made it.
 *   WPD-12  POST .../plans/:planId/approve wrote status 'approved' over any
 *           status, then materialized: a double or concurrent approve made two
 *           Projects. It is now a compare-and-set: one Project per plan, 409
 *           once approved or materialized.
 *   WPD-14  DELETE .../plans/:planId hard-deleted any plan, materialized ones
 *           with their plan-to-project provenance. D-85: only a draft plan with
 *           no project is deleted.
 *   D-85    approve and delete need OWNER/ADMIN or projects:write (the
 *           membership's explicit scope map, else its role defaults), and the
 *           actor is recorded; D-46: a SUPER_ADMIN who is not a member is
 *           refused. PATCH may not write 'approved' or 'materialized', the
 *           states only the approve door sets.
 *
 * Also found in the write set: PATCH .../tasks/:taskId spread the body into the
 * update (an inline body type, which ValidationPipe does not strip), so
 * {businessId} or {projectId} moved the task to another business or project.
 * The update now writes named fields only.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ProjectsService, ProjectPlannerService (plan CRUD),
 * ProjectPlanExecutorService (materializePlan), TimelineService (Activity rows)
 * and EvidenceService (the evidence gate) are real against DATABASE_URL. The
 * stand-ins: identity attachment from an `x-test-user` header (as the
 * Supabase-verifying AuthMiddleware would attach it), an EventEmitter2 that
 * records, and empty stubs for the AI collaborators the plan CRUD and
 * materialize paths never call.
 *
 * Fixtures: prefix `v88c_` (registered in test/helpers/fixture-prefixes.json),
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

const P = 'v88c_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  admin: `${P}admin`, // ADMIN of bizA, no explicit scopes
  staffRead: `${P}staffRead`, // STAFF of bizA, role defaults (projects: read)
  staffWrite: `${P}staffWrite`, // STAFF of bizA, explicit { projects: 'write' }
  ownerB: `${P}ownerB`, // OWNER of bizB only
  superA: `${P}superA`, // SUPER_ADMIN, no membership anywhere
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  staffA: `${P}staffA`, // bizA booking staff
  staffGone: `${P}staffGone`, // bizA booking staff, removed (soft-deleted)
  staffB: `${P}staffB`, // bizB booking staff
  projectA: `${P}projectA`,
  projectB: `${P}projectB`,
};

/** Assignees D-87 refuses on bizA: none is a member of bizA or one of its booking staff. */
const FOREIGN_ASSIGNEES = [ID.staffB, ID.ownerB, ID.staffGone, 'key_ai', `${P}made-up`];

let db: any;
let app: any;
const emitted: Array<[string, any]> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM task_assignments WHERE assignable_id LIKE ${sqlLikePrefix(P)} OR assigned_by LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM evidence WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_plan_events WHERE plan_id IN (SELECT id FROM project_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM project_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_milestones WHERE project_id IN (SELECT id FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function as(actor: string) {
  const agent = request(app.getHttpServer());
  const withUser = (r: any) => r.set('x-test-user', actor);
  return {
    post: (url: string, body: Record<string, unknown> = {}) => withUser(agent.post(url)).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => withUser(agent.patch(url)).send(body),
    delete: (url: string) => withUser(agent.delete(url)),
  };
}

const base = (biz: string = ID.bizA) => `/projects/businesses/${biz}`;

let seq = 0;
const tag = (name: string) => `${name}_${++seq}`;

/** A fresh task on bizA's project, so each case owns its row. */
async function freshTask(name: string, data: Record<string, unknown> = {}) {
  return db.projectTask.create({
    data: { id: `${P}t_${tag(name)}`, projectId: ID.projectA, businessId: ID.bizA, title: `${P}${name}`, ...data },
  });
}

async function attachEvidence(taskId: string) {
  return db.evidence.create({
    data: {
      id: `${P}ev_${tag('ev')}`,
      businessId: ID.bizA,
      evidenceType: 'photo',
      url: 'https://evidence.invalid/v88c.jpg',
      storageKey: `${P}storage`,
      submittedBy: ID.owner,
      linkedType: 'ProjectTask',
      linkedId: taskId,
    },
  });
}

/** A fresh plan with one task event and one milestone event. */
async function freshPlan(name: string, data: Record<string, unknown> = {}, biz: string = ID.bizA) {
  const id = `${P}plan_${tag(name)}`;
  await db.projectPlan.create({
    data: {
      id,
      businessId: biz,
      status: 'draft',
      userIdea: `${P}${name} idea`,
      strategySummary: `${id} summary`,
      ...data,
      timelineEvents: {
        create: [
          { id: `${id}_e1`, sortOrder: 1, eventType: 'task', title: `${id} step`, executionContext: 'OUT_APP' },
          { id: `${id}_e2`, sortOrder: 2, eventType: 'milestone', title: `${id} milestone`, executionContext: 'OUT_APP' },
        ],
      },
    },
  });
  return id;
}

/** Projects materialized from a plan (materializePlan writes the plan's strategySummary as the description). */
async function projectsOf(planId: string) {
  return db.project.count({ where: { description: `${planId} summary` } });
}

function eventsNamed(name: string, taskId: string) {
  return emitted.filter(([n, p]) => n === name && p?.task?.id === taskId);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ProjectsController } = await import('../src/modules/projects/projects.controller');
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
  const emitter = { emit: (name: string, payload: any) => { emitted.push([name, payload]); return true; } };

  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ProjectsService,
      ProjectPlannerService,
      ProjectPlanExecutorService,
      TimelineService,
      EvidenceService,
      { provide: EventEmitter2, useValue: emitter },
      // Not called by the task, plan CRUD and materialize paths under test.
      { provide: TaskAssignmentService, useValue: {} },
      { provide: BusinessEventService, useValue: { emit: async () => undefined } },
      { provide: AiUsageService, useValue: {} },
      { provide: BlueprintService, useValue: {} },
      { provide: AiOversightService, useValue: {} },
      { provide: StrategicIntelligenceService, useValue: {} },
      { provide: WorkloadAggregatorService, useValue: {} },
    ],
  }).compile();

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

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.admin, 'USER'], [ID.staffRead, 'USER'], [ID.staffWrite, 'USER'],
    [ID.ownerB, 'USER'], [ID.superA, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V88C Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V88C Biz B', ownerId: ID.ownerB } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffRead, ID.bizA, 'STAFF');
  await m(ID.staffWrite, ID.bizA, 'STAFF', { projects: 'write' });
  await m(ID.ownerB, ID.bizB, 'OWNER');

  await db.staffMember.create({ data: { id: ID.staffA, businessId: ID.bizA, name: 'V88C staff A' } });
  await db.staffMember.create({ data: { id: ID.staffGone, businessId: ID.bizA, name: 'V88C staff gone', deletedAt: new Date() } });
  await db.staffMember.create({ data: { id: ID.staffB, businessId: ID.bizB, name: 'V88C staff B' } });

  await db.project.create({ data: { id: ID.projectA, businessId: ID.bizA, name: 'V88C project A' } });
  await db.project.create({ data: { id: ID.projectB, businessId: ID.bizB, name: 'V88C project B' } });
});

afterAll(async () => {
  await app?.close();
  await cleanup();
});

beforeEach(() => {
  emitted.length = 0;
});

// ─── WPD-08: a status change goes through updateTask's door ─────────────────

describe('WPD-08: PATCH .../tasks/:taskId/status goes through the same door as updateTask', () => {
  it('DONE on a task that requires evidence, with none attached, is 400 and writes nothing', async () => {
    const task = await freshTask('gated', { evidenceRequired: true });
    const res = await as(ID.admin).patch(`${base()}/tasks/${task.id}/status`, { status: 'DONE', position: 7 });
    expect(res.status).toBe(400);
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { status: true, isCompleted: true, position: true } }))
      .toEqual({ status: 'TODO', isCompleted: false, position: 0 });
    expect(eventsNamed('project_task.completed', task.id)).toHaveLength(0);
  });

  it('with its evidence attached, DONE completes the task, emits project_task.completed naming the member, and the feed records the member', async () => {
    const task = await freshTask('evidenced', { evidenceRequired: true });
    await attachEvidence(task.id);
    const res = await as(ID.admin).patch(`${base()}/tasks/${task.id}/status`, { status: 'DONE', position: 3 });
    expect(res.status).toBe(200);
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { status: true, isCompleted: true, position: true } }))
      .toEqual({ status: 'DONE', isCompleted: true, position: 3 });
    const completed = eventsNamed('project_task.completed', task.id);
    expect(completed).toHaveLength(1);
    expect(completed[0][1]).toMatchObject({ businessId: ID.bizA, actorId: ID.admin });
    expect(await db.activity.findMany({ where: { businessId: ID.bizA, entityId: task.id }, select: { action: true, actorType: true, actorId: true } }))
      .toEqual([{ action: 'task_completed', actorType: 'USER', actorId: ID.admin }]);
  });

  it('moving a completed task to IN_PROGRESS reopens it; project_task.updated and the feed name the member', async () => {
    const task = await freshTask('reopen', { status: 'DONE', isCompleted: true });
    const res = await as(ID.staffRead).patch(`${base()}/tasks/${task.id}/status`, { status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { status: true, isCompleted: true } }))
      .toEqual({ status: 'IN_PROGRESS', isCompleted: false });
    expect(eventsNamed('project_task.updated', task.id).map(([, p]) => p.actorId)).toEqual([ID.staffRead]);
    expect(eventsNamed('project_task.completed', task.id)).toHaveLength(0);
    expect(await db.activity.findMany({ where: { businessId: ID.bizA, entityId: task.id }, select: { action: true, actorId: true } }))
      .toEqual([{ action: 'task_status_changed', actorId: ID.staffRead }]);
  });

  it('an unknown status is 400 and writes nothing', async () => {
    const task = await freshTask('badstatus');
    const res = await as(ID.admin).patch(`${base()}/tasks/${task.id}/status`, { status: 'FINISHED' });
    expect(res.status).toBe(400);
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { status: true, isCompleted: true } }))
      .toEqual({ status: 'TODO', isCompleted: false });
  });

  it('reorder: a batch that would complete an evidence-gated task without evidence is 400 and writes none of its moves', async () => {
    const free = await freshTask('batch-free');
    const gated = await freshTask('batch-gated', { evidenceRequired: true });
    const res = await as(ID.admin).post(`${base()}/projects/${ID.projectA}/tasks/reorder`, {
      updates: [
        { taskId: free.id, status: 'IN_PROGRESS', position: 1 },
        { taskId: gated.id, status: 'DONE', position: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect(await db.projectTask.findMany({ where: { id: { in: [free.id, gated.id] } }, select: { id: true, status: true, isCompleted: true, position: true }, orderBy: { id: 'asc' } }))
      .toEqual([free, gated].map((t) => ({ id: t.id, status: 'TODO', isCompleted: false, position: 0 })).sort((a, b) => a.id.localeCompare(b.id)));
    expect(eventsNamed('project_task.completed', gated.id)).toHaveLength(0);
  });

  it('reorder: a status change in the batch completes through the door (completion event naming the member); a move within a column only repositions', async () => {
    const done = await freshTask('batch-done');
    const moved = await freshTask('batch-moved');
    const res = await as(ID.admin).post(`${base()}/projects/${ID.projectA}/tasks/reorder`, {
      updates: [
        { taskId: done.id, status: 'DONE', position: 1 },
        { taskId: moved.id, status: 'TODO', position: 5 },
      ],
    });
    expect(res.status).toBe(201);
    expect(await db.projectTask.findUnique({ where: { id: done.id }, select: { status: true, isCompleted: true, position: true } }))
      .toEqual({ status: 'DONE', isCompleted: true, position: 1 });
    expect(await db.projectTask.findUnique({ where: { id: moved.id }, select: { status: true, isCompleted: true, position: true } }))
      .toEqual({ status: 'TODO', isCompleted: false, position: 5 });
    expect(eventsNamed('project_task.completed', done.id).map(([, p]) => p.actorId)).toEqual([ID.admin]);
    expect(eventsNamed('project_task.completed', moved.id)).toHaveLength(0);
  });

  it("control: another business's task is 404 on the status route and is left as it was", async () => {
    const theirs = await db.projectTask.create({ data: { id: `${P}t_theirs_${++seq}`, projectId: ID.projectB, businessId: ID.bizB, title: 'theirs' } });
    const res = await as(ID.admin).patch(`${base()}/tasks/${theirs.id}/status`, { status: 'DONE' });
    expect(res.status).toBe(404);
    expect(await db.projectTask.findUnique({ where: { id: theirs.id }, select: { status: true, isCompleted: true } }))
      .toEqual({ status: 'TODO', isCompleted: false });
  });

  it('PATCH .../tasks/:taskId writes named fields only: a body naming another business or project does not move the task', async () => {
    const task = await freshTask('relocate');
    const res = await as(ID.admin).patch(`${base()}/tasks/${task.id}`, { title: `${P}renamed`, businessId: ID.bizB, projectId: ID.projectB });
    expect(res.status).toBe(200);
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { businessId: true, projectId: true, title: true } }))
      .toEqual({ businessId: ID.bizA, projectId: ID.projectA, title: `${P}renamed` });
  });
});

// ─── WPD-09 / D-87: the assignee is a member or booking staff of this business ─

describe('WPD-09 / D-87: a task assignee is a member of the business or one of its booking staff', () => {
  it('addTask: a foreign staff member, a member of another business only, a removed staff member, KEY and a made-up id are each 404 and write no task and no assignment', async () => {
    for (const assigneeId of FOREIGN_ASSIGNEES) {
      const title = `${P}add-foreign-${++seq}`;
      const res = await as(ID.admin).post(`${base()}/projects/${ID.projectA}/tasks`, { title, assigneeId });
      expect(res.status, assigneeId).toBe(404);
      expect(await db.projectTask.count({ where: { title } }), assigneeId).toBe(0);
    }
    expect(await db.taskAssignment.count({ where: { assignableId: { in: FOREIGN_ASSIGNEES.filter((a) => a.startsWith(P)) } } })).toBe(0);
  });

  it("updateTask: the same assignees are each 404 and leave the task's fields, assignee and assignments as they were", async () => {
    const task = await freshTask('update-foreign');
    for (const assigneeId of FOREIGN_ASSIGNEES) {
      const res = await as(ID.admin).patch(`${base()}/tasks/${task.id}`, { title: `${P}should-not-write`, assigneeId });
      expect(res.status, assigneeId).toBe(404);
    }
    expect(await db.projectTask.findUnique({ where: { id: task.id }, select: { title: true, assigneeId: true } }))
      .toEqual({ title: task.title, assigneeId: null });
    expect(await db.taskAssignment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('control: its own booking staff, then its own member, are assigned; each assignment names the member who made it', async () => {
    const res = await as(ID.staffWrite).post(`${base()}/projects/${ID.projectA}/tasks`, { title: `${P}add-own`, assigneeId: ID.staffA });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizA, projectId: ID.projectA, assigneeId: ID.staffA });
    expect(await db.taskAssignment.findMany({ where: { taskId: res.body.id }, select: { assignableType: true, assignableId: true, assignedBy: true, unassignedAt: true } }))
      .toEqual([{ assignableType: 'StaffMember', assignableId: ID.staffA, assignedBy: ID.staffWrite, unassignedAt: null }]);

    const upd = await as(ID.owner).patch(`${base()}/tasks/${res.body.id}`, { assigneeId: ID.staffRead });
    expect(upd.status).toBe(200);
    const rows = await db.taskAssignment.findMany({ where: { taskId: res.body.id }, select: { assignableType: true, assignableId: true, assignedBy: true, unassignedAt: true }, orderBy: { assignedAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ assignableId: ID.staffA });
    expect(rows[0].unassignedAt).not.toBeNull();
    expect(rows[1]).toEqual({ assignableType: 'User', assignableId: ID.staffRead, assignedBy: ID.owner, unassignedAt: null });
  });
});

// ─── WPD-12 / WPD-14 / D-85 / D-46: plans ────────────────────────────────────

describe('WPD-12: a plan is approved once', () => {
  it('a draft plan is approved and materialized; a second approve is 409 and makes no second Project', async () => {
    const planId = await freshPlan('once');
    const first = await as(ID.owner).post(`${base()}/plans/${planId}/approve`);
    expect(first.status).toBe(201);
    expect(await db.projectPlan.findUnique({ where: { id: planId }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'materialized', projectId: first.body.id });
    const second = await as(ID.owner).post(`${base()}/plans/${planId}/approve`);
    expect(second.status).toBe(409);
    expect(await projectsOf(planId)).toBe(1);
    expect(await db.projectPlan.findUnique({ where: { id: planId }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'materialized', projectId: first.body.id });
  });

  it('concurrent approves of one draft make exactly one Project; the others are 409', async () => {
    const planId = await freshPlan('race');
    const results = await Promise.all([0, 1, 2].map(() => as(ID.admin).post(`${base()}/plans/${planId}/approve`)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await projectsOf(planId)).toBe(1);
    const winner = results.find((r) => r.status === 201)!;
    expect(await db.projectPlan.findUnique({ where: { id: planId }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'materialized', projectId: winner.body.id });
  });

  it('a plan PATCHed back to draft after it materialized is still 409, and no second Project is made', async () => {
    const planId = await freshPlan('reset');
    expect((await as(ID.owner).post(`${base()}/plans/${planId}/approve`)).status).toBe(201);
    expect((await as(ID.owner).patch(`${base()}/plans/${planId}`, { status: 'draft' })).status).toBe(200);
    expect((await as(ID.owner).post(`${base()}/plans/${planId}/approve`)).status).toBe(409);
    expect(await projectsOf(planId)).toBe(1);
  });

  it("PATCH may not write 'approved' or 'materialized': 400, and the plan keeps its status", async () => {
    const planId = await freshPlan('patch-status');
    for (const status of ['approved', 'materialized']) {
      const res = await as(ID.owner).patch(`${base()}/plans/${planId}`, { status });
      expect(res.status, status).toBe(400);
    }
    expect(await db.projectPlan.findUnique({ where: { id: planId }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'draft', projectId: null });
  });
});

describe('D-85 / D-46: approving or deleting a plan needs OWNER/ADMIN or projects:write, and names the actor', () => {
  it('a STAFF member with projects:read and a SUPER_ADMIN who is not a member are 403 on approve and delete, and nothing is written', async () => {
    const planId = await freshPlan('denied');
    for (const actor of [ID.staffRead, ID.superA]) {
      expect((await as(actor).post(`${base()}/plans/${planId}/approve`)).status, actor).toBe(403);
      expect((await as(actor).delete(`${base()}/plans/${planId}`)).status, actor).toBe(403);
    }
    expect(await db.projectPlan.findUnique({ where: { id: planId }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'draft', projectId: null });
    expect(await db.projectPlanEvent.count({ where: { planId } })).toBe(2);
    expect(await projectsOf(planId)).toBe(0);
  });

  it('a STAFF member granted projects:write approves; the feed names them as the approver', async () => {
    const planId = await freshPlan('staff-write');
    const res = await as(ID.staffWrite).post(`${base()}/plans/${planId}/approve`);
    expect(res.status).toBe(201);
    expect(await db.activity.findMany({ where: { businessId: ID.bizA, entityId: planId }, select: { action: true, actorType: true, actorId: true } }))
      .toEqual([{ action: 'plan_approved', actorType: 'USER', actorId: ID.staffWrite }]);
  });

  it('control: the OWNER and an ADMIN each approve a draft', async () => {
    for (const actor of [ID.owner, ID.admin]) {
      const planId = await freshPlan(`by-${actor.slice(P.length)}`);
      expect((await as(actor).post(`${base()}/plans/${planId}/approve`)).status, actor).toBe(201);
      expect(await projectsOf(planId), actor).toBe(1);
    }
  });
});

describe('WPD-14 / D-85: only a draft plan is deleted', () => {
  it('a draft plan is deleted with its events by an ADMIN, and the feed names the ADMIN', async () => {
    const planId = await freshPlan('delete-draft');
    const res = await as(ID.admin).delete(`${base()}/plans/${planId}`);
    expect(res.status).toBe(200);
    expect(await db.projectPlan.count({ where: { id: planId } })).toBe(0);
    expect(await db.projectPlanEvent.count({ where: { planId } })).toBe(0);
    expect(await db.activity.findMany({ where: { businessId: ID.bizA, entityId: planId }, select: { action: true, actorType: true, actorId: true } }))
      .toEqual([{ action: 'plan_deleted', actorType: 'USER', actorId: ID.admin }]);
  });

  it('a materialized plan, one PATCHed back to draft after materializing, and a rejected plan are 409 and keep their rows', async () => {
    const materialized = await freshPlan('delete-materialized');
    expect((await as(ID.owner).post(`${base()}/plans/${materialized}/approve`)).status).toBe(201);
    const reset = await freshPlan('delete-reset');
    expect((await as(ID.owner).post(`${base()}/plans/${reset}/approve`)).status).toBe(201);
    expect((await as(ID.owner).patch(`${base()}/plans/${reset}`, { status: 'draft' })).status).toBe(200);
    const rejected = await freshPlan('delete-rejected', { status: 'rejected' });

    for (const planId of [materialized, reset, rejected]) {
      const res = await as(ID.owner).delete(`${base()}/plans/${planId}`);
      expect(res.status, planId).toBe(409);
      expect(await db.projectPlan.count({ where: { id: planId } }), planId).toBe(1);
      expect(await db.projectPlanEvent.count({ where: { planId } }), planId).toBe(2);
    }
  });

  it("control: another business's plan is 404 for approve and delete, and is left as it was", async () => {
    const theirs = await freshPlan('theirs', {}, ID.bizB);
    expect((await as(ID.owner).post(`${base()}/plans/${theirs}/approve`)).status).toBe(404);
    expect((await as(ID.owner).delete(`${base()}/plans/${theirs}`)).status).toBe(404);
    expect(await db.projectPlan.findUnique({ where: { id: theirs }, select: { status: true, projectId: true } }))
      .toEqual({ status: 'draft', projectId: null });
    expect(await db.projectPlanEvent.count({ where: { planId: theirs } })).toBe(2);
  });
});
