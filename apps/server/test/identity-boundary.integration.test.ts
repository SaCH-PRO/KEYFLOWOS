/**
 * R0-AB-04-IDENTITY-BOUNDARY-PROOF — the identity guard chain over HTTP,
 * REAL server, REAL database (AUTH-BUSINESS-v1 AB-P01, AB-P02, AB-P03, AB-P04,
 * AB-P09; auth-business lane AB-BP04 / AB-F08, AB-F09, AB-F20).
 *
 * Until this suite the identity routes were proven only with mocked services
 * (identity.e2e.test.ts) or by calling a guard object directly
 * (tenant-membership-boundary.integration.test.ts). Here every claim is made by
 * an HTTP request to the shipped server, with the identity attached the
 * production way, against rows in Postgres.
 *
 * HOW THE APP IS COMPOSED: SPAWNED BUILT SERVER (not in-process)
 * --------------------------------------------------------------
 * The server under test is the BUILT artifact `dist/main.js`, spawned as a
 * child process on a free port against DATABASE_URL and REDIS_URL — the same
 * harness release0-journey.integration.test.ts uses. That gives the real module
 * graph, the real middleware chain (CorrelationIdMiddleware, AuthMiddleware),
 * the real guards (AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimit),
 * the real ValidationPipe and GlobalHttpExceptionFilter, the real
 * IdentityService and PrismaService with the tenant-isolation extension
 * main.ts installs. An in-process Nest app was not used: the AppModule graph
 * only resolves from tsc-emitted decorator metadata, which vitest's esbuild
 * transform does not emit (app-module-boots.integration.test.ts), and composing
 * AuthMiddleware + IdentityController by hand would stub half the controller's
 * collaborators — the spawned artifact needs no stand-in at all.
 *
 * IDENTITY PATH (no Supabase, no stand-in)
 * ----------------------------------------
 * The child gets a test-only SUPABASE_JWT_SECRET and every Supabase / provider
 * credential pinned to '' (see childEnv: dist/main.js runs dotenv on
 * <cwd>/../../.env itself, and dotenv never overrides a key that is already
 * present, so pinning is what keeps a developer's repo-root .env out). The
 * test mints HS256 JWTs shaped like Supabase access tokens (sub, email,
 * aud=authenticated). The real AuthMiddleware verifies them through
 * SupabaseAuthService.verifyLocal, then resolveLocalUser applies the Redis
 * revocation marker and the User.deletedAt / User.bannedAt checks and reads
 * the role from the User row — the exact production path of a deployment with
 * the JWT secret configured.
 *
 * SCOPE OF THE AB-P02 CLAIM: it holds on that Supabase-token branch ONLY. The
 * child also gets a test-only ADMIN_JWT_SECRET so the second branch of
 * AuthMiddleware.use — the admin-token fallback — is exercised too, and there
 * AB-P02 does NOT hold (ST-2 below).
 *
 * OPEN DEFECTS (review of this packet; NOT fixed here — every fix is in source
 * outside this proof packet's write set, so each is reproduced by an
 * "OPEN DEFECT … reproduced" case that pins today's observed behaviour and
 * turns red when the fix lands, next to an it.todo naming the required
 * behaviour for the fix packet):
 *   ST-1  PATCH /identity/businesses/:id/team/:membershipId {role} needs only
 *         team:write, resets permissionScopes/maxApprovalTier to the role
 *         defaults and has no self-target check — a team:write member gets
 *         around the team:admin gate on .../permissions, for itself or others
 *         (identity.controller.ts updateMemberRole, identity.service.ts
 *         updateMemberRole).
 *   ST-2  the admin-token branch attaches verifyAdminToken's result directly:
 *         no revocation marker, no deletedAt/bannedAt, role from the token
 *         (auth.middleware.ts).
 *   ST-3  PATCH /identity/businesses/:id has no ModuleScopeGuard: a
 *         settings:none member rewrites the tenant profile
 *         (identity.controller.ts updateBusiness).
 *   ST-4  the revocation marker is per user with no iat cutoff and
 *         POST /identity/login deletes it, so a pre-logout token is admitted
 *         again after the next login (identity.controller.ts login).
 *   CR-2  logout's Supabase global sign-out passes the user id where auth-js
 *         admin.signOut expects the user's access JWT, so it never revokes
 *         anything (identity.controller.ts logout, supabase-admin.service.ts
 *         signOut, identity-password.service.ts) — not observable here.
 *
 * FIXTURES
 * --------
 * Every row has the `ab_` prefix (users, businesses, memberships; team
 * activity rows the server writes hang off `ab_` businesses). They are seeded
 * through the @keyflow/db client in this process and hard-deleted by raw SQL in
 * FK order in beforeAll and afterAll. No $transaction wrapping: the server
 * writes from another process, so the test observes committed state only. The
 * Redis revocation keys this suite sets are deleted in the same places.
 *
 * The fixture harness lives in this file rather than in a .ts module under
 * test/helpers/: apps/server/tsconfig.json includes test/** with rootDir pinned
 * to ./src and excludes only *.test.ts / *.spec.ts, so any other .ts file under
 * test/ would fail the server build (TS6059, see the comment in that file).
 *
 * REQUIRES: DATABASE_URL with migrations applied, REDIS_URL, and `pnpm run
 * build` in apps/server so dist/main.js exists. Deliberately not skipped when
 * dist is missing — the first case says so instead.
 */
import 'reflect-metadata';
import path from 'node:path';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { config as loadEnv, parse as parseEnv, populate as populateEnv } from 'dotenv';
import request from 'supertest';
import { Redis } from 'ioredis';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Pure modules (no Nest, no I/O): the production admin-token issuer and the
// canonical role-default tables the team routes write.
import { buildAdminToken } from '../src/core/auth/admin-token.util';
import { ROLE_DEFAULT_SCOPES, DEFAULT_APPROVAL_TIERS } from '../src/core/authority/module-vocabulary';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'ab_';
/** `_` is a LIKE wildcard; escape it so cleanup matches the literal prefix only. */
const LIKE_P = `'ab\\_%'`;
const SERVER_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_DIR, 'dist', 'main.js');

/** Test-only HS256 secret handed to the spawned server. Not a real secret. */
const JWT_SECRET = 'ab04-identity-boundary-test-jwt-secret-not-real';
/** Test-only admin-token secret (enables the ST-2 branch). Distinct from JWT_SECRET. Not a real secret. */
const ADMIN_JWT_SECRET = 'ab04-identity-boundary-test-admin-secret-not-real';

