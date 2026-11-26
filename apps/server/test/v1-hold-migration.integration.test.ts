/**
 * V1-64 (MIGRATION-SET-A) — The v1 hold migration set (`20261120000000_v1_hold_set`),
 * authored once and proven against real PostgreSQL (owner rulings D-165, D-166, D-167).
 *
 * Proves:
 *  1. Fresh-database `prisma migrate deploy` applies `20261120000000_v1_hold_set` cleanly
 *     with zero schema drift (`prisma migrate diff --exit-code` returns 0).
 *  2. Upgrading an existing database from `20261101000000_contact_partial_identity_uniques`
 *     preserves existing integer `invoice_items.quantity` and `quote_items.quantity` values,
 *     leaves `businesses.vat_number` and `contacts.pricing_tier` NULL on existing rows, and
 *     switches both quantity columns to `double precision` so `2.5` round-trips.
 *  3. `businesses.vat_number`, `contacts.pricing_tier`, and decimal quantities (`2.5`) on
 *     `invoice_items` and `quote_items` round-trip through `@keyflow/db`.
 *  4. `product_tier_prices` enforces `UNIQUE (product_id, tier)` at the database level
 *     (`P2002` on collision, distinct products may reuse the same tier) and leaves
 *     `chart_of_accounts` without a new unique index (D-167 / SWP-COA-UNIQUE-CODE).
 *  5. `ProductTierPrice` is in `BUSINESS_ID_MODELS` (`packages/db/src/client.ts`): under
 *     business A's tenant context, `findMany`, `findFirst`, `findUnique` (by `id` and by
 *     `productId_tier`), `updateMany`, and `deleteMany` never read or mutate business B's
 *     rows, and `create` forces the active business's `businessId`.
 *
 * Fixture prefix: `v64n_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 * Throwaway databases created for fresh-DB and upgrade proofs are dropped WITH (FORCE)
 * in `afterAll`.
 */
import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join, relative, sep } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing @keyflow/db so DATABASE_URL is set.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64n_';
const REPO = path.resolve(__dirname, '../../..');
const PRISMA_DIR = join(REPO, 'packages', 'db', 'prisma');
const HOLD_MIGRATION = '20261120000000_v1_hold_set';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  prodA1: `${P}prodA1`,
  prodA2: `${P}prodA2`,
  prodB1: `${P}prodB1`,
  quoteA: `${P}quoteA`,
  quoteItemAInt: `${P}qiAInt`,
  quoteItemADec: `${P}qiADec`,
  invA: `${P}invA`,
  invItemAInt: `${P}iiAInt`,
  invItemADec: `${P}iiADec`,
  tierA1: `${P}tierA1`,
  tierA2: `${P}tierA2`,
  tierB1: `${P}tierB1`,
  tierAForced: `${P}tierAForced`,
};

const baseUrl = process.env.DATABASE_URL ?? '';
const createdDbs: string[] = [];
const scratchDirs: string[] = [];

let admin: PrismaClient;
let db: typeof import('@keyflow/db').db;
let tenant: typeof import('../src/core/tenant/tenant-context');

