/**
 * Goal parenting must not cross the tenant boundary.
 *
 * This test exists because of a near-miss. A patch that "just added
 * class-validator decorators" to several undecorated DTOs would have introduced
 * cross-tenant writes, and every existing test would have stayed green.
 *
 * The mechanism: the global ValidationPipe runs with `whitelist: true`, which
 * DELETES properties carrying no validator metadata. Several endpoints had
 * undecorated DTOs, so their foreign-key fields were always stripped before
 * reaching the service. That made the endpoints broken — and, by accident, made
 * their missing ownership checks unreachable. The whitelist was functioning as
 * tenant isolation.
 *
 * createGoal wrote `parentGoalId: input.parentGoalId` with no check. Decorating
 * the DTO makes that field live, so the check has to exist first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KeyCortexPlannerService } from './key-cortex-planner.service';

class PrismaStub {
  /** Goals that exist, keyed by id -> owning business. */
  goals = new Map<string, string>([
    ['goal_mine', 'biz_1'],
    ['goal_theirs', 'biz_2'],
  ]);

  created: Array<Record<string, unknown>> = [];

  client = {
    aiGoal: {
      findFirst: vi.fn(({ where }: { where: { id: string; businessId: string } }) => {
        const owner = this.goals.get(where.id);
        return Promise.resolve(owner === where.businessId ? { id: where.id } : null);
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        this.created.push(data);
        return Promise.resolve({ id: 'goal_new', ...data });
      }),
    },
  };
}

function makeService(prisma: PrismaStub) {
  const noop = new Proxy({}, { get: () => vi.fn() });
  return new KeyCortexPlannerService(
    prisma as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
  );
}

describe('createGoal parent ownership', () => {
  let prisma: PrismaStub;
  let planner: KeyCortexPlannerService;

  beforeEach(() => {
    prisma = new PrismaStub();
    planner = makeService(prisma);
  });

  it('creates a goal with no parent', async () => {
    await planner.createGoal('biz_1', { title: 'Grow revenue' });
    expect(prisma.created).toHaveLength(1);
    expect(prisma.created[0].businessId).toBe('biz_1');
  });

  it('accepts a parent owned by the SAME business', async () => {
    await planner.createGoal('biz_1', { title: 'Sub-goal', parentGoalId: 'goal_mine' });
    expect(prisma.created).toHaveLength(1);
    expect(prisma.created[0].parentGoalId).toBe('goal_mine');
  });

  it('REFUSES a parent owned by another business', async () => {
    // The cross-tenant write this whole test file exists to prevent.
    await expect(
      planner.createGoal('biz_1', { title: 'Sneaky', parentGoalId: 'goal_theirs' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.created).toHaveLength(0);
  });

  it('REFUSES a parent that does not exist', async () => {
    await expect(
      planner.createGoal('biz_1', { title: 'Ghost', parentGoalId: 'goal_nope' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not reveal whether the id exists elsewhere', async () => {
    // "Not found" and "not yours" must be indistinguishable, otherwise the
    // error confirms the existence of another tenant's goal id.
    const notYours = await planner
      .createGoal('biz_1', { title: 'x', parentGoalId: 'goal_theirs' })
      .catch((e: Error) => e.message);
    const notReal = await planner
      .createGoal('biz_1', { title: 'x', parentGoalId: 'goal_nope' })
      .catch((e: Error) => e.message);

    expect(notYours).toBe(notReal);
  });

  it('scopes the lookup by businessId, not by id alone', async () => {
    await planner
      .createGoal('biz_1', { title: 'x', parentGoalId: 'goal_theirs' })
      .catch(() => undefined);

    const where = prisma.client.aiGoal.findFirst.mock.calls[0][0].where;
    expect(where.businessId).toBe('biz_1');
    expect(where.id).toBe('goal_theirs');
  });
});
