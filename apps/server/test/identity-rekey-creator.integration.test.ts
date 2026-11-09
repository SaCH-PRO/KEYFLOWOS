/**
 * W6-IDENTITY-REKEY-CREATOR (FOLLOW7; owner ruling D-73): IdentityService's user-id re-key carries
 * the member a trigger rule records as its creator with it (REAL database).
 *
 * D-73: a trigger records its creator and the plans it fires run as that member. Neither rule store
 * has a member column, so the creator is kept in the rule's own JSON config under the reserved key
 * '$createdBy': AgentTrigger.condition (W5-AGENT-TRIGGERS-AUTHORITY) and
 * KeyCortexTriggerRule.filterJson (KEY-R3b-PLAN-AUTHORITY). IdentityService.reconcileUserId (the
 * re-key that moves a user's rows from an old id to a new one, then deletes the old row) re-pointed
 * memberships, sessions, the AI log, approval and plan rows, Business.ownerId and the team activity
 * log, but not those two keys. After a re-key a member's rule still named the deleted id, so the plan
 * it fired was written for that id and its ai_plans insert failed on the user foreign key
 * (ai_plans_user_id_fkey): the rule silently stopped working. The re-key now re-points '$createdBy'
 * in both stores, in every business, inside the transaction it already uses.
 *
 * The re-key is driven directly (`reconcileUserId`, as identity-bootstrap.service.test.ts drives it,
 * without the guard its one caller, adoptInvitePlaceholder, passes): what is asserted is what it moves.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL; IdentityService
 * (reconcileUserId); the rule writers (createAgentTrigger through AgentTriggerService.createTrigger,
 * KeyCortexTriggerService.createRule), so the creator key is the one they store; AgentTriggerService
 * .handleEvent and KeyCortexTriggerService's event handler (rule match, the member a plan is written
 * for); KeyCortexPlannerService.createGoal and createPlanFromGoal (offline decomposition).
 * Stand-ins: PlannerService.createPlan (writes the AiPlan row for the member it is handed, as
 * PlannerService does, no steps), the KEY cortex event bus (hands the trigger service its subscriber),
 * the oversight service, execution log and journey orchestrator AgentTriggerService calls (no-op), and
 * KeyCortexPlannerService.executePlan (records the plan id: running the plan is not this packet's).
 *
 * Fixtures: prefix `v92d_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged RED-BEFORE fail
 * on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92d_';
const ID = {
  owner: `${P}owner`, // OWNER of biz and biz2 (Business.ownerId)
  memberOld: `${P}member_old`, // the member re-keyed: STAFF of biz, ADMIN of biz2
  memberNew: `${P}member_new`, // the id the re-key moves them to
  other: `${P}other`, // another STAFF member of biz, whose rules the re-key leaves alone
  biz: `${P}biz`,
  biz2: `${P}biz2`,
};
const MEMBER_EMAIL = `${P}member@test.local`;
const EVENT = 'v92d.rekey';
const OBJECTIVE = {
  member: 'v92d member rule',
  memberBiz2: 'v92d member rule in biz2',
  other: 'v92d other member rule',
  legacy: 'v92d rule with no creator',
};

let db: any;
let identity: any;
let agentTriggers: any;
let cortexTriggers: any;
let cortexHandler: ((event: any) => Promise<void>) | undefined;
const executedCortexPlans: string[] = [];
const RULE: Record<'agentMember' | 'agentMemberBiz2' | 'agentOther' | 'agentLegacy' | 'cortexMember' | 'cortexOther' | 'cortexLegacy', string> = {} as any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM agent_triggers WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_cortex_trigger_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The members recorded on the plans the agent triggers of `businessId` wrote, by objective. */
async function agentPlans(businessId: string) {
  const rows = await db.aiPlan.findMany({ where: { businessId, goalId: null }, select: { objective: true, userId: true } });
  return rows.map((r: any) => ({ objective: r.objective, userId: r.userId })).sort((a: any, b: any) => a.objective.localeCompare(b.objective));
}

