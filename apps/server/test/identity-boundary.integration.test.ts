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
 * SCOPE OF THE AB-P02 CLAIM: it holds on both branches of AuthMiddleware.use.
 * The child also gets a test-only ADMIN_JWT_SECRET so the second branch — the
 * admin-token fallback — is exercised too. Until R0-ID-F2-ADMIN-TOKEN-LOCAL-USER
 * AB-P02 did NOT hold there (ST-2 below); that branch now runs the same
 * resolveLocalUser row checks (deletedAt, bannedAt), reads the role from the
 * User row, and refuses a subject with no User row. Its logout revocation is
 * the admin token's own issue-time cutoff (POST /api/admin/auth/logout), not
 * the per-user marker POST /identity/logout sets (review finding F1: honouring
 * that marker locked the admin out of every later admin login for 24h).
 *
 * OPEN DEFECTS (review of this packet; NOT fixed here — every fix is in source
 * outside this proof packet's write set, so each is reproduced by an
 * "OPEN DEFECT … reproduced" case that pins today's observed behaviour and
 * turns red when the fix lands, next to an it.todo naming the required
 * behaviour for the fix packet):
 *   ST-1  FIXED ON THE ROLE AND PERMISSIONS ROUTES by
 *         R0-ID-F1-ROLE-ROUTE-AUTHORITY and its review repairs (their cases
 *         assert the required behaviour; see "ST-1 (fixed …)" and "ST-1 review
 *         repairs" below). PATCH /identity/businesses/:id/team/:membershipId
 *         {role} needed only team:write, reset permissionScopes/maxApprovalTier
 *         to the role defaults and had no self-target check — a team:write
 *         member got around the team:admin gate on .../permissions, for itself
 *         or others (identity.controller.ts updateMemberRole,
 *         identity.service.ts updateMemberRole). Both routes now refuse a
 *         non-OWNER self-target and bound a non-OWNER requester by its own
 *         authority, on what it grants and on whom it rewrites.
 *         NOT CLOSED END TO END: the original outcome (a member undoing the
 *         OWNER's restriction on itself) is still reachable through two
 *         sibling team:write routes with no grantor ceiling, each pinned below:
 *   ST-F4 the invite route mints any scopes and tier, so a restricted
 *         team:write member invites an account it controls with team:admin,
 *         which then resets the member through the role route (V1-07).
 *   CR-1  the structure routes copy a JobRole's permissions and tier onto any
 *         membership in the business, the caller's own included
 *         (structure.service.ts createAssignment; V1-21).
 *   ST-2  FIXED by R0-ID-F2-ADMIN-TOKEN-LOCAL-USER (its cases assert the
 *         required behaviour; see "ST-2 (fixed …)" below). The admin-token
 *         branch attached verifyAdminToken's result directly: no revocation
 *         marker, no deletedAt/bannedAt, role from the token
 *         (auth.middleware.ts). NOT CLOSED on one sibling path, pinned below:
 *         the KEY Cortex WebSocket admin-token path still skips every
 *         local-user check (ST-2-WS). (POST /identity/logout not revoking an
 *         admin token was the admin half of ST-4, fixed with it.)
 *   ST-2-WS key-cortex-ws-auth.service.ts authenticateSocket takes the role
 *         from an admin token and checks neither deletedAt, bannedAt nor the
 *         marker, and verifyBusinessMembership lets SUPER_ADMIN into any
 *         tenant's socket; its Supabase path falls back to USER on a DB error.
 *   ST-3  PATCH /identity/businesses/:id has no ModuleScopeGuard: a
 *         settings:none member rewrites the tenant profile
 *         (identity.controller.ts updateBusiness).
 *   ST-4  FIXED by R0-ID-F3-REVOCATION-IAT-CUTOFF (its cases assert the
 *         required behaviour; see "ST-4 — logout revocation is an issue-time
 *         cutoff" and "ST-4 (admin tokens)" below). The revocation marker was
 *         per user with no iat cutoff and POST /identity/login deleted it, so a
 *         pre-logout token was admitted again after the next login; for admin
 *         tokens POST /identity/logout revoked nothing at all. The marker now
 *         holds the logout time (epoch seconds), login leaves it alone, the
 *         middleware refuses a token issued at or before it, and logout also
 *         writes the admin cutoff (admin:user:<id>:revokedAt). A bare '1' left
 *         by the previous release reads as "revoked now".
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
import { createHmac, scryptSync } from 'node:crypto';
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
 * Test-only admin login credentials for the adminTok fixture, so POST
 * /api/admin/auth/login runs in the child (review finding F1: admin logout,
 * then admin login). Hash format as AdminAuthService.verifyPassword reads it:
 * `<salt>:<scrypt(password, salt, 64) hex>`. Not real credentials.
 */
const ADMIN_PASSWORD = 'ab04-identity-boundary-test-admin-password-not-real';
const ADMIN_PASSWORD_SALT = 'ab04identityboundarysalt';
const ADMIN_PASSWORD_HASH = `${ADMIN_PASSWORD_SALT}:${scryptSync(ADMIN_PASSWORD, ADMIN_PASSWORD_SALT, 64).toString('hex')}`;

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
  adminT: `${P}adminT`,           // ADMIN of bizD granted team:admin by the OWNER (ADMIN defaults + team: admin), tier 3 (ST-1 fix)
  staffT: `${P}staffT`,           // STAFF of bizD granted team:admin by the OWNER but nothing else: { crm: read, team: admin }, tier 0 (ST-1 fix)
  staffP: `${P}staffP`,           // STAFF of bizD, role-default scopes — the target of the ST-1 fix's allowed role changes
  staffA: `${P}staffA`,           // STAFF of bizD: STAFF defaults + team: admin, tier 0 — bounded by whom it rewrites (ST-F5)
  adminC: `${P}adminC`,           // ADMIN of bizD: ADMIN defaults + team: admin + CRM "my book" sub-permissions, tier 3 (ST-F3)
  staffC: `${P}staffC`,           // STAFF of bizD: { crm: read, crm_view: owned, crm_edit/crm_delete: none, crm_reassign: false } (ST-F3)
  adminW: `${P}adminW`,           // ADMIN of bizD restricted by the OWNER: { crm: read, team: write }, tier 0 (OPEN DEFECT ST-F4)
  accomplice: `${P}accomplice`,   // User row only; invited into bizD by adminW mid-suite (OPEN DEFECT ST-F4)
  adminJ: `${P}adminJ`,           // ADMIN of bizD, role-default scopes (team: write) (OPEN DEFECT CR-1)
  staffD: `${P}staffD`,           // STAFF of bizD, role-default scopes (settings: none) (ST-3)
  relogin: `${P}relogin`,         // STAFF of bizD; logs out, then the login marker clear (ST-4)
  adminTok: `${P}adminTok`,       // User row role SUPER_ADMIN at token issue, no membership (ST-2)
  adminNoRow: `${P}adminNoRow`,   // subject of a valid admin token, no User row at all (ST-2 fix); not seeded
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
  mAdminT: `${P}m_adminT`,
  mStaffT: `${P}m_staffT`,
  mStaffP: `${P}m_staffP`,
  mStaffA: `${P}m_staffA`,
  mAdminC: `${P}m_adminC`,
  mStaffC: `${P}m_staffC`,
  mAdminW: `${P}m_adminW`,
  mAdminJ: `${P}m_adminJ`,
  mStaffD: `${P}m_staffD`,
  mRelogin: `${P}m_relogin`,
};

/** Distinctive names, so a leak of either tenant row is detectable in any body. */
const BIZ_A_NAME = 'ab_bizA-name-3e7d0a';
const BIZ_B_NAME = 'ab_bizB-private-name-91c4f2';
const BIZ_D_NAME = 'ab_bizD-name-5b28e1';

const email = (id: string) => `${id}@ab04.test.local`;
/** CRM ownership sub-permissions restricting a member to "my book", with no reassign and no delete (ST-F3). */
const CRM_OWNED_ONLY = { crm_view: 'owned', crm_edit: 'owned', crm_reassign: 'false', crm_delete: 'none' };
const revocationKey = (userId: string) => `auth:revoked:user:${userId}`;
/** The admin token's own issue-time cutoff, written by POST /api/admin/auth/logout (no TTL). */
const adminCutoffKey = (userId: string) => `admin:user:${userId}:revokedAt`;
const ALL_USERS = [
  ID.owner, ID.admin, ID.staff, ID.staffNoTeam, ID.ownerB, ID.deleted, ID.banned, ID.revoked, ID.noRow,
  ID.ownerD, ID.adminR, ID.adminD, ID.staffR, ID.adminT, ID.staffT, ID.staffP, ID.staffD, ID.relogin, ID.adminTok,
  ID.staffA, ID.adminC, ID.staffC, ID.adminW, ID.accomplice, ID.adminJ, ID.adminNoRow,
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
  /** Structure routes, gated on team:write (OPEN DEFECT CR-1). */
  orgUnits: (id: string) => `/structure/businesses/${id}/org-units`,
  jobRoles: (id: string) => `/structure/businesses/${id}/job-roles`,
  assignments: (id: string) => `/structure/businesses/${id}/assignments`,
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

/** The longest token lifetime the logout marker must outlive: admin tokens live 24h, Supabase access tokens 1h by default. */
const MAX_TOKEN_LIFETIME_S = 24 * 60 * 60;

/**
 * ST-4 (R0-ID-F3): the logout marker holds the revocation time in epoch seconds
 * (within [before, after]) and lives at least as long as the longest token
 * lifetime. Returns the stored time.
 */
async function expectRevocationTime(userId: string, before: number, after: number): Promise<number> {
  const raw = await redis!.get(revocationKey(userId));
  expect(raw, 'the marker is the revocation time in epoch seconds, not a bare flag').toMatch(/^\d+$/);
  const at = Number(raw);
  expect(at, 'revocation time').toBeGreaterThanOrEqual(before);
  expect(at, 'revocation time').toBeLessThanOrEqual(after);
  expect(await redis!.ttl(revocationKey(userId)), 'marker TTL (seconds)').toBeGreaterThanOrEqual(MAX_TOKEN_LIFETIME_S - 60);
  return at;
}

/** Resolve once the wall clock is past `epochSec`, so a token minted next carries iat > epochSec. */
async function untilAfterSecond(epochSec: number) {
  while (Math.floor(Date.now() / 1000) <= epochSec) await new Promise((r) => setTimeout(r, 50));
}

/**
 * THE NEXT LOGIN, in this provider-free suite. POST /identity/login's Supabase
 * leg (signInWithPassword) cannot run here (CR-1), so the ST-4 cases apply its
 * effect on revocation state directly, exactly as identity.controller.ts login
 * has it. Until R0-ID-F3-REVOCATION-IAT-CUTOFF that effect was a delete of
 * auth:revoked:user:<id> after a successful sign-in (OPEN DEFECT ST-4); the
 * tests-first commit applied that delete and recorded the pre-logout token
 * served again. Login now touches neither the marker nor the admin cutoff —
 * pinned against the REAL login handler in auth.middleware.spec.ts ("the real
 * logout and login handlers, then the middleware") — so the cases apply
 * nothing and check that both keys still hold what the logout wrote.
 */
async function expectLoginLeavesRevocation(userId: string, marker: string, adminCutoff: string) {
  expect(await redis!.get(revocationKey(userId)), 'logout marker after the next login').toBe(marker);
  expect(await redis!.get(adminCutoffKey(userId)), 'admin cutoff after the next login').toBe(adminCutoff);
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
    // OPEN DEFECT CR-1 creates an org unit, a job role and an assignment in bizD.
    `DELETE FROM org_assignments WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM org_units WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM memberships WHERE id LIKE ${LIKE_P} OR business_id LIKE ${LIKE_P} OR user_id LIKE ${LIKE_P}`,
    `DELETE FROM businesses WHERE id LIKE ${LIKE_P} OR owner_id LIKE ${LIKE_P}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${LIKE_P}`,
    `DELETE FROM users WHERE id LIKE ${LIKE_P}`,
  ];
  for (const sql of statements) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
  if (redis) {
    try { await redis.del(...ALL_USERS.map(revocationKey), ...ALL_USERS.map(adminCutoffKey)); } catch { /* best-effort */ }
    // POST /api/admin/auth/login is limited to 5 a minute per IP (RateLimitGuard
    // key rate_limit:<ip>:global:login); clear the loopback window this suite
    // used so an immediate re-run is not refused with 429.
    try {
      const keys = await redis.keys('rate_limit:*:global:login');
      const loopback = keys.filter((k: string) => k.includes('127.0.0.1') || k.includes(':::1:'));
      if (loopback.length) await redis.del(...loopback);
    } catch { /* best-effort */ }
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
  for (const id of [
    ID.ownerD, ID.adminR, ID.adminD, ID.staffR, ID.adminT, ID.staffT, ID.staffP, ID.staffD, ID.relogin,
    ID.staffA, ID.adminC, ID.staffC, ID.adminW, ID.accomplice, ID.adminJ,
  ]) {
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
    { id: ID.mAdminT, userId: ID.adminT, businessId: ID.bizD, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' }, maxApprovalTier: 3 },
    { id: ID.mStaffT, userId: ID.staffT, businessId: ID.bizD, role: 'STAFF', permissionScopes: { crm: 'read', team: 'admin' }, maxApprovalTier: 0 },
    { id: ID.mStaffP, userId: ID.staffP, businessId: ID.bizD, role: 'STAFF' },
    { id: ID.mStaffA, userId: ID.staffA, businessId: ID.bizD, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, team: 'admin' }, maxApprovalTier: 0 },
    { id: ID.mAdminC, userId: ID.adminC, businessId: ID.bizD, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin', ...CRM_OWNED_ONLY }, maxApprovalTier: 3 },
    { id: ID.mStaffC, userId: ID.staffC, businessId: ID.bizD, role: 'STAFF', permissionScopes: { crm: 'read', ...CRM_OWNED_ONLY, crm_edit: 'none' }, maxApprovalTier: 0 },
    { id: ID.mAdminW, userId: ID.adminW, businessId: ID.bizD, role: 'ADMIN', permissionScopes: { crm: 'read', team: 'write' }, maxApprovalTier: 0 },
    { id: ID.mAdminJ, userId: ID.adminJ, businessId: ID.bizD, role: 'ADMIN' },
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
    // Admin login for the adminTok fixture only (F1 cases). validateCredentials
    // matches this email and then reads the adminTok User row.
    ADMIN_EMAIL: email(ID.adminTok),
    ADMIN_PASSWORD_HASH,
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
    expect(await db.membership.count({ where: { businessId: ID.bizD } })).toBe(14);
    // The ST-F4 accomplice has a User row and no membership until adminW invites it.
    expect(await db.membership.count({ where: { userId: ID.accomplice } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.adminTok } })).toBe(0);
    // The ST-2 no-row admin-token subject is never seeded.
    expect(await db.user.findUnique({ where: { id: ID.adminNoRow } })).toBeNull();
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
// Supabase-token branch. The admin-token branch applies the same checks since
// R0-ID-F2-ADMIN-TOKEN-LOCAL-USER — see "ST-2 (fixed …)" at the end of this file.
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

  it("Redis revocation marker in the previous release's bare-flag format ('1'): revoked at an unknown time, so every token issued up to now gets 401; once the marker is gone the token is served (the marker is the cause)", async () => {
    // ST-4 (R0-ID-F3): the marker now holds the revocation time in epoch
    // seconds. A bare '1' written by the previous release carries no time, so it
    // is read as "revoked now": the pre-revocation token AND a token minted this
    // instant are both refused. Nothing in the product deletes the marker any
    // more (POST /identity/login used to — OPEN DEFECT ST-4, fixed); only its
    // TTL ends it, and deleting it here stands in for that expiry.
    await expectServed(T[ID.revoked], 'before revocation');
    await redis!.setex(revocationKey(ID.revoked), 300, '1');
    await expectIdentityRefused(T[ID.revoked], 'bare-flag marker, pre-revocation token');
    await expectIdentityRefused(mintToken(ID.revoked), 'bare-flag marker, token minted now');
    await redis!.del(revocationKey(ID.revoked));
    await expectServed(T[ID.revoked], 'after the marker expired');
  });

  it('POST /identity/logout — the production writer of that marker — stores the revocation time (epoch seconds, TTL at or above the 24h token lifetime) and refuses the same token on the next request', async () => {
    // Every SUPABASE_* key is pinned to '' in the child (childEnv, CR-1), so
    // SupabaseAdminService has no client: signOut throws locally before any
    // request is built (logged and swallowed). What this case proves is the
    // Redis marker only — NOT a Supabase session revocation, which today never
    // happens even with Supabase configured (OPEN DEFECT CR-2).
    const before = Math.floor(Date.now() / 1000);
    const out = await call('post', '/identity/logout', T[ID.revoked]);
    const after = Math.floor(Date.now() / 1000);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body).toEqual({ status: 'logged_out' });
    await expectRevocationTime(ID.revoked, before, after);
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
    // route. The role route, which resets scopes to role defaults, now needs the
    // same team:admin authority and is bounded by the caller (ST-1, fixed by
    // R0-ID-F1-ROLE-ROUTE-AUTHORITY — see the end of this file).
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
// ST-1 — FIXED by R0-ID-F1-ROLE-ROUTE-AUTHORITY.
//
// The two "OPEN DEFECT ST-1 reproduced" cases pinned a team:write member
// rewriting scopes through the role route. They now assert the behaviour the
// it.todo next to them required, and the it.todo is gone. The cases after them
// pin the rest of the fix: the caller's ceiling (K2: an authority change is
// bounded by the grantor's current authority), the team:admin and OWNER
// positive controls, the actor on the team_activity_logs row, the OWNER role,
// and self-target. The review repairs after this block extend the same rules
// to PATCH .../permissions; the two sibling team:write paths that still reach
// the ST-1 outcome (invite, structure assignments) are pinned as OPEN DEFECTs
// ST-F4 and CR-1 at the end of this file.
// ---------------------------------------------------------------------------

/** The membership row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function membershipRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(m)::text AS j FROM memberships m WHERE m.id = $1', id);
  expect(rows.length, `membership ${id} exists`).toBe(1);
  return rows[0].j as string;
}

/** role_changed rows the server wrote for one membership, oldest first. */
async function roleChangeRows(membershipId: string) {
  return db.teamActivityLog.findMany({
    where: { businessId: ID.bizD, action: 'role_changed', entityId: membershipId },
    orderBy: { createdAt: 'asc' },
  });
}

describe('ST-1 (fixed, R0-ID-F1-ROLE-ROUTE-AUTHORITY) — the role route needs the authority of the permissions route and is bounded by the caller', () => {
  it('an OWNER-restricted ADMIN (team:write) cannot reset its OWN scopes through PATCH .../team/:ownMembership {role}: 403, row byte-identical', async () => {
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

    const before = await membershipRowText(ID.mAdminR);
    // The role route is refused the same widening, for either role.
    for (const role of ['ADMIN', 'STAFF']) {
      const self = await call('patch', routes.member(ID.bizD, ID.mAdminR), t, { role });
      expect(self.status, `{ role: ${role} } ${JSON.stringify(self.body)}`).toBe(403);
      expectNoBusinessData(self);
      expect(await membershipRowText(ID.mAdminR), `row after { role: ${role} }`).toBe(before);
    }
    const row = await db.membership.findUnique({ where: { id: ID.mAdminR } });
    expect(row.permissionScopes).toEqual({ crm: 'read', team: 'write' });
    expect(row.maxApprovalTier).toBe(0);

    // Still restricted on the very next request.
    const settingsAfter = await call('get', routes.settingsRead(ID.bizD), t);
    expect(settingsAfter.status, JSON.stringify(settingsAfter.body)).toBe(403);
  });

  it('an ADMIN with team:write cannot widen an OWNER-restricted STAFF through PATCH .../team/:m {role}: 403, row byte-identical', async () => {
    const t = T[ID.adminD];
    // The same widening through the permissions route is refused (team:admin) ...
    const perms = await call('patch', routes.perms(ID.bizD, ID.mStaffR), t, {
      scopes: { ...ROLE_DEFAULT_SCOPES.STAFF },
      maxApprovalTier: 0,
    });
    expect(perms.status, JSON.stringify(perms.body)).toBe(403);

    // ... and so is the role route, for the same role and for a higher tier.
    const before = await membershipRowText(ID.mStaffR);
    for (const role of ['STAFF', 'ADMIN']) {
      const res = await call('patch', routes.member(ID.bizD, ID.mStaffR), t, { role });
      expect(res.status, `{ role: ${role} } ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
      expect(await membershipRowText(ID.mStaffR), `row after { role: ${role} }`).toBe(before);
    }
    expect((await db.membership.findUnique({ where: { id: ID.mStaffR } })).permissionScopes).toEqual({ crm: 'read', team: 'none' });
  });

  it('a team:admin member cannot grant a role above its own authority (K2): 403, row byte-identical', async () => {
    // staffT holds team:admin, so it passes the permissions-route gate, but its
    // own map is { crm: read, team: admin } at tier 0. ADMIN defaults (admin on
    // every module, tier 3) and STAFF defaults (read on revenue, bookings, ...)
    // both exceed it. (staffP's own STAFF defaults exceed it too, so since the
    // review repairs the target ceiling (ST-F5) refuses first; the grant ceiling
    // alone is measured in "ST-1 review repairs", ST-F2.)
    const before = await membershipRowText(ID.mStaffP);
    for (const role of ['ADMIN', 'STAFF']) {
      const res = await call('patch', routes.member(ID.bizD, ID.mStaffP), T[ID.staffT], { role });
      expect(res.status, `{ role: ${role} } ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
      expect(await membershipRowText(ID.mStaffP), `row after { role: ${role} }`).toBe(before);
    }
  });

  it('positive control: a non-OWNER with team:admin changes ANOTHER member to a role within its own authority -> 200, effective on the next request', async () => {
    // The gate is the permissions route's (team:admin), not OWNER-only. (The
    // target was STAFF with settings:none until here; the OWNER case below
    // demotes it again and shows settings refused.)
    const res = await call('patch', routes.member(ID.bizD, ID.mStaffP), T[ID.adminT], { role: 'ADMIN' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.mStaffP, role: 'ADMIN' });
    const row = await db.membership.findUnique({ where: { id: ID.mStaffP } });
    expect(row.role).toBe('ADMIN');
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.ADMIN);
    // Recorded against the team:admin actor.
    const rows = await roleChangeRows(ID.mStaffP);
    expect(rows[rows.length - 1]).toMatchObject({ userId: ID.adminT, meta: { newRole: 'ADMIN' } });

    const after = await call('get', routes.settingsRead(ID.bizD), T[ID.staffP]);
    expect(after.status, JSON.stringify(after.body)).toBe(200);
  });

  it('positive control: the OWNER changes a role -> 200; scopes and tier are the role defaults, effective on the next request', async () => {
    const res = await call('patch', routes.member(ID.bizD, ID.mStaffP), T[ID.ownerD], { role: 'STAFF' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.mStaffP, role: 'STAFF' });
    const row = await db.membership.findUnique({ where: { id: ID.mStaffP } });
    expect(row.role).toBe('STAFF');
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.STAFF);

    const settings = await call('get', routes.settingsRead(ID.bizD), T[ID.staffP]);
    expect(settings.status, JSON.stringify(settings.body)).toBe(403);
  });

  it('a role change recorded in team_activity_logs keeps its actor (existing behaviour, pinned)', async () => {
    // The most recent change is the OWNER's, recorded against the OWNER.
    const rows = await roleChangeRows(ID.mStaffP);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1]).toMatchObject({
      businessId: ID.bizD,
      userId: ID.ownerD,
      module: 'team',
      action: 'role_changed',
      entityType: 'membership',
      entityId: ID.mStaffP,
      title: `Changed ${email(ID.staffP)} role to STAFF`,
      meta: { newRole: 'STAFF' },
    });
  });

  it('a refused role change writes no role_changed row', async () => {
    expect(await roleChangeRows(ID.mAdminR)).toEqual([]);
    expect(await roleChangeRows(ID.mStaffR)).toEqual([]);
    const byRefusedActors = await db.teamActivityLog.count({
      where: { businessId: ID.bizD, action: 'role_changed', userId: { in: [ID.adminR, ID.adminD, ID.staffT] } },
    });
    expect(byRefusedActors).toBe(0);
  });

  it('the OWNER role cannot be granted or removed through this route, by anyone (pinned: no ownership-transfer route exists)', async () => {
    const ownerRow = await membershipRowText(ID.mOwnerD);
    const targetRow = await membershipRowText(ID.mStaffP);

    // Granting OWNER: not an assignable role, even for the OWNER.
    for (const actor of [ID.ownerD, ID.adminT]) {
      const grant = await call('patch', routes.member(ID.bizD, ID.mStaffP), T[actor], { role: 'OWNER' });
      expect(grant.status, `${actor} grants OWNER: ${JSON.stringify(grant.body)}`).toBe(400);
    }
    // Removing OWNER: the OWNER membership's role cannot be changed, even by the OWNER itself.
    for (const actor of [ID.ownerD, ID.adminT]) {
      const demote = await call('patch', routes.member(ID.bizD, ID.mOwnerD), T[actor], { role: 'ADMIN' });
      expect(demote.status, `${actor} demotes the OWNER: ${JSON.stringify(demote.body)}`).toBe(400);
    }
    // Without team:admin the caller is refused before the target is examined.
    const byTeamWrite = await call('patch', routes.member(ID.bizD, ID.mOwnerD), T[ID.adminD], { role: 'STAFF' });
    expect(byTeamWrite.status, JSON.stringify(byTeamWrite.body)).toBe(403);

    expect(await membershipRowText(ID.mOwnerD)).toBe(ownerRow);
    expect(await membershipRowText(ID.mStaffP)).toBe(targetRow);
    expect(await db.membership.count({ where: { businessId: ID.bizD, role: 'OWNER' } })).toBe(1);
  });

  it('a non-OWNER cannot change its OWN membership role, even with team:admin: 403, row byte-identical', async () => {
    for (const [actor, membershipId] of [[ID.adminT, ID.mAdminT], [ID.staffT, ID.mStaffT]] as const) {
      const before = await membershipRowText(membershipId);
      for (const role of ['ADMIN', 'STAFF']) {
        const res = await call('patch', routes.member(ID.bizD, membershipId), T[actor], { role });
        expect(res.status, `${actor} -> own { role: ${role} }: ${JSON.stringify(res.body)}`).toBe(403);
        expectNoBusinessData(res);
        expect(await membershipRowText(membershipId), `${actor} row after { role: ${role} }`).toBe(before);
      }
      expect(await roleChangeRows(membershipId)).toEqual([]);
    }
  });
});


// ---------------------------------------------------------------------------
// ST-1 review repairs (R0-ID-F1-ROLE-ROUTE-AUTHORITY review). The role route's
// rules were not applied to its sibling PATCH .../permissions, and its ceiling
// compared only module levels and the tier of what was granted:
//   ST-F1  a non-OWNER team:admin member rewrote its OWN map and tier through
//          .../permissions, so the role route's self-target 403 denied nothing;
//   ST-F2  .../permissions had no grantor ceiling;
//   ST-F3  the ceiling ignored the CRM ownership sub-permissions, which
//          resolveCrmAccess defaults from the crm level when a map omits them;
//   ST-F5  nothing bounded WHOM a requester rewrote: a tier-0 team:admin member
//          demoted a tier-3 ADMIN.
// Both routes now share one rule set (IdentityService.assertMayRewriteAuthority).
// ---------------------------------------------------------------------------

/** permissions_updated rows the server wrote for one membership. */
async function permissionsUpdateRows(membershipId: string) {
  return db.teamActivityLog.findMany({
    where: { businessId: ID.bizD, action: 'permissions_updated', entityId: membershipId },
    orderBy: { createdAt: 'asc' },
  });
}

describe('ST-1 review repairs — PATCH .../permissions obeys the role route’s rules; both are bounded by what the requester holds and by whom it rewrites', () => {
  it('ST-F1: a non-OWNER team:admin member cannot rewrite its OWN scopes or tier through PATCH .../permissions: 403, row byte-identical', async () => {
    // staffT is refused settings before and after: its own map is { crm: read, team: admin } at tier 0.
    expect((await call('get', routes.settingsRead(ID.bizD), T[ID.staffT])).status).toBe(403);
    for (const [actor, membershipId] of [[ID.adminT, ID.mAdminT], [ID.staffT, ID.mStaffT]] as const) {
      const before = await membershipRowText(membershipId);
      const res = await call('patch', routes.perms(ID.bizD, membershipId), T[actor], {
        scopes: { ...ROLE_DEFAULT_SCOPES.OWNER },
        maxApprovalTier: 4,
      });
      expect(res.status, `${actor} -> own permissions: ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
      expect(await membershipRowText(membershipId), `${actor} row`).toBe(before);
      expect(await permissionsUpdateRows(membershipId)).toEqual([]);
    }
    expect((await call('get', routes.settingsRead(ID.bizD), T[ID.staffT])).status).toBe(403);
  });

  it('ST-F2: a team:admin member cannot grant more than its own authority through PATCH .../permissions, nor through the role route: 403, row byte-identical', async () => {
    // staffR ({ crm: read, team: none }, tier 0) is within staffT's own authority,
    // so only the grant is measured here.
    const before = await membershipRowText(ID.mStaffR);
    for (const body of [
      { scopes: { ...ROLE_DEFAULT_SCOPES.OWNER }, maxApprovalTier: 4 },
      { scopes: { crm: 'read', settings: 'read' }, maxApprovalTier: 0 },
      { scopes: { crm: 'read' }, maxApprovalTier: 1 },
    ]) {
      const res = await call('patch', routes.perms(ID.bizD, ID.mStaffR), T[ID.staffT], body);
      expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
    }
    const viaRole = await call('patch', routes.member(ID.bizD, ID.mStaffR), T[ID.staffT], { role: 'STAFF' });
    expect(viaRole.status, JSON.stringify(viaRole.body)).toBe(403);
    expect(await membershipRowText(ID.mStaffR)).toBe(before);
    expect(await permissionsUpdateRows(ID.mStaffR)).toEqual([]);
  });

  it('ST-F2 positive control: the same tier-0 team:admin member changes another member within its own authority -> 200, effective on the next request, and back', async () => {
    const grant = await call('patch', routes.perms(ID.bizD, ID.mStaffR), T[ID.staffT], {
      scopes: { crm: 'read', team: 'read' },
      maxApprovalTier: 0,
    });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect((await call('get', routes.team(ID.bizD), T[ID.staffR])).status).toBe(200);
    const rows = await permissionsUpdateRows(ID.mStaffR);
    expect(rows[rows.length - 1]).toMatchObject({ userId: ID.staffT });

    const revoke = await call('patch', routes.perms(ID.bizD, ID.mStaffR), T[ID.staffT], {
      scopes: { crm: 'read', team: 'none' },
      maxApprovalTier: 0,
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect((await call('get', routes.team(ID.bizD), T[ID.staffR])).status).toBe(403);
    expect((await db.membership.findUnique({ where: { id: ID.mStaffR } })).permissionScopes).toEqual({ crm: 'read', team: 'none' });
  });

  it('ST-F3: a CRM-restricted grantor cannot confer CRM ownership authority beyond its own, on either route: 403, row byte-identical', async () => {
    // adminC: ADMIN defaults + team:admin, tier 3, but CRM "my book" only (no view-all,
    // edit owned, no reassign, no delete). staffC is within that. Role defaults carry
    // no crm_* keys, so resolveCrmAccess would give staffC the level defaults: view
    // all (STAFF), or view all + edit any + reassign + delete any (ADMIN).
    const before = await membershipRowText(ID.mStaffC);
    for (const role of ['STAFF', 'ADMIN']) {
      const res = await call('patch', routes.member(ID.bizD, ID.mStaffC), T[ID.adminC], { role });
      expect(res.status, `{ role: ${role} } ${JSON.stringify(res.body)}`).toBe(403);
      expectNoBusinessData(res);
    }
    for (const scopes of [
      { crm: 'read' },
      { crm: 'write', ...CRM_OWNED_ONLY, crm_view: 'all' },
      { crm: 'write', ...CRM_OWNED_ONLY, crm_reassign: 'true' },
    ]) {
      const res = await call('patch', routes.perms(ID.bizD, ID.mStaffC), T[ID.adminC], { scopes, maxApprovalTier: 0 });
      expect(res.status, `${JSON.stringify(scopes)} -> ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await membershipRowText(ID.mStaffC)).toBe(before);
    expect(await roleChangeRows(ID.mStaffC)).toEqual([]);

    // Positive control: the grantor's own CRM restrictions, a higher crm level.
    const ok = await call('patch', routes.perms(ID.bizD, ID.mStaffC), T[ID.adminC], {
      scopes: { crm: 'write', ...CRM_OWNED_ONLY },
      maxApprovalTier: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await db.membership.findUnique({ where: { id: ID.mStaffC } })).permissionScopes).toEqual({ crm: 'write', ...CRM_OWNED_ONLY });
  });

  it('ST-F5: a team:admin member cannot rewrite a member whose current authority exceeds its own, on either route: 403, the target keeps its authority', async () => {
    // staffA: STAFF defaults + team:admin at tier 0. STAFF defaults are within its own
    // authority, so only the target ceiling refuses: adminT is a tier-3 ADMIN with team:admin.
    const before = await membershipRowText(ID.mAdminT);
    const demote = await call('patch', routes.member(ID.bizD, ID.mAdminT), T[ID.staffA], { role: 'STAFF' });
    expect(demote.status, JSON.stringify(demote.body)).toBe(403);
    expectNoBusinessData(demote);
    const strip = await call('patch', routes.perms(ID.bizD, ID.mAdminT), T[ID.staffA], { scopes: { crm: 'read' }, maxApprovalTier: 0 });
    expect(strip.status, JSON.stringify(strip.body)).toBe(403);
    expect(await membershipRowText(ID.mAdminT)).toBe(before);
    // The target's authority holds on the very next request.
    expect((await call('get', routes.team(ID.bizD), T[ID.adminT])).status).toBe(200);
  });

  it('ST-F5 positive control: the same requester changes a member within its own authority -> 200', async () => {
    // staffP is STAFF with the STAFF defaults at tier 0 (the OWNER set it back above).
    const res = await call('patch', routes.member(ID.bizD, ID.mStaffP), T[ID.staffA], { role: 'STAFF' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await roleChangeRows(ID.mStaffP);
    expect(rows[rows.length - 1]).toMatchObject({ userId: ID.staffA, meta: { newRole: 'STAFF' } });
  });
});

// ---------------------------------------------------------------------------
// ST-2 (fixed by R0-ID-F2-ADMIN-TOKEN-LOCAL-USER) — the admin-token branch.
//
// The three "OPEN DEFECT ST-2 reproduced" cases that pinned the defect were
// rewritten to the behaviour their it.todo required: the admin-token fallback
// of AuthMiddleware.use runs the same resolveLocalUser row checks as a Supabase
// token (User.deletedAt, User.bannedAt) and takes the role from the User row,
// never from the token. Unlike a Supabase token, an admin token whose subject
// has no User row is refused: there is no bootstrap window for an admin
// identity (AdminAuthService only issues one for an existing row).
//
// Review repair (F1): the admin branch no longer honours the per-user logout
// marker. That marker then had no issue time and only POST /identity/login
// cleared it, so after a logout through POST /identity/logout every token a
// later POST /api/admin/auth/login issued was refused for 24h. An admin token
// is revoked by its own issue-time cutoff (admin:user:<id>:revokedAt), which
// POST /api/admin/auth/logout writes and, since R0-ID-F3 (ST-4, admin tokens),
// POST /identity/logout writes too.
// ---------------------------------------------------------------------------
describe('ST-2 (fixed) — the admin-token branch of AuthMiddleware applies the same AB-P02 checks as a Supabase token', () => {
  // Issued by the production issuer while the User row is SUPER_ADMIN.
  let adminToken = '';

  /** Each case starts from an active SUPER_ADMIN row, so no case depends on the previous one restoring it. */
  async function resetToActiveSuperAdmin() {
    await db.user.update({ where: { id: ID.adminTok }, data: { role: 'SUPER_ADMIN', bannedAt: null, deletedAt: null } });
  }

  async function expectAdminServed(label: string) {
    const biz = await call('get', routes.biz(ID.bizB), adminToken);
    expect(biz.status, `${label}: ${JSON.stringify(biz.body)}`).toBe(200);
    expect(biz.body.name).toBe(BIZ_B_NAME);
  }

  /** Refused on every identity route, on the SUPER_ADMIN-only foreign tenant, and on the admin panel's own identity read. */
  async function expectAdminRefused(token: string, label: string) {
    await expectIdentityRefused(token, label);
    for (const route of [routes.biz(ID.bizB), routes.team(ID.bizB), '/api/admin/auth/me']) {
      const res = await call('get', route, token);
      expect(res.status, `${label}: GET ${route} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(401);
      expectNoBusinessData(res);
    }
  }

  it('positive control: an admin token for an active SUPER_ADMIN is served — the admin panel identity read and the SUPER_ADMIN cross-tenant read', async () => {
    adminToken = mintAdminToken(ID.adminTok, 'SUPER_ADMIN');
    const me = await call('get', '/api/admin/auth/me', adminToken);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body).toEqual({ id: ID.adminTok, email: email(ID.adminTok), role: 'SUPER_ADMIN' });
    await expectAdminServed('positive control while SUPER_ADMIN');
  });

  it('ST-2 — the role comes from the User row: after the row is demoted, the admin token can no longer cross into a foreign tenant: 403', async () => {
    expect(adminToken, 'the positive control mints the token').not.toBe('');
    await db.user.update({ where: { id: ID.adminTok }, data: { role: 'USER' } });
    // Supabase-token branch: role read from the row — refused.
    const viaSupabaseToken = await call('get', routes.biz(ID.bizB), T[ID.adminTok]);
    expect(viaSupabaseToken.status).toBe(403);
    expectNoBusinessData(viaSupabaseToken);
    // Admin-token branch: the token still says SUPER_ADMIN; the row decides — refused, nothing of B returned.
    const viaAdminToken = await call('get', routes.biz(ID.bizB), adminToken);
    expect(viaAdminToken.status, JSON.stringify(viaAdminToken.body)).toBe(403);
    expectNoBusinessData(viaAdminToken);
    // The identity is still attached, with the row's role.
    const adminMe = await call('get', '/api/admin/auth/me', adminToken);
    expect(adminMe.status, JSON.stringify(adminMe.body)).toBe(200);
    expect(adminMe.body.role).toBe('USER');

    // The row is the cause: restoring it restores access on the next request.
    await db.user.update({ where: { id: ID.adminTok }, data: { role: 'SUPER_ADMIN' } });
    await expectAdminServed('row restored to SUPER_ADMIN');
  });

  it('ST-2 — User.bannedAt and User.deletedAt are checked: each one alone refuses the admin token with 401, and clearing it restores access', async () => {
    expect(adminToken, 'the positive control mints the token').not.toBe('');
    await resetToActiveSuperAdmin();
    await expectAdminServed('before ban');

    await db.user.update({ where: { id: ID.adminTok }, data: { bannedAt: new Date() } });
    await expectAdminRefused(adminToken, 'bannedAt, admin token');
    // Supabase-token branch: refused the same way.
    await expectIdentityRefused(T[ID.adminTok], 'bannedAt, Supabase token');

    await db.user.update({ where: { id: ID.adminTok }, data: { bannedAt: null, deletedAt: new Date() } });
    await expectAdminRefused(adminToken, 'deletedAt, admin token');
    await expectIdentityRefused(T[ID.adminTok], 'deletedAt, Supabase token');

    await db.user.update({ where: { id: ID.adminTok }, data: { deletedAt: null } });
    await expectAdminServed('ban and delete cleared');
  });

  /** POST /api/admin/auth/login with the adminTok credentials; returns the fresh token. */
  async function adminLogin(label: string): Promise<string> {
    const login = await call('post', '/api/admin/auth/login', null, { email: email(ID.adminTok), password: ADMIN_PASSWORD });
    expect(login.status, `${label}: ${JSON.stringify(login.body)}`).toBe(201);
    expect(login.body.user).toEqual({ id: ID.adminTok, email: email(ID.adminTok), role: 'SUPER_ADMIN' });
    expect(typeof login.body.accessToken).toBe('string');
    return login.body.accessToken as string;
  }

  /** The admin panel identity read and the SUPER_ADMIN cross-tenant read, for a given admin token. */
  async function expectTokenServed(token: string, label: string) {
    const me = await call('get', '/api/admin/auth/me', token);
    expect(me.status, `${label}: ${JSON.stringify(me.body)}`).toBe(200);
    expect(me.body).toEqual({ id: ID.adminTok, email: email(ID.adminTok), role: 'SUPER_ADMIN' });
    const biz = await call('get', routes.biz(ID.bizB), token);
    expect(biz.status, `${label}: ${JSON.stringify(biz.body)}`).toBe(200);
    expect(biz.body.name).toBe(BIZ_B_NAME);
  }

  /** The F1 case's POST /api/admin/auth/login token, issued after its POST /identity/logout. */
  let freshAdminToken = '';

  it('F1 — after POST /identity/logout (the app shell logout, sent with the admin token) a fresh POST /api/admin/auth/login token is served; the marker still refuses the Supabase token', async () => {
    expect(adminToken, 'the positive control mints the token').not.toBe('');
    await resetToActiveSuperAdmin();
    await expectAdminServed('before logout');
    // ST-4 backward compatibility: a bare-flag marker ('1') left by the previous
    // release. It does not gate the admin token, so this logout runs — and it
    // rewrites the marker as a revocation time in epoch seconds.
    await redis!.setex(revocationKey(ID.adminTok), 300, '1');
    const loggedOutFrom = Math.floor(Date.now() / 1000);
    const out = await call('post', '/identity/logout', adminToken);
    const loggedOutTo = Math.floor(Date.now() / 1000);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const revokedAt = await expectRevocationTime(ID.adminTok, loggedOutFrom, loggedOutTo);
    // The marker still does its job on the Supabase branch.
    await expectIdentityRefused(T[ID.adminTok], 'after logout, Supabase token');

    // Admin login again. Nothing on this path clears the marker — before the
    // repair every token it issued was refused here with 401 for 24h.
    const fresh = await adminLogin('admin login after /identity/logout');
    expect(fresh).not.toBe(adminToken);
    await expectTokenServed(fresh, 'fresh admin token after /identity/logout');
    expect(await redis!.get(revocationKey(ID.adminTok)), 'served with the marker still set').toBe(String(revokedAt));
    freshAdminToken = fresh;
  });

  it('ST-4 (admin tokens) — POST /identity/logout revokes an admin token issued before it by issue time: the pre-logout admin token answers 401, the later admin login’s token is served, and the next login brings the old one back neither', async () => {
    expect(adminToken, 'the positive control mints the token').not.toBe('');
    await resetToActiveSuperAdmin();
    await expectAdminRefused(adminToken, 'pre-logout admin token after /identity/logout');
    // F1's POST /identity/logout wrote the admin token's own cutoff
    // (admin:user:<id>:revokedAt, milliseconds like the admin token iat — the
    // key POST /api/admin/auth/logout writes and verifyAdminToken reads), with a
    // TTL that outlives every admin token issued before it.
    const adminCutoff = await redis!.get(adminCutoffKey(ID.adminTok));
    expect(adminCutoff, 'admin cutoff written by POST /identity/logout').toMatch(/^\d{13,}$/);
    expect(await redis!.ttl(adminCutoffKey(ID.adminTok)), 'admin cutoff TTL (seconds)').toBeGreaterThanOrEqual(MAX_TOKEN_LIFETIME_S - 60);
    expect(freshAdminToken, 'the F1 case logs in again after its logout').not.toBe('');
    await expectTokenServed(freshAdminToken, 'admin token issued after /identity/logout');

    // The next POST /identity/login (see expectLoginLeavesRevocation).
    await expectLoginLeavesRevocation(ID.adminTok, (await redis!.get(revocationKey(ID.adminTok)))!, adminCutoff!);
    await expectAdminRefused(adminToken, 'pre-logout admin token after the next login');
    await expectTokenServed(freshAdminToken, 'admin token issued after /identity/logout, after the next login');
  });

  it("ST-2 — the admin token's own revocation holds: after POST /api/admin/auth/logout the admin token it was sent with is refused with 401, and a later admin login is served", async () => {
    await resetToActiveSuperAdmin();
    // The positive control's adminToken was already revoked by POST
    // /identity/logout (ST-4, above), so log out with a live one.
    const live = await adminLogin('a live admin token to log out with');
    const out = await call('post', '/api/admin/auth/logout', live);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(await redis!.get(adminCutoffKey(ID.adminTok))).not.toBeNull();
    await expectAdminRefused(live, 'after admin logout, pre-logout admin token');

    const fresh = await adminLogin('admin login after /api/admin/auth/logout');
    await expectTokenServed(fresh, 'fresh admin token after /api/admin/auth/logout');
  });

  it('ST-2 — an admin token whose subject has no User row is refused with 401 (no bootstrap window for an admin identity), and no row is created', async () => {
    const ghost = mintAdminToken(ID.adminNoRow, 'SUPER_ADMIN');
    await expectAdminRefused(ghost, 'admin token, no User row');
    expect(await db.user.findUnique({ where: { id: ID.adminNoRow } })).toBeNull();
    expect(await db.membership.count({ where: { userId: ID.adminNoRow } })).toBe(0);
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
// supabase-admin.service.ts). ST-4 is fixed (R0-ID-F3); its cases below assert
// the required behaviour.
// ---------------------------------------------------------------------------
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

// ST-4 (R0-ID-F3-REVOCATION-IAT-CUTOFF). The marker used to be a per-user flag
// with no issue time, and POST /identity/login deleted it, so a token issued
// before logout — a stolen one included — was admitted again after the next
// login. Required: the marker is the revocation time, login leaves it alone, and
// a token is refused when its iat is at or before that time. The admin-token
// half is the "ST-4 (admin tokens)" case in the ST-2 block above.
describe('ST-4 — logout revocation is an issue-time cutoff that the next login does not lift', () => {
  it('T1 issued BEFORE POST /identity/logout stays refused after the next login (401), while T2 minted after the logout is served (200)', async () => {
    const t1 = T[ID.relogin]; // minted in beforeAll, before this logout
    const before = await call('get', routes.biz(ID.bizD), t1);
    expect(before.status, JSON.stringify(before.body)).toBe(200);

    const loggedOutFrom = Math.floor(Date.now() / 1000);
    const out = await call('post', '/identity/logout', t1);
    const loggedOutTo = Math.floor(Date.now() / 1000);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect((await call('get', routes.me, t1)).status, 'T1 right after logout').toBe(401);
    const revokedAt = await expectRevocationTime(ID.relogin, loggedOutFrom, loggedOutTo);
    const adminCutoff = await redis!.get(adminCutoffKey(ID.relogin));
    expect(adminCutoff, 'POST /identity/logout also writes the admin-token cutoff').toMatch(/^\d{13,}$/);

    // The next POST /identity/login (see expectLoginLeavesRevocation).
    await expectLoginLeavesRevocation(ID.relogin, String(revokedAt), adminCutoff!);
    for (const route of [routes.me, routes.biz(ID.bizD), routes.team(ID.bizD)]) {
      const res = await call('get', route, t1);
      expect(res.status, `T1 after the next login: GET ${route} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(401);
      expect(JSON.stringify(res.body ?? {})).not.toContain(BIZ_D_NAME);
    }

    await untilAfterSecond(revokedAt);
    const t2 = mintToken(ID.relogin);
    const me = await call('get', routes.me, t2);
    expect(me.status, `T2 (minted after logout): /identity/me ${JSON.stringify(me.body)}`).toBe(200);
    expect(me.body.id).toBe(ID.relogin);
    const biz = await call('get', routes.biz(ID.bizD), t2);
    expect(biz.status, `T2 (minted after logout): /identity/businesses/:D ${JSON.stringify(biz.body)}`).toBe(200);
    expect(biz.body.name).toBe(BIZ_D_NAME);
  });
});

describe('OPEN DEFECT ST-2-WS — the KEY Cortex WebSocket admin-token path skips the local-user checks', () => {
  it.todo(
    'REQUIRED (follow-up packet; key-cortex-ws-auth.service.ts, outside this write set): authenticateSocket applies the AuthMiddleware local-user ' +
      'checks to both token kinds — an admin token takes its role from the User row and is refused when the row is missing, deletedAt or bannedAt is set ' +
      '(and the Supabase path also on the logout marker); a Postgres failure refuses instead of falling back to USER — so verifyBusinessMembership ' +
      'never admits a demoted, deleted or banned SUPER_ADMIN into another tenant’s socket',
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

// ---------------------------------------------------------------------------
// OPEN DEFECTS ST-F4 and CR-1 — the ST-1 outcome through sibling team:write
// routes (R0-ID-F1-ROLE-ROUTE-AUTHORITY review). The role and permissions routes
// are closed; these two are not, and their fixes belong to queued packets
// (V1-07-AUTH-INVITE-CEILING, V1-21-AUTH-JOBROLE-CEILING). Each reproduction pins
// today's behaviour and turns red when its fix lands. They run last and use
// their own fixtures (adminW, accomplice, adminJ), because they leave those
// memberships escalated.
// ---------------------------------------------------------------------------
describe('OPEN DEFECT ST-F4 — the invite route has no grantor ceiling, so a restricted team:write member resets itself in two requests', () => {
  it('OPEN DEFECT ST-F4 reproduced — adminW ({ crm: read, team: write }, tier 0) invites an account it controls with team:admin at tier 4; that account resets adminW to the ADMIN defaults', async () => {
    const t = T[ID.adminW];
    expect((await call('get', routes.settingsRead(ID.bizD), t)).status).toBe(403);
    // The direct routes are closed to adminW (team:write only).
    expect((await call('patch', routes.member(ID.bizD, ID.mAdminW), t, { role: 'ADMIN' })).status).toBe(403);

    const invite = await call('post', routes.team(ID.bizD), t, {
      email: email(ID.accomplice),
      role: 'ADMIN',
      scopes: { ...ROLE_DEFAULT_SCOPES.OWNER },
      maxApprovalTier: 4,
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const reset = await call('patch', routes.member(ID.bizD, ID.mAdminW), T[ID.accomplice], { role: 'ADMIN' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);

    const row = await db.membership.findUnique({ where: { id: ID.mAdminW } });
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.ADMIN);
    expect((await call('get', routes.settingsRead(ID.bizD), t)).status).toBe(200);
  });

  it.todo(
    'REQUIRED (V1-07-AUTH-INVITE-CEILING; identity.service.ts inviteTeamMember): the invite applies the grantor ceiling the role and ' +
      'permissions routes apply — adminW’s invite with team:admin at tier 4 answers 403 with no User or Membership created, so no account ' +
      'adminW controls holds more than adminW and the reset above cannot happen',
  );
});

describe('OPEN DEFECT CR-1 — the structure routes (team:write) copy a JobRole’s permissions and tier onto any membership, the caller’s own included', () => {
  it('OPEN DEFECT CR-1 reproduced — a default ADMIN (team:write) raises itself to team:admin at tier 4 through job-roles + assignments, then passes the gate this packet added', async () => {
    const t = T[ID.adminJ];
    // Before: the role route is closed to a team:write member.
    const before = await call('patch', routes.member(ID.bizD, ID.mStaffP), t, { role: 'STAFF' });
    expect(before.status, JSON.stringify(before.body)).toBe(403);

    const unit = await call('post', routes.orgUnits(ID.bizD), t, { name: `${P}unit_cr1` });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    const jobRole = await call('post', routes.jobRoles(ID.bizD), t, {
      name: `${P}jobrole_cr1`,
      permissions: { ...ROLE_DEFAULT_SCOPES.OWNER },
      defaultApprovalTier: 4,
    });
    expect(jobRole.status, JSON.stringify(jobRole.body)).toBe(201);
    const assign = await call('post', routes.assignments(ID.bizD), t, {
      membershipId: ID.mAdminJ,
      userId: ID.adminJ,
      orgUnitId: unit.body.id,
      jobRoleId: jobRole.body.id,
    });
    expect(assign.status, JSON.stringify(assign.body)).toBe(201);

    const row = await db.membership.findUnique({ where: { id: ID.mAdminJ } });
    expect(row.permissionScopes).toMatchObject({ team: 'admin' });
    expect(row.maxApprovalTier).toBe(4);
    // After: team:admin at tier 4 — the role route now admits it.
    const after = await call('patch', routes.member(ID.bizD, ID.mStaffP), t, { role: 'STAFF' });
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    // The identity routes still refuse its self-target (ST-F1 holds); the escalation came from elsewhere.
    expect((await call('patch', routes.perms(ID.bizD, ID.mAdminJ), t, { scopes: { crm: 'read' }, maxApprovalTier: 0 })).status).toBe(403);
  });

  it.todo(
    'REQUIRED (V1-21-AUTH-JOBROLE-CEILING; structure.service.ts, structure.controller.ts, job-role DTOs — outside this write set): JobRole ' +
      'permissions are vocabulary-validated and capped by the grantor, and an assignment cannot sync a JobRole above the assigner’s own ' +
      'authority onto a membership, nor onto the assigner’s own — the escalation above answers 403 with the membership unchanged',
  );
});
