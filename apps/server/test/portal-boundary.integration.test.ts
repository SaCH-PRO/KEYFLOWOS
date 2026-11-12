/**
 * V1-14-PUB-PORTAL-VOICE-BINDING — the public portal token check is
 * rate-limited and answers only a live grant (REAL database, REAL Redis).
 *
 *   GET /portal/validate?token=<portal token>      (no authentication)
 *
 * Defect (CF-46 / M38, validate half): the route carried @RateLimit(60, 60_000)
 * but no RateLimitGuard. The decorator only writes metadata; nothing reads it
 * unless the guard runs, and RateLimitGuard is not global (no APP_GUARD). So
 * an unauthenticated caller could test portal tokens at any rate, and each hit
 * on a live token also wrote lastAccessedAt / accessCount.
 *
 * After the fix, the (N+1)th call inside the window answers 429 before the
 * token is looked up or the access recorded, whatever token it carries. A
 * revoked (enabled = false), expired, unknown, empty, missing or repeated
 * token answers { valid: false } and records nothing.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * RateLimitGuard (real Redis at REDIS_URL), PortalService and the production
 * GlobalHttpExceptionFilter + ValidationPipe are real against DATABASE_URL.
 * Identity attachment is the one stand-in, used only by the revoke case: a test
 * middleware reads `x-v14a-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 *
 * Fixtures: prefix `v14a_` (values in globally unique columns embed it);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping. The limiter's Redis keys for this handler are cleared
 * before every case.
 *
 * Cases tagged NEGATIVE CONTROL fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v14a_';
const HEADER = 'x-v14a-user';
const DAY_MS = 24 * 60 * 60 * 1000;
const LIMITER_KEYS = 'rate_limit:*:global:validateToken';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  cLive: `${P}cLive`,
  cRevoked: `${P}cRevoked`,
  cExpired: `${P}cExpired`,
  cToRevoke: `${P}cToRevoke`,
  gLive: `${P}gLive`,
  gRevoked: `${P}gRevoked`,
  gExpired: `${P}gExpired`,
  gToRevoke: `${P}gToRevoke`,
};
const TOKEN = {
  live: `${P}token_live_seeded`,
  revoked: `${P}token_revoked_seeded`,
  expired: `${P}token_expired_seeded`,
  toRevoke: `${P}token_to_revoke_seeded`,
  unknown: `${P}token_does_not_exist`,
};
const SETTINGS_LIVE = { invoices: true, projects: false, documents: true, bookings: false };

let db: any;
let app: any;
let redis: any;
let validateLimit: { limit: number; windowMs: number } | undefined;

async function cleanup() {
  for (const sql of [
    `DELETE FROM portal_access WHERE business_id LIKE ${sqlLikePrefix(P)} OR contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearValidateLimiter() {
  const keys: string[] = await redis.keys(LIMITER_KEYS);
  if (keys.length) await redis.del(...keys);
}

function validate(query: string) {
  return request(app.getHttpServer()).get(`/portal/validate${query}`);
}

/** The access bookkeeping of one grant, as stored (raw SQL: under every client extension). */
async function accessOf(id: string): Promise<{ count: number; last: string | null; enabled: boolean }> {
  const rows: Array<{ access_count: number; last_accessed_at: Date | null; enabled: boolean }> =
    await db.$queryRawUnsafe(
      `SELECT access_count, last_accessed_at, enabled FROM portal_access WHERE id = '${id}'`,
    );
  expect(rows).toHaveLength(1);
  return {
    count: Number(rows[0].access_count),
    last: rows[0].last_accessed_at ? new Date(rows[0].last_accessed_at).toISOString() : null,
    enabled: rows[0].enabled,
  };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { RATE_LIMIT_KEY } = await import('../src/core/decorators/rate-limit.decorator');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PortalController } = await import('../src/modules/portal/portal.controller');
  const { PortalService } = await import('../src/modules/portal/portal.service');

  validateLimit = Reflect.getMetadata(RATE_LIMIT_KEY, PortalController.prototype.validateToken);

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- the real HTTP path, wired before any row is seeded -----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [PortalController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      PortalService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearValidateLimiter();

  // ---- identity and tenant -------------------------------------------------
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V14A Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });

  // ---- contacts and grants: one live, one revoked, one expired, one to revoke
  for (const [id, last] of [
    [ID.cLive, 'Live'],
    [ID.cRevoked, 'Revoked'],
    [ID.cExpired, 'Expired'],
    [ID.cToRevoke, 'ToRevoke'],
  ] as const) {
    await db.contact.create({ data: { id, businessId: ID.biz, firstName: 'V14A', lastName: last } });
  }
  await db.portalAccess.create({
    data: {
      id: ID.gLive, businessId: ID.biz, contactId: ID.cLive, token: TOKEN.live,
      expiresAt: new Date(Date.now() + 30 * DAY_MS), enabled: true, settings: SETTINGS_LIVE,
    },
  });
  await db.portalAccess.create({
    data: {
      id: ID.gRevoked, businessId: ID.biz, contactId: ID.cRevoked, token: TOKEN.revoked,
      expiresAt: new Date(Date.now() + 30 * DAY_MS), enabled: false, settings: {},
    },
  });
  await db.portalAccess.create({
    data: {
      id: ID.gExpired, businessId: ID.biz, contactId: ID.cExpired, token: TOKEN.expired,
      expiresAt: new Date(Date.now() - DAY_MS), enabled: true, settings: {},
    },
  });
  await db.portalAccess.create({
    data: {
      id: ID.gToRevoke, businessId: ID.biz, contactId: ID.cToRevoke, token: TOKEN.toRevoke,
      expiresAt: new Date(Date.now() + 30 * DAY_MS), enabled: true, settings: {},
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearValidateLimiter(); } catch { /* best-effort */ }
    await redis.quit();
  }
});