function urlFor(dbName: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function runPrisma(args: string[], url: string): { status: number | null; output: string } {
  const r = spawnSync('pnpm', ['--filter', '@keyflow/db', 'exec', 'prisma', ...args], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'development' },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`,
  };
}

async function createEmptyDb(label: string): Promise<{ name: string; url: string }> {
  const name = `kf_v64n_${label}_${process.pid}_${createdDbs.length + 1}`;
  createdDbs.push(name);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = urlFor(name);
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    await client.$disconnect();
  }
  return { name, url };
}

async function withDb<T>(url: string, fn: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

async function cleanupSharedFixtures(client: PrismaClient): Promise<void> {
  // Drop product_tier_prices rows if the table exists (RED state runs before migration).
  const tableCheck = await client.$queryRawUnsafe<Array<{ t: string | null }>>(
    `SELECT to_regclass('public.product_tier_prices')::text AS t`,
  );
  if (tableCheck[0]?.t) {
    await client.$executeRawUnsafe(
      `DELETE FROM product_tier_prices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    );
  }
  await client.$executeRawUnsafe(`DELETE FROM invoice_items WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM quote_items WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM quotes WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM products WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await client.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

beforeAll(async () => {
  expect(baseUrl, 'DATABASE_URL must be set for real-DB migration proof').toBeTruthy();
  admin = new PrismaClient({ datasourceUrl: baseUrl });
  await admin.$connect();

  const dbMod = await import('@keyflow/db');
  tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => tenant.getCurrentBusinessId() });
  db = dbMod.db;

  await cleanupSharedFixtures(admin);

  // Seed two isolated businesses on the shared database for round-trip + tenancy tests.
  await admin.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, name: 'V64n Owner A' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, name: 'V64n Owner B' },
    ],
  });
  await admin.business.createMany({
    data: [
      { id: ID.bizA, name: 'V64n Business A', ownerId: ID.ownerA },
      { id: ID.bizB, name: 'V64n Business B', ownerId: ID.ownerB },
    ],
  });
  await admin.contact.createMany({
    data: [
      { id: ID.contactA, businessId: ID.bizA, firstName: 'Alice', lastName: 'Tier' },
      { id: ID.contactB, businessId: ID.bizB, firstName: 'Bob', lastName: 'Other' },
    ],
  });
  await admin.product.createMany({
    data: [
      { id: ID.prodA1, businessId: ID.bizA, name: 'Consulting Hour', price: 100, category: 'SERVICE' },
      { id: ID.prodA2, businessId: ID.bizA, name: 'Design Sprint', price: 250, category: 'SERVICE' },
      { id: ID.prodB1, businessId: ID.bizB, name: 'BizB Service', price: 150, category: 'SERVICE' },
    ],
  });
  await admin.quote.create({
    data: {
      id: ID.quoteA,
      businessId: ID.bizA,
      contactId: ID.contactA,
      quoteNumber: `${P}Q-001`,
      total: 450,
    },
  });
  await admin.invoice.create({
    data: {
      id: ID.invA,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-001`,
      total: 450,
    },
  });
}, 60_000);