/**
 * PROVIDER ISOLATION OF THE CHILD (CR-1).
 *
 * dist/main.js calls dotenv on resolve(process.cwd(), '../../.env') before
 * anything else (main.ts:5), and the child's cwd is SERVER_DIR — so on any
 * machine with the standard repo-root .env the child would load the real
 * Supabase URL, anon key and service-role key, and the forged / expired /
 * wrong-aud / alg=none tokens below would fall back from verifyLocal to a
 * remote getUser, and logout would call the real admin API. dotenv never
 * overrides a key that is already present, and env.ts optionalNonEmpty reads
 * '' as unset, so every credential the child's dotenv could load is pinned to
 * '' in the child env. The list is computed from .env.example plus the actual
 * repo-root .env (when present), so a key a developer added is pinned too.
 */
const ROOT_ENV_FILE = path.resolve(SERVER_DIR, '../../.env'); // the file the child's dotenv reads
const ENV_EXAMPLE_FILE = path.resolve(SERVER_DIR, '../../.env.example');
/** The keys that produced real provider traffic in review (21 requests per run). Always pinned. */
const SUPABASE_PROVIDER_KEYS = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
];
/** Credentials and provider wiring: anything Supabase, S3/AWS as a group (env.ts validates S3 as a group), keys, secrets, tokens, SIDs, DSNs, client ids, remote MCP servers. */
const PROVIDER_KEY = /SUPABASE|^S3_|^AWS_|_API_KEY$|_KEY$|_KEY_ID$|_SECRET$|_SECRET_KEY$|_TOKEN$|_SID$|_DSN$|_PASSWORD_HASH$|_CLIENT_ID$|_SERVERS$/;
const envFileKeys = (file: string) => (existsSync(file) ? Object.keys(parseEnv(readFileSync(file))) : []);
const PINNED_PROVIDER_KEYS = [
  ...new Set([...SUPABASE_PROVIDER_KEYS, ...[...envFileKeys(ENV_EXAMPLE_FILE), ...envFileKeys(ROOT_ENV_FILE)].filter((k) => PROVIDER_KEY.test(k))]),
].sort();

const ID = {
  // identities
  owner: `${P}owner`,             // OWNER of bizA (ownerId + OWNER membership)
  admin: `${P}admin`,             // ADMIN of bizA, role-default scopes (team: write)
  staff: `${P}staff`,             // STAFF of bizA — removed through the team route (AB-P04)
  staffNoTeam: `${P}staffNoTeam`, // STAFF of bizA, explicit scopes { crm: read, team: none }
  ownerB: `${P}ownerB`,           // OWNER of bizB only
  deleted: `${P}deleted`,         // STAFF of bizA; User.deletedAt set mid-suite
  banned: `${P}banned`,           // STAFF of bizA; User.bannedAt set mid-suite
  revoked: `${P}revoked`,         // STAFF of bizA; Redis revocation marker set mid-suite
  noRow: `${P}noRow`,             // valid token, no User row at all
  // OPEN DEFECT fixtures — their own tenant (bizD) so nothing above is disturbed
  ownerD: `${P}ownerD`,           // OWNER of bizD
  adminR: `${P}adminR`,           // ADMIN of bizD restricted by the OWNER: { crm: read, team: write }, tier 0 (ST-1)
  adminD: `${P}adminD`,           // ADMIN of bizD, role-default scopes (team: write) (ST-1)
  staffR: `${P}staffR`,           // STAFF of bizD restricted by the OWNER: { crm: read, team: none } (ST-1)
  staffD: `${P}staffD`,           // STAFF of bizD, role-default scopes (settings: none) (ST-3)
  relogin: `${P}relogin`,         // STAFF of bizD; logs out, then the login marker clear (ST-4)
  adminTok: `${P}adminTok`,       // User row role SUPER_ADMIN at token issue, no membership (ST-2)
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizD: `${P}bizD`,
  nonexistentBiz: `${P}bizDoesNotExist`,
  // memberships
  mOwner: `${P}m_owner`,
  mAdmin: `${P}m_admin`,
  mStaff: `${P}m_staff`,
  mStaffNoTeam: `${P}m_staffNoTeam`,
  mOwnerB: `${P}m_ownerB`,
  mDeleted: `${P}m_deleted`,
  mBanned: `${P}m_banned`,
  mRevoked: `${P}m_revoked`,
  mOwnerD: `${P}m_ownerD`,
  mAdminR: `${P}m_adminR`,
  mAdminD: `${P}m_adminD`,
  mStaffR: `${P}m_staffR`,
  mStaffD: `${P}m_staffD`,
  mRelogin: `${P}m_relogin`,
};

/** Distinctive names, so a leak of either tenant row is detectable in any body. */
const BIZ_A_NAME = 'ab_bizA-name-3e7d0a';
const BIZ_B_NAME = 'ab_bizB-private-name-91c4f2';
const BIZ_D_NAME = 'ab_bizD-name-5b28e1';

const email = (id: string) => `${id}@ab04.test.local`;
const revocationKey = (userId: string) => `auth:revoked:user:${userId}`;
const ALL_USERS = [
  ID.owner, ID.admin, ID.staff, ID.staffNoTeam, ID.ownerB, ID.deleted, ID.banned, ID.revoked, ID.noRow,
  ID.ownerD, ID.adminR, ID.adminD, ID.staffR, ID.staffD, ID.relogin, ID.adminTok,
];

const IDLE_MS = 90_000;      // silence from the child counts; slow-but-talking does not
const HARD_CAP_MS = 240_000; // backstop for a child that chatters forever

// ---------------------------------------------------------------------------
// harness state
// ---------------------------------------------------------------------------
let db: any;
let redis: Redis | null = null;
let child: ChildProcess | null = null;
let baseUrl = '';
let bootDiagnosis: string | null = null;
let childExitCode: number | null | undefined = undefined;
const serverLog: string[] = [];

