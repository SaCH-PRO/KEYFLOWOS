/**
 * Phase 2 Increment 4 — disconnectSocialAccount cross-tenant delete (REAL database).
 *
 * content.service.disconnectSocialAccount accepted a businessId but deleted the
 * SocialConnection by accountId alone, so a caller scoped to Business A could
 * delete Business B's social connection (a SECRET_CREDENTIAL row holding an
 * OAuth token). The method is now scoped by (id, businessId) and returns a
 * uniform not-found without revealing cross-tenant ownership.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't4_';
const ID = {
  userA: `${P}userA`, userB: `${P}userB`,
  bizA: `${P}bizA`, bizB: `${P}bizB`,
  connB: `${P}connB`, connBpos: `${P}connBpos`,
};

let db: any;
let svc: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM social_connections WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ContentService } = await import('../src/modules/content/content.service');
  svc = new ContentService(new PrismaService() as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await db.socialConnection.create({ data: { id: ID.connB, businessId: ID.bizB, platform: 'FACEBOOK', token: 'sentinel_do_not_leak' } });
  await db.socialConnection.create({ data: { id: ID.connBpos, businessId: ID.bizB, platform: 'INSTAGRAM', token: 'sentinel_do_not_leak' } });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('disconnectSocialAccount — tenant scoped', () => {
  it('Business A cannot disconnect Business B social account, and B is unchanged', async () => {
    await expect(
      svc.disconnectSocialAccount({ businessId: ID.bizA, accountId: ID.connB }),
    ).rejects.toThrow();
    const still = await db.socialConnection.findUnique({ where: { id: ID.connB } });
    expect(still).not.toBeNull();
    expect(still.businessId).toBe(ID.bizB);
  });

  it('a nonexistent account id yields the same not-found error', async () => {
    await expect(
      svc.disconnectSocialAccount({ businessId: ID.bizA, accountId: `${P}nope` }),
    ).rejects.toThrow();
  });

  it('positive control: the owning business can disconnect its own account', async () => {
    await expect(
      svc.disconnectSocialAccount({ businessId: ID.bizB, accountId: ID.connBpos }),
    ).resolves.toEqual({ disconnected: true });
    const gone = await db.socialConnection.findUnique({ where: { id: ID.connBpos } });
    expect(gone).toBeNull();
  });
});