beforeEach(clearValidateLimiter);

describe('fixture sanity (real rows)', () => {
  it('seeded four grants in one tenant and the validate route declares a limit', async () => {
    expect(await db.portalAccess.count({ where: { businessId: ID.biz } })).toBe(4);
    expect(validateLimit, '@RateLimit metadata on validateToken').toBeDefined();
    expect(validateLimit!.limit).toBeGreaterThan(0);
    expect(validateLimit!.limit).toBeLessThanOrEqual(60);
    expect(validateLimit!.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe('GET /portal/validate answers only a live grant', () => {
  it('positive control: a live token answers valid with its tenant, contact and settings, and records the access', async () => {
    const before = await accessOf(ID.gLive);
    const res = await validate(`?token=${TOKEN.live}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, businessId: ID.biz, contactId: ID.cLive, settings: SETTINGS_LIVE });
    const after = await accessOf(ID.gLive);
    expect(after.count).toBe(before.count + 1);
    expect(after.last).not.toBeNull();
  });

  it('a revoked (disabled) token answers { valid: false } and records nothing', async () => {
    const before = await accessOf(ID.gRevoked);
    const res = await validate(`?token=${TOKEN.revoked}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
    expect(await accessOf(ID.gRevoked)).toEqual(before);
  });

  it('an expired token answers { valid: false } and records nothing', async () => {
    const before = await accessOf(ID.gExpired);
    const res = await validate(`?token=${TOKEN.expired}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
    expect(await accessOf(ID.gExpired)).toEqual(before);
  });

  it('a token revoked through the real DELETE route stops validating at once', async () => {
    const ok = await validate(`?token=${TOKEN.toRevoke}`);
    expect(ok.body.valid).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/portal/businesses/${ID.biz}/access/${ID.gToRevoke}`)
      .set(HEADER, ID.owner);
    expect(del.status).toBe(200);
    expect((await accessOf(ID.gToRevoke)).enabled).toBe(false);

    const before = await accessOf(ID.gToRevoke);
    const res = await validate(`?token=${TOKEN.toRevoke}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
    expect(await accessOf(ID.gToRevoke)).toEqual(before);
  });

  it('an unknown token answers { valid: false }', async () => {
    const res = await validate(`?token=${TOKEN.unknown}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a missing, empty or repeated token answers { valid: false }, not a server error', async () => {
    const before = await accessOf(ID.gLive);
    for (const q of ['', '?token=', `?token=${TOKEN.live}&token=${TOKEN.live}`, `?token[equals]=${TOKEN.live}`]) {
      const res = await validate(q);
      expect(res.status, `query ${JSON.stringify(q)}`).toBe(200);
      expect(res.body, `query ${JSON.stringify(q)}`).toEqual({ valid: false });
    }
    expect(await accessOf(ID.gLive)).toEqual(before);
  });
});

describe('GET /portal/validate is rate-limited', () => {
  it('NEGATIVE CONTROL (pre-fix FAIL expected): the (N+1)th call in the window answers 429', async () => {
    const { limit } = validateLimit!;
    for (let i = 0; i < limit; i++) {
      const res = await validate(`?token=${TOKEN.unknown}_${i}`);
      expect(res.status, `call ${i + 1} of ${limit}`).toBe(200);
      expect(res.body).toEqual({ valid: false });
    }
    const over = await validate(`?token=${TOKEN.unknown}_over`);
    expect(over.status).toBe(429);
    expect(over.body.valid).toBeUndefined();
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): token guessing spends the budget, and the refused call does not look up or record a live token', async () => {
    const { limit } = validateLimit!;
    for (let i = 0; i < limit; i++) {
      await validate(`?token=${TOKEN.unknown}_guess_${i}`).expect(200);
    }
    const before = await accessOf(ID.gLive);
    const res = await validate(`?token=${TOKEN.live}`);
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).not.toContain(ID.biz);
    expect(JSON.stringify(res.body)).not.toContain(ID.cLive);
    expect(await accessOf(ID.gLive)).toEqual(before);
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): the limiter writes its window to Redis for this handler', async () => {
    await validate(`?token=${TOKEN.unknown}`).expect(200);
    const keys: string[] = await redis.keys(LIMITER_KEYS);
    expect(keys.length).toBe(1);
    expect(await redis.zcard(keys[0])).toBe(1);
  });

  it('positive control: under the limit, a live token still validates', async () => {
    const res = await validate(`?token=${TOKEN.live}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});
