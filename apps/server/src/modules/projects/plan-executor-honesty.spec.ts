/**
 * An automation that did not run must not report that it did.
 *
 * `executeInAppEvent` logged "Would execute tool X" behind a TODO, and then
 * told every surface in the product that the work was finished:
 *
 *   - the plan event went to `completed`, with a completedAt
 *   - the linked ProjectTask went to DONE, isCompleted: true
 *   - the timeline recorded "Auto-executed: <title>"
 *   - the call returned { status: 'completed' }
 *
 * Four sources, all agreeing, all wrong. That is worse than an error: an error
 * is something a user can see. This left nothing to notice, and the task was
 * marked done on their behalf, so afterwards you cannot tell whether it had
 * really been done.
 *
 * Wiring the executor is separate work. Refusing to claim success for it is
 * not, and this pins that refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectPlanExecutorService } from './project-plan-executor.service';

const BIZ = 'biz_1';
const EVENT = 'event_1';
const TASK = 'task_1';

function harness(overrides: { tier?: number } = {}) {
  const event = {
    id: EVENT,
    title: 'Send the kickoff pack',
    executionContext: 'IN_APP',
    automationTool: 'send_email',
    projectTaskId: TASK,
    planId: 'plan_1',
    plan: { businessId: BIZ },
  };

  const prisma = {
    client: {
      projectPlanEvent: {
        findFirst: vi.fn(async () => event),
        update: vi.fn(async () => ({})),
      },
      projectTask: { update: vi.fn(async () => ({})) },
    },
  };
  const timeline = { recordEvent: vi.fn(async () => ({})) };
  const governance = { getToolTier: vi.fn(() => overrides.tier ?? 1) };

  // (prisma, events, timeline, governance, planner) — the order matters and
  // getting it wrong fails as 'cannot read getToolTier of undefined'.
  const svc = new ProjectPlanExecutorService(
    prisma as never,
    { emit: vi.fn() } as never,
    timeline as never,
    governance as never,
    {} as never,
  );
  return { svc, prisma, timeline, governance };
}

describe('an unwired automation does not report success', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('does not mark the plan event completed', async () => {
    await h.svc.executeInAppEvent(BIZ, EVENT).catch(() => undefined);

    const statuses = h.prisma.client.projectPlanEvent.update.mock.calls.map(
      (c: [{ data?: { status?: string } }]) => c[0]?.data?.status,
    );
    expect(statuses, 'no call may set completed').not.toContain('completed');
    expect(statuses, 'it must land on blocked').toContain('blocked');
  });

  it('does not mark the linked task DONE', async () => {
    // The part of the old behaviour that actually destroyed information: after
    // the task is flipped, nobody can tell whether it was really done.
    await h.svc.executeInAppEvent(BIZ, EVENT).catch(() => undefined);
    expect(h.prisma.client.projectTask.update).not.toHaveBeenCalled();
  });

  it('does not write a timeline entry claiming it executed', async () => {
    await h.svc.executeInAppEvent(BIZ, EVENT).catch(() => undefined);

    const actions = h.timeline.recordEvent.mock.calls.map(
      (c: [{ action?: string }]) => c[0]?.action,
    );
    expect(actions).not.toContain('event_executed');
  });

  it('records that it could NOT run, so the step is not silent', async () => {
    // Refusing is not the same as saying nothing. The user asked for something
    // to happen and is entitled to know it did not.
    await h.svc.executeInAppEvent(BIZ, EVENT).catch(() => undefined);

    const actions = h.timeline.recordEvent.mock.calls.map(
      (c: [{ action?: string }]) => c[0]?.action,
    );
    expect(actions).toContain('event_execution_unavailable');
  });

  it('returns a status the caller can act on, and it is not "completed"', async () => {
    const result = await h.svc.executeInAppEvent(BIZ, EVENT);
    expect(result.status).toBe('unavailable');
    expect(result).toHaveProperty('message');
  });

  it('the approval gate still runs first and is unaffected', async () => {
    // A tier-3 tool must still stop at approval rather than reaching the
    // not-implemented branch — the refusal must not swallow the governance path.
    const high = harness({ tier: 3 });
    const result = await high.svc.executeInAppEvent(BIZ, EVENT);
    expect(result.status).toBe('awaiting_approval');
  });
});
