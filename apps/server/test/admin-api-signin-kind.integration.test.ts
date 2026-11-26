/**
 * V1-91 (RR-ADMIN-API-SIGNIN-KIND, owner ruling D-291):
 * Real-DB + real-Redis + real-HTTP integration proof of the server admin
 * sign-in boundary.
 *
 * Nothing on the auth boundary is mocked: the real AuthMiddleware (real
 * SupabaseAuthService, real verifyAdminToken, real PrismaService against
 * DATABASE_URL, real Redis) runs in front of the real AuthGuard, AdminGuard,
 * SeoAdminGuard, and the real admin / diagnostics / feature-flags / ai-usage /
 * risc / admin-auth / identity controllers under configureNestApp.
 *
 * Proves:
 *   - Unauthenticated requests to /api/admin/*, /api/diagnostics/*,
 *     /admin/risc/*, /identity/admin/auth-audit, /api/admin/auth/me, and
 *     /api/admin/auth/logout return 401 Unauthorized.
 *   - A Supabase-authenticated SUPER_ADMIN (valid Supabase JWT + DB
 *     User.role === 'SUPER_ADMIN'), even with forged headers (X-Auth-Kind: admin),
 *     query params (?authKind=admin), and forged JWT payload claims
 *     (authKind: 'admin', type: 'admin', role: 'SUPER_ADMIN',
 *     app_metadata: { authKind: 'admin' }), gets authKind='supabase' and is
 *     REFUSED (403 Forbidden) on EVERY /api/admin/*, /api/diagnostics/*,
 *     /admin/risc/*, /identity/admin/auth-audit, and comingSoon SeoAdminGuard route.
 *   - A separate local HMAC admin token minted by POST /api/admin/auth/login
 *     (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) gets authKind='admin' and SUCCEEDS
 *     (200/201) across all of those routes AND bypasses comingSoon SeoAdminGuard.
 *   - A regular USER (Supabase JWT) and a demoted admin (valid admin token
 *     whose DB User.role was lowered to 'USER') are REFUSED (403 Forbidden) on
 *     AdminGuard / diagnostics / feature-flags / ai-usage / risc / auth-audit,
 *     while /api/admin/auth/me still returns 200 { role: 'USER' } for the
 *     admin-signed-in demoted user (preserving R0 identity-boundary contract).
 *
 * RESOURCES: fixture prefix v91a_ (registered in
 * apps/server/test/helpers/fixture-prefixes.json). Seeds only prefixed User
 * rows; cleaned up with raw SQL through sqlLikePrefix(P) in beforeAll and
 * afterAll (zero .deleteMany calls).
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { AdminGuard } from '../src/core/auth/admin.guard';
import { SeoAdminGuard } from '../src/modules/seo/seo-admin.guard';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91a_';
const SUPABASE_SECRET = `${P}supabase-jwt-signing-secret-test`;
const ADMIN_SECRET = `${P}admin-hmac-signing-secret-test`;
const ADMIN_PASSWORD = `${P}AdminPass-NotReal-2026!`;

const ID = {
  superAdmin: `${P}super_admin`,
  regularUser: `${P}regular_user`,
  demotedAdmin: `${P}demoted_admin`,
  eraseTarget: `${P}erase_target`,
} as const;

const emailFor = (id: string) => `${id}@test.local`;

const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
] as const;
const savedEnv: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function mintSupabaseJwt(
  sub: string,
  email: string,
  extraClaims: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    sub,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
    ...extraClaims,
  });
  const sig = createHmac('sha256', SUPABASE_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

async function hashScryptPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString('hex')}`;
}

@Controller(`${P}probe`)
class V91aProbeController {
  @UseGuards(AuthGuard)
  @Get('auth-kind')
  authKind(@Req() req: { authKind?: string; user?: { id: string; role?: string; authKind?: string } }) {
    return {
      authKind: req.authKind ?? null,
      userAuthKind: req.user?.authKind ?? null,
      id: req.user?.id ?? null,
      role: req.user?.role ?? null,
    };
  }

  @UseGuards(AuthGuard, SeoAdminGuard)
  @Get('seo-coming-soon')
  seoComingSoon() {
    return { seo: 'allowed' };
  }
}

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- @keyflow/db loaded dynamically after env pin
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis client
let redis: any;
let adminToken = '';
let demotedAdminToken = '';
let supabaseSuperToken = '';
let forgedSupabaseSuperToken = '';
let supabaseRegularToken = '';

async function cleanupFixtures() {
  const prefixedUsers = `(SELECT id FROM users WHERE id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)})`;
  for (const sql of [
    `DELETE FROM sessions WHERE user_id IN ${prefixedUsers}`,
    `DELETE FROM user_identities WHERE user_id IN ${prefixedUsers}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
  if (redis) {
    for (const id of Object.values(ID)) {
      await redis.del(`admin:user:${id}:revokedAt`, `auth:revoked:user:${id}`);
    }
  }
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) savedEnv[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos';
  }
  process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
  process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  process.env.ADMIN_EMAIL = emailFor(ID.superAdmin);
  process.env.ADMIN_PASSWORD_HASH = await hashScryptPassword(ADMIN_PASSWORD);

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { buildAdminToken } = await import('../src/core/auth/admin-token.util');

  const { AdminAuthController } = await import('../src/modules/admin-auth/admin-auth.controller');
  const { AdminAuthService } = await import('../src/modules/admin-auth/admin-auth.service');
  const { AdminUserController } = await import('../src/modules/admin-platform/admin-user.controller');
  const { AdminBusinessController } = await import('../src/modules/admin-platform/admin-business.controller');
  const { AdminEventController } = await import('../src/modules/admin-platform/admin-event.controller');
  const { AdminAnalyticsController } = await import('../src/modules/admin-analytics/admin-analytics.controller');
  const { AdminAnalyticsService } = await import('../src/modules/admin-analytics/admin-analytics.service');
  const { GdprPurgeService } = await import('../src/modules/admin-platform/gdpr-purge.service');
  const { AdminFeatureFlagsController } = await import('../src/modules/feature-flags/feature-flags.controller');
  const { FeatureFlagsService } = await import('../src/modules/feature-flags/feature-flags.service');
  const { AiUsageAdminController } = await import('../src/modules/ai/ai-usage-admin.controller');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { DiagnosticsController } = await import('../src/modules/diagnostics/diagnostics.controller');
  const { DiagnosticsService } = await import('../src/modules/diagnostics/diagnostics.service');
  const { RiscAdminController } = await import('../src/modules/risc/risc-admin.controller');
  const { RiscService } = await import('../src/modules/risc/risc.service');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  redis = client;

  await cleanupFixtures();

  await db.user.create({
    data: { id: ID.superAdmin, email: emailFor(ID.superAdmin), role: 'SUPER_ADMIN', name: 'V91a Super' },
  });
  await db.user.create({
    data: { id: ID.regularUser, email: emailFor(ID.regularUser), role: 'USER', name: 'V91a Regular' },
  });
  await db.user.create({
    data: { id: ID.demotedAdmin, email: emailFor(ID.demotedAdmin), role: 'USER', name: 'V91a Demoted' },
  });

  const noop = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [
      V91aProbeController,
      AdminAuthController,
      AdminUserController,
      AdminBusinessController,
      AdminEventController,
      AdminAnalyticsController,
      AdminFeatureFlagsController,
      AiUsageAdminController,
      DiagnosticsController,
      RiscAdminController,
      IdentityController,
    ],
    providers: [
      PrismaService,
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      AdminGuard,
      SeoAdminGuard,
      AdminAuthService,
      { provide: REDIS_CLIENT, useValue: client },
      {
        provide: AdminAnalyticsService,
        useValue: { getPlatformOverview: async () => ({ users: 1 }) },
      },
      { provide: GdprPurgeService, useValue: noop },
      {
        provide: FeatureFlagsService,
        useValue: {
          listAll: async () => [],
          hasBypass: async () => ({ exists: true, comingSoon: true, bypass: false }),
        },
      },
      {
        provide: AiUsageService,
        useValue: {
          getUsageSummary: async () => ({ creditsUsed: 0 }),
          getUsageHistory: async () => ({ logs: [], total: 0 }),
        },
      },
      {
        provide: DiagnosticsService,
        useValue: { checkEnvVars: async () => ({ status: 'ok', checks: [] }) },
      },
      {
        provide: RiscService,
        useValue: { eraseForUser: async () => ({ deleted: 0 }) },
      },
      { provide: IdentityService, useValue: noop },
      { provide: IdentitySignupService, useValue: noop },
      { provide: IdentityPasswordService, useValue: noop },
      { provide: AuthSecurityService, useValue: noop },
      { provide: BusinessContextService, useValue: noop },
      { provide: SupabaseAdminService, useValue: noop },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  // Mint real admin token through the actual POST /api/admin/auth/login endpoint.
  const loginRes = await request(app.getHttpServer())
    .post('/api/admin/auth/login')
    .send({ email: emailFor(ID.superAdmin), password: ADMIN_PASSWORD });
  expect(loginRes.status, JSON.stringify(loginRes.body)).toBe(201);
  adminToken = loginRes.body.accessToken as string;
  expect(adminToken).toBeTruthy();

  // Mint an admin token for a user whose DB row is demoted to USER.
  demotedAdminToken = buildAdminToken(
    { id: ID.demotedAdmin, email: emailFor(ID.demotedAdmin), role: 'SUPER_ADMIN' },
    ADMIN_SECRET,
  );

  // Mint Supabase JWTs for SUPER_ADMIN (plain + with forged admin claims) and regular USER.
  supabaseSuperToken = mintSupabaseJwt(ID.superAdmin, emailFor(ID.superAdmin), {
    role: 'SUPER_ADMIN',
  });
  forgedSupabaseSuperToken = mintSupabaseJwt(ID.superAdmin, emailFor(ID.superAdmin), {
    role: 'SUPER_ADMIN',
    type: 'admin',
    authKind: 'admin',
    signInKind: 'admin',
    user_metadata: { authKind: 'admin', role: 'SUPER_ADMIN' },
    app_metadata: { authKind: 'admin', role: 'SUPER_ADMIN' },
  });
  supabaseRegularToken = mintSupabaseJwt(ID.regularUser, emailFor(ID.regularUser));
}, 60_000);

afterAll(async () => {
  if (db) await cleanupFixtures();
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const ADMIN_ROUTES: Array<{ method: 'get' | 'post'; path: string; okStatus: number }> = [
  { method: 'get', path: '/api/admin/users?limit=5&offset=0', okStatus: 200 },
  { method: 'get', path: '/api/admin/businesses?limit=5&offset=0', okStatus: 200 },
  { method: 'get', path: '/api/admin/events?limit=5&offset=0', okStatus: 200 },
  { method: 'get', path: '/api/admin/analytics/overview', okStatus: 200 },
  { method: 'get', path: '/api/admin/feature-flags', okStatus: 200 },
  { method: 'get', path: '/api/admin/ai-usage/platform-summary', okStatus: 200 },
  { method: 'get', path: '/api/diagnostics/errors?limit=5', okStatus: 200 },
  { method: 'get', path: '/api/diagnostics/env-vars', okStatus: 200 },
  { method: 'post', path: `/admin/risc/users/${ID.eraseTarget}/erase`, okStatus: 201 },
  { method: 'get', path: '/identity/admin/auth-audit?limit=5', okStatus: 200 },
  { method: 'get', path: `/${P}probe/seo-coming-soon`, okStatus: 200 },
];

describe('D-291 RR-ADMIN-API-SIGNIN-KIND — real-DB HTTP integration', () => {
  it('AuthMiddleware records authKind="supabase" for Supabase SUPER_ADMIN (ignoring forged headers/query/JWT claims) and authKind="admin" for admin login token', async () => {
    const supaRes = await request(app.getHttpServer())
      .get(`/${P}probe/auth-kind?authKind=admin&signInKind=admin`)
      .set('Authorization', `Bearer ${forgedSupabaseSuperToken}`)
      .set('X-Auth-Kind', 'admin')
      .set('X-SignIn-Kind', 'admin');
    expect(supaRes.status).toBe(200);
    expect(supaRes.body).toEqual({
      authKind: 'supabase',
      userAuthKind: 'supabase',
      id: ID.superAdmin,
      role: 'SUPER_ADMIN',
    });

    const admRes = await request(app.getHttpServer())
      .get(`/${P}probe/auth-kind`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(admRes.status).toBe(200);
    expect(admRes.body).toEqual({
      authKind: 'admin',
      userAuthKind: 'admin',
      id: ID.superAdmin,
      role: 'SUPER_ADMIN',
    });
  });

  it('returns 401 Unauthorized for unauthenticated requests on every admin, diagnostics, risc, auth-audit, and admin-auth route', async () => {
    for (const r of [
      ...ADMIN_ROUTES,
      { method: 'get' as const, path: '/api/admin/auth/me', okStatus: 200 },
      { method: 'post' as const, path: '/api/admin/auth/logout', okStatus: 201 },
    ]) {
      const res = await request(app.getHttpServer())[r.method](r.path);
      expect(res.status, `anon ${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it('refuses a Supabase-authenticated SUPER_ADMIN (403 Forbidden) on every admin, diagnostics, risc, auth-audit, admin-auth, and comingSoon SEO route', async () => {
    for (const r of [
      ...ADMIN_ROUTES,
      { method: 'get' as const, path: '/api/admin/auth/me', okStatus: 200 },
      { method: 'post' as const, path: '/api/admin/auth/logout', okStatus: 201 },
    ]) {
      const plainRes = await request(app.getHttpServer())
        [r.method](r.path)
        .set('Authorization', `Bearer ${supabaseSuperToken}`);
      expect(plainRes.status, `supabase SUPER_ADMIN ${r.method.toUpperCase()} ${r.path}`).toBe(403);

      const forgedRes = await request(app.getHttpServer())
        [r.method](`${r.path}${r.path.includes('?') ? '&' : '?'}authKind=admin`)
        .set('Authorization', `Bearer ${forgedSupabaseSuperToken}`)
        .set('X-Auth-Kind', 'admin')
        .set('X-SignIn-Kind', 'admin');
      expect(forgedRes.status, `forged supabase SUPER_ADMIN ${r.method.toUpperCase()} ${r.path}`).toBe(403);
    }
  });

  it('admits a separate admin-login SUPER_ADMIN token (200/201) on every admin, diagnostics, risc, auth-audit, admin-auth, and comingSoon SEO route', async () => {
    for (const r of [...ADMIN_ROUTES, { method: 'get' as const, path: '/api/admin/auth/me', okStatus: 200 }]) {
      const res = await request(app.getHttpServer())
        [r.method](r.path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, `admin token ${r.method.toUpperCase()} ${r.path}: ${JSON.stringify(res.body)}`).toBe(r.okStatus);
    }
  });

  it('refuses non-SUPER_ADMIN callers (regular Supabase USER and DB-demoted admin token) with 403, while /api/admin/auth/me still returns 200 with DB role USER for a demoted admin token', async () => {
    for (const r of ADMIN_ROUTES) {
      const regRes = await request(app.getHttpServer())
        [r.method](r.path)
        .set('Authorization', `Bearer ${supabaseRegularToken}`);
      expect(regRes.status, `regular USER ${r.method.toUpperCase()} ${r.path}`).toBe(403);

      const demotedRes = await request(app.getHttpServer())
        [r.method](r.path)
        .set('Authorization', `Bearer ${demotedAdminToken}`);
      expect(demotedRes.status, `demoted admin token ${r.method.toUpperCase()} ${r.path}`).toBe(403);
    }

    const demotedMe = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${demotedAdminToken}`);
    expect(demotedMe.status).toBe(200);
    expect(demotedMe.body).toEqual({
      id: ID.demotedAdmin,
      email: emailFor(ID.demotedAdmin),
      role: 'USER',
    });
  });
});
