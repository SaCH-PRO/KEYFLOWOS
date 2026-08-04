/**
 * KEY gets colleagues.
 *
 * "Plug into any role, tier and level of staff" while having no concept of
 * staff was the sharpest contradiction left in the product. Five live Prisma
 * models, a working org screen, a complete 24-method StructureService, a
 * workload-and-skill recommender — and zero tools. The one place KEY touched
 * task assignment, it assigned to itself (`assigneeId: 'key_ai'`). It could be
 * a worker; it could not be a colleague.
 *
 * Three things are asserted here, in the order they have historically failed:
 *
 *  1. THE TOOL DISPATCHES. Five delegation_* tools were declared in FLOW_TOOLS
 *     with no case clause for weeks, so the model called them and every call
 *     hit `default: throw new Error('Unknown tool')`. A registry entry is a
 *     promise, not an implementation.
 *
 *  2. IT DOES NOT LEAK PAY. StaffMember.hourlyRate and Membership's raw
 *     permissionScopes sit one field away from every row these assemble.
 *     Membership.role is an access level, not an entitlement to see a
 *     colleague's rate, and chat cannot establish the difference.
 *
 *  3. THE NUMBER IS RIGHT. Two independent assignment mechanisms are live —
 *     ContactTask.assigneeId and the polymorphic TaskAssignment — and counting
 *     either alone reports a workload that is confidently wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS } from './flow-tool-registry';
import { StructureService } from '../structure/structure.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';

const BIZ = 'biz_1';
const PEOPLE_TOOLS = FLOW_TOOLS.filter((t) => t.name.startsWith('people_'));

describe('the tools exist as more than a registry entry', () => {
  it('registers the people surface', () => {
    expect(PEOPLE_TOOLS.map((t) => t.name).sort()).toEqual([
      'people_assign_task',
      'people_list',
      'people_org_chart',
      'people_recommend_assignee',
      'people_workload',
    ]);
  });

  it('every one of them dispatches to a service', async () => {
    // The delegation_* failure, prevented. Runs the real executeToolAction, so
    // a missing case reaches `default:` and throws 'Unknown tool'.
    const calls: string[] = [];
    const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      getStructure: () => ({
        listPeople: async () => (calls.push('listPeople'), { people: [], total: 0 }),
        getOrgTree: async () => (calls.push('getOrgTree'), []),
        getStats: async () => ({}),
      }),
      getTaskAssignment: () => ({
        workloadSummary: async () => (calls.push('workloadSummary'), { people: [] }),
        assign: async () => (calls.push('assign'), { id: 'as_1' }),
      }),
      getAssignmentRecommender: () => ({
        recommend: async () => (calls.push('recommend'), { recommendations: [] }),
      }),
    });

    for (const tool of PEOPLE_TOOLS) {
      await expect(
        (orchestrator as any).executeToolAction(BIZ, tool.name, {
          taskTitle: 'Chase the Acme renewal',
          taskType: 'ContactTask',
          taskId: 'task_1',
          assignableType: 'User',
          assignableId: 'user_ada',
        }),
        `${tool.name} did not dispatch`,
      ).resolves.toBeDefined();
    }

    expect(calls).toHaveLength(PEOPLE_TOOLS.length);
  });

  it('scopes the assignment write to the asking business', async () => {
    // TaskAssignmentService.businessId is OPTIONAL — omitting it skips
    // assertAssignableInBusiness entirely, which is how trusted internal
    // callers opt out. A model that hallucinated an id from another tenant
    // would then be obeyed, so the tool must always pass it.
    const assign = vi.fn(async () => ({ id: 'as_1' }));
    const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      getTaskAssignment: () => ({ assign }),
    });

    await (orchestrator as any).executeToolAction(BIZ, 'people_assign_task', {
      taskType: 'ContactTask',
      taskId: 'task_1',
      assignableType: 'User',
      assignableId: 'user_ada',
    });

    expect(assign.mock.calls[0][0]).toMatchObject({ businessId: BIZ, assignedBy: 'KEY' });
  });

  it('points every one at a screen a human can use instead', () => {
    for (const tool of PEOPLE_TOOLS) {
      expect(tool.manualEquivalentRoute, tool.name).toMatch(/^\/app\//);
    }
  });

  it('grades the write above the reads', () => {
    const assign = PEOPLE_TOOLS.find((t) => t.name === 'people_assign_task')!;
    const reads = PEOPLE_TOOLS.filter((t) => t.name !== 'people_assign_task');

    expect(assign.riskTier).toBeGreaterThan(1);
    expect(assign.family).toBe('execute');
    for (const r of reads) expect(r.riskTier, r.name).toBe(1);
  });
});

function makeStructure(staff: Array<Record<string, unknown>>, members: Array<Record<string, unknown>>) {
  return new StructureService({
    client: {
      membership: { findMany: vi.fn(async () => members) },
      staffMember: { findMany: vi.fn(async () => staff) },
    },
  } as never);
}

const ADA = {
  id: 'mem_1',
  role: 'ADMIN',
  maxApprovalTier: 2,
  dailyCapacityHours: 8,
  skills: [{ name: 'invoicing' }],
  user: { id: 'user_ada', name: 'Ada', firstName: null, lastName: null, email: 'ada@example.com' },
  orgAssignments: [
    {
      orgUnit: { name: 'Finance', type: 'DEPARTMENT' },
      jobRole: { name: 'Controller', level: 4 },
      reportsTo: { membership: { user: { name: 'Grace', email: 'grace@example.com' } } },
    },
  ],
};

const BO = {
  id: 'staff_1',
  name: 'Bo',
  maxHoursPerWeek: 30,
  hourlyRate: 45,
  skills: [{ name: 'colour' }],
};

describe('the directory answers "who works here" without answering "what do they earn"', () => {
  it('returns both kinds of person', async () => {
    // Membership is an account with a login; StaffMember is a bookable resource
    // with no userId at all. A hairdresser is usually the second and often not
    // the first, so listing only accounts would answer with the office manager.
    const { people } = await makeStructure([BO], [ADA]).listPeople(BIZ);

    expect(people.map((p) => p.kind).sort()).toEqual(['account', 'staff']);
  });

  it('never returns pay', async () => {
    const { people } = await makeStructure([BO], [ADA]).listPeople(BIZ);

    for (const person of people) {
      expect(Object.keys(person)).not.toContain('hourlyRate');
    }
    expect(JSON.stringify(people)).not.toContain('45');
  });

  it('never returns the raw permission blob', async () => {
    // Security configuration is not something a model should reason about or
    // repeat back. The approval TIER is fine and useful; the scopes are not.
    const { people } = await makeStructure([BO], [ADA]).listPeople(BIZ);

    for (const person of people) {
      expect(Object.keys(person)).not.toContain('permissionScopes');
    }
  });

  it('carries the reporting line, which is the point of asking', async () => {
    const { people } = await makeStructure([], [ADA]).listPeople(BIZ);

    expect(people[0]).toMatchObject({
      name: 'Ada',
      jobRole: 'Controller',
      orgUnit: 'Finance',
      reportsTo: 'Grace',
      approvalTier: 2,
    });
  });

  it('reports capacity per week for both kinds, from fields stored differently', async () => {
    // Membership stores hours per DAY, StaffMember per WEEK. Reporting the raw
    // numbers side by side would make an 8-hour-a-day employee look like a
    // quarter of a 30-hour-a-week contractor.
    const { people } = await makeStructure([BO], [ADA]).listPeople(BIZ);
    const ada = people.find((p) => p.name === 'Ada')!;
    const bo = people.find((p) => p.name === 'Bo')!;

    expect(ada.weeklyCapacityHours).toBe(40);
    expect(bo.weeklyCapacityHours).toBe(30);
  });

  it('finds a person by skill, not just by name', async () => {
    const { people } = await makeStructure([BO], [ADA]).listPeople(BIZ, { search: 'colour' });

    expect(people.map((p) => p.name)).toEqual(['Bo']);
  });

  it('says when it truncated rather than implying that is everyone', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...BO, id: `staff_${i}`, name: `Staff ${i}` }));
    const result = await makeStructure(many, []).listPeople(BIZ, { limit: 2 });

    expect(result.people).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(true);
  });
});

function makeWorkload(opts: {
  contactTasks: Array<{ id: string; assigneeId: string | null }>;
  assignments: Array<{ taskId: string; assignableType: string; assignableId: string }>;
}) {
  return new TaskAssignmentService(
    {
      client: {
        contactTask: { findMany: vi.fn(async () => opts.contactTasks) },
        projectTask: { findMany: vi.fn(async () => []) },
        taskAssignment: { findMany: vi.fn(async () => opts.assignments) },
        membership: {
          findMany: vi.fn(async () => [
            { dailyCapacityHours: 8, user: { id: 'user_ada', name: 'Ada', email: 'ada@example.com' } },
            { dailyCapacityHours: 8, user: { id: 'user_bo', name: 'Bo', email: 'bo@example.com' } },
          ]),
        },
        staffMember: { findMany: vi.fn(async () => []) },
      },
    } as never,
    {} as never,
    {} as never,
  );
}

describe('workload counts both assignment mechanisms, once each', () => {
  it('counts a task assigned through the polymorphic join', async () => {
    const summary = await makeWorkload({
      contactTasks: [{ id: 'task_1', assigneeId: null }],
      assignments: [{ taskId: 'task_1', assignableType: 'User', assignableId: 'user_ada' }],
    }).workloadSummary(BIZ);

    expect(summary.people.find((p) => p.name === 'Ada')!.openTasks).toBe(1);
  });

  it('counts a task assigned through ContactTask.assigneeId', async () => {
    // The older mechanism, still written in production. Counting only the join
    // reports zero for work that is plainly assigned.
    const summary = await makeWorkload({
      contactTasks: [{ id: 'task_1', assigneeId: 'user_ada' }],
      assignments: [],
    }).workloadSummary(BIZ);

    expect(summary.people.find((p) => p.name === 'Ada')!.openTasks).toBe(1);
  });

  it('counts a task recorded BOTH ways only once', async () => {
    // The failure mode of naively summing the two: one task, reported as two,
    // and a person who looks twice as busy as they are.
    const summary = await makeWorkload({
      contactTasks: [{ id: 'task_1', assigneeId: 'user_ada' }],
      assignments: [{ taskId: 'task_1', assignableType: 'User', assignableId: 'user_ada' }],
    }).workloadSummary(BIZ);

    expect(summary.people.find((p) => p.name === 'Ada')!.openTasks).toBe(1);
  });

  it('surfaces work nobody owns', async () => {
    const summary = await makeWorkload({
      contactTasks: [
        { id: 'task_1', assigneeId: 'user_ada' },
        { id: 'task_2', assigneeId: null },
        { id: 'task_3', assigneeId: null },
      ],
      assignments: [],
    }).workloadSummary(BIZ);

    expect(summary.unassignedOpenTasks).toBe(2);
  });

  it('puts the busiest person first', async () => {
    const summary = await makeWorkload({
      contactTasks: [
        { id: 'task_1', assigneeId: 'user_bo' },
        { id: 'task_2', assigneeId: 'user_bo' },
        { id: 'task_3', assigneeId: 'user_ada' },
      ],
      assignments: [],
    }).workloadSummary(BIZ);

    expect(summary.people[0].name).toBe('Bo');
  });

  it('reports someone with nothing on as zero rather than omitting them', async () => {
    // "Who is free" is the question this tool exists for, and a person with no
    // tasks is the answer. Building the list from assignments would drop them.
    const summary = await makeWorkload({
      contactTasks: [{ id: 'task_1', assigneeId: 'user_bo' }],
      assignments: [],
    }).workloadSummary(BIZ);

    expect(summary.people.find((p) => p.name === 'Ada')!.openTasks).toBe(0);
  });
});
