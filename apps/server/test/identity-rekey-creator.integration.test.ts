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
 * RK-04 (W7-AUTH-DOCS-REKEY review SEC-ADR-1, D-93) stores the connector configuring member and default
 * owner through the real writers (GoogleContactsSyncService, OutlookContactsSyncService and
 * ConnectorFormMappingService), follows step 4 of that doc as written, and checks syncPrincipals and the
 * CRM create door (CrmService.assertCanCreateContacts, real) for the runs the configuration binds.
 *
 * Fixtures: prefix `v92d_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged RED-BEFORE fail
 * on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync, readdirSync } from 'node:fs';
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
let prisma: any;
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
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM google_form_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const REPO = path.resolve(__dirname, '../../..');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Step 4 of the manual operator re-key in docs/auth-pathway.md ("Fixed by R0-SEC-01"), as the doc has it. */
function docStep4(): string {
  const doc = readFileSync(path.join(REPO, 'docs/auth-pathway.md'), 'utf8');
  const heading = doc.indexOf('**Moving an account to a new subject is now a manual operator step.**');
  expect(heading).toBeGreaterThan(0);
  const section = doc.slice(heading);
  const step4At = section.search(/^\s+4\. /m);
  const step5At = section.search(/^\s+5\. /m);
  expect(step4At).toBeGreaterThan(0);
  expect(step5At).toBeGreaterThan(step4At);
  return section.slice(step4At, step5At);
}

/** Every path in `value` (a JSON document) whose value is the string `id`, dot-joined. */
function pathsHolding(value: unknown, id: string, at = ''): string[] {
  const join = (key: string | number) => (at ? `${at}.${key}` : String(key));
  if (value === id) return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsHolding(v, id, join(i)));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => pathsHolding(v, id, join(k)));
  return [];
}

/** `value` (a JSON document) with every string equal to `from` replaced by `to`. */
function replacingId(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((v) => replacingId(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replacingId(v, from, to)]));
  return value;
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

  prisma = new PrismaService();
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
    const step4 = docStep4();

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

  // Review SEC-ADR-1, closed by the W7-AUTH-DOCS-REKEY repair (D-93). Step 4 says it re-points every
  // reference to the old id. Three more member ids live inside JSON, in connector_statuses.metadata,
  // where schema.prisma does not show them either: the configuring member a contact sync rules save
  // records (rulesConfiguredBy, on the google_contacts and outlook_contacts rows; W6-CONNECT-TAG-MERGE),
  // the default owner those rules give new contacts (mappingRules.defaultOwnerId), and the member who
  // saved a connector form mapping (formMappings.<form id>.configuredBy, on the typeform, jotform and
  // webhook_form rows). D-93: a contact sync or form backfill runs with its configuring member among the
  // members every write must be allowed for (syncPrincipals), and resolveCrmAccess refuses a deleted id.
  // So after step 4 as it was written, every contact sync and form backfill of the business created and
  // updated nothing, whoever started it (the owner and a system run included), until someone saved the
  // rules again. This case stores those ids through the real writers, follows step 4 as written (every
  // sql block in it, with the old and new id filled in), and expects:
  //  - no JSON path of the business's connector rows to hold the old id, the same paths to hold the new
  //    one, and every other value (another member's mapping, another business's rules) as it was;
  //  - a system run, the member's own run and the owner's run of each sync and backfill to have the new
  //    id as their configuring member and to be allowed to create contacts, and the default owner to
  //    apply again.
  // Every server file that records a configuring member or a default owner (configuringMember,
  // settingDefaultOwnerId) must be one this case drives, so a new writer without a line in step 4 fails
  // here.
  it("RK-04 RED-BEFORE (W7-AUTH-DOCS-REKEY; D-93; review SEC-ADR-1): the manual operator re-key in docs/auth-pathway.md (step 4), followed as written, re-points the connector configuring member (connector_statuses.metadata rulesConfiguredBy and formMappings.<form id>.configuredBy) and the contact sync default owner (mappingRules.defaultOwnerId) the real writers stored, leaves every other value of those rows as it was, and a system run, the member's own run and the owner's run of each contact sync and form backfill may create contacts again", async () => {
    const { GoogleContactsSyncService, RULES_CONFIGURED_BY, syncPrincipals, membersMayCreateContacts, memberDefaultOwnerId } =
      await import('../src/modules/connect/google-contacts-sync.service');
    const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
    const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
    const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { runWithTenant } = await import('../src/core/tenant/tenant-context');

    // Every server file that records a configuring member or a default owner is one this case drives.
    const SRC = path.join(REPO, 'apps/server/src');
    const writers = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !/\.(?:spec|test)\.ts$/.test(f))
      .filter((f) => /\b(?:configuringMember|settingDefaultOwnerId)\(/.test(readFileSync(path.join(SRC, f), 'utf8')))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
    // W9-FORMS-QUOTE-GATE (SEC-W9FQG-1) added the Google Forms mapping's configuring member
    // (google_form_mappings.opportunity_defaults.configuredBy), which step 4 re-points too.
    expect(writers).toEqual([
      'modules/connect/connector-form-mapping.service.ts',
      'modules/connect/google-contacts-sync.service.ts',
      'modules/connect/google-forms-mapping.service.ts',
      'modules/connect/outlook-contacts-sync.service.ts',
    ]);

    // An ADMIN member of biz saves the contact sync rules (naming themselves the default owner) and two
    // form mappings; the owner saves another mapping and biz2's rules.
    const CFG_OLD = `${P}cfg_old`;
    const CFG_NEW = `${P}cfg_new`;
    const CFG_EMAIL = `${P}cfg@test.local`;
    await db.user.create({ data: { id: CFG_OLD, email: CFG_EMAIL, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_cfg_biz`, userId: CFG_OLD, businessId: ID.biz, role: 'ADMIN' } });
    const google = new GoogleContactsSyncService(prisma, {} as any, {} as any);
    const outlook = new OutlookContactsSyncService(prisma, {} as any, {} as any);
    const forms = new ConnectorFormMappingService(prisma, {} as any);
    const FORM = { member: `${P}form_member`, owner: `${P}form_owner` };
    const fieldMappings = [{ questionId: 'q_email', crmField: 'email' }] as any;
    await google.saveMappingRules(ID.biz, { defaultTags: ['v92d'], defaultOwnerId: CFG_OLD }, CFG_OLD);
    await outlook.saveMappingRules(ID.biz, { defaultTags: ['v92d'], defaultOwnerId: CFG_OLD }, CFG_OLD);
    await forms.saveMapping(ID.biz, 'typeform', FORM.member, { fieldMappings }, CFG_OLD);
    await forms.saveMapping(ID.biz, 'typeform', FORM.owner, { fieldMappings }, ID.owner);
    await forms.saveMapping(ID.biz, 'jotform', FORM.member, { fieldMappings }, CFG_OLD);
    await google.saveMappingRules(ID.biz2, { defaultTags: ['v92d'], defaultOwnerId: ID.owner }, ID.owner);
    // The Google Forms mappings whose responses create quotes record their configuring member in
    // google_form_mappings.opportunity_defaults (W9-FORMS-QUOTE-GATE): the member's and the owner's.
    const gforms = new GoogleFormsMappingService(prisma, {} as any, {} as any);
    const GFORM = { member: `${P}gform_member`, owner: `${P}gform_owner` };
    await gforms.saveMapping({ businessId: ID.biz, formId: GFORM.member, fieldMappings, opportunityDefaults: { enabled: true }, actorUserId: CFG_OLD });
    await gforms.saveMapping({ businessId: ID.biz, formId: GFORM.owner, fieldMappings, opportunityDefaults: { enabled: true }, actorUserId: ID.owner });
    const gformRows = async () =>
      (await db.googleFormMapping.findMany({
        where: { businessId: ID.biz },
        select: { formId: true, opportunityDefaults: true, fieldMappings: true },
      })).sort((a: any, b: any) => a.formId.localeCompare(b.formId));
    const gformsBefore = await gformRows();
    expect(gformsBefore.map((r: any) => [r.formId, r.opportunityDefaults?.configuredBy])).toEqual([
      [GFORM.member, CFG_OLD],
      [GFORM.owner, ID.owner],
    ]);

    const connectorRows = async () =>
      (await db.connectorStatus.findMany({
        where: { businessId: { in: [ID.biz, ID.biz2] } },
        select: { businessId: true, connectorType: true, metadata: true },
      })).sort((a: any, b: any) => `${a.businessId} ${a.connectorType}`.localeCompare(`${b.businessId} ${b.connectorType}`));
    const holding = (rows: any[], id: string) =>
      rows.flatMap((r) => pathsHolding(r.metadata, id).map((p) => `${r.businessId.slice(P.length)} ${r.connectorType} ${p}`)).sort();
    const before = await connectorRows();
    expect(holding(before, CFG_OLD)).toEqual([
      'biz google_contacts mappingRules.defaultOwnerId',
      `biz google_contacts ${RULES_CONFIGURED_BY}`,
      `biz jotform formMappings.${FORM.member}.configuredBy`,
      'biz outlook_contacts mappingRules.defaultOwnerId',
      `biz outlook_contacts ${RULES_CONFIGURED_BY}`,
      `biz typeform formMappings.${FORM.member}.configuredBy`,
    ]);

    // Step 4 names these keys and carries the statements for them.
    const step4 = docStep4();
    for (const name of ['connector_statuses.metadata', RULES_CONFIGURED_BY, 'mappingRules.defaultOwnerId', 'formMappings.<form id>.configuredBy']) {
      expect(step4, `step 4 names \`${name}\``).toContain(`\`${name}\``);
    }
    const blocks = [...step4.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.some((b) => b.includes('connector_statuses')), 'step 4 carries a sql block for connector_statuses').toBe(true);
    expect(step4, 'step 4 names `google_form_mappings.opportunity_defaults`').toContain('`google_form_mappings.opportunity_defaults`');
    expect(blocks.some((b) => b.includes('google_form_mappings')), 'step 4 carries a sql block for google_form_mappings').toBe(true);

    // Step 4 as written, in its order: free the address, create the new row, re-point (the column this
    // member has, then every statement step 4 gives), delete the old row.
    await db.user.update({ where: { id: CFG_OLD }, data: { email: `${P}cfg_parked@local.invalid` } });
    await db.user.create({ data: { id: CFG_NEW, email: CFG_EMAIL, role: 'USER' } });
    await db.membership.updateMany({ where: { userId: CFG_OLD }, data: { userId: CFG_NEW } });
    for (const block of blocks) {
      for (const statement of block.split(';').map(squash).filter(Boolean)) {
        await db.$executeRawUnsafe(statement.split("'<old id>'").join(`'${CFG_OLD}'`).split("'<new id>'").join(`'${CFG_NEW}'`));
      }
    }
    await db.user.delete({ where: { id: CFG_OLD } });

    const after = await connectorRows();
    expect(holding(after, CFG_OLD), 'no connector row still names the deleted id').toEqual([]);
    expect(after).toEqual(before.map((r: any) => ({ ...r, metadata: replacingId(r.metadata, CFG_OLD, CFG_NEW) })));
    const gformsAfter = await gformRows();
    expect(gformsAfter, 'the Google Forms mapping names the new id; the owner mapping and every other value as they were').toEqual(
      gformsBefore.map((r: any) => ({ ...r, opportunityDefaults: replacingId(r.opportunityDefaults, CFG_OLD, CFG_NEW) })),
    );

    // The runs the configuration binds: a system run, the member's own run and the owner's run.
    const crm = {
      assertCanCreateContacts: (businessId: string, member: string) =>
        (CrmService.prototype as any).assertCanCreateContacts.call({ prisma }, businessId, member),
    } as any;
    const metadataOf = (connectorType: string) => after.find((r: any) => r.businessId === ID.biz && r.connectorType === connectorType).metadata;
    const configured: Array<[string, unknown]> = [
      ['google_contacts', metadataOf('google_contacts')[RULES_CONFIGURED_BY]],
      ['outlook_contacts', metadataOf('outlook_contacts')[RULES_CONFIGURED_BY]],
      ['typeform', metadataOf('typeform').formMappings[FORM.member].configuredBy],
      ['jotform', metadataOf('jotform').formMappings[FORM.member].configuredBy],
      ['google_forms', gformsAfter.find((r: any) => r.formId === GFORM.member).opportunityDefaults.configuredBy],
    ];
    for (const [connector, configuredBy] of configured) {
      const runs = {
        system: await syncPrincipals(prisma, ID.biz, configuredBy),
        member: await runWithTenant(ID.biz, CFG_NEW, () => syncPrincipals(prisma, ID.biz, configuredBy)),
        owner: await runWithTenant(ID.biz, ID.owner, () => syncPrincipals(prisma, ID.biz, configuredBy)),
      };
      expect(Object.fromEntries(Object.entries(runs).map(([run, p]) => [run, p.members])), connector).toEqual({
        system: [CFG_NEW],
        member: [CFG_NEW],
        owner: [ID.owner, CFG_NEW],
      });
      for (const [run, p] of Object.entries(runs)) {
        expect(await membersMayCreateContacts(crm, ID.biz, p.members), `${connector} ${run} run may create contacts`).toBe(true);
      }
    }
    for (const connector of ['google_contacts', 'outlook_contacts']) {
      expect(await memberDefaultOwnerId(prisma, ID.biz, metadataOf(connector).mappingRules.defaultOwnerId), connector).toBe(CFG_NEW);
    }
  });
});
