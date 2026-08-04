/**
 * "What is Ada working on?" must not answer with another business's work.
 *
 * GET /businesses/:businessId/task-assignments/for-assignee/:type/:id is a
 * live, rate-limited route. It passed businessId into getTasksForAssignee,
 * which spent it entirely on assertAssignableInBusiness — a check that the
 * PERSON belongs to the business. It said nothing about their tasks, and
 * TaskAssignment carries no businessId of its own, so the rows returned were
 * every assignment that person held anywhere.
 *
 * The leaked fields are not incidental: taskId, assignedBy, and `reason`, which
 * is free text one business wrote about its own work.
 *
 * People belonging to two businesses is ordinary here — fractional staff,
 * agencies, owners running two entities — and it is exactly the case where a
 * check on the person passes and a check on the data would not have.
 */
import { describe, it, expect, vi } from 'vitest';
import { TaskAssignmentService } from './task-assignment.service';

const A = 'biz_a';
const B = 'biz_b';
const ADA = 'user_ada';

const ASSIGNMENTS = [
  { id: 'as_1', taskType: 'ContactTask', taskId: 'task_a1', assignableType: 'User', assignableId: ADA, unassignedAt: null, reason: 'knows the account' },
  { id: 'as_2', taskType: 'ContactTask', taskId: 'task_b1', assignableType: 'User', assignableId: ADA, unassignedAt: null, reason: 'B pays her more' },
  { id: 'as_3', taskType: 'ProjectTask', taskId: 'task_b2', assignableType: 'User', assignableId: ADA, unassignedAt: null, reason: 'B internal' },
  { id: 'as_4', taskType: 'AutopilotTask', taskId: 'task_a2', assignableType: 'User', assignableId: ADA, unassignedAt: null, reason: null },
];

const CONTACT_TASKS = [
  { id: 'task_a1', businessId: A },
  { id: 'task_b1', businessId: B },
];
const PROJECT_TASKS = [{ id: 'task_b2', businessId: B }];
const AUTOPILOT_TASKS = [{ id: 'task_a2', businessId: A }];

function makeService() {
  const byId = (rows: Array<{ id: string; businessId: string }>) => ({
    findMany: vi.fn(async ({ where }: any) =>
      rows.filter((r) => r.businessId === where.businessId && where.id.in.includes(r.id)),
    ),
  });

  const prisma = {
    client: {
      taskAssignment: {
        findMany: vi.fn(async ({ where, take }: any) =>
          ASSIGNMENTS.filter(
            (a) =>
              a.assignableType === where.assignableType &&
              a.assignableId === where.assignableId &&
              (!where.taskType || a.taskType === where.taskType),
          ).slice(0, take ?? 50),
        ),
        count: vi.fn(async () => ASSIGNMENTS.length),
      },
      contactTask: byId(CONTACT_TASKS),
      projectTask: byId(PROJECT_TASKS),
      autopilotTask: byId(AUTOPILOT_TASKS),
      membership: {
        // Ada is a member of both businesses, which is what makes the
        // person-level assertion pass in each.
        findUnique: vi.fn(async () => ({ userId: ADA })),
      },
    },
  };

  return new TaskAssignmentService(prisma as never, {} as never, {} as never);
}

describe('the read is scoped to the business asking', () => {
  it('returns only this business\'s assignments', async () => {
    const result = await makeService().getTasksForAssignee('User', ADA, { businessId: A });

    expect(result.items.map((i: any) => i.taskId).sort()).toEqual(['task_a1', 'task_a2']);
  });

  it('never leaks the other business\'s reason text', async () => {
    // The field that carries content rather than identifiers.
    const result = await makeService().getTasksForAssignee('User', ADA, { businessId: A });
    const reasons = result.items.map((i: any) => i.reason);

    expect(reasons).not.toContain('B pays her more');
  });

  it('reports a total the caller is allowed to see', async () => {
    // total drove pagination off the unfiltered set, so even a correctly
    // filtered page would have advertised rows that do not exist for A.
    const result = await makeService().getTasksForAssignee('User', ADA, { businessId: A });

    expect(result.total).toBe(2);
  });

  it('shows the same person\'s other work to the business that owns it', async () => {
    // The boundary cuts both ways; this is not a filter that hides data from
    // everyone.
    const result = await makeService().getTasksForAssignee('User', ADA, { businessId: B });

    expect(result.items.map((i: any) => i.taskId).sort()).toEqual(['task_b1', 'task_b2']);
  });

  it('scopes every task type, not just the one with the obvious table', async () => {
    // AutopilotTask was absent from the pre-existing getBusinessIdForTask
    // helper, which returned null for it. A type the filter does not
    // understand must be dropped, never passed through unscoped.
    const result = await makeService().getTasksForAssignee('User', ADA, { businessId: A });

    expect(result.items.some((i: any) => i.taskType === 'AutopilotTask')).toBe(true);
    expect(result.items.every((i: any) => i.taskId.includes('_a'))).toBe(true);
  });

  it('honours a taskType filter within the scoped set', async () => {
    const result = await makeService().getTasksForAssignee('User', ADA, {
      businessId: A,
      taskType: 'ContactTask',
    });

    expect(result.items.map((i: any) => i.taskId)).toEqual(['task_a1']);
    expect(result.total).toBe(1);
  });

  it('paginates the scoped set rather than the raw one', async () => {
    const result = await makeService().getTasksForAssignee('User', ADA, {
      businessId: A,
      limit: 1,
      offset: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].taskId).toBe('task_a2');
    expect(result.total).toBe(2);
  });
});

describe('trusted internal callers are unchanged', () => {
  it('keeps database-level pagination when no business is given', async () => {
    // Internal callers pre-scope their own task ids. Forcing them through the
    // in-memory filter would cap them at MAX_ASSIGNMENT_SCAN for no benefit.
    const result = await makeService().getTasksForAssignee('User', ADA, {});

    expect(result.items).toHaveLength(4);
    expect(result.total).toBe(4);
  });
});
