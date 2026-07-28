/**
 * Phase 2 Increment 3 — Business OAuth token disclosure (REAL database).
 *
 * Business stores 14 plaintext OAuth token columns. IdentityService.getBusiness
 * / getBusinessBySlug / listBusinesses returned the full record, so those tokens
 * were serialized into authenticated API responses (GET businesses/:id, GET
 * businesses, GET businesses/slug/:slug) and into the KEY settings adapter.
 *
 * These tests prove the 14 fields no longer leave the service boundary, that
 * legitimate fields remain, and that the tokens remain stored. Sentinel values
 * are used and never printed — assertions only check field presence/absence.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BUSINESS_SECRET_FIELDS } from '../src/core/security/sanitize-business';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't3_';
const SENTINEL = 'oauth_sentinel_do_not_leak';
const ID = { userA: `${P}userA`, bizA: `${P}bizA`, slug: `${P}slug` };

let db: any;
let identity: any;

const tokenSeed = Object.fromEntries(BUSINESS_SECRET_FIELDS.map((f) => [f, SENTINEL]));

async function cleanup() {
  for (const sql of [
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function assertNoTokens(obj: Record<string, unknown>) {
  for (const f of BUSINESS_SECRET_FIELDS) {
    expect(f in obj).toBe(false);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  identity = new IdentityService(new PrismaService() as any, {} as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'Biz A', ownerId: ID.userA, slug: ID.slug, ...tokenSeed } });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('Business OAuth tokens do not leave the service boundary', () => {
  it('getBusiness() omits all 14 token fields but keeps legit fields', async () => {
    const biz = await identity.getBusiness(ID.bizA);
    assertNoTokens(biz);
    expect(biz.id).toBe(ID.bizA);
    expect(biz.name).toBe('Biz A');
  });

  it('getBusinessBySlug() omits all 14 token fields', async () => {
    const biz = await identity.getBusinessBySlug(ID.slug);
    assertNoTokens(biz);
    expect(biz.id).toBe(ID.bizA);
  });

  it('listBusinesses() omits all 14 token fields', async () => {
    const items = await identity.listBusinesses(ID.userA);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) assertNoTokens(item);
  });

  it('the token columns remain stored (only responses are sanitized)', async () => {
    const raw = await db.business.findUnique({ where: { id: ID.bizA } });
    for (const f of BUSINESS_SECRET_FIELDS) {
      expect(raw[f]).toBe(SENTINEL); // compared to fixture, never printed
    }
  });
});
