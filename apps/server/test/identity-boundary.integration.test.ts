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
 *         OWNER's restriction on itself) was reachable through two sibling
 *         team:write routes with no grantor ceiling:
 *   ST-F4 FIXED by V1-07-AUTH-INVITE-CEILING (its cases assert the required
 *         behaviour; see "ST-F4 (fixed …)" below). The invite route minted any
 *         scopes and tier, so a restricted team:write member invited an account
 *         it controls with team:admin, which then reset the member through the
 *         role route. The invite is now bounded by the inviter's own authority
 *         (identity.service.ts inviteTeamMember): above it, 403 and nothing is
 *         created; the OWNER and a SUPER_ADMIN are not bounded.
 *   CR-1  FIXED by V1-21-AUTH-JOBROLE-CEILING (its cases assert the required
 *         behaviour; see "CR-1 (fixed …)" below). The structure routes copied
 *         a JobRole's permissions and tier onto any membership in the
 *         business, the caller's own included (structure.service.ts
 *         createAssignment). A JobRole is now vocabulary-validated and bounded
 *         by its author, and an assignment's sync by the assigner's own
 *         authority: above it, 403 and nothing changes.
 *   ST-2  FIXED by R0-ID-F2-ADMIN-TOKEN-LOCAL-USER (its cases assert the
 *         required behaviour; see "ST-2 (fixed …)" below). The admin-token
 *         branch attached verifyAdminToken's result directly: no revocation
 *         marker, no deletedAt/bannedAt, role from the token
 *         (auth.middleware.ts). Its sibling path on the KEY Cortex WebSocket is
 *         closed too (ST-2-WS). (POST /identity/logout not revoking an admin
 *         token was the admin half of ST-4, fixed with it.)
 *   ST-2-WS FIXED by R0-ID-F6-WS-ADMIN-TOKEN (its cases open a real socket;
 *         see "ST-2-WS (fixed …)" below). key-cortex-ws-auth.service.ts
 *         authenticateSocket took the role from an admin token and checked
 *         neither deletedAt, bannedAt nor the logout marker, so with
 *         verifyBusinessMembership's SUPER_ADMIN bypass a demoted, deleted or
 *         banned SUPER_ADMIN opened any tenant's socket; its Supabase path fell
 *         back to USER on a DB error. It now takes AuthMiddleware's decision
 *         for the same bearer token, and reads the handshake businessId as
 *         BusinessGuard does (review finding ST-WS-R2: a Prisma filter object
 *         such as { in: [own, foreign] } was authorized as the tenant).
 *   ST-WS-R1 the KEY Cortex gateway decides at connect only: a socket opened
 *         before a ban, demotion or logout keeps approving in its tenant and
 *         keeps its room pushes (key-cortex.gateway.ts; pre-existing, outside
 *         R0-ID-F6's write set; reproduced, with its it.todo, below).
 *   ST-3  FIXED by R0-09-ID-HARDEN (owner ruling D-11; its cases assert the
 *         required behaviour; see "ST-3 (fixed …)" below). PATCH
 *         /identity/businesses/:id had only AuthGuard and BusinessGuard, so a
 *         settings:none member rewrote the tenant profile
 *         (identity.controller.ts updateBusiness). It is now OWNER only,
 *         regardless of granted scopes, and no longer writes
 *         onboardingComplete.
 *   ST-4  FIXED by R0-ID-F3-REVOCATION-IAT-CUTOFF (its cases assert the
 *         required behaviour; see "ST-4 — logout revocation is an issue-time
 *         cutoff" and "ST-4 (admin tokens)" below). The revocation marker was
 *         per user with no iat cutoff and POST /identity/login deleted it, so a
 *         pre-logout token was admitted again after the next login; for admin
 *         tokens POST /identity/logout revoked nothing at all. The marker now
 *         holds the logout time (epoch seconds), login leaves it alone, the
 *         middleware refuses a token whose SESSION was authenticated at or
 *         before it (amr, so a refresh after the logout does not get back in
 *         while CR-2 leaves the refresh tokens alive), and logout also writes
 *         the admin cutoff (admin:user:<id>:revokedAt). A bare '1' left by the
 *         previous release (setex 86400) is read by its TTL as the time it was
 *         written.
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
import WebSocket from 'ws';
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
  adminW: `${P}adminW`,           // ADMIN of bizD restricted by the OWNER: { crm: read, team: write }, tier 0 (ST-F4 fix)
  accomplice: `${P}accomplice`,   // User row only; adminW's invite of it is refused, the OWNER's succeeds (ST-F4 fix)
  adminJ: `${P}adminJ`,           // ADMIN of bizD, role-default scopes (team: write) (CR-1 fix)
  staffD: `${P}staffD`,           // STAFF of bizD, role-default scopes (settings: none) (ST-3)
  adminS: `${P}adminS`,           // ADMIN of bizD, ADMIN defaults with settings: write (ST-3 fix, D-11 owner-only)
  relogin: `${P}relogin`,         // STAFF of bizD; logs out, then the login marker clear (ST-4)
  adminTok: `${P}adminTok`,       // User row role SUPER_ADMIN at token issue, no membership (ST-2)
  adminNoRow: `${P}adminNoRow`,   // subject of a valid admin token, no User row at all (ST-2 fix); not seeded
  wsAdmin: `${P}wsAdmin`,         // User row SUPER_ADMIN, no membership; opens bizB's KEY Cortex socket (ST-2-WS fix)
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
  mAdminS: `${P}m_adminS`,
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
  ID.staffA, ID.adminC, ID.staffC, ID.adminW, ID.accomplice, ID.adminJ, ID.adminNoRow, ID.adminS, ID.wsAdmin,
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
  /** Structure routes, gated on team:write (CR-1, fixed by V1-21-AUTH-JOBROLE-CEILING). */
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
    // The CR-1 cases create an org unit and job roles in bizD (and, were the fix to regress, an assignment).
    `DELETE FROM org_assignments WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM org_units WHERE business_id LIKE ${LIKE_P}`,
    `DELETE FROM memberships WHERE id LIKE ${LIKE_P} OR business_id LIKE ${LIKE_P} OR user_id LIKE ${LIKE_P}`,
    `DELETE FROM businesses WHERE id LIKE ${LIKE_P} OR owner_id LIKE ${LIKE_P}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${LIKE_P}`,
    // An invite creates a User with a generated id (ST-F4 cases); its email carries the prefix.
    `DELETE FROM users WHERE id LIKE ${LIKE_P} OR email LIKE ${LIKE_P}`,
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
    ID.staffA, ID.adminC, ID.staffC, ID.adminW, ID.accomplice, ID.adminJ, ID.adminS,
  ]) {
    await db.user.create({ data: { id, email: email(id), name: id, role: 'USER' } });
  }
  // SUPER_ADMIN when its admin token is issued; demoted mid-suite (ST-2).
  await db.user.create({ data: { id: ID.adminTok, email: email(ID.adminTok), name: ID.adminTok, role: 'SUPER_ADMIN' } });
  // The same shape for the KEY Cortex socket cases (ST-2-WS), so they depend on no other case's state.
  await db.user.create({ data: { id: ID.wsAdmin, email: email(ID.wsAdmin), name: ID.wsAdmin, role: 'SUPER_ADMIN' } });
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
    { id: ID.mAdminS, userId: ID.adminS, businessId: ID.bizD, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
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
    expect(await db.membership.count({ where: { businessId: ID.bizD } })).toBe(15);
    // The ST-F4 accomplice has a User row and no membership until the OWNER invites it (adminW cannot).
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

  it("Redis revocation marker in the previous release's bare-flag format ('1', written with setex 86400): read by its TTL as the time it was written — every token issued up to then gets 401, a token issued after it is served; once the marker is gone the pre-revocation token is served (the marker is the cause)", async () => {
    // ST-4 (R0-ID-F3): the marker now holds the revocation time in epoch
    // seconds. A bare '1' written by the previous release carries no time, but
    // that release wrote it only as setex(key, 86400, '1'), so its remaining
    // TTL says when (review finding F2: read as "revoked now" on every request,
    // it locked the next login out for up to 24h). The pre-revocation token and
    // a token minted this instant are refused; a token minted after the write
    // (plus the 1s margin) is served. Nothing in the product deletes the marker
    // any more (POST /identity/login used to — OPEN DEFECT ST-4, fixed); only
    // its TTL ends it, and deleting it here stands in for that expiry.
    await expectServed(T[ID.revoked], 'before revocation');
    await redis!.setex(revocationKey(ID.revoked), 86400, '1');
    const writtenBy = Math.floor(Date.now() / 1000);
    await expectIdentityRefused(T[ID.revoked], 'bare-flag marker, pre-revocation token');
    await expectIdentityRefused(mintToken(ID.revoked), 'bare-flag marker, token minted now');
    await untilAfterSecond(writtenBy + 1);
    await expectServed(mintToken(ID.revoked), 'bare-flag marker, token minted after it was written');
    await expectIdentityRefused(T[ID.revoked], 'bare-flag marker, pre-revocation token, later');
    expect(await redis!.get(revocationKey(ID.revoked)), 'reading it does not rewrite it').toBe('1');
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
    // Written as the previous release wrote it (setex 86400): since the ST-4
    // review repairs a bare '1' is read by its remaining TTL as the time it was
    // written, so a shorter TTL would date it before this user's token.
    await redis!.setex(revocationKey(ID.noRow), 86400, '1');
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
// to PATCH .../permissions; of the two sibling team:write paths that reached
// the ST-1 outcome, the invite is closed (ST-F4, fixed by
// V1-07-AUTH-INVITE-CEILING) and so are structure job roles and assignments
// (CR-1, fixed by V1-21-AUTH-JOBROLE-CEILING), both at the end of this file.
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
// supabase-admin.service.ts). ST-3 (R0-09) and ST-4 (R0-ID-F3) are fixed; their
// cases below assert the required behaviour.
//
// ST-3 — FIXED by R0-09-ID-HARDEN under owner ruling D-11 (2026-10-31): editing
// the business profile is OWNER only, regardless of granted scopes. The "OPEN
// DEFECT ST-3 reproduced" case pinned a settings:none STAFF member rewriting the
// tenant profile; it now asserts the required behaviour and its it.todo is gone.
// The ruling replaces the it.todo's settings-write wording, so an ADMIN that holds
// settings:write is refused too. Fields outside the blueprint mirror only (name,
// currency and the like are mirrored asynchronously into business_blueprints
// after the response), so a write that lands leaves nothing behind but the row.
// ---------------------------------------------------------------------------

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

describe('ST-3 (fixed, R0-09-ID-HARDEN, owner ruling D-11) — PATCH /identity/businesses/:id is OWNER only, regardless of granted scopes', () => {
  const HIJACK = { slug: `${P}bizd-hijacked-slug`, defaultTaxRate: 99, storeEnabled: false, timezone: 'Pacific/Kiritimati' };

  it('a STAFF member (settings:none) is refused a settings read and the profile rewrite: 403, Business row byte-identical', async () => {
    const t = T[ID.staffD];
    const read = await call('get', routes.settingsRead(ID.bizD), t);
    expect(read.status, JSON.stringify(read.body)).toBe(403);

    const before = await businessRowText(ID.bizD);
    const res = await call('patch', routes.biz(ID.bizD), t, HIJACK);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expectNoBusinessData(res);
    expect(await businessRowText(ID.bizD)).toBe(before);
  });

  it('an ADMIN granted settings:write is refused too — the profile is owner-only, not scope-gated: 403, row byte-identical', async () => {
    const t = T[ID.adminS];
    // Not vacuous: the same token passes a settings-scoped read.
    const read = await call('get', routes.settingsRead(ID.bizD), t);
    expect(read.status, JSON.stringify(read.body)).toBe(200);

    const before = await businessRowText(ID.bizD);
    const res = await call('patch', routes.biz(ID.bizD), t, HIJACK);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expectNoBusinessData(res);
    expect(await businessRowText(ID.bizD)).toBe(before);
  });

  it('the OWNER rewrites the profile: 200, the row changes and GET reflects it', async () => {
    const t = T[ID.ownerD];
    const res = await call('patch', routes.biz(ID.bizD), t, { slug: `${P}bizd-owner-slug`, defaultTaxRate: 12.5, timezone: 'America/New_York' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const read = await call('get', routes.biz(ID.bizD), t);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ id: ID.bizD, slug: `${P}bizd-owner-slug`, defaultTaxRate: 12.5, timezone: 'America/New_York' });
  });

  it('the OWNER cannot complete onboarding through the generic PATCH: the real ValidationPipe strips onboardingComplete, 200, the flag unchanged', async () => {
    const t = T[ID.ownerD];
    const res = await call('patch', routes.biz(ID.bizD), t, { onboardingComplete: true, defaultTaxRate: 7.5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.business.findUnique({ where: { id: ID.bizD } });
    expect(row).toMatchObject({ defaultTaxRate: 7.5, onboardingComplete: false, onboardingCompletedAt: null });
  });
});

// OPEN DEFECTS — D-11 sibling write paths (R0-09-ID-HARDEN review R09-ST-2,
// R09-ST-3, R09-ST-4, CR-3). The generic PATCH above is closed, but other
// routes still write the owner-only profile fields with only AuthGuard and
// BusinessGuard. Each fix is in source outside the R0-09 write set; each
// it.todo names the required behaviour for its follow-up packet.
describe('OPEN DEFECTS — D-11 sibling write paths still change owner-only profile fields', () => {
  it.todo(
    'REQUIRED (follow-up; site/presence/presence.controller.ts, presence.service.ts publish — outside the R0-09 write set; review R09-ST-2): ' +
      'PUT /site/presence/businesses/:id/draft and POST .../publish copy draft.slug onto Business.slug for any member, so a settings:none STAFF ' +
      'changes the public slug the generic PATCH refuses; the slug change answers 403 for a non-owner with Business.slug unchanged',
  );
  it.todo(
    'REQUIRED (follow-up, next to R0-SEC owner-only onboarding completion; onboarding-concierge.controller.ts/.service.ts autoConfigure — ' +
      'outside the R0-09 write set; review R09-ST-3): POST /onboarding-concierge/businesses/:id/auto-configure writes Business.name ' +
      '(customBusinessName) and overwrites businessHours for any member with no completion precondition; a non-owner answers 403 with the row unchanged',
  );
  it.todo(
    'REQUIRED (follow-up; key-cortex.controller.ts execute — outside the R0-09 write set; review R09-ST-4): POST /api/v1/cortex/execute ' +
      "builds the ConnectorCommand with userId: dto.userId ?? 'system', so a member attributes a command to the OWNER; the actor comes from req.user",
  );
  it.todo(
    'REQUIRED (follow-up after the R09-ST-4 actor fix; key-cortex/adapters/settings-adapter.service.ts — outside the R0-09 write set; review CR-3): ' +
      'settings.update_business_profile and settings.update_branding reach IdentityService.updateBusiness with no owner check; they apply ' +
      'IdentityService.assertBusinessOwner on the non-spoofable actor, so a STAFF command leaves name, timezone, currency and branding unchanged',
  );
});

// ST-4 (R0-ID-F3-REVOCATION-IAT-CUTOFF). The marker used to be a per-user flag
// with no issue time, and POST /identity/login deleted it, so a token issued
// before logout — a stolen one included — was admitted again after the next
// login. Required: the marker is the revocation time, login leaves it alone, and
// a token is refused when its session was authenticated at or before that time
// (its iat, for a token with no session behind it). The admin-token half is the
// "ST-4 (admin tokens)" case in the ST-2 block above.
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

  // Review findings ST4-R1 / F1. Supabase mints a new access token, with a new
  // iat, each time a session's refresh token is used, and the provider
  // sign-out revokes no refresh token today (CR-2; in this child it has no
  // Supabase admin at all). With an iat cutoff a refresh after the logout —
  // another device, or a stolen refresh token — got straight back in. The
  // cutoff is now compared against when the token's SESSION was authenticated:
  // the GoTrue claims every session token carries (session_id, and amr with
  // the authentication timestamp, carried over unchanged by a refresh).
  it('a session authenticated BEFORE POST /identity/logout stays refused when it is refreshed after it (new iat, same session_id and amr), and a session token that does not say when it began is refused; a session opened after the logout is served', async () => {
    const sessionToken = (sessionId: string, authenticatedAt: number) =>
      mintToken(ID.relogin, { claims: { session_id: sessionId, amr: [{ method: 'password', timestamp: authenticatedAt }] } });

    // A session opened after any earlier logout of this user, so it starts served.
    const prior = Number(await redis!.get(revocationKey(ID.relogin)));
    await untilAfterSecond(prior);
    const startedAt = Math.floor(Date.now() / 1000);
    const t1 = sessionToken('st4r-before', startedAt);
    expect((await call('get', routes.biz(ID.bizD), t1)).status, 'T1 (session opened before this logout) before it').toBe(200);

    const loggedOutFrom = Math.floor(Date.now() / 1000);
    const out = await call('post', '/identity/logout', t1);
    const loggedOutTo = Math.floor(Date.now() / 1000);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const revokedAt = await expectRevocationTime(ID.relogin, loggedOutFrom, loggedOutTo);
    await untilAfterSecond(revokedAt);

    // What Supabase hands back for the surviving refresh token after the
    // logout: minted now, iat after the cutoff, same session and amr.
    const refreshed = sessionToken('st4r-before', startedAt);
    expect(JSON.parse(Buffer.from(refreshed.split('.')[1], 'base64url').toString()).iat, 'the refreshed token is minted after the logout').toBeGreaterThan(revokedAt);
    const noAmr = mintToken(ID.relogin, { claims: { session_id: 'st4r-before' } });
    for (const [label, token] of [['refreshed pre-logout session', refreshed], ['session token without amr', noAmr]] as const) {
      for (const route of [routes.me, routes.biz(ID.bizD)]) {
        const res = await call('get', route, token);
        expect(res.status, `${label}: GET ${route} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(401);
        expect(JSON.stringify(res.body ?? {})).not.toContain(BIZ_D_NAME);
      }
    }

    const next = sessionToken('st4r-after', Math.floor(Date.now() / 1000));
    const me = await call('get', routes.me, next);
    expect(me.status, `session opened after the logout: /identity/me ${JSON.stringify(me.body)}`).toBe(200);
    const biz = await call('get', routes.biz(ID.bizD), next);
    expect(biz.status, `session opened after the logout: /identity/businesses/:D ${JSON.stringify(biz.body)}`).toBe(200);
    expect(biz.body.name).toBe(BIZ_D_NAME);
  });
});

// ---------------------------------------------------------------------------
// ST-2-WS (fixed by R0-ID-F6-WS-ADMIN-TOKEN) — the KEY Cortex WebSocket.
//
// KeyCortexWsAuthService.authenticateSocket had its own admin-token path: the
// role came from the token and neither User.deletedAt, User.bannedAt nor a
// missing row refused it; its Supabase path ignored the logout marker. A
// demoted, deleted or banned SUPER_ADMIN therefore still opened another tenant's
// socket, since verifyBusinessMembership lets SUPER_ADMIN through (as
// BusinessGuard does over HTTP). It now takes the HTTP AuthMiddleware decision
// for the same bearer token, so the cases below are the ST-2 / ST-4 cases above
// asked over the socket instead of over HTTP.
//
// The socket is opened the way socket.io-client opens it — Engine.IO v4 over a
// WebSocket, then a Socket.IO CONNECT to /key-cortex carrying { token,
// businessId } as its auth payload — with the `ws` package the server already
// depends on, so no client library is added. The gateway's decision is what the
// client sees: `key:connected` once the socket is authenticated, authorized and
// joined to its rooms, or a DISCONNECT and a closed connection.
//
// `businessId` is sent as given: the handshake auth payload is client JSON, so
// a case can name the tenant with something other than a string (ST-WS-R2).
// ---------------------------------------------------------------------------
type CortexOutcome = { outcome: 'connected' | 'refused'; userId?: string; businessId?: unknown; frames: string[] };
type CortexEvent = { event: string; payload: unknown };
/** A socket kept open after the gateway's decision (ST-WS-R1): emit events on it and read what the gateway answers. */
type CortexSession = CortexOutcome & {
  emit(event: string, payload: unknown): void;
  /** The next server event named `event`, or 'closed' once the server disconnects the socket. */
  next(event: string, ms?: number): Promise<CortexEvent | 'closed'>;
  close(): void;
};

const CORTEX_NSP = '/key-cortex';

async function cortexOpen(token: string, businessId: unknown): Promise<CortexSession> {
  requireServer();
  const url = `${baseUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
  const NSP = CORTEX_NSP;
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    const ws = new WebSocket(url);
    let decided = false;
    let closed = false;
    const waiters: Array<{ event: string; done: (v: CortexEvent | 'closed') => void }> = [];
    const markClosed = () => {
      closed = true;
      for (const w of waiters.splice(0)) w.done('closed');
    };
    const session = (outcome: CortexOutcome['outcome'], payload?: { userId?: string; businessId?: unknown }): CortexSession => ({
      outcome,
      userId: payload?.userId,
      businessId: payload?.businessId,
      frames,
      emit: (event, data) => ws.send(`42${NSP},${JSON.stringify([event, data])}`),
      next: (event, ms = 15_000) =>
        closed
          ? Promise.resolve('closed')
          : new Promise((done, fail) => {
              const timer = setTimeout(() => fail(new Error(`no ${event} within ${ms}ms; frames: ${frames.join(' | ')}`)), ms);
              waiters.push({ event, done: (v) => { clearTimeout(timer); done(v); } });
            }),
      close: () => ws.terminate(),
    });
    const decide = (s: CortexSession) => {
      if (decided) return;
      decided = true;
      clearTimeout(timer);
      resolve(s);
    };
    const timer = setTimeout(() => {
      if (decided) return;
      decided = true;
      ws.terminate();
      reject(new Error(`no gateway decision within 15s; frames: ${frames.join(' | ')}`));
    }, 15_000);
    ws.on('message', (data) => {
      const frame = data.toString();
      frames.push(frame);
      if (frame.startsWith('0{')) {
        // Engine.IO OPEN -> Socket.IO CONNECT to the namespace, with the handshake auth payload.
        ws.send(`40${NSP},${JSON.stringify({ token, businessId })}`);
      } else if (frame === '2') {
        ws.send('3'); // Engine.IO ping -> pong
      } else if (frame.startsWith(`42${NSP},`)) {
        const [event, payload] = JSON.parse(frame.slice(`42${NSP},`.length)) as [string, { userId?: string; businessId?: unknown }];
        if (event === 'key:connected') decide(session('connected', payload));
        const i = waiters.findIndex((w) => w.event === event);
        if (i >= 0) waiters.splice(i, 1)[0].done({ event, payload });
      } else if (frame.startsWith(`41${NSP}`) || frame.startsWith(`44${NSP}`)) {
        markClosed();
        decide(session('refused'));
      }
    });
    ws.on('close', () => {
      markClosed();
      decide(session('refused'));
    });
    ws.on('error', (e) => {
      markClosed();
      if (!decided) {
        decided = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}

/** The gateway's connect decision only; the socket is closed once it is known. */
async function cortexConnect(token: string, businessId: unknown): Promise<CortexOutcome> {
  const s = await cortexOpen(token, businessId);
  s.close();
  return { outcome: s.outcome, userId: s.userId, businessId: s.businessId, frames: s.frames };
}

describe('ST-2-WS (fixed) — the KEY Cortex WebSocket applies the same local-user checks as AuthMiddleware, to both token kinds', () => {
  /** Each case starts from an active SUPER_ADMIN row. */
  async function resetWsAdmin() {
    await db.user.update({ where: { id: ID.wsAdmin }, data: { role: 'SUPER_ADMIN', bannedAt: null, deletedAt: null } });
  }

  async function expectSocketServed(token: string, label: string) {
    const res = await cortexConnect(token, ID.bizB);
    expect(res.outcome, `${label}: ${res.frames.join(' | ')}`).toBe('connected');
    expect(res.userId).toBe(ID.wsAdmin);
    expect(res.businessId).toBe(ID.bizB);
  }

  async function expectSocketRefused(token: string, label: string) {
    const res = await cortexConnect(token, ID.bizB);
    expect(res.outcome, `${label}: ${res.frames.join(' | ')}`).toBe('refused');
    expect(res.frames.join(' '), `${label}: nothing of the foreign tenant is sent`).not.toContain(BIZ_B_NAME);
  }

  it('fixture: wsAdmin is a SUPER_ADMIN row with no membership, so only the SUPER_ADMIN bypass can open bizB’s socket', async () => {
    expect(await db.user.findUnique({ where: { id: ID.wsAdmin } })).toMatchObject({ role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null });
    expect(await db.membership.count({ where: { userId: ID.wsAdmin } })).toBe(0);
  });

  it('positive control: an admin token and a Supabase token of an active SUPER_ADMIN open the foreign tenant’s socket; the owner of another tenant does not', async () => {
    await resetWsAdmin();
    await expectSocketServed(mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN'), 'admin token, active SUPER_ADMIN');
    await expectSocketServed(mintToken(ID.wsAdmin), 'Supabase token, active SUPER_ADMIN');
    // The tenant check itself is live: the owner of bizA only is refused bizB's socket.
    await expectSocketRefused(T[ID.owner], 'Supabase token, owner of bizA only');
  });

  it('the role comes from the User row: after the row is demoted, an admin token that still says SUPER_ADMIN cannot open the foreign tenant’s socket; restoring the row restores it', async () => {
    await resetWsAdmin();
    const adminToken = mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN');
    await db.user.update({ where: { id: ID.wsAdmin }, data: { role: 'USER' } });
    await expectSocketRefused(adminToken, 'admin token, row demoted to USER');
    await expectSocketRefused(mintToken(ID.wsAdmin), 'Supabase token, row demoted to USER');
    await resetWsAdmin();
    await expectSocketServed(adminToken, 'admin token, row restored');
  });

  it('User.bannedAt and User.deletedAt each refuse both token kinds; clearing them restores access', async () => {
    await resetWsAdmin();
    const adminToken = mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN');
    const supabaseToken = mintToken(ID.wsAdmin);
    await db.user.update({ where: { id: ID.wsAdmin }, data: { bannedAt: new Date() } });
    await expectSocketRefused(adminToken, 'admin token, bannedAt');
    await expectSocketRefused(supabaseToken, 'Supabase token, bannedAt');
    await db.user.update({ where: { id: ID.wsAdmin }, data: { bannedAt: null, deletedAt: new Date() } });
    await expectSocketRefused(adminToken, 'admin token, deletedAt');
    await expectSocketRefused(supabaseToken, 'Supabase token, deletedAt');
    await resetWsAdmin();
    await expectSocketServed(adminToken, 'admin token, ban and delete cleared');
    await expectSocketServed(supabaseToken, 'Supabase token, ban and delete cleared');
  });

  it('an admin token whose subject has no User row cannot open any socket, and no row is created', async () => {
    await expectSocketRefused(mintAdminToken(ID.adminNoRow, 'SUPER_ADMIN'), 'admin token, no User row');
    expect(await db.user.findUnique({ where: { id: ID.adminNoRow } })).toBeNull();
  });

  // ST-WS-R2 (R0-ID-F6 review). The handshake businessId is client JSON. It
  // reached business.findFirst as `id`, where an object is a Prisma filter, so
  // the owner of bizA opened a socket with { in: [bizA, bizB] } as its tenant
  // (joined business:[object Object], and that object went on to the chat and
  // approval handlers). BusinessGuard refuses the same value over HTTP
  // ('businessId is required'); the socket now reads it the same way.
  it('ST-WS-R2: a tenant named by anything but a non-empty string is refused — the owner of bizA with { in: [bizA, bizB] } or { not: "" }, and a SUPER_ADMIN with an object; bizA as a string is served', async () => {
    await resetWsAdmin();
    const own = await cortexConnect(T[ID.owner], ID.bizA);
    expect(own.outcome, `control, owner of bizA asks for bizA: ${own.frames.join(' | ')}`).toBe('connected');
    expect(own.businessId).toBe(ID.bizA);

    for (const businessId of [{ in: [ID.bizA, ID.bizB] }, { not: '' }, [ID.bizA, ID.bizB]]) {
      const res = await cortexConnect(T[ID.owner], businessId);
      expect(res.outcome, `owner of bizA, businessId ${JSON.stringify(businessId)}: ${res.frames.join(' | ')}`).toBe('refused');
    }
    const admin = await cortexConnect(mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN'), { in: [ID.bizB] });
    expect(admin.outcome, `SUPER_ADMIN, businessId { in: [bizB] }: ${admin.frames.join(' | ')}`).toBe('refused');
  });

  // A NEW socket only: cortexConnect closes each socket once the gateway decides.
  // A socket already open when the logout lands keeps working (OPEN DEFECT
  // ST-WS-R1, reproduced below).
  it('POST /identity/logout refuses a new socket to both token kinds issued before it, by issue time (the admin cutoff and the logout marker); tokens of a later session are served', async () => {
    await resetWsAdmin();
    const adminBefore = mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN');
    const supabaseBefore = mintToken(ID.wsAdmin);
    await expectSocketServed(supabaseBefore, 'Supabase token before the logout');

    const loggedOutFrom = Math.floor(Date.now() / 1000);
    const out = await call('post', '/identity/logout', supabaseBefore);
    const loggedOutTo = Math.floor(Date.now() / 1000);
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const revokedAt = await expectRevocationTime(ID.wsAdmin, loggedOutFrom, loggedOutTo);
    expect(await redis!.get(adminCutoffKey(ID.wsAdmin)), 'POST /identity/logout also writes the admin-token cutoff').toMatch(/^\d{13,}$/);

    await expectSocketRefused(adminBefore, 'admin token issued before the logout');
    await expectSocketRefused(supabaseBefore, 'Supabase token issued before the logout');

    await untilAfterSecond(revokedAt);
    await expectSocketServed(mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN'), 'admin token issued after the logout');
    await expectSocketServed(mintToken(ID.wsAdmin), 'Supabase token of a session opened after the logout');
  });
});

// ---------------------------------------------------------------------------
// OPEN DEFECT ST-WS-R1 (R0-ID-F6 review; pre-existing, NOT fixed here). The
// gateway decides at connect only: handleConnection stores the connect-time
// { userId, businessId } (key-cortex.gateway.ts ClientInfo) and handleApprove,
// handleReject, handleChat, handleTyping and the business:/user: room pushes
// trust it for the socket's lifetime; nothing in src disconnects a socket on a
// ban, a demotion, a delete or a logout. The fix is in key-cortex.gateway.ts
// and the revocation writers, outside R0-ID-F6's write set.
//
// The probe is key:approve for an approval id that exists nowhere: the handler
// answers 'Not authenticated' for a socket it holds no identity for, and
// 'Approval failed: Approval request not found' once it has looked the id up
// in the socket's tenant — i.e. it decided as wsAdmin in bizB. Nothing is
// approved or executed.
// ---------------------------------------------------------------------------
describe('OPEN DEFECT ST-WS-R1 — a KEY Cortex socket opened before a ban, demotion or logout keeps acting in the foreign tenant', () => {
  const NO_SUCH_APPROVAL = `${P}ws_no_such_approval`;
  const DECIDED_IN_TENANT = 'Approval failed: Approval request not found';

  async function resetWsAdmin() {
    await db.user.update({ where: { id: ID.wsAdmin }, data: { role: 'SUPER_ADMIN', bannedAt: null, deletedAt: null } });
  }

  /** key:approve on the open socket: what the gateway answered, or 'closed' if it cut the socket. */
  async function approveProbe(s: CortexSession): Promise<string> {
    const answer = s.next('key:error');
    s.emit('key:approve', { approvalId: NO_SUCH_APPROVAL });
    const res = await answer;
    return res === 'closed' ? 'closed' : String((res.payload as { message?: string }).message);
  }

  it('OPEN DEFECT ST-WS-R1 reproduced — after the row is banned and demoted, a new socket is refused but the open one still decides approvals in bizB as wsAdmin', async () => {
    await resetWsAdmin();
    const s = await cortexOpen(mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN'), ID.bizB);
    try {
      expect(s.outcome, s.frames.join(' | ')).toBe('connected');
      expect(await approveProbe(s), 'control, before the ban').toBe(DECIDED_IN_TENANT);

      await db.user.update({ where: { id: ID.wsAdmin }, data: { role: 'USER', bannedAt: new Date() } });
      const fresh = await cortexConnect(mintAdminToken(ID.wsAdmin, 'SUPER_ADMIN'), ID.bizB);
      expect(fresh.outcome, 'a new socket after the ban').toBe('refused');

      expect(await approveProbe(s), 'the socket opened before the ban').toBe(DECIDED_IN_TENANT);
    } finally {
      s.close();
      await resetWsAdmin();
    }
  });

  it('OPEN DEFECT ST-WS-R1 reproduced — after POST /identity/logout, a new socket with the same token is refused but the open one still decides approvals in bizB', async () => {
    await resetWsAdmin();
    const token = mintToken(ID.wsAdmin);
    const s = await cortexOpen(token, ID.bizB);
    try {
      expect(s.outcome, s.frames.join(' | ')).toBe('connected');
      const out = await call('post', '/identity/logout', token);
      expect(out.status, JSON.stringify(out.body)).toBe(201);
      const fresh = await cortexConnect(token, ID.bizB);
      expect(fresh.outcome, 'a new socket with the logged-out token').toBe('refused');

      expect(await approveProbe(s), 'the socket opened before the logout').toBe(DECIDED_IN_TENANT);
    } finally {
      s.close();
    }
  });

  it.todo(
    'REQUIRED (follow-up packet; key-cortex.gateway.ts and the ban/demote/delete/logout writers — identity.controller.ts logout, ' +
      'admin-auth logout, the admin user routes — outside this write set): a socket loses the tenant once its user is banned, deleted, ' +
      'demoted below the authority it connected with, or logged out — each case above answers "closed" (the socket is disconnected and ' +
      'leaves its business:/user: rooms) or "Not authenticated", never "Approval failed: Approval request not found". Re-checking the ' +
      'handshake token on every message would also cut every socket at the token’s expiry, which has no in-band refresh today; the fix ' +
      'packet decides between disconnecting user:<id> on revocation and a per-message re-check with a token-refresh event',
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
// ST-F4 — FIXED by V1-07-AUTH-INVITE-CEILING. The "OPEN DEFECT ST-F4
// reproduced" case pinned a restricted team:write member (adminW) inviting an
// account it controls with team:admin at tier 4, which then reset adminW to
// the ADMIN defaults through the role route. It now asserts the behaviour its
// it.todo required (refused with 403, not clamped: nothing is created) and the
// it.todo is gone; the OWNER positive control shows the invite is bounded, not
// closed.
//
// CR-1 — FIXED by V1-21-AUTH-JOBROLE-CEILING. The "OPEN DEFECT CR-1
// reproduced" case pinned the ST-1 outcome through the sibling team:write
// structure routes (R0-ID-F1-ROLE-ROUTE-AUTHORITY review): a default ADMIN
// (adminJ) authored a JobRole with team:admin at tier 4 and assigned it to
// itself, then passed the role route's team:admin gate. It now asserts the
// behaviour its it.todo required (each step refused with 403, the membership
// byte-identical) and the it.todo is gone. The OWNER positive control shows
// the job-role route is bounded, not closed; the DTO case proves the
// vocabulary at the built server's ValidationPipe. The full case matrix is in
// structure-authority-ceiling.integration.test.ts. Both blocks run last and
// use their own fixtures (adminW, accomplice, adminJ).
// ---------------------------------------------------------------------------
/** A User created by an invite has a generated id, so it is found by its (prefixed) email. */
const freshInviteEmail = (tag: string) => email(`${P}invite_${tag}`);

describe('ST-F4 (fixed, V1-07-AUTH-INVITE-CEILING) — the invite route applies the grantor ceiling, so a restricted team:write member cannot mint an account above itself', () => {
  it('ST-F4 — adminW ({ crm: read, team: write }, tier 0) invites an account it controls with team:admin at tier 4: 403, no membership is created, and that account cannot reset adminW', async () => {
    const t = T[ID.adminW];
    expect((await call('get', routes.settingsRead(ID.bizD), t)).status).toBe(403);
    // The direct routes are closed to adminW (team:write only).
    expect((await call('patch', routes.member(ID.bizD, ID.mAdminW), t, { role: 'ADMIN' })).status).toBe(403);
    const adminWBefore = await membershipRowText(ID.mAdminW);

    const invite = await call('post', routes.team(ID.bizD), t, {
      email: email(ID.accomplice),
      role: 'ADMIN',
      scopes: { ...ROLE_DEFAULT_SCOPES.OWNER },
      maxApprovalTier: 4,
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(403);
    expect(JSON.stringify(invite.body)).toContain('You cannot grant more authority than your own');
    // No Membership, and the accomplice's User row is still the only one with its email.
    expect(await db.membership.count({ where: { userId: ID.accomplice } })).toBe(0);
    expect(await db.user.count({ where: { email: email(ID.accomplice) } })).toBe(1);
    expect(await db.teamActivityLog.count({ where: { businessId: ID.bizD, action: 'member_invited', userId: ID.adminW } })).toBe(0);

    // The second request of the escalation has nothing to stand on.
    const reset = await call('patch', routes.member(ID.bizD, ID.mAdminW), T[ID.accomplice], { role: 'ADMIN' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(403);
    expect(await membershipRowText(ID.mAdminW)).toBe(adminWBefore);
    expect((await call('get', routes.settingsRead(ID.bizD), t)).status).toBe(403);
  });

  it('ST-F4 — each dimension alone is refused for adminW: a module level above its own, a tier above its own, and a role whose defaults exceed its own; no User row is created for a new email', async () => {
    const t = T[ID.adminW];
    const e = freshInviteEmail('refused');
    const payloads = [
      { email: e, role: 'STAFF', scopes: { crm: 'read', team: 'admin' }, maxApprovalTier: 0 }, // team above write
      { email: e, role: 'STAFF', scopes: { crm: 'write' }, maxApprovalTier: 0 },               // crm above read
      { email: e, role: 'STAFF', scopes: { crm: 'read' }, maxApprovalTier: 1 },                // tier above 0
      { email: e, role: 'ADMIN' },                                                             // ADMIN role defaults
      { email: e, role: 'STAFF' },                                                             // STAFF role defaults (revenue: read, ...)
    ];
    for (const body of payloads) {
      const res = await call('post', routes.team(ID.bizD), t, body);
      expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(await db.user.count({ where: { email: e } }), JSON.stringify(body)).toBe(0);
    }
  });

  it('ST-F4 positive control: adminW still invites within its own authority ({ crm: read }, tier 0) -> 201, the row holds exactly that', async () => {
    const e = freshInviteEmail('within');
    const res = await call('post', routes.team(ID.bizD), T[ID.adminW], {
      email: e, role: 'STAFF', scopes: { crm: 'read' }, maxApprovalTier: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.membership.findFirst({ where: { businessId: ID.bizD, user: { email: e } } });
    expect(row.permissionScopes).toEqual({ crm: 'read' });
    expect(row.maxApprovalTier).toBe(0);
  });

  it('ST-F4 positive control: the OWNER invites at any tier — the same team:admin, tier-4 invite of the accomplice -> 201, created as asked', async () => {
    const res = await call('post', routes.team(ID.bizD), T[ID.ownerD], {
      email: email(ID.accomplice),
      role: 'ADMIN',
      scopes: { ...ROLE_DEFAULT_SCOPES.OWNER },
      maxApprovalTier: 4,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.membership.findFirst({ where: { businessId: ID.bizD, userId: ID.accomplice } });
    expect(row.role).toBe('ADMIN');
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.OWNER);
    expect(row.maxApprovalTier).toBe(4);
  });
});

describe('CR-1 (fixed, V1-21-AUTH-JOBROLE-CEILING) — the structure routes (team:write) cannot copy a JobRole above the caller onto any membership, the caller’s own included', () => {
  it('CR-1 — a default ADMIN (team:write) tries to raise itself to team:admin at tier 4 through job-roles + assignments: each step 403, its membership byte-identical, and the role route still refuses it', async () => {
    const t = T[ID.adminJ];
    // Before: the role route is closed to a team:write member.
    const before = await call('patch', routes.member(ID.bizD, ID.mStaffP), t, { role: 'STAFF' });
    expect(before.status, JSON.stringify(before.body)).toBe(403);
    const adminJBefore = await membershipRowText(ID.mAdminJ);

    const unit = await call('post', routes.orgUnits(ID.bizD), t, { name: `${P}unit_cr1` });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    // 1. Authoring the escalation is refused: a JobRole is bounded by its author.
    const jobRole = await call('post', routes.jobRoles(ID.bizD), t, {
      name: `${P}jobrole_cr1`,
      permissions: { ...ROLE_DEFAULT_SCOPES.OWNER },
      defaultApprovalTier: 4,
    });
    expect(jobRole.status, JSON.stringify(jobRole.body)).toBe(403);
    expect(JSON.stringify(jobRole.body)).toContain('You cannot grant more authority than your own');
    expect(await db.jobRole.count({ where: { businessId: ID.bizD, name: `${P}jobrole_cr1` } })).toBe(0);

    // 2. The same role authored by the OWNER is created (positive control: bounded, not closed) ...
    const ownerRole = await call('post', routes.jobRoles(ID.bizD), T[ID.ownerD], {
      name: `${P}jobrole_cr1_owner`,
      permissions: { ...ROLE_DEFAULT_SCOPES.OWNER },
      defaultApprovalTier: 4,
    });
    expect(ownerRole.status, JSON.stringify(ownerRole.body)).toBe(201);
    // ... and the ADMIN still cannot sync it onto its own membership.
    const assign = await call('post', routes.assignments(ID.bizD), t, {
      membershipId: ID.mAdminJ,
      userId: ID.adminJ,
      orgUnitId: unit.body.id,
      jobRoleId: ownerRole.body.id,
    });
    expect(assign.status, JSON.stringify(assign.body)).toBe(403);
    expect(JSON.stringify(assign.body)).toContain('You cannot grant more authority than your own');
    expect(await membershipRowText(ID.mAdminJ)).toBe(adminJBefore);
    expect(await db.orgAssignment.count({ where: { membershipId: ID.mAdminJ } })).toBe(0);

    // After: still team:write at tier 3, so the role route still refuses it, and so does its self-target (ST-F1).
    const after = await call('patch', routes.member(ID.bizD, ID.mStaffP), t, { role: 'STAFF' });
    expect(after.status, JSON.stringify(after.body)).toBe(403);
    expect((await call('patch', routes.perms(ID.bizD, ID.mAdminJ), t, { scopes: { crm: 'read' }, maxApprovalTier: 0 })).status).toBe(403);
  });

  it('CR-1 — the built server refuses a JobRole outside the canonical vocabulary at its ValidationPipe, for the OWNER too: a KEY tool-family key, a level that is not one, a tier above 4 (400, nothing created)', async () => {
    const name = `${P}jobrole_cr1_invalid`;
    for (const body of [
      { name, permissions: { finance: 'write' } },
      { name, permissions: { crm: 'owner' } },
      { name, permissions: { crm: 'read' }, defaultApprovalTier: 5 },
    ]) {
      const res = await call('post', routes.jobRoles(ID.bizD), T[ID.ownerD], body);
      expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(await db.jobRole.count({ where: { businessId: ID.bizD, name } })).toBe(0);
  });
});