const T: Record<string, string> = {};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An HS256 JWT shaped like a Supabase access token, signed with the test secret. */
function mintToken(
  sub: string,
  opts: { secret?: string; expiresInSec?: number; aud?: string; alg?: string; claims?: Record<string, unknown> } = {},
) {
  const alg = opts.alg ?? 'HS256';
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub,
      email: email(sub),
      aud: opts.aud ?? 'authenticated',
      role: 'authenticated',
      iat: now,
      exp: now + (opts.expiresInSec ?? 3600),
      ...(opts.claims ?? {}),
    }),
  );
  if (alg === 'none') return `${header}.${payload}.`;
  const sig = createHmac('sha256', opts.secret ?? JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function requireServer() {
  if (!baseUrl || childExitCode !== undefined) {
    throw new Error(
      `The real server is not serving (${bootDiagnosis ?? 'not started'}). ` +
        'Nothing below can be measured; see the harness cases above.\n' +
        serverLog.slice(-8).join('\n'),
    );
  }
}

type Resp = { status: number; body: any };
async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  route: string,
  token?: string | null,
  body?: unknown,
): Promise<Resp> {
  requireServer();
  let req = request(baseUrl)[method](route);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as object);
  const res = await req;
  return { status: res.status, body: res.body };
}

const routes = {
  me: '/identity/me',
  list: '/identity/businesses',
  biz: (id: string) => `/identity/businesses/${id}`,
  team: (id: string) => `/identity/businesses/${id}/team`,
  member: (id: string, m: string) => `/identity/businesses/${id}/team/${m}`,
  perms: (id: string, m: string) => `/identity/businesses/${id}/team/${m}/permissions`,
  crmContacts: (id: string) => `/crm/businesses/${id}/contacts?take=5`,
  /** A read gated on settings:read (IntelligenceController.listRules). */
  settingsRead: (id: string) => `/intelligence/businesses/${id}/rules`,
};

/** An admin token from the PRODUCTION issuer (buildAdminToken), as AdminAuthService.generateToken mints it. */
const mintAdminToken = (sub: string, role: string) => buildAdminToken({ id: sub, email: email(sub), role }, ADMIN_JWT_SECRET);

/** A denial must carry no tenant row: no business fields, no tenant name, no list. */
function expectNoBusinessData(res: Resp) {
  expect(Array.isArray(res.body)).toBe(false);
  const text = JSON.stringify(res.body ?? {});
  for (const marker of [BIZ_A_NAME, BIZ_B_NAME, ID.ownerB, email(ID.owner)]) expect(text).not.toContain(marker);
  for (const key of ['name', 'ownerId', 'slug', 'timezone', 'currency', 'members', 'owner', 'permissionScopes', 'user']) {
    expect(res.body).not.toHaveProperty(key);
  }
}

