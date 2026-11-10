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
 * RK-03 (W7-AUTH-DOCS-REKEY, D-73) reads docs/auth-pathway.md, identity.service.ts and schema.prisma
 * from the repository and runs the doc's statements, as written, against the real database.
 *
 * Fixtures: prefix `v92d_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged RED-BEFORE fail
 * on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'node:fs';
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

  // Review SEC-RKC-1 / RK-CR-1, closed by W7-AUTH-DOCS-REKEY (D-73). In production the re-key above runs
  // only for a never-signed-in invite placeholder (adoptInvitePlaceholder), which no rule writer can
  // record as a creator. A real member moves to a new subject only by the manual operator step in
  // docs/auth-pathway.md ("Fixed by R0-SEC-01", step 4). That step re-pointed "every column that holds
  // the old id", found in schema.prisma, and repeated reconcileUserId's list without the trigger
  // creator. '$createdBy' is a JSON key, not a column, so it was found in neither place, and an operator
  // who followed the step left the member's rules on the deleted id (the failure RK-01 and RK-02 show
  // RED on the W6 base). This case holds step 4 to reconcileUserId as the code has it:
  //  - the step carries reconcileUserId's '$createdBy' jsonb_set statements verbatim in a sql block (the
  //    code's parameters written as '$createdBy', '<new id>' and '<old id>');
  //  - it names, as table.column, every column reconcileUserId's updateMany calls re-point and every
  //    foreign key to User in schema.prisma that reconcileUserId leaves (cascade or set null);
  //  - its statements, run as written against this database, re-point a rule's creator in both stores
  //    and leave every other rule as it was.
  // Every $executeRaw and updateMany in reconcileUserId has to be parsed, so a re-point added there
  // without a line in the doc fails here.
  it("RK-03 RED-BEFORE (W7-AUTH-DOCS-REKEY; D-73; review SEC-RKC-1, RK-CR-1): the manual operator re-key in docs/auth-pathway.md (step 4) re-points $createdBy in agent_triggers.condition and key_cortex_trigger_rules.filter_json with the same jsonb_set statements reconcileUserId runs, names every column reconcileUserId re-points and every User foreign key it leaves, and its statements run as written re-point a rule's creator in both stores and leave the other rules alone", async () => {
    const REPO = path.resolve(__dirname, '../../..');
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

    // reconcileUserId as the code has it: from its signature to the next class member.
    const service = readFileSync(path.join(REPO, 'apps/server/src/modules/identity/identity.service.ts'), 'utf8');
    const creatorKey = /const TRIGGER_CREATOR_KEY = '([^']+)';/.exec(service)?.[1];
    expect(creatorKey).toBe('$createdBy');
    const start = service.indexOf('private async reconcileUserId(');
    expect(start).toBeGreaterThan(0);
    const next = service.slice(start + 1).search(/\n {2}(?:private |protected |public |async |static |get |set )/);
    expect(next).toBeGreaterThan(0);
    const reconcile = service.slice(start, start + 1 + next);

    const raw = [...reconcile.matchAll(/\$executeRaw`([\s\S]*?)`/g)];
    expect(raw.length, 'every $executeRaw in reconcileUserId is parsed').toBe(reconcile.split('$executeRaw').length - 1);
    const codeStatements = raw.map((m) =>
      squash(m[1]
        .replace(/\$\{TRIGGER_CREATOR_KEY\}/g, () => `'${creatorKey}'`)
        .replace(/\$\{newId\}/g, () => "'<new id>'")
        .replace(/\$\{oldId\}/g, () => "'<old id>'")),
    );
    expect(codeStatements).toHaveLength(2);
    for (const s of codeStatements) expect(s, 'every parameter of the statement is known').not.toContain('${');
    const jsonColumns = codeStatements.map((s) => {
      const m = /^UPDATE (\w+) SET (\w+) = jsonb_set\(\2, ARRAY\['\$createdBy'::text\], to_jsonb\('<new id>'::text\)\) WHERE \2 ->> '\$createdBy'::text = '<old id>'::text$/.exec(s);
      expect(m, s).not.toBeNull();
      return `${m![1]}.${m![2]}`;
    });
    expect(jsonColumns).toEqual(['agent_triggers.condition', 'key_cortex_trigger_rules.filter_json']);

    // The columns reconcileUserId's updateMany calls re-point, and the foreign keys to User it leaves, as
    // table.column (schema.prisma @@map / @map).
    const schema = readFileSync(path.join(REPO, 'packages/db/prisma/schema.prisma'), 'utf8');
    const column = (model: string, field: string) => {
      const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1];
      expect(block, `model ${model} in schema.prisma`).toBeDefined();
      const table = /@@map\("([^"]+)"\)/.exec(block!)?.[1] ?? model;
      const line = block!.split('\n').find((l) => new RegExp(`^\\s*${field}\\s`).test(l));
      expect(line, `${model}.${field} in schema.prisma`).toBeDefined();
      return `${table}.${/@map\("([^"]+)"\)/.exec(line!)?.[1] ?? field}`;
    };
    const updates = [...reconcile.matchAll(/tx\.(\w+)\.updateMany\(\s*(?:skipTenantIsolation\(\s*)?\{\s*where:\s*\{\s*(\w+):\s*oldId\s*\}/g)];
    expect(updates.length, 'every updateMany in reconcileUserId is parsed').toBe(reconcile.split('.updateMany(').length - 1);
    const repointed = updates.map((m) => column(m[1][0].toUpperCase() + m[1].slice(1), m[2]));
    expect(repointed).toEqual(expect.arrayContaining(['memberships.user_id', 'businesses.owner_id']));
    const userForeignKeys = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].flatMap(([, model, body]) =>
      [...body.matchAll(/^\s*\w+\s+User\??\s+@relation\([^)]*fields:\s*\[(\w+)\][^)]*\)/gm)].map((r) => column(model, r[1])));
    expect(userForeignKeys).toContain('memberships.user_id');
    const leftByReconcile = userForeignKeys.filter((c) => !repointed.includes(c));
    expect(leftByReconcile.length).toBeGreaterThan(0);

    // Step 4 of the manual operator re-key, as the doc has it.
    const doc = readFileSync(path.join(REPO, 'docs/auth-pathway.md'), 'utf8');
    const heading = doc.indexOf('**Moving an account to a new subject is now a manual operator step.**');
    expect(heading).toBeGreaterThan(0);
    const section = doc.slice(heading);
    const step4At = section.search(/^\s+4\. /m);
    const step5At = section.search(/^\s+5\. /m);
    expect(step4At).toBeGreaterThan(0);
    expect(step5At).toBeGreaterThan(step4At);
    const step4 = section.slice(step4At, step5At);

    for (const col of repointed) expect(step4, `step 4 names \`${col}\` (reconcileUserId re-points it)`).toContain(`\`${col}\``);
    for (const col of jsonColumns) expect(step4, `step 4 names \`${col}\` (the trigger creator)`).toContain(`\`${col}\``);
    for (const col of leftByReconcile) expect(step4, `step 4 names \`${col}\` (a User foreign key reconcileUserId leaves)`).toContain(`\`${col}\``);
    expect(step4).toContain(`\`${creatorKey}\``);
    const sql = /```sql\n([\s\S]*?)```/.exec(step4)?.[1];
    expect(sql, 'step 4 carries a ```sql block').toBeDefined();
    const docStatements = sql!.split(';').map(squash).filter(Boolean);
    expect(docStatements).toEqual(codeStatements);

    // The doc's statements, run as written (old and new id filled in), on a rule of each store whose
    // creator is DOC_OLD: that key moves to DOC_NEW and the rule's own filter stays; every other rule
    // (another member's, one with no creator) is left as it was.
    const DOC_OLD = `${P}doc_old`;
    const DOC_NEW = `${P}doc_new`;
    const DOC_EVENT = 'v92d.rekey.doc';
    const agentDoc = await db.agentTrigger.create({
      data: { businessId: ID.biz2, name: 'v92d doc rule', eventPattern: DOC_EVENT, condition: { kind: 'v92d', $createdBy: DOC_OLD }, objective: 'v92d doc rule' },
    });
    const cortexDoc = await db.keyCortexTriggerRule.create({
      data: { businessId: ID.biz2, eventType: DOC_EVENT, filterJson: { kind: 'v92d', $createdBy: DOC_OLD }, goalTemplateId: `${P}tpl`, cooldownMinutes: 0 },
    });
    for (const statement of docStatements) {
      await db.$executeRawUnsafe(statement.split("'<old id>'").join(`'${DOC_OLD}'`).split("'<new id>'").join(`'${DOC_NEW}'`));
    }
    expect((await db.agentTrigger.findUnique({ where: { id: agentDoc.id } })).condition).toEqual({ kind: 'v92d', $createdBy: DOC_NEW });
    expect((await db.keyCortexTriggerRule.findUnique({ where: { id: cortexDoc.id } })).filterJson).toEqual({ kind: 'v92d', $createdBy: DOC_NEW });
    expect({
      agentMember: (await db.agentTrigger.findUnique({ where: { id: RULE.agentMember } })).condition,
      agentOther: (await db.agentTrigger.findUnique({ where: { id: RULE.agentOther } })).condition,
      agentLegacy: (await db.agentTrigger.findUnique({ where: { id: RULE.agentLegacy } })).condition,
      cortexMember: (await db.keyCortexTriggerRule.findUnique({ where: { id: RULE.cortexMember } })).filterJson,
      cortexOther: (await db.keyCortexTriggerRule.findUnique({ where: { id: RULE.cortexOther } })).filterJson,
      cortexLegacy: (await db.keyCortexTriggerRule.findUnique({ where: { id: RULE.cortexLegacy } })).filterJson,
    }).toEqual({
      agentMember: { kind: 'v92d', $createdBy: ID.memberNew },
      agentOther: { kind: 'v92d', $createdBy: ID.other },
      agentLegacy: { kind: 'v92d' },
      cortexMember: { kind: 'v92d', $createdBy: ID.memberNew },
      cortexOther: { kind: 'v92d', $createdBy: ID.other },
      cortexLegacy: { kind: 'v92d' },
    });
  });
});