afterAll(async () => {
  try {
    if (admin) {
      await cleanupSharedFixtures(admin);
      for (const dbName of createdDbs) {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      }
      await admin.$disconnect();
    }
  } finally {
    for (const dir of scratchDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}, 60_000);

describe('V1-64 (MIGRATION-SET-A): v1 hold migration set', () => {
  it('MSA-01: migrate deploy on a fresh DB applies 20261120000000_v1_hold_set once with zero schema drift', async () => {
    const migrations = readdirSync(join(PRISMA_DIR, 'migrations'))
      .filter((d) => /^\d{14}_/.test(d) && d > '20261101000000_contact_partial_identity_uniques')
      .sort();
    expect(migrations[0]).toBe(HOLD_MIGRATION);

    const { url } = await createEmptyDb('fresh');
    const deployed = runPrisma(['migrate', 'deploy', '--schema=./prisma/schema.prisma'], url);
    expect(deployed.status, deployed.output).toBe(0);

    const diff = runPrisma(
      [
        'migrate',
        'diff',
        '--from-schema-datasource',
        './prisma/schema.prisma',
        '--to-schema-datamodel',
        './prisma/schema.prisma',
      ],
      url,
    );
    expect(diff.status, diff.output).toBe(0);
    for (const tbl of ['businesses', 'contacts', 'quote_items', 'invoice_items', 'product_tier_prices']) {
      expect(diff.output, `Unexpected schema drift on ${tbl}:\n${diff.output}`).not.toContain(`\`${tbl}\``);
    }

    await withDb(url, async (freshDb) => {
      const applied = await freshDb.$queryRawUnsafe<
        Array<{ migration_name: string; finished: boolean; rolled_back: boolean }>
      >(
        `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
           FROM _prisma_migrations WHERE migration_name = $1`,
        HOLD_MIGRATION,
      );
      expect(applied).toEqual([{ migration_name: HOLD_MIGRATION, finished: true, rolled_back: false }]);

      const cols = await freshDb.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
      >(
        `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'invoice_items' AND column_name = 'quantity') OR
              (table_name = 'quote_items' AND column_name = 'quantity') OR
              (table_name = 'businesses' AND column_name = 'vat_number') OR
              (table_name = 'contacts' AND column_name = 'pricing_tier') OR
              (table_name = 'product_tier_prices' AND column_name IN ('business_id', 'product_id', 'tier', 'price'))
            )
          ORDER BY table_name, column_name`,
      );
      expect(cols).toEqual([
        { table_name: 'businesses', column_name: 'vat_number', data_type: 'text', is_nullable: 'YES' },
        { table_name: 'contacts', column_name: 'pricing_tier', data_type: 'text', is_nullable: 'YES' },
        { table_name: 'invoice_items', column_name: 'quantity', data_type: 'double precision', is_nullable: 'NO' },
        { table_name: 'product_tier_prices', column_name: 'business_id', data_type: 'text', is_nullable: 'NO' },
        { table_name: 'product_tier_prices', column_name: 'price', data_type: 'double precision', is_nullable: 'NO' },
        { table_name: 'product_tier_prices', column_name: 'product_id', data_type: 'text', is_nullable: 'NO' },
        { table_name: 'product_tier_prices', column_name: 'tier', data_type: 'text', is_nullable: 'NO' },
        { table_name: 'quote_items', column_name: 'quantity', data_type: 'double precision', is_nullable: 'NO' },
      ]);

      // D-167: no unique index added to chart_of_accounts (stays service-level 409;
      // only the pre-existing (business_id, system_key) unique index exists).
      const coaUniques = await freshDb.$queryRawUnsafe<Array<{ indexname: string }>>(
        `SELECT ci.relname AS indexname
           FROM pg_index ix
           JOIN pg_class ct ON ct.oid = ix.indrelid
           JOIN pg_class ci ON ci.oid = ix.indexrelid
           JOIN pg_namespace ns ON ns.oid = ct.relnamespace
          WHERE ns.nspname = 'public'
            AND ct.relname = 'chart_of_accounts'
            AND ix.indisunique = true
            AND ix.indisprimary = false
          ORDER BY ci.relname`,
      );
      expect(coaUniques).toEqual([{ indexname: 'chart_of_accounts_business_id_system_key_key' }]);
    });
  }, 180_000);

  it('MSA-02: upgrading an existing DB preserves integer quantities, leaves vat_number/pricing_tier NULL, and accepts 2.5', async () => {
    const { url } = await createEmptyDb('upgrade');
    const copy = mkdtempSync(join(tmpdir(), 'kf-v64n-pre-'));
    scratchDirs.push(copy);
    cpSync(join(PRISMA_DIR, 'schema.prisma'), join(copy, 'schema.prisma'));
    cpSync(join(PRISMA_DIR, 'migrations'), join(copy, 'migrations'), {
      recursive: true,
      filter: (src) => {
        const top = relative(join(PRISMA_DIR, 'migrations'), src).split(sep)[0];
        return top === '' || !/^\d/.test(top) || top < HOLD_MIGRATION;
      },
    });
    expect(existsSync(join(copy, 'migrations', HOLD_MIGRATION))).toBe(false);

    const preDeploy = runPrisma(['migrate', 'deploy', `--schema=${join(copy, 'schema.prisma')}`], url);
    expect(preDeploy.status, preDeploy.output).toBe(0);

    // Seed pre-migration rows with integer quantities on the old schema.
    await withDb(url, async (preDb) => {
      await preDb.$executeRawUnsafe(
        `INSERT INTO businesses (id, name, owner_id, updated_at) VALUES ($1, $2, $3, now())`,
        `${P}up_biz`,
        'Pre-Hold Biz',
        `${P}up_owner`,
      );
      await preDb.$executeRawUnsafe(
        `INSERT INTO contacts (id, business_id, first_name, updated_at) VALUES ($1, $2, $3, now())`,
        `${P}up_ct`,
        `${P}up_biz`,
        'Legacy',
      );
      await preDb.$executeRawUnsafe(
        `INSERT INTO quotes (id, quote_number, total, business_id, contact_id, updated_at)
         VALUES ($1, $2, 300, $3, $4, now())`,
        `${P}up_q`,
        `${P}UP-Q-1`,
        `${P}up_biz`,
        `${P}up_ct`,
      );
      await preDb.$executeRawUnsafe(
        `INSERT INTO quote_items (id, description, quantity, unit_price, total, quote_id)
         VALUES ($1, 'Legacy quote line', 3, 100, 300, $2)`,
        `${P}up_qi`,
        `${P}up_q`,
      );
      await preDb.$executeRawUnsafe(
        `INSERT INTO invoices (id, invoice_number, total, business_id, contact_id, updated_at)
         VALUES ($1, $2, 700, $3, $4, now())`,
        `${P}up_inv`,
        `${P}UP-INV-1`,
        `${P}up_biz`,
        `${P}up_ct`,
      );
      await preDb.$executeRawUnsafe(
        `INSERT INTO invoice_items (id, description, quantity, unit_price, total, invoice_id)
         VALUES ($1, 'Legacy invoice line', 7, 100, 700, $2)`,
        `${P}up_ii`,
        `${P}up_inv`,
      );
    });

    // Apply the v1 hold migration set.
    const postDeploy = runPrisma(['migrate', 'deploy', '--schema=./prisma/schema.prisma'], url);
    expect(postDeploy.status, postDeploy.output).toBe(0);

    await withDb(url, async (postDb) => {
      const [biz] = await postDb.$queryRawUnsafe<Array<{ vat_number: string | null }>>(
        `SELECT vat_number FROM businesses WHERE id = $1`,
        `${P}up_biz`,
      );
      expect(biz?.vat_number).toBeNull();

      const [ct] = await postDb.$queryRawUnsafe<Array<{ pricing_tier: string | null }>>(
        `SELECT pricing_tier FROM contacts WHERE id = $1`,
        `${P}up_ct`,
      );
      expect(ct?.pricing_tier).toBeNull();

      const [qi] = await postDb.$queryRawUnsafe<Array<{ quantity: number }>>(
        `SELECT quantity FROM quote_items WHERE id = $1`,
        `${P}up_qi`,
      );
      expect(qi?.quantity).toBe(3);

      const [ii] = await postDb.$queryRawUnsafe<Array<{ quantity: number }>>(
        `SELECT quantity FROM invoice_items WHERE id = $1`,
        `${P}up_ii`,
      );
      expect(ii?.quantity).toBe(7);

      // Fractional 2.5 round-trips cleanly on both tables after the migration.
      await postDb.$executeRawUnsafe(
        `INSERT INTO quote_items (id, description, quantity, unit_price, total, quote_id)
         VALUES ($1, 'Half-hour consulting', 2.5, 100, 250, $2)`,
        `${P}up_qi_dec`,
        `${P}up_q`,
      );
      await postDb.$executeRawUnsafe(
        `INSERT INTO invoice_items (id, description, quantity, unit_price, total, invoice_id)
         VALUES ($1, 'Half-hour consulting', 2.5, 100, 250, $2)`,
        `${P}up_ii_dec`,
        `${P}up_inv`,
      );
      const [qiDec] = await postDb.$queryRawUnsafe<Array<{ quantity: number }>>(
        `SELECT quantity FROM quote_items WHERE id = $1`,
        `${P}up_qi_dec`,
      );
      const [iiDec] = await postDb.$queryRawUnsafe<Array<{ quantity: number }>>(
        `SELECT quantity FROM invoice_items WHERE id = $1`,
        `${P}up_ii_dec`,
      );
      expect(qiDec?.quantity).toBe(2.5);
      expect(iiDec?.quantity).toBe(2.5);
    });
  }, 180_000);

  it('MSA-03: quantity 2.5, integer quantity, Business.vatNumber, and Contact.pricingTier round-trip on @keyflow/db', async () => {
    // Existing seeded rows default to null for the new nullable columns.
    const bizBefore = await admin.business.findUniqueOrThrow({ where: { id: ID.bizA } });
    expect((bizBefore as unknown as { vatNumber: string | null }).vatNumber).toBeNull();

    const contactBefore = await admin.contact.findUniqueOrThrow({ where: { id: ID.contactA } });
    expect((contactBefore as unknown as { pricingTier: string | null }).pricingTier).toBeNull();

    // Update and read back vatNumber and pricingTier.
    const bizUpdated = await admin.business.update({
      where: { id: ID.bizA },
      data: { vatNumber: 'TT-VAT-123456' } as Record<string, unknown>,
    });
    expect((bizUpdated as unknown as { vatNumber: string | null }).vatNumber).toBe('TT-VAT-123456');

    const contactUpdated = await admin.contact.update({
      where: { id: ID.contactA },
      data: { pricingTier: 'WHOLESALE' } as Record<string, unknown>,
    });
    expect((contactUpdated as unknown as { pricingTier: string | null }).pricingTier).toBe('WHOLESALE');

    // Fractional 2.5 and integer 4 round-trip on both QuoteItem and InvoiceItem.
    await admin.quoteItem.createMany({
      data: [
        { id: ID.quoteItemAInt, quoteId: ID.quoteA, description: 'Whole units', quantity: 4, unitPrice: 50, total: 200 },
        { id: ID.quoteItemADec, quoteId: ID.quoteA, description: 'Part hours', quantity: 2.5, unitPrice: 100, total: 250 },
      ],
    });
    await admin.invoiceItem.createMany({
      data: [
        { id: ID.invItemAInt, invoiceId: ID.invA, description: 'Whole units', quantity: 4, unitPrice: 50, total: 200 },
        { id: ID.invItemADec, invoiceId: ID.invA, description: 'Part hours', quantity: 2.5, unitPrice: 100, total: 250 },
      ],
    });

    const qiInt = await admin.quoteItem.findUniqueOrThrow({ where: { id: ID.quoteItemAInt } });
    const qiDec = await admin.quoteItem.findUniqueOrThrow({ where: { id: ID.quoteItemADec } });
    const iiInt = await admin.invoiceItem.findUniqueOrThrow({ where: { id: ID.invItemAInt } });
    const iiDec = await admin.invoiceItem.findUniqueOrThrow({ where: { id: ID.invItemADec } });

    expect(qiInt.quantity).toBe(4);
    expect(qiDec.quantity).toBe(2.5);
    expect(iiInt.quantity).toBe(4);
    expect(iiDec.quantity).toBe(2.5);
  });

  it('MSA-04: ProductTierPrice enforces UNIQUE (product_id, tier) and permits same tier across different products', async () => {
    const ptp = (admin as unknown as Record<string, any>).productTierPrice;
    expect(ptp, 'PrismaClient.productTierPrice delegate must exist after migration').toBeDefined();

    const rowA1 = await ptp.create({
      data: { id: ID.tierA1, businessId: ID.bizA, productId: ID.prodA1, tier: 'WHOLESALE', price: 75.5 },
    });
    expect(rowA1.price).toBe(75.5);

    // Same (productId, tier) collides with P2002.
    await expect(
      ptp.create({
        data: { id: `${P}dup`, businessId: ID.bizA, productId: ID.prodA1, tier: 'WHOLESALE', price: 80 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Same tier on another product succeeds.
    const rowA2 = await ptp.create({
      data: { id: ID.tierA2, businessId: ID.bizA, productId: ID.prodA2, tier: 'WHOLESALE', price: 199.99 },
    });
    expect(rowA2.price).toBe(199.99);

    // Seed business B's tier price for tenancy checks in MSA-05.
    const rowB1 = await ptp.create({
      data: { id: ID.tierB1, businessId: ID.bizB, productId: ID.prodB1, tier: 'WHOLESALE', price: 120 },
    });
    expect(rowB1.businessId).toBe(ID.bizB);
  });

  it('MSA-05: ProductTierPrice reads and writes are tenant-scoped under BUSINESS_ID_MODELS', async () => {
    const ptp = (db as unknown as Record<string, any>).productTierPrice;
    expect(ptp, '@keyflow/db productTierPrice delegate must exist').toBeDefined();

    // Control without tenant context sees both businesses' rows.
    const unscoped = await ptp.findMany({
      where: { id: { startsWith: P } },
      orderBy: { id: 'asc' },
    });
    expect(unscoped.map((r: { id: string }) => r.id)).toEqual([ID.tierA1, ID.tierA2, ID.tierB1]);

    // Under business A's tenant context, business B's row is invisible and immutable.
    await tenant.runWithTenant(ID.bizA, ID.ownerA, async () => {
      const listA = await ptp.findMany({
        where: { id: { startsWith: P } },
        orderBy: { id: 'asc' },
      });
      expect(listA.map((r: { id: string }) => r.id)).toEqual([ID.tierA1, ID.tierA2]);

      const crossList = await ptp.findMany({ where: { businessId: ID.bizB, id: { startsWith: P } } });
      expect(crossList.every((r: { businessId: string }) => r.businessId === ID.bizA)).toBe(true);
      expect(crossList.find((r: { id: string }) => r.id === ID.tierB1)).toBeUndefined();

      expect(await ptp.findUnique({ where: { id: ID.tierB1 } })).toBeNull();
      expect(
        await ptp.findUnique({
          where: { productId_tier: { productId: ID.prodB1, tier: 'WHOLESALE' } },
        }),
      ).toBeNull();
      expect(await ptp.findFirst({ where: { id: ID.tierB1 } })).toBeNull();

      const upd = await ptp.updateMany({ where: { id: ID.tierB1 }, data: { price: 1 } });
      expect(upd.count).toBe(0);

      const del = await ptp.deleteMany({ where: { id: ID.tierB1 } });
      expect(del.count).toBe(0);

      // Write scoping forces active tenant's businessId even if body names bizB.
      const created = await ptp.create({
        data: {
          id: ID.tierAForced,
          businessId: ID.bizB,
          productId: ID.prodA1,
          tier: 'VIP',
          price: 65,
        },
      });
      expect(created.businessId).toBe(ID.bizA);
    });

    // Business B's row is completely untouched after business A's attempts.
    const adminPtp = (admin as unknown as Record<string, any>).productTierPrice;
    const stillB = await adminPtp.findUnique({ where: { id: ID.tierB1 } });
    expect(stillB).not.toBeNull();
    expect(stillB.price).toBe(120);
    expect(stillB.businessId).toBe(ID.bizB);
  });
});