/** Every route that must refuse an identity that is not (or no longer) valid. */
async function expectIdentityRefused(token: string | null, label: string) {
  const checks: Array<[string, string]> = [
    ['GET', routes.me],
    ['GET', routes.list],
    ['GET', routes.biz(ID.bizA)],
    ['GET', routes.team(ID.bizA)],
    ['GET', routes.crmContacts(ID.bizA)],
  ];
  for (const [, route] of checks) {
    const res = await call('get', route, token);
    expect(res.status, `${label}: GET ${route} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(401);
    expectNoBusinessData(res);
  }
}

async function cleanup() {
  const statements = [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${LIKE_P} OR user_id LIKE ${LIKE_P}`,
    // POST /identity/logout audits the event against the user id.
    `DELETE FROM auth_audit_logs WHERE user_id LIKE ${LIKE_P}`,
    // RESTRICT/child rows a listener could have seeded for an ab_ business.
    `DELETE FROM activities WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM business_events WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM agent_triggers WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM autopilot_settings WHERE business_id LIKE ${LIKE_P}`,
    // PATCH /identity/businesses/:id mirrors some fields into the blueprint (ST-3 case avoids them; defensive).
    `DELETE FROM business_blueprints WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM memberships WHERE id LIKE ${LIKE_P} OR business_id LIKE ${LIKE_P} OR user_id LIKE ${LIKE_P}`,
    `DELETE FROM businesses WHERE id LIKE ${LIKE_P} OR owner_id LIKE ${LIKE_P}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${LIKE_P}`,
    `DELETE FROM users WHERE id LIKE ${LIKE_P}`,
  ];
  for (const sql of statements) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
  if (redis) {
    try { await redis.del(...ALL_USERS.map(revocationKey)); } catch { /* best-effort */ }
  }
  const left = await db.$queryRawUnsafe(
    `SELECT (SELECT count(*)::int FROM businesses WHERE id LIKE ${LIKE_P}) AS businesses, ` +
      `(SELECT count(*)::int FROM users WHERE id LIKE ${LIKE_P}) AS users, ` +
      `(SELECT count(*)::int FROM memberships WHERE id LIKE ${LIKE_P}) AS memberships`,
  );
  return left?.[0] ?? { businesses: -1, users: -1, memberships: -1 };
}

async function seed() {
  for (const id of [ID.owner, ID.admin, ID.staff, ID.staffNoTeam, ID.ownerB, ID.deleted, ID.banned, ID.revoked]) {
    await db.user.create({ data: { id, email: email(id), name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: BIZ_A_NAME, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: BIZ_B_NAME, ownerId: ID.ownerB } });
  const memberships: Array<{ id: string; userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { id: ID.mOwner, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { id: ID.mAdmin, userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { id: ID.mStaff, userId: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { id: ID.mStaffNoTeam, userId: ID.staffNoTeam, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', team: 'none' } },
    { id: ID.mOwnerB, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    { id: ID.mDeleted, userId: ID.deleted, businessId: ID.bizA, role: 'STAFF' },
    { id: ID.mBanned, userId: ID.banned, businessId: ID.bizA, role: 'STAFF' },
    { id: ID.mRevoked, userId: ID.revoked, businessId: ID.bizA, role: 'STAFF' },
  ];
  for (const m of memberships) await db.membership.create({ data: m });

  // OPEN DEFECT fixtures (bizD).
  for (const id of [ID.ownerD, ID.adminR, ID.adminD, ID.staffR, ID.staffD, ID.relogin]) {
    await db.user.create({ data: { id, email: email(id), name: id, role: 'USER' } });
  }
  // SUPER_ADMIN when its admin token is issued; demoted mid-suite (ST-2).
  await db.user.create({ data: { id: ID.adminTok, email: email(ID.adminTok), name: ID.adminTok, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.bizD, name: BIZ_D_NAME, ownerId: ID.ownerD, defaultTaxRate: 0 } });
  const defectMemberships: Array<{ id: string; userId: string; businessId: string; role: string; permissionScopes?: Record<string, string>; maxApprovalTier?: number }> = [
    { id: ID.mOwnerD, userId: ID.ownerD, businessId: ID.bizD, role: 'OWNER' },
    { id: ID.mAdminR, userId: ID.adminR, businessId: ID.bizD, role: 'ADMIN', permissionScopes: { crm: 'read', team: 'write' }, maxApprovalTier: 0 },
    { id: ID.mAdminD, userId: ID.adminD, businessId: ID.bizD, role: 'ADMIN' },
    { id: ID.mStaffR, userId: ID.staffR, businessId: ID.bizD, role: 'STAFF', permissionScopes: { crm: 'read', team: 'none' } },
    { id: ID.mStaffD, userId: ID.staffD, businessId: ID.bizD, role: 'STAFF' },
    { id: ID.mRelogin, userId: ID.relogin, businessId: ID.bizD, role: 'STAFF' },
  ];
  for (const m of defectMemberships) await db.membership.create({ data: m });
}

/**
 * The child's whole environment: every provider credential pinned to '' first
 * (CR-1, see PINNED_PROVIDER_KEYS), then the allow-list the harness needs.
 * NOT a copy of process.env.
 */
function childEnv(port: number): Record<string, string> {
  return {
    ...Object.fromEntries(PINNED_PROVIDER_KEYS.map((k) => [k, ''])),
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    // The same Redis this process writes revocation markers into.
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    NODE_ENV: 'test',
    PORT: String(port),
    AI_DISABLED: '1',
    DISABLE_SCHEDULERS: '1',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    // Enables the admin-token fallback in AuthMiddleware so ST-2 is measured.
    // Every other case is unaffected: none of their tokens carries an
    // ADMIN_JWT_SECRET signature.
    ADMIN_JWT_SECRET,
    RATE_LIMIT_MAX_REQUESTS: '100000',
  };
}

function bootServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [ENTRY], { cwd: SERVER_DIR, env: childEnv(port), stdio: ['ignore', 'pipe', 'pipe'] });

    let settled = false;
    let idle: NodeJS.Timeout;
    const finish = (diagnosis: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(hardCap);
      clearInterval(poll);
      bootDiagnosis = diagnosis;
      if (diagnosis && child) child.kill('SIGKILL');
      resolve();
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(`no output for ${IDLE_MS}ms — the boot is stuck, not slow`), IDLE_MS);
    };
    armIdle();
    const hardCap = setTimeout(() => finish(`never became ready within ${HARD_CAP_MS}ms`), HARD_CAP_MS);

    const read = (buf: Buffer) => {
      armIdle();
      for (const line of stripAnsi(buf.toString()).split('\n')) if (line.trim()) serverLog.push(line);
      const failure = serverLog
        .slice(-20)
        .join('\n')
        .match(/(UndefinedDependencyException|Nest can't resolve dependencies of the [^\n]+|ERROR \[ExceptionHandler\][^\n]+|EAFNOSUPPORT[^\n]+|EADDRINUSE[^\n]+)/);
      if (failure) finish(failure[0]);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('error', (e) => finish(`spawn failed: ${e.message}`));
    child.on('exit', (code) => {
      childExitCode = code;
      finish(`exited with code ${code} before serving`);
    });

    const candidate = `http://127.0.0.1:${port}`;
    const poll = setInterval(() => {
      request(candidate)
        .get('/readyz')
        .then((res) => {
          if (res.status === 200) {
            baseUrl = candidate;
            finish(null);
          }
        })
        .catch(() => { /* not listening yet */ });
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();

  await cleanup(); // in case a prior run aborted
  await seed();

  for (const id of ALL_USERS) T[id] = mintToken(id);

  if (!existsSync(ENTRY)) {
    bootDiagnosis = 'dist/main.js is missing — run `pnpm run build` in apps/server first';
    return;
  }
  const port = await freePort();
  await bootServer(port);
}, HARD_CAP_MS + 30_000);

afterAll(async () => {
  if (child && childExitCode === undefined) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child?.kill('SIGKILL'); resolve(); }, 8_000);
      child!.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  if (db) {
    const left = await cleanup();
    if (left.businesses !== 0 || left.users !== 0 || left.memberships !== 0) {
      console.warn(`[identity-boundary] cleanup left rows behind: ${JSON.stringify(left)}`);
    }
  }
  if (redis) await redis.quit().catch(() => undefined);
}, 60_000);

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
describe('harness — the real built server is serving, with the ab_ fixtures in place', () => {
  it('dist/main.js exists (build before running this)', () => {
    expect(existsSync(ENTRY), 'dist/main.js is missing: `pnpm run build` in apps/server').toBe(true);
  });

  it('reached /readyz on a free port, against DATABASE_URL', async () => {
    expect(bootDiagnosis, `server did not come up: ${bootDiagnosis}\n${serverLog.slice(-10).join('\n')}`).toBeNull();
    const res = await request(baseUrl).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.db?.ok).toBe(true);
  });

  it('fixtures: bizA has its 7 members, bizB only its owner, the noRow identity has no User row', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(7);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.user.findUnique({ where: { id: ID.noRow } })).toBeNull();
    // OPEN DEFECT fixtures live in their own tenant.
    expect(await db.membership.count({ where: { businessId: ID.bizD } })).toBe(6);
    expect(await db.membership.count({ where: { userId: ID.adminTok } })).toBe(0);
  });

  it('CR-1: no provider credential can reach the child through its own dotenv.config — every one is pinned, and dotenv never overrides a present key', () => {
    const env = childEnv(0);
    // The list is not vacuous: it covers what .env.example declares, Supabase first.
    expect(envFileKeys(ENV_EXAMPLE_FILE).length, '.env.example must be readable').toBeGreaterThan(0);
    expect(PINNED_PROVIDER_KEYS).toEqual(expect.arrayContaining([
      ...SUPABASE_PROVIDER_KEYS,
      'AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY',
      'STRIPE_SECRET_KEY', 'TWILIO_AUTH_TOKEN', 'SENTRY_DSN', 'S3_ACCESS_KEY_ID', 'MCP_REMOTE_SERVERS',
    ]));
    for (const key of PINNED_PROVIDER_KEYS) expect(Object.prototype.hasOwnProperty.call(env, key), key).toBe(true);
    for (const key of SUPABASE_PROVIDER_KEYS) expect(env[key], key).toBe('');

    // Run the child's own merge — dotenv's populate, override off, exactly what
    // config() does — with a repo-root .env that sets every key we know of.
    const leakedValue = 'LEAKED-FROM-REPO-ROOT-DOTENV';
    const fakeRootEnv = Object.fromEntries(
      [...envFileKeys(ENV_EXAMPLE_FILE), ...envFileKeys(ROOT_ENV_FILE), ...SUPABASE_PROVIDER_KEYS].map((k) => [k, leakedValue]),
    );
    const merged: Record<string, string> = { ...env };
    populateEnv(merged, fakeRootEnv);
    expect(PINNED_PROVIDER_KEYS.filter((k) => merged[k] === leakedValue)).toEqual([]);
    for (const key of SUPABASE_PROVIDER_KEYS) expect(merged[key], key).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AB-P01
// ---------------------------------------------------------------------------
describe('AB-P01 — a valid user with a membership reaches their own business', () => {
  it('OWNER: GET /identity/businesses/:A -> 200 with the tenant row, provider secrets stripped', async () => {
    const res = await call('get', routes.biz(ID.bizA), T[ID.owner]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.bizA, name: BIZ_A_NAME, ownerId: ID.owner });
    for (const secret of ['gmailAccessToken', 'gmailRefreshToken', 'calendarRefreshToken', 'bpAccessToken']) {
      expect(res.body).not.toHaveProperty(secret);
    }
  });

  it('a non-owner member (STAFF) is admitted by membership alone', async () => {
    const res = await call('get', routes.biz(ID.bizA), T[ID.staffNoTeam]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(ID.bizA);
  });

  it('GET /identity/me returns the caller’s own User row, role read from the database', async () => {
    const res = await call('get', routes.me, T[ID.admin]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID.admin, email: email(ID.admin), role: 'USER' });
  });
});

// ---------------------------------------------------------------------------
// AB-P02 — invalid identity
// ---------------------------------------------------------------------------
describe('AB-P02 — an invalid identity is refused with 401 and no data', () => {
  it('no bearer token', async () => {
    await expectIdentityRefused(null, 'anonymous');
  });

  it('forged signature (signed with another secret)', async () => {
    await expectIdentityRefused(mintToken(ID.owner, { secret: 'not-the-server-secret' }), 'forged');
  });

  it('expired token', async () => {
    await expectIdentityRefused(mintToken(ID.owner, { expiresInSec: -60 }), 'expired');
  });

  it('wrong audience', async () => {
    await expectIdentityRefused(mintToken(ID.owner, { aud: 'service_role' }), 'wrong aud');
  });

  it('unsigned alg=none token', async () => {
    await expectIdentityRefused(mintToken(ID.owner, { alg: 'none' }), 'alg none');
  });

  it('role claims in the token payload are ignored: a token claiming SUPER_ADMIN gets no bypass into another tenant', async () => {
    const escalated = mintToken(ID.ownerB, { claims: { role: 'SUPER_ADMIN', app_metadata: { role: 'SUPER_ADMIN' } } });
    const biz = await call('get', routes.biz(ID.bizA), escalated);
    expect(biz.status).toBe(403);
    expectNoBusinessData(biz);
    const me = await call('get', routes.me, escalated);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('USER');
  });
});

// ---------------------------------------------------------------------------
// AB-P02 / AB-P04 — revoked identity (fresh request)
// ---------------------------------------------------------------------------
// Supabase-token branch only. The admin-token branch does NOT apply any of
// these checks — see "OPEN DEFECT ST-2" at the end of this file.
describe('AB-P02/AB-P04 (Supabase-token branch) — a deleted, banned or revoked identity is refused on the next request', () => {
  async function expectServed(token: string, label: string) {
    const me = await call('get', routes.me, token);
    expect(me.status, `${label}: /identity/me ${JSON.stringify(me.body)}`).toBe(200);
    const biz = await call('get', routes.biz(ID.bizA), token);
    expect(biz.status, `${label}: /identity/businesses/:A ${JSON.stringify(biz.body)}`).toBe(200);
    const crm = await call('get', routes.crmContacts(ID.bizA), token);
    expect(crm.status, `${label}: CRM contacts ${JSON.stringify(crm.body)}`).toBe(200);
  }

  it('User.deletedAt set: the token that was served a moment ago gets 401 on /identity/me and on business routes', async () => {
    await expectServed(T[ID.deleted], 'before delete');
    await db.user.update({ where: { id: ID.deleted }, data: { deletedAt: new Date() } });
    await expectIdentityRefused(T[ID.deleted], 'deletedAt');
    // The membership is untouched — the refusal is the identity check, not a missing membership.
    expect(await db.membership.findUnique({ where: { id: ID.mDeleted } })).not.toBeNull();
  });

  it('User.bannedAt set: 401 on the next request, membership still present', async () => {
    await expectServed(T[ID.banned], 'before ban');
    await db.user.update({ where: { id: ID.banned }, data: { bannedAt: new Date() } });
    await expectIdentityRefused(T[ID.banned], 'bannedAt');
    expect(await db.membership.findUnique({ where: { id: ID.mBanned } })).not.toBeNull();
  });

  it('Redis revocation marker present: 401 on the next request; clearing it restores access (the marker is the cause)', async () => {
    // Clearing the marker re-admits the SAME pre-revocation token: the marker is
    // per user and carries no iat cutoff. POST /identity/login performs exactly
    // this clear — that is OPEN DEFECT ST-4 (see the end of this file).
    await expectServed(T[ID.revoked], 'before revocation');
    await redis!.setex(revocationKey(ID.revoked), 300, '1');
    await expectIdentityRefused(T[ID.revoked], 'revocation marker');
    await redis!.del(revocationKey(ID.revoked));
    await expectServed(T[ID.revoked], 'after the marker is cleared');
  });

  it('POST /identity/logout — the production writer of that marker — refuses the same token on the next request', async () => {
    // Every SUPABASE_* key is pinned to '' in the child (childEnv, CR-1), so
    // SupabaseAdminService has no client: signOut throws locally before any
    // request is built (logged and swallowed). What this case proves is the
    // Redis marker only — NOT a Supabase session revocation, which today never
    // happens even with Supabase configured (OPEN DEFECT CR-2).
    const out = await call('post', '/identity/logout', T[ID.revoked]);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body).toEqual({ status: 'logged_out' });
    expect(await redis!.get(revocationKey(ID.revoked))).toBe('1');
    await expectIdentityRefused(T[ID.revoked], 'after logout');
  });
});

// ---------------------------------------------------------------------------
// valid token, no User row — pinned
// ---------------------------------------------------------------------------
describe('valid token with no User row — the documented bootstrap-window behaviour (pinned)', () => {
  // AuthMiddleware.resolveLocalUser: "row absent -> a user who has not
  // bootstrapped yet. ATTACH, role USER. They can reach bootstrap and nothing
  // else meaningful, since every business-scoped route needs a membership."
  it('attached as role USER: /identity/me 404 "User not found", /identity/businesses 200 [], every business route 403', async () => {
    const me = await call('get', routes.me, T[ID.noRow]);
    expect(me.status).toBe(404);
    expect(me.body.message).toBe('User not found');

    const list = await call('get', routes.list, T[ID.noRow]);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);

    for (const route of [routes.biz(ID.bizA), routes.team(ID.bizA), routes.crmContacts(ID.bizA)]) {
      const res = await call('get', route, T[ID.noRow]);
      expect(res.status, `GET ${route} ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
    }
  });

  it('those reads create no User row and no membership', async () => {
    expect(await db.user.findUnique({ where: { id: ID.noRow } })).toBeNull();
    expect(await db.membership.count({ where: { userId: ID.noRow } })).toBe(0);
  });

  it('a revocation marker applies even with no User row', async () => {
    await redis!.setex(revocationKey(ID.noRow), 300, '1');
    const me = await call('get', routes.me, T[ID.noRow]);
    expect(me.status).toBe(401);
    await redis!.del(revocationKey(ID.noRow));
  });
});

// ---------------------------------------------------------------------------
// AB-P03
// ---------------------------------------------------------------------------
describe('AB-P03 — cross-business URL and foreign record id are denied', () => {
  it('member of A: GET /identity/businesses/:B -> 403 with no business fields in the body', async () => {
    for (const actor of [ID.owner, ID.admin, ID.staffNoTeam]) {
      const res = await call('get', routes.biz(ID.bizB), T[actor]);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
    }
  });

  it('a foreign business id and a nonexistent one answer identically (no existence oracle)', async () => {
    const foreign = await call('get', routes.biz(ID.bizB), T[ID.owner]);
    const missing = await call('get', routes.biz(ID.nonexistentBiz), T[ID.owner]);
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body.message).toBe(missing.body.message);
  });

  it('GET /identity/businesses lists only the caller’s businesses', async () => {
    const expected: Array<[string, string[]]> = [
      [ID.owner, [ID.bizA]],
      [ID.admin, [ID.bizA]],
      [ID.staffNoTeam, [ID.bizA]],
      [ID.ownerB, [ID.bizB]],
    ];
    for (const [actor, ids] of expected) {
      const res = await call('get', routes.list, T[actor]);
      expect(res.status).toBe(200);
      expect(res.body.map((b: any) => b.id), actor).toEqual(ids);
    }
  });

  it('owner of B is refused on A’s team routes and cannot remove A’s member; the row is intact', async () => {
    const team = await call('get', routes.team(ID.bizA), T[ID.ownerB]);
    expect(team.status).toBe(403);
    expectNoBusinessData(team);
    const del = await call('delete', routes.member(ID.bizA, ID.mStaffNoTeam), T[ID.ownerB]);
    expect(del.status).toBe(403);
    expect(await db.membership.findUnique({ where: { id: ID.mStaffNoTeam } })).not.toBeNull();
  });

  it('owner of A cannot reach a B membership through A’s URL (foreign record id): 404, B unchanged', async () => {
    const del = await call('delete', routes.member(ID.bizA, ID.mOwnerB), T[ID.owner]);
    expect(del.status).toBe(404);
    const perms = await call('patch', routes.perms(ID.bizA, ID.mOwnerB), T[ID.owner], {
      scopes: { crm: 'none' },
      maxApprovalTier: 0,
    });
    expect(perms.status).toBe(404);
    const row = await db.membership.findUnique({ where: { id: ID.mOwnerB } });
    expect(row).toMatchObject({ businessId: ID.bizB, role: 'OWNER', permissionScopes: null });
  });
});

// ---------------------------------------------------------------------------
// AB-P04
// ---------------------------------------------------------------------------
describe('AB-P04 — a member removed through the real team route is denied on the very next request', () => {
  it('DELETE /identity/businesses/:A/team/:membershipId, then the same token on GET /identity/businesses/:A -> 403', async () => {
    const before = await call('get', routes.biz(ID.bizA), T[ID.staff]);
    expect(before.status, JSON.stringify(before.body)).toBe(200);

    const removed = await call('delete', routes.member(ID.bizA, ID.mStaff), T[ID.owner]);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body).toEqual({ success: true });
    expect(await db.membership.findUnique({ where: { id: ID.mStaff } })).toBeNull();

    // The very next request with the unchanged token.
    const after = await call('get', routes.biz(ID.bizA), T[ID.staff]);
    expect(after.status, JSON.stringify(after.body)).toBe(403);
    expectNoBusinessData(after);
  });

  it('the removed member no longer lists the business and is refused on its module routes', async () => {
    const list = await call('get', routes.list, T[ID.staff]);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
    const crm = await call('get', routes.crmContacts(ID.bizA), T[ID.staff]);
    expect(crm.status).toBe(403);
    expectNoBusinessData(crm);
  });
});

// ---------------------------------------------------------------------------
// team routes — module scope
// ---------------------------------------------------------------------------
describe('team routes — ModuleScopeGuard over the real membership rows', () => {
  it('STAFF with team:none: GET /identity/businesses/:A/team -> 403', async () => {
    const res = await call('get', routes.team(ID.bizA), T[ID.staffNoTeam]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(Array.isArray(res.body)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(email(ID.owner));
  });

  it('ADMIN (team:write by role default) reads the team, but PATCH .../permissions (requires team:admin) -> 403 and the target is unchanged', async () => {
    const team = await call('get', routes.team(ID.bizA), T[ID.admin]);
    expect(team.status, JSON.stringify(team.body)).toBe(200);

    const res = await call('patch', routes.perms(ID.bizA, ID.mStaffNoTeam), T[ID.admin], {
      scopes: { crm: 'admin', team: 'admin' },
      maxApprovalTier: 4,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const row = await db.membership.findUnique({ where: { id: ID.mStaffNoTeam } });
    expect(row.permissionScopes).toEqual({ crm: 'read', team: 'none' });
    expect(row.maxApprovalTier).toBe(0);

    // THIS route's change did not land: the target is still refused the team
    // route. The team:admin gate is NOT the only way to rewrite scopes — the
    // role route (team:write) resets them to role defaults, which a team:write
    // member can use on itself or others: OPEN DEFECT ST-1 at the end of this file.
    const still = await call('get', routes.team(ID.bizA), T[ID.staffNoTeam]);
    expect(still.status).toBe(403);
  });

  it('OWNER: PATCH .../permissions -> 200 and the row is updated; GET team -> 200 listing only A’s members', async () => {
    const res = await call('patch', routes.perms(ID.bizA, ID.mStaffNoTeam), T[ID.owner], {
      scopes: { crm: 'write', team: 'none' },
      maxApprovalTier: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.permissionScopes).toEqual({ crm: 'write', team: 'none' });
    const row = await db.membership.findUnique({ where: { id: ID.mStaffNoTeam } });
    expect(row.permissionScopes).toEqual({ crm: 'write', team: 'none' });
    expect(row.maxApprovalTier).toBe(1);

    const team = await call('get', routes.team(ID.bizA), T[ID.owner]);
    expect(team.status).toBe(200);
    const ids = (team.body as any[]).map((m) => m.id).sort();
    expect(ids).toEqual([ID.mAdmin, ID.mBanned, ID.mDeleted, ID.mOwner, ID.mRevoked, ID.mStaffNoTeam].sort());
    expect(ids).not.toContain(ID.mOwnerB);
    expect(JSON.stringify(team.body)).not.toContain(BIZ_B_NAME);
  });

  it('a scope change through the real route takes effect on the very next request, in both directions', async () => {
    const grant = await call('patch', routes.perms(ID.bizA, ID.mStaffNoTeam), T[ID.owner], {
      scopes: { crm: 'write', team: 'read' },
      maxApprovalTier: 1,
    });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    const granted = await call('get', routes.team(ID.bizA), T[ID.staffNoTeam]);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);

    const revoke = await call('patch', routes.perms(ID.bizA, ID.mStaffNoTeam), T[ID.owner], {
      scopes: { crm: 'write', team: 'none' },
      maxApprovalTier: 1,
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    const revoked = await call('get', routes.team(ID.bizA), T[ID.staffNoTeam]);
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// OPEN DEFECTS — found in review, reproduced against the real server.
//
// Each "OPEN DEFECT … reproduced" case pins TODAY's observed behaviour so the
// defect is recorded by an executing test, not by prose; it is NOT a
// certification of that behaviour. It turns red when the fix lands, and the fix
// packet replaces it with the it.todo next to it. Every fix is in source outside
// this proof packet's write set (identity.controller.ts, identity.service.ts,
// auth.middleware.ts, supabase-admin.service.ts).
// ---------------------------------------------------------------------------
describe('OPEN DEFECT ST-1 — the role route (team:write) rewrites permission scopes and gets around the team:admin gate', () => {
  it('OPEN DEFECT ST-1 reproduced — an OWNER-restricted ADMIN resets its OWN scopes to ADMIN defaults through PATCH .../team/:ownMembership {role}', async () => {
    const t = T[ID.adminR];
    // Restricted by the OWNER: { crm: read, team: write }, tier 0 — no settings.
    const settingsBefore = await call('get', routes.settingsRead(ID.bizD), t);
    expect(settingsBefore.status, JSON.stringify(settingsBefore.body)).toBe(403);

    // The certified gate holds: the permissions route needs team:admin.
    const perms = await call('patch', routes.perms(ID.bizD, ID.mAdminR), t, {
      scopes: { crm: 'admin', settings: 'admin', team: 'write' },
      maxApprovalTier: 3,
    });
    expect(perms.status, JSON.stringify(perms.body)).toBe(403);
    const unchanged = await db.membership.findUnique({ where: { id: ID.mAdminR } });
    expect(unchanged.permissionScopes).toEqual({ crm: 'read', team: 'write' });
    expect(unchanged.maxApprovalTier).toBe(0);

    // The role route (team:write, no self-target check) is answered 200 ...
    const self = await call('patch', routes.member(ID.bizD, ID.mAdminR), t, { role: 'ADMIN' });
    expect(self.status, JSON.stringify(self.body)).toBe(200);
    // ... and overwrites the OWNER's restriction with the ADMIN role defaults.
    const row = await db.membership.findUnique({ where: { id: ID.mAdminR } });
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(row.permissionScopes.settings).toBe('admin');
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.ADMIN);

    // Effective on the very next request.
    const settingsAfter = await call('get', routes.settingsRead(ID.bizD), t);
    expect(settingsAfter.status, JSON.stringify(settingsAfter.body)).toBe(200);
  });

  it('OPEN DEFECT ST-1 reproduced — an ADMIN (team:write) widens an OWNER-restricted STAFF to STAFF defaults through PATCH .../team/:m {role}', async () => {
    const t = T[ID.adminD];
    // The same widening through the permissions route is refused (team:admin) ...
    const perms = await call('patch', routes.perms(ID.bizD, ID.mStaffR), t, {
      scopes: { ...ROLE_DEFAULT_SCOPES.STAFF },
      maxApprovalTier: 0,
    });
    expect(perms.status, JSON.stringify(perms.body)).toBe(403);
    expect((await db.membership.findUnique({ where: { id: ID.mStaffR } })).permissionScopes).toEqual({ crm: 'read', team: 'none' });

    // ... the role route does it.
    const res = await call('patch', routes.member(ID.bizD, ID.mStaffR), t, { role: 'STAFF' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.membership.findUnique({ where: { id: ID.mStaffR } });
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
    // Modules the explicit map denied by absence are now readable.
    for (const m of ['revenue', 'operations', 'bookings', 'expenses']) expect(row.permissionScopes[m], m).toBe('read');
  });

  it.todo(
    'REQUIRED (fix packet; identity.controller.ts / identity.service.ts updateMemberRole, outside this write set): ' +
      'PATCH .../team/:membershipId {role} cannot set scopes or a tier the caller could not set through .../permissions (team:admin), ' +
      'and a non-OWNER cannot change its own membership — both cases above answer 403 with the row unchanged',
  );
});

describe('OPEN DEFECT ST-2 — the admin-token branch of AuthMiddleware skips every AB-P02 check', () => {
  // Issued by the production issuer while the User row is SUPER_ADMIN.
  let adminToken = '';

  it('OPEN DEFECT ST-2 reproduced — the role comes from the token: after the User row is demoted, the admin token still crosses into a foreign tenant', async () => {
    adminToken = mintAdminToken(ID.adminTok, 'SUPER_ADMIN');
    const legit = await call('get', routes.biz(ID.bizB), adminToken);
    expect(legit.status, `positive control while SUPER_ADMIN: ${JSON.stringify(legit.body)}`).toBe(200);

    await db.user.update({ where: { id: ID.adminTok }, data: { role: 'USER' } });
    // Supabase-token branch: role read from the row — refused.
    const viaSupabaseToken = await call('get', routes.biz(ID.bizB), T[ID.adminTok]);
    expect(viaSupabaseToken.status).toBe(403);
    expectNoBusinessData(viaSupabaseToken);
    // Admin-token branch: role read from the token — admitted, B's row returned.
    const viaAdminToken = await call('get', routes.biz(ID.bizB), adminToken);
    expect(viaAdminToken.status, JSON.stringify(viaAdminToken.body)).toBe(200);
    expect(viaAdminToken.body.name).toBe(BIZ_B_NAME);
  });

  it('OPEN DEFECT ST-2 reproduced — User.bannedAt and User.deletedAt are not checked: the admin token is still served', async () => {
    expect(adminToken, 'the previous case mints the token').not.toBe('');
    await db.user.update({ where: { id: ID.adminTok }, data: { bannedAt: new Date(), deletedAt: new Date() } });
    // Supabase-token branch: refused (AB-P02 holds there).
    await expectIdentityRefused(T[ID.adminTok], 'banned+deleted, Supabase token');
    // Admin-token branch: served.
    const biz = await call('get', routes.biz(ID.bizB), adminToken);
    expect(biz.status, JSON.stringify(biz.body)).toBe(200);
    expect(biz.body.name).toBe(BIZ_B_NAME);
    const team = await call('get', routes.team(ID.bizB), adminToken);
    expect(team.status, JSON.stringify(team.body)).toBe(200);
  });

  it('OPEN DEFECT ST-2 reproduced — the logout revocation marker is not checked: after POST /identity/logout the admin token is still served', async () => {
    expect(adminToken, 'the first case mints the token').not.toBe('');
    const out = await call('post', '/identity/logout', adminToken);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(await redis!.get(revocationKey(ID.adminTok))).toBe('1');
    const biz = await call('get', routes.biz(ID.bizB), adminToken);
    expect(biz.status, JSON.stringify(biz.body)).toBe(200);
    // The same user's Supabase token is refused by that marker.
    const me = await call('get', routes.me, T[ID.adminTok]);
    expect(me.status).toBe(401);
  });

  it.todo(
    'REQUIRED (fix packet; auth.middleware.ts, outside this write set): an admin token passes the same resolveLocalUser checks as a ' +
      'Supabase token — revocation marker, deletedAt, bannedAt — and its role is read from the User row; the three cases above answer 401 / 403',
  );
});

describe('OPEN DEFECT ST-3 — PATCH /identity/businesses/:id has no module scope', () => {
  it('OPEN DEFECT ST-3 reproduced — a STAFF member (settings:none) is refused a settings read but rewrites the tenant profile', async () => {
    const t = T[ID.staffD];
    const read = await call('get', routes.settingsRead(ID.bizD), t);
    expect(read.status, JSON.stringify(read.body)).toBe(403);

    // Fields outside the blueprint mirror (name would also be accepted; it is
    // left out so the server's async BusinessBlueprint mirror writes nothing).
    const res = await call('patch', routes.biz(ID.bizD), t, {
      slug: 'ab-bizd-hijacked-slug',
      defaultTaxRate: 99,
      storeEnabled: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.business.findUnique({ where: { id: ID.bizD } });
    expect(row).toMatchObject({ slug: 'ab-bizd-hijacked-slug', defaultTaxRate: 99, storeEnabled: true });
  });

  it.todo(
    'REQUIRED (fix packet; identity.controller.ts updateBusiness, outside this write set): PATCH /identity/businesses/:id requires a settings ' +
      'write scope (ModuleScopeGuard) — the STAFF case above answers 403 with the Business row unchanged',
  );
});

describe('OPEN DEFECT ST-4 — the revocation marker has no iat cutoff, and login deletes it', () => {
  it('OPEN DEFECT ST-4 mechanism reproduced — a token issued BEFORE logout is admitted again once the marker is cleared the way POST /identity/login clears it', async () => {
    const preLogout = T[ID.relogin]; // minted in beforeAll, before this logout
    const before = await call('get', routes.biz(ID.bizD), preLogout);
    expect(before.status, JSON.stringify(before.body)).toBe(200);

    const out = await call('post', '/identity/logout', preLogout);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect((await call('get', routes.me, preLogout)).status).toBe(401);

    // POST /identity/login runs exactly this after a successful
    // signInWithPassword (identity.controller.ts, login: redis.del of
    // auth:revoked:user:<id>). The Supabase leg cannot run here — no provider
    // traffic — so the clear is applied directly.
    await redis!.del(revocationKey(ID.relogin));
    const after = await call('get', routes.biz(ID.bizD), preLogout);
    expect(after.status, `pre-logout token after the login clear: ${JSON.stringify(after.body)}`).toBe(200);
  });

  it.todo(
    'REQUIRED (fix packet; identity.controller.ts login/logout + auth.middleware.ts, outside this write set): an access token issued before ' +
      'POST /identity/logout stays refused after a later POST /identity/login (revocation keyed on issue time, not a per-user flag the login deletes). ' +
      'The full login leg needs Supabase signInWithPassword and cannot run in this provider-free suite',
  );
});

describe('OPEN DEFECT CR-2 — logout never revokes the Supabase sessions', () => {
  it.todo(
    'REQUIRED (fix packet; identity.controller.ts logout, supabase-admin.service.ts signOut, identity-password.service.ts, outside this write set): ' +
      "logout's global sign-out revokes the user's Supabase sessions. Today supabaseAdmin.signOut(userId, 'global') hands the USER ID to " +
      "auth-js admin.signOut(jwt, scope), which expects the user's access JWT, so the provider refuses and the refusal is swallowed. " +
      'Not observable here: the child has no Supabase admin (CR-1 pins every SUPABASE_* key blank)',
  );
});
