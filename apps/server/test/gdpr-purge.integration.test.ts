/**
 * GDPR erasure, against a real database.
 *
 * WHAT THIS REPLACED
 *
 * The endpoint returned "Business data purged per GDPR request." after setting
 * `deletedAt` on seven models and nulling six columns on Business. Nothing was
 * erased. The tenant set covers 302 models; messages, call logs, documents,
 * bank transactions and cortex memories kept their personal data, and the rows
 * it did touch kept theirs behind a flag.
 *
 * WHY THIS TEST CANNOT BE MOCKED
 *
 * The erasure is performed BY POSTGRES, through 267 `ON DELETE CASCADE`
 * constraints. A mocked Prisma would prove that a DELETE statement was issued
 * and nothing at all about whether the child rows went with it — which is the
 * only question worth asking. The seven models that do NOT cascade are exactly
 * the ones a mock would hide.
 *
 * So this seeds a real business with rows on both sides of that divide, purges
 * it, and then counts every table in the schema that has a business_id column.
 *
 * Requires DATABASE_URL. CI supplies pgvector/pgvector:pg16 + db:deploy.
 */
import 'reflect-metadata';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GdprPurgeService } from '../src/modules/admin-platform/gdpr-purge.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db, setTenantContextProvider } = require('@keyflow/db') as typeof import('@keyflow/db');

// No ambient tenant: this runs from an admin route, and the seeding below must
// not be scoped by the isolation extension.
setTenantContextProvider({ getCurrentBusinessId: () => undefined });

const P = 'zz_gdpr_';
const BIZ = `${P}biz`;
const KEEP = `${P}keep`; // a second business that must survive untouched
const OWNER = `${P}owner`;
const CONTACT = `${P}contact`;
const KEEP_CONTACT = `${P}keepcontact`;

const service = new GdprPurgeService({ client: db } as unknown as PrismaService);

