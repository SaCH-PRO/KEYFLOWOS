/**
 * The customer's allowance pays for the customer's AI, and nothing else.
 *
 * WHAT THIS IS ABOUT, measured on production 2026-08-10: 243 credits consumed
 * in a month against a FREE allowance of 10, of which **184 were
 * `semantic_embedding`** — vectors written whenever a memory is stored. Nobody
 * asked for them. KEYFLOW's own indexing spent 76% of the owner's allowance and
 * then locked them out of every AI feature, including the ones they paid for.
 *
 * The limiter was working perfectly. It was counting the wrong pool. That is
 * why the tests below are mostly about WHAT IS COUNTED rather than about
 * whether the counting works.
 *
 * Runs against a real Postgres: the allowance is a SQL aggregate with a
 * `billable` predicate, and a mock cannot disagree with you about a WHERE
 * clause it does not have.
 */
import 'reflect-metadata';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  AI_CREDIT_COSTS,
  SYSTEM_AI_FEATURES,
  UNPRICED_ACKNOWLEDGED,
  isBillableAiFeature,
  PLANS,
} from '../src/modules/subscriptions/plans';
import { FEATURE_TASK_MAP } from '../src/modules/ai/ai-usage.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require('@keyflow/db') as typeof import('@keyflow/db');

const P = 'zz_credit_';
const BIZ = `${P}biz`;
const OWNER = `${P}owner`;

async function seedUsage(feature: string, credits: number, billable: boolean) {
  await db.aiUsageLog.create({
    data: {
      businessId: BIZ,
      feature,
      creditsUsed: credits,
      billable,
      taskCategory: 'general',
      totalTokens: 10,
    },
  });
}

/** The allowance query, exactly as checkCredits computes it. */
async function billableCreditsThisMonth(): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const agg = await db.aiUsageLog.aggregate({
    where: { businessId: BIZ, createdAt: { gte: startOfMonth }, billable: true },
    _sum: { creditsUsed: true },
  });
  return agg._sum.creditsUsed ?? 0;
}

describe('AI credit billing — what counts against the allowance', () => {
  beforeAll(async () => {
    await db.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: `${P}o@example.test`, name: 'Credit Owner' },
    });
    await db.business.upsert({
      where: { id: BIZ },
      update: {},
      create: { id: BIZ, name: 'Credit Biz', slug: BIZ, ownerId: OWNER },
    });
  });

  afterAll(async () => {
    await db.aiUsageLog.deleteMany({ where: { businessId: BIZ } });
    // Business and User are soft-deleted, so deleteMany would leave the rows
    // for the next run's upsert to match. Raw SQL runs under the extension.
    for (const sql of [
      `DELETE FROM businesses WHERE id = '${BIZ}'`,
      `DELETE FROM users WHERE id = '${OWNER}'`,
    ]) {
      await db.$executeRawUnsafe(sql);
    }
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.aiUsageLog.deleteMany({ where: { businessId: BIZ } });
  });

  it('system work is recorded but does not spend the allowance', async () => {
    // The exact production shape: a pile of embeddings and a couple of real
    // user actions.
    for (let i = 0; i < 50; i++) await seedUsage('semantic_embedding', 1, false);
    await seedUsage('flow_chat_stream', 2, true);

    expect(await billableCreditsThisMonth()).toBe(2);

    const all = await db.aiUsageLog.count({ where: { businessId: BIZ } });
    expect(all, 'system usage must still be RECORDED — cost visibility is the point').toBe(51);
    // CONTROL: drop `billable: true` from the aggregate and this reads 52.
  });

  it('a month of production-shaped usage no longer exhausts the FREE plan', async () => {
    // 184 embeddings + 59 billable credits — the real August numbers.
    for (let i = 0; i < 184; i++) await seedUsage('semantic_embedding', 1, false);
    await seedUsage('growth_insight', 27, true);
    await seedUsage('audio_tts', 21, true);
    await seedUsage('flow_chat_stream', 6, true);
    await seedUsage('genome_extraction', 3, false);
    await seedUsage('revenue_briefing', 2, true);

    const billable = await billableCreditsThisMonth();
    expect(billable).toBe(56);
    expect(
      billable,
      'the month that locked production out must now fit inside FREE',
    ).toBeLessThan(PLANS.FREE.limits.aiCreditsPerMonth);
  });

  it('billable usage still accumulates and can still exhaust a plan', async () => {
    // The fix must not become "nothing is ever counted".
    await seedUsage('flow_chat_stream', PLANS.FREE.limits.aiCreditsPerMonth + 1, true);
    expect(await billableCreditsThisMonth()).toBeGreaterThan(
      PLANS.FREE.limits.aiCreditsPerMonth,
    );
  });
});

