/**
 * V1-63 (SWP-SEC-AUDIT-TRUTH), sweep BUG-065: the security audit stops
 * claiming what it does not track, and only members with settings read run it.
 *
 * The sweep (team-roles; recheck M59): /app/settings/security said
 * "100% of team members have MFA enabled (1 total)" and counted it as a passed
 * check, although nothing records whether a team member uses multi-factor
 * authentication (SecurityAuditService.checkMfaEnforcement: `const mfaRate = 1;
 * // MFA tracking not yet implemented on User model`). A STAFF member with
 * settings 'none' could open the page and run the audit too: the controller
 * ran AuthGuard and BusinessGuard only. No MFA tracking in v1 (the packet's
 * shrunk scope): the audit removes the claim.
 *
 * Pinned here, through GET /security/businesses/:businessId/audit on a real
 * database:
 *   - the MFA check is listed with status 'not_tracked': it is not a pass (nor
 *     a failure), states no percentage and no member count, and recommends
 *     nothing (there is no MFA setting to require it with);
 *   - the inactive-users check, which hard-codes `inactive = 0` because no last
 *     sign-in is recorded (`lastLoginAt not yet tracked on User model`), is
 *     'not_tracked' the same way (the same claim class in the same audit: it
 *     said "0 team member(s) have not logged in for 30+ days" and passed);
 *   - the score, `passed` and `total` count only the checks the audit measured
 *     (status 'passed' or 'failed'); `notTracked` counts the rest;
 *   - a member without settings read (a STAFF member on the role defaults,
 *     settings 'none'; a STAFF member whose explicit map leaves settings out)
 *     is refused 403 by ModuleScopeGuard before the audit runs: the service is
 *     never called and nothing of the audit is in the answer;
 *   - a STAFF member with settings 'read' runs it (read is the floor, not
 *     admin); the OWNER and an ADMIN run it (controls).
 * Control (green before and after): a non-member is refused by BusinessGuard
 * and the audit does not run.
 *
 * Harness (as test/orderby-multikey-routes.integration.test.ts): the real
 * AuthMiddleware and AuthGuard (HS256 tokens on the test-only verifyLocal path,
 * signed with a secret built at run time), the real BusinessGuard and
 * ModuleScopeGuard, the TenantInterceptor as the APP_INTERCEPTOR production
 * installs, configureNestApp (the global exception filter and validation
 * pipe), and the real SecurityAuditController/SecurityAuditService on the real
 * PrismaService. The service's runAudit is wrapped by a spy that calls through,
 * so a refusal is shown to come before the audit reads anything. Global fetch
 * is a tap that refuses every call; the suite asserts it was never used. The
 * environment variables the config checks read are pinned for the suite and
 * restored after it.
 *
 * RESOURCES: fixture prefix v63g_ (registered in test/helpers/fixture-prefixes.json,
 * packet V1-63 (SWP-SEC-AUDIT-TRUTH)). Every seeded id and address carries it.
 * Everything is hard-deleted by raw SQL through sqlLikePrefix(P) before and
 * after the suite.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63g_';

/** Test-only HS256 secret, assembled at run time (no secret-shaped literal). */
const SIGNING_SECRET = [P, 'security', 'audit', 'truth', 'signing'].join('-');

/**
 * Auth keys (the verifyLocal path) and the variables the audit's config checks
 * read, pinned for the suite so its answer does not depend on the shell.
 */
const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
  'AI_INTEGRATIONS_OPENAI_API_KEY',
  'PASSWORD_MIN_LENGTH',
  'NEXT_PUBLIC_APP_URL',
  'RATE_LIMIT_WINDOW_MS',
] as const;
const saved: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  /** STAFF on the role defaults: settings 'none'. */
  staff: `${P}staff`,
  /** STAFF with an explicit map that leaves settings out (a missing key is 'none'). */
  desk: `${P}desk`,
  /** STAFF with settings 'read' and nothing else. */
  reader: `${P}reader`,
  /** A member of another business only. */
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  bizB: `${P}bizB`,
};

const EMAIL = {
  owner: `${P}owner@test.local`,
  admin: `${P}admin@test.local`,
  staff: `${P}staff@test.local`,
  desk: `${P}desk@test.local`,
  reader: `${P}reader@test.local`,
  outsider: `${P}outsider@test.local`,
};

const AS = {
  owner: { id: ID.owner, email: EMAIL.owner },
  admin: { id: ID.admin, email: EMAIL.admin },
  staff: { id: ID.staff, email: EMAIL.staff },
  desk: { id: ID.desk, email: EMAIL.desk },
  reader: { id: ID.reader, email: EMAIL.reader },
  outsider: { id: ID.outsider, email: EMAIL.outsider },
} as const;
type As = keyof typeof AS;

/** The checks that measure nothing today: no MFA state and no last sign-in are recorded. */
const NOT_TRACKED_IDS = ['inactive-users', 'mfa-enforcement'];