async function countFor(businessId: string, table: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE business_id = $1`,
    businessId,
  );
  return Number(rows[0].count);
}

describe('GDPR erasure (real database)', () => {
  beforeAll(async () => {
    for (const sql of [
      `DELETE FROM contacts WHERE id LIKE '${P}%'`,
      `DELETE FROM businesses WHERE id LIKE '${P}%'`,
      `DELETE FROM users WHERE id LIKE '${P}%'`,
    ]) {
      try { await db.$executeRawUnsafe(sql); } catch { /* first run */ }
    }

    await db.user.create({ data: { id: OWNER, email: `${P}o@example.test`, name: 'GDPR Owner' } });
    await db.business.create({ data: { id: BIZ, name: 'To Erase', slug: BIZ, ownerId: OWNER } });
    await db.business.create({ data: { id: KEEP, name: 'To Keep', slug: KEEP, ownerId: OWNER } });

    // A cascading model (Contact declares onDelete: Cascade).
    await db.contact.create({
      data: { id: CONTACT, businessId: BIZ, firstName: 'Ada', lastName: 'L', email: `${P}a@example.test` },
    });
    // The same, on the business that must survive.
    await db.contact.create({
      data: { id: KEEP_CONTACT, businessId: KEEP, firstName: 'Grace', lastName: 'H', email: `${P}g@example.test` },
    });
    // A NON-cascading model — this is what would abort the delete if the
    // service did not clear it first.
    await db.$executeRawUnsafe(
      `INSERT INTO webhooks (id, business_id, name, url, events, is_active, secret, created_at, updated_at)
       VALUES ($1, $2, 'gdpr probe', 'https://example.test/hook', ARRAY['x'], true, 'shh', now(), now())`,
      `${P}webhook`,
      BIZ,
    );
  }, 60_000);

  afterAll(async () => {
    for (const sql of [
      `DELETE FROM webhooks WHERE id LIKE '${P}%'`,
      `DELETE FROM contacts WHERE id LIKE '${P}%'`,
      `DELETE FROM businesses WHERE id LIKE '${P}%'`,
      `DELETE FROM users WHERE id LIKE '${P}%'`,
    ]) {
      try { await db.$executeRawUnsafe(sql); } catch { /* best effort */ }
    }
    await db.$disconnect();
  });

  it('the fixture is real before anything is erased', async () => {
    // Negative control for the whole file. If the seed silently did nothing,
    // every assertion below passes against an empty business and proves that
    // erasing nothing erases everything.
    expect(await countFor(BIZ, 'contacts'), 'the seeded contact is missing').toBe(1);
    expect(await countFor(BIZ, 'webhooks'), 'the seeded webhook is missing').toBe(1);
  }, 60_000);

  it('erases the business and everything belonging to it', async () => {
    const result = await service.purgeBusiness(BIZ);

    expect(result.erased).toBe(true);
    expect(result.businessId).toBe(BIZ);
    // It scanned the schema rather than a list someone wrote down.
    expect(result.tablesScanned, 'the table scan found almost nothing').toBeGreaterThan(100);
    expect(result.rowsBefore, 'it reported erasing nothing').toBeGreaterThanOrEqual(2);
    // The webhook is the non-cascading case; it must show up as cleared
    // explicitly, because the cascade could never have taken it.
    expect(result.blockersCleared.webhooks).toBe(1);
  }, 120_000);

  it('leaves no row behind in any table carrying a business_id', async () => {
    const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'business_id'
          AND t.table_type = 'BASE TABLE'`,
    );
    expect(tables.length, 'the schema scan broke').toBeGreaterThan(100);

    const survivors: string[] = [];
    for (const { table_name } of tables) {
      if ((await countFor(BIZ, table_name)) > 0) survivors.push(table_name);
    }
    expect(survivors, 'these tables still hold data for an erased business').toEqual([]);
  }, 120_000);

  it('the business row itself is gone, not flagged', async () => {
    // Raw SQL on purpose. Business is registered with the soft-delete
    // extension, so `db.business.findUnique` hides a soft-deleted row and would
    // report the OLD implementation as a success.
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE id = $1`,
      BIZ,
    );
    expect(rows, 'the business row survived the erasure').toEqual([]);
  }, 60_000);

  it('does not touch any other business', async () => {
    // The assertion that stops a purge from being a truncate.
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE id = $1`,
      KEEP,
    );
    expect(rows.length, 'the other business was erased too').toBe(1);
    expect(await countFor(KEEP, 'contacts'), "the other business's contact was erased").toBe(1);
  }, 60_000);

  it('refuses an id that does not exist rather than reporting success', async () => {
    await expect(service.purgeBusiness('zz_gdpr_nobody')).rejects.toThrow(/not found/i);
  }, 60_000);
});

describe('the non-cascading list matches the schema', () => {
  it('names exactly the models that would block the cascade', () => {
    // The service clears seven tables by name before deleting the business. If
    // a new model is added without onDelete: Cascade, the cascade aborts and
    // erasure fails — so the list has to be checked against the schema rather
    // than trusted.
    const schema = readFileSync(
      path.resolve(__dirname, '../../../packages/db/prisma/schema.prisma'),
      'utf8',
    );

    const blocking: string[] = [];
    for (const [, model, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const rel = /^\s*business\s+Business\s+@relation\(([^)]*)\)/m.exec(body);
      if (!rel || rel[1].includes('onDelete: Cascade')) continue;
      const mapped = /@@map\("(\w+)"\)/.exec(body);
      blocking.push(mapped ? mapped[1] : model);
      void model;
    }

    const declared = readFileSync(
      path.resolve(__dirname, '../src/modules/admin-platform/gdpr-purge.service.ts'),
      'utf8',
    );
    const listed = [
      ...declared
        .slice(declared.indexOf('NON_CASCADING_TABLES'), declared.indexOf('] as const'))
        .matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);

    expect(blocking.length, 'the schema scan found no blocking models — it broke').toBeGreaterThan(0);
    expect(
      blocking.filter((t) => !listed.includes(t)),
      'these models do not cascade from Business and are NOT cleared first, so a GDPR ' +
        'erasure will abort on their foreign key. Add them to NON_CASCADING_TABLES, or ' +
        'give the relation onDelete: Cascade.',
    ).toEqual([]);
  });
});
