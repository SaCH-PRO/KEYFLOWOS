import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import { PlannerService } from '../ai/planner.service';

/**
 * FU-PLANNER-STEP-ORDER (P25):
 * Every Prisma `aiPlan` query that includes `steps` must explicitly order them
 * by `order` ascending (never bare `include: { steps: true }`). Without an
 * ORDER BY clause, PostgreSQL is free to return child rows in physical heap /
 * CTID order after vacuum or concurrent deletes — which caused intermittent
 * failures in `owner-role-key.integration.test.ts` where step 3 appeared before
 * step 1.
 */
function assertOrderedStepsInclude(stepsInclude: unknown, context: string) {
  expect(
    stepsInclude,
    `${context}: include.steps must be an object with orderBy on order asc, not bare true`,
  ).toEqual(
    expect.objectContaining({
      orderBy: expect.anything(),
    }),
  );
  const orderBy = (stepsInclude as { orderBy: unknown }).orderBy;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  expect(clauses.length, `${context}: orderBy must not be empty`).toBeGreaterThan(0);
  expect(clauses[0], `${context}: primary sort must be { order: 'asc' }`).toEqual({ order: 'asc' });
}

function makePlanner(prismaClient: Record<string, unknown>, plannerStub?: Record<string, unknown>) {
  const noop = new Proxy({}, { get: () => vi.fn() });
  return new KeyCortexPlannerService(
    { client: prismaClient } as never,
    (plannerStub ?? noop) as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
  );
}