interface Check {
  id: string;
  status?: string;
  passed: boolean;
  severity: string;
  title: string;
  description: string;
  recommendation?: string;
}
interface Audit {
  score: number | null;
  passed: number;
  total: number;
  notTracked?: number;
  checks: Check[];
}

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the @keyflow/db client is loaded after env
let db: any;
let skipTenantIsolation: <T extends object>(args: T) => T;
let redis: { quit: () => Promise<unknown> } | undefined;
let runAudit: ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } };

/** Outbound fetch tap: every attempted call is recorded and refused. */
const outbound: string[] = [];
const realFetch = globalThis.fetch;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An HS256 access token in the shape the real-database harnesses mint (no iss). */
function token(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 600, jti: randomUUID() });
  const sig = createHmac('sha256', SIGNING_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const auditUrl = (businessId: string = ID.biz) => `/security/businesses/${businessId}/audit`;

function audit(as: As, businessId: string = ID.biz) {
  return request(app.getHttpServer())
    .get(auditUrl(businessId))
    .set('Authorization', `Bearer ${token(AS[as].id, AS[as].email)}`)
    .set('x-business-id', businessId);
}

/** A response's status and body, kept short, so a failing status names what the server said. */
const said = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body).slice(0, 400)}`;

const byId = (body: Audit, id: string) => body.checks.find((c) => c.id === id);

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM sessions WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function seed() {
  for (const who of Object.keys(AS) as As[]) {
    await db.user.create({ data: { id: AS[who].id, email: AS[who].email, name: who, role: 'USER' } });
  }
  // A forget grace window, so the privacy check passes and the score is not all failures.
  await db.business.create({ data: { id: ID.biz, name: `${P}business`, ownerId: ID.owner, forgetGraceDays: 30 } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}other business`, ownerId: ID.outsider } });
  const member = (id: string, userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create(skipTenantIsolation({ data: { id, userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) } }));
  await member(`${P}m_owner`, ID.owner, ID.biz, 'OWNER');
  await member(`${P}m_admin`, ID.admin, ID.biz, 'ADMIN');
  await member(`${P}m_staff`, ID.staff, ID.biz, 'STAFF');
  await member(`${P}m_desk`, ID.desk, ID.biz, 'STAFF', { bookings: 'write', crm: 'read' });
  await member(`${P}m_reader`, ID.reader, ID.biz, 'STAFF', { settings: 'read' });
  await member(`${P}m_outsider`, ID.outsider, ID.bizB, 'OWNER');
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  // The test-only verifyLocal path: a configured secret, no Supabase URL, NODE_ENV=test.
  process.env.SUPABASE_JWT_SECRET = SIGNING_SECRET;
  // The config checks: an https app URL and an explicit rate-limit window (both pass).
  process.env.NEXT_PUBLIC_APP_URL = 'https://v63g.example.test';
  process.env.RATE_LIMIT_WINDOW_MS = '60000';

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('v63g: outbound fetch refused by the test');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  skipTenantIsolation = dbMod.skipTenantIsolation;

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { SecurityAuditController } = await import('../src/modules/security-audit/security-audit.controller');
  const { SecurityAuditService } = await import('../src/modules/security-audit/security-audit.service');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
  redis = client;

  const prisma = new PrismaService();
  const service = new SecurityAuditService(prisma);
  // The real audit, observed: a refusal must come before it runs.
  runAudit = vi.spyOn(service, 'runAudit') as unknown as typeof runAudit;

  const moduleRef = await Test.createTestingModule({
    controllers: [SecurityAuditController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: REDIS_CLIENT, useValue: client },
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      { provide: SecurityAuditService, useValue: service },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await seed();
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) await cleanup();
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  runAudit.mockClear();
});

describe('fixture sanity (real rows)', () => {
  it('seeded the business, its five members (OWNER, ADMIN, three STAFF) and the other business', async () => {
    const rows: Array<{ user_id: string; role: string }> = await db.$queryRawUnsafe(
      `SELECT user_id, role FROM memberships WHERE business_id = '${ID.biz}' ORDER BY user_id`,
    );
    expect(rows.map((r) => `${r.user_id}:${r.role}`)).toEqual(
      [`${ID.admin}:ADMIN`, `${ID.desk}:STAFF`, `${ID.owner}:OWNER`, `${ID.reader}:STAFF`, `${ID.staff}:STAFF`],
    );
    expect(await db.membership.count(skipTenantIsolation({ where: { businessId: ID.bizB } }))).toBe(1);
  });
});