describe('the classification is honest', () => {
  it('every system feature names a real, costed feature', () => {
    // The ghost-name class, exactly as the tenant ledger found it: a set
    // consulted by string against a table nobody diffs it with. A typo here
    // silently bills something that was meant to be free, and nothing fails.
    const ghosts = [...SYSTEM_AI_FEATURES].filter((f) => !(f in AI_CREDIT_COSTS));
    expect(
      ghosts,
      'these name no feature in AI_CREDIT_COSTS, so they exempt nothing',
    ).toEqual([]);
  });

  it('the migration backfill lists exactly the same features', () => {
    // The backfill is what unlocked production. If someone adds a feature to
    // SYSTEM_AI_FEATURES later and forgets the historical rows, the code and
    // the data disagree about the same month — and the disagreement is
    // invisible, because both look internally consistent.
    const sql = readFileSync(
      path.join(
        __dirname,
        '../../../packages/db/prisma/migrations/20260811030000_ai_usage_billable/migration.sql',
      ),
      'utf8',
    );
    // Hyphens matter: the cortex features are named `reflection-rank`, and a
    // [a-z_]+ pattern silently skipped every one of them — which would have
    // made this comparison pass while the code and the backfill disagreed
    // about sixteen features. The check that compares two lists is worth
    // nothing if its own reader cannot see half of one.
    const inSql = new Set([...sql.matchAll(/^\s*'([a-z_-]+)'/gm)].map((m) => m[1]));
    expect([...SYSTEM_AI_FEATURES].sort()).toEqual([...inSql].sort());
  });

  it('every feature the product actually bills has a declared price', async () => {
    // The gap this found on its first run. Three features live in production —
    // genome_extraction, financial_weekly_briefing, revenue_briefing — were
    // absent from AI_CREDIT_COSTS and therefore billed at the
    // `AI_CREDIT_COSTS[feature] || 1` fallback: a rate nobody chose, on a table
    // that looked complete. Same shape as the tenant ledger's ghost names, one
    // table over.
    //
    // Reads the features REALLY RECORDED rather than a hand-kept list, because
    // a hand-kept list is the thing that drifts.
    const seen = await db.aiUsageLog.groupBy({ by: ['feature'], _count: { _all: true } });
    const unpriced = seen
      .map((r) => r.feature)
      .filter((f) => !(f in AI_CREDIT_COSTS) && !UNPRICED_ACKNOWLEDGED.has(f));
    expect(
      unpriced,
      'these features are recorded but have no entry in AI_CREDIT_COSTS and are not ' +
        'on the acknowledged ledger, so they are charged at the ||1 fallback rather ' +
        'than a price anyone decided. Price them, or add them to ' +
        'UNPRICED_ACKNOWLEDGED with the understanding that the list may only shrink.',
    ).toEqual([]);
  });

  it('no NEW feature can be added to the product without a price decision', () => {
    // The ratchet, and the reason the ledger exists. Every feature the product
    // knows how to bill (FEATURE_TASK_MAP) must either have a declared price or
    // be on the acknowledged list. Today 56 were unpriced and nothing said so —
    // they were simply charged 1 credit each, forever, at a rate nobody chose.
    const undecided = Object.keys(FEATURE_TASK_MAP).filter(
      (f) => !(f in AI_CREDIT_COSTS) && !UNPRICED_ACKNOWLEDGED.has(f),
    );
    expect(
      undecided,
      'A feature absent from AI_CREDIT_COSTS is silently billed at 1 credit. ' +
        'Give it a price, or acknowledge it — do not let it default.',
    ).toEqual([]);
  });

  it('the acknowledged ledger may only shrink', () => {
    // Deliberately NOT asserting membership of FEATURE_TASK_MAP, because
    // FEATURE_TASK_MAP is not the universe of features. Written that way first,
    // and it failed on three that are demonstrably real — flow_seo_remediation,
    // flow_draft_ticket_reply and crm_conversation_analyze all appear in the
    // usage table and in none of the maps.
    //
    // That is a finding in its own right rather than a flaw in this test: a
    // feature absent from FEATURE_TASK_MAP resolves to the 'general' task
    // category, which the balanced routing table points at the most expensive
    // model available. So those three are billed at the top model rate AND at
    // the ||1 credit fallback, neither of which anyone chose. Recorded here
    // because this is where it surfaced; fixing it belongs with whoever owns
    // ai-usage-feature-coverage.spec.ts.
    const both = [...UNPRICED_ACKNOWLEDGED].filter((f) => f in AI_CREDIT_COSTS);
    expect(both, 'priced features must leave the unpriced ledger — it only shrinks').toEqual([]);
  });

  it('the default is BILLABLE — a new feature cannot become free by omission', () => {
    expect(isBillableAiFeature('some_brand_new_feature')).toBe(true);
    expect(isBillableAiFeature('flow_chat_stream')).toBe(true);
    expect(isBillableAiFeature('semantic_embedding')).toBe(false);
  });

  it('the free tier can complete a real first session', () => {
    // The calibration test. FREE was 10 credits with an embedding at 1 credit,
    // so saving a handful of notes exhausted the plan before the owner had
    // asked KEY a single question. A free tier nobody can finish a session on
    // is a broken signup, not a pricing strategy.
    const chat = AI_CREDIT_COSTS.flow_chat_stream ?? 2;
    const sessions = Math.floor(PLANS.FREE.limits.aiCreditsPerMonth / chat);
    expect(sessions, 'FREE must afford a meaningful number of chat turns').toBeGreaterThanOrEqual(50);
    expect(PLANS.FLOW.limits.aiCreditsPerMonth).toBeGreaterThan(
      PLANS.FREE.limits.aiCreditsPerMonth,
    );
    expect(PLANS.KEYFLOW.limits.aiCreditsPerMonth).toBe(-1);
  });
});

