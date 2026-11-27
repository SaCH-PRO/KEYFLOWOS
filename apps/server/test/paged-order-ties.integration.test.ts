/**
 * V1-67 (W11-PAGING-TOTAL-ORDER-A): real-DB tie-breaking proof for cursor-paged
 * and offset-paged Group A lists on Postgres.
 *
 * Seeds 5 rows with byte-identical timestamps (`createdAt` / `updatedAt`) in
 * non-monotonic ID insertion order (`row_3`, `row_1`, `row_5`, `row_2`, `row_4`)
 * and pages through them with `take: 2` (`page 1` -> `page 2` -> `page 3`):
 *   1. Cursor-paged `ContractsService.listContracts` (`orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]`):
 *      Without `{ id: 'desc' }`, Prisma generates `WHERE updated_at <= cursor.updated_at ORDER BY updated_at DESC OFFSET 1`
 *      which duplicates/drops tied rows across pages and violates descending `id` tie-break order.
 *   2. Cursor-paged `ContactAuditService.list` (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`):
 *      Same cursor + `skip: 1` tie failure without `{ id: 'desc' }`.
 *   3. Offset-paged `AssetService.listAssets` (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`):
 *      Even when a non-sort column (`usageCount`) on a tied row is updated between
 *      pages (causing a Postgres MVCC heap tuple move), offset paging returns all
 *      5 distinct IDs exactly once in strictly monotonic `id DESC` order.
 *
 * Fixtures: prefix `v67a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted via raw SQL with `sqlLikePrefix(P)` in `beforeAll` and `afterAll`
 * (zero `.deleteMany(` on soft-deleted models).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v67a_';
const BIZ_ID = `${P}biz`;
const USER_ID = `${P}owner`;
const CONTACT_ID = `${P}contact`;
const TIED_TS = new Date('2026-01-15T12:00:00.000Z');
const INSERT_ORDER = [3, 1, 5, 2, 4] as const;
const EXPECTED_DESC_SUFFIXES = [5, 4, 3, 2, 1] as const;

let db: any;
let contractsService: any;
let contactAuditService: any;
let assetService: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contracts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM assets WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

beforeAll(async () => {
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ContractsService } = await import('../src/modules/contracts/contracts.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { AssetService } = await import('../src/modules/assets/asset.service');

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;

  contractsService = new ContractsService(prismaService, {} as any, eventStub as any);
  contactAuditService = new ContactAuditService(prismaService);
  assetService = new AssetService(prismaService, eventStub as any);

  await cleanup();

  await db.user.create({
    data: {
      id: USER_ID,
      email: `${P}owner@example.test`,
      name: 'V67a Owner',
    },
  });

  await db.business.create({
    data: {
      id: BIZ_ID,
      name: 'V67a Paging Business',
      slug: `${P}biz`,
      ownerId: USER_ID,
    },
  });

  await db.contact.create({
    data: {
      id: CONTACT_ID,
      businessId: BIZ_ID,
      firstName: 'Tied',
      lastName: 'Contact',
      email: `${P}contact@example.test`,
    },
  });

  // Seed 5 contracts with non-monotonic IDs and identical updatedAt/createdAt.
  for (const n of INSERT_ORDER) {
    await db.contract.create({
      data: {
        id: `${P}ctr_${n}`,
        businessId: BIZ_ID,
        title: `Contract ${n}`,
        createdAt: TIED_TS,
        updatedAt: TIED_TS,
      },
    });
  }
  await db.$executeRawUnsafe(
    `UPDATE contracts SET created_at = '${TIED_TS.toISOString()}', updated_at = '${TIED_TS.toISOString()}' WHERE business_id = '${BIZ_ID}'`,
  );

  // Seed 5 contact audit entries with non-monotonic IDs and identical createdAt.
  const contactHash = contactAuditService.hashContact(BIZ_ID, CONTACT_ID);
  for (const n of INSERT_ORDER) {
    await db.contactAuditEntry.create({
      data: {
        id: `${P}aud_${n}`,
        businessId: BIZ_ID,
        contactId: CONTACT_ID,
        contactHash,
        action: 'updated',
        entityType: 'contact',
        entityId: CONTACT_ID,
        createdAt: TIED_TS,
      },
    });
  }

  // Seed 5 assets with non-monotonic IDs and identical createdAt.
  for (const n of INSERT_ORDER) {
    await db.asset.create({
      data: {
        id: `${P}ast_${n}`,
        businessId: BIZ_ID,
        name: `Asset ${n}`,
        type: 'document',
        url: `https://example.test/${P}ast_${n}.pdf`,
        storageKey: `${P}ast_${n}`,
        uploadedBy: USER_ID,
        createdAt: TIED_TS,
        updatedAt: TIED_TS,
      },
    });
  }
}, 60_000);

afterAll(async () => {
  if (db) {
    await cleanup();
    await db.$disconnect?.();
  }
}, 30_000);

describe('V1-67 real-DB tie-breaking total order (W11-PAGING-TOTAL-ORDER-A)', () => {
  it('ContractsService.listContracts (cursor, take: 2) returns all 5 tied rows once in strict id DESC order', async () => {
    const expectedIds = EXPECTED_DESC_SUFFIXES.map((n) => `${P}ctr_${n}`);
    const collected: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 5; page += 1) {
      const res = await contractsService.listContracts(BIZ_ID, { limit: 2, cursor });
      collected.push(...res.items.map((r: { id: string }) => r.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }

    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    expect(collected).toEqual(expectedIds);
  });

  it('ContactAuditService.list (cursor, take: 2) returns all 5 tied rows once in strict id DESC order', async () => {
    const expectedIds = EXPECTED_DESC_SUFFIXES.map((n) => `${P}aud_${n}`);
    const collected: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 5; page += 1) {
      const res = await contactAuditService.list({
        businessId: BIZ_ID,
        contactId: CONTACT_ID,
        limit: 2,
        cursor,
      });
      collected.push(...res.entries.map((r: { id: string }) => r.id));
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    expect(collected).toEqual(expectedIds);
  });

  it('AssetService.listAssets (offset, take: 2) returns all 5 tied rows once in strict id DESC order even across an MVCC update', async () => {
    const expectedIds = EXPECTED_DESC_SUFFIXES.map((n) => `${P}ast_${n}`);

    const page1 = await assetService.listAssets(BIZ_ID, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.items.map((r: { id: string }) => r.id)).toEqual(expectedIds.slice(0, 2));

    // Mutate a non-sort column on a page-1 row to trigger a Postgres MVCC heap tuple relocation.
    await db.$executeRawUnsafe(
      `UPDATE assets SET usage_count = usage_count + 1 WHERE id = '${page1.items[0].id}'`,
    );

    const page2 = await assetService.listAssets(BIZ_ID, { limit: 2, offset: 2 });
    const page3 = await assetService.listAssets(BIZ_ID, { limit: 2, offset: 4 });

    const collected = [
      ...page1.items.map((r: { id: string }) => r.id),
      ...page2.items.map((r: { id: string }) => r.id),
      ...page3.items.map((r: { id: string }) => r.id),
    ];

    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    expect(collected).toEqual(expectedIds);
  });
});
