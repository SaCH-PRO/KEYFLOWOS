/**
 * "Who should do this?" must be answered from THIS business's work only.
 *
 * TaskAssignment is a polymorphic join keyed on (assignableType, assignableId)
 * and carries no businessId, so the tenant boundary can only be applied where
 * the row lands — at the task table. All three scorers took a `_businessId`
 * they never used, and the underscore made it read as deliberate.
 *
 * For a person who belongs to one business the numbers were right, which is why
 * this survived. For a person in two — a fractional ops manager, an agency
 * working several accounts, an owner running two entities, all ordinary here —
 * business A's recommendation was computed from business B's tasks. A learns
 * that Ada is busy, and how busy, without any relationship to B.
 *
 * skillScore is the sharpest: it reads task TITLES, so B's task text was
 * scoring A's recommendations. That is content crossing the boundary, not an
 * aggregate.
 *
 * Business is the tenant boundary in this codebase, the Prisma tenant extension
 * is inert, and a guard establishes who is ASKING without constraining what a
 * query touches. So this is asserted against data, not against a where clause.
 */
import { describe, it, expect, vi } from 'vitest';
import { TaskAssignmentRecommenderService } from './task-assignment-recommender.service';

const A = 'biz_a';
const B = 'biz_b';
/** Ada belongs to both businesses. Bo belongs only to A. */
const ADA = 'user_ada';
const BO = 'user_bo';

type ContactTask = {
  id: string;
  businessId: string;
  status: string;
  completedAt: Date | null;
  title: string;
};

const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000);

function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  for (const [field, cond] of Object.entries(where)) {
    const v = row[field];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !(cond.in as unknown[]).includes(v)) return false;
      if ('not' in cond && v === cond.not) return false;
      if ('gte' in cond && !(v instanceof Date && v >= (cond.gte as Date))) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

function makeRecommender(contactTasks: ContactTask[]) {
  const assignments = contactTasks.map((t) => ({
    taskType: 'ContactTask',
    taskId: t.id,
    assignableType: 'User',
    assignableId: t.id.startsWith('ada') ? ADA : BO,
    assignedAt: RECENT,
    unassignedAt: null,
  }));

  const table = <T extends Record<string, any>>(rows: T[]) => ({
    findMany: vi.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))),
    count: vi.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length),
  });

  const prisma = {
    client: {
      taskAssignment: table(assignments),
      contactTask: table(contactTasks),
      projectTask: table([] as Array<Record<string, any>>),
      user: {
        findMany: vi.fn(async () => [
          { id: ADA, name: 'Ada', email: 'ada@example.com' },
          { id: BO, name: 'Bo', email: 'bo@example.com' },
        ]),
      },
      staffMember: { findMany: vi.fn(async () => []) },
    },
  };

  return new TaskAssignmentRecommenderService(prisma as never);
}

/** Ada has one open task in A and four in B. Bo has one open task in A. */
const TWO_TENANTS: ContactTask[] = [
  { id: 'ada_a1', businessId: A, status: 'TODO', completedAt: null, title: 'Chase the Acme renewal' },
  { id: 'ada_b1', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the sauna heater' },
  { id: 'ada_b2', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the pool pump' },
  { id: 'ada_b3', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the lobby lights' },
  { id: 'ada_b4', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the back office' },
  { id: 'bo_a1', businessId: A, status: 'TODO', completedAt: null, title: 'Chase the Globex renewal' },
];

async function recommendIn(businessId: string, tasks = TWO_TENANTS, taskTitle?: string) {
  const svc = makeRecommender(tasks);
  const { recommendations } = await svc.recommend(businessId, { taskType: 'ContactTask', taskTitle });
  return recommendations;
}

describe('a second business cannot make someone look busy', () => {
  it('counts only this business when reporting open tasks', async () => {
    // Ada has 5 open tasks in total and 1 of them is A's.
    const ada = (await recommendIn(A)).find((r) => r.assignableId === ADA)!;

    expect(ada.reason).toMatch(/light workload/);
    expect(ada.reason).not.toMatch(/5 open tasks/);
  });

  it('ranks two equally-loaded people equally', async () => {
    // Ada and Bo each carry exactly one open task in business A. Before this,
    // Ada's four unrelated tasks in B pushed her below Bo and KEY would have
    // routed the work away from her, for a reason nobody in A could see.
    const recs = await recommendIn(A);
    const ada = recs.find((r) => r.assignableId === ADA)!;
    const bo = recs.find((r) => r.assignableId === BO)!;

    expect(ada.score).toBe(bo.score);
  });

  it('still sees the work when asked from the other business', async () => {
    // The boundary has to cut both ways, or this is just a filter that hides
    // data from everyone.
    const ada = (await recommendIn(B)).find((r) => r.assignableId === ADA)!;

    expect(ada.reason).toMatch(/4 open tasks/);
  });
});

describe('one tenant\'s task titles cannot score another tenant\'s work', () => {
  it('does not treat B\'s rewiring history as skill for A', async () => {
    // Ada's completed work in B is all rewiring. Asked in A to find someone for
    // a rewiring job, her skill score must not be lifted by history A has no
    // relationship to — the titles are B's content.
    const done: ContactTask[] = [
      { id: 'ada_b1', businessId: B, status: 'DONE', completedAt: RECENT, title: 'Rewire the sauna heater' },
      { id: 'bo_a1', businessId: A, status: 'TODO', completedAt: null, title: 'Chase the Globex renewal' },
    ];

    const inA = (await recommendIn(A, done, 'Rewire the sauna heater'))
      .find((r) => r.assignableId === ADA)!;
    const inB = (await recommendIn(B, done, 'Rewire the sauna heater'))
      .find((r) => r.assignableId === ADA)!;

    expect(inA.reason).not.toMatch(/skill match/);
    expect(inB.reason).toMatch(/skill match/);
  });
});

describe('velocity measures the same population on both sides of the ratio', () => {
  it('does not punish someone for work that belongs to another business', async () => {
    // The denominator counted assignments of EVERY type across EVERY business
    // while the numerator counted only this-business ContactTask completions,
    // so the ratio measured the mismatch rather than the person. Ada finished
    // everything A gave her.
    const tasks: ContactTask[] = [
      { id: 'ada_a1', businessId: A, status: 'DONE', completedAt: RECENT, title: 'Chase the Acme renewal' },
      { id: 'ada_b1', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the sauna heater' },
      { id: 'ada_b2', businessId: B, status: 'TODO', completedAt: null, title: 'Rewire the pool pump' },
    ];

    const ada = (await recommendIn(A, tasks)).find((r) => r.assignableId === ADA)!;

    expect(ada.reason).toMatch(/high completion rate/);
  });
});