describe('every AI path is gated or declared', () => {
  const src = readFileSync(
    path.join(__dirname, '../src/modules/ai/ai-usage.service.ts'),
    'utf8',
  );

  it('the credit check exists in exactly one place', () => {
    // Six identical check-and-throw blocks were collapsed into
    // assertCreditsFor. They were identical, which is why they were worth
    // collapsing: the system-work exemption had to be added in six places or
    // none, and "or none" is how a rule ends up true on five of six paths.
    expect(src).toMatch(/async assertCreditsFor\(/);
    expect(
      (src.match(/AI credit limit reached/g) ?? []).length,
      'the refusal message should exist once, in the helper',
    ).toBe(1);
  });

  it('system work is exempted from the CHECK, not merely from the count', () => {
    // Excluding indexing from the allowance while still blocking it on that
    // allowance would be the worst of both: the customer is not charged, and
    // their search index quietly stops updating when they run out of credits.
    const fn = src.slice(src.indexOf('async assertCreditsFor('));
    const body = fn.slice(0, fn.indexOf('\n  async '));
    expect(body).toMatch(/isBillableAiFeature\(feature\)/);
    expect(body).toMatch(/return;/);
  });

  it('usage is classified at the single write site', () => {
    const fn = src.slice(src.indexOf('private async persistUsageLog('));
    const body = fn.slice(0, fn.indexOf('\n  private ') > 0 ? fn.indexOf('\n  private ') : 4000);
    expect(
      body,
      'classifying per-caller means a new feature lands in the wrong pool the ' +
        'first time someone forgets',
    ).toMatch(/isBillableAiFeature\(data\.feature\)/);
  });
});
