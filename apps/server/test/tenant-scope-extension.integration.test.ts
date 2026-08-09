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
});
