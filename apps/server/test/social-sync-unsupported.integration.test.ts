/**
 * Social connector pull-sync is unsupported (REAL database).
 *
 * Defect: SocialPlatformConnector.sync (inherited by linkedin/twitter/tiktok) and
 * MetaSocialConnector.sync (override) both returned success:true with a COUNT of
 * local POSTED posts as `itemsSynced`, while performing NO provider read/write —
 * a reachable silent-success (the nightly scheduler invokes this path). Meta also
 * bumped lastSyncAt/syncCount, actively faking a successful sync.
 *
 * Contract: social connectors do not support pull synchronization. sync() must
 * return an explicit unsupported result (success:false, itemsSynced:0,
 * code:'PULL_SYNC_UNSUPPORTED'), never success:true.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tss_';
const ID = { userA: `${P}userA`, bizA: `${P}bizA` };

let db: any;
let meta: any;
let linkedin: any;
let SocialBase: any;
let LinkedIn: any;
let Twitter: any;
let TikTok: any;
let Meta: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM social_posts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM social_connections WHERE business_id LIKE '${P}%'`,
    `DELETE FROM connector_statuses WHERE business_id LIKE '${P}%'`,
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
  ({ SocialPlatformConnector: SocialBase } = await import('../src/core/connectors/implementations/social-platform.base'));
  ({ MetaSocialConnector: Meta } = await import('../src/core/connectors/implementations/meta-social.connector'));
  ({ LinkedInConnector: LinkedIn } = await import('../src/core/connectors/implementations/linkedin.connector'));
  ({ TwitterConnector: Twitter } = await import('../src/core/connectors/implementations/twitter.connector'));
  ({ TikTokConnector: TikTok } = await import('../src/core/connectors/implementations/tiktok.connector'));
  const prisma = new PrismaService();
  const events = { emit: () => undefined } as any;
  const entityResolution = {} as any;
  meta = new Meta(prisma, events, entityResolution);
  linkedin = new LinkedIn(prisma, events, entityResolution);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  // Connected social accounts so sync() reaches the (formerly success) path, not "not connected".
  await db.socialConnection.create({ data: { id: `${P}fb`, businessId: ID.bizA, platform: 'FACEBOOK', token: 'x', status: 'CONNECTED' } });
  await db.socialConnection.create({ data: { id: `${P}li`, businessId: ID.bizA, platform: 'LINKEDIN', token: 'x', status: 'CONNECTED' } });
  // Local posts that the buggy sync would miscount as "synced items".
  for (let i = 0; i < 3; i++) {
    await db.socialPost.create({ data: { id: `${P}post${i}`, businessId: ID.bizA, content: 'hi', mediaUrls: [], status: 'POSTED' } });
  }
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('Social pull-sync returns an explicit unsupported result', () => {
  it('Meta (override) does not report local posts as synced', async () => {
    const r = await meta.sync(ID.bizA);
    expect(r.success).toBe(false);
    expect(r.itemsSynced).toBe(0);
    expect(r.unsupported).toBe(true);
    expect(r.code).toBe('PULL_SYNC_UNSUPPORTED');
  });

  it('LinkedIn (shared base) does not report local posts as synced', async () => {
    const r = await linkedin.sync(ID.bizA);
    expect(r.success).toBe(false);
    expect(r.itemsSynced).toBe(0);
    expect(r.unsupported).toBe(true);
    expect(r.code).toBe('PULL_SYNC_UNSUPPORTED');
  });

  it('does not mark a successful sync (lastSyncAt is not advanced by an unsupported pull)', async () => {
    const status = await db.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId: ID.bizA, connectorType: 'meta_social' } },
    });
    // Either no status row, or one that was not stamped as a successful sync by sync().
    expect(status?.lastSyncAt ?? null).toBeNull();
  });
});

describe('Fix coverage: shared base vs override', () => {
  it('linkedin/twitter/tiktok inherit the base sync (one base fix covers all three)', () => {
    expect(LinkedIn.prototype.sync).toBe(SocialBase.prototype.sync);
    expect(Twitter.prototype.sync).toBe(SocialBase.prototype.sync);
    expect(TikTok.prototype.sync).toBe(SocialBase.prototype.sync);
  });

  it('Meta overrides sync (fixed separately)', () => {
    expect(Meta.prototype.sync).not.toBe(SocialBase.prototype.sync);
  });
});