describe('FU-PLANNER-STEP-ORDER: every aiPlan include.steps query orders by order asc', () => {
  it('RED-BEFORE: KeyCortexPlannerService.getPlan requests steps ordered by order asc', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = makePlanner({ aiPlan: { findFirst } });

    await service.getPlan('plan_1', 'biz_1');

    expect(findFirst).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(findFirst.mock.calls[0][0]?.include?.steps, 'getPlan');
  });

  it('RED-BEFORE: KeyCortexPlannerService.createPlanFromGoal requests steps ordered by order asc', async () => {
    const aiGoalFindFirst = vi.fn().mockResolvedValue({
      id: 'goal_1',
      businessId: 'biz_1',
      title: 'Grow revenue',
      description: 'Monthly target',
    });
    const aiPlanUpdate = vi.fn().mockResolvedValue({});
    const aiPlanFindUnique = vi.fn().mockResolvedValue({ id: 'plan_1', steps: [] });
    const plannerStub = {
      createPlan: vi.fn().mockResolvedValue({ id: 'plan_1' }),
    };

    const service = makePlanner(
      {
        aiGoal: { findFirst: aiGoalFindFirst },
        aiPlan: { update: aiPlanUpdate, findUnique: aiPlanFindUnique },
      },
      plannerStub,
    );
    vi.spyOn(service, 'generatePlan').mockResolvedValue({
      goal: { objective: 'Grow revenue', successCriteria: [] },
      horizon: 'tactical',
      steps: [],
      confidence: 0.9,
      estimatedImpact: 'high',
      riskAssessment: 'low',
    } as never);

    await service.createPlanFromGoal('biz_1', 'goal_1', 'user_1');

    expect(aiPlanFindUnique).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(
      aiPlanFindUnique.mock.calls[0][0]?.include?.steps,
      'createPlanFromGoal',
    );
  });

  it('RED-BEFORE: KeyCortexPlannerService.replanIfNeeded requests steps ordered by order asc', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = makePlanner({ aiPlan: { findUnique } });

    await service.replanIfNeeded('plan_1');

    expect(findUnique).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(findUnique.mock.calls[0][0]?.include?.steps, 'replanIfNeeded');
  });

  it('RED-BEFORE: KeyCortexPlannerService.executePlan (member and system paths + runClaimedPlan reload) requests steps ordered by order asc', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = makePlanner({ aiPlan: { findFirst, findUnique } });

    await service
      .executePlan('plan_1', {}, {
        businessId: 'biz_1',
        userId: 'user_1',
        role: 'OWNER',
        permissionScopes: null,
      })
      .catch(() => undefined);
    expect(findFirst).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(findFirst.mock.calls[0][0]?.include?.steps, 'executePlan(member)');

    await service.executePlan('plan_1').catch(() => undefined);
    expect(findUnique).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(findUnique.mock.calls[0][0]?.include?.steps, 'executePlan(system)');

    // Also exercise the claimed-plan reload inside runClaimedPlan.
    const reloadFindUnique = vi.fn().mockResolvedValue({ id: 'plan_1', businessId: 'biz_1', steps: [] });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const claimedPlan = {
      id: 'plan_1',
      businessId: 'biz_1',
      userId: 'user_1',
      status: 'pending',
      steps: [],
    };
    const memberFindFirst = vi.fn().mockResolvedValue(claimedPlan);
    const service2 = makePlanner({
      business: { findUnique: vi.fn().mockResolvedValue({ ownerId: 'user_1' }) },
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', permissionScopes: null }) },
      aiPlan: {
        findFirst: memberFindFirst,
        findUnique: reloadFindUnique,
        updateMany,
        update,
      },
      aiPlanResult: { upsert },
    });

    await service2.executePlan('plan_1', {}, {
      businessId: 'biz_1',
      userId: 'user_1',
      role: 'OWNER',
      permissionScopes: null,
    });

    expect(reloadFindUnique).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(
      reloadFindUnique.mock.calls[0][0]?.include?.steps,
      'runClaimedPlan reload',
    );
  });

  it('RED-BEFORE: sibling PlannerService.approvePlan requests steps ordered by order asc', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const noop = new Proxy({}, { get: () => vi.fn() });
    const planner = new PlannerService(
      { client: { aiPlan: { findFirst } } } as never,
      noop as never,
      noop as never,
      noop as never,
      noop as never,
    );

    await planner.approvePlan('plan_1', 'biz_1', 'user_1').catch(() => undefined);

    expect(findFirst).toHaveBeenCalledTimes(1);
    assertOrderedStepsInclude(findFirst.mock.calls[0][0]?.include?.steps, 'PlannerService.approvePlan');
  });

  it('RED-BEFORE: no aiPlan query under apps/server/src/modules/ uses unordered include: { steps: true }', () => {
    const modulesDir = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.test.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          // Find every aiPlan.<method>({ ... }) call and check its call window for bare `steps: true`.
          const regex = /\.aiPlan\.(findUnique|findFirst|findMany|create|update)\s*\(/g;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(content)) !== null) {
            // Walk balanced parentheses from the opening `(` of the Prisma call.
            let depth = 1;
            let idx = match.index + match[0].length;
            while (idx < content.length && depth > 0) {
              if (content[idx] === '(') depth++;
              else if (content[idx] === ')') depth--;
              idx++;
            }
            const callBody = content.slice(match.index, idx);
            if (/include\s*:\s*\{[^}]*\bsteps\s*:\s*true\b/.test(callBody)) {
              const line = content.slice(0, match.index).split('\n').length;
              const rel = path.relative(modulesDir, full);
              offenders.push(`${rel}:${line} (${match[1]})`);
            }
          }
        }
      }
    }

    walk(modulesDir);
    expect(
      offenders,
      `Found aiPlan queries with unordered include: { steps: true }: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('RED-BEFORE: topologicalSort deterministically sorts out-of-order steps by order asc and id asc on ties', () => {
    const service = makePlanner({});
    const sort = (service as unknown as {
      topologicalSort: (steps: Array<Record<string, unknown>>) => Array<{ id: string; order: number }>;
    }).topologicalSort.bind(service);

    const sorted = sort([
      { id: 'step_c', order: 3, dependsOn: [], module: 'finance', action: 'c', inputPayload: {}, toolName: 'finance.c' },
      { id: 'step_b2', order: 2, dependsOn: [], module: 'crm', action: 'b2', inputPayload: {}, toolName: 'crm.b2' },
      { id: 'step_a', order: 1, dependsOn: [], module: 'genome', action: 'a', inputPayload: {}, toolName: 'genome.a' },
      { id: 'step_b1', order: 2, dependsOn: [], module: 'crm', action: 'b1', inputPayload: {}, toolName: 'crm.b1' },
    ]);

    expect(sorted.map((s) => s.id)).toEqual(['step_a', 'step_b1', 'step_b2', 'step_c']);
  });

  it('CONTROL: topologicalSort still runs prerequisite dependencies before dependents', () => {
    const service = makePlanner({});
    const sort = (service as unknown as {
      topologicalSort: (steps: Array<Record<string, unknown>>) => Array<{ id: string; order: number }>;
    }).topologicalSort.bind(service);

    const sorted = sort([
      { id: 'step_1', order: 1, dependsOn: ['step_2'], module: 'crm', action: 'after', inputPayload: {}, toolName: 'crm.after' },
      { id: 'step_2', order: 2, dependsOn: [], module: 'genome', action: 'before', inputPayload: {}, toolName: 'genome.before' },
    ]);

    expect(sorted.map((s) => s.id)).toEqual(['step_2', 'step_1']);
  });
});
