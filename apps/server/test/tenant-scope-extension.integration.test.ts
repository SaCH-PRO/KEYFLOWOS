/**
 * The tenant extension, exercised against a REAL database.
 *
 * Nothing here is mocked: the extended client, the AsyncLocalStorage context,
 * the injected where-clause and the DB constraints are all real. Two things
 * made this worth writing rather than arguing:
 *
 *  1. Every claim about the extension that was ARGUED today turned out to have
 *     an exception; every claim that was EXECUTED held. The escape hatch had
 *     been documented and broken since the day it was written, and nobody found
 *     out because nothing ran it.
 *
 *  2. Prisma ACCEPTS an extra scalar in a WhereUniqueInput instead of rejecting
 *     it, so a wrongly-scoped lookup fails SILENTLY (null) or misleadingly
 *     (P2025 "record not found"). Neither reads as an isolation bug, so a
 *     regression here would be triaged as a data problem for as long as it took
 *     someone to disbelieve the error message.
 *
 * Requires DATABASE_URL. CI supplies pgvector/pgvector:pg16 + db:deploy.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db, setTenantContextProvider } = require('@keyflow/db') as typeof import('@keyflow/db');

const P = 'zz_tse_';
const BIZ_A = `${P}bizA`;
const BIZ_B = `${P}bizB`;
const OWNER = `${P}owner`;

/** Stand-in for TenantInterceptor's AsyncLocalStorage, without an HTTP request. */
let ambient: string | undefined;
setTenantContextProvider({ getCurrentBusinessId: () => ambient });

function asTenant<T>(businessId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = ambient;
  ambient = businessId;
  return fn().finally(() => {
    ambient = prev;
  });
}