/** The members recorded on the plans the KEY cortex rule `ruleId` fired (its goal's description names the rule). */
async function cortexPlansOfRule(ruleId: string) {
  const goals = await db.aiGoal.findMany({ where: { businessId: ID.biz, description: { contains: ruleId } }, select: { id: true } });
  const plans = await db.aiPlan.findMany({ where: { goalId: { in: goals.map((g: any) => g.id) } }, select: { id: true, userId: true } });
  return { goals: goals.length, plans };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { AgentTriggerService } = await import('../src/modules/ai/agent-trigger.service');
  const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');

  const prisma = new PrismaService();
  identity = new IdentityService(prisma, {} as any);
  (identity as any).logger = new Logger('v92d-identity');

  // PlannerService.createPlan, as it writes a plan: the AiPlan row for the member it is handed.
  const plannerStandIn = {
    createPlan: async (businessId: string, intent: { objective: string; rawInput?: string; scope?: string[] }, userId?: string) =>
      db.aiPlan.create({
        data: { businessId, userId: userId ?? null, objective: intent.objective, rawInput: intent.rawInput ?? null, scope: intent.scope ?? [], status: 'draft' },
      }),
  };
  agentTriggers = new AgentTriggerService(
    prisma,
    { emit: () => true } as any,
    {} as any, // oversight: only an autoExecute rule asks it
    plannerStandIn as any,
    {} as any,
    { log: async () => undefined } as any,
    { handleEvent: async () => [] } as any,
  );
  const cortexPlanner = new KeyCortexPlannerService(prisma, plannerStandIn as any, {} as any, {} as any);
  (cortexPlanner as any).executePlan = async (planId: string) => { executedCortexPlans.push(planId); };
  cortexTriggers = new KeyCortexTriggerService(prisma, { subscribeAll: (handler: any) => { cortexHandler = handler; return () => undefined; } } as any, cortexPlanner);
  cortexTriggers.onModuleInit();

  await cleanup(); // in case a prior run aborted

  for (const [id, email] of [[ID.owner, `${P}owner@test.local`], [ID.memberOld, MEMBER_EMAIL], [ID.other, `${P}other@test.local`]] as const) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V92D Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.biz2, name: 'V92D Biz 2', ownerId: ID.owner } });
  for (const [userId, businessId, role] of [
    [ID.owner, ID.biz, 'OWNER'],
    [ID.owner, ID.biz2, 'OWNER'],
    [ID.memberOld, ID.biz, 'STAFF'],
    [ID.memberOld, ID.biz2, 'ADMIN'],
    [ID.other, ID.biz, 'STAFF'],
  ] as const) {
    await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role } });
  }

  // The rules, written by the real writers (the creator recorded under the key they store).
  const agentRule = async (businessId: string, objective: string, writerId: string) =>
    (await agentTriggers.createTrigger(businessId, { name: objective, eventPattern: EVENT, condition: { kind: 'v92d' }, objective }, writerId)).id;
  RULE.agentMember = await agentRule(ID.biz, OBJECTIVE.member, ID.memberOld);
  RULE.agentMemberBiz2 = await agentRule(ID.biz2, OBJECTIVE.memberBiz2, ID.memberOld);
  RULE.agentOther = await agentRule(ID.biz, OBJECTIVE.other, ID.other);
  RULE.agentLegacy = (await db.agentTrigger.create({
    data: { businessId: ID.biz, name: OBJECTIVE.legacy, eventPattern: EVENT, condition: { kind: 'v92d' }, objective: OBJECTIVE.legacy },
  })).id;
  const cortexRule = async (writerId?: string) =>
    (await cortexTriggers.createRule({ businessId: ID.biz, eventType: EVENT, filterJson: { kind: 'v92d' }, goalTemplateId: `${P}tpl`, cooldownMinutes: 0 }, writerId)).id;
  RULE.cortexMember = await cortexRule(ID.memberOld);
  RULE.cortexOther = await cortexRule(ID.other);
  RULE.cortexLegacy = await cortexRule(undefined);
}, 180_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('the member holds an agent trigger in biz and biz2 and a KeyCortex trigger rule in biz, each recording them as creator under $createdBy beside its own filter; another member and a rule with no creator beside them', async () => {
    expect((await db.agentTrigger.findUnique({ where: { id: RULE.agentMember } })).condition).toEqual({ kind: 'v92d', $createdBy: ID.memberOld });
    expect((await db.agentTrigger.findUnique({ where: { id: RULE.agentMemberBiz2 } })).condition).toEqual({ kind: 'v92d', $createdBy: ID.memberOld });
    expect((await db.agentTrigger.findUnique({ where: { id: RULE.agentOther } })).condition).toEqual({ kind: 'v92d', $createdBy: ID.other });
    expect((await db.keyCortexTriggerRule.findUnique({ where: { id: RULE.cortexMember } })).filterJson).toEqual({ kind: 'v92d', $createdBy: ID.memberOld });
    expect((await db.keyCortexTriggerRule.findUnique({ where: { id: RULE.cortexLegacy } })).filterJson).toEqual({ kind: 'v92d' });
    expect(await db.membership.count({ where: { userId: ID.memberOld } })).toBe(2);
  });
});