describe('BUG-065: the audit claims nothing it does not track', () => {
  it('[V63G-01] the OWNER runs the audit: 200 with every check listed (control)', async () => {
    const res = await audit('owner');
    expect(res.status, said(res)).toBe(200);
    const body = res.body as Audit;
    expect(body.checks.map((c) => c.id).sort()).toEqual(
      ['consent-coverage', 'env-secrets', 'inactive-users', 'mfa-enforcement', 'password-policy', 'privacy-settings', 'rate-limiting', 'ssl-config'],
    );
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it("[V63G-02] the MFA check is 'not_tracked': not a pass, no percentage, no member count, no recommendation (RED: passed, '100% of team members have MFA enabled')", async () => {
    const res = await audit('owner');
    expect(res.status, said(res)).toBe(200);
    const mfa = byId(res.body as Audit, 'mfa-enforcement');
    expect(mfa, 'the MFA check is still listed').toBeDefined();
    expect(mfa!.status, JSON.stringify(mfa)).toBe('not_tracked');
    expect(mfa!.passed, 'a check that measures nothing is not a pass').toBe(false);
    expect(mfa!.description, 'no MFA percentage').not.toMatch(/\d+\s*%/);
    expect(mfa!.description, 'no claim that members have MFA enabled').not.toMatch(/have MFA enabled|\(\d+ total\)/i);
    expect(mfa!.description).toMatch(/not tracked/i);
    expect(mfa!.recommendation, 'nothing to require MFA with').toBeUndefined();
    expect(mfa!.severity).toBe('info');
  });

  it("[V63G-03] the inactive-users check is 'not_tracked' too: no last sign-in is recorded, so '0 team member(s) have not logged in' is not claimed (RED: passed)", async () => {
    const res = await audit('owner');
    expect(res.status, said(res)).toBe(200);
    const inactive = byId(res.body as Audit, 'inactive-users');
    expect(inactive, 'the inactive-users check is still listed').toBeDefined();
    expect(inactive!.status, JSON.stringify(inactive)).toBe('not_tracked');
    expect(inactive!.passed).toBe(false);
    expect(inactive!.description).not.toMatch(/\b0 team member/);
    expect(inactive!.description).toMatch(/not tracked/i);
    expect(inactive!.recommendation).toBeUndefined();
  });

  it('[V63G-04] the score, passed and total count only the checks the audit measured; notTracked counts the rest (RED: the MFA claim counted as a pass)', async () => {
    const res = await audit('owner');
    expect(res.status, said(res)).toBe(200);
    const body = res.body as Audit;
    const statuses = Object.fromEntries(body.checks.map((c) => [c.id, c.status]));
    expect(
      body.checks.filter((c) => c.status === 'not_tracked').map((c) => c.id).sort(),
      `statuses ${JSON.stringify(statuses)}`,
    ).toEqual(NOT_TRACKED_IDS);
    for (const c of body.checks) {
      expect(['passed', 'failed', 'not_tracked'], `${c.id} has a status`).toContain(c.status);
      expect(c.passed, `${c.id}: passed is true exactly when its status is 'passed'`).toBe(c.status === 'passed');
    }
    const measured = body.checks.filter((c) => c.status !== 'not_tracked');
    const passed = measured.filter((c) => c.status === 'passed').length;
    expect(body.total, 'total counts the measured checks only').toBe(measured.length);
    expect(body.total).toBe(body.checks.length - NOT_TRACKED_IDS.length);
    expect(body.passed).toBe(passed);
    expect(body.notTracked).toBe(NOT_TRACKED_IDS.length);
    expect(body.score).toBe(Math.round((passed / measured.length) * 100));
    // The pinned environment: the privacy, consent, password, HTTPS and rate-limit checks pass;
    // whatever env-secrets concludes is counted as measured, never as not tracked.
    for (const id of ['privacy-settings', 'consent-coverage', 'password-policy', 'ssl-config', 'rate-limiting']) {
      expect(statuses[id], id).toBe('passed');
    }
    expect(['passed', 'failed']).toContain(statuses['env-secrets']);
  });
});

describe('BUG-065: only members with settings read run the audit', () => {
  it("[V63G-05] a STAFF member on the role defaults (settings 'none') is refused 403 before the audit runs (RED: 200)", async () => {
    const res = await audit('staff');
    expect(res.status, said(res)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/settings requires read access \(you have none\)/);
    expect(res.body).not.toHaveProperty('checks');
    expect(JSON.stringify(res.body)).not.toMatch(/Multi-factor|mfa-enforcement|score/i);
    expect(runAudit, 'the audit never ran for a refused member').not.toHaveBeenCalled();
  });

  it("[V63G-06] a STAFF member whose explicit scope map leaves settings out is refused 403 before the audit runs (RED: 200)", async () => {
    const res = await audit('desk');
    expect(res.status, said(res)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/settings requires read access \(you have none\)/);
    expect(res.body).not.toHaveProperty('checks');
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("[V63G-07] a STAFF member with settings 'read' runs the audit: read is the floor, not admin", async () => {
    const res = await audit('reader');
    expect(res.status, said(res)).toBe(200);
    expect((res.body as Audit).checks.length).toBeGreaterThan(0);
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it('[V63G-08] an ADMIN (settings admin by the role defaults) runs the audit (control)', async () => {
    const res = await audit('admin');
    expect(res.status, said(res)).toBe(200);
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it("[V63G-09] a non-member is refused by BusinessGuard and the audit does not run (control)", async () => {
    const res = await audit('outsider');
    expect(res.status, said(res)).toBe(403);
    expect(res.body).not.toHaveProperty('checks');
    expect(runAudit).not.toHaveBeenCalled();
  });
});

describe('no outbound traffic', () => {
  it('made no outbound fetch', () => {
    expect(outbound).toEqual([]);
  });
});