describe('tenant isolation extension (real database)', () => {
  beforeAll(async () => {
    ambient = undefined;
    await db.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: `${P}owner@example.test`, name: 'TSE Owner' },
    });
    for (const [id, name] of [[BIZ_A, 'TSE A'], [BIZ_B, 'TSE B']] as const) {
      await db.business.upsert({
        where: { id },
        update: {},
        create: { id, name, slug: id, ownerId: OWNER },
      });
    }
    // One tax rate per business. TaxRate joined BUSINESS_ID_MODELS in this change.
    for (const [id, biz] of [[`${P}rateA`, BIZ_A], [`${P}rateB`, BIZ_B]] as const) {
      await db.taxRate.upsert({
        where: { id },
        update: {},
        create: { id, businessId: biz, name: `${id}-name`, rate: 10 },
      });
    }
  });

  afterAll(async () => {
    ambient = undefined;
    // Business is in the soft-delete extension's model list
    // (packages/db/src/client.ts:19-34), so `db.business.deleteMany` becomes an
    // UPDATE setting deletedAt — the cleanup reports success and the row
    // survives. Measured: zz_tse_bizA and zz_tse_bizB were both still present
    // with deleted_at set. Raw SQL runs underneath the extension, which is what
    // the other integration suites here already do.
    for (const sql of [
      `DELETE FROM flow_sessions WHERE id LIKE '${P}%'`,
      `DELETE FROM tax_rates WHERE id LIKE '${P}%'`,
      `DELETE FROM businesses WHERE id LIKE '${P}%'`,
      `DELETE FROM users WHERE id LIKE '${P}%'`,
    ]) {
      try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
    }
    await db.$disconnect();
  });

  it('with no tenant context, a bare-id read crosses the boundary', async () => {
    // The negative control for every assertion below. If this ever returns null,
    // the test is proving nothing and the rest of the file is vacuous.
    const row = await asTenant(undefined, () => db.taxRate.findUnique({ where: { id: `${P}rateB` } }));
    expect(row, 'no context means no injection — this read is unscoped by design').not.toBeNull();
    expect(row!.businessId).toBe(BIZ_B);
  });

  it("under business A's context, B's row is not readable by its own id", async () => {
    const row = await asTenant(BIZ_A, () => db.taxRate.findUnique({ where: { id: `${P}rateB` } }));
    expect(row, 'the extension must have injected businessId=A, excluding B').toBeNull();
  });

  it("under business A's context, A's own row is still readable", async () => {
    const row = await asTenant(BIZ_A, () => db.taxRate.findUnique({ where: { id: `${P}rateA` } }));
    expect(row, 'scoping must not break the legitimate path').not.toBeNull();
    expect(row!.businessId).toBe(BIZ_A);
  });

  it('findMany under A returns only A', async () => {
    const rows = await asTenant(BIZ_A, () =>
      db.taxRate.findMany({ where: { id: { startsWith: P } } }),
    );
    expect(rows.map((r) => r.businessId)).toEqual([BIZ_A]);
  });

  it('a write cannot reach across the boundary', async () => {
    await expect(
      asTenant(BIZ_A, () =>
        db.taxRate.update({ where: { id: `${P}rateB` }, data: { name: 'hijacked' } }),
      ),
    ).rejects.toThrow();

    const untouched = await asTenant(undefined, () =>
      db.taxRate.findUnique({ where: { id: `${P}rateB` } }),
    );
    expect(untouched!.name).toBe(`${P}rateB-name`);
  });

  it('a caller-supplied businessId cannot widen the scope — the injection wins', async () => {
    // withTenantWhere spreads businessId LAST, so an attacker-supplied B is
    // OVERWRITTEN by the ambient A rather than ANDed with it. The query that
    // runs is businessId=A, so it returns A's rows — not zero rows, and never
    // B's. (My first version of this test asserted [] and was wrong; the
    // override is the designed behaviour and the reason BusinessGuard must
    // validate the same value the interceptor reads.)
    const rows = await asTenant(BIZ_A, () =>
      db.taxRate.findMany({ where: { businessId: BIZ_B, id: { startsWith: P } } }),
    );
    expect(rows.map((r) => r.businessId), 'B must not appear').not.toContain(BIZ_B);
    expect(rows.map((r) => r.businessId)).toEqual([BIZ_A]);
  });

  /**
   * The five operations the extension does NOT hook.
   *
   * client.ts:238-240 says so in a comment — "create, createMany, upsert,
   * aggregate and groupBy are not hooked, so this extension cannot scope them —
   * do not reason as though it can." These tests turn that comment into a
   * measurement, because a comment cannot fail.
   *
   * Counted in apps/server/src on 2026-08-09: upsert 154 call sites, aggregate
   * 165, groupBy 100, createMany 22. Widening BUSINESS_ID_MODELS does nothing
   * for any of them — the models are already in the set, the operations are not
   * in the extension.
   */
  describe('operations the extension does not hook', () => {
    it('upsert under A cannot reach B\'s row by its bare id', async () => {
      await asTenant(BIZ_A, () =>
        db.taxRate.upsert({
          where: { id: `${P}rateB` },
          update: { name: 'hijacked-by-upsert' },
          create: { id: `${P}rateB`, businessId: BIZ_A, name: 'created', rate: 1 },
        }),
      ).catch(() => undefined); // a throw is an acceptable outcome; a write is not

      const row = await asTenant(undefined, () =>
        db.taxRate.findUnique({ where: { id: `${P}rateB` } }),
      );
      // The assertion is on B's ROW, not on whether the call threw. An upsert
      // that throws after writing would still have corrupted B.
      // Restore before asserting, so a RED run does not cascade into the tests
      // below — they read B's name too, and a corrupted fixture would report
      // four failures for one defect.
      const observed = { name: row!.name, businessId: row!.businessId };
      await asTenant(undefined, () =>
        db.taxRate.update({ where: { id: `${P}rateB` }, data: { name: `${P}rateB-name` } }),
      ).catch(() => undefined);

      expect(observed.name, "business A rewrote B's row through upsert").toBe(`${P}rateB-name`);
      expect(observed.businessId, "B's row changed tenant").toBe(BIZ_B);
    });

    it('upsert under A still updates A\'s own row', async () => {
      // Negative control. Without it the test above also passes against an
      // extension that breaks upsert entirely.
      await asTenant(BIZ_A, () =>
        db.taxRate.upsert({
          where: { id: `${P}rateA` },
          update: { name: `${P}rateA-updated` },
          create: { id: `${P}rateA`, businessId: BIZ_A, name: 'created', rate: 1 },
        }),
      );

      const row = await asTenant(undefined, () =>
        db.taxRate.findUnique({ where: { id: `${P}rateA` } }),
      );
      expect(row!.name).toBe(`${P}rateA-updated`);

      // restore, so ordering between tests cannot matter
      await asTenant(undefined, () =>
        db.taxRate.update({ where: { id: `${P}rateA` }, data: { name: `${P}rateA-name` } }),
      );
    });

    it('aggregate under A does not sum B\'s rows', async () => {
      const agg = await asTenant(BIZ_A, () =>
        db.taxRate.aggregate({
          where: { id: { startsWith: P } },
          _count: { _all: true },
        }),
      );
      expect(agg._count._all, 'the aggregate counted both businesses').toBe(1);
    });

    it('groupBy under A does not return B\'s group', async () => {
      const groups = await asTenant(BIZ_A, () =>
        db.taxRate.groupBy({
          by: ['businessId'],
          where: { id: { startsWith: P } },
        }),
      );
      expect(groups.map((g) => g.businessId), 'B appeared in the grouping').toEqual([BIZ_A]);
    });

    it('create under A cannot plant a row in B', async () => {
      const planted = `${P}planted`;
      // No .catch() and no `?? BIZ_A` fallback. The first version of this test
      // had both, and it would have passed if the create had simply thrown or
      // never happened — asserting nothing about isolation. A test that passes
      // when the operation does not occur is the failure mode this whole file
      // exists to catch.
      await asTenant(BIZ_A, () =>
        db.taxRate.create({
          data: { id: planted, businessId: BIZ_B, name: 'planted', rate: 1 },
        }),
      );

      const row = await asTenant(undefined, () =>
        db.taxRate.findUnique({ where: { id: planted } }),
      );
      // Remove it before asserting — otherwise a red run leaves a third row
      // behind and the __skipTenantIsolation test below fails for the wrong
      // reason. (It did, the first time this ran.)
      const landedIn = row?.businessId;
      await db.$executeRawUnsafe(`DELETE FROM tax_rates WHERE id = '${planted}'`).catch(() => undefined);

      expect(landedIn, 'the row was never created — this test proved nothing').toBeTruthy();
      expect(landedIn, 'A created a row inside B').toBe(BIZ_A);
    });
  });

  describe('__skipTenantIsolation', () => {
    it('reaches across businesses, which is the whole point', async () => {
      const rows = await asTenant(BIZ_A, () =>
        db.taxRate.findMany({
          where: { id: { startsWith: P } },
          __skipTenantIsolation: true,
        } as Parameters<typeof db.taxRate.findMany>[0]),
      );
      expect(rows.map((r) => r.businessId).sort()).toEqual([BIZ_A, BIZ_B]);
    });

    it('does not leak the marker into Prisma on a SCOPED model', async () => {
      // The regression that shipped: the flag was forwarded to the query engine,
      // which rejects unknown top-level arguments.
      await expect(
        asTenant(BIZ_A, () =>
          db.taxRate.findMany({
            where: { id: { startsWith: P } },
            __skipTenantIsolation: true,
          } as Parameters<typeof db.taxRate.findMany>[0]),
        ),
      ).resolves.toBeDefined();
    });

    it('does not leak the marker on an UNSCOPED model either', async () => {
      // The path that made the original bug unconditional: with no context the
      // extension returned args untouched, flag included.
      await expect(
        asTenant(undefined, () =>
          db.business.findMany({
            where: { id: { startsWith: P } },
            __skipTenantIsolation: true,
          } as Parameters<typeof db.business.findMany>[0]),
        ),
      ).resolves.toBeDefined();
    });
  });

  it('every model in the set is a real model with a businessId column', async () => {
    // tenant-model-list.spec.ts asserts this statically. This asserts the
    // generated client agrees, which is what actually throws at runtime.
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../packages/db/src/client.ts'),
      'utf8',
    );
    const at = src.indexOf('const BUSINESS_ID_MODELS = new Set([');
    const body = src.slice(at, src.indexOf(']);', at));
    const listed = [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(70);

    const broken: string[] = [];
    for (const name of listed) {
      const prop = name[0].toLowerCase() + name.slice(1);
      const delegate = (db as unknown as Record<string, { findMany?: (a: unknown) => Promise<unknown> }>)[prop];
      if (!delegate?.findMany) {
        broken.push(`${name} -> no delegate db.${prop}`);
        continue;
      }
      try {
        await delegate.findMany({ where: { businessId: 'zz_tse_nobody' }, take: 1 });
      } catch (e) {
        broken.push(`${name} -> ${(e as Error).message.split('\n').pop()?.trim()}`);
      }
    }
    expect(broken, 'these cannot accept a businessId filter and will throw in production').toEqual([]);
  });

  /**
   * The batch scoped on 2026-08-30, proved at the layer that enforces it.
   *
   * FlowSession is the concrete reason the batch exists. Its service addressed
   * a row by a primary key the CLIENT chose, and every client that pins a
   * conversation sends the same literal "onboarding" — so one row was shared by
   * every user in every business, and a brand-new user's first onboarding
   * message overwrote a stranger's.
   *
   * That is fixed in flow-orchestrator.service.ts by deriving the key from the
   * tenant. These assertions are the SECOND layer, and they matter precisely
   * because the first one is a convention a future edit can quietly drop: they
   * use a BARE id, the shape the old code used, and require the database to
   * refuse it whatever the service believes.
   */
  describe('the models scoped on 2026-08-30', () => {
    const SESS_A = `${P}sessA`;
    const SESS_B = `${P}sessB`;

    beforeAll(async () => {
      ambient = undefined;
      for (const [id, biz] of [[SESS_A, BIZ_A], [SESS_B, BIZ_B]] as const) {
        await db.flowSession.upsert({
          where: { id },
          update: { messages: [{ role: 'user', content: `${id}-original` }] },
          create: { id, businessId: biz, userId: OWNER, messages: [{ role: 'user', content: `${id}-original` }] },
        });
      }
    });

    it('with no tenant context a bare-id read still crosses — the control', async () => {
      // Without this, every assertion below could pass on a row that simply
      // is not there.
      const row = await asTenant(undefined, () => db.flowSession.findUnique({ where: { id: SESS_B } }));
      expect(row, 'no context means no injection').not.toBeNull();
      expect(row!.businessId).toBe(BIZ_B);
    });

    it("under A, B's conversation is not readable by its bare id", async () => {
      const row = await asTenant(BIZ_A, () => db.flowSession.findUnique({ where: { id: SESS_B } }));
      expect(row, 'a conversation is the most private thing KEY holds').toBeNull();
    });

    it('under A, its own conversation is still readable', async () => {
      const row = await asTenant(BIZ_A, () => db.flowSession.findUnique({ where: { id: SESS_A } }));
      expect(row, 'scoping must not break the legitimate path').not.toBeNull();
    });

    it("under A, an upsert cannot overwrite B's conversation — the original bug", async () => {
      // The exact operation and the exact shape that leaked: upsert addressed
      // by a bare id the caller chose.
      await asTenant(BIZ_A, () =>
        db.flowSession.upsert({
          where: { id: SESS_B },
          update: { messages: [{ role: 'user', content: 'hijacked' }] },
          create: { id: SESS_B, businessId: BIZ_A, userId: OWNER, messages: [] },
        }),
      ).catch(() => undefined);

      const b = await asTenant(undefined, () => db.flowSession.findUnique({ where: { id: SESS_B } }));
      expect(b!.businessId, 'the row must still belong to B').toBe(BIZ_B);
      expect(JSON.stringify(b!.messages), "B's conversation must be untouched").toContain('-original');
    });

    it('under A, a create cannot plant a conversation inside B', async () => {
      const planted = `${P}sessPlant`;
      await asTenant(BIZ_A, () =>
        db.flowSession.create({
          data: { id: planted, businessId: BIZ_B, userId: OWNER, messages: [] },
        }),
      ).catch(() => undefined);

      const row = await asTenant(undefined, () => db.flowSession.findUnique({ where: { id: planted } }));
      if (row) expect(row.businessId, 'the row lands in the caller tenant, not the one it named').toBe(BIZ_A);
    });

    it('the deliberately cross-tenant models are NOT scoped', async () => {
      // ApiKey resolves a caller BY the key and derives the tenant from the row;
      // BusinessReputation counts across every business to compute a rank.
      // Scoping either does not harden it, it deletes the feature and leaves a
      // silent null or a permanent "rank 1 of 1" in its place.
      const { default: fs } = await import('node:fs');
      const client = fs.readFileSync(
        path.resolve(__dirname, '../../../packages/db/src/client.ts'),
        'utf8',
      );
      const set = client.slice(
        client.indexOf('const BUSINESS_ID_MODELS = new Set(['),
        client.indexOf(']);', client.indexOf('const BUSINESS_ID_MODELS = new Set([')),
      );
      for (const m of [
        'ApiKey', 'BusinessReputation', 'ContactExportJob', 'MarketplaceOrder',
        'Payment', 'VoiceSession', 'WebhookEvent',
      ]) {
        expect(set, `${m} must never be tenant-scoped`).not.toContain(`'${m}'`);
      }
    });

    it('the other six are scoped too, by the same mechanism', async () => {
      // Named individually so removing one from the set fails here rather than
      // silently reducing what this file covers.
      const { default: fs } = await import('node:fs');
      const client = fs.readFileSync(
        path.resolve(__dirname, '../../../packages/db/src/client.ts'),
        'utf8',
      );
      const set = client.slice(
        client.indexOf('const BUSINESS_ID_MODELS = new Set(['),
        client.indexOf(']);', client.indexOf('const BUSINESS_ID_MODELS = new Set([')),
      );
      for (const m of [
        // 2026-08-30, first pass
        'AuthorityGrant', 'CampaignBriefing', 'CognitionSession',
        'ContactInsightSnapshot', 'FlowSession', 'PresenceInsightSnapshot',
        'ValueConstraint',
        // second pass
        'AiMemory', 'CalendarSyncConflict', 'ConversationAIInsight',
        'IntegrationSyncRun', 'PromoCode',
        // third pass
        'ContactChannelStat', 'GenomeDepartment', 'GenomeGrowthChannel',
        'SeoKeyword', 'SeoPage',
      ]) {
        expect(set, `${m} left BUSINESS_ID_MODELS`).toContain(`'${m}'`);
      }
    });
  });
});