describe("W6-IDENTITY-REKEY-CREATOR (D-73): IdentityService's user-id re-key carries the trigger rules' recorded creator with it", () => {
  beforeAll(async () => {
    const moved = await identity.reconcileUserId(ID.memberOld, { userId: ID.memberNew, email: MEMBER_EMAIL });
    expect(moved.id).toBe(ID.memberNew);
  });

  it("RK-01 RED-BEFORE (W6-IDENTITY-REKEY-CREATOR; D-73): the re-key re-points $createdBy to the new id in the member's agent triggers (AgentTrigger.condition) and KeyCortex trigger rules (filterJson), in every business they belong to, keeping each rule's own filter; another member's rules and a rule that records no creator are untouched", async () => {
    // The re-key itself (pinned): the old row is gone and the memberships moved.
    expect(await db.user.findUnique({ where: { id: ID.memberOld } })).toBeNull();
    expect(await db.membership.count({ where: { userId: ID.memberNew } })).toBe(2);

    const condition = async (id: string) => (await db.agentTrigger.findUnique({ where: { id } })).condition;
    const filter = async (id: string) => (await db.keyCortexTriggerRule.findUnique({ where: { id } })).filterJson;
    expect({
      agentMember: await condition(RULE.agentMember),
      agentMemberBiz2: await condition(RULE.agentMemberBiz2),
      cortexMember: await filter(RULE.cortexMember),
    }).toEqual({
      agentMember: { kind: 'v92d', $createdBy: ID.memberNew },
      agentMemberBiz2: { kind: 'v92d', $createdBy: ID.memberNew },
      cortexMember: { kind: 'v92d', $createdBy: ID.memberNew },
    });
    expect({
      agentOther: await condition(RULE.agentOther),
      agentLegacy: await condition(RULE.agentLegacy),
      cortexOther: await filter(RULE.cortexOther),
      cortexLegacy: await filter(RULE.cortexLegacy),
    }).toEqual({
      agentOther: { kind: 'v92d', $createdBy: ID.other },
      agentLegacy: { kind: 'v92d' },
      cortexOther: { kind: 'v92d', $createdBy: ID.other },
      cortexLegacy: { kind: 'v92d' },
    });
  });

  it("RK-02 RED-BEFORE (W6-IDENTITY-REKEY-CREATOR; D-73): after the re-key the member's agent triggers (biz and biz2) and KeyCortex trigger rule each fire a plan whose ai_plans row inserts with the new id as its member (on the unmodified code the deleted old id fails the ai_plans user foreign key and no plan is written); the other member's rules still fire as that member and a rule with no creator with no member", async () => {
    for (const businessId of [ID.biz, ID.biz2]) {
      await agentTriggers.handleEvent(EVENT, { businessId, kind: 'v92d' });
    }
    expect(await agentPlans(ID.biz)).toEqual([
      { objective: OBJECTIVE.member, userId: ID.memberNew },
      { objective: OBJECTIVE.other, userId: ID.other },
      { objective: OBJECTIVE.legacy, userId: null },
    ].sort((a, b) => a.objective.localeCompare(b.objective)));
    expect(await agentPlans(ID.biz2)).toEqual([{ objective: OBJECTIVE.memberBiz2, userId: ID.memberNew }]);

    await cortexHandler!({ id: `${P}evt_rk02`, source: 'v92d', type: EVENT, businessId: ID.biz, payload: { kind: 'v92d' }, metadata: {} });
    const member = await cortexPlansOfRule(RULE.cortexMember);
    expect(member.goals).toBe(1);
    expect(member.plans.map((p: any) => p.userId)).toEqual([ID.memberNew]);
    expect(executedCortexPlans).toContain(member.plans[0].id);
    expect((await cortexPlansOfRule(RULE.cortexOther)).plans.map((p: any) => p.userId)).toEqual([ID.other]);
    expect((await cortexPlansOfRule(RULE.cortexLegacy)).plans.map((p: any) => p.userId)).toEqual([null]);
  });
});
