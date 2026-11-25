/**
 * P37 — FU-BULK-DELETE-UNDO (owner ruling D-277b, server half):
 * POST /api/businesses/:businessId/trash/:model/bulk-restore restores up to 100
 * trashed records of `model` in one call so a bulk-delete Undo restores the deleted
 * ids from Trash atomically per record without weakening any TrashController rule:
 *   - BusinessGuard + assertMayWrite (D-46 / D-95 / non-member SUPER_ADMIN refusal)
 *   - CRM visibility + crm_edit ('none' / 'owned') + heldContactSql (GDPR forget
 *     requested/purged and merged duplicates are never restored)
 *   - Contact email/phone partial-unique conflict (D-16) reported per-id without
 *     aborting sibling restores and with visibility-bounded existingContactId
 *   - Product / Service delegation to CatalogService.restoreProduct / restoreService
 *
 * Fixture prefix: `v91r_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashController } from '../src/modules/trash/trash.controller';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { CrmCacheService } from '../src/modules/crm/crm-cache.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91r_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffCrmRead: `${P}staffRead`,
  staffNoEdit: `${P}staffNoEdit`,
  staffOwned: `${P}staffOwned`,
  staffViewAllEditOwned: `${P}staffViewAll`,
  outsider: `${P}outsider`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // Contacts in bizA
  c1: `${P}c1`,
  c2: `${P}c2`,
  c3: `${P}c3`,
  cLive: `${P}cLive`,
  cMerged: `${P}cMerged`,
  cForgetReq: `${P}cForgetReq`,
  cOwn: `${P}cOwn`,
  cOtherPrivate: `${P}cOtherPriv`,
  cOtherTeam: `${P}cOtherTeam`,
  cConflictTrashed: `${P}cConflictT`,
  cConflictHolder: `${P}cConflictH`,
  // Contact in bizB
  cBizB: `${P}cBizB`,
  // Product in bizA
  prodA1: `${P}prodA1`,
  // Invoice in bizA
  invA1: `${P}invA1`,
};

let db: PrismaClient;
let app: INestApplication;
const catalogRestoreProduct = vi.fn();
const catalogRestoreService = vi.fn();
const crmCacheInvalidate = vi.fn(async () => undefined);

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM contact_forget_requests WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM products WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

async function seedBase() {
  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, name: 'Owner A', role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, name: 'Owner B', role: 'USER' },
      { id: ID.staffCrmRead, email: `${P}staffRead@test.local`, name: 'Staff CRM Read', role: 'USER' },
      { id: ID.staffNoEdit, email: `${P}staffNoEdit@test.local`, name: 'Staff No Edit', role: 'USER' },
      { id: ID.staffOwned, email: `${P}staffOwned@test.local`, name: 'Staff Owned', role: 'USER' },
      { id: ID.staffViewAllEditOwned, email: `${P}staffViewAll@test.local`, name: 'Staff ViewAll', role: 'USER' },
      { id: ID.outsider, email: `${P}outsider@test.local`, name: 'Outsider', role: 'USER' },
      { id: ID.superAdmin, email: `${P}superAdmin@test.local`, name: 'Super Admin', role: 'SUPER_ADMIN' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V91r Biz A', ownerId: ID.ownerA },
      { id: ID.bizB, name: 'V91r Biz B', ownerId: ID.ownerB },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, businessId: ID.bizA, userId: ID.ownerA, role: 'OWNER' },
      { id: `${P}m_ownerB`, businessId: ID.bizB, userId: ID.ownerB, role: 'OWNER' },
      {
        id: `${P}m_read`,
        businessId: ID.bizA,
        userId: ID.staffCrmRead,
        role: 'STAFF',
        permissionScopes: { crm: 'read', revenue: 'read' },
      },
      {
        id: `${P}m_noedit`,
        businessId: ID.bizA,
        userId: ID.staffNoEdit,
        role: 'STAFF',
        permissionScopes: { crm: 'write', revenue: 'read', crm_view: 'all', crm_edit: 'none' },
      },
      {
        id: `${P}m_owned`,
        businessId: ID.bizA,
        userId: ID.staffOwned,
        role: 'STAFF',
        permissionScopes: { crm: 'write', revenue: 'read', crm_view: 'owned', crm_edit: 'owned' },
      },
      {
        id: `${P}m_viewall`,
        businessId: ID.bizA,
        userId: ID.staffViewAllEditOwned,
        role: 'STAFF',
        permissionScopes: { crm: 'write', revenue: 'read', crm_view: 'all', crm_edit: 'owned' },
      },
    ],
  });

  const trashedAt = new Date('2026-11-24T12:00:00Z');
  await db.contact.createMany({
    data: [
      { id: ID.c1, businessId: ID.bizA, firstName: 'C1', ownerId: ID.ownerA, deletedAt: trashedAt },
      { id: ID.c2, businessId: ID.bizA, firstName: 'C2', ownerId: ID.ownerA, deletedAt: trashedAt },
      { id: ID.c3, businessId: ID.bizA, firstName: 'C3', ownerId: ID.ownerA, deletedAt: trashedAt },
      { id: ID.cLive, businessId: ID.bizA, firstName: 'Live', ownerId: ID.ownerA, deletedAt: null },
      {
        id: ID.cMerged,
        businessId: ID.bizA,
        firstName: 'Merged',
        ownerId: ID.ownerA,
        mergedIntoId: ID.cLive,
        deletedAt: trashedAt,
      },
      { id: ID.cForgetReq, businessId: ID.bizA, firstName: 'Forgotten', ownerId: ID.ownerA, deletedAt: trashedAt },
      {
        id: ID.cOwn,
        businessId: ID.bizA,
        firstName: 'Own',
        ownerId: ID.staffOwned,
        visibility: 'PRIVATE',
        deletedAt: trashedAt,
      },
      {
        id: ID.cOtherPrivate,
        businessId: ID.bizA,
        firstName: 'OtherPrivate',
        ownerId: ID.ownerA,
        visibility: 'PRIVATE',
        deletedAt: trashedAt,
      },
      {
        id: ID.cOtherTeam,
        businessId: ID.bizA,
        firstName: 'OtherTeam',
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        deletedAt: trashedAt,
      },
      {
        id: ID.cConflictTrashed,
        businessId: ID.bizA,
        firstName: 'ConflictTrashed',
        email: `${P}dup@test.local`,
        emailNormalized: `${P}dup@test.local`,
        ownerId: ID.staffOwned,
        visibility: 'TEAM',
        deletedAt: trashedAt,
      },
      {
        id: ID.cConflictHolder,
        businessId: ID.bizA,
        firstName: 'ConflictHolder',
        email: `${P}dup@test.local`,
        emailNormalized: `${P}dup@test.local`,
        ownerId: ID.ownerA,
        visibility: 'PRIVATE',
        deletedAt: null,
      },
      { id: ID.cBizB, businessId: ID.bizB, firstName: 'BizB', ownerId: ID.ownerB, deletedAt: trashedAt },
    ],
  });

  await db.contactForgetRequest.create({
    data: {
      id: `${P}fr1`,
      businessId: ID.bizA,
      contactId: ID.cForgetReq,
      contactHash: `sha256:${P}hash1`,
      status: 'requested',
      requestedById: ID.ownerA,
      purgeAt: new Date('2026-12-24T12:00:00Z'),
    },
  });

  await db.product.create({
    data: {
      id: ID.prodA1,
      businessId: ID.bizA,
      name: 'V91r Product',
      price: 50,
      deletedAt: trashedAt,
    },
  });

  await db.invoice.create({
    data: {
      id: ID.invA1,
      businessId: ID.bizA,
      contactId: ID.cLive,
      invoiceNumber: `${P}INV-1`,
      total: 100,
      deletedAt: trashedAt,
    },
  });
}

function bulkRestore(businessId: string, model: string, body: unknown, actorId: string) {
  return request(app.getHttpServer())
    .post(`/api/businesses/${businessId}/trash/${model}/bulk-restore`)
    .set('x-v91r-user', actorId)
    .send(body as Record<string, unknown>);
}

function singleRestore(businessId: string, model: string, id: string, actorId: string) {
  return request(app.getHttpServer())
    .post(`/api/businesses/${businessId}/trash/${model}/${id}/restore`)
    .set('x-v91r-user', actorId);
}

async function contactDeletedAt(id: string): Promise<Date | null> {
  const rows = await db.$queryRawUnsafe<Array<{ deleted_at: Date | null }>>(
    `SELECT deleted_at FROM contacts WHERE id = $1`,
    id,
  );
  return rows[0]?.deleted_at ?? null;
}

beforeAll(async () => {
  db = new PrismaClient();
  await db.$connect();

  catalogRestoreProduct.mockImplementation(async (businessId: string, id: string) => {
    await db.$executeRawUnsafe(
      `UPDATE products SET deleted_at = NULL WHERE id = $1 AND business_id = $2`,
      id,
      businessId,
    );
    return { id, businessId, deletedAt: null };
  });
  catalogRestoreService.mockImplementation(async (businessId: string, id: string) => ({
    id,
    businessId,
    deletedAt: null,
  }));

  const prismaService = { client: db } as unknown as PrismaService;
  const catalogStub = {
    restoreProduct: catalogRestoreProduct,
    restoreService: catalogRestoreService,
  } as unknown as CatalogService;
  const crmCacheStub = {
    invalidate: crmCacheInvalidate,
  } as unknown as CrmCacheService;

  const mod = await Test.createTestingModule({
    controllers: [TrashController],
    providers: [
      AuthGuard,
      BusinessGuard,
      { provide: PrismaService, useValue: prismaService },
      { provide: CatalogService, useValue: catalogStub },
      { provide: CrmCacheService, useValue: crmCacheStub },
    ],
  }).compile();

  app = mod.createNestApplication();
  app.use(async (req: any, _res: any, next: () => void) => {
    const uid = req.headers['x-v91r-user'];
    if (typeof uid === 'string' && uid.length > 0) {
      const user = await db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, role: true } });
      if (user) req.user = user;
    }
    next();
  });
  await app.init();
}, 30_000);

beforeEach(async () => {
  catalogRestoreProduct.mockClear();
  catalogRestoreService.mockClear();
  crmCacheInvalidate.mockClear();
  await seedBase();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
}, 30_000);

describe('P37 (FU-BULK-DELETE-UNDO, D-277b): POST /api/businesses/:businessId/trash/:model/bulk-restore', () => {
  it('BDU-01: OWNER restores multiple trashed contacts in one call and clears deleted_at in Postgres', async () => {
    const res = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1, ID.c2, ID.c3] }, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      model: 'contact',
      restored: [ID.c1, ID.c2, ID.c3],
      failed: [],
      restoredCount: 3,
      failedCount: 0,
    });
    expect(await contactDeletedAt(ID.c1)).toBeNull();
    expect(await contactDeletedAt(ID.c2)).toBeNull();
    expect(await contactDeletedAt(ID.c3)).toBeNull();
  });

  it('BDU-02: deduplicates duplicate ids and rejects empty, >100, non-string, or unknown-model payloads with 400', async () => {
    const dup = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1, ID.c1] }, ID.ownerA);
    expect(dup.status, JSON.stringify(dup.body)).toBe(201);
    expect(dup.body).toEqual({
      model: 'contact',
      restored: [ID.c1],
      failed: [],
      restoredCount: 1,
      failedCount: 0,
    });

    const badPayloads: Array<[string, unknown]> = [
      ['contact', {}],
      ['contact', { ids: [] }],
      ['contact', { ids: 'not-an-array' }],
      ['contact', { ids: ['   '] }],
      ['contact', { ids: [123] }],
      ['contact', { ids: Array.from({ length: 101 }, (_, i) => `${P}x${i}`) }],
      ['notAModel', { ids: [ID.c2] }],
    ];
    for (const [model, body] of badPayloads) {
      const r = await bulkRestore(ID.bizA, model, body, ID.ownerA);
      expect(r.status, `${model} ${JSON.stringify(body)} -> ${JSON.stringify(r.body)}`).toBe(400);
    }
    expect(await contactDeletedAt(ID.c2)).not.toBeNull();
  });

  it('BDU-03: enforces BusinessGuard, D-46/D-95 module write scope, non-member SUPER_ADMIN refusal, and crm_edit none', async () => {
    const outsiderRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1] }, ID.outsider);
    expect(outsiderRes.status).toBe(403);

    const superContact = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1] }, ID.superAdmin);
    expect(superContact.status).toBe(403);
    expect(superContact.body.message).toContain('Not a member of this business');

    const superInvoice = await bulkRestore(ID.bizA, 'invoice', { ids: [ID.invA1] }, ID.superAdmin);
    expect(superInvoice.status).toBe(403);
    expect(superInvoice.body.message).toContain('Not authorized to update this invoice');

    const crmReadRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1] }, ID.staffCrmRead);
    expect(crmReadRes.status).toBe(403);
    expect(crmReadRes.body.message).toContain('crm requires write access');

    const noEditRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1] }, ID.staffNoEdit);
    expect(noEditRes.status).toBe(403);
    expect(noEditRes.body.message).toContain('You do not have permission to edit contacts');

    expect(await contactDeletedAt(ID.c1)).not.toBeNull();
  });

  it('BDU-04: rejects cross-tenant, live, missing, merged-duplicate, GDPR-held, and non-editable contacts per id without leaking', async () => {
    const ownerRes = await bulkRestore(
      ID.bizA,
      'contact',
      { ids: [ID.c1, ID.cBizB, ID.cLive, `${P}missing`, ID.cMerged, ID.cForgetReq] },
      ID.ownerA,
    );
    expect(ownerRes.status, JSON.stringify(ownerRes.body)).toBe(201);
    expect(ownerRes.body.restored).toEqual([ID.c1]);
    expect(ownerRes.body.restoredCount).toBe(1);
    expect(ownerRes.body.failedCount).toBe(5);
    expect(ownerRes.body.failed.map((f: { id: string; code: string }) => [f.id, f.code])).toEqual([
      [ID.cBizB, 'not_found'],
      [ID.cLive, 'not_found'],
      [`${P}missing`, 'not_found'],
      [ID.cMerged, 'not_found'],
      [ID.cForgetReq, 'not_found'],
    ]);
    // Untouched rows remain in their original states.
    expect(await contactDeletedAt(ID.cBizB)).not.toBeNull();
    expect(await contactDeletedAt(ID.cMerged)).not.toBeNull();
    expect(await contactDeletedAt(ID.cForgetReq)).not.toBeNull();

    // Staff with crm_view=owned + crm_edit=owned: restores own, hides otherPrivate as not_found.
    const ownedRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.cOwn, ID.cOtherPrivate] }, ID.staffOwned);
    expect(ownedRes.status, JSON.stringify(ownedRes.body)).toBe(201);
    expect(ownedRes.body.restored).toEqual([ID.cOwn]);
    expect(ownedRes.body.failed.map((f: { id: string; code: string }) => [f.id, f.code])).toEqual([
      [ID.cOtherPrivate, 'not_found'],
    ]);
    expect(await contactDeletedAt(ID.cOwn)).toBeNull();
    expect(await contactDeletedAt(ID.cOtherPrivate)).not.toBeNull();

    // Staff with crm_view=all + crm_edit=owned: sees otherTeam, gets forbidden (not restored).
    const viewAllRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.cOtherTeam] }, ID.staffViewAllEditOwned);
    expect(viewAllRes.status, JSON.stringify(viewAllRes.body)).toBe(201);
    expect(viewAllRes.body.restored).toEqual([]);
    expect(viewAllRes.body.failed.map((f: { id: string; code: string }) => [f.id, f.code])).toEqual([
      [ID.cOtherTeam, 'forbidden'],
    ]);
    expect(await contactDeletedAt(ID.cOtherTeam)).not.toBeNull();
  });

  it('BDU-05: contact email conflict (P2002) reports contact_email_taken with visibility-bounded existingContactId without aborting siblings', async () => {
    // StaffOwned cannot see PRIVATE cConflictHolder -> existingContactId must be null.
    const staffRes = await bulkRestore(
      ID.bizA,
      'contact',
      { ids: [ID.cOwn, ID.cConflictTrashed] },
      ID.staffOwned,
    );
    expect(staffRes.status, JSON.stringify(staffRes.body)).toBe(201);
    expect(staffRes.body.restored).toEqual([ID.cOwn]);
    expect(staffRes.body.restoredCount).toBe(1);
    expect(staffRes.body.failedCount).toBe(1);
    expect(staffRes.body.failed[0]).toMatchObject({
      id: ID.cConflictTrashed,
      code: 'contact_email_taken',
      existingContactId: null,
    });
    expect(staffRes.body.failed[0].message).not.toMatch(/Prisma|Unique constraint/i);
    expect(await contactDeletedAt(ID.cConflictTrashed)).not.toBeNull();

    // Owner CAN see cConflictHolder -> existingContactId names it.
    const ownerRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.cConflictTrashed] }, ID.ownerA);
    expect(ownerRes.status, JSON.stringify(ownerRes.body)).toBe(201);
    expect(ownerRes.body.failed[0]).toMatchObject({
      id: ID.cConflictTrashed,
      code: 'contact_email_taken',
      existingContactId: ID.cConflictHolder,
    });
  });

  it('BDU-06: product bulk-restore enforces revenue:write and delegates to CatalogService.restoreProduct', async () => {
    const denied = await bulkRestore(ID.bizA, 'product', { ids: [ID.prodA1] }, ID.staffOwned);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toContain('revenue requires write access');
    expect(catalogRestoreProduct).not.toHaveBeenCalled();

    const ok = await bulkRestore(ID.bizA, 'product', { ids: [ID.prodA1] }, ID.ownerA);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toEqual({
      model: 'product',
      restored: [ID.prodA1],
      failed: [],
      restoredCount: 1,
      failedCount: 0,
    });
    expect(catalogRestoreProduct).toHaveBeenCalledWith(ID.bizA, ID.prodA1);
    expect(crmCacheInvalidate).not.toHaveBeenCalled();
  });

  it('BDU-07 (COR-P37-3): restoring contacts (bulk or single) invalidates the business CRM cache; zero restored contacts does not', async () => {
    // 0 contacts restored (missing/live) -> no cache invalidation.
    const noneRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.cLive] }, ID.ownerA);
    expect(noneRes.status, JSON.stringify(noneRes.body)).toBe(201);
    expect(noneRes.body.restoredCount).toBe(0);
    expect(crmCacheInvalidate).not.toHaveBeenCalled();

    // Bulk restore of 2 contacts -> invalidates bizA CRM cache once.
    const bulkRes = await bulkRestore(ID.bizA, 'contact', { ids: [ID.c1, ID.c2] }, ID.ownerA);
    expect(bulkRes.status, JSON.stringify(bulkRes.body)).toBe(201);
    expect(bulkRes.body.restoredCount).toBe(2);
    expect(crmCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(crmCacheInvalidate).toHaveBeenCalledWith(ID.bizA);

    // Single restore of a contact -> invalidates bizA CRM cache once more.
    crmCacheInvalidate.mockClear();
    const singleRes = await singleRestore(ID.bizA, 'contact', ID.c3, ID.ownerA);
    expect(singleRes.status, JSON.stringify(singleRes.body)).toBe(201);
    expect(crmCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(crmCacheInvalidate).toHaveBeenCalledWith(ID.bizA);
  });
});
